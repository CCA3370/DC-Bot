import { unlink } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { AppConfig } from "../shared/config.js";
import type { AppDatabase } from "../shared/database.js";
import type { Logger } from "../shared/logger.js";
import type {
  DeliveryJob,
  FanoutDeliveryState,
  FanoutTargetState,
  NormalizedDiscordMessage,
  PreparedBridgePayload,
  ProcessedImageAsset
} from "../shared/types.js";
import { ImageProcessor } from "../media/imageProcessor.js";
import { MarkdownImageRenderer } from "../media/markdownImageRenderer.js";
import { DeepLxClient } from "./deepLxClient.js";
import { NapCatClient } from "./napcatClient.js";

const forwardFallbackThreshold = 3;
const fallbackLogMessage = "Falling back to original send after repeated group forward failures";

export interface DeliveryServiceOptions {
  config: AppConfig;
  database: AppDatabase;
  logger: Logger;
}

export class DeliveryService {
  private readonly imageProcessor: ImageProcessor;
  private readonly markdownRenderer: MarkdownImageRenderer;
  private readonly napcat: NapCatClient;
  private readonly deeplx: DeepLxClient;
  private readonly mediaCacheRoot: string;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: DeliveryServiceOptions) {
    this.imageProcessor = new ImageProcessor(options.config);
    this.markdownRenderer = new MarkdownImageRenderer(options.config);
    this.napcat = new NapCatClient(options.config.napcat);
    this.deeplx = new DeepLxClient(options.config.deeplx);
    this.mediaCacheRoot = resolve(options.config.storage.mediaCacheDir);
  }

  getNapCatConfig() {
    return this.napcat.getConfig();
  }

  updateNapCatConfig(config: AppConfig["napcat"]) {
    this.napcat.updateConfig(config);
  }

  getDeepLxConfig() {
    return this.deeplx.getConfig();
  }

  updateDeepLxConfig(config: AppConfig["deeplx"]) {
    this.deeplx.updateConfig(config);
  }

  startRetryWorker() {
    this.retryTimer = setInterval(() => {
      void this.processDueJobs().catch((error) => this.logError("Delivery retry worker failed", error));
    }, 15_000);
  }

  stopRetryWorker() {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  async handleDiscordMessage(message: NormalizedDiscordMessage) {
    const routes = this.options.database.listActiveRoutesForSource(message.sourceId);
    if (routes.length === 0) {
      this.options.database.recordEventLog("info", "delivery", "Ignored Discord message without configured routes", {
        discordMessageId: message.id,
        sourceId: message.sourceId,
        sourceName: message.sourceName
      });
      return;
    }

    const [translatedText, markdownImage, images] = await Promise.all([
      this.translateMessage(message),
      this.markdownRenderer.renderMessage(message),
      this.imageProcessor.prepareImages(message)
    ]);
    const translatedImage = await this.renderTranslatedImage(message, translatedText);

    const targetGroupIds = routes.map((route) => route.groupId);
    const primaryGroupId = targetGroupIds[0];
    if (!primaryGroupId) {
      return;
    }

    const payload: PreparedBridgePayload = {
      message,
      translatedText,
      translatedImage,
      markdownImage,
      images,
      localFilePaths: collectLocalFilePaths(translatedImage, markdownImage, images),
      fanout: createFanoutState(targetGroupIds, primaryGroupId)
    };

    const jobId = this.options.database.createDeliveryJob(message.id, message.sourceId, primaryGroupId, payload);

    this.options.database.recordEventLog("info", "delivery", "Queued Discord message for QQ delivery", {
      discordMessageId: message.id,
      sourceId: message.sourceId,
      jobCount: 1,
      targetGroupIds,
      primaryGroupId
    });

    const job = this.options.database.getDeliveryJob(jobId);
    if (job) {
      await this.processJob(job);
    }
  }

  async processDueJobs(limit = 25) {
    const jobs = this.options.database.listDueDeliveryJobs(limit);
    for (const job of jobs) {
      await this.processJob(job);
    }
  }

  async processJobById(id: number) {
    const job = this.options.database.getDeliveryJob(id);
    if (!job) {
      throw new Error(`Delivery job ${id} was not found`);
    }
    await this.processJob(job);
  }

  async testNapCatConnection() {
    await this.napcat.testConnection();
  }

  async listNapCatGroups() {
    return this.napcat.listGroups();
  }

  async sendTestMessage(groupId: string, text: string) {
    await this.napcat.sendGroupText(groupId, text);
  }

  async processJob(job: DeliveryJob) {
    if (job.payload.fanout) {
      await this.processFanoutJob(job);
      return;
    }

    await this.processLegacyJob(job);
  }

  private async processLegacyJob(job: DeliveryJob) {
    try {
      await this.napcat.sendPreparedMessage(job.qqGroupId, job.payload);
      this.options.database.markDeliveryJobSent(job.id);
      this.options.database.recordEventLog("info", "delivery", "Delivered queued message to QQ group", {
        jobId: job.id,
        groupId: job.qqGroupId
      });
      await this.cleanupPayloadFiles(job, job.payload);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const nextAttemptAt = this.calculateNextAttemptAt(job.attemptCount);
      this.options.database.markDeliveryJobFailed(job.id, errorMessage, nextAttemptAt);
      this.options.database.recordEventLog("warn", "delivery", "Failed to deliver queued message to QQ group", {
        jobId: job.id,
        groupId: job.qqGroupId,
        nextAttemptAt,
        error: errorMessage
      });
    }
  }

  private async processFanoutJob(job: DeliveryJob) {
    const payload = normalizeFanoutPayload(job.payload, job.qqGroupId);
    const fanout = payload.fanout;
    if (!fanout) {
      await this.processLegacyJob({ ...job, payload });
      return;
    }

    const failedTargets: Array<{ groupId: string; error: string }> = [];

    for (const target of fanout.targets) {
      if (target.status === "sent") {
        continue;
      }

      if (target.groupId === fanout.primaryGroupId) {
        await this.sendPrimaryFanoutTarget(payload, fanout, target, failedTargets);
        continue;
      }

      await this.sendSecondaryFanoutTarget(job, payload, fanout, target, failedTargets);
    }

    this.options.database.updateDeliveryJobPayload(job.id, payload);

    if (fanout.targets.every((target) => target.status === "sent")) {
      this.options.database.markDeliveryJobSent(job.id);
      this.options.database.recordEventLog("info", "delivery", "Delivered fanout message to QQ groups", {
        jobId: job.id,
        discordMessageId: job.discordMessageId,
        primaryGroupId: fanout.primaryGroupId,
        primaryMessageId: fanout.primaryMessageId,
        targetGroupIds: fanout.targetGroupIds
      });
      await this.cleanupPayloadFiles(job, payload);
      return;
    }

    const errorMessage =
      failedTargets.length > 0
        ? failedTargets.map((target) => `${target.groupId}: ${target.error}`).join("; ")
        : "Fanout delivery is incomplete";
    const nextAttemptAt = this.calculateNextAttemptAt(job.attemptCount);
    this.options.database.markDeliveryJobFailed(job.id, errorMessage, nextAttemptAt);
    this.options.database.recordEventLog("warn", "delivery", "Failed to deliver fanout message to QQ groups", {
      jobId: job.id,
      discordMessageId: job.discordMessageId,
      primaryGroupId: fanout.primaryGroupId,
      primaryMessageId: fanout.primaryMessageId,
      failedTargets,
      nextAttemptAt
    });
  }

  private async sendPrimaryFanoutTarget(
    payload: PreparedBridgePayload,
    fanout: FanoutDeliveryState,
    target: FanoutTargetState,
    failedTargets: Array<{ groupId: string; error: string }>
  ) {
    try {
      const primaryMessageId = await this.napcat.sendPreparedMessage(target.groupId, payload);
      fanout.primaryMessageId = primaryMessageId;
      markTargetSent(target, "primary", primaryMessageId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      markTargetFailed(target, errorMessage);
      failedTargets.push({ groupId: target.groupId, error: errorMessage });
    }
  }

  private async sendSecondaryFanoutTarget(
    job: DeliveryJob,
    payload: PreparedBridgePayload,
    fanout: FanoutDeliveryState,
    target: FanoutTargetState,
    failedTargets: Array<{ groupId: string; error: string }>
  ) {
    if (!fanout.primaryMessageId) {
      const errorMessage = `Primary group ${fanout.primaryGroupId} has no message_id for forwarding`;
      markTargetFailed(target, errorMessage);
      failedTargets.push({ groupId: target.groupId, error: errorMessage });
      return;
    }

    if (target.forwardFailureCount >= forwardFallbackThreshold) {
      await this.sendOriginalFallbackFanoutTarget(job, payload, fanout, target, failedTargets);
      return;
    }

    try {
      await this.napcat.forwardGroupSingleMessage(target.groupId, fanout.primaryMessageId);
      markTargetSent(target, "forward", fanout.primaryMessageId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      target.forwardFailureCount += 1;
      markTargetFailed(target, errorMessage);
      failedTargets.push({ groupId: target.groupId, error: errorMessage });
    }
  }

  private async sendOriginalFallbackFanoutTarget(
    job: DeliveryJob,
    payload: PreparedBridgePayload,
    fanout: FanoutDeliveryState,
    target: FanoutTargetState,
    failedTargets: Array<{ groupId: string; error: string }>
  ) {
    if (!target.fallbackLogged) {
      target.fallbackLogged = true;
      this.options.database.recordEventLog("warn", "delivery", fallbackLogMessage, {
        discordMessageId: job.discordMessageId,
        sourceId: job.sourceId,
        primaryGroupId: fanout.primaryGroupId,
        targetGroupId: target.groupId,
        primaryMessageId: fanout.primaryMessageId,
        forwardFailureCount: target.forwardFailureCount,
        lastError: target.lastError
      });
    }

    try {
      const messageId = await this.napcat.sendPreparedMessage(target.groupId, payload);
      markTargetSent(target, "original", messageId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      markTargetFailed(target, errorMessage);
      failedTargets.push({ groupId: target.groupId, error: errorMessage });
    }
  }

  private calculateNextAttemptAt(attemptCount: number) {
    const exponent = Math.min(attemptCount, 10);
    const seconds = Math.min(
      this.options.config.delivery.retryMaxSeconds,
      this.options.config.delivery.retryBaseSeconds * 2 ** exponent
    );
    return new Date(Date.now() + seconds * 1000).toISOString();
  }

  private async cleanupPayloadFiles(job: DeliveryJob, payload: PreparedBridgePayload) {
    const filePaths = collectPayloadFilePaths(payload);
    if (filePaths.length === 0) {
      return;
    }

    const failures: Array<{ filePath: string; error: string }> = [];
    for (const filePath of filePaths) {
      const resolvedPath = resolve(filePath);
      const cacheRelativePath = relative(this.mediaCacheRoot, resolvedPath);
      if (cacheRelativePath.startsWith("..") || isAbsolute(cacheRelativePath)) {
        failures.push({ filePath, error: "File is outside the configured media cache directory" });
        continue;
      }

      try {
        await unlink(resolvedPath);
      } catch (error) {
        const nodeError = error as NodeJS.ErrnoException;
        if (nodeError.code !== "ENOENT") {
          failures.push({ filePath, error: nodeError.message });
        }
      }
    }

    if (failures.length > 0) {
      this.options.logger.warn("Failed to clean delivered media cache files", {
        jobId: job.id,
        failures
      });
      this.options.database.recordEventLog("warn", "delivery", "Failed to clean delivered media cache files", {
        jobId: job.id,
        discordMessageId: job.discordMessageId,
        failures
      });
    }
  }

  private async translateMessage(message: NormalizedDiscordMessage) {
    const text = message.text.trim();
    if (text.length === 0 || !this.deeplx.isConfigured()) {
      return null;
    }

    try {
      return await this.deeplx.translateToChinese(text);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.options.database.recordEventLog("warn", "deeplx", "DeepLX translation failed; sending markdown image without translation image", {
        discordMessageId: message.id,
        sourceId: message.sourceId,
        error: errorMessage
      });
      return null;
    }
  }

  private async renderTranslatedImage(message: NormalizedDiscordMessage, translatedText: string | null) {
    try {
      return await this.markdownRenderer.renderTranslation(message, translatedText);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.options.database.recordEventLog("warn", "delivery", "Failed to render translated text image; sending markdown image without translation", {
        discordMessageId: message.id,
        sourceId: message.sourceId,
        error: errorMessage
      });
      return null;
    }
  }

  private logError(message: string, error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.options.logger.error(message, { error: errorMessage });
    this.options.database.recordEventLog("error", "delivery", message, { error: errorMessage });
  }
}

function createFanoutState(targetGroupIds: string[], primaryGroupId: string): FanoutDeliveryState {
  return {
    targetGroupIds,
    primaryGroupId,
    primaryMessageId: null,
    targets: targetGroupIds.map((groupId) => ({
      groupId,
      status: "pending",
      deliveryMethod: groupId === primaryGroupId ? "primary" : "forward",
      primaryMessageId: null,
      forwardFailureCount: 0,
      fallbackLogged: false,
      lastError: null,
      sentAt: null
    }))
  };
}

function normalizeFanoutPayload(payload: PreparedBridgePayload, fallbackPrimaryGroupId: string): PreparedBridgePayload {
  if (!payload.fanout) {
    return payload;
  }

  const primaryGroupId = payload.fanout.primaryGroupId || fallbackPrimaryGroupId;
  const targetGroupIds =
    payload.fanout.targetGroupIds.length > 0
      ? payload.fanout.targetGroupIds
      : [primaryGroupId, ...payload.fanout.targets.map((target) => target.groupId)];
  const existingTargets = new Map(payload.fanout.targets.map((target) => [target.groupId, target]));

  payload.fanout = {
    targetGroupIds,
    primaryGroupId,
    primaryMessageId: payload.fanout.primaryMessageId ?? null,
    targets: targetGroupIds.map((groupId) => normalizeFanoutTarget(groupId, primaryGroupId, existingTargets.get(groupId)))
  };

  if (!payload.localFilePaths) {
    payload.localFilePaths = collectPayloadFilePaths(payload);
  }

  return payload;
}

function normalizeFanoutTarget(groupId: string, primaryGroupId: string, target?: FanoutTargetState): FanoutTargetState {
  return {
    groupId,
    status: target?.status ?? "pending",
    deliveryMethod: target?.deliveryMethod ?? (groupId === primaryGroupId ? "primary" : "forward"),
    primaryMessageId: target?.primaryMessageId ?? null,
    forwardFailureCount: target?.forwardFailureCount ?? 0,
    fallbackLogged: target?.fallbackLogged ?? false,
    lastError: target?.lastError ?? null,
    sentAt: target?.sentAt ?? null
  };
}

function markTargetSent(target: FanoutTargetState, deliveryMethod: FanoutTargetState["deliveryMethod"], primaryMessageId: string) {
  target.status = "sent";
  target.deliveryMethod = deliveryMethod;
  target.primaryMessageId = primaryMessageId;
  target.lastError = null;
  target.sentAt = new Date().toISOString();
}

function markTargetFailed(target: FanoutTargetState, errorMessage: string) {
  target.status = "failed";
  target.lastError = errorMessage;
}

function collectLocalFilePaths(
  translatedImage: ProcessedImageAsset | null,
  markdownImage: ProcessedImageAsset | null,
  images: ProcessedImageAsset[]
) {
  return [
    ...(translatedImage ? [translatedImage.filePath] : []),
    ...(markdownImage ? [markdownImage.filePath] : []),
    ...images.map((image) => image.filePath)
  ];
}

function collectPayloadFilePaths(payload: PreparedBridgePayload) {
  return [
    ...new Set([
      ...(payload.localFilePaths ?? []),
      ...collectLocalFilePaths(payload.translatedImage, payload.markdownImage, payload.images)
    ])
  ];
}
