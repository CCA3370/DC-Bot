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

  it("renders translated plain text into a separate image document", () => {
    const html = buildTranslationDocument({
      authorName: "Alice",
      sourceName: "announcements",
      createdAt: new Date(0).toISOString(),
      translatedText: "你好，世界。\n这是中文译文。<script>alert(1)</script>"
    });

    expect(html).toContain("中文译文");
    expect(html).toContain("#announcements");
    expect(html).toContain("你好，世界。");
    expect(html).toContain("这是中文译文。&lt;script&gt;alert(1)&lt;/script&gt;");
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
