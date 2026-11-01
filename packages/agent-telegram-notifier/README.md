# AgentPigeon

把 AI Agent 的任务完成、错误、待处理事件发送到自己的 Telegram。包含原生 macOS 菜单栏与设置窗口，以及按事件启动的 Node.js 通知引擎。

每次 hook 启动一个短生命周期进程；macOS LaunchAgent 每分钟按需启动补发命令。菜单栏是单独的原生进程，无定时刷新；退出菜单栏后通知仍然可用。不是聊天机器人，不读取 Telegram 更新，也不抢占其他机器人的 webhook。

## macOS 应用

已安装到 `/Applications/AgentPigeon.app`。macOS 14+，使用系统 AppKit / SwiftUI，不启动本地网页服务器。

- **菜单栏**：暂停/恢复全部通知、打开设置、查看投递记录、退出菜单栏应用。
- **通知设置**：Telegram Bot Token / Chat ID、三类通知开关、保存并发送测试消息、登录时启动。
- **Agent 接入**：查看 Codex、Claude Code、Gemini CLI、Cursor 的 hook 配置，分别启停通知，接入/修复 hooks。
- **投递记录**：最近 30 条摘要、投递结果、待发数量、手动刷新和立即补发。

设置页修改后点「保存设置」；菜单栏暂停立即生效。暂停时忽略新事件并保留已有待发记录。显式测试消息不受总开关/事件筛选影响。接入状态仅表示检测到本机 hook 配置，不代表 Agent 已登录或完成原生回合验收。

凭据使用 SecureField 输入、0600 文件原子写入；遇外部配置变化拒绝覆盖，需重新载入。登录启动默认关闭，可自行开启。关闭窗口释放其视图，菜单栏不会轮询数据库或网络。

```sh
pnpm --filter agent-telegram-notifier build:macos
pnpm --filter agent-telegram-notifier install:macos
open /Applications/AgentPigeon.app
```

构建需要 Xcode Command Line Tools。应用为本机架构并使用本机签名，不是已公证的跨设备发行包；`runtime.json` 指向本仓库和当前 Node，移动仓库/升级 Node 路径后需重建。后端包名和配置目录保留 `agent-telegram-notifier`，兼容已安装 hooks。

原生界面源码在 `macos/AgentPigeon.swift`，构建入口 `scripts/build-macos.mjs`。以 `--render-preview --preview-path /tmp/preview.png` 启动构建产物可渲染虚拟数据预览，不包含真实凭据与消息。

## 使用

需要 Node.js 24.15+（使用内置 SQLite），本机验证版本 24.21.0。仓库位置和 Node 路径变动后需要重新安装 hooks。

```sh
pnpm --filter agent-telegram-notifier test
pnpm --filter agent-telegram-notifier build
node packages/agent-telegram-notifier/src/cli.mjs doctor
node --use-env-proxy packages/agent-telegram-notifier/src/cli.mjs test
```

凭据保存在仓库外 `~/.config/agent-telegram-notifier/config.json`（0600），目录 0700。可在应用设置页填写，也可手动创建：

```json
{
  "botToken": "自己的 Telegram bot token",
  "chatId": "自己的 chat id",
  "events": ["task-complete", "task-error", "needs-attention"]
}
```

不在命令行参数、日志或 Git 中存放 token。`AGENT_NOTIFY_HOME` 可将整个配置与状态目录切换到隔离测试目录。消息使用纯文本，不解释 Markdown；只发送状态、项目目录名、会话 ID 和 hook 明确提供的摘要，不读取完整对话或转发工具参数。

## 接入

```sh
# 只显示路径、原因，不输出配置/凭据
node packages/agent-telegram-notifier/src/cli.mjs plan --all
# 安装 Codex、Claude，--all 额外安装 Gemini、Cursor
node packages/agent-telegram-notifier/src/cli.mjs install --all
# 首次安装补发任务（如果已经加载，不要重复 bootstrap）
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.personal-efficiency.agent-notifier-retry.plist
```

