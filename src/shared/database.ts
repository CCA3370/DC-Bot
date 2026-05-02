import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  DeliveryJob,
  DeliveryStats,
  DeliveryJobStatus,
  ChannelRouteView,
  DiscordSource,
  EventLogEntry,
  LogLevel,
  PreparedBridgePayload,
  QqGroup,
  RouteTarget
} from "./types.js";

interface DiscordChannelRow {
  id: string;
  guild_id: string;
  parent_id: string | null;
  name: string;
  type: DiscordSource["type"];
  is_active: number;
}

interface QqGroupRow {
  id: number;
  group_id: string;
  name: string;
  is_active: number;
}

interface RouteTargetRow {
  route_id: number;
  source_id: string;
  qq_group_id: number;
  group_id: string;
  group_name: string;
}

interface ChannelRouteViewRow {
  id: number;
  source_id: string;
  source_name: string | null;
  source_type: DiscordSource["type"] | null;
  qq_group_id: number;
  group_id: string;
  group_name: string;
  is_active: number;
}

interface DeliveryStatsRow {
  status: DeliveryJobStatus;
  count: number;
}

interface DeliveryJobRow {
  id: number;
  discord_message_id: string;
  source_id: string;
  qq_group_id: string;
  status: DeliveryJobStatus;
  payload_json: string;
  error_message: string | null;
  attempt_count: number;
  next_attempt_at: string | null;
  created_at: string;
  updated_at: string;
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

  getSetting(key: string) {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = ?`).get(key) as unknown as { value: string } | undefined;
    return row?.value ?? null;
  }

  setSetting(key: string, value: string) {
    this.db
      .prepare(
        `INSERT INTO settings (key, value, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET
          value = excluded.value,
          updated_at = excluded.updated_at`
      )
      .run(key, value, new Date().toISOString());
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

  upsertQqGroup(groupId: string, name: string, isActive = true) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO qq_groups (group_id, name, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(group_id) DO UPDATE SET
          name = excluded.name,
          is_active = excluded.is_active,
          updated_at = excluded.updated_at`
      )
      .run(groupId, name, isActive ? 1 : 0, now, now);
  }

  listQqGroups(): QqGroup[] {
    const rows = this.db
      .prepare(
        `SELECT id, group_id, name, is_active
         FROM qq_groups
         ORDER BY name ASC`
      )
      .all() as unknown as QqGroupRow[];

    return rows.map((row) => ({
      id: row.id,
      groupId: row.group_id,
      name: row.name,
      isActive: row.is_active === 1
    }));
  }

  setQqGroupActive(id: number, isActive: boolean) {
    this.db
      .prepare(
        `UPDATE qq_groups
         SET is_active = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(isActive ? 1 : 0, new Date().toISOString(), id);
  }

  upsertChannelRoute(sourceId: string, qqGroupId: number, isActive = true) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO channel_routes (source_id, qq_group_id, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(source_id, qq_group_id) DO UPDATE SET
          is_active = excluded.is_active,
          updated_at = excluded.updated_at`
      )
      .run(sourceId, qqGroupId, isActive ? 1 : 0, now, now);
  }

  listChannelRoutes(): ChannelRouteView[] {
    const rows = this.db
      .prepare(
        `SELECT
          channel_routes.id AS id,
          channel_routes.source_id AS source_id,
          discord_channels.name AS source_name,
          discord_channels.type AS source_type,
          qq_groups.id AS qq_group_id,
          qq_groups.group_id AS group_id,
          qq_groups.name AS group_name,
          channel_routes.is_active AS is_active
         FROM channel_routes
         INNER JOIN qq_groups ON qq_groups.id = channel_routes.qq_group_id
         LEFT JOIN discord_channels ON discord_channels.id = channel_routes.source_id
         ORDER BY discord_channels.name ASC, qq_groups.name ASC`
      )
      .all() as unknown as ChannelRouteViewRow[];

    return rows.map((row) => ({
      id: row.id,
      sourceId: row.source_id,
      sourceName: row.source_name,
      sourceType: row.source_type,
      qqGroupId: row.qq_group_id,
      groupId: row.group_id,
      groupName: row.group_name,
      isActive: row.is_active === 1
    }));
  }

