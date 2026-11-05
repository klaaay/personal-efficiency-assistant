import { defaults, templates, validateSettings, type Settings } from './core';
import { migrateLegacy, type ReaderProfile, type Prompt } from './migration';

export type SavedProfile = ReaderProfile & { remember: boolean };
export type ReaderConfig = {
  version: 1; profiles: SavedProfile[]; primaryProfileId: string; fallbackProfileId: string;
  prompts: Prompt[]; activePromptId: string; language: string; chunkSize: number;
  preferences: { showSummarizeButton: boolean; showYoutubeButton: boolean; summarizeFullText: boolean };
};
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const area = (id: string) => $<HTMLTextAreaElement>(id);
const extension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const newId = () => crypto.randomUUID();
const initialProfile = (settings: Settings): SavedProfile => ({ id: 'default', name: '当前接口', endpoint: settings.endpoint, model: settings.model, apiKey: settings.apiKey, protocol: settings.protocol || 'openai', authMode: settings.authMode || 'bearer', maxTokens: settings.maxTokens || 4096, remember: false });
const initialConfig = (settings: Settings): ReaderConfig => ({ version: 1, profiles: [initialProfile(settings)], primaryProfileId: 'default', fallbackProfileId: '', prompts: [{ id: 'default', title: '默认提示词', question: settings.template, systemMessage: settings.systemMessage || '' }], activePromptId: 'default', language: settings.language, chunkSize: settings.chunkSize, preferences: { showSummarizeButton: false, showYoutubeButton: false, summarizeFullText: true } });

