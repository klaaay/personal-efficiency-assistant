/**
 * Haruhi Background Service Worker
 *
 * 处理扩展安装/更新时的数据迁移。
 * chrome.storage.sync 限额：每项 8KB，总计 512 项，单次写入约 100KB。
 * 标签数据为短字符串数组，正常使用情况下不会超限。
 */

/**
 * 数据迁移：确保旧数据兼容新格式
 */
async function migrateData() {
  const result = await chrome.storage.sync.get(["preferences"]);
  const prefs = result.preferences;

  if (!prefs) return;

  let changed = false;
  const migrated = { ...prefs };

  // 补充 viewMode 默认值
  if (!migrated.viewMode) {
    migrated.viewMode = "flat";
    changed = true;
  }

  // 补充 allTags
  if (!Array.isArray(migrated.allTags)) {
    migrated.allTags = [];
    changed = true;
  }

  // 补充每个链接的 tags 字段
  if (Array.isArray(migrated.customLinks)) {
    const tagsFromLinks = new Set<string>(migrated.allTags || []);
    migrated.customLinks = migrated.customLinks.map(
      (link: { label?: string; url?: string; tags?: string[] }) => {
        if (!Array.isArray(link.tags)) {
          changed = true;
          return { label: link.label ?? "", url: link.url ?? "", tags: [] };
        }
        link.tags.forEach((t: string) => tagsFromLinks.add(t));
        return { label: link.label ?? "", url: link.url ?? "", tags: link.tags };
      }
    );
    migrated.allTags = Array.from(tagsFromLinks).sort();
  }

  if (changed) {
    console.log("[Haruhi] 数据迁移完成");
    await chrome.storage.sync.set({ preferences: migrated });
  }
}

chrome.runtime.onInstalled.addListener((details) => {
  console.log("[Haruhi] Extension installed/updated:", details.reason);
  migrateData();
});

export {};
