import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildForwardNodes, buildOriginalLinksText, extractOriginalLinks } from "../src/napcat/napcatClient.js";
import type { PreparedBridgePayload } from "../src/shared/types.js";

describe("buildForwardNodes", () => {
  it("sends translated image, markdown image, then attachment images without text nodes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-napcat-"));
    const translation = join(directory, "translation.png");
    const markdown = join(directory, "markdown.png");
    const first = join(directory, "first.png");
    const second = join(directory, "second.png");
    await writeFile(translation, Buffer.from("translation"));
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
        authorAvatarUrl: null,
        createdAt: new Date(0).toISOString(),
        rawMarkdown: "**hello**",
        text: "hello",
        images: []
      },
      translatedText: "你好",
      translatedImage: {
        attachmentId: "translation-m1",
        filename: "translation.png",
        mimeType: "image/png",
        filePath: translation,
        size: 11,
        width: 1,
        height: 1
      },
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
    expect(nodes[0]?.data.content).toHaveLength(1);
    expect(nodes[0]?.data.content[0]?.type).toBe("image");
    expect(nodes[1]?.data.content).toHaveLength(1);
    expect(nodes[1]?.data.content[0]?.type).toBe("image");
    expect(nodes[2]?.data.content).toHaveLength(2);
    expect(nodes[2]?.data.content.every((segment) => segment.type === "image")).toBe(true);
    expect(nodes.map((node) => node.data.name)).toEqual(["Alice", "Alice", "Alice"]);
    expect(JSON.stringify(nodes)).not.toContain("hello");
    expect(JSON.stringify(nodes)).not.toContain("你好");
    expect(nodes.flatMap((node) => node.data.content).some((segment) => segment.type === "text")).toBe(false);
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

  it("appends original links as the final merged-forward text node", async () => {
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
        authorAvatarUrl: null,
        createdAt: new Date(0).toISOString(),
        rawMarkdown: [
          "[Download](https://hotstart.net/wiki/CL650/Passenger_Edition)",
          "bare https://example.com/release",
          "again https://example.com/release",
          "![preview](https://example.com/preview.png)"
        ].join("\n"),
        text: "hello",
        images: []
      },
      translatedText: null,
      translatedImage: null,
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

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data.content[0]?.type).toBe("image");
    expect(nodes.map((node) => node.data.name)).toEqual(["Alice", "Alice"]);
    expect(nodes[1]?.data.content).toEqual([
      {
        type: "text",
        data: {
          text: [
            "原文链接：",
            "1. https://hotstart.net/wiki/CL650/Passenger_Edition",
            "2. https://example.com/release",
            "3. https://example.com/preview.png"
          ].join("\n")
        }
      }
    ]);
  });

  it("extracts original markdown links in order without duplicates", () => {
    const rawMarkdown = [
      "[Download](https://hotstart.net/wiki/CL650/Passenger_Edition)",
      "bare https://example.com/release",
      "again https://example.com/release",
      "![preview](https://example.com/preview.png)"
    ].join("\n");

    expect(extractOriginalLinks(rawMarkdown)).toEqual([
      "https://hotstart.net/wiki/CL650/Passenger_Edition",
      "https://example.com/release",
      "https://example.com/preview.png"
    ]);
    expect(buildOriginalLinksText("plain text only")).toBeNull();
  });

  it("falls back to the Discord source when the author name is blank", async () => {
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
        authorName: "   ",
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
        filePath: markdown,
        size: 8,
        width: 1,
        height: 1
      },
      images: []
    };

    const nodes = await buildForwardNodes(payload);

    expect(nodes.map((node) => node.data.name)).toEqual(["announcements"]);
  });
});
