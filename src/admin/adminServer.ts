import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import cookie from "@fastify/cookie";
import formbody from "@fastify/formbody";
import fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import type { AppConfig } from "../shared/config.js";
import type { AppDatabase } from "../shared/database.js";
import type { Logger } from "../shared/logger.js";
import type { DeliveryService } from "../napcat/deliveryService.js";

const sessionCookie = "dc_bot_session";
const sessionTtlMs = 7 * 24 * 60 * 60 * 1000;

export interface AdminServerOptions {
  config: AppConfig;
  database: AppDatabase;
  delivery: DeliveryService;
  logger: Logger;
  syncDiscordChannels: () => Promise<void>;
}

export class AdminServer {
  private readonly app: FastifyInstance;

  constructor(private readonly options: AdminServerOptions) {
    this.app = fastify({ logger: false });
  }

  async start() {
    await this.registerPlugins();
    this.registerRoutes();
    await this.app.listen({
      host: this.options.config.admin.host,
      port: this.options.config.admin.port
    });
    this.options.logger.info("Admin server started", {
      host: this.options.config.admin.host,
      port: this.options.config.admin.port
    });
  }

  async close() {
    await this.app.close();
  }

  private async registerPlugins() {
    await this.app.register(cookie, {
      secret: this.options.config.admin.sessionSecret
    });
    await this.app.register(formbody);

    const staticRoot = resolve("dist/admin");
    if (existsSync(staticRoot)) {
      await this.app.register(fastifyStatic, {
        root: staticRoot,
        prefix: "/",
        wildcard: false
      });
    }
  }

  private registerRoutes() {
    this.app.get("/api/auth/me", async (request) => {
      return { authenticated: (await this.getSessionId(request)) !== null };
    });

    this.app.post("/api/auth/login", async (request, reply) => {
      const body = loginSchema.parse(request.body);
      if (!safeEqual(body.password, this.options.config.admin.password)) {
        return reply.code(401).send({ error: "密码错误" });
      }

      this.options.database.cleanupExpiredAdminSessions();
      const id = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + sessionTtlMs).toISOString();
      this.options.database.createAdminSession(id, expiresAt);
      reply.setCookie(sessionCookie, id, {
        httpOnly: true,
        sameSite: "strict",
        path: "/",
        signed: true,
        expires: new Date(expiresAt)
      });
      return { ok: true };
    });

    this.app.post("/api/auth/logout", async (request, reply) => {
      const sessionId = await this.getSessionId(request);
      if (sessionId) {
        this.options.database.deleteAdminSession(sessionId);
      }
      reply.clearCookie(sessionCookie, { path: "/" });
      return { ok: true };
    });

    this.app.addHook("preHandler", async (request, reply) => {
      if (!request.url.startsWith("/api/") || request.url.startsWith("/api/auth/")) {
        return;
      }

      const sessionId = await this.getSessionId(request);
      if (!sessionId) {
        return reply.code(401).send({ error: "未登录" });
      }
    });

    this.app.get("/api/status", async () => {
      const deliveryStats = this.options.database.getDeliveryStats();
      return {
        discord: {
          guildId: this.options.config.discord.guildId,
          tokenConfigured: this.options.config.discord.token.length > 0
        },
        napcat: {
          endpoint: this.options.config.napcat.endpoint,
          accessTokenConfigured: this.options.config.napcat.accessToken.length > 0
        },
        counts: {
          channels: this.options.database.countTable("discord_channels"),
          groups: this.options.database.countTable("qq_groups"),
          routes: this.options.database.countTable("channel_routes"),
          jobs: this.options.database.countTable("delivery_jobs")
        },
        delivery: deliveryStats
      };
    });

    this.app.get("/api/channels", async () => {
      return { channels: this.options.database.listDiscordChannels() };
    });

    this.app.post("/api/channels/sync", async () => {
      await this.options.syncDiscordChannels();
      return { channels: this.options.database.listDiscordChannels() };
    });

    this.app.get("/api/groups", async () => {
      return { groups: this.options.database.listQqGroups() };
    });

    this.app.post("/api/groups", async (request) => {
      const body = groupSchema.parse(request.body);
      this.options.database.upsertQqGroup(body.groupId, body.name, body.isActive);
      return { groups: this.options.database.listQqGroups() };
    });

