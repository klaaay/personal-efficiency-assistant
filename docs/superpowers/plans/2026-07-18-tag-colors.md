# 标签背景色 实现计划

> **对于 agent 型执行者：** 必需子 skill：优先使用 `superpowers-subagent-driven-development`，否则使用 `superpowers-executing-plans` 逐任务实施本计划。所有步骤使用 `- [ ]` 复选框格式追踪。

**目标：** 在设置「标签管理」用原生 color picker 为标签设背景色，popup 筛选 pill 始终显示该色，文字色按亮度自动切换，配置随 `chrome.storage.sync` 多端同步。

**架构：** 在既有 `preferences` 对象增加 `tagColors: Record<string, string>`；纯函数模块负责校验 hex 与文字对比色；`TagsManager` 负责设色/清除；`CustomLinks` 负责渲染。缺省经 `migratePreferences` 与 `background.migrateData` 补成 `{}`，非法值静默丢弃。

**技术栈：** React 18、TypeScript、Tailwind、Vite、Chrome Extension Manifest（`chrome.storage.sync`）

**Spec：** `docs/superpowers/specs/2026-07-18-tag-colors-design.md`

## Global Constraints

- 不引入取色库或预设色板；只用原生 `<input type="color">`
- 不把标签从字符串升级为对象
- 「全部」不参与着色；不改 grouped 视图分组头
- `tagColors` 必须放在单一 `preferences` 内，走现有 sync；缺省/非法不得导致 sync 报错
- 文字色：亮度 ≥ 0.55 用 `#1a1a1a`，否则 `#ffffff`；解析失败用深色字
- 无测试框架：纯逻辑用 `node` 断言脚本验证；UI 用 `pnpm --filter haruhi-browser-extension build` + 手动检查
- 未经用户明确要求不要 `git commit`（计划中的提交步骤视为可选，执行时跳过除非用户要求）

---

## 文件结构

| 文件 | 职责 |
|------|------|
| 新建 `.../src/lib/tagColor.ts` | hex 校验、sanitize、对比文字色 |
| 新建 `.../src/lib/tagColor.verify.mts` | 用 `npx tsx` 跑的断言脚本（项目无 vitest） |
| 修改 `.../src/hooks/usePreferences.ts` | `tagColors` 类型、默认、migrate |
| 修改 `.../src/background.ts` | 安装迁移补 `tagColors` |
| 修改 `.../src/components/SettingsPage/TagsManager.tsx` | picker、清除、预览、重命名/删除联动 |
| 修改 `.../src/components/CustomLinks.tsx` | 加载颜色并应用到 pill |

---

### 任务 1: `tagColor` 纯函数

**文件：**
- 创建：`packages/haruhi-browser-extension/src/lib/tagColor.ts`
- 创建：`packages/haruhi-browser-extension/src/lib/tagColor.verify.mts`

**Interfaces：**
- Consumes: 无
- Produces:
  - `isValidTagColor(value: string): boolean`
  - `sanitizeTagColors(raw: unknown): Record<string, string>`
  - `contrastTextColor(bg: string): string` — 返回 `#1a1a1a` 或 `#ffffff`

- [ ] **步骤 1: 写入验证脚本（先于实现，断言目标行为）**

创建 `packages/haruhi-browser-extension/src/lib/tagColor.verify.mts`：

```ts
import assert from "node:assert/strict";
import {
  isValidTagColor,
  sanitizeTagColors,
  contrastTextColor,
} from "./tagColor.ts";

assert.equal(isValidTagColor("#aabbcc"), true);
assert.equal(isValidTagColor("#AABBCC"), true);
assert.equal(isValidTagColor("#fff"), false);
assert.equal(isValidTagColor("red"), false);

assert.deepEqual(sanitizeTagColors(undefined), {});
assert.deepEqual(sanitizeTagColors(null), {});
assert.deepEqual(sanitizeTagColors("x"), {});
assert.deepEqual(
  sanitizeTagColors({ a: "#112233", b: "nope", c: "#FFEEDD" }),
  { a: "#112233", c: "#ffeedd" }
);

assert.equal(contrastTextColor("#000000"), "#ffffff");
assert.equal(contrastTextColor("#ffffff"), "#1a1a1a");
assert.equal(contrastTextColor("#1a1a1a"), "#ffffff");
assert.equal(contrastTextColor("bad"), "#1a1a1a");

console.log("tagColor.verify: ok");
```

注意：`sanitizeTagColors` 输出统一为小写 `#rrggbb`。

