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
    const watermarkText = buildImageWatermarkText(message);
    for (const image of message.images) {
      assets.push(await this.downloadAndWatermark(image, watermarkText));
    }
    return assets;
  }

  private async downloadAndWatermark(image: NormalizedImageAttachment, watermarkText: string): Promise<ProcessedImageAsset> {
    if (image.size > this.config.media.maxImageBytes) {
      throw new Error(`Discord image ${image.filename} exceeds ${this.config.media.maxImageBytes} bytes`);
    }

    const source = await this.downloadImage(image);
    const watermarked = await addWatermark(source, watermarkText);
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

export async function addWatermark(input: Buffer, rawText: string) {
  const base = sharp(input, { animated: false, limitInputPixels: 80_000_000 }).rotate();
  const metadata = await base.metadata();
  const width = metadata.width ?? 1024;
  const height = metadata.height ?? 1024;
  const baseFontSize = Math.min(Math.max(9, Math.round(width * 0.014)), Math.max(9, Math.round(height * 0.12)));
  const minFontSize = Math.max(6, Math.min(baseFontSize, Math.round(width * 0.006)));
  const watermarkText = fitImageWatermarkText(rawText, baseFontSize, minFontSize, Math.max(24, width - 10));
  const fontSize = watermarkText.fontSize;
  const paddingX = Math.max(4, Math.round(fontSize * 0.28));
  const paddingY = Math.max(3, Math.round(fontSize * 0.2));
  const strokeWidth = Math.max(1, Math.round(fontSize * 0.06));
  const textX = width - paddingX - strokeWidth;
  const textY = height - paddingY - strokeWidth - Math.ceil(fontSize * 0.18);
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${textX}" y="${textY}"
        font-family="Segoe UI, Microsoft YaHei, sans-serif"
        font-size="${fontSize}"
        font-weight="600"
        text-anchor="end"
        stroke="rgba(0,0,0,0.28)"
        stroke-width="${strokeWidth}"
        stroke-linejoin="round"
        paint-order="stroke fill"
        fill="rgba(255,255,255,0.48)">${escapeXml(watermarkText.value)}</text>
    </svg>`;

  const buffer = await base
    .composite([{ input: Buffer.from(svg), left: 0, top: 0 }])
    .png({ compressionLevel: 8 })
    .toBuffer();

  return { buffer, width, height };
}

export function buildImageWatermarkText(message: Pick<NormalizedDiscordMessage, "authorName" | "sourceName">) {
  const authorName = message.authorName.trim();
  if (authorName.length > 0) {
    return authorName;
  }

  const sourceName = message.sourceName.trim();
  return sourceName.length > 0 ? sourceName : "Discord";
}

export function fitImageWatermarkText(value: string, baseFontSize: number, minFontSize: number, maxWidth: number) {
  const normalized = value.trim() || "Discord";
  for (let fontSize = baseFontSize; fontSize >= minFontSize; fontSize -= 1) {
    if (estimateTextWidth(normalized, fontSize) <= maxWidth) {
      return { value: normalized, fontSize };
    }
  }

  let fitted = "";
  for (const char of Array.from(normalized)) {
    const candidate = `${fitted}${char}...`;
    if (estimateTextWidth(candidate, minFontSize) > maxWidth) {
      break;
    }
    fitted += char;
  }

  return {
    value: fitted.length > 0 ? `${fitted}...` : "...",
    fontSize: minFontSize
  };
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
