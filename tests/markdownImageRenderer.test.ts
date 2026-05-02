import { describe, expect, it } from "vitest";
import { buildMarkdownDocument } from "../src/media/markdownImageRenderer.js";

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
});
