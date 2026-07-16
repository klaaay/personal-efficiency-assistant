import { useEffect } from "react";
import { Theme } from "@radix-ui/themes";
import { Button } from "@/components/ui/button";
import { Settings } from "lucide-react";
import { CustomLinks } from "@/components/CustomLinks";
import "@radix-ui/themes/styles.css";

export default function Popup() {
  const openSettings = () => {
    chrome.runtime.openOptionsPage();
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 输入框中不触发快捷键
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      if (event.key === "e" || event.key === "E") {
        openSettings();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <Theme>
      <div className="p-4 w-[600px]">
        <div className="flex justify-between items-center mb-2">
          <h4 className="text-md font-semibold">Haruhi</h4>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={openSettings}
            title="设置 (e)"
          >
            <Settings className="h-5 w-5" />
          </Button>
        </div>

        <CustomLinks />
      </div>
    </Theme>
  );
}
