# 会话书柜 · dsh-session-shelf

把 DeepSeek Harness 里「已归档」和「已固定」的会话集中到一块面板里管理：翻看、搜索、分组、恢复、清理。

A DeepSeek Harness plugin that gathers archived and pinned sessions into one panel — browse, search, group, restore, clean up.

- 宿主侧：零依赖 Node 模块，通过官方 `webServer` 服务挂载只读数据接口。
- 客户端：通过官方 `uiWorkspace` 客户端服务执行恢复 / 固定，自己只读文件、绝不直接改登记表。
- 没有运行时依赖，不发网络请求，不监听外网端口。

## 功能

- **两个书架**：`已归档`（从侧栏隐藏的会话）与 `已固定`（收藏，仅标记，不隐藏）。
- **全部视图**：一屏看完所有会话（含未归档），按工作区分组。
- **搜索**：标题、工作区路径、会话 ID 即时过滤。
- **排序**：最近更新 / 最早更新 / 标题 / 创建时间。
- **恢复**：单条或批量取消归档；恢复后自动刷新侧栏。
- **固定**：单条或批量固定 / 取消固定。
- **永久删除**（危险操作，需二次确认）：删除会话日志目录、投影缓存、登记表与归档/固定名单里的引用；默认拒绝删除 120 秒内仍有写入的会话，确认框里可显式强制。删除后会立即通知正在运行的 GUI 与会话内核，被删会话从侧栏当场消失，**无需重启**（见下文「删除为什么能立即生效」）。
- **健康检查**：标出「日志缺失」与会「元数据缓存损坏」；损坏的元数据可一键修复（只清理坏缓存，下次打开会话时自动重建，日志原样保留）。
- **幽灵引用清理**：归档 / 固定名单、工作区成员里指向已不存在会话的残留身份，可一键同步剔除，同时把内核里还挂着的会话对象一并摘除。
- **中英双语**：跟随浏览器语言。

## 安装

要求 DSH ≥ 0.2.1（含 `webServer` 宿主服务与 `uiWorkspace` 客户端服务）。已验证于 DSH 0.2.1-rc.3 / 桌面 44.7.0。

### 方式 A · 本地目录接入 profile

```bash
# 在 profile 目录（如 ~/.dsh/profiles/desktop）：
pnpm add link:/path/to/session-shelf
```

再把 `dsh-session-shelf` 加入该 profile `package.json` 的 `dsh.profile.bundles` 数组，重启 GUI 生效。

### 方式 B · 作为插件装进运行中的实例

在 DSH 的插件管理里把本目录当作 bundle 安装（插件会通过 `dsh.bundle.patch` 自动注册 `session-shelf` 宿主行，客户端面板随之出现）。

### 方式 C · 发布 npm 之后

```bash
dsh plugin add dsh-session-shelf
```

## 使用

左侧竖栏会出现一个书柜图标，点开即打开「会话书柜」主面板。

- 顶部页签切换 `已归档 / 已固定 / 全部`，右侧是搜索框与排序菜单。
- 每行显示标题、工作区路径、更新时间、健康状态；悬停行尾出现「恢复 / 固定 / 删除」。
- 点行首复选框进入多选，底部浮出批量操作条。
- `全部` 视图中行尾另有「归档 / 取消归档」。
- 面板右上角 `⟳` 强制重读磁盘（默认有 1 秒缓存），`✕` 返回对话。

## 数据与安全

只读路径：

| 路径 | 用途 |
| --- | --- |
| `$DSH_HOME/storages/workspace.json` | 归档名单、固定名单、工作区登记表 |
| `$DSH_HOME/storages/session_projcache/sessions/<id>.json` | 标题、`cwd`、创建/更新时间 |
| `$DSH_HOME/sessions/**/<id>/` | 会话日志是否存在（不解析日志内容） |

写入路径：

