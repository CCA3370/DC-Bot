# Debian 12 一键部署

脚本：`scripts/deploy-debian12.sh`

部署目标：

- 应用目录：`/opt/dc-bot`
- 环境变量：`/etc/dc-bot/dc-bot.env`
- SQLite 和媒体缓存：`/var/lib/dc-bot`
- systemd 服务：`dc-bot.service`
- 管理后台默认监听：`0.0.0.0:8787`

## 准备

在 Debian 12 服务器上安装或上传当前仓库，然后进入仓库根目录。

确认 Discord Bot 已开启这些 intent：

- `Guilds`
- `GuildMessages`
- `MessageContent`

确认 NapCat OneBot HTTP 服务已经能从服务器访问。

## 交互式部署

```bash
sudo -E bash scripts/deploy-debian12.sh
```

脚本会提示输入：

- Discord Bot token
- 管理后台密码

如果未提供 `ADMIN_SESSION_SECRET`，脚本会自动生成。

## 非交互部署

```bash
sudo DISCORD_TOKEN='你的 Discord token' \
  ADMIN_PASSWORD='强密码' \
  NAPCAT_ENDPOINT='http://127.0.0.1:3000' \
  bash scripts/deploy-debian12.sh --yes
```

可选环境变量：

- `DISCORD_GUILD_ID`：默认 `1331633353648111697`
- `NAPCAT_ACCESS_TOKEN`：NapCat access token，没有可留空
- `ADMIN_HOST`：默认 `0.0.0.0`
- `ADMIN_PORT`：默认 `8787`
- `RUN_TESTS`：默认 `1`，设为 `0` 可跳过部署前测试
- `APP_DIR`：默认 `/opt/dc-bot`
- `CONFIG_DIR`：默认 `/etc/dc-bot`
- `STATE_DIR`：默认 `/var/lib/dc-bot`

## 部署后操作

查看服务状态：

```bash
systemctl status dc-bot.service
```

查看实时日志：

```bash
journalctl -u dc-bot.service -f
```

打开后台：

```text
http://<服务器 IP>:8787
```

后台配置顺序：

1. 登录。
2. 同步 Discord 频道和线程。
3. 新增 QQ 群。
4. 配置频道到 QQ 群的路由。
5. 测试 NapCat 连接。
6. 发送测试消息。

## 更新部署

拉取或上传新代码后，在仓库根目录重新运行：

```bash
sudo -E bash scripts/deploy-debian12.sh --yes
```

脚本会保留 `/etc/dc-bot/dc-bot.env` 之外由当前环境变量生成的配置，并重建 `/opt/dc-bot` 中的应用代码。SQLite 和媒体缓存保存在 `/var/lib/dc-bot`，不会被覆盖。

## 防火墙

如果服务器启用了防火墙，需要放行管理后台端口，例如：

```bash
sudo ufw allow 8787/tcp
```

如果只在内网使用，建议通过安全组、防火墙或反向代理限制访问来源。
