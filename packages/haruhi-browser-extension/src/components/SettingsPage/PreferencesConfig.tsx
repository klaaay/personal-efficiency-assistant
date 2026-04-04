import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Preferences } from "@/hooks/usePreferences";

interface PreferencesConfigProps {
  preferences: Preferences;
  isPrefSaved: boolean;
  updatePreference: <T extends keyof Preferences>(
    key: T,
    value: Preferences[T]
  ) => void;
  savePreference: () => void;
}

export function PreferencesConfig({
  preferences,
  isPrefSaved,
  updatePreference,
  savePreference,
}: PreferencesConfigProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>偏好设置</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          <div className="space-y-3">
            <Label>链接打开方式</Label>
            <RadioGroup
              value={preferences.linkOpenBehavior}
              onValueChange={(value) =>
                updatePreference(
                  "linkOpenBehavior",
                  value as "newTab" | "currentTab"
                )
              }
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="newTab" id="newTab" />
                <Label htmlFor="newTab" className="text-sm font-normal">
                  在新标签页中打开（推荐）
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="currentTab" id="currentTab" />
                <Label htmlFor="currentTab" className="text-sm font-normal">
                  在当前标签页中打开
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              设置点击自定义链接时的打开方式
            </p>
          </div>
        </div>
        <Button onClick={savePreference} className="mt-6 w-full">
          {isPrefSaved ? "已保存" : "保存偏好设置"}
        </Button>
      </CardContent>
    </Card>
  );
}
