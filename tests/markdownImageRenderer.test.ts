import { describe, expect, it } from "vitest";
import { buildMarkdownDocument, buildTranslationDocument, repairTranslatedMarkdown } from "../src/media/markdownImageRenderer.js";

describe("buildMarkdownDocument", () => {
  it("renders Discord markdown features into a browser document", () => {
    const html = buildMarkdownDocument({
      authorName: "Alice",
      sourceName: "announcements",
      createdAt: new Date(0).toISOString(),
      rawMarkdown: [
        "# Release notes",
        "",
        "**bold** [link](https://example.com)",
        "",
        "- first",
        "- second",
        "",
        "> quoted",
        "",
        "```ts",
        "const ok = true;",
        "```",
        "",
        "| A | B |",
        "| - | - |",
        "| 1 | 2 |",
        "",
        "Hello <@123> ![remote](https://cdn.example.com/image.png)"
      ].join("\n")
    });

    expect(html).toContain("<h1>Release notes</h1>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain('<a href="https://example.com">link</a>');
    expect(html).toContain("<li>first</li>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("const ok = true;");
    expect(html).toContain("<table>");
    expect(html).toContain("&lt;@123&gt;");
    expect(html).toContain("[image: remote]");
    expect(html).toContain("linear-gradient(90deg, #2563eb, #0ea5e9 45%, #f97316)");
    expect(html).toContain("width: 720px;");
    expect(html).toContain("width: 680px;");
    expect(html).toContain("border: 0;");
    expect(html).toContain("border-radius: 0;");
    expect(html).toContain("width: 100%;");
    expect(html).toContain("--paper: #fbfdff;");
    expect(html).toContain("background: #edf3f6;");
    expect(html).toContain("linear-gradient(180deg, rgba(251, 253, 255, 0.985), rgba(247, 250, 252, 0.985))");
    expect(html).not.toContain("#ede8dc");
    expect(html).toContain("<strong>Alice</strong>");
    expect(html).toContain('<span class="format-pill">Discord</span>');
    expect(html).not.toContain("#announcements");
    expect(html).not.toContain("source-pill");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("https://cdn.example.com/image.png");
  });

  it("renders a Discord avatar data URI when one is available", () => {
    const html = buildMarkdownDocument(
      {
        authorName: "Alice",
        sourceName: "announcements",
        createdAt: new Date(0).toISOString(),
        rawMarkdown: "hello"
      },
      {
        authorAvatarDataUri: "data:image/png;base64,YXZhdGFy"
      }
    );

    expect(html).toContain('<img class="avatar avatar-image"');
    expect(html).toContain('src="data:image/png;base64,YXZhdGFy"');
    expect(html).not.toContain(">A</div>");
  });

  it("does not turn four leading spaces before inline markdown into a code block", () => {
    const html = buildMarkdownDocument({
      authorName: "Alice",
      sourceName: "announcements",
      createdAt: new Date(0).toISOString(),
      rawMarkdown: "\n\n    **xxxx**\n\n"
    });

    expect(html).toContain("<strong>xxxx</strong>");
    expect(html).not.toContain("<pre");
  });

  it("keeps fenced code blocks available for real Discord code snippets", () => {
    const html = buildMarkdownDocument({
      authorName: "Alice",
      sourceName: "announcements",
      createdAt: new Date(0).toISOString(),
      rawMarkdown: ["```", "    **xxxx**", "```"].join("\n")
    });

    expect(html).toContain("<pre");
    expect(html).toContain("**xxxx**");
  });

  it("renders translated markdown into a separate image document with the same content structure", () => {
    const html = buildTranslationDocument({
      authorName: "Alice",
      sourceName: "announcements",
      createdAt: new Date(0).toISOString(),
      translatedText: [
        "# 挑战者 650",
        "",
        "**费用：0 美元**",
        "",
        "下载链接: https://hotstart.net/wiki/CL650/Passenger_Edition",
        "",
        "<script>alert(1)</script>"
      ].join("\n")
    });

    expect(html).toContain("中文译文");
    expect(html).not.toContain("#announcements");
    expect(html).not.toContain("source-pill");
    expect(html).toContain("<h1>挑战者 650</h1>");
    expect(html).toContain("<strong>费用：0 美元</strong>");
    expect(html).toContain('<a href="https://hotstart.net/wiki/CL650/Passenger_Edition">https://hotstart.net/wiki/CL650/Passenger_Edition</a>');
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("data-image-card");
    expect(html).toContain("linear-gradient(90deg, #2563eb, #0ea5e9 45%, #f97316)");
    expect(html).toContain("width: 720px;");
    expect(html).toContain("width: 680px;");
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("uses the exact same image width constraints for translated and original markdown", () => {
    const markdownHtml = buildMarkdownDocument({
      authorName: "Alice",
      sourceName: "announcements",
      createdAt: new Date(0).toISOString(),
      rawMarkdown: "# Release notes\n\nhello"
    });
    const translationHtml = buildTranslationDocument({
      authorName: "Alice",
      sourceName: "announcements",
      createdAt: new Date(0).toISOString(),
      translatedText: "# 发布说明\n\n你好"
    });

    expect(extractStyle(markdownHtml)).toBe(extractStyle(translationHtml));
    expect(translationHtml).toContain("width: 720px;");
    expect(translationHtml).toContain("min-width: 720px;");
    expect(translationHtml).toContain("max-width: 720px;");
    expect(translationHtml).toContain("width: 680px;");
    expect(translationHtml).toContain("min-width: 680px;");
    expect(translationHtml).toContain("max-width: 680px;");
  });

  it("repairs DeepLX markdown artifacts before rendering translated images", () => {
    const html = buildTranslationDocument({
      authorName: "Alice",
      sourceName: "announcements",
      createdAt: new Date(0).toISOString(),
      translatedText: [
        "# 挑战者 650 \"乘客版\" 已登陆",
        "",
        "我们推出了挑战者 650* 的**乘客版**。",
        "",
        "没错。挑战者 650 乘客版是__免费__的。"
      ].join("\n")
    });

    expect(html).toContain("我们推出了挑战者 650 的<strong>乘客版</strong>。");
    expect(html).toContain("是<strong>免费</strong>的。");
    expect(html).not.toContain("650*");
    expect(html).not.toContain("__免费__");
    expect(html).not.toContain("translation-pill");
    expect(html).toContain('<span class="format-pill">中文译文</span>');
  });

  it("does not repair translated markdown inside code spans or fenced code blocks", () => {
    expect(
      repairTranslatedMarkdown(["这里是 `__免费__` 和 `650*`。", "", "```", "__免费__", "650*", "```"].join("\n"))
    ).toBe(["这里是 `__免费__` 和 `650*`。", "", "```", "__免费__", "650*", "```"].join("\n"));
  });

  it("falls back to initials when a Discord avatar data URI is unavailable", () => {
    const html = buildTranslationDocument(
      {
        authorName: "Alice",
        sourceName: "announcements",
        createdAt: new Date(0).toISOString(),
        translatedText: "你好"
      },
      { authorAvatarDataUri: null }
    );

    expect(html).toContain('<div class="avatar avatar-initials">A</div>');
    expect(html).not.toContain('<img class="avatar avatar-image"');
  });
});

function extractStyle(html: string) {
  const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  expect(style).toBeDefined();
  return style;
}
