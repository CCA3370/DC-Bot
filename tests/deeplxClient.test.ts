import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepLxClient, parseDeepLxTranslationResponse } from "../src/napcat/deepLxClient.js";

describe("DeepLxClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts readable text through the DeepLX API-key path", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: "你好" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = new DeepLxClient({
      endpoint: "https://api.deeplx.org",
      apiKey: "secret/key",
      timeoutMs: 1000
    });

    await expect(client.translateToChinese(" hello ")).resolves.toBe("你好");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.deeplx.org/secret%2Fkey/translate",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "content-type": "application/json"
        }),
        body: JSON.stringify({
          text: "hello",
          source_lang: "auto",
          target_lang: "ZH"
        })
      })
    );
    expect((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers).not.toHaveProperty("authorization");
  });

  it("requires both endpoint and API key before translation is enabled", () => {
    expect(new DeepLxClient({ endpoint: "https://api.deeplx.org", apiKey: "", timeoutMs: 1000 }).isConfigured()).toBe(false);
    expect(new DeepLxClient({ endpoint: "", apiKey: "key", timeoutMs: 1000 }).isConfigured()).toBe(false);
    expect(new DeepLxClient({ endpoint: "https://api.deeplx.org", apiKey: "key", timeoutMs: 1000 }).isConfigured()).toBe(true);
  });

  it("parses common DeepLX and DeepL response shapes", () => {
    expect(parseDeepLxTranslationResponse({ data: "你好" })).toBe("你好");
    expect(parseDeepLxTranslationResponse({ data: { text: "你好" } })).toBe("你好");
    expect(parseDeepLxTranslationResponse({ data: { translation: "你好" } })).toBe("你好");
    expect(parseDeepLxTranslationResponse({ translations: [{ text: "你好" }] })).toBe("你好");
  });

  it("includes the DeepLX response body in HTTP errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: 429, message: "quota exceeded" }), { status: 429 }))
    );

    const client = new DeepLxClient({
      endpoint: "http://127.0.0.1:1188",
      apiKey: "deeplx-api-key",
      timeoutMs: 1000
    });

    await expect(client.translateToChinese("hello")).rejects.toThrow(
      'DeepLX translate failed with HTTP 429: {"code":429,"message":"quota exceeded"}'
    );
  });

  it("includes invalid DeepLX response details in parse errors", () => {
    expect(() => parseDeepLxTranslationResponse({ code: 500, message: "backend unavailable" })).toThrow(
      'DeepLX translate returned an invalid response: {"code":500,"message":"backend unavailable"}'
    );
  });
});
