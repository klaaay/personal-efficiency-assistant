import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { getPreferences, savePreferences } from "@/hooks/usePreferences";
import type { CustomLink, Preferences } from "@/hooks/usePreferences";
import {
  ExternalLink,
  Search,
  ChevronDown,
  ChevronRight,
  GripVertical,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { contrastTextColor } from "@/lib/tagColor";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";

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

/**
 * 可拖拽的 tag 标签页按钮
 */
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
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <div ref={setNodeRef} style={style} className="flex items-center">
      {/* 拖拽手柄 */}
      <span
        {...attributes}
        {...listeners}
        tabIndex={-1}
        className="cursor-grab active:cursor-grabbing p-0.5 hover:bg-muted-foreground/10 rounded transition-colors shrink-0"
        title="拖拽排序"
      >
        <GripVertical className="h-3 w-3 text-muted-foreground" />
      </span>
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
    </div>
  );
}

export function CustomLinks() {
  const [links, setLinks] = useState<CustomLink[]>([]);
  const [linkOpenBehavior, setLinkOpenBehavior] = useState<
    "newTab" | "currentTab"
  >("newTab");
  const [viewMode, setViewMode] = useState<"flat" | "grouped">("flat");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  /** tag 排序列表 */
  const [tagOrder, setTagOrder] = useState<string[]>([]);
  const [tagColors, setTagColors] = useState<Record<string, string>>({});
  const searchInputRef = useRef<HTMLInputElement>(null);
  /** 保存完整的 preferences 引用，用于拖拽后直接写存储 */
  const prefsRef = useRef<Preferences | null>(null);

  const sensors = useSensors(useSensor(PointerSensor));

  useEffect(() => {
    const loadLinks = async () => {
      const prefs = await getPreferences();
      prefsRef.current = prefs;
      setLinks(prefs.customLinks || []);
      setLinkOpenBehavior(prefs.linkOpenBehavior || "newTab");
      setViewMode(prefs.viewMode || "flat");
      setTagOrder(prefs.tagOrder || []);
      setTagColors(prefs.tagColors || {});
    };

    loadLinks();

    const handleStorageChange = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes.preferences) {
        const newPrefs = changes.preferences.newValue;
        if (newPrefs) {
          prefsRef.current = newPrefs;
          setLinks(newPrefs.customLinks || []);
          setLinkOpenBehavior(newPrefs.linkOpenBehavior || "newTab");
          setViewMode(newPrefs.viewMode || "flat");
          setTagOrder(newPrefs.tagOrder || []);
          setTagColors(newPrefs.tagColors || {});
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  /** 从所有链接中收集不重复的 tag，按 tagOrder 排序 */
  const allTags = useMemo(() => {
    const tagSet = new Set<string>();
    links.forEach((link) => {
      (link.tags || []).forEach((tag) => tagSet.add(tag));
    });

    const all = Array.from(tagSet);

    // 按 tagOrder 排序：有排位的在前，没排位的按字母追加到末尾
    const orderMap = new Map(tagOrder.map((t, i) => [t, i]));
    return all.sort((a, b) => {
      const ai = orderMap.get(a);
      const bi = orderMap.get(b);
      if (ai !== undefined && bi !== undefined) return ai - bi;
      if (ai !== undefined) return -1;
      if (bi !== undefined) return 1;
      return a.localeCompare(b);
    });
  }, [links, tagOrder]);

  // ref 供键盘事件使用
  const allTagsRef = useRef(allTags);
  allTagsRef.current = allTags;
  const selectedTagRef = useRef(selectedTag);
  selectedTagRef.current = selectedTag;
  const viewModeRef = useRef(viewMode);
  viewModeRef.current = viewMode;

  /** 拖拽结束后更新 tagOrder 并持久化 */
  const handleTagDragEnd = useCallback(
    async (event: DragEndEvent) => {
      const { active, over } = event;
      if (!active.id || !over?.id || active.id === over.id) return;

      const oldIndex = allTags.indexOf(active.id as string);
      const newIndex = allTags.indexOf(over.id as string);
      if (oldIndex === -1 || newIndex === -1) return;

      const reordered = arrayMove(allTags, oldIndex, newIndex);
      setTagOrder(reordered);

      // 直接写入 chrome.storage.sync
      const currentPrefs = prefsRef.current;
      if (currentPrefs) {
        const updatedPrefs = { ...currentPrefs, tagOrder: reordered };
        prefsRef.current = updatedPrefs;
        await savePreferences(updatedPrefs);
      }
    },
    [allTags]
  );

  // F 聚焦搜索；搜索框内 Esc / 空格失焦；有筛选时 Esc 退出筛选
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      const inSearch =
        target instanceof HTMLInputElement && target === searchInputRef.current;

      if (inSearch) {
        if (event.key === "Escape" || event.key === " ") {
          event.preventDefault();
          searchInputRef.current?.blur();
        }
        return;
      }

      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        searchInputRef.current?.focus();
        return;
      }

      if (viewModeRef.current === "flat") {
        // Esc：退出当前筛选标签（等同点「全部」/ 按 0）
        if (event.key === "Escape" && selectedTagRef.current !== null) {
          event.preventDefault();
          setSelectedTag(null);
          return;
        }

        const tags = allTagsRef.current;
        const digit = parseInt(event.key);
        if (digit >= 1 && digit <= 9) {
          event.preventDefault();
          const tag = tags[digit - 1];
          if (tag) {
            setSelectedTag(selectedTagRef.current === tag ? null : tag);
          }
        }
        if (event.key === "0") {
          event.preventDefault();
          setSelectedTag(null);
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  /** 搜索 + tag 双重过滤 */
  const filteredLinks = useMemo(() => {
    let result = links;

    if (viewMode === "flat" && selectedTag) {
      result = result.filter((link) => (link.tags || []).includes(selectedTag));
    }

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

  const renderLinkButton = (link: CustomLink, index: number) => (
    <Button
      key={`${link.url}-${index}`}
      variant="outline"
      size="sm"
      onClick={() => handleOpenLink(link.url)}
      className="flex w-full items-center justify-start gap-2 h-auto py-2 text-left"
      title={link.label}
    >
      <ExternalLink className="h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate">{link.label}</span>
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
          placeholder="搜索链接... (F 聚焦，空格失焦)"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* flat 模式：Tag 标签页切换（支持拖拽排序） */}
      {viewMode === "flat" && allTags.length > 0 && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleTagDragEnd}
        >
          <SortableContext
            items={allTags}
            strategy={horizontalListSortingStrategy}
          >
            <div className="flex gap-1.5 flex-wrap items-center">
              {/* "全部" 按钮不可拖拽 */}
              <button
                type="button"
                tabIndex={-1}
                onClick={() => setSelectedTag(null)}
                className={cn(
                  "px-3 py-1 text-xs rounded-full border transition-colors cursor-pointer shrink-0",
                  selectedTag === null
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:bg-muted"
                )}
              >
                全部
                <span className="ml-1 text-[10px] opacity-50">0</span>
              </button>

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
            </div>
          </SortableContext>
        </DndContext>
      )}

      {/* 内容区域 */}
      {filteredLinks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <p className="text-sm text-muted-foreground text-center">
            {searchTerm || selectedTag ? "未找到匹配的链接" : "暂无自定义链接"}
          </p>
        </div>
      ) : viewMode === "grouped" ? (
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
        <div className="grid grid-cols-2 gap-4">
          {filteredLinks.map((link, index) => renderLinkButton(link, index))}
        </div>
      )}
    </div>
  );
}
