# Haruhi 链接管理扩展

用于快速访问常用链接的 Chrome Manifest V3 扩展，支持搜索、多标签分类、拖拽排序与 Chrome Sync 配置同步。

[返回仓库概览](../../README.md)

## 功能

- 添加、编辑、删除链接，设置名称、URL 和多个标签。
- 按名称、URL 和标签搜索，使用标签筛选链接。
- 切换平铺视图或标签分组视图，选择在新标签页或当前标签页打开链接。
- 拖拽调整链接顺序和弹窗中的标签顺序，管理标签名称与颜色。
- 导入、导出链接 JSON，兼容旧版无标签的链接数据。
- 使用 `chrome.storage.sync` 保存配置，在启用 Chrome 同步的环境中同步。

## 安装

需要 Node.js、pnpm 和 Chrome。以下命令在仓库根目录运行：

```sh
pnpm install
pnpm --filter haruhi-browser-extension build
```

1. 打开 `chrome://extensions/`，开启“开发者模式”。
2. 点击“加载已解压的扩展程序”。
3. 选择 `packages/haruhi-browser-extension/dist`。
4. 点击工具栏 Haruhi 图标，打开设置页添加链接并保存。

更新代码后重新构建，再到扩展管理页重新加载 Haruhi。根目录的 `pnpm build` 是本项目构建命令的快捷入口。

## 使用

### 弹窗与快捷键

点击工具栏图标打开弹窗；搜索框筛选链接，标签按钮切换分类。分组视图可展开、收起各组，点击链接按已保存的偏好打开。

| 按键 | 操作 |
| --- | --- |
| `F` | 聚焦搜索框 |
| `E` | 打开设置页 |
| `1`–`9` | 平铺视图中切换对应位置的标签（存在时） |
| `0` | 平铺视图中显示全部标签 |
| `Esc` | 搜索框中失焦；平铺视图非输入状态下退出标签筛选 |

数字键和设置快捷键在文本输入时不触发。搜索框中的空格也可使输入框失焦；输入法组字期间不拦截空格与 `Esc`。

### 设置页

设置页分为三个 Tab，切换时保留当前未保存的编辑：

| Tab | 内容 |
| --- | --- |
| 偏好设置 | 链接打开方式、平铺 / 分组视图 |
| 自定义链接 | 链接名称、URL、标签、拖拽排序，以及导入 / 导出 |
| 标签管理 | 标签重命名、删除和颜色设置 |

修改后点击所在 Tab 的保存按钮。保存会写入整份设置；只有被点击的按钮显示“已保存”。已打开的弹窗会监听保存后的配置变化。

### 导入与导出

“自定义链接”Tab 的“导出”生成 `{ version: 2, links: [...] }` JSON，包含链接及其标签，不包含视图偏好、标签颜色或标签排序。导出使用当前编辑中的链接列表。

导入会替换编辑中的链接列表，并合并已有标签；核对后点击“保存自定义链接”生效。支持上述格式，也支持旧格式 `[{ "label": "名称", "url": "https://example.com" }]`。

## 数据与权限

扩展声明 `storage` 权限，将链接和偏好保存在 `chrome.storage.sync` 的 `preferences` 项。该存储受 Chrome Sync 配额限制：单项约 8 KB、总量约 100 KB；大量链接可能超过单项配额。

## 开发与验证

以下命令在仓库根目录运行：

```sh
pnpm --filter haruhi-browser-extension dev         # Vite 页面预览
pnpm --filter haruhi-browser-extension dev:chrome  # 监听构建，可加载 dist
pnpm --filter haruhi-browser-extension build       # TypeScript 检查与生产构建
pnpm --filter haruhi-browser-extension preview     # 预览已有构建
```

根目录的 `pnpm dev` 同样指向 Haruhi。涉及 Chrome API 的行为应加载 `dist` 验证；监听构建后仍需按需重新加载扩展或重开弹窗。

标签颜色逻辑有独立校验脚本，需要支持 TypeScript 类型擦除的 Node.js（例如 Node.js 24）：

```sh
node packages/haruhi-browser-extension/src/lib/tagColor.verify.mts
```

浏览器回归应检查链接增删改、搜索和快捷键、标签筛选与排序、三个设置 Tab 的保存、JSON 导入导出及刷新后的配置保留。

## 源码与技术栈

```text
haruhi-browser-extension/
├── src/
│   ├── Popup.tsx                  # 工具栏弹窗
│   ├── Settings.tsx               # 独立设置页
│   ├── components/CustomLinks.tsx # 链接展示、搜索与标签筛选
│   ├── components/SettingsPage/   # 三个设置 Tab
│   ├── hooks/usePreferences.ts    # 配置读取、迁移与保存
│   ├── lib/tagColor.ts            # 标签颜色校验与文字对比色
│   └── background.ts              # 安装 / 更新时迁移旧配置
├── popup.html
├── settings.html
├── manifest.json
└── vite.config.ts
```

使用 React、TypeScript、Vite、Tailwind CSS、Radix / Base UI 和 dnd-kit。设置 Tab 的设计与实施历史见[设计记录](../../docs/superpowers/specs/2026-11-07-haruhi-settings-tabs-design.md)和[实施记录](../../docs/superpowers/plans/2026-11-07-haruhi-settings-tabs.md)。
