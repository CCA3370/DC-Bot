import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildForwardNodes } from "../src/napcat/napcatClient.js";
import type { PreparedBridgePayload } from "../src/shared/types.js";

describe("buildForwardNodes", () => {
  it("keeps text in a separate node and combines all images in one image node", async () => {
    const directory = await mkdtemp(join(tmpdir(), "dc-bot-napcat-"));
    const first = join(directory, "first.png");
    const second = join(directory, "second.png");
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
        text: "hello",
        images: []
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

    expect(nodes).toHaveLength(2);
    expect(nodes[0]?.data.content).toEqual([{ type: "text", data: { text: "hello" } }]);
    expect(nodes[1]?.data.content).toHaveLength(2);
    expect(nodes[1]?.data.content.every((segment) => segment.type === "image")).toBe(true);
  });
});
