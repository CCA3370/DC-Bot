import { existsSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DeliveryService } from "../src/napcat/deliveryService.js";
import { loadConfig } from "../src/shared/config.js";
import { AppDatabase } from "../src/shared/database.js";
import type { FanoutDeliveryState, PreparedBridgePayload } from "../src/shared/types.js";

interface ApiCall {
  action: string;
  body: Record<string, unknown>;
}

describe("DeliveryService fanout delivery", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the primary group once and forwards the primary message to secondary groups", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-fanout-"));
    const mediaPath = await writeCachedImage(directory, "markdown.png");
    const database = new AppDatabase(join(directory, "test.sqlite"));
    const service = createService(database, directory);
    const calls = mockNapCatCalls((call) => {
      if (call.action === "send_group_forward_msg") {
        return okResponse({ message_id: call.body.group_id === "10001" ? "9001" : "unexpected" });
      }
      return okResponse({});
    });

    const jobId = database.createDeliveryJob(
      "m1",
      "source-1",
      "10001",
      createPayload(mediaPath, createFanout(["10001", "10002", "10003"], "10001"))
    );

    await service.processJobById(jobId);

    const job = database.getDeliveryJob(jobId);
    expect(job?.status).toBe("sent");
    expect(job?.payload.fanout?.primaryMessageId).toBe("9001");
    expect(job?.payload.fanout?.targets.map((target) => [target.groupId, target.deliveryMethod, target.status])).toEqual([
      ["10001", "primary", "sent"],
      ["10002", "forward", "sent"],
      ["10003", "forward", "sent"]
    ]);
    expect(calls.filter((call) => call.action === "send_group_forward_msg").map((call) => call.body.group_id)).toEqual(["10001"]);
    expect(calls.filter((call) => call.action === "forward_group_single_msg").map((call) => call.body)).toEqual([
      { group_id: "10002", message_id: "9001" },
      { group_id: "10003", message_id: "9001" }
    ]);
    expect(calls.filter((call) => call.action === "send_group_msg").map((call) => call.body)).toEqual([
      { group_id: "10001", message: [{ type: "text", data: { text: "⬆️有来自announcements的新消息，请留意查看哦~" } }] },
      { group_id: "10002", message: [{ type: "text", data: { text: "⬆️有来自announcements的新消息，请留意查看哦~" } }] },
      { group_id: "10003", message: [{ type: "text", data: { text: "⬆️有来自announcements的新消息，请留意查看哦~" } }] }
    ]);
    expect(calls.map((call) => [call.action, call.body.group_id])).toEqual([
      ["send_group_forward_msg", "10001"],
      ["send_group_msg", "10001"],
      ["forward_group_single_msg", "10002"],
      ["send_group_msg", "10002"],
      ["forward_group_single_msg", "10003"],
      ["send_group_msg", "10003"]
    ]);
    expect(existsSync(mediaPath)).toBe(false);

    database.close();
  });

  it("retries a forwarded group notice without forwarding the same merged message twice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-fanout-"));
    const mediaPath = await writeCachedImage(directory, "markdown.png");
    const database = new AppDatabase(join(directory, "test.sqlite"));
    const service = createService(database, directory);
    let jobId = 0;
    let secondaryNoticeAttempts = 0;
    const calls = mockNapCatCalls((call) => {
      if (call.action === "send_group_forward_msg") {
        return okResponse({ message_id: "9001" });
      }
      if (call.action === "send_group_msg" && call.body.group_id === "10002") {
        secondaryNoticeAttempts += 1;
        if (secondaryNoticeAttempts === 1) {
          expect(getTarget(database, jobId, "10002")).toMatchObject({
            status: "pending",
            deliveryMethod: "forward",
            primaryMessageId: "9001",
            noticeSent: false
          });
          return failedResponse("notice blocked");
        }
      }
      return okResponse({});
    });

    jobId = database.createDeliveryJob(
      "m1",
      "source-1",
      "10001",
      createPayload(mediaPath, createFanout(["10001", "10002"], "10001"))
    );

    await service.processJobById(jobId);

    expect(database.getDeliveryJob(jobId)?.status).toBe("failed");
    expect(getTarget(database, jobId, "10002")).toMatchObject({
      status: "failed",
      deliveryMethod: "forward",
      primaryMessageId: "9001",
      noticeSent: false,
      forwardFailureCount: 0,
      lastError: "NapCat send_group_msg failed: notice blocked"
    });
    expect(calls.filter((call) => call.action === "forward_group_single_msg")).toHaveLength(1);
    expect(existsSync(mediaPath)).toBe(true);

    await service.processJobById(jobId);

    expect(database.getDeliveryJob(jobId)?.status).toBe("sent");
    expect(getTarget(database, jobId, "10002")).toMatchObject({
      status: "sent",
      deliveryMethod: "forward",
      primaryMessageId: "9001",
      noticeSent: true,
      forwardFailureCount: 0
    });
    expect(calls.filter((call) => call.action === "forward_group_single_msg")).toHaveLength(1);
    expect(calls.filter((call) => call.action === "send_group_msg" && call.body.group_id === "10002")).toHaveLength(2);
    expect(existsSync(mediaPath)).toBe(false);

    database.close();
  });

  it("does not process the same delivery job concurrently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-fanout-"));
    const mediaPath = await writeCachedImage(directory, "markdown.png");
    const database = new AppDatabase(join(directory, "test.sqlite"));
    const service = createService(database, directory);
    const forwardStarted = deferred<void>();
    const releaseForward = deferred<void>();
    const calls = mockNapCatCalls(async (call) => {
      if (call.action === "send_group_forward_msg") {
        forwardStarted.resolve();
        await releaseForward.promise;
        return okResponse({ message_id: "9001" });
      }
      return okResponse({});
    });

    const jobId = database.createDeliveryJob(
      "m1",
      "source-1",
      "10001",
      createPayload(mediaPath, createFanout(["10001", "10002"], "10001"))
    );

    const firstRun = service.processJobById(jobId);
    await forwardStarted.promise;
    const secondRun = service.processJobById(jobId);
    releaseForward.resolve();
    await Promise.all([firstRun, secondRun]);

    expect(database.getDeliveryJob(jobId)?.status).toBe("sent");
    expect(calls.filter((call) => call.action === "send_group_forward_msg")).toHaveLength(1);
    expect(calls.filter((call) => call.action === "forward_group_single_msg")).toHaveLength(1);
    expect(calls.filter((call) => call.action === "send_group_msg")).toHaveLength(2);
    expect(existsSync(mediaPath)).toBe(false);

    database.close();
  });

  it("retries group forwarding three times, then logs once and falls back to original send", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-fanout-"));
    const mediaPath = await writeCachedImage(directory, "markdown.png");
    const database = new AppDatabase(join(directory, "test.sqlite"));
    const service = createService(database, directory);
    let fallbackOriginalAttempts = 0;
    const calls = mockNapCatCalls((call) => {
      if (call.action === "forward_group_single_msg") {
        return failedResponse("forward blocked");
      }
      if (call.action === "send_group_forward_msg" && call.body.group_id === "10001") {
        return okResponse({ message_id: "9001" });
      }
      if (call.action === "send_group_forward_msg" && call.body.group_id === "10002") {
        fallbackOriginalAttempts += 1;
        if (fallbackOriginalAttempts === 1) {
          return failedResponse("upload blocked");
        }
        return okResponse({ message_id: "9002" });
      }
      return okResponse({});
    });

    const jobId = database.createDeliveryJob(
      "m1",
      "source-1",
      "10001",
      createPayload(mediaPath, createFanout(["10001", "10002"], "10001"))
    );

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await service.processJobById(jobId);
      const target = getTarget(database, jobId, "10002");
      expect(target.forwardFailureCount).toBe(attempt);
      expect(target.deliveryMethod).toBe("forward");
      expect(target.status).toBe("failed");
      expect(database.listEventLogs(20).filter((log) => log.message === "Falling back to original send after repeated group forward failures")).toHaveLength(0);
      expect(existsSync(mediaPath)).toBe(true);
    }

    await service.processJobById(jobId);

    const fallbackLogsAfterFailure = database
      .listEventLogs(20)
      .filter((log) => log.message === "Falling back to original send after repeated group forward failures");
    expect(fallbackLogsAfterFailure).toHaveLength(1);
    expect(fallbackLogsAfterFailure[0]?.metadata).toMatchObject({
      discordMessageId: "m1",
      sourceId: "source-1",
      primaryGroupId: "10001",
      targetGroupId: "10002",
      primaryMessageId: "9001",
      forwardFailureCount: 3,
      lastError: "NapCat forward_group_single_msg failed: forward blocked"
    });
    expect(getTarget(database, jobId, "10002").fallbackLogged).toBe(true);
    expect(existsSync(mediaPath)).toBe(true);

    await service.processJobById(jobId);

    const finalJob = database.getDeliveryJob(jobId);
    expect(finalJob?.status).toBe("sent");
    expect(getTarget(database, jobId, "10002")).toMatchObject({
      status: "sent",
      deliveryMethod: "original",
      forwardFailureCount: 3,
      fallbackLogged: true
    });
    expect(database.listEventLogs(30).filter((log) => log.message === "Falling back to original send after repeated group forward failures")).toHaveLength(1);
    expect(calls.filter((call) => call.action === "forward_group_single_msg")).toHaveLength(3);
    expect(calls.filter((call) => call.action === "send_group_forward_msg").map((call) => call.body.group_id)).toEqual([
      "10001",
      "10002",
      "10002"
    ]);
    expect(existsSync(mediaPath)).toBe(false);

    database.close();
  });

  it("keeps legacy single-group jobs working and cleans their local media after success", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-legacy-"));
    const mediaPath = await writeCachedImage(directory, "markdown.png");
    const database = new AppDatabase(join(directory, "test.sqlite"));
    const service = createService(database, directory);
    const calls = mockNapCatCalls(() => okResponse({ message_id: "7001" }));
    const payload = createPayload(mediaPath);

    const jobId = database.createDeliveryJob("m1", "source-1", "10001", payload);

    await service.processJobById(jobId);

    expect(database.getDeliveryJob(jobId)?.status).toBe("sent");
    expect(calls.filter((call) => call.action === "send_group_forward_msg").map((call) => call.body.group_id)).toEqual(["10001"]);
    expect(calls.some((call) => call.action === "forward_group_single_msg")).toBe(false);
    expect(calls.filter((call) => call.action === "send_group_msg").map((call) => call.body)).toEqual([
      { group_id: "10001", message: [{ type: "text", data: { text: "⬆️有来自announcements的新消息，请留意查看哦~" } }] }
    ]);
    expect(existsSync(mediaPath)).toBe(false);

    database.close();
  });
});

