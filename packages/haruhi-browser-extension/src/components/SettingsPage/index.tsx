import { useState } from "react";
import { usePreferences } from "@/hooks/usePreferences";
import { Link, SlidersHorizontal, Tags } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTab, TabsPanel } from "@/components/ui/tabs";
import { PreferencesConfig } from "./PreferencesConfig";
import { CustomLinksConfig } from "./CustomLinksConfig";
import { CustomLinksTransfer } from "./CustomLinksTransfer";
import { TagsManager } from "./TagsManager";

const settingsTabClassName =
  "min-h-11 gap-1.5 px-2 text-xs whitespace-normal sm:min-h-9 sm:gap-2 sm:px-3 sm:text-sm sm:whitespace-nowrap";

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState("preferences");
  const { preferences, savedSection, updatePreference, savePreference } =
    usePreferences();

  return (
    <Card className="p-4 sm:p-6">
      <Tabs
        value={activeTab}
        onValueChange={setActiveTab}
        className="gap-6 sm:gap-8"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList
            aria-label="设置分类"
            activateOnFocus
            className="grid w-full grid-cols-3 sm:flex sm:w-fit"
          >
            <TabsTab value="preferences" className={settingsTabClassName}>
              <SlidersHorizontal aria-hidden="true" />
              <span className="min-w-0">偏好设置</span>
            </TabsTab>
            <TabsTab value="links" className={settingsTabClassName}>
              <Link aria-hidden="true" />
              <span className="min-w-0">自定义链接</span>
            </TabsTab>
            <TabsTab value="tags" className={settingsTabClassName}>
              <Tags aria-hidden="true" />
              <span className="min-w-0">标签管理</span>
            </TabsTab>
          </TabsList>
          {activeTab === "links" && (
            <CustomLinksTransfer
              preferences={preferences}
              updatePreference={updatePreference}
            />
          )}
        </div>

        <TabsPanel value="preferences">
          <PreferencesConfig
            preferences={preferences}
            isPrefSaved={savedSection === "preferences"}
            updatePreference={updatePreference}
            savePreference={() => savePreference("preferences")}
          />
        </TabsPanel>

        <TabsPanel value="links">
          <CustomLinksConfig
            preferences={preferences}
            isPrefSaved={savedSection === "links"}
            updatePreference={updatePreference}
            savePreference={() => savePreference("links")}
          />
        </TabsPanel>

        <TabsPanel value="tags">
          <TagsManager
            preferences={preferences}
            isPrefSaved={savedSection === "tags"}
            updatePreference={updatePreference}
            savePreference={() => savePreference("tags")}
          />
        </TabsPanel>
      </Tabs>
    </Card>
  );
}
