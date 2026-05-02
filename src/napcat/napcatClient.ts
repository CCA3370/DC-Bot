import { readFile } from "node:fs/promises";
import type { AppConfig } from "../shared/config.js";
import type { PreparedBridgePayload } from "../shared/types.js";

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

export class NapCatClient {
  constructor(private readonly config: AppConfig["napcat"]) {}

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

export async function buildForwardNodes(payload: PreparedBridgePayload): Promise<OneBotForwardNode[]> {
  const nodes: OneBotForwardNode[] = [];
  const text = payload.message.text.trim();

  if (text.length > 0) {
    nodes.push({
      type: "node",
      data: {
        name: payload.message.authorName,
        uin: "10000",
        content: [{ type: "text", data: { text } }]
      }
    });
  }

  if (payload.images.length > 0) {
    const content: OneBotMessageSegment[] = [];
    for (const image of payload.images) {
      const file = await readFile(image.filePath);
      content.push({
        type: "image",
        data: {
          file: `base64://${file.toString("base64")}`
        }
      });
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
