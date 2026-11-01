# 个人效率工具

基于 pnpm 的 monorepo 项目，包含浏览器扩展等个人效率工具。

## 项目结构

```
.
├── packages/
│   ├── haruhi-browser-extension/    # Chrome 扩展 - 自定义链接功能
│   └── summarizer-browser-extension/ # Chrome 扩展 - 网页、字幕、PDF 阅读助手
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

## 阅读助手扩展

```bash
pnpm dev:summarizer     # 网页预览
pnpm build:summarizer   # 构建可加载扩展
pnpm test:summarizer    # 核心测试
pnpm build:all          # 构建所有子项目
```

在 `chrome://extensions/` 加载 `packages/summarizer-browser-extension/dist`，配置自己的模型接口与 API Key，即可总结网页、选区、YouTube 字幕和 PDF，并继续问答、导出笔记。

详见 [阅读助手说明](packages/summarizer-browser-extension/README.md) 与 [发布包分析报告](docs/research/chatgpt-summarize.md)。

## 技术栈

- **包管理器**: pnpm
- **Monorepo 方案**: pnpm workspace
- **构建工具**: Vite
