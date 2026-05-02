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
  private readonly cacheRoot: string;

  constructor(config: Pick<AppConfig, "storage">) {
    this.cacheRoot = resolve(config.storage.mediaCacheDir);
  }

  async renderMessage(message: NormalizedDiscordMessage): Promise<ProcessedImageAsset | null> {
    if (message.rawMarkdown.trim().length === 0) {
      return null;
    }

    const html = buildMarkdownDocument(message);
    return this.writeRenderedImage("markdown", message.id, message.rawMarkdown, html);
  }

  async renderTranslation(message: NormalizedDiscordMessage, translatedText: string | null): Promise<ProcessedImageAsset | null> {
    const text = translatedText?.trim() ?? "";
    if (text.length === 0) {
      return null;
    }

    const html = buildTranslationDocument({
      authorName: message.authorName,
      sourceName: message.sourceName,
      createdAt: message.createdAt,
      translatedText: text
    });
    return this.writeRenderedImage("translation", message.id, text, html);
  }

  private async writeRenderedImage(
    kind: "markdown" | "translation",
    messageId: string,
    hashInput: string,
    html: string
  ): Promise<ProcessedImageAsset> {
    const buffer = await screenshotHtml(html);
    const metadata = await sharp(buffer).metadata();
    const width = metadata.width ?? 960;
    const height = metadata.height ?? 1;
    const hash = createHash("sha256").update(messageId).update(hashInput).update(buffer).digest("hex").slice(0, 24);
    const day = new Date().toISOString().slice(0, 10);
    const directory = join(this.cacheRoot, kind, day);
    mkdirSync(directory, { recursive: true });

    const filename = `${hash}-${kind}.png`;
    const filePath = join(directory, filename);
    await writeFile(filePath, buffer);

    return {
      attachmentId: `${kind}-${messageId}`,
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
  const authorInitials = getAuthorInitials(message.authorName);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      color-scheme: light;
      --ink: #20211f;
      --muted: #6d6658;
      --paper: #fffdf7;
      --paper-soft: #f5efe4;
      --line: #d8ccba;
      --teal: #17453e;
      --teal-soft: #e1eee9;
      --gold: #d49a2d;
      --red: #8f3f34;
      font-family: "Aptos", "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      color: var(--ink);
      background: #ede8dc;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 28px;
      width: 960px;
      background:
        linear-gradient(90deg, rgba(23, 69, 62, 0.055) 1px, transparent 1px),
        linear-gradient(180deg, rgba(23, 69, 62, 0.055) 1px, transparent 1px),
        #ede8dc;
      background-size: 28px 28px;
    }
    .card {
      position: relative;
      width: 904px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(255, 253, 247, 0.98), rgba(255, 253, 247, 0.98)),
        repeating-linear-gradient(135deg, rgba(212, 154, 45, 0.05) 0 1px, transparent 1px 16px);
    }
    .card::before {
      content: "";
      display: block;
      height: 7px;
      background: linear-gradient(90deg, var(--teal), #2e7d5b 58%, var(--gold));
    }
    .header {
      display: grid;
      grid-template-columns: 54px 1fr auto;
      gap: 14px;
      align-items: center;
      padding: 20px 26px 18px;
      border-bottom: 1px solid var(--line);
      background:
        linear-gradient(180deg, #fffdf7, #f7f1e7);
      color: var(--ink);
    }
    .avatar {
      width: 54px;
      height: 54px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(23, 69, 62, 0.24);
      border-radius: 8px;
      background: var(--teal);
      color: #fff8e6;
      font-size: 18px;
      font-weight: 900;
      line-height: 1;
    }
    .header strong,
    .header span {
      display: block;
    }
    .header strong {
      font-size: 22px;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    .meta-line {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 7px;
      color: var(--muted);
      font-size: 13px;
      font-weight: 700;
      overflow-wrap: anywhere;
    }
    .meta-line .source-pill,
    .meta-line .format-pill {
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      padding: 4px 9px;
      border-radius: 999px;
      border: 1px solid rgba(23, 69, 62, 0.18);
      background: var(--teal-soft);
      color: var(--teal);
      max-width: 460px;
      overflow-wrap: anywhere;
    }
    .meta-line .format-pill {
      border-color: rgba(212, 154, 45, 0.28);
      background: #fff1cc;
      color: #744714;
    }
    .time {
      align-self: center;
      padding-left: 18px;
      border-left: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0;
      white-space: nowrap;
    }
    .content {
      padding: 28px 32px 34px;
      font-size: 18px;
      line-height: 1.64;
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
      position: relative;
      margin: 26px 0 14px;
      line-height: 1.22;
      letter-spacing: 0;
      color: #1f2a27;
    }
    h1 {
      padding-left: 14px;
      font-size: 32px;
    }
    h2 {
      padding-left: 12px;
      font-size: 26px;
    }
    h3 {
      font-size: 21px;
      color: var(--teal);
    }
    h1::before,
    h2::before {
      content: "";
      position: absolute;
      left: 0;
      top: 0.12em;
      bottom: 0.12em;
      width: 5px;
      border-radius: 999px;
      background: var(--gold);
    }
    p,
    ul,
    ol,
    blockquote,
    pre,
    table {
      margin: 16px 0;
    }
    p {
      color: #2c2a25;
    }
    ul,
    ol {
      padding-left: 31px;
    }
    li + li {
      margin-top: 7px;
    }
    li::marker {
      color: var(--gold);
      font-weight: 900;
    }
    a {
      color: #126281;
      font-weight: 700;
      text-decoration: underline;
      text-underline-offset: 3px;
    }
    code {
      padding: 2px 6px;
      border-radius: 5px;
      background: #efe6d6;
      color: var(--red);
      font-family: "Cascadia Mono", "Consolas", monospace;
      font-size: 0.9em;
    }
    pre {
      overflow-x: auto;
      position: relative;
      padding: 42px 18px 18px;
      border: 1px solid #171817;
      border-radius: 8px;
      background: #20211f;
      color: #f8f3e8;
      white-space: pre-wrap;
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
    }
    pre::before {
      content: "";
      position: absolute;
      left: 16px;
      top: 15px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: #d66b5d;
      box-shadow: 17px 0 #e7b95a, 34px 0 #65b37a;
    }
    pre code {
      padding: 0;
      background: transparent;
      color: inherit;
      font-size: 15px;
    }
    blockquote {
      margin-left: 0;
      padding: 12px 16px 12px 18px;
      border-left: 5px solid var(--gold);
      border-radius: 0 8px 8px 0;
      background: #fff8e6;
      color: #5b523f;
    }
    blockquote > :first-child {
      margin-top: 0;
    }
    blockquote > :last-child {
      margin-bottom: 0;
    }
    table {
      width: 100%;
      overflow: hidden;
      border-collapse: separate;
      border-spacing: 0;
      border: 1px solid var(--line);
      border-radius: 8px;
      font-size: 16px;
    }
    th,
    td {
      padding: 10px 12px;
      border-right: 1px solid var(--line);
      border-bottom: 1px solid var(--line);
      text-align: left;
      vertical-align: top;
    }
    th:last-child,
    td:last-child {
      border-right: 0;
    }
    tr:last-child td {
      border-bottom: 0;
    }
    th {
      background: #efe6d6;
      color: #4c4435;
      font-size: 13px;
      font-weight: 900;
      text-transform: uppercase;
    }
    tr:nth-child(even) td {
      background: #faf6ed;
    }
    .markdown-image-ref {
      display: inline-block;
      padding: 3px 9px;
      border: 1px solid rgba(23, 69, 62, 0.2);
      border-radius: 999px;
      background: var(--teal-soft);
      color: var(--teal);
      font-size: 0.9em;
      font-weight: 700;
    }
  </style>
</head>
<body>
  <article class="card" data-image-card>
    <header class="header">
      <div class="avatar">${escapeHtml(authorInitials)}</div>
      <div>
        <strong>${escapeHtml(message.authorName)}</strong>
        <div class="meta-line">
          <span class="source-pill">#${escapeHtml(message.sourceName)}</span>
          <span class="format-pill">Discord Markdown</span>
        </div>
      </div>
      <div class="time">${escapeHtml(timestamp)}</div>
    </header>
    <main class="content">${renderedBody}</main>
  </article>
</body>
</html>`;
}

export function buildTranslationDocument(
  message: Pick<NormalizedDiscordMessage, "authorName" | "sourceName" | "createdAt"> & { translatedText: string }
) {
  const timestamp = formatTimestamp(message.createdAt);
  const authorInitials = getAuthorInitials(message.authorName);
  const translatedText = escapeHtml(message.translatedText.trim());

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <style>
    :root {
      color-scheme: light;
      --ink: #1f2522;
      --muted: #617168;
      --line: #c9d8d0;
      --green: #1f6b53;
      --green-dark: #123f34;
      --green-soft: #e4f2ec;
      --paper: #fbfefb;
      --gold: #d99a28;
      font-family: "Aptos", "Segoe UI", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif;
      color: var(--ink);
      background: #e6eee8;
    }
    * {
      box-sizing: border-box;
    }
    body {
      margin: 0;
      padding: 28px;
      width: 960px;
      background:
        linear-gradient(90deg, rgba(31, 107, 83, 0.055) 1px, transparent 1px),
        linear-gradient(180deg, rgba(31, 107, 83, 0.055) 1px, transparent 1px),
        #e6eee8;
      background-size: 28px 28px;
    }
    .card {
      width: 904px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: 8px;
      background:
        linear-gradient(180deg, rgba(251, 254, 251, 0.98), rgba(251, 254, 251, 0.98)),
        repeating-linear-gradient(135deg, rgba(31, 107, 83, 0.045) 0 1px, transparent 1px 18px);
    }
    .card::before {
      content: "";
      display: block;
      height: 7px;
      background: linear-gradient(90deg, var(--green-dark), var(--green) 64%, var(--gold));
    }
    .header {
      display: grid;
      grid-template-columns: 54px 1fr auto;
      gap: 14px;
      align-items: center;
      padding: 20px 26px 18px;
      border-bottom: 1px solid var(--line);
      background: linear-gradient(180deg, #fbfefb, #edf7f1);
    }
    .avatar {
      width: 54px;
      height: 54px;
      display: grid;
      place-items: center;
      border: 1px solid rgba(31, 107, 83, 0.22);
      border-radius: 8px;
      background: var(--green-dark);
      color: #fff9e8;
      font-size: 18px;
      font-weight: 900;
      line-height: 1;
    }
    .title {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      align-items: center;
      margin-bottom: 7px;
    }
    .title strong {
      font-size: 22px;
      line-height: 1.15;
      overflow-wrap: anywhere;
    }
    .translation-pill,
    .source-pill {
      display: inline-flex;
      align-items: center;
      min-height: 25px;
      padding: 4px 9px;
      border-radius: 999px;
      font-size: 13px;
      font-weight: 800;
      overflow-wrap: anywhere;
    }
    .translation-pill {
      border: 1px solid rgba(31, 107, 83, 0.2);
      background: var(--green-soft);
      color: var(--green-dark);
    }
    .source-pill {
      border: 1px solid rgba(217, 154, 40, 0.28);
      background: #fff2cf;
      color: #744714;
      max-width: 460px;
    }
    .time {
      align-self: center;
      padding-left: 18px;
      border-left: 1px solid var(--line);
      color: var(--muted);
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0;
      white-space: nowrap;
    }
    .content {
      padding: 31px 36px 36px;
    }
    .translated-text {
      position: relative;
      margin: 0;
      padding: 0 0 0 18px;
      border-left: 5px solid var(--green);
      color: #1e2723;
      font-size: 22px;
      font-weight: 500;
      line-height: 1.78;
      letter-spacing: 0;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
    }
    .translated-text::before {
      content: "译";
      position: absolute;
      right: 0;
      bottom: -8px;
      color: rgba(31, 107, 83, 0.08);
      font-size: 86px;
      font-weight: 900;
      line-height: 1;
    }
  </style>
</head>
<body>
  <article class="card" data-image-card>
    <header class="header">
      <div class="avatar">${escapeHtml(authorInitials)}</div>
      <div>
        <div class="title">
          <strong>${escapeHtml(message.authorName)}</strong>
          <span class="translation-pill">中文译文</span>
        </div>
        <span class="source-pill">#${escapeHtml(message.sourceName)}</span>
      </div>
      <div class="time">${escapeHtml(timestamp)}</div>
    </header>
    <main class="content">
      <p class="translated-text">${translatedText}</p>
    </main>
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
    return await page.locator("[data-image-card]").screenshot({
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

function getAuthorInitials(value: string) {
  const compact = value.trim();
  if (compact.length === 0) {
    return "DC";
  }

  const asciiWords = compact.match(/[a-zA-Z0-9]+/g);
  if (asciiWords && asciiWords.length > 0) {
    return asciiWords
      .slice(0, 2)
      .map((word) => word[0]?.toUpperCase() ?? "")
      .join("")
      .slice(0, 2);
  }

  return Array.from(compact).slice(0, 2).join("");
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
