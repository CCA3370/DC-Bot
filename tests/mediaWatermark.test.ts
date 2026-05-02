import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { addWatermark } from "../src/media/imageProcessor.js";

describe("addWatermark", () => {
  it("preserves image dimensions while adding a watermark overlay", async () => {
    const input = await sharp({
      create: {
        width: 320,
        height: 180,
        channels: 3,
        background: "#2e7d5b"
      }
    })
      .png()
      .toBuffer();

    const output = await addWatermark(input, "#announcements");
    const metadata = await sharp(output.buffer).metadata();

    expect(output.width).toBe(320);
    expect(output.height).toBe(180);
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(180);
  });
});
