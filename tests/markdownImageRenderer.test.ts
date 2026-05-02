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
    expect(html).not.toContain("<img");
    expect(html).not.toContain("https://cdn.example.com/image.png");
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
    expect(html).not.toContain("<script>alert(1)</script>");
  });
});
