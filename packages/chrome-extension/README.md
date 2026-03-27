# 自定义链接 Chrome 扩展

简洁的Chrome扩展，用于快速访问自定义链接。

## 功能特性

- ✨ 自定义链接管理
- 🔍 快速搜索链接（按F键聚焦）
- 🎨 简洁美观的界面
- ⚙️ 灵活的设置页面
- 💾 数据自动同步（Chrome Sync）

## 开发

```bash
# 安装依赖
pnpm install

# 开发模式
pnpm dev

# 构建
pnpm build
```

## 安装

1. 运行 `pnpm build` 构建扩展
2. 打开 Chrome 浏览器，访问 `chrome://extensions/`
3. 开启右上角的"开发者模式"
4. 点击"加载已解压的扩展程序"
5. 选择 `dist` 目录

## 使用方法

### 弹窗页面
- 点击扩展图标打开弹窗
- 使用搜索框快速筛选链接
- 按 `F` 键快速聚焦搜索框
- 点击链接在新标签页打开

### 设置页面
- 点击弹窗底部的"⚙️ 设置"按钮
- 添加/编辑/删除自定义链接
- 可设置链接的名称、URL和图标
- 记得点击"保存设置"按钮保存更改

## 项目结构

```
chrome-extension/
├── src/
│   ├── popup/          # 弹窗页面
│   ├── options/        # 设置页面
│   └── background/     # 后台脚本
├── manifest.json       # 扩展配置
└── vite.config.js      # Vite配置
```

## 技术栈

- Vanilla JavaScript
- Chrome Extension Manifest V3
- Vite
- Chrome Storage API
