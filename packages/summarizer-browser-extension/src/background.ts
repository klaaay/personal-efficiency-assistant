chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({ id: 'summarize-selection', title: '用阅读助手分析选中文字', contexts: ['selection'] });
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
});
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== 'summarize-selection' || !tab?.id) return;
  // open 必须在手势回调内立即调用，不能等待 storage。
  void chrome.sidePanel.open({ tabId: tab.id });
  void chrome.storage.session.set({ pendingSource: {
    title: tab.title || '选中文字', url: tab.url || '', text: info.selectionText || '', kind: 'selection',
  } });
});