    this.app.patch("/api/groups/:id", async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = activeSchema.parse(request.body);
      this.options.database.setQqGroupActive(params.id, body.isActive);
      return { groups: this.options.database.listQqGroups() };
    });

    this.app.get("/api/routes", async () => {
      return { routes: this.options.database.listChannelRoutes() };
    });

    this.app.post("/api/routes", async (request) => {
      const body = routeSchema.parse(request.body);
      this.options.database.upsertChannelRoute(body.sourceId, body.qqGroupId, body.isActive);
      return { routes: this.options.database.listChannelRoutes() };
    });

    this.app.patch("/api/routes/:id", async (request) => {
      const params = idParamsSchema.parse(request.params);
      const body = activeSchema.parse(request.body);
      this.options.database.setChannelRouteActive(params.id, body.isActive);
      return { routes: this.options.database.listChannelRoutes() };
    });

    this.app.delete("/api/routes/:id", async (request) => {
      const params = idParamsSchema.parse(request.params);
      this.options.database.deleteChannelRoute(params.id);
      return { routes: this.options.database.listChannelRoutes() };
    });

    this.app.get("/api/jobs", async () => {
      return { jobs: this.options.database.listDeliveryJobs(100) };
    });

    this.app.post("/api/jobs/:id/retry", async (request) => {
      const params = idParamsSchema.parse(request.params);
      await this.options.delivery.processJobById(params.id);
      return { jobs: this.options.database.listDeliveryJobs(100) };
    });

    this.app.get("/api/logs", async () => {
      return { logs: this.options.database.listEventLogs(120) };
    });

    this.app.post("/api/napcat/test", async () => {
      await this.options.delivery.testNapCatConnection();
      return { ok: true };
    });

    this.app.post("/api/test-send", async (request) => {
      const body = testSendSchema.parse(request.body);
      await this.options.delivery.sendTestMessage(body.groupId, body.text);
      return { ok: true };
    });

    this.app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ error: "接口不存在" });
      }
      return this.serveIndex(reply);
    });

    this.app.setErrorHandler(async (error, request, reply) => {
      const status = error instanceof z.ZodError ? 400 : 500;
      const message =
        error instanceof z.ZodError
          ? error.issues.map((issue) => issue.message).join("; ")
          : error instanceof Error
            ? error.message
            : String(error);
      this.options.logger.warn("Admin API request failed", {
        method: request.method,
        url: request.url,
        status,
        error: message
      });
      return reply.code(status).send({ error: message });
    });
  }

  private async getSessionId(request: FastifyRequest) {
    const signedCookie = request.cookies[sessionCookie];
    if (!signedCookie) {
      return null;
    }

    const unsigned = request.unsignCookie(signedCookie);
    if (!unsigned.valid || !unsigned.value) {
      return null;
    }

    return this.options.database.getAdminSession(unsigned.value)?.id ?? null;
  }

  private async serveIndex(reply: FastifyReply) {
    const staticRoot = resolve("dist/admin");
    if (!existsSync(resolve(staticRoot, "index.html"))) {
      return reply
        .code(404)
        .type("text/plain")
        .send("Admin UI has not been built yet. Run pnpm build or pnpm dev:admin.");
    }
    return reply.sendFile("index.html");
  }
}

const loginSchema = z.object({
  password: z.string().min(1)
});

const groupSchema = z.object({
  groupId: z.string().regex(/^\d+$/, "QQ群号必须是数字"),
  name: z.string().min(1, "QQ群名称不能为空"),
  isActive: z.boolean().default(true)
});

const routeSchema = z.object({
  sourceId: z.string().min(1, "Discord 来源不能为空"),
  qqGroupId: z.coerce.number().int().positive("QQ群配置无效"),
  isActive: z.boolean().default(true)
});

const activeSchema = z.object({
  isActive: z.boolean()
});

const idParamsSchema = z.object({
  id: z.coerce.number().int().positive()
});

const testSendSchema = z.object({
  groupId: z.string().regex(/^\d+$/, "QQ群号必须是数字"),
  text: z.string().min(1, "测试消息不能为空").max(1000, "测试消息过长")
});

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
