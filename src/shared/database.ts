import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DiscordSource } from "./types.js";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface EventLogEntry {
  id: number;
  level: LogLevel;
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

interface DiscordChannelRow {
  id: string;
  guild_id: string;
  parent_id: string | null;
  name: string;
  type: DiscordSource["type"];
  is_active: number;
}

export class AppDatabase {
  private readonly db: DatabaseSync;

  constructor(path: string) {
    const resolvedPath = resolve(path);
    mkdirSync(dirname(resolvedPath), { recursive: true });
    this.db = new DatabaseSync(resolvedPath);
    this.migrate();
  }

  close() {
    this.db.close();
  }

  recordEventLog(level: LogLevel, source: string, message: string, metadata?: Record<string, unknown>) {
    this.db
      .prepare(
        `INSERT INTO event_logs (level, source, message, metadata_json, created_at)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(level, source, message, metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
  }

  listEventLogs(limit = 100): EventLogEntry[] {
    const rows = this.db
      .prepare(
        `SELECT id, level, source, message, metadata_json, created_at
         FROM event_logs
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(limit) as Array<{
      id: number;
      level: LogLevel;
      source: string;
      message: string;
      metadata_json: string | null;
      created_at: string;
    }>;

    return rows.map((row) => ({
      id: row.id,
      level: row.level,
      source: row.source,
      message: row.message,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : null,
      createdAt: row.created_at
    }));
  }

  upsertDiscordChannels(sources: DiscordSource[]) {
    if (sources.length === 0) {
      return;
    }

    const now = new Date().toISOString();
    const update = this.db.prepare(
      `UPDATE discord_channels
       SET is_active = 0, updated_at = ?
       WHERE guild_id = ?`
    );
    const upsert = this.db.prepare(
      `INSERT INTO discord_channels
        (id, guild_id, parent_id, name, type, is_active, last_seen_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
        guild_id = excluded.guild_id,
        parent_id = excluded.parent_id,
        name = excluded.name,
        type = excluded.type,
        is_active = excluded.is_active,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at`
    );

    this.db.exec("BEGIN");
    try {
      update.run(now, sources[0]?.guildId ?? "");
      for (const source of sources) {
        upsert.run(
          source.id,
          source.guildId,
          source.parentId,
          source.name,
          source.type,
          source.isActive ? 1 : 0,
          now,
          now,
          now
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listDiscordChannels(): DiscordSource[] {
    const rows = this.db
      .prepare(
        `SELECT id, guild_id, parent_id, name, type, is_active
         FROM discord_channels
         ORDER BY type ASC, name ASC`
      )
      .all() as unknown as DiscordChannelRow[];

    return rows.map((row) => ({
      id: row.id,
      guildId: row.guild_id,
      parentId: row.parent_id,
      name: row.name,
      type: row.type,
      isActive: row.is_active === 1
    }));
  }

  private migrate() {
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS discord_channels (
        id TEXT PRIMARY KEY,
        guild_id TEXT NOT NULL,
        parent_id TEXT,
        name TEXT NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('channel', 'thread')),
        is_active INTEGER NOT NULL DEFAULT 1,
        last_seen_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS qq_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS channel_routes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        qq_group_id INTEGER NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(source_id, qq_group_id),
        FOREIGN KEY (qq_group_id) REFERENCES qq_groups(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS delivery_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        discord_message_id TEXT NOT NULL,
        source_id TEXT NOT NULL,
        qq_group_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        error_message TEXT,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS delivery_attempts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_message TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (job_id) REFERENCES delivery_jobs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS event_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        level TEXT NOT NULL,
        source TEXT NOT NULL,
        message TEXT NOT NULL,
        metadata_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS admin_sessions (
        id TEXT PRIMARY KEY,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_channel_routes_source_active
        ON channel_routes (source_id, is_active);

      CREATE INDEX IF NOT EXISTS idx_delivery_jobs_status_next
        ON delivery_jobs (status, next_attempt_at);

      CREATE INDEX IF NOT EXISTS idx_event_logs_created
        ON event_logs (created_at);
    `);
  }
}
