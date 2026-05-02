import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepLxClient, parseDeepLxTranslationResponse } from "../src/napcat/deepLxClient.js";

describe("DeepLxClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts readable text with auto source and Chinese target", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: "你好" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeepLxClient({
      endpoint: "http://127.0.0.1:1188",
      token: "secret",
      timeoutMs: 1000
    });

    await expect(client.translateToChinese(" hello ")).resolves.toBe("你好");

    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:1188/translate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json",
          authorization: "Bearer secret"
        }),
        body: JSON.stringify({
          text: "hello",
          source_lang: "auto",
          target_lang: "ZH"
        })
      })
    );
  });

  it("parses common DeepLX and DeepL response shapes", () => {
    expect(parseDeepLxTranslationResponse({ data: "你好" })).toBe("你好");
    expect(parseDeepLxTranslationResponse({ data: { text: "你好" } })).toBe("你好");
    expect(parseDeepLxTranslationResponse({ data: { translation: "你好" } })).toBe("你好");
    expect(parseDeepLxTranslationResponse({ translations: [{ text: "你好" }] })).toBe("你好");
  });
});
