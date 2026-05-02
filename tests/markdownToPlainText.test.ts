import { describe, expect, it } from "vitest";
import { markdownToPlainText } from "../src/discord/markdownToPlainText.js";

describe("markdownToPlainText", () => {
  it("unwraps common markdown formatting while preserving readable text", () => {
    expect(markdownToPlainText("**bold** _italic_ `code` ~~old~~")).toBe("bold italic code old");
  });

  it("converts leading dash list items to visible bullets", () => {
    expect(markdownToPlainText("- first\n- second")).toBe("• first\n• second");
  });

  it("removes markdown quote markers before translation", () => {
    expect(markdownToPlainText("> **important**\n> second line")).toBe("important\nsecond line");
  });

  it("renders Discord mentions, channels, roles and custom emoji as readable text", () => {
    const result = markdownToPlainText("Hi <@123> in <#456> with <@&789> <:wave:999>", {
      users: new Map([["123", "Alice"]]),
      channels: new Map([["456", "general"]]),
      roles: new Map([["789", "Ops"]])
    });

    expect(result).toBe("Hi @Alice in #general with @Ops :wave:");
  });
});
