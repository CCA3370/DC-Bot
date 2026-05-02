import {
  Client,
  GatewayIntentBits,
  Partials,
  type Guild,
  Events,
  type Message,
  type ThreadChannel
} from "discord.js";
import type { AppConfig } from "../shared/config.js";
import type { AppDatabase } from "../shared/database.js";
import type { Logger } from "../shared/logger.js";
import type { NormalizedDiscordMessage } from "../shared/types.js";
import { collectDiscordSources, getThreadSource, normalizeDiscordMessage } from "./messageNormalizer.js";

export interface DiscordBridgeOptions {
  config: AppConfig["discord"];
  database: AppDatabase;
  logger: Logger;
  onMessage: (message: NormalizedDiscordMessage) => Promise<void>;
}

export class DiscordBridgeClient {
  private readonly client: Client<true>;

  constructor(private readonly options: DiscordBridgeOptions) {
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
      partials: [Partials.Channel, Partials.Message]
    });

    this.registerHandlers();
  }

  async start() {
    await this.client.login(this.options.config.token);
  }

  async stop() {
    await this.client.destroy();
  }

  async syncConfiguredGuild() {
    const guild = await this.fetchConfiguredGuild();
    await this.syncGuildChannels(guild);
  }

  private registerHandlers() {
    this.client.once(Events.ClientReady, () => {
      this.options.logger.info("Discord client is ready", { userId: this.client.user.id });
      void this.syncConfiguredGuild().catch((error) => {
        this.logError("Failed to sync Discord channels on startup", error);
      });
    });

    this.client.on(Events.ChannelCreate, (channel) => {
      if (!("guild" in channel) || channel.guild.id !== this.options.config.guildId) {
        return;
      }
      void this.syncConfiguredGuild().catch((error) => this.logError("Failed to sync channels after channel create", error));
    });

    this.client.on(Events.ThreadCreate, (thread) => {
      void this.upsertThreadIfConfiguredGuild(thread);
    });

    this.client.on(Events.ThreadUpdate, (_oldThread, newThread) => {
      void this.upsertThreadIfConfiguredGuild(newThread);
    });

    this.client.on(Events.MessageCreate, (message) => {
      void this.handleMessageCreate(message);
    });
  }

  private async fetchConfiguredGuild() {
    const guild = await this.client.guilds.fetch(this.options.config.guildId);
    await guild.channels.fetch();
    return guild;
  }

  private async syncGuildChannels(guild: Guild) {
    const sources = collectDiscordSources(guild.channels.cache.values());
    this.options.database.upsertDiscordChannels(sources);
    this.options.database.recordEventLog("info", "discord", "Synced Discord channels", {
      guildId: guild.id,
      channelCount: sources.length
    });
    this.options.logger.info("Synced Discord channels", { guildId: guild.id, channelCount: sources.length });
  }

  private async upsertThreadIfConfiguredGuild(thread: ThreadChannel) {
    if (thread.guild.id !== this.options.config.guildId) {
      return;
    }

    const source = getThreadSource(thread);
    this.options.database.upsertDiscordChannels([source]);
    this.options.database.recordEventLog("info", "discord", "Synced Discord thread", {
      threadId: thread.id,
      name: thread.name
    });
  }

  private async handleMessageCreate(message: Message) {
    if (!message.inGuild()) {
      return;
    }

    const normalized = normalizeDiscordMessage(message, this.options.config.guildId);
    if (!normalized) {
      return;
    }

    await this.options.onMessage(normalized);
  }

  private logError(message: string, error: unknown) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    this.options.logger.error(message, { error: errorMessage });
    this.options.database.recordEventLog("error", "discord", message, { error: errorMessage });
  }
}
