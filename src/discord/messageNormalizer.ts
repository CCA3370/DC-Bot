import {
  ChannelType,
  type Attachment,
  type GuildBasedChannel,
  type GuildTextBasedChannel,
  type Message,
  MessageType,
  type ThreadChannel
} from "discord.js";
import { markdownToPlainText, type MentionLookup } from "./markdownToPlainText.js";
import type { DiscordSource, NormalizedDiscordMessage, NormalizedImageAttachment } from "../shared/types.js";

const imageExtensions = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

export function normalizeDiscordMessage(message: Message<true>, guildId: string): NormalizedDiscordMessage | null {
  if (message.guildId !== guildId) {
    return null;
  }

  if (message.type !== MessageType.Default && message.type !== MessageType.Reply) {
    return null;
  }

  const images = [...message.attachments.values()].filter(isDiscordImageAttachment).map(normalizeImageAttachment);
  if (message.content.trim().length === 0 && images.length === 0) {
    return null;
  }

  const source = getMessageSource(message.channel);
  if (!source) {
    return null;
  }

  const lookup = buildMentionLookup(message);
  return {
    id: message.id,
    guildId: message.guildId,
    channelId: source.type === "thread" ? source.parentId ?? source.id : source.id,
    channelName: source.type === "thread" ? getParentName(message.channel) ?? source.name : source.name,
    threadId: source.type === "thread" ? source.id : null,
    threadName: source.type === "thread" ? source.name : null,
    sourceId: source.id,
    sourceName: source.name,
    authorId: message.author.id,
    authorName: message.member?.displayName ?? message.author.globalName ?? message.author.username,
    createdAt: message.createdAt.toISOString(),
    rawMarkdown: message.content,
    text: markdownToPlainText(message.content, lookup),
    images
  };
}

export function isDiscordImageAttachment(attachment: Pick<Attachment, "contentType" | "name" | "size">) {
  if (attachment.size <= 0) {
    return false;
  }

  const contentType = attachment.contentType?.toLowerCase();
  if (contentType?.startsWith("image/") && contentType !== "image/svg+xml") {
    return true;
  }

  const filename = attachment.name.toLowerCase();
  return [...imageExtensions].some((extension) => filename.endsWith(extension));
}

export function collectDiscordSources(channels: Iterable<GuildBasedChannel>): DiscordSource[] {
  const sources: DiscordSource[] = [];
  const seen = new Set<string>();

  for (const channel of channels) {
    const source = getSourceFromGuildChannel(channel);
    if (source && !seen.has(source.id)) {
      sources.push(source);
      seen.add(source.id);
    }

    if (hasThreadCache(channel)) {
      for (const thread of channel.threads.cache.values()) {
        const threadSource = getThreadSource(thread);
        if (!seen.has(threadSource.id)) {
          sources.push(threadSource);
          seen.add(threadSource.id);
        }
      }
    }
  }

  return sources;
}

export function getMessageSource(channel: GuildTextBasedChannel): DiscordSource | null {
  if (channel.isThread()) {
    return getThreadSource(channel);
  }

  return getSourceFromGuildChannel(channel);
}

function normalizeImageAttachment(attachment: Attachment): NormalizedImageAttachment {
  return {
    id: attachment.id,
    url: attachment.url,
    proxyUrl: attachment.proxyURL,
    filename: attachment.name,
    contentType: attachment.contentType ?? "application/octet-stream",
    size: attachment.size,
    width: attachment.width,
    height: attachment.height
  };
}

function getSourceFromGuildChannel(channel: GuildBasedChannel | GuildTextBasedChannel): DiscordSource | null {
  if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
    return null;
  }

  return {
    id: channel.id,
    parentId: null,
    guildId: channel.guild.id,
    name: channel.name,
    type: "channel",
    isActive: true
  };
}

export function getThreadSource(thread: ThreadChannel): DiscordSource {
  return {
    id: thread.id,
    parentId: thread.parentId,
    guildId: thread.guild.id,
    name: thread.name,
    type: "thread",
    isActive: true
  };
}

function getParentName(channel: GuildTextBasedChannel) {
  if (!channel.isThread()) {
    return null;
  }
  return channel.parent?.name ?? null;
}

function hasThreadCache(channel: GuildBasedChannel): channel is GuildBasedChannel & {
  threads: { cache: Map<string, ThreadChannel> };
} {
  return "threads" in channel && typeof channel.threads === "object" && channel.threads !== null && "cache" in channel.threads;
}

function buildMentionLookup(message: Message<true>): MentionLookup {
  return {
    users: new Map([...message.mentions.users.entries()].map(([id, user]) => [id, user.globalName ?? user.username])),
    channels: new Map(
      [...message.mentions.channels.entries()].flatMap(([id, channel]) =>
        "name" in channel ? ([[id, channel.name]] as Array<[string, string]>) : []
      )
    ),
    roles: new Map([...message.mentions.roles.entries()].map(([id, role]) => [id, role.name]))
  };
}
