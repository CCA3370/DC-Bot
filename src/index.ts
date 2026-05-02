import "dotenv/config";
import { loadConfig } from "./shared/config.js";
import { AppDatabase } from "./shared/database.js";
import { createLogger } from "./shared/logger.js";
import { DiscordBridgeClient } from "./discord/discordClient.js";
import { DeliveryService } from "./napcat/deliveryService.js";
import { AdminServer } from "./admin/adminServer.js";

const config = loadConfig(process.env);
const logger = createLogger("bootstrap");
const database = new AppDatabase(config.storage.sqlitePath);
const discordLogger = createLogger("discord");
const delivery = new DeliveryService({
  config,
  database,
  logger: createLogger("delivery")
});

delivery.startRetryWorker();
let discord: DiscordBridgeClient | null = null;
let activeDiscordGuildId = database.getSetting("discord.guild_id") ?? config.discord.guildId;
if (activeDiscordGuildId) {
  database.setSetting("discord.guild_id", activeDiscordGuildId);
}

const admin = new AdminServer({
  config,
  database,
  delivery,
  logger: createLogger("admin"),
  getDiscordGuildId: () => activeDiscordGuildId,
  setDiscordGuildId: async (guildId) => {
    activeDiscordGuildId = guildId.trim();
    database.setSetting("discord.guild_id", activeDiscordGuildId);
    database.recordEventLog("info", "admin", "Updated Discord guild ID", { guildId: activeDiscordGuildId });
    await restartDiscordClient();
  },
  syncDiscordChannels: async () => {
    if (!discord) {
      throw new Error("Discord client is not connected");
    }
    await discord.syncConfiguredGuild();
  }
});

await admin.start();

logger.info(`DC-Bot initialized for Discord guild ${activeDiscordGuildId || "not configured"}`);
logger.info(`Admin server will listen on http://${config.admin.host}:${config.admin.port}`);

await restartDiscordClient();

async function restartDiscordClient() {
  if (discord) {
    await discord.stop();
    discord = null;
  }

  if (!config.discord.token) {
    logger.warn("DISCORD_TOKEN is empty; Discord ingestion is disabled");
    return;
  }

  if (!activeDiscordGuildId) {
    logger.warn("Discord guild ID is empty; set it in the admin dashboard before syncing sources");
    database.recordEventLog("warn", "discord", "Discord ingestion is disabled because guild ID is not configured");
    return;
  }

  discord = new DiscordBridgeClient({
    config: { ...config.discord, guildId: activeDiscordGuildId },
    database,
    logger: discordLogger,
    onMessage: async (message) => {
      await delivery.handleDiscordMessage(message);
    }
  });

  try {
    await discord.start();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error("Discord client failed to start", { error: errorMessage });
    database.recordEventLog("error", "discord", "Discord client failed to start", { error: errorMessage });
    discord = null;
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}

async function shutdown(signal: string) {
  logger.info(`Received ${signal}; shutting down`);
  delivery.stopRetryWorker();
  if (discord) {
    await discord.stop();
  }
  await admin.close();
  database.close();
  process.exit(0);
}
