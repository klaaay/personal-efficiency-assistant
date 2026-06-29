import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { X, Pencil, Check, Trash2 } from "lucide-react";
import { Preferences } from "@/hooks/usePreferences";

interface TagsManagerProps {
  preferences: Preferences;
  updatePreference: <T extends keyof Preferences>(
    key: T,
    value: Preferences[T]
  ) => void;
  savePreference: () => void;
}

/**
 * 标签管理面板
 *
 * 集中管理所有标签：查看使用情况、重命名、删除。
 * 数据存储在 chrome.storage.sync，支持跨设备同步。
 */
export function TagsManager({
  preferences,
  updatePreference,
  savePreference,
}: TagsManagerProps) {
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  /** 统计每个标签被多少个链接使用 */
  const tagStats = useMemo(() => {
    const stats = new Map<string, number>();
    (preferences.customLinks || []).forEach((link) => {
      (link.tags || []).forEach((tag) => {
        stats.set(tag, (stats.get(tag) || 0) + 1);
      });
    });
    // 包括 allTags 中暂未被使用的标签
    (preferences.allTags || []).forEach((tag) => {
      if (!stats.has(tag)) {
        stats.set(tag, 0);
      }
    });
    return stats;
  }, [preferences.customLinks, preferences.allTags]);

  const allTagsSorted = useMemo(() => {
    return Array.from(tagStats.entries()).sort((a, b) =>
      a[0].localeCompare(b[0])
    );
  }, [tagStats]);

  /** 开始重命名 */
  const startRename = (tag: string) => {
    setEditingTag(tag);
    setEditValue(tag);
  };

  /** 确认重命名 */
  const confirmRename = (oldTag: string) => {
    const newTag = editValue.trim();
    if (!newTag || newTag === oldTag) {
      cancelRename();
      return;
    }

    // 更新所有链接中的该标签
    const updatedLinks = (preferences.customLinks || []).map((link) => ({
      ...link,
      tags: (link.tags || []).map((t) => (t === oldTag ? newTag : t)),
    }));

    // 更新 allTags
    const updatedAllTags = (preferences.allTags || [])
      .map((t) => (t === oldTag ? newTag : t))
      .filter((t, i, arr) => arr.indexOf(t) === i); // 去重

    // 更新 tagOrder
    const updatedTagOrder = (preferences.tagOrder || []).map((t) =>
      t === oldTag ? newTag : t
    );

    updatePreference("customLinks", updatedLinks);
    updatePreference("allTags", updatedAllTags);
    updatePreference("tagOrder", updatedTagOrder);
    cancelRename();
  };

  const cancelRename = () => {
    setEditingTag(null);
    setEditValue("");
  };

  /** 删除标签：从所有链接中移除 */
  const deleteTag = (tag: string) => {
    const updatedLinks = (preferences.customLinks || []).map((link) => ({
      ...link,
      tags: (link.tags || []).filter((t) => t !== tag),
    }));

    const updatedAllTags = (preferences.allTags || []).filter(
      (t) => t !== tag
    );

    // 从 tagOrder 中移除
    const updatedTagOrder = (preferences.tagOrder || []).filter(
      (t) => t !== tag
    );

    updatePreference("customLinks", updatedLinks);
    updatePreference("allTags", updatedAllTags);
    updatePreference("tagOrder", updatedTagOrder);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>标签管理</CardTitle>
        </div>
      </CardHeader>
      <CardContent>
        {allTagsSorted.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            暂无标签，在自定义链接中添加标签后会自动出现在这里
          </p>
        ) : (
          <div className="space-y-1.5">
            {allTagsSorted.map(([tag, count]) => (
              <div
                key={tag}
                className="flex items-center justify-between bg-muted/50 p-2 rounded-md group"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  {editingTag === tag ? (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") confirmRename(tag);
                          if (e.key === "Escape") cancelRename();
                        }}
                        className="h-6 text-xs flex-1"
                        autoFocus
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => confirmRename(tag)}
                        title="确认"
                      >
                        <Check className="h-3 w-3 text-green-500" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        onClick={cancelRename}
                        title="取消"
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <Badge variant="default" className="text-xs">
                        {tag}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {count} 个链接
                      </span>
                    </>
                  )}
                </div>

                {editingTag !== tag && (
                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => startRename(tag)}
                      title="重命名标签"
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => deleteTag(tag)}
                      title="删除标签"
                    >
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <Button onClick={savePreference} className="mt-4 w-full">
          保存设置
        </Button>
      </CardContent>
    </Card>
  );
}
