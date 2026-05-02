import "dotenv/config";
import { loadConfig } from "./shared/config.js";
import { AppDatabase } from "./shared/database.js";
import { createLogger } from "./shared/logger.js";
import { DiscordBridgeClient } from "./discord/discordClient.js";

const config = loadConfig(process.env);
const logger = createLogger("bootstrap");
const database = new AppDatabase(config.storage.sqlitePath);

logger.info(`DC-Bot initialized for Discord guild ${config.discord.guildId}`);
logger.info(`Admin server will listen on http://${config.admin.host}:${config.admin.port}`);

if (!config.discord.token) {
  logger.warn("DISCORD_TOKEN is empty; Discord ingestion is disabled");
} else {
  const discord = new DiscordBridgeClient({
    config: config.discord,
    database,
    logger: createLogger("discord"),
    onMessage: async (message) => {
      database.recordEventLog("info", "discord", "Received normalized Discord message", {
        discordMessageId: message.id,
        sourceId: message.sourceId,
        imageCount: message.images.length,
        hasText: message.text.length > 0
      });
    }
  });

  await discord.start();
}