  setChannelRouteActive(id: number, isActive: boolean) {
    this.db
      .prepare(
        `UPDATE channel_routes
         SET is_active = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(isActive ? 1 : 0, new Date().toISOString(), id);
  }

  deleteChannelRoute(id: number) {
    this.db.prepare(`DELETE FROM channel_routes WHERE id = ?`).run(id);
  }

  listActiveRoutesForSource(sourceId: string): RouteTarget[] {
    const rows = this.db
      .prepare(
        `SELECT
          channel_routes.id AS route_id,
          channel_routes.source_id AS source_id,
          qq_groups.id AS qq_group_id,
          qq_groups.group_id AS group_id,
          qq_groups.name AS group_name
         FROM channel_routes
         INNER JOIN qq_groups ON qq_groups.id = channel_routes.qq_group_id
         WHERE channel_routes.source_id = ?
          AND channel_routes.is_active = 1
          AND qq_groups.is_active = 1
         ORDER BY qq_groups.name ASC`
      )
      .all(sourceId) as unknown as RouteTargetRow[];

    return rows.map((row) => ({
      routeId: row.route_id,
      sourceId: row.source_id,
      qqGroupId: row.qq_group_id,
      groupId: row.group_id,
      groupName: row.group_name
    }));
  }

  createDeliveryJob(discordMessageId: string, sourceId: string, qqGroupId: string, payload: PreparedBridgePayload) {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `INSERT INTO delivery_jobs
          (discord_message_id, source_id, qq_group_id, status, payload_json, error_message, attempt_count, next_attempt_at, created_at, updated_at)
         VALUES (?, ?, ?, 'pending', ?, NULL, 0, ?, ?, ?)`
      )
      .run(discordMessageId, sourceId, qqGroupId, JSON.stringify(payload), now, now, now);

    return Number(result.lastInsertRowid);
  }

  listDueDeliveryJobs(limit = 25): DeliveryJob[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT *
         FROM delivery_jobs
         WHERE status IN ('pending', 'failed')
          AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
         ORDER BY next_attempt_at ASC, id ASC
         LIMIT ?`
      )
      .all(now, limit) as unknown as DeliveryJobRow[];

    return rows.map(parseDeliveryJobRow);
  }

  listDeliveryJobs(limit = 100): DeliveryJob[] {
    const rows = this.db
      .prepare(
        `SELECT *
         FROM delivery_jobs
         ORDER BY id DESC
         LIMIT ?`
      )
      .all(limit) as unknown as DeliveryJobRow[];

    return rows.map(parseDeliveryJobRow);
  }

  getDeliveryJob(id: number): DeliveryJob | null {
    const row = this.db.prepare(`SELECT * FROM delivery_jobs WHERE id = ?`).get(id) as unknown as DeliveryJobRow | undefined;
    return row ? parseDeliveryJobRow(row) : null;
  }

  getDeliveryStats(): DeliveryStats {
    const rows = this.db
      .prepare(
        `SELECT status, COUNT(*) AS count
         FROM delivery_jobs
         GROUP BY status`
      )
      .all() as unknown as DeliveryStatsRow[];

    return {
      pending: rows.find((row) => row.status === "pending")?.count ?? 0,
      failed: rows.find((row) => row.status === "failed")?.count ?? 0,
      sent: rows.find((row) => row.status === "sent")?.count ?? 0
    };
  }

  markDeliveryJobSent(id: number) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `UPDATE delivery_jobs
           SET status = 'sent', error_message = NULL, next_attempt_at = NULL, updated_at = ?
           WHERE id = ?`
        )
        .run(now, id);
      this.recordDeliveryAttempt(id, "sent", null, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  markDeliveryJobFailed(id: number, errorMessage: string, nextAttemptAt: string) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN");
    try {
      this.db
        .prepare(
          `UPDATE delivery_jobs
           SET status = 'failed',
            error_message = ?,
            attempt_count = attempt_count + 1,
            next_attempt_at = ?,
            updated_at = ?
           WHERE id = ?`
        )
        .run(errorMessage, nextAttemptAt, now, id);
      this.recordDeliveryAttempt(id, "failed", errorMessage, now);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  private recordDeliveryAttempt(jobId: number, status: DeliveryJobStatus, errorMessage: string | null, createdAt: string) {
    this.db
      .prepare(
        `INSERT INTO delivery_attempts (job_id, status, error_message, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(jobId, status, errorMessage, createdAt);
  }

  createAdminSession(id: string, expiresAt: string) {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO admin_sessions (id, expires_at, created_at)
         VALUES (?, ?, ?)`
      )
      .run(id, expiresAt, now);
  }

  getAdminSession(id: string) {
    const row = this.db
      .prepare(
        `SELECT id, expires_at
         FROM admin_sessions
         WHERE id = ? AND expires_at > ?`
      )
      .get(id, new Date().toISOString()) as unknown as { id: string; expires_at: string } | undefined;

    return row ? { id: row.id, expiresAt: row.expires_at } : null;
  }

  deleteAdminSession(id: string) {
    this.db.prepare(`DELETE FROM admin_sessions WHERE id = ?`).run(id);
  }

  cleanupExpiredAdminSessions() {
    this.db.prepare(`DELETE FROM admin_sessions WHERE expires_at <= ?`).run(new Date().toISOString());
  }

  countTable(tableName: "discord_channels" | "qq_groups" | "channel_routes" | "delivery_jobs") {
    const row = this.db.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get() as unknown as { count: number };
    return row.count;
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

function parseDeliveryJobRow(row: DeliveryJobRow): DeliveryJob {
  return {
    id: row.id,
    discordMessageId: row.discord_message_id,
    sourceId: row.source_id,
    qqGroupId: row.qq_group_id,
    status: row.status,
    payload: JSON.parse(row.payload_json) as PreparedBridgePayload,
    errorMessage: row.error_message,
    attemptCount: row.attempt_count,
    nextAttemptAt: row.next_attempt_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}
