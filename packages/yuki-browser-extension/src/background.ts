import type { Source } from './core';

const launcherId = 'reader-launcher';
type ReaderPreferences = { showSummarizeButton?: boolean; showYoutubeButton?: boolean };
async function preferences(): Promise<ReaderPreferences> {
  const { readerPreferences } = await chrome.storage.local.get('readerPreferences');
  return { showSummarizeButton: readerPreferences?.showSummarizeButton === true, showYoutubeButton: readerPreferences?.showYoutubeButton === true };
}
async function launcherEnabled(url: string): Promise<boolean> {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return false; }
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const [prefs, granted] = await Promise.all([preferences(), chrome.permissions.contains({ origins: [`${parsed.origin}/*`] })]);
  const youtube = parsed.hostname === 'youtube.com' || parsed.hostname.endsWith('.youtube.com');
  return granted && !!(youtube ? prefs.showYoutubeButton : prefs.showSummarizeButton);
}
// 串行更新，避免授权和设置同时变化时重复注册。
let registration = Promise.resolve();
function refreshLaunchers() {
  registration = registration.catch(() => {}).then(async () => {
    const [prefs, permissions] = await Promise.all([preferences(), chrome.permissions.getAll()]);
    const matches = (permissions.origins || []).flatMap(origin => origin === '<all_urls>' ? ['http://*/*', 'https://*/*'] : /^https?:\/\//.test(origin) ? [origin] : []);
    const enabled = !!(prefs.showSummarizeButton || prefs.showYoutubeButton) && matches.length > 0;
    const registered = await chrome.scripting.getRegisteredContentScripts({ ids: [launcherId] });
    if (enabled) {
      const script: chrome.scripting.RegisteredContentScript = { id: launcherId, matches, js: ['launcher.js'], runAt: 'document_idle', allFrames: false, persistAcrossSessions: true };
      if (registered.length) await chrome.scripting.updateContentScripts([script]);
      else await chrome.scripting.registerContentScripts([script]);
    } else if (registered.length) await chrome.scripting.unregisterContentScripts({ ids: [launcherId] });
    // 通知已注入的页面移除关闭的按钮；新启用时无需用户手动刷新。
    const tabs = await chrome.tabs.query({});
    await Promise.all(tabs.filter(tab => tab.id !== undefined).map(async tab => {
      await chrome.tabs.sendMessage(tab.id!, { type: 'reader-launcher-refresh' }).catch(() => {});
      if (enabled && tab.url && await launcherEnabled(tab.url)) {
        await chrome.scripting.executeScript({ target: { tabId: tab.id! }, files: ['launcher.js'] }).catch(() => {});
      }
    }));
  });
  void registration.catch(() => {});
}
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => chrome.contextMenus.create({ id: 'summarize-selection', title: '用阅读助手分析选中文字', contexts: ['selection'] }));
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  refreshLaunchers();
});
chrome.runtime.onStartup.addListener(refreshLaunchers);
chrome.permissions.onAdded.addListener(refreshLaunchers);
chrome.permissions.onRemoved.addListener(refreshLaunchers);
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes.readerPreferences) refreshLaunchers(); });
async function openPageWindow(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['launcher.js'] });
  await chrome.tabs.sendMessage(tabId, { type: 'reader-window-open', tabId }, { frameId: 0 });
}
async function publishSource(tabId: number, source: Source) {
  await chrome.storage.session.set({ [`pendingSource:${tabId}`]: { ...source, autoSummarize: true, requestId: crypto.randomUUID() } });
}
async function capturePage(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['capture.js'] });
  const [result] = await chrome.scripting.executeScript({ target: { tabId }, func: async () => {
    return (globalThis as unknown as { YukiCapture: { capture(): Promise<Source> } }).YukiCapture.capture();
  } });
  if (!result?.result) throw new Error('empty');
  await publishSource(tabId, result.result);
}
async function reportCaptureError(tabId: number) {
  await chrome.storage.session.set({ [`pendingSource:${tabId}`]: { error: '无法读取当前页面，请刷新后重试，或在浮窗中粘贴材料。', autoSummarize: false, requestId: crypto.randomUUID() } });
}
chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  if (!tab.url || !/^https?:/.test(tab.url)) {
    void chrome.sidePanel.open({ tabId: tab.id }); return;
  }
  const tabId = tab.id;
  void openPageWindow(tabId).then(() => capturePage(tabId)).catch(() => reportCaptureError(tabId));
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'summarize-selection' || tab?.id === undefined) return;
  const source: Source = { title: tab.title || '选中文字', url: tab.url || '', text: info.selectionText || '', kind: 'selection' };
  if (!tab.url || !/^https?:/.test(tab.url)) {
    void chrome.sidePanel.open({ tabId: tab.id });
    void chrome.storage.session.set({ pendingSource: source }); return;
  }
  const tabId = tab.id;
  void openPageWindow(tabId).then(() => publishSource(tabId, source)).catch(() => reportCaptureError(tabId));
});
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  if (message?.type === 'reader-embedded-context') {
    if (sender.url?.startsWith(chrome.runtime.getURL('index.html'))) respond({ tabId: sender.tab?.id });
    return;
  }
  if (sender.frameId !== 0 || sender.tab?.id === undefined) return;
  if (message?.type === 'reader-open-settings') { void chrome.runtime.openOptionsPage(); return; }
  if (message?.type === 'reader-launcher-state') {
    void launcherEnabled(sender.url || '').then(enabled => respond({ enabled })).catch(() => respond({ enabled: false }));
    return true;
  }
  if (message?.type !== 'reader-launcher-capture') return;
  const tabId = sender.tab.id;
  void (async () => {
    if (!await launcherEnabled(sender.url || '')) throw new Error('disabled');
    await openPageWindow(tabId);
    await capturePage(tabId);
    respond({ ok: true });
  })().catch(() => { void reportCaptureError(tabId); respond({ ok: false }); });
  return true;
});
