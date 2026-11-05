/** 原 1.9.6 的 local 设置格式；不读取或转换网页登录凭证。 */
export type ReaderProfile = {
  id: string;
  name: string;
  endpoint: string;
  model: string;
  apiKey: string;
  protocol: 'openai' | 'anthropic';
  authMode: 'bearer' | 'api-key';
  maxTokens?: number;
};
export type Prompt = { id: string; title: string; question: string; systemMessage: string };
export type LegacyPreferences = {
  showSummarizeButton?: boolean;
  showYoutubeButton?: boolean;
  summarizeFullText?: boolean;
};
export type MigrationResult = {
  profiles: ReaderProfile[];
  prompts: Prompt[];
  activePromptId: string;
  language: string;
  preferences: LegacyPreferences;
  warnings: string[];
};

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
const owns = (object: Record<string, unknown>, key: string) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * 接收 chrome.storage.local.get(null) 或 { local, sync } 快照。
 * 原插件实际使用 local；兼容仅 sync 的导出，但绝不跨区域拼接 provider 与密钥。
 * 调用方应先保存原始快照；本函数无副作用，warnings 不含配置值或秘密。
 */
export function migrateLegacy(raw: unknown): MigrationResult {
  const root = record(raw);
  if (!root) throw new Error('原插件配置必须是 JSON 对象。');
  const wrapped = owns(root, 'local') || owns(root, 'sync');
  const local = wrapped ? record(root.local) ?? {} : root;
  const sync = wrapped ? record(root.sync) ?? {} : {};
  const values = { ...sync, ...local };
  const warnings: string[] = [];
  const profiles: ReaderProfile[] = [];
  const profileSource = owns(local, 'provider') ? local : sync;
  const provider = profileSource.provider;
  if (provider === 'deepseek-api' || provider === 'api') {
    const deepseek = provider === 'deepseek-api';
    const apiKey = typeof profileSource.apiKey === 'string' ? profileSource.apiKey : '';
    const model = typeof profileSource.model === 'string' && profileSource.model.trim()
      ? profileSource.model : deepseek ? 'deepseek-chat' : 'gpt-4o-mini';
    profiles.push({
      id: deepseek ? 'legacy-deepseek' : 'legacy-openai',
      name: deepseek ? 'DeepSeek 官方（原插件）' : 'OpenAI 官方（原插件）',
      endpoint: deepseek ? 'https://api.deepseek.com/chat/completions' : 'https://api.openai.com/v1/chat/completions',
      model, apiKey, protocol: 'openai', authMode: 'bearer',
    });
    if (!apiKey.trim()) warnings.push('原 API 配置缺少 apiKey；已保留服务配置，补充密钥后才能使用。');
    if (!owns(profileSource, 'model')) warnings.push('原 API 配置缺少 model；已使用对应服务的默认模型。');
  } else if (provider === 'web' || provider === 'deepseek-chat') {
    warnings.push('原 provider 为网页登录模式，未迁移网页登录凭证；没有可确认归属的官方 API 密钥。');
  } else if (provider !== undefined || values.apiKey !== undefined) {
    warnings.push('无法确认 provider 与 apiKey 的服务归属，未迁移该密钥。');
  }
  if (owns(local, 'provider') && owns(sync, 'provider') && local.provider !== sync.provider) {
    warnings.push('local 与 sync 的 provider 不同；以 local 的整套 API 配置为准，没有混用两区密钥。');
  }

  const prompts: Prompt[] = [];
  const promptSettings = record(values.promptSettings);
  const seen = new Set<string>();
  if (Array.isArray(promptSettings?.prompts)) {
    for (let index = 0; index < promptSettings.prompts.length; index++) {
      const item = record(promptSettings.prompts[index]);
      if (!item) { warnings.push(`promptSettings.prompts 第 ${index + 1} 项不是对象，无法迁移；请查阅原始备份。`); continue; }
      let id = typeof item.id === 'string' && item.id ? item.id : `legacy-prompt-${index + 1}`;
      if (seen.has(id)) {
        warnings.push(`promptSettings.prompts 第 ${index + 1} 项 id 重复，已分配新 id，内容保留。`);
        id = `legacy-prompt-${index + 1}`;
      }
      while (seen.has(id)) id += '-copy';
      seen.add(id);
      const title = typeof item.title === 'string' ? item.title : `原提示词 ${index + 1}`;
      const question = typeof item.question === 'string' ? item.question : '';
      const systemMessage = typeof item.systemMessage === 'string' ? item.systemMessage : '';
      if (typeof item.question !== 'string') warnings.push(`promptSettings.prompts 第 ${index + 1} 项 question 不是文本，已留空；请查阅原始备份。`);
      prompts.push({ id, title, question, systemMessage });
    }
  } else if (values.promptSettings !== undefined) {
    warnings.push('promptSettings.prompts 格式无效，尝试迁移旧 question/systemMessage；请保留原始备份。');
  }
  if (!prompts.length && (typeof values.question === 'string' || typeof values.systemMessage === 'string')) {
    prompts.push({ id: 'legacy-default', title: 'Default Prompt', question: typeof values.question === 'string' ? values.question : '', systemMessage: typeof values.systemMessage === 'string' ? values.systemMessage : '' });
  }
  const requestedActive = promptSettings?.activePromptId;
  const activePromptId = typeof requestedActive === 'string' && prompts.some(prompt => prompt.id === requestedActive)
    ? requestedActive : prompts[0]?.id ?? '';
  if (requestedActive !== undefined && requestedActive !== activePromptId) warnings.push('activePromptId 未对应有效提示词，已启用第一条迁移提示词。');

  // 保留原语言代码，避免更改语言含义；展示层可自行提供本地化名称。
  const language = typeof values.selectedLanguage === 'string' ? values.selectedLanguage : '';
  if (!language) warnings.push('原 selectedLanguage 未保存，导入时保留新扩展当前回答语言。');
  const preferences: LegacyPreferences = {};
  for (const key of ['showSummarizeButton', 'showYoutubeButton', 'summarizeFullText'] as const) {
    if (typeof values[key] === 'boolean') preferences[key] = values[key];
    else if (values[key] !== undefined) warnings.push(`${key} 不是布尔值，未迁移。`);
  }
  return { profiles, prompts, activePromptId, language, preferences, warnings };
}