function createService(database: AppDatabase, mediaCacheDir: string) {
  const config = loadConfig({
    NAPCAT_ENDPOINT: "http://127.0.0.1:3000",
    MEDIA_CACHE_DIR: mediaCacheDir,
    SQLITE_PATH: join(mediaCacheDir, "test.sqlite"),
    JOB_RETRY_BASE_SECONDS: "1",
    JOB_RETRY_MAX_SECONDS: "1"
  });

  return new DeliveryService({
    config,
    database,
    bridgeNoticeDelayMs: 0,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined
    }
  });
}

async function writeCachedImage(directory: string, filename: string) {
  const filePath = join(directory, filename);
  await writeFile(filePath, Buffer.from("image"));
  return filePath;
}

function createPayload(filePath: string, fanout?: FanoutDeliveryState): PreparedBridgePayload {
  return {
    message: {
      id: "m1",
      guildId: "g1",
      channelId: "c1",
      channelName: "announcements",
      threadId: null,
      threadName: null,
      sourceId: "source-1",
      sourceName: "announcements",
      authorId: "u1",
      authorName: "Alice",
      authorAvatarUrl: null,
      createdAt: new Date(0).toISOString(),
      rawMarkdown: "**hello**",
      text: "hello",
      images: []
    },
    translatedText: null,
    translatedImage: null,
    markdownImage: {
      attachmentId: "markdown-m1",
      filename: "markdown.png",
      mimeType: "image/png",
      filePath,
      size: 5,
      width: 1,
      height: 1
    },
    images: [],
    localFilePaths: [filePath],
    ...(fanout ? { fanout } : {})
  };
}