- [ ] **步骤 2: 运行验证，确认失败（模块不存在）**

```bash
cd /Users/wuzhen/CodeProjects/personal-efficiency-assistant/packages/haruhi-browser-extension
npx --yes tsx src/lib/tagColor.verify.mts
```

预期: 失败，提示无法解析 `./tagColor.ts` 或导出不存在。

- [ ] **步骤 3: 实现 `tagColor.ts`**

创建 `packages/haruhi-browser-extension/src/lib/tagColor.ts`：

```ts
const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isValidTagColor(value: string): boolean {
  return HEX6.test(value);
}

/** 将任意输入规范为 Record<tag, #rrggbb 小写>；非法静默丢弃 */
export function sanitizeTagColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || !key) continue;
    if (typeof value !== "string" || !isValidTagColor(value)) continue;
    out[key] = value.toLowerCase();
  }
  return out;
}

/**
 * 根据背景色返回对比文字色。
 * 亮度 = (0.299R + 0.587G + 0.114B) / 255；≥ 0.55 深色字，否则浅色字。
 */
export function contrastTextColor(bg: string): string {
  if (!isValidTagColor(bg)) return "#1a1a1a";
  const hex = bg.slice(1).toLowerCase();
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance >= 0.55 ? "#1a1a1a" : "#ffffff";
}
```

- [ ] **步骤 4: 再跑验证**

```bash
cd /Users/wuzhen/CodeProjects/personal-efficiency-assistant/packages/haruhi-browser-extension
npx --yes tsx src/lib/tagColor.verify.mts
```

预期: 打印 `tagColor.verify: ok`

- [ ] **步骤 5:（可选）提交**

仅在用户要求提交时执行。

---

### 任务 2: Preferences 模型与 migrate

**文件：**
- 修改：`packages/haruhi-browser-extension/src/hooks/usePreferences.ts`

**Interfaces：**
- Consumes: `sanitizeTagColors` from `@/lib/tagColor`
- Produces: `Preferences.tagColors: Record<string, string>`；`migratePreferences` 始终返回含合法 `tagColors` 的对象

- [ ] **步骤 1: 扩展类型与默认值**

在 `Preferences` 接口增加：

```ts
  /** 标签名 → 背景色 #rrggbb；未设置的标签不出现在此对象中 */
  tagColors: Record<string, string>;
```

在 `defaultPreferences` 增加：

```ts
  tagColors: {},
```

- [ ] **步骤 2: 更新 `migratePreferences`**

文件顶部增加：

```ts
import { sanitizeTagColors } from "@/lib/tagColor";
```

在 `migratePreferences` 的 return 对象中增加一行（与其它字段并列）：

```ts
    tagColors: sanitizeTagColors(raw.tagColors),
```

完整 `migratePreferences` 应变为：

```ts
function migratePreferences(raw: Partial<Preferences>): Preferences {
  return {
    linkOpenBehavior: raw.linkOpenBehavior ?? defaultPreferences.linkOpenBehavior,
    viewMode: raw.viewMode ?? defaultPreferences.viewMode,
    allTags: Array.isArray(raw.allTags) ? raw.allTags : defaultPreferences.allTags,
    tagOrder: Array.isArray(raw.tagOrder) ? raw.tagOrder : defaultPreferences.tagOrder,
    tagColors: sanitizeTagColors(raw.tagColors),
    customLinks: Array.isArray(raw.customLinks)
      ? raw.customLinks.map((link) => ({
          label: link.label ?? "",
          url: link.url ?? "",
          tags: Array.isArray((link as CustomLink).tags)
            ? (link as CustomLink).tags
            : [],
        }))
      : defaultPreferences.customLinks,
  };
}
```

- [ ] **步骤 3: 类型检查**

```bash
cd /Users/wuzhen/CodeProjects/personal-efficiency-assistant/packages/haruhi-browser-extension
pnpm exec tsc --noEmit
```

预期: 可能因其它文件尚未使用 `tagColors` 而仍通过；若有构造 `Preferences` 字面量缺字段的错误，在后续任务补全。当前文件本身应无错。

- [ ] **步骤 4:（可选）提交** — 仅用户要求时。

---

### 任务 3: background 安装迁移

**文件：**
- 修改：`packages/haruhi-browser-extension/src/background.ts`

**Interfaces：**
- Consumes: 无（background 内联与 `sanitizeTagColors` 同等的最小补全，或动态 import——本扩展 background 保持简单，**内联**补 `{}` 即可；完整清洗仍由读路径 `migratePreferences` 负责）
- Produces: 安装/更新后若缺 `tagColors` 则写入 `tagColors: {}`