| Agent | 来源 | 通知范围 |
|---|---|---|
| Codex | `~/.codex/config.toml` notify | `agent-turn-complete`；保留 Computer Use 的 `--previous-notify` 外层 |
| Claude Code | `~/.claude/settings.json` | Stop、StopFailure、Notification、PermissionRequest、指定的提问/计划工具 |
| Gemini CLI | `~/.gemini/settings.json` | AfterAgent、Notification |
| Cursor | `~/.cursor/hooks.json` | stop 的 completed/error/aborted |
| OpenCode（可选） | `--with-opencode` 安装插件 | session.idle/error、permission.asked、question.asked |
| 其他 Agent | `hook generic` | 统一 JSON 协议 |

本机按用户要求已卸载 OpenCode；默认安装不会重新创建它的插件。OpenCode 适配保留在源码中供未来显式使用。Gemini、Cursor 等已运行的会话可能要重新开始才能加载新 hooks。某一 Agent 本体启动或鉴权失败时，通知适配器不能修复它。

其他 Agent 可以从自己的 hook 调用（标准输入 JSON）：

```sh
printf '%s' '{"agent":"my-agent","event":"task-complete","sessionId":"demo","turnId":"turn-1","cwd":"/path/to/project","details":"任务完成"}' |
  node --use-env-proxy /absolute/path/to/src/cli.mjs hook generic
```

Codex 使用最后一个 argv 参数中的 JSON；其余通过 stdin。hook 成功或失败均不写 stdout，失败不阻断 Agent、不输出授权决定。输入上限 256 KiB，进程最多 12 秒；发送单次超时 4 秒。启用了 Node 的环境代理支持，可使用已有 `HTTPS_PROXY` / `HTTP_PROXY` / `NO_PROXY`。

## 投递与资源上限

- SQLite 原子抢占发送租约，跨进程最多两路 Telegram 请求；超额事件入队。
- 有原生 eventId/turnId 的事件按 Agent、类型、会话、ID 去重；没有 ID 时按内容和固定 10 秒时间桶去重，跨桶仍可能重复。
- Telegram HTTP 成功且返回 `ok:true`、`message_id` 才记为成功。网络超时存在“服务端已收到但客户端未确认”的不确定性，补发可能重复；不承诺恰好一次。
- 失败入队，成功 hook 顺便补发一条；LaunchAgent 每分钟补发最多十条，单次最多 55 秒。没有 `KeepAlive`，不无限派生进程。
- 最多 1000 条状态记录；优先清理已发送记录。全部为待发/在途时拒绝新记录并写固定 stderr 提示，不静默覆盖未送达通知。连续网络故障会保留待发，需检查 `doctor`。
- 状态目录只保留近期有界通知信息。已发送超过七天的记录在新事件到达时清理；SQLite 文件页可复用，通常不会缩小。

```sh
node --use-env-proxy packages/agent-telegram-notifier/src/cli.mjs retry
launchctl print gui/$(id -u)/local.personal-efficiency.agent-notifier-retry
```

## 回滚

安装先备份再原子修改，保留其他插件与通知包装。备份目录由 `install` 输出。恢复拒绝覆盖安装后用户的新修改：

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.personal-efficiency.agent-notifier-retry.plist
node packages/agent-telegram-notifier/src/cli.mjs restore /absolute/path/to/backup
```

恢复只处理配置文件，不重新安装已卸载的应用。若安装后另行移除了某个插件，全量恢复会触发文件变化保护，应按 manifest 审查后恢复必要项。

## 证据与验证

见 [AgentPigeon 维护记录](../../docs/agentpigeon.md)。测试覆盖 Telegram 失败响应、超时、输入边界、stdout 协议、跨进程去重/并发限制、容量限制、配置保留和回滚。协议适配测试、真实 Telegram 投递与 Agent 原生回合验证分别记录，不把模拟事件当作原生回合。

初始协议研究保留在[历史记录](../../docs/research/confirmo-notifier.md)，不作为产品依赖；`import-confirmo` 仅保留为可选的旧配置导入工具。
