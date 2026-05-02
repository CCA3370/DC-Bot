export type DiscordSourceType = "channel" | "thread";

export interface DiscordSource {
  id: string;
  parentId: string | null;
  guildId: string;
  name: string;
  type: DiscordSourceType;
  isActive: boolean;
}

export interface NormalizedImageAttachment {
  id: string;
  url: string;
  proxyUrl: string | null;
  filename: string;
  contentType: string;
  size: number;
  width: number | null;
  height: number | null;
}

export interface NormalizedDiscordMessage {
  id: string;
  guildId: string;
  channelId: string;
  channelName: string;
  threadId: string | null;
  threadName: string | null;
  sourceId: string;
  sourceName: string;
  authorId: string;
  authorName: string;
  createdAt: string;
  text: string;
  images: NormalizedImageAttachment[];
}

export interface QqGroup {
  id: number;
  groupId: string;
  name: string;
  isActive: boolean;
}
