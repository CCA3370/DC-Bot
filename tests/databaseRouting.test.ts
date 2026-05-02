import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AppDatabase } from "../src/shared/database.js";
import type { PreparedBridgePayload } from "../src/shared/types.js";

describe("AppDatabase routing and delivery jobs", () => {
  it("routes configured Discord sources to active QQ groups and tracks retry state", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-db-"));
    const database = new AppDatabase(join(directory, "test.sqlite"));

    database.setSetting("discord.guild_id", "123456789012345678");
    expect(database.getSetting("discord.guild_id")).toBe("123456789012345678");

    database.upsertDiscordChannels([
      {
        id: "discord-channel-1",
        guildId: "guild-1",
        parentId: null,
        name: "announcements",
        type: "channel",
        isActive: true
      }
    ]);
    database.upsertQqGroup("123456", "Ops");
    const [group] = database.listQqGroups();
    expect(group).toBeDefined();

    database.upsertChannelRoute("discord-channel-1", group!.id);
    expect(database.listActiveRoutesForSource("discord-channel-1")).toEqual([
      {
        routeId: 1,
        sourceId: "discord-channel-1",
        qqGroupId: group!.id,
        groupId: "123456",
        groupName: "Ops"
      }
    ]);

    const payload: PreparedBridgePayload = {
      message: {
        id: "message-1",
        guildId: "guild-1",
        channelId: "discord-channel-1",
        channelName: "announcements",
        threadId: null,
        threadName: null,
        sourceId: "discord-channel-1",
        sourceName: "announcements",
        authorId: "author-1",
        authorName: "Alice",
        createdAt: new Date(0).toISOString(),
        rawMarkdown: "hello",
        text: "hello",
        images: []
      },
      translatedText: null,
      markdownImage: null,
      images: []
    };

    const jobId = database.createDeliveryJob("message-1", "discord-channel-1", "123456", payload);
    expect(database.getDeliveryStats()).toEqual({ pending: 1, failed: 0, sent: 0 });

    database.markDeliveryJobFailed(jobId, "NapCat offline", new Date(Date.now() + 1000).toISOString());
    expect(database.getDeliveryStats()).toEqual({ pending: 0, failed: 1, sent: 0 });
    expect(database.getDeliveryJob(jobId)?.attemptCount).toBe(1);

    database.markDeliveryJobSent(jobId);
    expect(database.getDeliveryStats()).toEqual({ pending: 0, failed: 0, sent: 1 });

    database.close();
  });
});
