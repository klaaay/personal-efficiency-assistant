import { useState, useEffect } from "react";

/** 自定义链接 */
export interface CustomLink {
  label: string;
  url: string;
  /** 该链接关联的标签列表，一个链接可关联多个标签 */
  tags: string[];
}

export interface Preferences {
  customLinks: CustomLink[];
  linkOpenBehavior: "newTab" | "currentTab";
  /** 视图模式：flat=平铺, grouped=按标签分组 */
  viewMode: "flat" | "grouped";
  /** 所有已知标签，用于 autocomplete，不丢失已创建但暂未使用的标签 */
  allTags: string[];
  /** 标签排序，决定 popup 中 tag 标签页的展示顺序，不在列表中的新标签自动追加到末尾 */
  tagOrder: string[];
}

const defaultPreferences: Preferences = {
  customLinks: [],
  linkOpenBehavior: "newTab",
  viewMode: "flat",
  allTags: [],
  tagOrder: [],
};

/**
 * 向后兼容迁移：将旧格式数据转换为新格式
 *
 * chrome.storage.sync 有每项 8KB、总计 100KB 的限制。
 * tags 为短字符串数组，对存储影响有限，但大量链接+标签时需注意。
 */
function migratePreferences(raw: Partial<Preferences>): Preferences {
  return {
    linkOpenBehavior: raw.linkOpenBehavior ?? defaultPreferences.linkOpenBehavior,
    viewMode: raw.viewMode ?? defaultPreferences.viewMode,
    allTags: Array.isArray(raw.allTags) ? raw.allTags : defaultPreferences.allTags,
    tagOrder: Array.isArray(raw.tagOrder) ? raw.tagOrder : defaultPreferences.tagOrder,
    customLinks: Array.isArray(raw.customLinks)
      ? raw.customLinks.map((link) => ({
          label: link.label ?? "",
          url: link.url ?? "",
          // 旧数据可能没有 tags 字段
          tags: Array.isArray((link as CustomLink).tags)
            ? (link as CustomLink).tags
            : [],
        }))
      : defaultPreferences.customLinks,
  };
}

export const getPreferences = async (): Promise<Preferences> => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["preferences"], (result) => {
      if (result.preferences) {
        resolve(migratePreferences(result.preferences as Partial<Preferences>));
      } else {
        resolve(defaultPreferences);
      }
    });
  });
};

export const savePreferences = async (
  preferences: Preferences
): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ preferences }, () => {
      resolve();
    });
  });
};

export function usePreferences() {
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const loadPreferences = async () => {
      const prefs = await getPreferences();
      setPreferences(prefs);
    };
    loadPreferences();
  }, []);

  const updatePreference = <T extends keyof Preferences>(
    key: T,
    value: Preferences[T]
  ) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: value,
    }));
    setIsSaved(false);
  };

  const savePreference = async () => {
    await savePreferences(preferences);
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
    }, 2000);
  };

  return {
    preferences,
    isSaved,
    updatePreference,
    savePreference,
  };
}
