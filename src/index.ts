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
const delivery = new DeliveryService({
  config,
  database,
  logger: createLogger("delivery")
});

delivery.startRetryWorker();
let discord: DiscordBridgeClient | null = null;

const admin = new AdminServer({
  config,
  database,
  delivery,
  logger: createLogger("admin"),
  syncDiscordChannels: async () => {
    if (!discord) {
      throw new Error("Discord client is not connected");
    }
    await discord.syncConfiguredGuild();
  }
});

await admin.start();

logger.info(`DC-Bot initialized for Discord guild ${config.discord.guildId}`);
logger.info(`Admin server will listen on http://${config.admin.host}:${config.admin.port}`);

if (!config.discord.token) {
  logger.warn("DISCORD_TOKEN is empty; Discord ingestion is disabled");
} else {
  discord = new DiscordBridgeClient({
    config: config.discord,
    database,
    logger: createLogger("discord"),
    onMessage: async (message) => {
      await delivery.handleDiscordMessage(message);
    }
  });

  await discord.start();
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
