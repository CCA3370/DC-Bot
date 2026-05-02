# DC-Bot

Discord 到 QQ/NapCat 桥接机器人。当前实现使用 Node.js 22+、TypeScript、discord.js v14、Fastify、React + Vite、SQLite、sharp 和 NapCat OneBot HTTP API。

## 功能范围

- 监听指定 Discord guild `1331633353648111697` 的文本频道和线程消息。
- 将 Discord 文本转换为更适合 QQ 展示的纯文本。
- 下载图片附件，校验 MIME/大小，并在右下角添加 `#{来源频道名}` 或线程名水印。
- 对每个目标 QQ 群发送一次 OneBot 合并转发：文本节点独立，图片集中在一个图片节点。
- 合并转发成功后发送提醒：`⬆️有来自{来源频道名}的新消息，请留意查看哦~`。
- SQLite 保存频道、QQ群、路由、投递队列、投递尝试、事件日志和后台会话。
- 内置单管理员 Web 后台，支持频道同步、QQ群配置、路由配置、NapCat 测试、队列重发和日志查看。

首版不处理 Discord embed、贴纸、非图片附件、语音和历史消息补发。

## 环境要求

- Node.js 22 或更高版本。
- pnpm 10 或更高版本。
- 已启用 `Guilds`、`GuildMessages`、`MessageContent` intent 的 Discord Bot。
- NapCat OneBot HTTP 服务。

## 本地启动

```powershell
pnpm install
Copy-Item .env.example .env
pnpm build
pnpm start
```

开发时可使用：

```powershell
pnpm dev
pnpm dev:admin
```

`pnpm dev` 启动 bot 和后台 API；`pnpm dev:admin` 启动 Vite 前端开发服务。

## 配置

复制 `.env.example` 为 `.env` 后配置：

- `DISCORD_TOKEN`：Discord Bot token。
- `DISCORD_GUILD_ID`：默认 `1331633353648111697`。
- `NAPCAT_ENDPOINT`：NapCat OneBot HTTP 地址，例如 `http://127.0.0.1:3000`。
- `NAPCAT_ACCESS_TOKEN`：NapCat access token，没有则留空。
- `ADMIN_PASSWORD`：后台登录密码。
- `ADMIN_SESSION_SECRET`：后台签名 Cookie secret。
- `SQLITE_PATH`：SQLite 数据库路径，默认 `./data/dc-bot.sqlite`。
- `MEDIA_CACHE_DIR`：水印图片缓存目录，默认 `./media-cache`。

`data/` 和 `media-cache/` 已加入 `.gitignore`。

## 管理后台

构建后打开：

```text
http://127.0.0.1:8787
```

后台操作顺序：

1. 登录。
2. 在“来源”里同步 Discord 频道和线程。
3. 在“路由”里新增 QQ 群。
4. 将 Discord 来源映射到一个或多个 QQ 群。
5. 在“运行总览”测试 NapCat 连接和测试发送。
6. 在“发送队列”里查看失败任务并手动重发。

未配置路由的 Discord 消息会被忽略并写入事件日志。

## 验证命令

```powershell
pnpm lint
pnpm test
pnpm build
```

当前测试覆盖配置加载、Markdown 转纯文本、NapCat 合并转发 payload、SQLite 路由/队列状态和图片水印尺寸。
