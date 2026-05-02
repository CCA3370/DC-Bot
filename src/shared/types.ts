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
  rawMarkdown: string;
  text: string;
  images: NormalizedImageAttachment[];
}

export interface QqGroup {
  id: number;
  groupId: string;
  name: string;
  isActive: boolean;
}

export interface NapCatGroup {
  groupId: string;
  name: string;
  memberCount: number | null;
  maxMemberCount: number | null;
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface EventLogEntry {
  id: number;
  level: LogLevel;
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface RouteTarget {
  routeId: number;
  sourceId: string;
  qqGroupId: number;
  groupId: string;
  groupName: string;
}

export interface ChannelRouteView {
  id: number;
  sourceId: string;
  sourceName: string | null;
  sourceType: DiscordSourceType | null;
  qqGroupId: number;
  groupId: string;
  groupName: string;
  isActive: boolean;
}

export interface DeliveryStats {
  pending: number;
  failed: number;
  sent: number;
}

export type DeliveryJobStatus = "pending" | "sent" | "failed";

export interface DeliveryJob {
  id: number;
  discordMessageId: string;
  sourceId: string;
  qqGroupId: string;
  status: DeliveryJobStatus;
  payload: PreparedBridgePayload;
  errorMessage: string | null;
  attemptCount: number;
  nextAttemptAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProcessedImageAsset {
  attachmentId: string;
  filename: string;
  mimeType: "image/png";
  filePath: string;
  size: number;
  width: number;
  height: number;
}

export interface PreparedBridgePayload {
  message: NormalizedDiscordMessage;
  translatedText: string | null;
  markdownImage: ProcessedImageAsset | null;
  images: ProcessedImageAsset[];
}
