import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/shared/config.js";

describe("loadConfig", () => {
  it("uses the required guild default and normalizes the NapCat endpoint", () => {
    const config = loadConfig({
      NAPCAT_ENDPOINT: "http://127.0.0.1:3000///"
    });

    expect(config.discord.guildId).toBe("1331633353648111697");
    expect(config.napcat.endpoint).toBe("http://127.0.0.1:3000");
    expect(config.admin.port).toBe(8787);
  });
});
