import { useState, useEffect } from "react";

export interface Preferences {
  customLinks: Array<{
    label: string;
    url: string;
  }>;
  linkOpenBehavior: "newTab" | "currentTab";
}

const defaultPreferences: Preferences = {
  customLinks: [],
  linkOpenBehavior: "newTab",
};

export const getPreferences = async (): Promise<Preferences> => {
  return new Promise((resolve) => {
    chrome.storage.sync.get(["preferences"], (result) => {
      if (result.preferences) {
        resolve(result.preferences as Preferences);
      } else {
        resolve(defaultPreferences);
      }
    });
  });
};

export const savePreferences = async (
  preferences: Preferences
): Promise<void> => {
  return new Promise((resolve) => {
    chrome.storage.sync.set({ preferences }, () => {
      resolve();
    });
  });
};

export function usePreferences() {
  const [preferences, setPreferences] =
    useState<Preferences>(defaultPreferences);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    const loadPreferences = async () => {
      const prefs = await getPreferences();
      setPreferences(prefs);
    };
    loadPreferences();
  }, []);

  const updatePreference = <T extends keyof Preferences>(
    key: T,
    value: Preferences[T]
  ) => {
    setPreferences((prev) => ({
      ...prev,
      [key]: value,
    }));
    setIsSaved(false);
  };

  const savePreference = async () => {
    await savePreferences(preferences);
    setIsSaved(true);
    setTimeout(() => {
      setIsSaved(false);
    }, 2000);
  };

  return {
    preferences,
    isSaved,
    updatePreference,
    savePreference,
  };
}
