import { usePreferences } from "@/hooks/usePreferences";
import { PreferencesConfig } from "./PreferencesConfig";
import { CustomLinksConfig } from "./CustomLinksConfig";
import { TagsManager } from "./TagsManager";

export function SettingsPage() {
  const { preferences, savedSection, updatePreference, savePreference } =
    usePreferences();

  return (
    <div className="flex flex-col gap-6">
      <PreferencesConfig
        preferences={preferences}
        isPrefSaved={savedSection === "preferences"}
        updatePreference={updatePreference}
        savePreference={() => savePreference("preferences")}
      />

      <CustomLinksConfig
        preferences={preferences}
        isPrefSaved={savedSection === "links"}
        updatePreference={updatePreference}
        savePreference={() => savePreference("links")}
      />

      <TagsManager
        preferences={preferences}
        isPrefSaved={savedSection === "tags"}
        updatePreference={updatePreference}
        savePreference={() => savePreference("tags")}
      />
    </div>
  );
}
