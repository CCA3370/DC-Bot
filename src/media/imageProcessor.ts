import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import sharp from "sharp";
import type { AppConfig } from "../shared/config.js";
import type { NormalizedDiscordMessage, NormalizedImageAttachment, ProcessedImageAsset } from "../shared/types.js";

export class ImageProcessor {
  private readonly cacheDir: string;

  constructor(private readonly config: Pick<AppConfig, "media" | "storage" | "discord">) {
    this.cacheDir = resolve(config.storage.mediaCacheDir);
  }

  async prepareImages(message: NormalizedDiscordMessage): Promise<ProcessedImageAsset[]> {
    const assets: ProcessedImageAsset[] = [];
    for (const image of message.images) {
      assets.push(await this.downloadAndWatermark(image, message.sourceName));
    }
    return assets;
  }

  private async downloadAndWatermark(image: NormalizedImageAttachment, sourceName: string): Promise<ProcessedImageAsset> {
    if (image.size > this.config.media.maxImageBytes) {
      throw new Error(`Discord image ${image.filename} exceeds ${this.config.media.maxImageBytes} bytes`);
    }

    const source = await this.downloadImage(image);
    const watermarked = await addWatermark(source, `#${sourceName}`);
    const hash = createHash("sha256").update(watermarked.buffer).digest("hex").slice(0, 24);
    const day = new Date().toISOString().slice(0, 10);
    const directory = join(this.cacheDir, day);
    mkdirSync(directory, { recursive: true });

    const safeName = basename(image.filename).replace(/[^a-zA-Z0-9_.-]/g, "_").replace(/\.[^.]+$/, "");
    const filePath = join(directory, `${hash}-${safeName || image.id}.png`);
    await writeFile(filePath, watermarked.buffer);

    return {
      attachmentId: image.id,
      filename: `${safeName || image.id}.png`,
      mimeType: "image/png",
      filePath,
      size: watermarked.buffer.byteLength,
      width: watermarked.width,
      height: watermarked.height
    };
  }

  private async downloadImage(image: NormalizedImageAttachment) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.discord.attachmentTimeoutMs);

    try {
      const response = await fetch(image.url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to download Discord image ${image.filename}: HTTP ${response.status}`);
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? image.contentType.toLowerCase();
      if (!contentType.startsWith("image/") || contentType === "image/svg+xml") {
        throw new Error(`Unsupported Discord image type ${contentType}`);
      }

      const contentLength = Number(response.headers.get("content-length") ?? "0");
      if (contentLength > this.config.media.maxImageBytes) {
        throw new Error(`Discord image ${image.filename} exceeds ${this.config.media.maxImageBytes} bytes`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength > this.config.media.maxImageBytes) {
        throw new Error(`Discord image ${image.filename} exceeds ${this.config.media.maxImageBytes} bytes`);
      }

      return buffer;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export async function addWatermark(input: Buffer, text: string) {
  const base = sharp(input, { animated: false, limitInputPixels: 80_000_000 }).rotate();
  const metadata = await base.metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;
  const fontSize = Math.max(12, Math.round(width * 0.022));
  const paddingX = Math.max(5, Math.round(fontSize * 0.35));
  const paddingY = Math.max(4, Math.round(fontSize * 0.25));
  const strokeWidth = Math.max(1, Math.round(fontSize * 0.08));
  const watermarkWidth = Math.min(width, estimateTextWidth(text, fontSize) + paddingX * 2 + strokeWidth * 2);
  const watermarkHeight = Math.round(fontSize * 1.35 + paddingY * 2 + strokeWidth * 2);
  const svg = `
    <svg width="${watermarkWidth}" height="${watermarkHeight}" xmlns="http://www.w3.org/2000/svg">
      <text x="${paddingX + strokeWidth}" y="${paddingY + strokeWidth + fontSize}"
        font-family="Segoe UI, Microsoft YaHei, sans-serif"
        font-size="${fontSize}"
        font-weight="600"
        stroke="rgba(0,0,0,0.45)"
        stroke-width="${strokeWidth}"
        stroke-linejoin="round"
        paint-order="stroke fill"
        fill="rgba(255,255,255,0.72)">${escapeXml(text)}</text>
    </svg>`;

  const buffer = await base
    .composite([{ input: Buffer.from(svg), gravity: "southeast" }])
    .png({ compressionLevel: 8 })
    .toBuffer();

  return { buffer, width, height };
}

function estimateTextWidth(value: string, fontSize: number) {
  let units = 0;
  for (const char of Array.from(value)) {
    const codePoint = char.codePointAt(0) ?? 0;
    if ((codePoint >= 0x2e80 && codePoint <= 0x9fff) || (codePoint >= 0xff00 && codePoint <= 0xffef)) {
      units += 1;
    } else if (codePoint > 0xffff) {
      units += 1.1;
    } else {
      units += 0.58;
    }
  }

  return Math.ceil(units * fontSize);
}

function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