- 取消归档 / 固定 / 取消固定 → 客户端调用官方 `ctx.uiWorkspace.*` 服务，由宿主完成持久化。
- 永久删除、清理幽灵引用、修复元数据、重置缓存 → 插件自己的 HTTP 路由（见下），同样的请求也只在本机同源 GUI 内可达。

永久删除时：先检查会话是否仍在活跃写入（`session_persistence.stat` 的 `lastModifiedMs`，120 秒窗口），拒绝时返回 `409` 并列出被拒 ID；确认强制删除后依次删除日志目录、投影缓存，最后清掉登记表与归档/固定名单里的引用。

## 删除为什么能立即生效

DSH 的侧栏渲染的是**宿主内存里的会话与工作区登记**，不是每次重新读盘。只删文件的话，进程还挂着那个会话对象，界面上的行就会留到下次重启——这正是「删了还在」的根因。

本插件的删除分三步，全部走官方接口，因此运行时和磁盘始终一致：

1. **先从活动集合里摘掉**：对仍在内核里的会话对象调用内部入口 `sessions.liveEntryFor()` / `sessions.detachEntered()`，把对象移出内存登记（拿不到内部入口时静默跳过，退回「只删文件」）。
2. **再改登记表**：通过 `ctx.workspaceRegistry` 的 `workspace.detachSession()`、`unarchiveSession()`、`unpinSession()` 改内存里的登记表与归档/固定名单——运行时直接改写 `workspace.json` 会被登记域的后续落盘覆盖，所以只走接口。
3. **最后广播**：`ctx.emit('api-session/removed', id)`，这是宿主自己声明的事件，客户端收到后立即从侧栏快照里删掉该行。

两步配合的效果：删完立刻从侧栏消失，刷新后也不会回来。已经因为「只删了文件」而残留的旧行，用面板上的「对账 / 同步幽灵」按钮即可当场摘掉，同样无需重启。

## HTTP 接口

插件路由统一挂在 `/api/session-shelf` 前缀下，仅供客户端使用：

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/state?scope=archived\|pinned\|all` | 会话列表 + 工作区 + 幽灵会话 |
| GET | `/diagnostics` | 运行时长、请求数、内核里的会话数、客户端挂载报告 |
| POST | `/purge` `{ ids, force }` | 永久删除（删文件 → 摘活动对象 → 改登记 → 广播移除） |
| POST | `/detach-ghosts` | 同步幽灵会话：摘掉内核对象与登记残留并广播移除 |
| POST | `/prune-orphans` | 剔除归档/固定名单里的孤儿引用 |
| POST | `/repair-projection` `{ ids }` | 删除损坏的投影缓存 |
| POST | `/reset-cache` `{ scope }` | 丢弃内存缓存 |
| POST | `/client-report` `{ stage, message }` | 客户端挂载/异常上报（便于排障） |

## 兼容性设计

- 宿主侧对 DSH 内部包的引用全部包在可失败解析里：拿不到 `sessionPersistence` 就退化为「不做活跃保护」，其余功能不受影响。
- 客户端不 import 任何 DSH 内部 UI 包，只用挂载器提供的 `react` / `react/jsx-runtime`，样式通过注入 `<style>`，规避主题变量缺失。
- 席位注册放在 `ctx.slots.inject('main', …)` / `ctx.slots.inject('sidebar.panellist', …)` 回调里，宿主未声明对应插槽时静默跳过而不是抛错。

## 目录结构

```
lib/
  shelf.js        读盘、合并、清理（纯函数，便于测试）
  index.js        宿主插件：webServer 路由
  client.js       客户端模块（module-loader 包装的单个工厂）
locale/           zh.json / en.json（面板内文案在 client.js 内联）
test/             node:test 用例，覆盖读盘、删除保护、修复、HTTP 面
scripts/inspect.mjs  排查用：打印本机归档实况
```

## 开发

```bash
node --test test/shelf.test.mjs   # 11 个用例
node scripts/inspect.mjs          # 看看本机现在有什么被归档/固定
```

## 许可

MIT
