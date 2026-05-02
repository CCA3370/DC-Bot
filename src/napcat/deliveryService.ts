import type { AppConfig } from "../shared/config.js";
import type { AppDatabase } from "../shared/database.js";
import type { Logger } from "../shared/logger.js";
import type { DeliveryJob, NormalizedDiscordMessage } from "../shared/types.js";
import { ImageProcessor } from "../media/imageProcessor.js";
import { NapCatClient } from "./napcatClient.js";

export interface DeliveryServiceOptions {
  config: AppConfig;
  database: AppDatabase;
  logger: Logger;
}

export class DeliveryService {
  private readonly imageProcessor: ImageProcessor;
  private readonly napcat: NapCatClient;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: DeliveryServiceOptions) {
    this.imageProcessor = new ImageProcessor(options.config);
    this.napcat = new NapCatClient(options.config.napcat);
  }

  getNapCatConfig() {
    return this.napcat.getConfig();
  }

  updateNapCatConfig(config: AppConfig["napcat"]) {
    this.napcat.updateConfig(config);
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

    const payload = {
      message,
      images: await this.imageProcessor.prepareImages(message)
    };

    const jobIds = routes.map((route) =>
      this.options.database.createDeliveryJob(message.id, message.sourceId, route.groupId, payload)
    );

    this.options.database.recordEventLog("info", "delivery", "Queued Discord message for QQ delivery", {
      discordMessageId: message.id,
      sourceId: message.sourceId,
      jobCount: jobIds.length
    });

    for (const jobId of jobIds) {
      const job = this.options.database.getDeliveryJob(jobId);
      if (job) {
        await this.processJob(job);
      }
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
    try {
      await this.napcat.sendPreparedMessage(job.qqGroupId, job.payload);
      this.options.database.markDeliveryJobSent(job.id);
      this.options.database.recordEventLog("info", "delivery", "Delivered queued message to QQ group", {
        jobId: job.id,
        groupId: job.qqGroupId
      });
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

  private calculateNextAttemptAt(attemptCount: number) {
    const exponent = Math.min(attemptCount, 10);
    const seconds = Math.min(
      this.options.config.delivery.retryMaxSeconds,
      this.options.config.delivery.retryBaseSeconds * 2 ** exponent
    );
    return new Date(Date.now() + seconds * 1000).toISOString();
  }

  private logError(message: string, error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.options.logger.error(message, { error: errorMessage });
    this.options.database.recordEventLog("error", "delivery", message, { error: errorMessage });
  }
}
