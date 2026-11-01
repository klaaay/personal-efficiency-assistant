# Confirmo 通知功能逆向与替代

## 目标与边界

2026-11-01 分析本机 Confirmo 1.0.96（Electron 33.2.1），将 Agent hook → Telegram 通知功能独立重建到 `packages/agent-pigeon`（原名 `packages/agent-telegram-notifier`）。不复制原产品的宠物、素材、社区、声音、渲染器、账户服务或监控 UI，也不继承其后台日志轮询和终端控制功能。

## 静态证据

- 输入 `/Applications/Confirmo.app/Contents/Resources/app.asar`，SHA-256 `da50e9e1a34807cc35e6555961f4fc474d270bacfc87ed027c325e638520e9f2`。
- 使用 `reverse-engineer-anything` 的 `analyze_javascript_application`，选择 `package.json` 和 `out/main/index.js`。
- REA 主证据 `ev_8dd9cdbb7dd6bbd48ba3849138dc217f50577b14cb1290abd3ee3dabc05515d5`；摘要证据 `ev_c2671f49bb1e21278f4061a31c368d35f498bdccd2de6546c6a1cbc7d3939ab1`。
- 完整证据存于 Git 忽略的 `.local/confirmo-analysis/rea-evidence.json`；解出的主模块与三个 hook 文件也仅留在该本地目录。
- ASAR 的两个 fsevents 原生成员与声明哈希不符。按 `record-and-continue` 保留为不可信观察；没有执行这些成员。主模块静态语义图达到保留上限，且未选择的 6070 个文件未进行源代码分析，不能声称完成全应用逆向。

从解包的主模块人工核对：

| 观察 | 来源 |
|---|---|
| Claude hook 管理全局 settings.json，并会恢复缺失 hook | 主模块约 9898–10242 行 |
| Codex notify 脚本写 `.confirmo/codex-status`，转发旧 notify | `confirmo-codex-hook.js` |
| OpenCode 插件将 session 事件落盘供状态监控读取 | `confirmo-opencode-plugin.ts` |
| Telegram 配置来自 `confirmo-settings` 的 pushNotifications | 主模块约 23320–23376 行 |
| 事件映射 task-complete / task-error / needs-attention | 主模块约 23388–23535 行 |
| 向 Telegram Bot API sendMessage POST 发送通知 | 主模块约 23536–23555 行 |

上述是发布包观察，不等于所有路径都在运行。新的通知器按这些事件协议独立实现，直接发送，不再先写 Confirmo 状态再轮询读取。

