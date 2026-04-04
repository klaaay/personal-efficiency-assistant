import { usePreferences } from "@/hooks/usePreferences";
import { PreferencesConfig } from "./PreferencesConfig";
import { CustomLinksConfig } from "./CustomLinksConfig";

export function SettingsPage() {
  const { preferences, isSaved, updatePreference, savePreference } =
    usePreferences();

  return (
    <div className="flex flex-col gap-6">
      <PreferencesConfig
        preferences={preferences}
        isPrefSaved={isSaved}
        updatePreference={updatePreference}
        savePreference={savePreference}
      />

      <CustomLinksConfig
        preferences={preferences}
        isPrefSaved={isSaved}
        updatePreference={updatePreference}
        savePreference={savePreference}
      />
    </div>
  );
}
