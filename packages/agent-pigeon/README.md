# AgentPigeon

将 AI Agent 的任务完成、错误和待处理事件发送到自己的 Telegram。包含原生 macOS 菜单栏、Windows 托盘与设置窗口，以及按事件启动的 Node.js 通知引擎。

[返回仓库概览](../../README.md)

## 功能与运行方式

- 接入 Codex、Claude Code、Gemini CLI 和 Cursor，可显式启用 OpenCode 或接入通用 JSON hook。
- 管理 Telegram 凭据、通知总开关、事件类型和各 Agent 的通知开关。
- 查看最近 30 条投递记录、待发数量，发送测试消息或手动补发。
- 使用 SQLite 去重、限制发送并发，失败通知入队并按分钟补发。

每次 hook 启动短生命周期进程，原生菜单栏 / 托盘是独立进程；退出界面不会停用 hooks 或补发任务。应用不读取 Telegram 更新，也不抢占其他机器人的 webhook。

## 安装要求

| 环境 | 要求与实现 |
| --- | --- |
| 通知引擎 | Node.js 24.15+，使用内置 SQLite |
| macOS | macOS 14+，Xcode Command Line Tools；AppKit / SwiftUI |
| Windows | Windows 10/11，系统 .NET Framework 4.x / WinForms；不需额外安装 .NET SDK |

工作区依赖使用 pnpm 安装。下文未特别注明的命令均在仓库根目录运行。

```sh
pnpm install
```

## 安装应用

### macOS

```sh
pnpm --filter agent-pigeon install:macos
open /Applications/AgentPigeon.app
```

安装命令包含构建，目标为 `/Applications/AgentPigeon.app`。打开设置页填写 Telegram Bot Token / Chat ID，保存并发送测试消息，再在“Agent 接入”中安装或修复所需 hooks。

应用是本机架构、本机签名的构建，不是已公证的跨设备发行包。`runtime.json` 指向仓库源码与当前 Node；移动仓库或改变 Node 路径后需重新安装应用和 hooks。登录启动默认关闭，可在设置页开启。

### Windows

在 Windows 的仓库根目录运行：

```powershell
pnpm --filter agent-pigeon install:windows
```

安装命令包含构建，安装到 `%LOCALAPPDATA%\Programs\AgentPigeon`，并将通知源码复制到安装目录，移动仓库不会使已安装 hooks 失效。开始菜单的 AgentPigeon 打开设置；再次启动会唤起已有窗口。Node 运行时仍使用本机绝对路径，移动或卸载 Node 后需重新安装。

默认接入 Codex / Claude，Gemini / Cursor 需在“Agent 接入”点击“接入全部助手”。补发由当前用户的 `AgentPigeon Retry` 计划任务每分钟执行，在登录会话中运行短生命周期隐藏进程。

```powershell
Get-ScheduledTaskInfo -TaskName 'AgentPigeon Retry'
```

Windows 路径可以包含空格、中文或单引号；hook 命令路径不接受双引号、百分号或换行。

## 配置与日常使用

### 设置页与菜单

| 页面 / 入口 | 操作 |
| --- | --- |
| 通知设置 | 配置 Telegram、总开关、三类事件，保存或保存并发送测试消息 |
| Agent 接入 | 查看 hook 状态，独立启停通知，接入或修复配置 |
| 投递记录 | 查看最近 30 条摘要和结果，刷新或立即补发；Windows 可悬停查看回执 |
| 菜单栏 / 托盘 | 暂停 / 恢复、打开设置、查看记录或补发、退出界面 |

macOS 登录启动位于通知设置，Windows 位于“启动与后台”分组。设置修改需保存；菜单中的暂停立即生效。暂停时忽略新事件，保留已有待发记录。显式测试消息不受总开关或事件筛选影响。

接入状态只表示检测到本机 hook 配置，不表示 Agent 已登录或完成真实回合验收。Gemini、Cursor 等已有会话可能需要重新开始才能加载新 hooks；Agent 本体的启动或鉴权失败需单独处理。

### 配置文件与凭据

macOS 配置位于 `~/.config/agent-pigeon/config.json`，Windows 位于 `%USERPROFILE%\.config\agent-pigeon\config.json`。可在应用中填写，也可手动创建：

```json
{
  "botToken": "自己的 Telegram bot token",
  "chatId": "自己的 chat id",
  "events": ["task-complete", "task-error", "needs-attention"]
}
```

macOS 配置文件权限为 0600、目录为 0700；Windows 安装器用 NTFS ACL 将配置目录限制为当前账户与 SYSTEM 可访问。保存采用原子替换，发现外部修改时拒绝覆盖，需重新载入。macOS 密钥输入使用 SecureField。

`AGENT_PIGEON_HOME` 可将配置与状态切换到隔离目录，兼容旧变量 `AGENT_NOTIFY_HOME`。凭据不放入命令行参数、日志或 Git。消息使用纯文本，只发送状态、项目目录名、会话 ID 与 hook 提供的摘要，不读取完整对话或转发工具参数。

通知进程启用 Node 环境代理支持，可使用 `HTTPS_PROXY`、`HTTP_PROXY` 和 `NO_PROXY`。

### 从 Confirmo 迁移（可选）

退出旧应用，避免其重新写入 hooks；随后导入旧 Telegram 配置：

```sh
node packages/agent-pigeon/src/cli.mjs import-confirmo
```

Windows 安装后也可从安装目录运行对应的 `src/cli.mjs`。目标配置已存在时拒绝覆盖。导入并验证真实回合通知后，再使用旧应用官方卸载程序。安装保留 Codex 的 Computer Use 包装链及第三方 Claude hooks。

## Agent 接入与 CLI

### 支持的事件