官方协议参考：[Claude hooks](https://code.claude.com/docs/en/hooks)、[Gemini hooks](https://geminicli.com/docs/hooks/reference/)、[Cursor hooks](https://cursor.com/docs/hooks)、[OpenCode plugins](https://opencode.ai/docs/plugins/)。OpenCode question.asked 在本次查到的官方插件事件列表中未明确列出，只提供兼容转发，未声称实机验证。

## 原程序资源观察

Confirmo 的五个进程当时合计约 385 MiB RSS；渲染进程在 20 秒内增加约 3.4 秒 CPU 时间（约 17% 单核），已运行约 21 天。线程采样包含 49 个等待中的 AudioOutputDevice 线程，但这不足以证明 CPU 根因或内存泄漏。新的实现完全不包含 Electron/音频，因此不依赖证明原程序的具体性能缺陷。

## 验收记录

- 34 项自动化测试通过（后续以 `pnpm --filter agent-pigeon test` 实际结果为准），包括真实多子进程去重和全局发送租约。
- 初始配置测试收到 Telegram `message_id=38153`。
- 五类协议事件直接调用 hook 均发送成功；每次耗时 1.12–1.27 秒，CPU 0.08–0.09 秒，峰值 RSS 66.22–66.86 MiB。测试后进程退出，非每个 Agent 常驻一份。
- **Codex 原生回合**：真实 `codex exec`，保留本机 CUA notify 外层，Telegram 收据 `38164`。
- **Claude 原生回合**：真实 `claude -p`，Telegram 收据 `38163`。
- **Gemini**：已安装 hook 命令的 Notification 事件通过真实投递；原生 CLI 被服务端以 `IneligibleTierError / UNSUPPORTED_CLIENT` 拒绝，无法完成模型回合。未绕过认证或迁移账户。
- **Cursor**：已安装 stop hook 的错误事件通过真实投递；原生 `cursor-agent -p` 因尚未登录返回 Authentication required，未完成原生回合，未擅自改变账户。
- **OpenCode**：原二进制签名无效，系统 SIGKILL。用户明确要求本机卸载、不再验收；已通过 `npm uninstall -g opencode-ai --ignore-scripts` 移除，新安装插件也已移出自动加载目录。适配器与插件单元测试保留。

原始资源采样、原生 CLI 日志仅在 `.local/confirmo-analysis/validation/`，不提交私人日志。凭据存于 `~/.config/agent-telegram-notifier/config.json`，未写入源码或本报告。

## 安装与回滚

首次迁移备份：`~/.config/agent-telegram-notifier/backups/2026-11-01T15-25-48.793Z`。原 Codex 是 CUA `--previous-notify` 包装，仅内部 Confirmo 命令被替换；原保存的 `codex-original-notify.json` 本身已含 Confirmo，未用于恢复，避免递归通知链。

LaunchAgent `local.personal-efficiency.agent-notifier-retry` 每 60 秒启动短命补发进程，无 KeepAlive。Telegram 故障会留在本地队列；超过 1000 条且无可淘汰已发送记录时明确报容量错误。消息超时后重试可能重复，不承诺恰好一次。

空队列 `retry` 实测 wall 0.04 秒、CPU 0.03 秒、RSS 峰值约 51 MiB，结束后释放。每分钟一次折合约 0.05% 单核平均 CPU（按该次样本估算），不是持续占用 51 MiB。

## 最终切换

用户在了解 Gemini/Cursor 原生回合鉴权限制后，明确确认按当前验证结果完成替换。

- 自动补发实测：模拟网络失败入队，再由已安装 LaunchAgent 投递成功，Telegram 收据 `38180`，记录 attempts=2；不是仅单元测试。
- 原 Confirmo 正常停止，登录项通过系统 SharedFileList API 精确匹配 `/Applications/Confirmo.app` 删除，复查匹配数量为 0。
- 应用移至 `~/.Trash/Confirmo-20261101-233326.app`，未永久销毁，可恢复。
- `.confirmo` 旧脚本/状态和旧应用数据归档至 `~/.config/agent-telegram-notifier/backups/legacy-confirmo-20261101/`。备份根目录限制为当前用户访问。旧设置已关闭 startAtLogin。
- 新 hook 配置再次执行 `plan --all` 返回空计划，安装幂等；原通知器代码未混入新子包。
- OpenCode 已按用户另行指令卸载；它的历史账户配置未删除。

已有 Agent 进程可能缓存旧 hook 路径。新建会话可加载新配置；如果旧会话不通知，应结束后重新开启，而不是恢复旧 Confirmo 程序。

## AgentPigeon 原生界面（1.1.0）

按用户追加要求，应用命名为 AgentPigeon，新增 Swift / AppKit / SwiftUI 菜单栏与设置窗口，安装于 `/Applications/AgentPigeon.app`。没有重新引入 Electron。此前「无常驻进程」描述仅适用于通知引擎；开启菜单栏应用后存在一个原生进程。

- 36 项 Node 测试通过；新增关闭总通知/单 Agent 后不发送不入队、界面历史记录限长和不返回凭据/完整事件。
- Swift 优化编译、应用本机签名校验通过；虚拟数据渲染预览检查通过。
- 使用原生 UI 工具点击「保存并发送测试消息」，窗口明确显示 Telegram 投递成功。
- UI 关闭 Codex 通知并保存，实际调用发送函数返回 disabled；随后通过 UI 恢复并保存。
- 无效 Chat ID 保存被拒绝，随后重新载入有效配置；配置权限复查为 0600。
- 投递记录页能读取真实通知收据与待发数量；四个 Agent 均检测到现有 hook 配置。
- 空闲 20 秒连续三次采样：CPU 0.0%，累计 CPU 保持 1.94 秒不变，RSS 112384–112416 KiB（约 110 MiB）。不是承诺所有设备/长期运行恒定占用。
- 登录时启动选项已实现，默认关闭；本次未更改用户的登录启动偏好。
