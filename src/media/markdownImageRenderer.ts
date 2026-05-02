import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import MarkdownIt from "markdown-it";
import { chromium, type LaunchOptions } from "playwright-core";
import sharp from "sharp";
import type { AppConfig } from "../shared/config.js";
import type { NormalizedDiscordMessage, ProcessedImageAsset } from "../shared/types.js";

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true
});

markdown.renderer.rules.image = (tokens, index) => {
  const token = tokens[index];
  if (!token) {
    return "";
  }
  const alt = markdown.utils.escapeHtml(token.content || "image");
  return `<span class="markdown-image-ref">[image: ${alt}]</span>`;
};

export class MarkdownImageRenderer {
  private readonly cacheDir: string;

  constructor(config: Pick<AppConfig, "storage">) {
    this.cacheDir = resolve(config.storage.mediaCacheDir, "markdown");
  }

  async renderMessage(message: NormalizedDiscordMessage): Promise<ProcessedImageAsset | null> {
    if (message.rawMarkdown.trim().length === 0) {
      return null;
    }

    const html = buildMarkdownDocument(message);
    const buffer = await screenshotHtml(html);
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 960;
    const height = metadata.height ?? 1;
    const hash = createHash("sha256")
      .update(message.id)
      .update(message.rawMarkdown)
      .update(buffer)
      .digest("hex")
      .slice(0, 24);
    const day = new Date().toISOString().slice(0, 10);
    const directory = join(this.cacheDir, day);
    mkdirSync(directory, { recursive: true });

    const filename = `${hash}-markdown.png`;
    const filePath = join(directory, filename);
    await writeFile(filePath, buffer);

    return {
      attachmentId: `markdown-${message.id}`,
      filename,
      mimeType: "image/png",
      filePath,
      size: buffer.byteLength,
      width,
      height
    };
  }
}

export function buildMarkdownDocument(message: Pick<NormalizedDiscordMessage, "authorName" | "sourceName" | "createdAt" | "rawMarkdown">) {
  const renderedBody = markdown.render(message.rawMarkdown.trim());
  const timestamp = formatTimestamp(message.createdAt);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      color-scheme: light;
      font-family: "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      color: #25231f;
      background: #f1eddf;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 32px;
      width: 960px;
      background: #f1eddf;
    }
    .card {
      width: 896px;
      overflow: hidden;
      border: 1px solid #cfc5b2;
      border-radius: 8px;
      background: #fbfaf5;
      box-shadow: 10px 12px 0 #17453e;
    }
    .header {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 18px;
      padding: 18px 22px;
      border-bottom: 1px solid #ddd2bd;
      background: #24231f;
      color: #f5efe2;
    }
    .header strong,
    .header span {
      display: block;
    }
    .header strong {
      font-size: 20px;
      line-height: 1.2;
      overflow-wrap: anywhere;
    }
    .header span {
      margin-top: 5px;
      color: #cfc5b2;
      font-size: 13px;
      overflow-wrap: anywhere;
    }
    .time {
      align-self: start;
      color: #f0c75e;
      font-size: 13px;
      font-weight: 700;
      white-space: nowrap;
    }
    .content {
      padding: 24px 26px 28px;
      font-size: 18px;
      line-height: 1.58;
      overflow-wrap: anywhere;
    }
    .content > :first-child {
      margin-top: 0;
    }
    .content > :last-child {
      margin-bottom: 0;
    }
    h1,
    h2,
    h3 {
      margin: 22px 0 12px;
      line-height: 1.22;
      letter-spacing: 0;
    }
    h1 {
      font-size: 30px;
    }
    h2 {
      font-size: 25px;
    }
    h3 {
      font-size: 21px;
    }
    p,
    ul,
    ol,
    blockquote,
    pre,
    table {
      margin: 14px 0;
    }
    ul,
    ol {
      padding-left: 28px;
    }
    li + li {
      margin-top: 6px;
    }
    a {
      color: #0f5b7c;
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    code {
      padding: 2px 6px;
      border-radius: 5px;
      background: #ece4d6;
      color: #7d2f25;
      font-family: "Cascadia Mono", "Consolas", monospace;
      font-size: 0.9em;
    }
    pre {
      overflow-x: auto;
      padding: 15px 16px;
      border-radius: 7px;
      background: #20211f;
      color: #f5efe2;
      white-space: pre-wrap;
    }
    pre code {
      padding: 0;
      background: transparent;
      color: inherit;
      font-size: 15px;
    }
    blockquote {
      margin-left: 0;
      padding: 3px 0 3px 16px;
      border-left: 5px solid #f0c75e;
      color: #5b523f;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 16px;
    }
    th,
    td {
      padding: 9px 10px;
      border: 1px solid #d8cfbd;
      text-align: left;
      vertical-align: top;
    }
    th {
      background: #ece4d6;
      color: #4c4435;
    }
    .markdown-image-ref {
      display: inline-block;
      padding: 2px 8px;
      border: 1px solid #c8beaa;
      border-radius: 5px;
      background: #f4efe5;
      color: #706650;
      font-size: 0.9em;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <article class="card" data-markdown-card>
    <header class="header">
      <div>
        <strong>${escapeHtml(message.authorName)}</strong>
        <span>#${escapeHtml(message.sourceName)}</span>
      </div>
      <div class="time">${escapeHtml(timestamp)}</div>
    </header>
    <main class="content">${renderedBody}</main>
  </article>
</body>
</html>`;
}

async function screenshotHtml(html: string) {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
    ...getChromiumLaunchOptions()
  });

  try {
    const page = await browser.newPage({
      viewport: { width: 960, height: 720 },
      deviceScaleFactor: 1
    });
    await page.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("data:") || url === "about:blank") {
        void route.continue();
        return;
      }
      void route.abort();
    });
    await page.setContent(html, { waitUntil: "domcontentloaded" });
    return await page.locator("[data-markdown-card]").screenshot({
      type: "png",
      animations: "disabled"
    });
  } finally {
    await browser.close();
  }
}

function getChromiumLaunchOptions(): Pick<LaunchOptions, "executablePath"> {
  const executablePath = resolveChromiumExecutablePath();
  return executablePath ? { executablePath } : {};
}

function resolveChromiumExecutablePath() {
  const explicitPath = process.env.CHROMIUM_EXECUTABLE_PATH?.trim();
  if (explicitPath && existsSync(explicitPath)) {
    return explicitPath;
  }

  const candidates =
    process.platform === "win32"
      ? [
          process.env.ProgramFiles ? join(process.env.ProgramFiles, "Google", "Chrome", "Application", "chrome.exe") : "",
          process.env["ProgramFiles(x86)"] ? join(process.env["ProgramFiles(x86)"], "Google", "Chrome", "Application", "chrome.exe") : "",
          process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "Google", "Chrome", "Application", "chrome.exe") : "",
          process.env.ProgramFiles ? join(process.env.ProgramFiles, "Microsoft", "Edge", "Application", "msedge.exe") : ""
        ]
      : ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"];

  return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate));
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  }).format(date);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
