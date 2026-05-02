import { readFile } from "node:fs/promises";
import MarkdownIt from "markdown-it";
import type { AppConfig } from "../shared/config.js";
import type { NapCatGroup, PreparedBridgePayload, ProcessedImageAsset } from "../shared/types.js";

export type OneBotMessageSegment =
  | { type: "text"; data: { text: string } }
  | { type: "image"; data: { file: string } };

export interface OneBotForwardNode {
  type: "node";
  data: {
    name: string;
    uin: string;
    content: OneBotMessageSegment[];
  };
}

interface OneBotResponse {
  status?: string;
  retcode?: number;
  msg?: string;
  wording?: string;
  data?: unknown;
}

interface OneBotGroupRow {
  group_id?: number | string;
  group_name?: string;
  member_count?: number;
  max_member_count?: number;
}

const linkMarkdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

export class NapCatClient {
  constructor(private config: AppConfig["napcat"]) {}

  getConfig() {
    return { ...this.config };
  }

  updateConfig(config: AppConfig["napcat"]) {
    this.config = { ...config };
  }

  async sendPreparedMessage(groupId: string, payload: PreparedBridgePayload): Promise<string> {
    const messages = await buildForwardNodes(payload);
    if (messages.length === 0) {
      throw new Error("Prepared QQ forward message has no nodes to send");
    }

    const data = await this.callApi("send_group_forward_msg", {
      group_id: groupId,
      messages
    });
    return parseMessageId(data, "send_group_forward_msg");
  }

  async sendBridgeNotice(groupId: string, sourceName: string) {
    await this.sendGroupText(groupId, buildBridgeNoticeText(sourceName));
  }

  async forwardGroupSingleMessage(groupId: string, messageId: string) {
    await this.callApi("forward_group_single_msg", {
      group_id: groupId,
      message_id: messageId
    });
  }

  async testConnection() {
    await this.callApi("get_status", {});
  }

  async listGroups(): Promise<NapCatGroup[]> {
    const data = await this.callApi("get_group_list", { no_cache: true });
    if (!Array.isArray(data)) {
      throw new Error("NapCat get_group_list returned an invalid response");
    }

    return data.map(parseGroupRow).sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
  }

  async sendGroupText(groupId: string, text: string) {
    await this.callApi("send_group_msg", {
      group_id: groupId,
      message: [{ type: "text", data: { text } }]
    });
  }

  private async callApi(action: string, payload: Record<string, unknown>) {
    const response = await fetch(`${this.config.endpoint}/${action}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.config.accessToken ? { authorization: `Bearer ${this.config.accessToken}` } : {})
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      throw new Error(`NapCat ${action} failed with HTTP ${response.status}`);
    }

    const body = (await response.json()) as OneBotResponse;
    if (typeof body.retcode === "number" && body.retcode !== 0) {
      throw new Error(`NapCat ${action} failed: ${body.wording ?? body.msg ?? body.retcode}`);
    }

    return body.data;
  }
}

export function buildBridgeNoticeText(sourceName: string) {
  const normalized = sourceName.trim();
  if (normalized.length === 0) {
    return "⬆️有新的 Discord 消息，请留意查看哦~";
  }

  return `⬆️有来自${normalized}的新消息，请留意查看哦~`;
}

function parseGroupRow(row: unknown): NapCatGroup {
  const group = row as OneBotGroupRow;
  const groupId = group.group_id === undefined ? "" : String(group.group_id);
  if (!/^\d+$/.test(groupId)) {
    throw new Error("NapCat get_group_list returned a group without a valid group_id");
  }

  return {
    groupId,
    name: group.group_name?.trim() || groupId,
    memberCount: typeof group.member_count === "number" ? group.member_count : null,
    maxMemberCount: typeof group.max_member_count === "number" ? group.max_member_count : null
  };
}

function parseMessageId(data: unknown, action: string) {
  if (!data || typeof data !== "object" || !("message_id" in data)) {
    throw new Error(`NapCat ${action} did not return data.message_id`);
  }

  const messageId = (data as { message_id?: unknown }).message_id;
  if (typeof messageId !== "string" && typeof messageId !== "number") {
    throw new Error(`NapCat ${action} returned an invalid data.message_id`);
  }

  const normalized = String(messageId).trim();
  if (normalized.length === 0) {
    throw new Error(`NapCat ${action} returned an empty data.message_id`);
  }

  return normalized;
}

export async function buildForwardNodes(payload: PreparedBridgePayload): Promise<OneBotForwardNode[]> {
  const nodes: OneBotForwardNode[] = [];
  const senderName = buildForwardNodeSenderName(payload);

  if (payload.translatedImage) {
    nodes.push({
      type: "node",
      data: {
        name: senderName,
        uin: "10000",
        content: [await buildImageSegment(payload.translatedImage)]
      }
    });
  }

  if (payload.markdownImage) {
    nodes.push({
      type: "node",
      data: {
        name: senderName,
        uin: "10000",
        content: [await buildImageSegment(payload.markdownImage)]
      }
    });
  }

  if (payload.images.length > 0) {
    const content: OneBotMessageSegment[] = [];
    for (const image of payload.images) {
      content.push(await buildImageSegment(image));
    }

    nodes.push({
      type: "node",
      data: {
        name: senderName,
        uin: "10000",
        content
      }
    });
  }

  const originalLinksText = buildOriginalLinksText(payload.message.rawMarkdown);
  if (originalLinksText) {
    nodes.push({
      type: "node",
      data: {
        name: senderName,
        uin: "10000",
        content: [{ type: "text", data: { text: originalLinksText } }]
      }
    });
  }

  return nodes;
}

export function extractOriginalLinks(rawMarkdown: string) {
  const links: string[] = [];
  const seen = new Set<string>();
  const collect = (tokens: ReturnType<typeof linkMarkdown.parse>) => {
    for (const token of tokens) {
      if (token.type === "link_open") {
        const href = token.attrGet("href")?.trim();
        if (href && /^https?:\/\//i.test(href) && !seen.has(href)) {
          seen.add(href);
          links.push(href);
        }
      }

      if (token.type === "image") {
        const src = token.attrGet("src")?.trim();
        if (src && /^https?:\/\//i.test(src) && !seen.has(src)) {
          seen.add(src);
          links.push(src);
        }
      }

      if (token.children) {
        collect(token.children);
      }
    }
  };

  collect(linkMarkdown.parse(rawMarkdown, {}));
  return links;
}

export function buildOriginalLinksText(rawMarkdown: string) {
  const links = extractOriginalLinks(rawMarkdown);
  if (links.length === 0) {
    return null;
  }

  return ["原文链接：", ...links.map((link, index) => `${index + 1}. ${link}`)].join("\n");
}

function buildForwardNodeSenderName(payload: PreparedBridgePayload) {
  const authorName = payload.message.authorName.trim();
  if (authorName.length > 0) {
    return authorName;
  }

  const sourceName = payload.message.sourceName.trim();
  return sourceName.length > 0 ? sourceName : "Discord";
}

async function buildImageSegment(image: ProcessedImageAsset): Promise<OneBotMessageSegment> {
  const file = await readFile(image.filePath);
  return {
    type: "image",
    data: {
      file: `base64://${file.toString("base64")}`
    }
  };
}
