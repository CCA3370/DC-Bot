import { ChannelType, MessageType, type Message } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { normalizeDiscordMessage } from "../src/discord/messageNormalizer.js";

describe("normalizeDiscordMessage", () => {
  it("includes the real Discord author avatar URL", () => {
    const displayAvatarURL = vi.fn(() => "https://cdn.discordapp.com/avatars/u1/avatar.png?size=128");
    const message = {
      id: "m1",
      guildId: "g1",
      type: MessageType.Default,
      content: "hello",
      attachments: new Map(),
      channel: {
        id: "c1",
        name: "announcements",
        type: ChannelType.GuildText,
        guild: { id: "g1" },
        isThread: () => false
      },
      mentions: {
        users: new Map(),
        channels: new Map(),
        roles: new Map()
      },
      author: {
        id: "u1",
        username: "alice",
        globalName: "Alice",
        displayAvatarURL
      },
      member: {
        displayName: "Alice In Server"
      },
      createdAt: new Date(0)
    } as unknown as Message<true>;

    const normalized = normalizeDiscordMessage(message, "g1");

    expect(displayAvatarURL).toHaveBeenCalledWith({ extension: "png", size: 128 });
    expect(normalized?.authorAvatarUrl).toBe("https://cdn.discordapp.com/avatars/u1/avatar.png?size=128");
  });
});