- [ ] **步骤 1: 在 `migrateData` 中于 `tagOrder` 补全之后增加**

```ts
  // 补充 tagColors
  if (
    !migrated.tagColors ||
    typeof migrated.tagColors !== "object" ||
    Array.isArray(migrated.tagColors)
  ) {
    migrated.tagColors = {};
    changed = true;
  }
```

放在「补充 tagOrder」块之后、「补充每个链接的 tags」之前。

- [ ] **步骤 2: 构建 background**

```bash
cd /Users/wuzhen/CodeProjects/personal-efficiency-assistant
pnpm --filter haruhi-browser-extension build
```

预期: `tsc && vite build` 成功退出码 0。

- [ ] **步骤 3:（可选）提交** — 仅用户要求时。

---

### 任务 4: TagsManager 设色 UI

**文件：**
- 修改：`packages/haruhi-browser-extension/src/components/SettingsPage/TagsManager.tsx`

**Interfaces：**
- Consumes: `preferences.tagColors`；`updatePreference("tagColors", ...)`；`contrastTextColor`、`isValidTagColor` from `@/lib/tagColor`
- Produces: 用户可设色/清色；重命名与删除同步 `tagColors`

- [ ] **步骤 1: 增加 import**

```tsx
import { X, Pencil, Check, Trash2, Eraser } from "lucide-react";
import { contrastTextColor } from "@/lib/tagColor";
```

（若已有 `X` 等 import，只追加 `Eraser` 与 `contrastTextColor`。）

- [ ] **步骤 2: 在组件内增加设色/清色辅助函数**

放在 `deleteTag` 之后：

```tsx
  const setTagColor = (tag: string, color: string) => {
    const next = { ...(preferences.tagColors || {}) };
    next[tag] = color.toLowerCase();
    updatePreference("tagColors", next);
  };

  const clearTagColor = (tag: string) => {
    const next = { ...(preferences.tagColors || {}) };
    delete next[tag];
    updatePreference("tagColors", next);
  };
```

- [ ] **步骤 3: 更新 `confirmRename`**

在更新 `tagOrder` 之后、`updatePreference` 调用之前，增加：

```tsx
    const updatedTagColors = { ...(preferences.tagColors || {}) };
    if (oldTag in updatedTagColors) {
      updatedTagColors[newTag] = updatedTagColors[oldTag];
      delete updatedTagColors[oldTag];
    }
```

并增加：

```tsx
    updatePreference("tagColors", updatedTagColors);
```

- [ ] **步骤 4: 更新 `deleteTag`**

在过滤 `tagOrder` 之后增加：

```tsx
    const updatedTagColors = { ...(preferences.tagColors || {}) };
    delete updatedTagColors[tag];
```

并：

```tsx
    updatePreference("tagColors", updatedTagColors);
```

- [ ] **步骤 5: 更新列表行 UI（Badge 预览 + color input + 清除）**

将非编辑态中 Badge 一段替换为（保留 count 文案）：

```tsx
                    <>
                      {(() => {
                        const bg = preferences.tagColors?.[tag];
                        return (
                          <Badge
                            variant="default"
                            className="text-xs"
                            style={
                              bg
                                ? {
                                    backgroundColor: bg,
                                    color: contrastTextColor(bg),
                                    borderColor: bg,
                                  }
                                : undefined
                            }
                          >
                            {tag}
                          </Badge>
                        );
                      })()}
                      <span className="text-xs text-muted-foreground">
                        {count} 个链接
                      </span>
                      <input
                        type="color"
                        value={preferences.tagColors?.[tag] ?? "#ffffff"}
                        onChange={(e) => setTagColor(tag, e.target.value)}
                        className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0"
                        title="设置标签背景色"
                        aria-label={`${tag} 背景色`}
                      />
                    </>
```

在 hover 操作区「重命名」按钮前增加清除按钮：

```tsx
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => clearTagColor(tag)}
                      title="清除颜色"
                      disabled={!preferences.tagColors?.[tag]}
                    >
                      <Eraser className="h-3 w-3" />
                    </Button>
```

- [ ] **步骤 6: 构建**

```bash
pnpm --filter haruhi-browser-extension build
```

预期: 成功。

- [ ] **步骤 7:（可选）提交** — 仅用户要求时。

---

### 任务 5: Popup `CustomLinks` 应用颜色

**文件：**
- 修改：`packages/haruhi-browser-extension/src/components/CustomLinks.tsx`

