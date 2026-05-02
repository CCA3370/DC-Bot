import { describe, expect, it } from "vitest";
import { buildMarkdownDocument, buildTranslationDocument } from "../src/media/markdownImageRenderer.js";

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
    expect(html).toContain("#announcements");
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
