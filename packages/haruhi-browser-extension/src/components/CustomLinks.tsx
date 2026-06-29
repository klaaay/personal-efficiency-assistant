import { useState, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getPreferences } from "@/hooks/usePreferences";
import type { CustomLink } from "@/hooks/usePreferences";
import {
  ExternalLink,
  Search,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";

/** 标签分组 */
interface TagGroup {
  tag: string;
  links: CustomLink[];
}

/**
 * 可折叠分组组件
 */
function CollapsibleGroup({
  title,
  count,
  children,
  defaultOpen = true,
}: {
  title: string;
  count: number;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);

  return (
    <div className="border border-border rounded-md overflow-hidden">
      <button
        type="button"
        className="flex items-center justify-between w-full px-3 py-2 bg-muted/50 hover:bg-muted transition-colors cursor-pointer"
        onClick={() => setIsOpen(!isOpen)}
      >
        <div className="flex items-center gap-2">
          {isOpen ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
          <span className="text-sm font-medium">{title}</span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {count}
          </Badge>
        </div>
      </button>
      {isOpen && <div className="p-2">{children}</div>}
    </div>
  );
}

export function CustomLinks() {
  const [links, setLinks] = useState<CustomLink[]>([]);
  const [linkOpenBehavior, setLinkOpenBehavior] = useState<
    "newTab" | "currentTab"
  >("newTab");
  /** 视图模式：flat=tag标签页筛选, grouped=按tag分组折叠 */
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [searchTerm, setSearchTerm] = useState("");
  /** flat 模式下当前选中的 tag 筛选，null 表示"全部" */
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadLinks = async () => {
      const prefs = await getPreferences();
      setLinks(prefs.customLinks || []);
      setLinkOpenBehavior(prefs.linkOpenBehavior || "newTab");
      setViewMode(prefs.viewMode || "flat");
    };

    loadLinks();

    const handleStorageChange = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes.preferences) {
        const newPrefs = changes.preferences.newValue;
        if (newPrefs) {
          setLinks(newPrefs.customLinks || []);
          setLinkOpenBehavior(newPrefs.linkOpenBehavior || "newTab");
          setViewMode(newPrefs.viewMode || "flat");
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // F 快捷键聚焦搜索框，1-9 切换 tag 筛选
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 输入框中不触发快捷键
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      // F 键聚焦搜索框
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      // 1-9 数字键切换 tag（仅在 flat 模式下生效）
      if (viewModeRef.current === "flat") {
        const tags = allTagsRef.current;
        const digit = parseInt(event.key);
        if (digit >= 1 && digit <= 9) {
          event.preventDefault();
          const tag = tags[digit - 1];
          if (tag) {
            // 如果已选中该 tag，则取消选中（回到"全部"）
            setSelectedTag(
              selectedTagRef.current === tag ? null : tag
            );
          }
        }
        // 0 键回到"全部"
        if (event.key === "0") {
          event.preventDefault();
          setSelectedTag(null);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  /** 从所有链接中收集不重复的 tag 列表，按字母排序 */
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    links.forEach((link) => {
      (link.tags || []).forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  }, [links]);

  // 用 ref 保存 allTags，供键盘事件使用（避免闭包过期）
  const allTagsRef = useRef(allTags);
  allTagsRef.current = allTags;
  const selectedTagRef = useRef(selectedTag);
  selectedTagRef.current = selectedTag;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  /** 搜索 + tag 双重过滤 */
  const filteredLinks = useMemo(() => {
    let result = links;

    // flat 模式 tag 筛选
    if (viewMode === "flat" && selectedTag) {
      result = result.filter((link) =>
        (link.tags || []).includes(selectedTag)
      );
    }

    // 搜索过滤
    if (searchTerm) {
      const searchLower = searchTerm.toLowerCase();
      result = result.filter(
        (link) =>
          link.label.toLowerCase().includes(searchLower) ||
          link.url.toLowerCase().includes(searchLower) ||
          (link.tags || []).some((tag) =>
            tag.toLowerCase().includes(searchLower)
          )
      );
    }

    return result;
  }, [links, viewMode, selectedTag, searchTerm]);

  /** grouped 模式：按标签分组 */
  const tagGroups = useMemo((): TagGroup[] => {
    const groupMap = new Map<string, CustomLink[]>();
    const untagged: CustomLink[] = [];

    filteredLinks.forEach((link) => {
      if (!link.tags || link.tags.length === 0) {
        untagged.push(link);
      } else {
        link.tags.forEach((tag) => {
          if (!groupMap.has(tag)) {
            groupMap.set(tag, []);
          }
          groupMap.get(tag)!.push(link);
        });
      }
    });

    const groups: TagGroup[] = [];
    const sortedTags = Array.from(groupMap.keys()).sort();
    sortedTags.forEach((tag) => {
      groups.push({ tag, links: groupMap.get(tag)! });
    });
    if (untagged.length > 0) {
      groups.push({ tag: "未分类", links: untagged });
    }

    return groups;
  }, [filteredLinks]);

  const handleOpenLink = (url: string) => {
    if (linkOpenBehavior === "currentTab") {
      chrome.tabs.update({ url });
    } else {
      chrome.tabs.create({ url });
    }
  };

  /** 渲染单个链接按钮 */
  const renderLinkButton = (link: CustomLink, index: number) => (
    <Button
      key={`${link.url}-${index}`}
      variant="outline"
      size="sm"
      onClick={() => handleOpenLink(link.url)}
      className="flex items-center gap-2 h-auto py-2"
      title={link.url}
    >
      <ExternalLink className="h-4 w-4 shrink-0" />
      <span className="truncate">{link.label}</span>
    </Button>
  );

  const renderLinkGrid = (items: CustomLink[]) => (
    <div className="grid grid-cols-2 gap-2">
      {items.map((link, idx) => renderLinkButton(link, idx))}
    </div>
  );

  if (links.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 mt-4">
        <p className="text-sm text-muted-foreground text-center">
          暂无自定义链接，请在设置中添加
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => chrome.runtime.openOptionsPage()}
        >
          前往设置
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* 搜索框 */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          ref={searchInputRef}
          type="text"
          placeholder="搜索链接... (按 F 键聚焦)"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* flat 模式：Tag 标签页切换 */}
      {viewMode === "flat" && allTags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          <button
            type="button"
            onClick={() => setSelectedTag(null)}
            className={cn(
              "px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer",
              selectedTag === null
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-muted-foreground border-border hover:bg-muted"
            )}
          >
            全部
            <span className="ml-1 text-[10px] opacity-50">0</span>
          </button>
          {allTags.map((tag, i) => (
            <button
              key={tag}
              type="button"
              onClick={() =>
                setSelectedTag(selectedTag === tag ? null : tag)
              }
              className={cn(
                "px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer",
                selectedTag === tag
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:bg-muted"
              )}
            >
              {tag}
              {i < 9 && (
                <span className="ml-1 text-[10px] opacity-50">{i + 1}</span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* 内容区域 */}
      {filteredLinks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <p className="text-sm text-muted-foreground text-center">
            {searchTerm || selectedTag
              ? "未找到匹配的链接"
              : "暂无自定义链接"}
          </p>
        </div>
      ) : viewMode === "grouped" ? (
        /* grouped 模式：按标签分组折叠 */
        <div className="space-y-3">
          {tagGroups.map((group) => (
            <CollapsibleGroup
              key={group.tag}
              title={group.tag}
              count={group.links.length}
              defaultOpen
            >
              {renderLinkGrid(group.links)}
            </CollapsibleGroup>
          ))}
        </div>
      ) : (
        /* flat 模式：平铺网格 */
        <div className="grid grid-cols-2 gap-4">
          {filteredLinks.map((link, index) => renderLinkButton(link, index))}
        </div>
      )}
    </div>
  );
}
