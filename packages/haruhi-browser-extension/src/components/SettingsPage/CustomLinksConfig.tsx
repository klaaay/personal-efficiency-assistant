import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, GripVertical, Upload, Download } from "lucide-react";
import { useState, useRef } from "react";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { TagInput } from "@/components/TagInput";
import { Preferences, CustomLink } from "@/hooks/usePreferences";

interface SortableLinkItemProps {
  link: CustomLink;
  index: number;
  allTags: string[];
  onRemove: (index: number) => void;
  onUpdate: (
    index: number,
    field: "label" | "url" | "tags",
    value: string | string[]
  ) => void;
}

function SortableLinkItem({
  link,
  index,
  allTags,
  onRemove,
  onUpdate,
}: SortableLinkItemProps) {
  const [isEditingLabel, setIsEditingLabel] = useState(false);
  const [isEditingUrl, setIsEditingUrl] = useState(false);
  const [editLabel, setEditLabel] = useState(link.label);
  const [editUrl, setEditUrl] = useState(link.url);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `link-${index}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  const handleLabelDoubleClick = () => {
    setIsEditingLabel(true);
    setEditLabel(link.label);
  };

  const handleUrlDoubleClick = () => {
    setIsEditingUrl(true);
    setEditUrl(link.url);
  };

  const handleLabelSave = () => {
    if (editLabel.trim() && editLabel !== link.label) {
      onUpdate(index, "label", editLabel.trim());
    }
    setIsEditingLabel(false);
  };

  const handleUrlSave = () => {
    if (editUrl.trim() && editUrl !== link.url) {
      onUpdate(index, "url", editUrl.trim());
    }
    setIsEditingUrl(false);
  };

  const handleLabelCancel = () => {
    setEditLabel(link.label);
    setIsEditingLabel(false);
  };

  const handleUrlCancel = () => {
    setEditUrl(link.url);
    setIsEditingUrl(false);
  };

  const handleLabelKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleLabelSave();
    } else if (e.key === "Escape") {
      handleLabelCancel();
    }
  };

  const handleUrlKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleUrlSave();
    } else if (e.key === "Escape") {
      handleUrlCancel();
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center justify-between bg-muted p-2 rounded-md"
    >
      <div className="flex items-center gap-2 flex-1 truncate">
        <div
          {...attributes}
          {...listeners}
          tabIndex={-1}
          className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted-foreground/10 rounded transition-colors shrink-0"
          title="拖拽排序"
        >
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </div>
        <div className="flex flex-col truncate flex-1 min-w-0">
          {isEditingLabel ? (
            <div className="flex items-center gap-2">
              <Input
                value={editLabel}
                onChange={(e) => setEditLabel(e.target.value)}
                onKeyDown={handleLabelKeyDown}
                onBlur={handleLabelSave}
                className="h-6 text-sm font-medium"
                autoFocus
              />
            </div>
          ) : (
            <span
              className="font-medium cursor-pointer hover:text-primary transition-colors truncate"
              onDoubleClick={handleLabelDoubleClick}
              title="双击编辑名称"
            >
              {link.label}
            </span>
          )}
          {isEditingUrl ? (
            <div className="flex items-center gap-2">
              <Input
                value={editUrl}
                onChange={(e) => setEditUrl(e.target.value)}
                onKeyDown={handleUrlKeyDown}
                onBlur={handleUrlSave}
                className="h-6 text-xs"
                autoFocus
              />
            </div>
          ) : (
            <span
              className="text-xs text-muted-foreground truncate cursor-pointer hover:text-primary/70 transition-colors"
              onDoubleClick={handleUrlDoubleClick}
              title="双击编辑链接地址"
            >
              {link.url}
            </span>
          )}

          {/* 标签区域 */}
          <div className="mt-1">
            <TagInput
              tags={link.tags || []}
              allTags={allTags}
              onTagsChange={(newTags) =>
                onUpdate(index, "tags", newTags)
              }
              placeholder="添加标签..."
            />
          </div>
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => onRemove(index)}
        title="删除链接"
        className="shrink-0 ml-1"
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}

interface CustomLinksConfigProps {
  preferences: Preferences;
  isPrefSaved: boolean;
  updatePreference: <T extends keyof Preferences>(
    key: T,
    value: Preferences[T]
  ) => void;
  savePreference: () => void;
}

export function CustomLinksConfig({
  preferences,
  isPrefSaved,
  updatePreference,
  savePreference,
}: CustomLinksConfigProps) {
  const [newLink, setNewLink] = useState({ label: "", url: "" });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  /**
   * 计算当前所有标签的并集
   * 包括所有链接已有的标签 + preferences 中记录的历史标签
   */
  const allTags = (() => {
    const tagSet = new Set(preferences.allTags || []);
    (preferences.customLinks || []).forEach((link) => {
      (link.tags || []).forEach((tag) => tagSet.add(tag));
    });
    return Array.from(tagSet).sort();
  })();

  /**
   * 同步 allTags：将所有链接的标签收集到偏好中，确保不会丢失
   */
  const syncAllTags = (links: CustomLink[]) => {
    const tagSet = new Set(preferences.allTags || []);
    links.forEach((link) => {
      (link.tags || []).forEach((tag) => tagSet.add(tag));
    });
    updatePreference("allTags", Array.from(tagSet).sort());
  };

  const handleAddLink = () => {
    if (!newLink.label || !newLink.url) return;

    const updatedLinks: CustomLink[] = [
      { ...newLink, tags: [] },
      ...(preferences.customLinks || []),
    ];

    updatePreference("customLinks", updatedLinks);
    setNewLink({ label: "", url: "" });
  };

  const handleRemoveLink = (index: number) => {
    const updatedLinks = [...(preferences.customLinks || [])];
    updatedLinks.splice(index, 1);
    updatePreference("customLinks", updatedLinks);
  };

  const handleUpdateLink = (
    index: number,
    field: "label" | "url" | "tags",
    value: string | string[]
  ) => {
    const updatedLinks = [...(preferences.customLinks || [])];
    updatedLinks[index] = { ...updatedLinks[index], [field]: value };
    updatePreference("customLinks", updatedLinks);

    // 如果更新的是标签，同步 allTags
    if (field === "tags") {
      syncAllTags(updatedLinks);
    }
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (active.id !== over?.id) {
      const oldIndex = parseInt(active.id.toString().replace("link-", ""));
      const newIndex = parseInt(
        over?.id.toString().replace("link-", "") || "0"
      );

      const updatedLinks = arrayMove(
        preferences.customLinks || [],
        oldIndex,
        newIndex
      );
      updatePreference("customLinks", updatedLinks);
    }
  };

  const handleExport = () => {
    const exportData = {
      version: 2,
      links: preferences.customLinks || [],
    };
    const data = JSON.stringify(exportData, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `custom-links-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);

        let importedLinks: CustomLink[];

        // 兼容新格式 { version, links }
        if (parsed && typeof parsed === "object" && Array.isArray(parsed.links)) {
          importedLinks = parsed.links;
        }
        // 兼容旧格式：直接是数组 [{ label, url }]
        else if (Array.isArray(parsed)) {
          importedLinks = parsed;
        } else {
          alert("导入失败：文件格式不正确");
          return;
        }

        // 验证链接格式
        if (
          !importedLinks.every(
            (link: unknown) =>
              typeof link === "object" &&
              link !== null &&
              typeof (link as CustomLink).label === "string" &&
              typeof (link as CustomLink).url === "string"
          )
        ) {
          alert("导入失败：链接格式不正确");
          return;
        }

        // 为旧数据补充 tags 字段，同时收集所有 tags
        const newAllTags = new Set(preferences.allTags || []);
        const normalizedLinks: CustomLink[] = importedLinks.map((link: any) => {
          const tags = Array.isArray(link.tags) ? link.tags : [];
          tags.forEach((t: string) => newAllTags.add(t));
          return {
            label: link.label,
            url: link.url,
            tags,
          };
        });

        updatePreference("customLinks", normalizedLinks);
        updatePreference("allTags", Array.from(newAllTags).sort());
      } catch {
        alert("导入失败：无法解析 JSON 文件");
      }
    };
    reader.readAsText(file);

    // 重置 input，允许重复选择同一文件
    event.target.value = "";
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>自定义链接</CardTitle>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleImport}
              title="导入链接"
            >
              <Upload className="h-4 w-4 mr-1" />
              导入
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
              disabled={
                !preferences.customLinks ||
                preferences.customLinks.length === 0
              }
              title="导出链接"
            >
              <Download className="h-4 w-4 mr-1" />
              导出
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* 隐藏的文件输入框 */}
        <input
          ref={fileInputRef}
          type="file"
          accept=".json"
          onChange={handleFileChange}
          className="hidden"
        />
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="link-label">链接名称</Label>
              <Input
                id="link-label"
                value={newLink.label}
                onChange={(e) =>
                  setNewLink({ ...newLink, label: e.target.value })
                }
                placeholder="输入链接名称"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="link-url">链接地址</Label>
              <Input
                id="link-url"
                value={newLink.url}
                onChange={(e) =>
                  setNewLink({ ...newLink, url: e.target.value })
                }
                placeholder="输入链接地址"
              />
            </div>
          </div>
          <Button
            onClick={handleAddLink}
            disabled={!newLink.label || !newLink.url}
            className="w-full"
          >
            添加链接
          </Button>

          {preferences.customLinks && preferences.customLinks.length > 0 && (
            <div className="mt-4">
              <h3 className="text-sm font-medium mb-2">已添加链接</h3>
              <p className="text-xs text-muted-foreground mb-3">
                使用拖拽图标可以调整链接顺序，双击链接名称或链接地址可以编辑，点击标签区的输入框可以为链接添加标签
              </p>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={preferences.customLinks.map(
                    (_, index) => `link-${index}`
                  )}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="space-y-2">
                    {preferences.customLinks.map((link, index) => (
                      <SortableLinkItem
                        key={`link-${index}`}
                        link={link}
                        index={index}
                        allTags={allTags}
                        onRemove={handleRemoveLink}
                        onUpdate={handleUpdateLink}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}
        </div>
        <Button onClick={savePreference} className="mt-6 w-full">
          {isPrefSaved ? "已保存" : "保存自定义链接"}
        </Button>
      </CardContent>
    </Card>
  );
}
