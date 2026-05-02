import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/shared/config.js";

describe("loadConfig", () => {
  it("does not assume a default guild and normalizes the NapCat endpoint", () => {
    const config = loadConfig({
      NAPCAT_ENDPOINT: "http://127.0.0.1:3000///"
    });

    expect(config.discord.guildId).toBe("");
    expect(config.napcat.endpoint).toBe("http://127.0.0.1:3000");
    expect(config.deeplx.endpoint).toBe("");
    expect(config.deeplx.timeoutMs).toBe(10000);
    expect(config.admin.port).toBe(8787);
  });

  it("uses DISCORD_GUILD_ID only when it is explicitly provided", () => {
    const config = loadConfig({
      DISCORD_GUILD_ID: " 123456789012345678 "
    });

    expect(config.discord.guildId).toBe("123456789012345678");
  });

  it("normalizes DeepLX settings when explicitly provided", () => {
    const config = loadConfig({
      DEEPLX_ENDPOINT: " http://127.0.0.1:1188/// ",
      DEEPLX_API_KEY: "deeplx-api-key",
      DEEPLX_TIMEOUT_MS: "15000"
    });

    expect(config.deeplx).toEqual({
      endpoint: "http://127.0.0.1:1188",
      apiKey: "deeplx-api-key",
      timeoutMs: 15000
    });
  });
});
