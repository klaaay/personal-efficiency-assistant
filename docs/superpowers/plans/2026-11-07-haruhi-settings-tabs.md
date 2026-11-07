# Haruhi 设置页 Tabs 实现计划

**目标：** 用顶部图标页签组织偏好设置、自定义链接和标签管理。

**架构：** 在 `SettingsPage` 中添加统一外层卡片及 Base UI Tabs。保持三个面板挂载，继续共享现有偏好 hook。

**技术栈：** React 18、TypeScript、Tailwind CSS 4、Base UI、lucide-react。

## 约束

- 导航位于统一设置卡片顶部左侧，内容在导航下方。
- 保留所有面板挂载，切换不丢失链接输入、重命名编辑和未保存的偏好。
- 不修改存储格式、导入导出格式或保存时机。

## 实施任务

文件：新增 `packages/haruhi-browser-extension/src/components/ui/tabs.tsx`；修改该包的 `package.json`、`src/components/SettingsPage/index.tsx`、`PreferencesConfig.tsx`、`CustomLinksConfig.tsx`、`TagsManager.tsx`。

- [x] 添加 `@base-ui/react`，封装 `Tabs`、`TabsList`、`TabsTab`、`TabsPanel`，沿用 coss Tabs 的指示器 CSS 变量。面板使用 `keepMounted`，隐藏状态使用 `data-hidden:hidden`。
- [x] `SettingsPage` 用 `Card` 包裹 `Tabs defaultValue="preferences"`，添加图标页签并为三个现有组件创建对应面板。
- [x] 将三个面板的根 `Card` 换成 `section`，标题和内容取消多余左右内边距。链接新增表单使用 `grid-cols-1 sm:grid-cols-2`。
- [x] 运行 `pnpm --filter haruhi-browser-extension build`，预期 TypeScript 与 Vite 构建通过。
- [x] 使用现有 Playwright Chromium 在临时扩展配置中检查设计文档中的交互，并保存桌面和手机截图到 `.local/verification/haruhi-settings-tabs/`。
- [x] 检查截图、`git diff --check` 与最终 diff，报告验证结果。

验证结果：生产构建通过；临时 Chromium 扩展环境中的交互检查全部通过，控制台无运行错误；640px、390px 和 320px 宽度均无页面或页签内容溢出。桌面和手机截图已核验，`git diff --check` 通过。

后续布局调整：新增 `CustomLinksTransfer.tsx` 承接原有导入导出逻辑。`SettingsPage` 根据当前页签在导航栏右侧显示工具按钮，小屏幕自动换行。重新验证顶部按钮位置、其他页签隐藏按钮、原生导入文件选择器、导出、编辑保留及窄屏布局，全部通过。
