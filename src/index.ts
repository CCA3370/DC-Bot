import "dotenv/config";
import { loadConfig } from "./shared/config.js";
import { createLogger } from "./shared/logger.js";

const config = loadConfig(process.env);
const logger = createLogger("bootstrap");

logger.info(`DC-Bot initialized for Discord guild ${config.discord.guildId}`);
logger.info(`Admin server will listen on http://${config.admin.host}:${config.admin.port}`);
