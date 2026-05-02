import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  CheckCircle2,
  Languages,
  ListRestart,
  LogOut,
  Plus,
  Radio,
  RefreshCw,
  Route,
  Send,
  Server,
  ShieldCheck,
  Trash2
} from "lucide-react";
import type { ChannelRouteView, DeliveryJob, DiscordSource, EventLogEntry, NapCatGroup, QqGroup } from "../../../shared/types";
import { api } from "./apiClient";
import "./styles.css";

type Panel = "overview" | "sources" | "routes" | "queue" | "logs";

interface StatusResponse {
  discord: {
    guildId: string;
    tokenConfigured: boolean;
  };
  napcat: {
    endpoint: string;
    accessTokenConfigured: boolean;
  };
  deeplx: {
    endpoint: string;
    apiKeyConfigured: boolean;
    timeoutMs: number;
  };
  counts: {
    channels: number;
    groups: number;
    routes: number;
    jobs: number;
  };
  delivery: {
    pending: number;
    failed: number;
    sent: number;
  };
}

function App() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [panel, setPanel] = useState<Panel>("overview");
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [channels, setChannels] = useState<DiscordSource[]>([]);
  const [groups, setGroups] = useState<QqGroup[]>([]);
  const [napcatGroups, setNapcatGroups] = useState<NapCatGroup[]>([]);
  const [routes, setRoutes] = useState<ChannelRouteView[]>([]);
  const [jobs, setJobs] = useState<DeliveryJob[]>([]);
  const [logs, setLogs] = useState<EventLogEntry[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [guildForm, setGuildForm] = useState("");
  const [napcatForm, setNapcatForm] = useState({ endpoint: "", accessToken: "", clearAccessToken: false });
  const [deeplxForm, setDeeplxForm] = useState({ endpoint: "", apiKey: "", clearApiKey: false, timeoutMs: 10000 });
  const [groupForm, setGroupForm] = useState({ groupId: "", name: "" });
  const [selectedNapCatGroupId, setSelectedNapCatGroupId] = useState("");
  const [routeForm, setRouteForm] = useState<{ sourceId: string; qqGroupIds: number[] }>({ sourceId: "", qqGroupIds: [] });
  const [testForm, setTestForm] = useState({ groupId: "", text: "DC-Bot 测试消息" });

  useEffect(() => {
    void api<{ authenticated: boolean }>("/api/auth/me")
      .then((response) => {
        setAuthenticated(response.authenticated);
        if (response.authenticated) {
          void reloadAll();
        }
      })
      .catch(() => setAuthenticated(false));
  }, []);

  const activeChannels = useMemo(() => channels.filter((channel) => channel.isActive), [channels]);
  const activeGroups = useMemo(() => groups.filter((group) => group.isActive), [groups]);
  const configuredGroupIds = useMemo(() => new Set(groups.map((group) => group.groupId)), [groups]);
  const importableNapCatGroups = useMemo(
    () => napcatGroups.filter((group) => !configuredGroupIds.has(group.groupId)),
    [configuredGroupIds, napcatGroups]
  );

  async function reloadAll() {
    setBusy(true);
    try {
      const [nextStatus, channelResponse, groupResponse, routeResponse, jobResponse, logResponse] = await Promise.all([
        api<StatusResponse>("/api/status"),
        api<{ channels: DiscordSource[] }>("/api/channels"),
        api<{ groups: QqGroup[] }>("/api/groups"),
        api<{ routes: ChannelRouteView[] }>("/api/routes"),
        api<{ jobs: DeliveryJob[] }>("/api/jobs"),
        api<{ logs: EventLogEntry[] }>("/api/logs")
      ]);
      setStatus(nextStatus);
      setGuildForm(nextStatus.discord.guildId);
      setNapcatForm({ endpoint: nextStatus.napcat.endpoint, accessToken: "", clearAccessToken: false });
      setDeeplxForm({ endpoint: nextStatus.deeplx.endpoint, apiKey: "", clearApiKey: false, timeoutMs: nextStatus.deeplx.timeoutMs });
      setChannels(channelResponse.channels);
      setGroups(groupResponse.groups);
      setRoutes(routeResponse.routes);
      setJobs(jobResponse.jobs);
      setLogs(logResponse.logs);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function login() {
    setBusy(true);
    try {
      await api("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password })
      });
      setAuthenticated(true);
      setPassword("");
      await reloadAll();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    await api("/api/auth/logout", { method: "POST" });
    setAuthenticated(false);
  }

  async function syncChannels() {
    await mutate(async () => {
      const response = await api<{ channels: DiscordSource[] }>("/api/channels/sync", { method: "POST" });
      setChannels(response.channels);
      await reloadAll();
    }, "Discord 来源已同步");
  }

  async function saveDiscordSettings() {
    await mutate(async () => {
      const response = await api<{ discord: StatusResponse["discord"] }>("/api/settings/discord", {
        method: "PATCH",
        body: JSON.stringify({ guildId: guildForm })
      });
      setStatus((current) => (current ? { ...current, discord: response.discord } : current));
      await reloadAll();
    }, "监听服务器已更新，Discord 连接已重启");
  }

  async function saveNapCatSettings() {
    await mutate(async () => {
      const response = await api<{ napcat: StatusResponse["napcat"] }>("/api/settings/napcat", {
        method: "PATCH",
        body: JSON.stringify(napcatForm)
      });
      setStatus((current) => (current ? { ...current, napcat: response.napcat } : current));
      setNapcatForm({ endpoint: response.napcat.endpoint, accessToken: "", clearAccessToken: false });
      await reloadAll();
    }, "NapCat 配置已保存");
  }

  async function saveDeepLxSettings() {
    await mutate(async () => {
      const response = await api<{ deeplx: StatusResponse["deeplx"] }>("/api/settings/deeplx", {
        method: "PATCH",
        body: JSON.stringify(deeplxForm)
      });
      setStatus((current) => (current ? { ...current, deeplx: response.deeplx } : current));
      setDeeplxForm({ endpoint: response.deeplx.endpoint, apiKey: "", clearApiKey: false, timeoutMs: response.deeplx.timeoutMs });
      await reloadAll();
    }, "DeepLX 配置已保存");
  }

  async function saveGroup() {
    await mutate(async () => {
      const response = await api<{ groups: QqGroup[] }>("/api/groups", {
        method: "POST",
        body: JSON.stringify({ ...groupForm, isActive: true })
      });
      setGroups(response.groups);
      setGroupForm({ groupId: "", name: "" });
      await reloadAll();
    }, "QQ群配置已保存");
  }

  async function fetchNapCatGroups() {
    const response = await api<{ groups: NapCatGroup[] }>("/api/napcat/groups");
    setNapcatGroups(response.groups);
    return response.groups;
  }

  async function loadNapCatGroups() {
    await mutate(async () => {
      await fetchNapCatGroups();
    }, "已获取当前 NapCat QQ群列表");
  }

  async function importNapCatGroups(groupsToImport: NapCatGroup[]) {
    if (groupsToImport.length === 0) {
      return;
    }

    const response = await api<{ groups: QqGroup[] }>("/api/groups/import", {
      method: "POST",
      body: JSON.stringify({
        groups: groupsToImport.map((group) => ({
          groupId: group.groupId,
          name: group.name,
          isActive: true
        }))
      })
    });
    setGroups(response.groups);
    setSelectedNapCatGroupId("");
  }

  async function importSelectedNapCatGroup() {
    await mutate(async () => {
      const selectedGroup = napcatGroups.find((group) => group.groupId === selectedNapCatGroupId);
      if (!selectedGroup) {
        throw new Error("请选择要添加的QQ群");
      }
      await importNapCatGroups([selectedGroup]);
      await reloadAll();
    }, "QQ群已添加");
  }

  async function importAllNapCatGroups() {
    await mutate(async () => {
      const groupsFromNapCat = napcatGroups.length > 0 ? napcatGroups : await fetchNapCatGroups();
      const groupsToImport = groupsFromNapCat.filter((group) => !configuredGroupIds.has(group.groupId));
      await importNapCatGroups(groupsToImport);
      await reloadAll();
    }, "当前 NapCat QQ群已导入");
  }

  async function toggleGroup(group: QqGroup) {
    await mutate(async () => {
      const response = await api<{ groups: QqGroup[] }>(`/api/groups/${group.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !group.isActive })
      });
      setGroups(response.groups);
      await reloadAll();
    }, "QQ群状态已更新");
  }

  async function saveRoute() {
    await mutate(async () => {
      const response = await api<{ routes: ChannelRouteView[] }>("/api/routes/bulk", {
        method: "POST",
        body: JSON.stringify({
          sourceId: routeForm.sourceId,
          qqGroupIds: routeForm.qqGroupIds,
          isActive: true
        })
      });
      setRoutes(response.routes);
      setRouteForm({ sourceId: "", qqGroupIds: [] });
      await reloadAll();
    }, "路由已保存");
  }

  function toggleRouteGroup(groupId: number) {
    setRouteForm((current) => ({
      ...current,
      qqGroupIds: current.qqGroupIds.includes(groupId)
        ? current.qqGroupIds.filter((value) => value !== groupId)
        : [...current.qqGroupIds, groupId]
    }));
  }

  async function toggleRoute(route: ChannelRouteView) {
    await mutate(async () => {
      const response = await api<{ routes: ChannelRouteView[] }>(`/api/routes/${route.id}`, {
        method: "PATCH",
        body: JSON.stringify({ isActive: !route.isActive })
      });
      setRoutes(response.routes);
      await reloadAll();
    }, "路由状态已更新");
  }

  async function deleteRoute(route: ChannelRouteView) {
    await mutate(async () => {
      const response = await api<{ routes: ChannelRouteView[] }>(`/api/routes/${route.id}`, { method: "DELETE" });
      setRoutes(response.routes);
      await reloadAll();
    }, "路由已删除");
  }

  async function retryJob(job: DeliveryJob) {
    await mutate(async () => {
      const response = await api<{ jobs: DeliveryJob[] }>(`/api/jobs/${job.id}/retry`, { method: "POST" });
      setJobs(response.jobs);
      await reloadAll();
    }, "任务已重发");
  }

  async function testNapCat() {
    await mutate(async () => {
      await api("/api/napcat/test", { method: "POST" });
    }, "NapCat 连接正常");
  }

  async function testSend() {
    await mutate(async () => {
      await api("/api/test-send", {
        method: "POST",
        body: JSON.stringify(testForm)
      });
    }, "测试消息已发送");
  }

  async function mutate(action: () => Promise<void>, successMessage: string) {
    setBusy(true);
    try {
      await action();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  if (authenticated === null) {
    return <div className="loading">加载中</div>;
  }

  if (!authenticated) {
    return (
      <main className="login">
        <section className="login-panel">
          <div>
            <p className="eyebrow">DC-Bot Console</p>
            <h1>管理登录</h1>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void login();
            }}
          >
            <label>
              管理员密码
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoFocus />
            </label>
            <button disabled={busy || password.length === 0} type="submit">
              <ShieldCheck size={18} />
              登录
            </button>
          </form>
          {message && <p className="notice error">{message}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <Radio size={24} />
          <div>
            <strong>DC-Bot</strong>
            <span>Discord / NapCat</span>
          </div>
        </div>
        <nav>
          <NavButton active={panel === "overview"} icon={<Activity size={17} />} label="总览" onClick={() => setPanel("overview")} />
          <NavButton active={panel === "sources"} icon={<Server size={17} />} label="来源" onClick={() => setPanel("sources")} />
          <NavButton active={panel === "routes"} icon={<Route size={17} />} label="路由" onClick={() => setPanel("routes")} />
          <NavButton active={panel === "queue"} icon={<ListRestart size={17} />} label="队列" onClick={() => setPanel("queue")} />
          <NavButton active={panel === "logs"} icon={<CheckCircle2 size={17} />} label="日志" onClick={() => setPanel("logs")} />
        </nav>
        <button className="ghost" onClick={() => void logout()}>
          <LogOut size={17} />
          退出
        </button>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p className="eyebrow">Guild {status?.discord.guildId || "未设置"}</p>
            <h1>{panelTitle(panel)}</h1>
          </div>
          <button onClick={() => void reloadAll()} disabled={busy}>
            <RefreshCw size={17} />
            刷新
          </button>
        </header>

        {message && <p className={`notice ${message.includes("错误") || message.includes("failed") ? "error" : ""}`}>{message}</p>}

        {panel === "overview" && status && (
          <section className="grid metrics">
            <Metric label="Discord Token" value={status.discord.tokenConfigured ? "已配置" : "未配置"} />
            <Metric label="监听服务器" value={status.discord.guildId || "未设置"} tone={status.discord.guildId ? "ok" : "warn"} />
            <Metric label="NapCat" value={status.napcat.endpoint} />
            <Metric label="NapCat Token" value={status.napcat.accessTokenConfigured ? "已配置" : "未配置"} tone={status.napcat.accessTokenConfigured ? "ok" : "warn"} />
            <Metric label="DeepLX" value={status.deeplx.endpoint || "未启用"} tone={status.deeplx.endpoint ? "ok" : "warn"} />
            <Metric label="DeepLX API Key" value={status.deeplx.apiKeyConfigured ? "已配置" : "未配置"} tone={status.deeplx.apiKeyConfigured ? "ok" : "warn"} />
            <Metric label="来源" value={String(status.counts.channels)} />
            <Metric label="QQ群" value={String(status.counts.groups)} />
            <Metric label="路由" value={String(status.counts.routes)} />
            <Metric label="待发送" value={String(status.delivery.pending)} tone={status.delivery.pending > 0 ? "warn" : "ok"} />
            <Metric label="失败" value={String(status.delivery.failed)} tone={status.delivery.failed > 0 ? "bad" : "ok"} />
            <Metric label="已发送" value={String(status.delivery.sent)} />
            <section className="wide settings-row">
              <div>
                <strong>监听 Discord 服务器 ID</strong>
                <span>保存后会重启 Discord 连接，并在同步来源时使用新的服务器。</span>
              </div>
              <input
                value={guildForm}
                onChange={(event) => setGuildForm(event.target.value)}
                inputMode="numeric"
                placeholder="输入 Discord Guild / Server ID"
              />
              <button onClick={() => void saveDiscordSettings()} disabled={busy || !guildForm}>
                <RefreshCw size={17} />
                保存并重连
              </button>
            </section>
            <section className="wide settings-card">
              <div className="settings-copy">
                <strong>NapCat 连接</strong>
                <span>保存后立即用于连接测试、测试发送和后续投递。</span>
              </div>
              <label>
                OneBot HTTP 地址
                <input
                  value={napcatForm.endpoint}
                  onChange={(event) => setNapcatForm({ ...napcatForm, endpoint: event.target.value })}
                  placeholder="http://127.0.0.1:3000"
                />
              </label>
              <label>
                Access Token
                <input
                  value={napcatForm.accessToken}
                  onChange={(event) => setNapcatForm({ ...napcatForm, accessToken: event.target.value })}
                  type="password"
                  autoComplete="new-password"
                  disabled={napcatForm.clearAccessToken}
                  placeholder={status.napcat.accessTokenConfigured ? "已配置，留空保留当前 token" : "没有 token 可留空"}
                />
              </label>
              <label className="checkbox-field">
                <input
                  checked={napcatForm.clearAccessToken}
                  onChange={(event) => setNapcatForm({ ...napcatForm, clearAccessToken: event.target.checked, accessToken: "" })}
                  type="checkbox"
                />
                清除已保存 token
              </label>
              <button onClick={() => void saveNapCatSettings()} disabled={busy || !napcatForm.endpoint}>
                <RefreshCw size={17} />
                保存 NapCat
              </button>
            </section>
            <section className="wide settings-card deeplx-card">
              <div className="settings-copy">
                <strong>DeepLX 翻译</strong>
                <span>启用后 Discord 正文会翻译成中文并渲染为图片；失败时只发送 Markdown 原文图片。</span>
              </div>
              <label>
                DeepLX HTTP 地址
                <input
                  value={deeplxForm.endpoint}
                  onChange={(event) => setDeeplxForm({ ...deeplxForm, endpoint: event.target.value })}
                  placeholder="https://api.deeplx.org"
                />
              </label>
              <label>
                API Key
                <input
                  value={deeplxForm.apiKey}
                  onChange={(event) => setDeeplxForm({ ...deeplxForm, apiKey: event.target.value })}
                  type="password"
                  autoComplete="new-password"
                  disabled={deeplxForm.clearApiKey}
                  placeholder={status.deeplx.apiKeyConfigured ? "已配置，留空保留当前 API Key" : "填写 DeepLX_API_KEY"}
                />
              </label>
              <label>
                超时 ms
                <input
                  value={deeplxForm.timeoutMs}
                  onChange={(event) => setDeeplxForm({ ...deeplxForm, timeoutMs: Number(event.target.value) })}
                  type="number"
                  min={1000}
                  max={60000}
                  step={500}
                />
              </label>
              <label className="checkbox-field">
                <input
                  checked={deeplxForm.clearApiKey}
                  onChange={(event) => setDeeplxForm({ ...deeplxForm, clearApiKey: event.target.checked, apiKey: "" })}
                  type="checkbox"
                />
                清除已保存 API Key
              </label>
              <button onClick={() => void saveDeepLxSettings()} disabled={busy}>
                <Languages size={17} />
                保存 DeepLX
              </button>
            </section>
            <section className="wide action-row">
              <button onClick={() => void testNapCat()} disabled={busy}>
                <Activity size={17} />
                测试 NapCat
              </button>
              <select value={testForm.groupId} onChange={(event) => setTestForm({ ...testForm, groupId: event.target.value })}>
                <option value="">选择QQ群</option>
                {groups.map((group) => (
                  <option key={group.id} value={group.groupId}>
                    {group.name} ({group.groupId})
                  </option>
                ))}
              </select>
              <input value={testForm.text} onChange={(event) => setTestForm({ ...testForm, text: event.target.value })} />
              <button onClick={() => void testSend()} disabled={busy || !testForm.groupId || !testForm.text}>
                <Send size={17} />
                测试发送
              </button>
            </section>
          </section>
        )}

        {panel === "sources" && (
          <section className="table-panel">
            <div className="section-head">
              <h2>Discord 频道与线程</h2>
              <button onClick={() => void syncChannels()} disabled={busy}>
                <RefreshCw size={17} />
                同步
              </button>
            </div>
            <DataTable
              headers={["名称", "类型", "ID", "父频道", "状态"]}
              rows={channels.map((channel) => [
                channel.name,
                channel.type === "thread" ? "线程" : "频道",
                channel.id,
                channel.parentId ?? "—",
                channel.isActive ? "活动" : "失效"
              ])}
            />
          </section>
        )}

        {panel === "routes" && (
          <section className="stack">
            <section className="table-panel">
              <div className="section-head">
                <h2>QQ群</h2>
                <button onClick={() => void loadNapCatGroups()} disabled={busy}>
                  <RefreshCw size={17} />
                  获取群列表
                </button>
              </div>
              <form className="group-import-form" onSubmit={(event) => event.preventDefault()}>
                <select value={selectedNapCatGroupId} onChange={(event) => setSelectedNapCatGroupId(event.target.value)}>
                  <option value="">从 NapCat 当前 QQ群中选择</option>
                  {importableNapCatGroups.map((group) => (
                    <option key={group.groupId} value={group.groupId}>
                      {group.name} ({group.groupId})
                    </option>
                  ))}
                </select>
                <button onClick={() => void importSelectedNapCatGroup()} disabled={busy || !selectedNapCatGroupId}>
                  <Plus size={17} />
                  添加选中
                </button>
                <button onClick={() => void importAllNapCatGroups()} disabled={busy}>
                  <RefreshCw size={17} />
                  导入全部
                </button>
              </form>
              <details className="manual-group">
                <summary>手动添加QQ群</summary>
                <form className="inline-form" onSubmit={(event) => event.preventDefault()}>
                  <input placeholder="QQ群号" value={groupForm.groupId} onChange={(event) => setGroupForm({ ...groupForm, groupId: event.target.value })} />
                  <input placeholder="显示名称" value={groupForm.name} onChange={(event) => setGroupForm({ ...groupForm, name: event.target.value })} />
                  <button onClick={() => void saveGroup()} disabled={busy || !groupForm.groupId || !groupForm.name}>
                    <Plus size={17} />
                    保存
                  </button>
                </form>
              </details>
              <div className="list">
                {groups.map((group) => (
                  <div className="list-row" key={group.id}>
                    <div>
                      <strong>{group.name}</strong>
                      <span>{group.groupId}</span>
                    </div>
                    <button className="ghost" onClick={() => void toggleGroup(group)}>
                      {group.isActive ? "停用" : "启用"}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="table-panel">
              <div className="section-head">
                <h2>频道到群路由</h2>
              </div>
              <form className="route-form" onSubmit={(event) => event.preventDefault()}>
                <select value={routeForm.sourceId} onChange={(event) => setRouteForm({ ...routeForm, sourceId: event.target.value })}>
                  <option value="">选择来源</option>
                  {activeChannels.map((channel) => (
                    <option key={channel.id} value={channel.id}>
                      {channel.name} ({channel.type === "thread" ? "线程" : "频道"})
                    </option>
                  ))}
                </select>
                <button onClick={() => void saveRoute()} disabled={busy || !routeForm.sourceId || routeForm.qqGroupIds.length === 0}>
                  <Plus size={17} />
                  保存
                </button>
              </form>
              <div className="choice-grid">
                {activeGroups.map((group) => (
                  <label className="choice-row" key={group.id}>
                    <input
                      checked={routeForm.qqGroupIds.includes(group.id)}
                      onChange={() => toggleRouteGroup(group.id)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{group.name}</strong>
                      <small>{group.groupId}</small>
                    </span>
                  </label>
                ))}
              </div>
              <div className="list">
                {routes.map((route) => (
                  <div className="list-row" key={route.id}>
                    <div>
                      <strong>{route.sourceName ?? route.sourceId}</strong>
                      <span>
                        {route.sourceType ?? "未知"} → {route.groupName} ({route.groupId})
                      </span>
                    </div>
                    <div className="row-actions">
                      <button className="ghost" onClick={() => void toggleRoute(route)}>
                        {route.isActive ? "停用" : "启用"}
                      </button>
                      <button className="icon danger" onClick={() => void deleteRoute(route)} title="删除路由">
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </section>
        )}

        {panel === "queue" && (
          <section className="table-panel">
            <div className="section-head">
              <h2>发送队列</h2>
            </div>
            <div className="list">
              {jobs.map((job) => (
                <div className="list-row job" key={job.id}>
                  <div>
                    <strong>#{job.id} · {job.status}</strong>
                    <span>
                      QQ {job.qqGroupId} · Discord {job.discordMessageId} · 尝试 {job.attemptCount}
                    </span>
                    {job.errorMessage && <small>{job.errorMessage}</small>}
                  </div>
                  <button className="ghost" onClick={() => void retryJob(job)} disabled={busy || job.status === "sent"}>
                    <ListRestart size={16} />
                    重发
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {panel === "logs" && (
          <section className="table-panel">
            <div className="section-head">
              <h2>最近日志</h2>
            </div>
            <div className="log-list">
              {logs.map((log) => (
                <div className={`log-row ${log.level}`} key={log.id}>
                  <span>{new Date(log.createdAt).toLocaleString()}</span>
                  <strong>{log.source}</strong>
                  <div>
                    <p>{log.message}</p>
                    {log.metadata && <pre>{JSON.stringify(log.metadata, null, 2)}</pre>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>
    </main>
  );
}

function NavButton({ active, icon, label, onClick }: { active: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      {label}
    </button>
  );
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" }) {
  return (
    <article className={`metric ${tone ?? ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function DataTable({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="data-table">
      <div className="table-row head">{headers.map((header) => <span key={header}>{header}</span>)}</div>
      {rows.map((row, index) => (
        <div className="table-row" key={`${row.join("-")}-${index}`}>
          {row.map((cell, cellIndex) => (
            <span key={`${cell}-${cellIndex}`}>{cell}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

function panelTitle(panel: Panel) {
  const titles: Record<Panel, string> = {
    overview: "运行总览",
    sources: "来源发现",
    routes: "投递配置",
    queue: "发送队列",
    logs: "事件日志"
  };
  return titles[panel];
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
