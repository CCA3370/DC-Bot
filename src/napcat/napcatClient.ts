import { readFile } from "node:fs/promises";
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

export class NapCatClient {
  constructor(private config: AppConfig["napcat"]) {}

  getConfig() {
    return { ...this.config };
  }

  updateConfig(config: AppConfig["napcat"]) {
    this.config = { ...config };
  }

  async sendPreparedMessage(groupId: string, payload: PreparedBridgePayload) {
    const messages = await buildForwardNodes(payload);
    if (messages.length === 0) {
      return;
    }

    await this.callApi("send_group_forward_msg", {
      group_id: groupId,
      messages
    });

    await this.callApi("send_group_msg", {
      group_id: groupId,
      message: [{ type: "text", data: { text: `⬆️有来自${payload.message.sourceName}的新消息，请留意查看哦~` } }]
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

export async function buildForwardNodes(payload: PreparedBridgePayload): Promise<OneBotForwardNode[]> {
  const nodes: OneBotForwardNode[] = [];

  if (payload.translatedImage) {
    nodes.push({
      type: "node",
      data: {
        name: payload.message.authorName,
        uin: "10000",
        content: [await buildImageSegment(payload.translatedImage)]
      }
    });
  }

  if (payload.markdownImage) {
    nodes.push({
      type: "node",
      data: {
        name: payload.message.sourceName,
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
        name: payload.message.sourceName,
        uin: "10000",
        content
      }
    });
  }

  return nodes;
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
