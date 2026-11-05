# 个人效率工具

基于 pnpm 的 monorepo 项目，包含浏览器扩展等个人效率工具。

## 项目结构

```
.
├── packages/
│   ├── haruhi-browser-extension/    # Chrome 扩展 - 自定义链接功能
│   └── yuki-browser-extension/      # Yuki 阅读助手 - 网页浮窗、字幕、PDF
└── ...
```

## 快速开始

### 安装依赖

```bash
pnpm install
```

### Chrome 扩展开发

```bash
# 开发模式
pnpm --filter haruhi-browser-extension dev

# 构建扩展
pnpm --filter haruhi-browser-extension build

# 或使用快捷命令
pnpm build
```

### 安装 Chrome 扩展

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `packages/haruhi-browser-extension/dist` 目录

## 各子项目说明

- **haruhi-browser-extension**: 自定义链接管理扩展，详见 [packages/haruhi-browser-extension/README.md](packages/haruhi-browser-extension/README.md)
- **yuki-browser-extension**: Yuki 阅读助手，网页右上角浮窗自动抓取并总结，支持字幕、PDF、双模型回退与提示词迁移，详见 [使用说明](packages/yuki-browser-extension/README.md)。
- **AgentPigeon**（agent-pigeon）: 原生 macOS 菜单栏、设置页与 AI Agent Telegram 通知，详见 [使用与维护](packages/agent-pigeon/README.md)。

## Yuki 阅读助手扩展

```bash
pnpm dev:yuki           # 网页预览
pnpm build:yuki         # 构建可加载扩展
pnpm test:yuki          # 核心与迁移测试
pnpm build:all          # 构建所有子项目
```

在 `chrome://extensions/` 加载 `packages/yuki-browser-extension/dist`，配置或迁移模型接口与 API Key。普通网页点击工具栏 Yuki 图标、网页按钮或选区右键入口，即在右上角浮窗自动抓取并总结；Chrome 内部页使用侧栏回退。支持主接口失败后切换独立备用接口，也可处理 YouTube 字幕、导入 PDF、继续问答和导出笔记。

旧 `dev:summarizer`、`build:summarizer`、`test:summarizer` 命令继续作为兼容别名。Yuki 使用长门有希角色头像，生成资源见 [头像说明](packages/yuki-browser-extension/public/icons/README.md)。

详见 [阅读助手说明](packages/yuki-browser-extension/README.md) 与 [发布包分析报告](docs/research/chatgpt-summarize.md)。

## 技术栈

- **包管理器**: pnpm
- **Monorepo 方案**: pnpm workspace
- **构建工具**: Vite
