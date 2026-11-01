# AgentPigeon 维护记录

AgentPigeon 是独立的本机通知应用，后续按自身版本、功能与验收记录维护。子包目录、包名、CLI 命令与配置目录统一为 `agent-pigeon`。

## 运行结构

- `macos/AgentPigeon.swift`：原生菜单栏与设置窗口，按操作读取状态，不进行定时轮询。
- `src/cli.mjs`：hook、测试、安装和补发命令。菜单栏退出不影响 hook 工作。
- `src/delivery.mjs`：Telegram 投递、全局/Agent 开关、有界队列及跨进程去重。
- `src/install.mjs`：保留第三方配置的接入与回滚。Codex 保留 CUA 通知包装。
- macOS LaunchAgent 每分钟运行一次短生命周期补发任务。

设置文件、凭据、投递状态均保存在用户配置目录，不提交 Git。构建产物在子包 `dist/`；本机安装路径 `/Applications/AgentPigeon.app`。

## 1.1.2

- 子包改名为 `packages/agent-pigeon`，同步包名、命令、说明、hook 入口和应用运行时路径。
- 配置与投递历史迁移至 `~/.config/agent-pigeon`；旧数据目录保留兼容符号链接，旧备份仍可访问。
- 补发任务改为 `local.personal-efficiency.agent-pigeon-retry`，卸载旧任务，避免重复补发。
- 安装器识别旧入口与旧 hook 标识，保留 Codex CUA 包装和第三方 hooks；旧环境变量 `AGENT_NOTIFY_HOME` 仍兼容。

## 1.1.1

- 修复侧栏按钮透明区域未参与命中检测：在完整宽度和内边距之后设置矩形 contentShape，保持整行区域可点击。
- 原生 UI 实测「Agent 接入」右侧留白、「投递记录」右下角、「通知设置」左上留白都能正确切换。
- 应用页脚显示版本号，移除与历史实现无关的产品文案。
- 通过真实 `codex exec` 回合和已安装 notify 链再次验证 Telegram 投递；未改动用户的 Agent 开关偏好。

## 1.1.0

- 增加菜单栏、Telegram 设置、Agent 开关和最近投递记录。
- 36 项自动化测试通过；UI 测试发送、开关保存和非法输入拦截通过。
- 本机空闲 20 秒采样 CPU 0.0%，累计 CPU 时间不增长，RSS 约 110 MiB。通知引擎仅在事件/补发发生时启动。
- Gemini/Cursor 的原生回合曾受本机鉴权限制，接入状态仅表示 hook 配置存在；不能把适配器测试视作 Agent 登录成功。
