import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getPreferences } from "@/hooks/usePreferences";
import { ExternalLink, Search } from "lucide-react";

export function CustomLinks() {
  const [links, setLinks] = useState<Array<{ label: string; url: string }>>([]);
  const [linkOpenBehavior, setLinkOpenBehavior] = useState<
    "newTab" | "currentTab"
  >("newTab");
  const [searchTerm, setSearchTerm] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const loadLinks = async () => {
      const prefs = await getPreferences();
      setLinks(prefs.customLinks || []);
      setLinkOpenBehavior(prefs.linkOpenBehavior || "newTab");
    };

    loadLinks();

    // 监听存储变化，实时同步
    const handleStorageChange = (changes: {
      [key: string]: chrome.storage.StorageChange;
    }) => {
      if (changes.preferences) {
        const newPrefs = changes.preferences.newValue;
        if (newPrefs) {
          setLinks(newPrefs.customLinks || []);
          setLinkOpenBehavior(newPrefs.linkOpenBehavior || "newTab");
        }
      }
    };

    chrome.storage.onChanged.addListener(handleStorageChange);

    return () => {
      chrome.storage.onChanged.removeListener(handleStorageChange);
    };
  }, []);

  // F 快捷键聚焦搜索框
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 输入框中不触发快捷键
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === "f" || event.key === "F") {
        event.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const filteredLinks = links.filter((link) => {
    if (!searchTerm) return true;

    const searchLower = searchTerm.toLowerCase();
    return (
      link.label.toLowerCase().includes(searchLower) ||
      link.url.toLowerCase().includes(searchLower)
    );
  });

  const handleOpenLink = (url: string) => {
    if (linkOpenBehavior === "currentTab") {
      chrome.tabs.update({ url });
    } else {
      chrome.tabs.create({ url });
    }
  };

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

      {/* 链接网格 */}
      {filteredLinks.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 py-8">
          <p className="text-sm text-muted-foreground text-center">
            {searchTerm ? "未找到匹配的链接" : "暂无自定义链接"}
          </p>
          {!searchTerm && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => chrome.runtime.openOptionsPage()}
            >
              前往设置
            </Button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filteredLinks.map((link, index) => (
            <Button
              key={index}
              variant="outline"
              size="sm"
              onClick={() => handleOpenLink(link.url)}
              className="flex items-center gap-2 h-auto py-2"
              title={link.url}
            >
              <ExternalLink className="h-4 w-4" />
              <span className="truncate">{link.label}</span>
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
