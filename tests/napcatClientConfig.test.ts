import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildBridgeNoticeText, NapCatClient } from "../src/napcat/napcatClient.js";
import type { PreparedBridgePayload } from "../src/shared/types.js";

describe("NapCatClient runtime config", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses updated endpoint and access token for subsequent calls", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ retcode: 0, data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new NapCatClient({
      endpoint: "http://127.0.0.1:3000",
      accessToken: "old-token"
    });

    await client.testConnection();
    client.updateConfig({
      endpoint: "http://127.0.0.1:3001",
      accessToken: "new-token"
    });
    await client.testConnection();

    const firstRequest = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    const secondRequest = fetchMock.mock.calls[1]?.[1] as RequestInit | undefined;

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/get_status");
    expect((firstRequest?.headers as Record<string, string>).authorization).toBe("Bearer old-token");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("http://127.0.0.1:3001/get_status");
    expect((secondRequest?.headers as Record<string, string>).authorization).toBe("Bearer new-token");
  });

  it("loads and normalizes the current QQ group list", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            retcode: 0,
            data: [
              { group_id: 10002, group_name: "Beta", member_count: 12, max_member_count: 200 },
              { group_id: "10001", group_name: "Alpha" }
            ]
          }),
          { status: 200 }
        )
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new NapCatClient({
      endpoint: "http://127.0.0.1:3000",
      accessToken: ""
    });

    await expect(client.listGroups()).resolves.toEqual([
      { groupId: "10001", name: "Alpha", memberCount: null, maxMemberCount: null },
      { groupId: "10002", name: "Beta", memberCount: 12, maxMemberCount: 200 }
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/get_group_list");
  });

  it("returns the message_id from send_group_forward_msg without sending the notice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-napcat-client-"));
    const markdown = join(directory, "markdown.png");
    await writeFile(markdown, Buffer.from("markdown"));

    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { group_id?: string };
      if (body.group_id === "10001") {
        return new Response(JSON.stringify({ retcode: 0, data: { message_id: 12345 } }), { status: 200 });
      }
      return new Response(JSON.stringify({ retcode: 0, data: {} }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = new NapCatClient({
      endpoint: "http://127.0.0.1:3000",
      accessToken: ""
    });

    await expect(client.sendPreparedMessage("10001", createPayload(markdown))).resolves.toBe("12345");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/send_group_forward_msg");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects send_group_forward_msg responses without a message_id", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-napcat-client-"));
    const markdown = join(directory, "markdown.png");
    await writeFile(markdown, Buffer.from("markdown"));

    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ retcode: 0, data: {} }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new NapCatClient({
      endpoint: "http://127.0.0.1:3000",
      accessToken: ""
    });

    await expect(client.sendPreparedMessage("10001", createPayload(markdown))).rejects.toThrow(
      "NapCat send_group_forward_msg did not return data.message_id"
    );
  });

  it("forwards a primary group message to another group through forward_group_single_msg", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ retcode: 0, data: {} }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new NapCatClient({
      endpoint: "http://127.0.0.1:3000",
      accessToken: ""
    });

    await client.forwardGroupSingleMessage("10002", "67890");

    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://127.0.0.1:3000/forward_group_single_msg");
    expect(JSON.parse(String((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.body))).toEqual({
      group_id: "10002",
      message_id: "67890"
    });
  });

  it("normalizes bridge notice sender names", () => {
    expect(buildBridgeNoticeText(" Alice ")).toBe("⬆️有来自Alice的新消息，请留意查看哦~");
    expect(buildBridgeNoticeText("   ")).toBe("⬆️有新的 Discord 消息，请留意查看哦~");
  });
});

function createPayload(markdownPath: string): PreparedBridgePayload {
  return {
    message: {
      id: "m1",
      guildId: "g1",
      channelId: "c1",
      channelName: "announcements",
      threadId: null,
      threadName: null,
      sourceId: "c1",
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
      filePath: markdownPath,
      size: 8,
      width: 1,
      height: 1
    },
    images: []
  };
}
