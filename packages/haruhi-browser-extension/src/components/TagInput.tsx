import { useState, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { X, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

interface TagInputProps {
  /** 当前已选择的标签 */
  tags: string[];
  /** 所有已知标签（用于 autocomplete） */
  allTags: string[];
  /** 标签变更回调 */
  onTagsChange: (tags: string[]) => void;
  /** 占位文本 */
  placeholder?: string;
  /** 自定义 class */
  className?: string;
}

/**
 * 标签选择组件
 *
 * 已有标签始终可见、可直接点击选择。
 * 底部输入框用于搜索过滤或创建新标签。
 */
export function TagInput({
  tags,
  allTags,
  onTagsChange,
  placeholder = "输入新标签...",
  className,
}: TagInputProps) {
  const [inputValue, setInputValue] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // 可选的标签：未选中 + 按输入过滤
  const availableTags = allTags.filter((t) => {
    if (tags.includes(t)) return false;
    if (!inputValue.trim()) return true;
    return t.toLowerCase().includes(inputValue.toLowerCase());
  });

  // 输入的文字是否可以作为新标签
  const canCreate =
    inputValue.trim().length > 0 &&
    !allTags.some(
      (t) => t.toLowerCase() === inputValue.trim().toLowerCase()
    ) &&
    !tags.includes(inputValue.trim());

  const addTag = useCallback(
    (tag: string) => {
      const trimmed = tag.trim();
      if (trimmed && !tags.includes(trimmed)) {
        onTagsChange([...tags, trimmed]);
      }
      setInputValue("");
      setShowCreate(false);
    },
    [tags, onTagsChange]
  );

  const removeTag = useCallback(
    (index: number) => {
      onTagsChange(tags.filter((_, i) => i !== index));
    },
    [tags, onTagsChange]
  );

  const handleInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && canCreate) {
      e.preventDefault();
      addTag(inputValue);
    } else if (
      e.key === "Backspace" &&
      !inputValue &&
      tags.length > 0
    ) {
      removeTag(tags.length - 1);
    }
  };

  const hasAvailable = availableTags.length > 0;
  const hasSelected = tags.length > 0;

  if (!hasSelected && !hasAvailable && !inputValue) {
    // 无任何标签数据时的简洁态
    return (
      <div className={cn(className)}>
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowCreate(true);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={placeholder}
          className="h-7 text-xs"
        />
        {canCreate && showCreate && (
          <button
            type="button"
            onClick={() => addTag(inputValue)}
            className="flex items-center gap-1 mt-1 text-xs text-green-600 hover:text-green-700 cursor-pointer"
          >
            <Plus className="h-3 w-3" />
            创建 &quot;{inputValue.trim()}&quot;
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      {/* 已选标签 */}
      {hasSelected && (
        <div className="flex flex-wrap gap-1">
          {tags.map((tag, index) => (
            <Badge
              key={tag}
              variant="default"
              className="cursor-default group"
            >
              {tag}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeTag(index);
                }}
                className="ml-0.5 rounded-full p-0.5 hover:bg-primary/20 transition-colors cursor-pointer"
                title="移除标签"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}

      {/* 可选标签面板：始终可见，直接点击添加 */}
      {hasAvailable && (
        <div className="flex flex-wrap gap-1">
          {availableTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => addTag(tag)}
              className="cursor-pointer"
              title={`点击添加标签 "${tag}"`}
            >
              <Badge
                variant="secondary"
                className="hover:bg-primary/20 hover:text-primary transition-colors text-[10px] px-1.5 py-0"
              >
                + {tag}
              </Badge>
            </button>
          ))}
        </div>
      )}

      {/* 新标签输入行 */}
      <div className="flex items-center gap-1">
        <Input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setShowCreate(true);
          }}
          onKeyDown={handleInputKeyDown}
          placeholder={hasSelected ? "继续添加..." : placeholder}
          className="h-7 text-xs flex-1"
        />
        {canCreate && showCreate && (
          <button
            type="button"
            onClick={() => addTag(inputValue)}
            className="shrink-0 flex items-center gap-0.5 text-xs text-green-600 hover:text-green-700 cursor-pointer whitespace-nowrap"
          >
            <Plus className="h-3 w-3" />
            创建
          </button>
        )}
      </div>
    </div>
  );
}
