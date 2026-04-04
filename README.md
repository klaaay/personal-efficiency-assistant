# 个人效率工具

基于 pnpm 的 monorepo 项目，包含浏览器扩展等个人效率工具。

## 项目结构

```
.
├── packages/
│   └── chrome-extension/    # Chrome 扩展 - 自定义链接功能
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
pnpm --filter chrome-extension dev

# 构建扩展
pnpm --filter chrome-extension build

# 或使用快捷命令
pnpm build
```

### 安装 Chrome 扩展

1. 打开 Chrome 浏览器
2. 访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `packages/chrome-extension/dist` 目录

## 各子项目说明

- **chrome-extension**: 自定义链接管理扩展，详见 [packages/chrome-extension/README.md](packages/chrome-extension/README.md)

## 技术栈

- **包管理器**: pnpm
- **Monorepo 方案**: pnpm workspace
- **构建工具**: Vite
