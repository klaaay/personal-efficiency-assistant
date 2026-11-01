# Agent Telegram 通知器

把 AI Agent 的任务完成、错误、待处理事件发送到自己的 Telegram。独立实现，使用 Node.js 内置模块，无 npm 运行时依赖、Electron、桌面宠物、音频、窗口、自动批准或会话日志扫描。

每次 hook 启动一个短生命周期进程；macOS LaunchAgent 每分钟按需启动补发命令，退出后不占常驻内存。不是聊天机器人，不读取 Telegram 更新，也不抢占其他机器人的 webhook。

## 使用

需要 Node.js 24.15+（使用内置 SQLite），本机验证版本 24.21.0。仓库位置和 Node 路径变动后需要重新安装 hooks。

```sh
pnpm --filter agent-telegram-notifier test
pnpm --filter agent-telegram-notifier build
node packages/agent-telegram-notifier/src/cli.mjs doctor
node --use-env-proxy packages/agent-telegram-notifier/src/cli.mjs test
```

凭据保存在仓库外 `~/.config/agent-telegram-notifier/config.json`（0600），目录 0700。首次可用 `import-confirmo` 从现有 Confirmo 设置迁移，不覆盖已有配置；也可手动创建：

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

安装先备份再原子修改，仅移走已识别的 Confirmo hook，保留其他插件与通知包装。备份目录由 `install` 输出。恢复拒绝覆盖安装后用户的新修改：

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.personal-efficiency.agent-notifier-retry.plist
node packages/agent-telegram-notifier/src/cli.mjs restore /absolute/path/to/backup
```

恢复只处理配置文件，不重新安装已卸载的应用。原 Confirmo 若放入废纸篓，可在需要时单独恢复；不要在新 hooks 生效期间运行旧应用，它会自动修复自己的旧 hooks。OpenCode 插件单独移除后，全量备份恢复会因文件变化保护而拒绝，应按 manifest 审查后恢复必要项。

## 证据与验证

见 [逆向与迁移记录](../../docs/research/confirmo-notifier.md)。测试覆盖 Telegram 失败响应、超时、输入边界、stdout 协议、跨进程去重/并发限制、容量限制、配置保留和回滚。协议适配测试、真实 Telegram 投递与 Agent 原生回合验证分别记录，不把模拟事件当作原生回合。
