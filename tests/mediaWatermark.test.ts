import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { addWatermark, buildImageWatermarkText, fitImageWatermarkText } from "../src/media/imageProcessor.js";

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

    const output = await addWatermark(input, "Alice");
    const metadata = await sharp(output.buffer).metadata();

    expect(output.width).toBe(320);
    expect(output.height).toBe(180);
    expect(metadata.width).toBe(320);
    expect(metadata.height).toBe(180);
  });

  it("keeps the lower-right image background transparent around the watermark text", async () => {
    const background = { r: 46, g: 125, b: 91 };
    const input = await sharp({
      create: {
        width: 360,
        height: 200,
        channels: 3,
        background
      }
    })
      .png()
      .toBuffer();

    const output = await addWatermark(input, "Alice");
    const pixels = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const metadata = await sharp(output.buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    expect(readPixel(pixels, width, width - 2, height - 2)).toEqual(background);
    expect(countChangedPixels(pixels, width, height, background, { x: width - 220, y: height - 60, width: 220, height: 60 })).toBeLessThan(320);
  });

  it("uses the Discord message author as the attachment watermark text", () => {
    expect(buildImageWatermarkText({ authorName: " Alice ", sourceName: "announcements" })).toBe("Alice");
    expect(buildImageWatermarkText({ authorName: "   ", sourceName: "announcements" })).toBe("announcements");
    expect(buildImageWatermarkText({ authorName: "   ", sourceName: "   " })).toBe("Discord");
  });

  it("keeps long watermark names inside the image bounds", async () => {
    const background = { r: 46, g: 125, b: 91 };
    const input = await sharp({
      create: {
        width: 160,
        height: 90,
        channels: 3,
        background
      }
    })
      .png()
      .toBuffer();

    const output = await addWatermark(input, "VeryLongDiscordDisplayNameThatWouldOtherwiseOverflowTheImage");
    const pixels = await sharp(output.buffer).removeAlpha().raw().toBuffer();
    const metadata = await sharp(output.buffer).metadata();
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    expect(output.width).toBe(160);
    expect(output.height).toBe(90);
    expect(readPixel(pixels, width, width - 1, height - 12)).toEqual(background);
    expect(readPixel(pixels, width, width - 1, height - 2)).toEqual(background);
  });

  it("shrinks long watermark names before truncating them", () => {
    const fitted = fitImageWatermarkText("ModeratelyLongDiscordName", 14, 6, 120);

    expect(fitted.value).toBe("ModeratelyLongDiscordName");
    expect(fitted.fontSize).toBeLessThan(14);
    expect(fitted.fontSize).toBeGreaterThanOrEqual(6);
  });

  it("only truncates watermark names when the minimum font size still cannot fit", () => {
    const fitted = fitImageWatermarkText("ExtremelyLongDiscordDisplayNameThatCannotFitEvenAtMinimumSize", 14, 6, 120);

    expect(fitted.value.endsWith("...")).toBe(true);
    expect(fitted.fontSize).toBe(6);
  });
});

function readPixel(buffer: Buffer, imageWidth: number, x: number, y: number) {
  const offset = (y * imageWidth + x) * 3;
  return {
    r: buffer[offset],
    g: buffer[offset + 1],
    b: buffer[offset + 2]
  };
}

function countChangedPixels(
  buffer: Buffer,
  imageWidth: number,
  imageHeight: number,
  background: { r: number; g: number; b: number },
  area: { x: number; y: number; width: number; height: number }
) {
  let changed = 0;
  const startX = Math.max(0, area.x);
  const startY = Math.max(0, area.y);
  const endX = Math.min(imageWidth, area.x + area.width);
  const endY = Math.min(imageHeight, area.y + area.height);

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const pixel = readPixel(buffer, imageWidth, x, y);
      if (pixel.r !== background.r || pixel.g !== background.g || pixel.b !== background.b) {
        changed += 1;
      }
    }
  }

  return changed;
}