**Interfaces：**
- Consumes: `prefs.tagColors`；`contrastTextColor` from `@/lib/tagColor`
- Produces: 有色标签始终显示自定义背景；选中用 `ring`/`border-2`/`font-medium` 区分，不用 `bg-primary`

- [ ] **步骤 1: import 与 state**

```tsx
import { contrastTextColor } from "@/lib/tagColor";
```

在组件 state 区增加：

```tsx
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
```

- [ ] **步骤 2: 在 `loadLinks` 与 `handleStorageChange` 中同步**

`loadLinks` 内：

```tsx
      setTagColors(prefs.tagColors || {});
```

`handleStorageChange` 内 `newPrefs` 分支：

```tsx
          setTagColors(newPrefs.tagColors || {});
```

- [ ] **步骤 3: 更新 `SortableTagTab` props 与样式**

将 `SortableTagTab` 签名改为：

```tsx
function SortableTagTab({
  tag,
  index,
  isSelected,
  onClick,
  color,
}: {
  tag: string;
  index: number;
  isSelected: boolean;
  onClick: () => void;
  color?: string;
}) {
```

按钮 `className` / `style`：

```tsx
      <button
        type="button"
        tabIndex={-1}
        onClick={onClick}
        style={
          color
            ? {
                backgroundColor: color,
                color: contrastTextColor(color),
                borderColor: color,
              }
            : undefined
        }
        className={cn(
          "px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer",
          color
            ? isSelected
              ? "ring-2 ring-offset-1 ring-foreground/40 font-medium"
              : "opacity-90 hover:opacity-100"
            : isSelected
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background text-muted-foreground border-border hover:bg-muted"
        )}
      >
        {tag}
        {index < 9 && (
          <span className="ml-1 text-[10px] opacity-50">{index + 1}</span>
        )}
      </button>
```

- [ ] **步骤 4: 调用处传入 color**

```tsx
              {allTags.map((tag, i) => (
                <SortableTagTab
                  key={tag}
                  tag={tag}
                  index={i}
                  isSelected={selectedTag === tag}
                  color={tagColors[tag]}
                  onClick={() =>
                    setSelectedTag(selectedTag === tag ? null : tag)
                  }
                />
              ))}
```

「全部」按钮保持不变，不传颜色。

- [ ] **步骤 5: 构建**

```bash
pnpm --filter haruhi-browser-extension build
```

预期: 成功。

- [ ] **步骤 6:（可选）提交** — 仅用户要求时。

---

### 任务 6: 手动验收清单

**文件：** 无新代码（除非构建失败需修）

- [ ] **步骤 1: 全量构建**

```bash
cd /Users/wuzhen/CodeProjects/personal-efficiency-assistant
pnpm --filter haruhi-browser-extension build
```

预期: 退出码 0。

- [ ] **步骤 2: 再跑纯函数验证**

```bash
cd packages/haruhi-browser-extension
npx --yes tsx src/lib/tagColor.verify.mts
```

预期: `tagColor.verify: ok`

- [ ] **步骤 3: Chrome 手动检查（加载 `packages/haruhi-browser-extension/dist`）**

1. 旧数据无 `tagColors`：打开设置与 popup，控制台无报错，标签样式与改前一致  
2. 标签管理：为某标签取色 → 保存 → popup 该 pill 背景变更，深底浅字 / 浅底深字正确  
3. 清除颜色 → 保存 → 恢复默认样式  
4. 重命名带色标签 → 新名字仍带原色；删除标签 → `tagColors` 无残留（可在扩展 Application → Storage 查看 `preferences`）  
5. 筛选点击有色标签：仍可过滤；选中用 ring 区分，背景色不丢

- [ ] **步骤 4:（可选）提交全部改动** — 仅用户要求时。

---

## 自审

| Spec 项 | 对应任务 |
|---------|----------|
| `tagColors` 模型 + 默认 `{}` | 任务 2 |
| migrate 非法丢弃、缺省安全 | 任务 1 `sanitizeTagColors` + 任务 2 |
| background 补默认 | 任务 3 |
| TagsManager picker / 清除 / 预览 | 任务 4 |
| 重命名/删除联动颜色 | 任务 4 |
| popup 始终着色 + 自动文字色 | 任务 1 + 5 |
| 「全部」不着色 | 任务 5 |
| sync 多端 | 随 `preferences`，任务 2–5 无旁路存储 |
| 验收 | 任务 6 |

无 TBD；函数名与路径在全文一致。
