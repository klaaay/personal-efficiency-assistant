# AgentPigeon 维护记录

AgentPigeon 是独立的本机通知应用，后续按自身版本、功能与验收记录维护。子包目录、包名、CLI 命令与配置目录统一为 `agent-pigeon`。

## 运行结构

- `macos/AgentPigeon.swift`：原生菜单栏与设置窗口，按操作读取状态，不进行定时轮询。
- `src/cli.mjs`：hook、测试、安装和补发命令。菜单栏退出不影响 hook 工作。
- `src/delivery.mjs`：Telegram 投递、全局/Agent 开关、有界队列及跨进程去重。
- `src/install.mjs`：保留第三方配置的接入与回滚。Codex 保留 CUA 通知包装。
- macOS LaunchAgent 每分钟运行一次短生命周期补发任务。

设置文件、凭据、投递状态均保存在用户配置目录，不提交 Git。构建产物在子包 `dist/`；本机安装路径 `/Applications/AgentPigeon.app`。

## 1.2.0 — Windows（2026-11-02）

- 新增 Windows 原生托盘与三页设置界面：通知设置、Agent 接入、投递记录；不使用网页服务或 Electron。按当前显示器 DPI 统一缩放控件树，修复文字放大但间距未缩放的问题。
- 通知总开关位于通知卡片顶部；登录启动独立放在「启动与后台」分组。页面已在本机 150% 缩放下逐页截图检查。
- Windows 构建使用系统 .NET Framework C# 编译器；安装器复制运行文件至 `%LOCALAPPDATA%\Programs\AgentPigeon`，创建开始菜单入口、用户计划任务和配置目录 ACL。Node 运行时仍需保留。
- Windows hooks 使用兼容 cmd.exe / Git Bash 的路径和引号；支持反斜杠路径的 Confirmo 迁移，保留 Codex Computer Use 包装。macOS LaunchAgent 仅在 macOS 安装。
- Windows 本机 38 项自动化测试、语法构建检查通过；包含带空格/单引号路径的真实 cmd.exe 执行、安装幂等、迁移及回滚。Unix mode 断言仅在 Unix 执行；Windows 实际配置 ACL 已确认仅当前用户与 SYSTEM 可访问。
- 真实 Codex 回合通知获得 Telegram 回执 4277；Claude Code 完成回合回执 4279、原生错误通知回执 4278；Windows 设置界面发送测试通知回执 4280。不是仅凭模拟 hook 判定成功。
- Claude 默认 `deepseek-v4-pro[1M]` 的服务通道返回 503/model_not_found；完成回合验收临时使用同服务可用的 `deepseek-flash`，未修改默认模型。
- `AgentPigeon Retry` 计划任务实际运行返回 0，最终无待发消息。Confirmo 官方卸载程序执行完成，进程、主程序及卸载注册项均已消失；旧设置和 hook 备份保留在用户数据目录中。卸载后安装计划为空，Codex/Claude 接入仍然存在。

## 1.1.3

- 浅色模式的内容区与底部操作栏改为 `#F5F5F7`，消除 underPageBackgroundColor 带来的深灰遮罩观感；深色模式继续使用系统窗口背景色。

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