function createFanout(targetGroupIds: string[], primaryGroupId: string): FanoutDeliveryState {
  return {
    targetGroupIds,
    primaryGroupId,
    primaryMessageId: null,
    targets: targetGroupIds.map((groupId) => ({
      groupId,
      status: "pending",
      deliveryMethod: groupId === primaryGroupId ? "primary" : "forward",
      primaryMessageId: null,
      noticeSent: false,
      forwardFailureCount: 0,
      fallbackLogged: false,
      lastError: null,
      sentAt: null
    }))
  };
}

function getTarget(database: AppDatabase, jobId: number, groupId: string) {
  const target = database.getDeliveryJob(jobId)?.payload.fanout?.targets.find((candidate) => candidate.groupId === groupId);
  expect(target).toBeDefined();
  return target!;
}

function mockNapCatCalls(handler: (call: ApiCall) => Response | Promise<Response>) {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const action = String(url).split("/").pop() ?? "";
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      const call = { action, body };
      calls.push(call);
      return handler(call);
    })
  );
  return calls;
}

function deferred<T = void>() {
  let resolve!: (value?: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function okResponse(data: Record<string, unknown>) {
  return new Response(JSON.stringify({ retcode: 0, data }), { status: 200 });
}

function failedResponse(wording: string) {
  return new Response(JSON.stringify({ retcode: 1, wording }), { status: 200 });
}
