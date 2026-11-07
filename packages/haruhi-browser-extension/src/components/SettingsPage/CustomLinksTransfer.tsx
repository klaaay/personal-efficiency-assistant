import { useRef, type ChangeEvent } from "react";
import { Download, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CustomLink, Preferences } from "@/hooks/usePreferences";

interface CustomLinksTransferProps {
  preferences: Preferences;
  updatePreference: <T extends keyof Preferences>(
    key: T,
    value: Preferences[T]
  ) => void;
}

export function CustomLinksTransfer({
  preferences,
  updatePreference,
}: CustomLinksTransferProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
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
    <div className="flex shrink-0 items-center justify-end gap-2 self-end sm:self-auto">
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
      {/* 隐藏的文件输入框 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