export function createSettingsUI(status: (message: string, error?: boolean) => void, perform: (work: () => Promise<void>) => Promise<void>) {
  let config = initialConfig(defaults);
  let editingProfileId = config.primaryProfileId;
  let backupBeforeSave = false;
  let importWarnings: string[] = [];
  function prompt() { return config.prompts.find(item => item.id === config.activePromptId)!; }
  function modelSettings(profile: SavedProfile): Settings {
    return { ...profile, language: config.language, chunkSize: config.chunkSize, template: area('instruction').value.trim() || templates.summary, systemMessage: area('system-instruction').value };
  }
  function currentSettings(): Settings {
    const primary = config.profiles.find(item => item.id === config.primaryProfileId)!;
    const fallback = config.profiles.find(item => item.id === config.fallbackProfileId);
    return { ...modelSettings(primary), ...(fallback && fallback.id !== primary.id ? { fallback } : {}) };
  }
  function options(element: HTMLSelectElement, entries: { id: string; name: string }[], selected: string, empty?: string) {
    element.replaceChildren();
    if (empty) element.add(new Option(empty, ''));
    for (const entry of entries) element.add(new Option(entry.name, entry.id));
    element.value = selected;
  }
  function fillProfile() {
    const profile = config.profiles.find(item => item.id === editingProfileId)!;
    input('profile-name').value = profile.name;
    input('endpoint').value = profile.endpoint; input('model').value = profile.model; input('api-key').value = profile.apiKey;
    input('remember-key').checked = profile.remember;
    select('protocol').value = profile.protocol; select('auth-mode').value = profile.authMode;
    input('max-tokens').value = String(profile.maxTokens || 4096);
    select('provider').value = profile.protocol === 'anthropic' ? 'anthropic' : profile.endpoint === defaults.endpoint ? 'openai' : profile.endpoint === 'https://api.deepseek.com/chat/completions' ? 'deepseek' : 'custom';
  }
  function fillPrompt() {
    const value = prompt();
    input('prompt-title').value = value.title; area('instruction').value = value.question; area('system-instruction').value = value.systemMessage;
    select('template').value = 'custom';
  }
  function fill() {
    options(select('profile'), config.profiles, editingProfileId);
    options(select('primary-profile'), config.profiles, config.primaryProfileId);
    options(select('fallback-profile'), config.profiles.filter(item => item.id !== config.primaryProfileId), config.fallbackProfileId, '不自动切换');
    options(select('prompt-profile'), config.prompts.map(item => ({ id: item.id, name: item.title })), config.activePromptId);
    input('language').value = config.language; input('chunk-size').value = String(config.chunkSize);
    for (const [key, value] of Object.entries(config.preferences)) input(key).checked = value;
    fillProfile(); fillPrompt();
  }
  async function persist() {
    const clean: ReaderConfig = { ...config, profiles: config.profiles.map(item => ({ ...item, apiKey: extension && item.remember ? item.apiKey : '' })) };
    const current = currentSettings();
    const activeProfile = config.profiles.find(item => item.id === config.primaryProfileId)!;
    const compatible = { ...current, apiKey: activeProfile.remember ? current.apiKey : '', fallback: undefined };
    if (extension) {
      if (backupBeforeSave) {
        const snapshot = await chrome.storage.local.get(null);
        delete snapshot.readerMigrationBackup;
        await chrome.storage.local.set({ readerMigrationBackup: { createdAt: new Date().toISOString(), snapshot } });
      }
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await chrome.storage.local.set({ readerConfig: clean, readerPreferences: config.preferences, settings: compatible, remember: activeProfile.remember });
      await chrome.storage.session.set({ readerProfileKeys: Object.fromEntries(config.profiles.filter(item => !item.remember).map(item => [item.id, item.apiKey])), apiKey: activeProfile.remember ? '' : activeProfile.apiKey });
    } else {
      if (backupBeforeSave) localStorage.setItem('reader-migration-backup', localStorage.getItem('reader-config') || localStorage.getItem('reader-settings') || '{}');
      localStorage.setItem('reader-config', JSON.stringify(clean));
      localStorage.setItem('reader-settings', JSON.stringify({ ...compatible, apiKey: '' }));
    }
    backupBeforeSave = false;
  }
  async function ensureApi(settings: Settings) {
    for (const service of [settings, ...(settings.fallback ? [{ ...settings, ...settings.fallback, fallback: undefined }] : [])]) {
      const url = validateSettings(service);
      if (extension && !await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) throw new Error('请打开设置页，保存并授权主接口与备用接口。');
    }
  }
  function readEditor(): SavedProfile {
    return { id: editingProfileId, name: input('profile-name').value.trim() || '自定义接口', endpoint: input('endpoint').value.trim(), model: input('model').value.trim(), apiKey: input('api-key').value.trim(), protocol: select('protocol').value as ReaderProfile['protocol'], authMode: select('auth-mode').value as ReaderProfile['authMode'], maxTokens: Number(input('max-tokens').value), remember: input('remember-key').checked };
  }
  select('profile').addEventListener('change', () => { editingProfileId = select('profile').value; fillProfile(); });
  $('add-profile').addEventListener('click', () => {
    const profile = { ...initialProfile(defaults), id: newId(), name: '新接口' };
    config.profiles.push(profile); editingProfileId = profile.id; fill();
  });
  $('delete-profile').addEventListener('click', () => void perform(async () => {
    if (config.profiles.length === 1) throw new Error('至少保留一个模型接口。');
    config.profiles = config.profiles.filter(item => item.id !== editingProfileId);
    if (config.primaryProfileId === editingProfileId) config.primaryProfileId = config.profiles[0].id;
    if (config.fallbackProfileId === editingProfileId) config.fallbackProfileId = '';
    editingProfileId = config.primaryProfileId; fill(); await persist(); status('接口已删除。');
  }));
  select('primary-profile').addEventListener('change', () => {
    config.primaryProfileId = select('primary-profile').value;
    if (config.fallbackProfileId === config.primaryProfileId) config.fallbackProfileId = '';
    options(select('fallback-profile'), config.profiles.filter(item => item.id !== config.primaryProfileId), config.fallbackProfileId, '不自动切换');
  });
  select('provider').addEventListener('change', () => {
    const provider = select('provider').value;
    select('protocol').value = provider === 'anthropic' ? 'anthropic' : 'openai'; select('auth-mode').value = 'bearer';
    if (provider === 'anthropic') { input('endpoint').value = 'https://api.anthropic.com/v1/messages'; input('model').value = ''; select('auth-mode').value = 'api-key'; }
    if (provider === 'openai') { input('endpoint').value = defaults.endpoint; input('model').value = defaults.model; }
    if (provider === 'deepseek') { input('endpoint').value = 'https://api.deepseek.com/chat/completions'; input('model').value = 'deepseek-chat'; }
    input('api-key').value = '';
  });
  $('settings-form').addEventListener('submit', event => {
    event.preventDefault();
    const nextProfile = readEditor();
    const candidate: ReaderConfig = { ...config, profiles: config.profiles.map(item => item.id === editingProfileId ? nextProfile : item), primaryProfileId: select('primary-profile').value, fallbackProfileId: select('fallback-profile').value, language: input('language').value.trim(), chunkSize: Number(input('chunk-size').value), preferences: { showSummarizeButton: input('showSummarizeButton').checked, showYoutubeButton: input('showYoutubeButton').checked, summarizeFullText: input('summarizeFullText').checked } };
    let permission: Promise<boolean>;
    try {
      const profiles = candidate.profiles.filter(item => [candidate.primaryProfileId, candidate.fallbackProfileId, editingProfileId].includes(item.id));
      const origins = profiles.map(item => `${validateSettings({ ...item, language: candidate.language, chunkSize: candidate.chunkSize, template: area('instruction').value }).origin}/*`);
      if (candidate.preferences.showSummarizeButton || candidate.preferences.showYoutubeButton) origins.push('https://*/*', 'http://*/*');
      permission = extension ? chrome.permissions.request({ origins: [...new Set(origins)] }) : Promise.resolve(true);
    } catch (error) { status((error as Error).message, true); return; }
    void perform(async () => {
      if (!await permission) throw new Error('访问未授权，设置尚未保存。');
      config = candidate; Object.assign(prompt(), { question: area('instruction').value, systemMessage: area('system-instruction').value, title: input('prompt-title').value || prompt().title });
      await persist(); fill(); status(`设置已保存。${importWarnings.length ? `导入提示：${importWarnings.join(' ')}` : '主接口失败时才尝试所选备用接口。'}`); importWarnings = [];
      $<HTMLDetailsElement>('settings').open = true;
    });
  });
  select('prompt-profile').addEventListener('change', () => void perform(async () => { config.activePromptId = select('prompt-profile').value; fillPrompt(); await persist(); status('已启用提示词。'); }));
  $('save-prompt').addEventListener('click', () => void perform(async () => { Object.assign(prompt(), { title: input('prompt-title').value.trim() || '未命名提示词', question: area('instruction').value, systemMessage: area('system-instruction').value }); await persist(); fill(); status('提示词已保存。'); }));
  for (const action of ['add', 'copy'] as const) $(''+action+'-prompt').addEventListener('click', () => void perform(async () => {
    const next: Prompt = action === 'copy' ? { ...prompt(), question: area('instruction').value, systemMessage: area('system-instruction').value, id: newId(), title: `${input('prompt-title').value} 副本` } : { id: newId(), title: '新提示词', question: '', systemMessage: '' };
    config.prompts.push(next); config.activePromptId = next.id; await persist(); fill(); status('提示词已创建。');
  }));
  $('delete-prompt').addEventListener('click', () => void perform(async () => {
    if (config.prompts.length === 1) throw new Error('至少保留一条提示词。');
    config.prompts = config.prompts.filter(item => item.id !== config.activePromptId); config.activePromptId = config.prompts[0].id; await persist(); fill(); status('提示词已删除。');
  }));
  function decodeStandard(value: unknown): ReaderConfig {
    const item = value as ReaderConfig;
    if (item?.version !== 1 || !Array.isArray(item.profiles) || !item.profiles.length || !Array.isArray(item.prompts) || !item.prompts.length) throw new Error('配置格式不完整。');
    if (typeof item.language !== 'string' || !item.language.trim()) throw new Error('配置缺少回答语言。');
    const profileIds = new Set<string>();
    for (const profile of item.profiles) {
      if (!profile || typeof profile.id !== 'string' || !profile.id || profileIds.has(profile.id) || typeof profile.name !== 'string' || typeof profile.apiKey !== 'string') throw new Error('接口配置格式无效或 ID 重复。');
      profileIds.add(profile.id); validateSettings({ ...profile, language: item.language, chunkSize: item.chunkSize, template: '' });
    }
    const promptIds = new Set<string>();
    for (const prompt of item.prompts) {
      if (!prompt || ['id','title','question','systemMessage'].some(key => typeof prompt[key as keyof Prompt] !== 'string') || !prompt.id || promptIds.has(prompt.id)) throw new Error('提示词配置格式无效或 ID 重复。');
      promptIds.add(prompt.id);
    }
    if (!profileIds.has(item.primaryProfileId) || (item.fallbackProfileId && !profileIds.has(item.fallbackProfileId)) || !promptIds.has(item.activePromptId)) throw new Error('启用接口或提示词 ID 不存在。');
    return { version: 1, profiles: item.profiles.map(profile => ({ ...profile, remember: profile.remember === true })), prompts: item.prompts.map(prompt => ({ ...prompt })), primaryProfileId: item.primaryProfileId, fallbackProfileId: item.fallbackProfileId === item.primaryProfileId ? '' : item.fallbackProfileId || '', activePromptId: item.activePromptId, language: item.language, chunkSize: item.chunkSize, preferences: { showSummarizeButton: item.preferences?.showSummarizeButton === true, showYoutubeButton: item.preferences?.showYoutubeButton === true, summarizeFullText: item.preferences?.summarizeFullText !== false } };
  }
  $('export-config').addEventListener('click', () => void perform(async () => {
    let saved: ReaderConfig;
    if (extension) {
      const [local, session] = await Promise.all([chrome.storage.local.get('readerConfig'), chrome.storage.session.get('readerProfileKeys')]);
      if (!local.readerConfig) throw new Error('请先保存设置，再导出配置。');
      saved = decodeStandard(local.readerConfig);
      saved.profiles = saved.profiles.map(profile => ({ ...profile, apiKey: profile.remember ? profile.apiKey : session.readerProfileKeys?.[profile.id] || '' }));
    } else {
      const raw = localStorage.getItem('reader-config');
      if (!raw) throw new Error('请先保存设置，再导出配置。');
      saved = decodeStandard(JSON.parse(raw));
    }
    const includeKeys = input('export-keys').checked;
    if (!includeKeys) saved.profiles = saved.profiles.map(profile => ({ ...profile, apiKey: '' }));
    const payload = { readerConfig: saved, exportedAt: new Date().toISOString() };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = `yuki-config-${new Date().toISOString().slice(0, 10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status(includeKeys ? '配置已导出，文件包含 API Key，请妥善保管。' : '配置已导出（不含 API Key）。导入后请补填密钥。');
  }));
  $('import-config').addEventListener('change', () => void perform(async () => {
    const file = input('import-config').files?.[0]; if (!file) return;
    try {
      if (file.size > 10 * 1024 * 1024) throw new Error('配置文件超过 10 MB，请仅导出设置。');
      let raw;
      try { raw = JSON.parse(await file.text()); } catch { throw new Error('配置文件不是有效 JSON。'); }
      if (raw?.readerConfig || raw?.version === 1) { config = decodeStandard(raw.readerConfig || raw); importWarnings = []; }
      else {
        const migrated = migrateLegacy(raw);
        config = { ...config, profiles: migrated.profiles.length ? migrated.profiles.map(profile => ({ ...profile, remember: true })) : config.profiles, prompts: migrated.prompts.length ? migrated.prompts : config.prompts, activePromptId: migrated.activePromptId || config.activePromptId, language: migrated.language || config.language, preferences: { ...config.preferences, ...migrated.preferences }, fallbackProfileId: '' };
        config.primaryProfileId = config.profiles[0].id; importWarnings = migrated.warnings;
      }
      backupBeforeSave = true; editingProfileId = config.primaryProfileId; fill(); $<HTMLDetailsElement>('settings').open = true;
      status(`已读取 ${config.profiles.length} 套接口与 ${config.prompts.length} 条提示词。点击“保存并授权接口”完成备份、迁移与授权。${importWarnings.join(' ')}`);
    } finally { input('import-config').value = ''; }
  }));
  async function initialize() {
    if (extension) {
      const [local, session] = await Promise.all([chrome.storage.local.get(['readerConfig', 'settings', 'remember']), chrome.storage.session.get(['readerProfileKeys', 'apiKey'])]);
      if (local.readerConfig) {
        config = decodeStandard(local.readerConfig);
        config.profiles = config.profiles.map(item => ({ ...item, apiKey: item.remember ? item.apiKey : session.readerProfileKeys?.[item.id] || '' }));
      } else {
        const settings = { ...defaults, ...local.settings, apiKey: local.remember ? local.settings?.apiKey || '' : session.apiKey || '' };
        config = initialConfig(settings); config.profiles[0].remember = !!local.remember;
      }
    } else {
      const saved = localStorage.getItem('reader-config');
      if (saved) config = decodeStandard(JSON.parse(saved));
      else config = initialConfig({ ...defaults, ...JSON.parse(localStorage.getItem('reader-settings') || '{}'), apiKey: '' });
    }
    editingProfileId = config.primaryProfileId; fill();
    if (!config.profiles.find(item => item.id === config.primaryProfileId)?.apiKey) $<HTMLDetailsElement>('settings').open = true;
  }
  return { initialize, currentSettings, ensureApi, summarizeFullText: () => config.preferences.summarizeFullText };
}
