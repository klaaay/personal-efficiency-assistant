const HEX6 = /^#[0-9a-fA-F]{6}$/;

export function isValidTagColor(value: string): boolean {
  return HEX6.test(value);
}

/** 将任意输入规范为 Record<tag, #rrggbb 小写>；非法静默丢弃 */
export function sanitizeTagColors(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || !key) continue;
    if (typeof value !== "string" || !isValidTagColor(value)) continue;
    out[key] = value.toLowerCase();
  }
  return out;
}

/**
 * 根据背景色返回对比文字色。
 * 亮度 = (0.299R + 0.587G + 0.114B) / 255；≥ 0.55 深色字，否则浅色字。
 */
export function contrastTextColor(bg: string): string {
  if (!isValidTagColor(bg)) return "#1a1a1a";
  const hex = bg.slice(1).toLowerCase();
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance >= 0.55 ? "#1a1a1a" : "#ffffff";
}
