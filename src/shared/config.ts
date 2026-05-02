import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().optional().default(""),
  DISCORD_GUILD_ID: z.string().optional().default(""),
  NAPCAT_ENDPOINT: z.string().url().default("http://127.0.0.1:3000"),
  NAPCAT_ACCESS_TOKEN: z.string().optional().default(""),
  DEEPLX_ENDPOINT: z.string().optional().default(""),
  DEEPLX_API_KEY: z.string().optional().default(""),
  DEEPLX_TIMEOUT_MS: z.coerce.number().int().positive().default(10_000),
  ADMIN_HOST: z.string().default("127.0.0.1"),
  ADMIN_PORT: z.coerce.number().int().positive().default(8787),
  ADMIN_PASSWORD: z.string().default("change-me"),
  ADMIN_SESSION_SECRET: z.string().default("replace-with-a-long-random-secret"),
  SQLITE_PATH: z.string().default("./data/dc-bot.sqlite"),
  MEDIA_CACHE_DIR: z.string().default("./media-cache"),
  MAX_IMAGE_BYTES: z.coerce.number().int().positive().default(10 * 1024 * 1024),
  DISCORD_ATTACHMENT_TIMEOUT_MS: z.coerce.number().int().positive().default(15_000),
  JOB_RETRY_BASE_SECONDS: z.coerce.number().int().positive().default(30),
  JOB_RETRY_MAX_SECONDS: z.coerce.number().int().positive().default(3600)
});

export type AppConfig = ReturnType<typeof loadConfig>;

export function loadConfig(env: NodeJS.ProcessEnv) {
  const parsed = envSchema.parse(env);

  return {
    discord: {
      token: parsed.DISCORD_TOKEN,
      guildId: parsed.DISCORD_GUILD_ID.trim(),
      attachmentTimeoutMs: parsed.DISCORD_ATTACHMENT_TIMEOUT_MS
    },
    napcat: {
      endpoint: parsed.NAPCAT_ENDPOINT.replace(/\/+$/, ""),
      accessToken: parsed.NAPCAT_ACCESS_TOKEN
    },
    deeplx: {
      endpoint: parsed.DEEPLX_ENDPOINT.trim().replace(/\/+$/, ""),
      apiKey: parsed.DEEPLX_API_KEY.trim(),
      timeoutMs: parsed.DEEPLX_TIMEOUT_MS
    },
    admin: {
      host: parsed.ADMIN_HOST,
      port: parsed.ADMIN_PORT,
      password: parsed.ADMIN_PASSWORD,
      sessionSecret: parsed.ADMIN_SESSION_SECRET
    },
    storage: {
      sqlitePath: parsed.SQLITE_PATH,
      mediaCacheDir: parsed.MEDIA_CACHE_DIR
    },
    media: {
      maxImageBytes: parsed.MAX_IMAGE_BYTES
    },
    delivery: {
      retryBaseSeconds: parsed.JOB_RETRY_BASE_SECONDS,
      retryMaxSeconds: parsed.JOB_RETRY_MAX_SECONDS
    }
  };
}
