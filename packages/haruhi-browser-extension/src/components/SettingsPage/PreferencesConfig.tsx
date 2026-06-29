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
        <div className="flex flex-col gap-6">
          {/* 链接打开方式 */}
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

          {/* 视图模式 */}
          <div className="space-y-3">
            <Label>视图模式</Label>
            <RadioGroup
              value={preferences.viewMode}
              onValueChange={(value) =>
                updatePreference(
                  "viewMode",
                  value as "flat" | "grouped"
                )
              }
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="flat" id="flat" />
                <Label htmlFor="flat" className="text-sm font-normal">
                  平铺视图（默认）
                </Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="grouped" id="grouped" />
                <Label htmlFor="grouped" className="text-sm font-normal">
                  标签分组视图
                </Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground">
              平铺视图将所有链接以网格展示；标签分组视图按标签将链接归类显示
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