| Agent | 配置来源 | 通知范围 |
| --- | --- | --- |
| Codex | `~/.codex/config.toml` notify | `agent-turn-complete`；保留 Computer Use 的 `--previous-notify` 外层 |
| Claude Code | `~/.claude/settings.json` | Stop、StopFailure、Notification、PermissionRequest，以及指定的提问 / 计划工具 |
| Gemini CLI | `~/.gemini/settings.json` | AfterAgent、Notification |
| Cursor | `~/.cursor/hooks.json` | stop 的 completed / error / aborted |
| OpenCode（可选） | `--with-opencode` 安装插件 | session.idle / error、permission.asked、question.asked |
| 其他 Agent | `hook generic` | 统一 JSON 协议 |

默认安装不创建 OpenCode 插件，仅在显式选择时启用。

### macOS CLI 接入

也可绕过原生界面，直接安装 hooks：

```sh
# 预览改动路径与原因，不输出配置或凭据
node packages/agent-pigeon/src/cli.mjs plan --all

# 默认接入 Codex、Claude；--all 额外接入 Gemini、Cursor
node packages/agent-pigeon/src/cli.mjs install --all

# 首次加载按分钟补发任务；已加载时不要重复 bootstrap
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.personal-efficiency.agent-pigeon-retry.plist
```

安装前备份被修改的 Agent 配置，再原子写入。仓库或 Node 路径变化后需重新安装 hooks。

### 诊断、测试与补发

```sh
node packages/agent-pigeon/src/cli.mjs doctor
node --use-env-proxy packages/agent-pigeon/src/cli.mjs test
node --use-env-proxy packages/agent-pigeon/src/cli.mjs retry
```

`test` 会发送真实 Telegram 测试通知。`doctor` 检查配置和状态，`retry` 补发队列中的通知。macOS 还可查看任务状态：

```sh
launchctl print gui/$(id -u)/local.personal-efficiency.agent-pigeon-retry
```

### 通用 hook

其他 Agent 可通过标准输入传递 JSON：

```sh
printf '%s' '{"agent":"my-agent","event":"task-complete","sessionId":"demo","turnId":"turn-1","cwd":"/path/to/project","details":"任务完成"}' |
  node --use-env-proxy /absolute/path/to/packages/agent-pigeon/src/cli.mjs hook generic
```

Codex 使用最后一个 argv 参数中的 JSON，其余适配器通过 stdin。hook 成功或失败均不写 stdout；失败不阻断 Agent，不输出授权决定。输入上限 256 KiB，进程最多 12 秒，单次发送超时 4 秒。

## 投递与资源限制

- SQLite 原子抢占发送租约，跨进程最多两路 Telegram 请求，超额事件入队。
- 有原生 eventId / turnId 时，按 Agent、类型、会话和 ID 去重；无 ID 时使用内容与固定 10 秒时间桶，跨桶可能重复。
- Telegram HTTP 成功且响应包含 `ok:true` 和 `message_id` 才记录成功。网络超时可能发生“服务端已收到、客户端未确认”，补发可能重复，不承诺恰好一次。
- 失败入队；成功 hook 顺便补发一条，按分钟任务每次最多补发十条，单次最长 55 秒。macOS LaunchAgent 没有 `KeepAlive`。
- 最多 1000 条状态记录，优先清理已发送项；全部待发或在途时拒绝新记录，并写固定 stderr 提示，不覆盖未送达通知。
- 已发送超过七天的记录在新事件到达时清理；SQLite 文件页可复用，文件通常不会缩小。连续故障需通过 `doctor` 检查待发队列。

## 回滚（macOS CLI）

备份目录由 `install` 输出。先卸载补发任务，再恢复配置：

```sh
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/local.personal-efficiency.agent-pigeon-retry.plist
node packages/agent-pigeon/src/cli.mjs restore /absolute/path/to/backup
```

恢复会拒绝覆盖安装后用户的新修改，只处理配置文件，不重新安装已卸载的应用。若安装后移除了某个插件，应按备份 manifest 审查并恢复必要项。

## 开发与验证

以下命令在仓库根目录运行：

```sh
pnpm --filter agent-pigeon test           # 自动化测试，不发送真实 Telegram 通知
pnpm --filter agent-pigeon build          # 通知引擎语法检查
pnpm --filter agent-pigeon build:macos    # macOS 原生应用，需在 macOS 运行
pnpm --filter agent-pigeon build:windows  # Windows 原生应用，需在 Windows 运行
```

通用 `build` 不生成原生应用。测试覆盖 Telegram 失败响应与超时、输入边界、stdout 协议、去重与并发、容量、配置保留和回滚。协议模拟、真实 Telegram 投递与 Agent 原生回合验收需分别记录。

| 路径 | 职责 |
| --- | --- |
| `src/cli.mjs` | CLI、hook 入口与运行上限 |
| `src/adapters.mjs` | 各 Agent 事件适配 |
| `src/delivery.mjs` | SQLite 状态、投递与补发 |
| `src/install.mjs` | hook 规划、备份、安装与恢复 |
| `macos/AgentPigeon.swift` | macOS 原生界面 |
| `windows/AgentPigeon.cs` | Windows 原生界面 |
| `scripts/build-macos.mjs` / `scripts/build-windows.mjs` | 平台构建与安装 |
| `windows/install.ps1` | Windows 安装、权限与计划任务 |

macOS 构建产物可用 `--render-preview --preview-path /tmp/preview.png` 渲染虚拟数据预览，不包含真实凭据或消息。菜单栏不轮询数据库或网络，关闭设置窗口会释放视图。

维护和验收历史见 [AgentPigeon 维护记录](../../docs/agentpigeon.md)。[初始协议研究](../../docs/research/confirmo-notifier.md)保留为历史资料，不是产品依赖。
