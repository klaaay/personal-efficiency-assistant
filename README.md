# 个人效率助手

个人效率工具集合，使用 pnpm workspace 管理。各子项目独立构建和使用，覆盖链接管理、内容阅读与 AI Agent 任务通知。

## 子项目

| 项目 | 用途 | 运行环境 | 文档 |
| --- | --- | --- | --- |
| Haruhi | 自定义链接管理、搜索、标签分类与配置同步 | Chrome 扩展 | [安装、使用与开发](packages/haruhi-browser-extension/README.md) |
| Yuki 阅读助手 | 网页、YouTube 字幕与 PDF 总结，内容问答和双模型接口回退 | Chrome 扩展 | [安装、配置与开发](packages/yuki-browser-extension/README.md) |
| AgentPigeon | 将 AI Agent 的任务完成、错误及待处理事件发送到 Telegram | macOS 菜单栏 / Windows 托盘 / Node.js CLI | [安装、接入与维护](packages/agent-pigeon/README.md) |

## 开始使用

准备 Node.js 与 pnpm。若需要运行全部子项目，使用 Node.js 24.15+；原生桌面应用的构建要求见对应子项目文档。

在仓库根目录安装工作区依赖：

```sh
pnpm install
```

随后按上方文档选择需要的工具。安装扩展、填写模型接口、接入 Agent 和配置 Telegram 的步骤均在对应 package 的 README 中。

## 仓库结构

```text
.
├── packages/
│   ├── haruhi-browser-extension/  # Haruhi 链接管理扩展
│   ├── yuki-browser-extension/    # Yuki 阅读助手扩展
│   └── agent-pigeon/              # AgentPigeon 通知应用与 CLI
├── docs/                          # 跨项目设计记录、研究与历史维护资料
├── package.json                   # 工作区快捷命令
└── pnpm-workspace.yaml            # 子项目声明
```

根 README 提供项目概览和入口；每个 `packages/<项目>/README.md` 维护该项目的功能、安装、配置、使用与开发说明。补充文档由子项目 README 链接。

## 工作区开发

以下命令均在仓库根目录运行：

```sh
pnpm --filter <包名> <脚本名>  # 执行指定子项目的脚本
pnpm build:all                # 构建全部子项目
```

包名和可用脚本见各子项目 README 与 `package.json`。`pnpm dev`、`pnpm build` 默认指向 Haruhi；`pnpm build:all` 对 AgentPigeon 执行通知引擎语法检查，原生 macOS / Windows 应用需在对应平台单独构建。

本地截图、验证日志和临时配置保存在已被 Git 忽略的 `.local/`，构建产物保存在各 package 的 `dist/`。
