# 人工测试清单

## 启动前

- `.env` 中已设置真实 `DISCORD_TOKEN`、`ADMIN_PASSWORD`、`ADMIN_SESSION_SECRET`。
- NapCat OneBot HTTP 服务可访问，`NAPCAT_ENDPOINT` 指向正确地址。
- Discord Bot 已加入 guild `1331633353648111697`，并启用 `Guilds`、`GuildMessages`、`MessageContent` intent。
- 运行 `pnpm lint`、`pnpm test`、`pnpm build` 均通过。

## 后台配置

- 打开 `http://127.0.0.1:8787` 后未登录状态无法访问 `/api/status`。
- 使用 `ADMIN_PASSWORD` 登录成功，退出后 API 返回 401。
- 点击“来源”里的同步，能看到普通文本频道和活动线程。
- 新增 QQ 群后刷新仍存在，停用后不会作为有效目标。
- 新增频道到 QQ 群路由后，路由列表显示来源、类型、群名和群号。
- 停用路由后 Discord 消息不会进入对应 QQ 群；重新启用后恢复。

## Discord 到 QQ 投递

- 在已映射的普通 Discord 文本频道发送纯文本消息，QQ 收到合并转发文本节点和提醒消息。
- 在已映射的线程中发送消息，QQ 提醒消息里的来源为线程名。
- 发送单图消息，QQ 合并转发包含一个图片节点，图片右下角有来源水印。
- 发送多图消息，QQ 合并转发中所有图片集中在同一个图片节点。
- 发送图文混合消息，QQ 合并转发中文本节点和图片节点分离。
- 发送 embed、贴纸、非图片附件或空消息，不产生 QQ 投递。
- 在未映射频道发送消息，QQ 不收到消息，后台日志出现忽略记录。

## 失败和重试

- 临时关闭 NapCat 后发送已映射消息，后台“发送队列”出现失败任务。
- 恢复 NapCat 后等待自动重试，任务状态变为 sent。
- 对失败任务点击“重发”，QQ 收到补发内容，任务状态变为 sent。
- 确认失败日志不包含 Discord token、NapCat token 或带签名的媒体 URL。

## 数据与文件

- `data/` 下生成 SQLite 数据库。
- `media-cache/` 下生成水印后的 PNG 文件。
- `data/`、`media-cache/`、`.env`、日志文件不会出现在 `git status` 的待提交列表中。
