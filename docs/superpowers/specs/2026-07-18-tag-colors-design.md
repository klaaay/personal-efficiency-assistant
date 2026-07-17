# 标签背景色设计

日期：2026-07-18  
范围：`packages/haruhi-browser-extension`  
状态：待审阅

## 目标

在设置页「标签管理」为每个标签设置背景色；popup 筛选 pill 始终显示该色。文字色按背景亮度自动选深色或浅色。配置随现有 `preferences` 走 `chrome.storage.sync` 多端同步。

## 非目标

- 不为「全部」设色
- 不引入取色库或预设色板
- 不把标签模型从字符串升级为对象
- 不改 grouped 视图分组头样式（本次仅 popup flat 筛选 pill + 设置页预览）

## 数据模型

在 `Preferences`（`src/hooks/usePreferences.ts`）增加：

```ts
/** 标签名 → 背景色 #rrggbb；未设置的标签不出现在此对象中 */
tagColors: Record<string, string>;
```

默认值：`tagColors: {}`。

### 迁移与缺省安全

两处都要兼容缺省，避免 sync 读写因缺字段报错：

1. `migratePreferences`：若 `tagColors` 缺失或非对象，设为 `{}`；过滤掉非 `#rrggbb`（大小写均可）的非法值。
2. `background.ts` 的 `migrateData`：同样补默认 `tagColors: {}`。

旧设备/旧版本无此字段时，读侧补默认即可正常工作；写回时带上空对象或已有映射，不依赖字段必已存在。

### 生命周期

| 操作 | `tagColors` 行为 |
|------|------------------|
| 设色 | `tagColors[tag] = "#rrggbb"` |
| 清除颜色 | `delete tagColors[tag]` |
| 重命名 | 将旧 key 的值迁到新 key，删除旧 key |
| 删除标签 | 删除对应 key |

重命名/删除已在 `TagsManager` 同步 `customLinks`、`allTags`、`tagOrder`；本次一并处理 `tagColors`。

## 设置 UI

文件：`src/components/SettingsPage/TagsManager.tsx`

每行标签旁增加原生 `<input type="color">`：

- 有色：`value` 为该色
- 无色：`value` 用 `#ffffff` 作取色器占位；逻辑上仍视为「未设色」，直到用户主动改色并保存
- 变更只更新本地 `preferences`；点「保存设置」写入 `chrome.storage.sync`
- 提供「清除颜色」操作，恢复默认 pill 样式
- 行内 `Badge` 预览使用同一背景色与自动文字色

## Popup 展示

文件：`src/components/CustomLinks.tsx`

- 加载并监听 `preferences.tagColors`
- 有色标签：`backgroundColor` 用自定义色；文字色由亮度函数决定；边框可用同色或略深
- 无色标签：保持现有 Tailwind 默认样式（选中 `primary` / 未选中白底）
- 「全部」不着色
- 有自定义色时，筛选选中不切换为主题 primary；用边框加粗或字重区分选中即可

### 文字色算法

小工具函数（如 `src/lib/utils.ts` 或同目录旁）：

1. 解析 `#rrggbb` → RGB
2. 相对亮度（近似）：`(0.299*R + 0.587*G + 0.114*B) / 255`
3. 亮度 ≥ 0.55 → 深色字（如 `#1a1a1a`）；否则浅色字（如 `#ffffff`）
4. 解析失败 → 深色字

不引入依赖。

## 同步约束

- `tagColors` 存在单一 `preferences` 对象内，沿用现有 sync 路径
- hex 短字符串，对 8KB/项限额影响可忽略
- 缺省迁移不得抛错；非法值静默丢弃

## 涉及文件

| 文件 | 变更 |
|------|------|
| `src/hooks/usePreferences.ts` | 类型、默认值、`migratePreferences` |
| `src/background.ts` | `migrateData` 补 `tagColors` |
| `src/components/SettingsPage/TagsManager.tsx` | color picker、清除、预览、重命名/删除联动 |
| `src/components/CustomLinks.tsx` | 加载颜色并应用到 pill |
| `src/lib/utils.ts`（或新建小模块） | 亮度 → 文字色 |

## 测试要点

1. 无 `tagColors` 的旧数据：打开设置/popup 不报错，行为与现在一致
2. 设色并保存后，popup pill 显示对应背景与自动文字色
3. 清除颜色后恢复默认样式
4. 重命名后颜色跟到新名字；删除后颜色条目消失
5. 另一端 sync 拉取后颜色一致（依赖 Chrome 账号同步）
6. 非法颜色值被 migrate 丢弃，不写坏 sync
