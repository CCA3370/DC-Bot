# Debian 12 Docker Compose 部署

脚本：`scripts/deploy-dcbot.sh`

部署目标：

- 应用目录：`/opt/dc-bot`
- 环境变量：`/etc/dc-bot/dc-bot.env`
- Compose env 文件：`/opt/dc-bot/.env.compose`
- SQLite：`/var/lib/dc-bot/dc-bot.sqlite`
- 媒体缓存：`/var/lib/dc-bot/media-cache`
- Docker Compose 服务：`dc-bot`
- 管理后台默认监听：`0.0.0.0:8787`

脚本按 Docker 官方 Debian apt 仓库安装 Docker Engine、Buildx plugin 和 Compose plugin。NapCat 不由本脚本安装，必须先按 NapCat 官方 Shell/Installer 文档在本机部署并启用 OneBot HTTP。

参考：

- Docker Debian 安装文档：https://docs.docker.com/engine/install/debian/
- NapCat Shell 文档：https://napneko.github.io/guide/boot/Shell
- NapCat Installer 参数：https://github.com/NapNeko/NapCat-Installer

## 准备

在 Debian 12 服务器上只需要下载部署脚本。脚本会从 GitHub 拉取项目源码到 `/opt/dc-bot`。

```bash
curl -fsSL https://raw.githubusercontent.com/CCA3370/DC-Bot/main/scripts/deploy-dcbot.sh -o /tmp/deploy-dcbot.sh
```

确认 Discord Bot 已开启这些 intent：

- `Guilds`
- `GuildMessages`
- `MessageContent`

先在本机部署 NapCat，并确认 OneBot HTTP 已监听本机端口。默认部署配置使用：

```text
NAPCAT_ENDPOINT=http://127.0.0.1:3000
```

Compose 已配置 host network：

```yaml
network_mode: host
```

因此 DC-Bot 容器在 Debian 主机上可以直接访问本机 NapCat 的 `127.0.0.1:3000`。如果你的 NapCat OneBot HTTP 使用了其他端口，请相应修改 `NAPCAT_ENDPOINT`。

## 交互式部署

```bash
sudo -E bash /tmp/deploy-dcbot.sh
```

脚本会提示输入：

- Discord Bot token
- 管理后台密码

如果未提供 `ADMIN_SESSION_SECRET`，脚本会自动生成。`DISCORD_GUILD_ID` 可以留空，部署后在后台设置。

## 非交互部署

```bash
curl -fsSL https://raw.githubusercontent.com/CCA3370/DC-Bot/main/scripts/deploy-dcbot.sh -o /tmp/deploy-dcbot.sh
sudo DISCORD_TOKEN='你的 Discord token' \
  ADMIN_PASSWORD='强密码' \
  NAPCAT_ENDPOINT='http://127.0.0.1:3000' \
  bash /tmp/deploy-dcbot.sh --yes
```

可选环境变量：

- `DISCORD_GUILD_ID`：可选初始 Discord 服务器 ID，也可以部署后在后台面板中设置
- `NAPCAT_ACCESS_TOKEN`：NapCat access token，没有可留空
- `NAPCAT_ENDPOINT`：默认 `http://127.0.0.1:3000`
- `ADMIN_HOST`：容器内监听地址，默认 `0.0.0.0`
- `ADMIN_PORT`：host network 下直接监听的后台端口，默认 `8787`
- `REPO_URL`：默认 `https://github.com/CCA3370/DC-Bot.git`
- `REPO_REF`：默认 `main`，可设为分支、tag 或 commit
- `APP_DIR`：默认 `/opt/dc-bot`
- `CONFIG_DIR`：默认 `/etc/dc-bot`
- `STATE_DIR`：默认 `/var/lib/dc-bot`

部署 fork 或指定分支示例：

```bash
sudo REPO_URL='https://github.com/你的账号/DC-Bot.git' \
  REPO_REF='main' \
  DISCORD_TOKEN='你的 Discord token' \
  ADMIN_PASSWORD='强密码' \
  bash /tmp/deploy-dcbot.sh --yes
```

## 部署后操作

查看服务状态：

```bash
cd /opt/dc-bot
sudo docker compose --env-file /opt/dc-bot/.env.compose ps
```

查看实时日志：

```bash
cd /opt/dc-bot
sudo docker compose --env-file /opt/dc-bot/.env.compose logs -f dc-bot
```

健康检查：

```bash
curl http://127.0.0.1:8787/api/auth/me
```

打开后台：

```text
http://<服务器 IP>:8787
```

后台配置顺序：

1. 登录。
2. 设置监听 Discord 服务器 ID。
3. 配置 NapCat OneBot HTTP 地址和 access token。
4. 同步 Discord 频道和线程。
5. 新增 QQ 群。
6. 配置频道到 QQ 群的路由。
7. 测试 NapCat 连接。
8. 发送测试消息。

## NapCat 连通性检查

如果 NapCat 在本机端口 `3000` 监听，可以从 DC-Bot 容器内测试：

```bash
cd /opt/dc-bot
sudo docker compose --env-file /opt/dc-bot/.env.compose exec dc-bot node -e "fetch(process.env.NAPCAT_ENDPOINT).then(r=>console.log(r.status)).catch(e=>{console.error(e);process.exit(1)})"
```

NapCat 的具体安装参数请以官方 Shell/Installer 文档为准。本仓库部署脚本只负责 DC-Bot 容器。

## 更新部署

项目更新后，重新下载最新部署脚本并运行：

```bash
curl -fsSL https://raw.githubusercontent.com/CCA3370/DC-Bot/main/scripts/deploy-dcbot.sh -o /tmp/deploy-dcbot.sh
sudo -E bash /tmp/deploy-dcbot.sh --yes
```

脚本会保留 `/etc/dc-bot/dc-bot.env` 中已有配置，除非你在当前命令环境里显式覆盖。应用代码会从 GitHub 更新到 `/opt/dc-bot`，镜像会重新构建，SQLite 和媒体缓存保存在 `/var/lib/dc-bot`，不会随容器重建丢失。

## 防火墙

如果服务器启用了防火墙，需要放行管理后台端口，例如：

```bash
sudo ufw allow 8787/tcp
```

如果只在内网使用，建议通过安全组、防火墙或反向代理限制访问来源。
