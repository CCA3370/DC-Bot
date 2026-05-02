import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildForwardNodes } from "../src/napcat/napcatClient.js";
import type { PreparedBridgePayload } from "../src/shared/types.js";

describe("buildForwardNodes", () => {
  it("sends translated text, markdown image, then attachment images without original text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-napcat-"));
    const markdown = join(directory, "markdown.png");
    const first = join(directory, "first.png");
    const second = join(directory, "second.png");
    await writeFile(markdown, Buffer.from("markdown"));
    await writeFile(first, Buffer.from("first"));
    await writeFile(second, Buffer.from("second"));

    const payload: PreparedBridgePayload = {
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
        createdAt: new Date(0).toISOString(),
        rawMarkdown: "**hello**",
        text: "hello",
        images: []
      },
      translatedText: "你好",
      markdownImage: {
        attachmentId: "markdown-m1",
        filename: "markdown.png",
        mimeType: "image/png",
        filePath: markdown,
        size: 8,
        width: 1,
        height: 1
      },
      images: [
        {
          attachmentId: "a1",
          filename: "first.png",
          mimeType: "image/png",
          filePath: first,
          size: 5,
          width: 1,
          height: 1
        },
        {
          attachmentId: "a2",
          filename: "second.png",
          mimeType: "image/png",
          filePath: second,
          size: 6,
          width: 1,
          height: 1
        }
      ]
    };

    const nodes = await buildForwardNodes(payload);

    expect(nodes).toHaveLength(3);
    expect(nodes[0]?.data.content).toEqual([{ type: "text", data: { text: "你好" } }]);
    expect(nodes[1]?.data.content).toHaveLength(1);
    expect(nodes[1]?.data.content[0]?.type).toBe("image");
    expect(nodes[2]?.data.content).toHaveLength(2);
    expect(nodes[2]?.data.content.every((segment) => segment.type === "image")).toBe(true);
    expect(JSON.stringify(nodes)).not.toContain("hello");
  });

  it("does not create a text node when translation is unavailable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-napcat-"));
    const markdown = join(directory, "markdown.png");
    await writeFile(markdown, Buffer.from("markdown"));

    const payload: PreparedBridgePayload = {
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
        createdAt: new Date(0).toISOString(),
        rawMarkdown: "**hello**",
        text: "hello",
        images: []
      },
      translatedText: null,
      markdownImage: {
        attachmentId: "markdown-m1",
        filename: "markdown.png",
        mimeType: "image/png",
        filePath: markdown,
        size: 8,
        width: 1,
        height: 1
      },
      images: []
    };

    const nodes = await buildForwardNodes(payload);

    expect(nodes).toHaveLength(1);
    expect(nodes[0]?.data.content[0]?.type).toBe("image");
    expect(JSON.stringify(nodes)).not.toContain("hello");
  });
});
