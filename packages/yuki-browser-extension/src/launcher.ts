// 内容脚本只向后台询问按钮开关，不读取模型配置或密钥。
(() => {
  const state = globalThis as typeof globalThis & { __haruhiReaderLauncher?: { refresh(): void } };
  if (state.__haruhiReaderLauncher) { state.__haruhiReaderLauncher.refresh(); return; }
  const host = document.createElement('div');
  host.id = 'yuki-reader-launcher';
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = ':host{all:initial;position:fixed;right:18px;bottom:24px;z-index:2147483646}button{font:14px/1.5 system-ui,sans-serif;color:white;background:#245b42;border:1px solid #fff8;border-radius:24px;padding:10px 16px;box-shadow:0 2px 10px #0003;cursor:pointer}button:focus-visible{outline:3px solid #75b9e6;outline-offset:3px}button:disabled{opacity:.7;cursor:wait}';
  const button = document.createElement('button');
  button.type = 'button'; button.textContent = '阅读助手'; button.title = '读取当前网页或视频字幕，在页面浮窗中总结';
  shadow.append(style, button);
  async function refresh() {
    try {
      const result = await chrome.runtime.sendMessage({ type: 'reader-launcher-state' });
      if (result?.enabled) { if (!host.isConnected) document.documentElement.append(host); }
      else host.remove();
    } catch { host.remove(); }
  }
  button.addEventListener('click', async () => {
    button.disabled = true; button.textContent = '正在读取…';
    try {
      const result = await chrome.runtime.sendMessage({ type: 'reader-launcher-capture' });
      button.textContent = result?.ok ? '阅读助手' : '读取失败，点击重试';
    } catch { button.textContent = '请刷新页面后重试'; }
    finally { button.disabled = false; }
  });
  let windowHost: HTMLDivElement | undefined;
  let frame: HTMLIFrameElement | undefined;
  let collapseButton: HTMLButtonElement | undefined;
  const collapseIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m6 14 6-6 6 6"/></svg>';
  const expandIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m6 10 6 6 6-6"/></svg>';
  function openWindow(tabId: number) {
    if (windowHost?.isConnected && frame) { frame.hidden = false; if (collapseButton) { collapseButton.innerHTML = collapseIcon; collapseButton.setAttribute('aria-label', '折叠总结浮窗'); } return; }
    windowHost = document.createElement('div'); windowHost.id = 'yuki-reader-window';
    const root = windowHost.attachShadow({ mode: 'closed' });
    const sheet = document.createElement('style');
    sheet.textContent = ':host{all:initial;position:fixed;right:16px;top:16px;width:min(560px,calc(100vw - 32px));z-index:2147483647;font:14px/1.5 system-ui,sans-serif;color:#25382f;background:#f5f6f2;border:1px solid #b8c5bb;border-radius:12px;box-shadow:0 8px 30px #0004;overflow:hidden}.bar{display:flex;align-items:center;gap:4px;padding:8px 12px;background:#f5f6f2;border-bottom:1px solid #d9dfd6}.title{flex:1;font-weight:600}button{font:inherit;color:inherit;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border:0;border-radius:7px;background:transparent;cursor:pointer;padding:0}button:hover{background:#e3e9e1}button:focus-visible{outline:3px solid #75b9e6}iframe{display:block;border:0;width:100%;height:min(840px,calc(100vh - 80px));background:#f5f6f2}iframe[hidden]{display:none}:host(.dark){color:#e0e9e0;background:#17201b;border-color:#3d4a40}:host(.dark) .bar{background:#17201b;border-color:#3d4a40}:host(.dark) button:hover{background:#263a2c}';
    const bar = document.createElement('div'); bar.className = 'bar';
    const title = document.createElement('span'); title.className = 'title'; title.textContent = '阅读助手 · 页面总结';
    const settings = document.createElement('button'); settings.type = 'button'; settings.title = '设置'; settings.setAttribute('aria-label', '打开设置页'); settings.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m9 3-.5 2-2 1.2-2-.6-2 3.5L4 10.5v3l-1.5 1.4 2 3.5 2-.6 2 1.2.5 2h6l.5-2 2-1.2 2 .6 2-3.5-1.5-1.4v-3l1.5-1.4-2-3.5-2 .6-2-1.2L15 3Z"/><circle cx="12" cy="12" r="3"/></svg>';
    settings.addEventListener('click', () => void chrome.runtime.sendMessage({ type: 'reader-open-settings' }));
    const theme = document.createElement('button'); theme.type = 'button'; theme.title = '切换明暗主题'; theme.setAttribute('aria-label', '切换明暗主题'); theme.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 0 0 18Z" fill="currentColor" stroke="none"/></svg>';
    theme.addEventListener('click', () => frame?.contentWindow?.postMessage({ type: 'yuki-toggle-theme' }, `chrome-extension://${chrome.runtime.id}`));
    const collapse = document.createElement('button'); collapseButton = collapse; collapse.type = 'button'; collapse.innerHTML = collapseIcon; collapse.title = '折叠总结浮窗'; collapse.setAttribute('aria-label', '折叠总结浮窗');
    const close = document.createElement('button'); close.type = 'button'; close.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="m6 6 12 12M6 18 18 6"/></svg>'; close.title = '关闭总结浮窗'; close.setAttribute('aria-label', '关闭总结浮窗');
    frame = document.createElement('iframe'); frame.title = '阅读助手总结浮窗'; frame.allow = 'clipboard-write';
    frame.src = chrome.runtime.getURL(`index.html?embedded=1&tabId=${tabId}`);
    collapse.addEventListener('click', () => { if (frame) { frame.hidden = !frame.hidden; collapse.innerHTML = frame.hidden ? expandIcon : collapseIcon; collapse.title = frame.hidden ? '展开总结浮窗' : '折叠总结浮窗'; collapse.setAttribute('aria-label', frame.hidden ? '展开总结浮窗' : '折叠总结浮窗'); } });
    close.addEventListener('click', () => { windowHost?.remove(); windowHost = undefined; frame = undefined; collapseButton = undefined; });
    bar.append(title, settings, theme, collapse, close); root.append(sheet, bar, frame); document.documentElement.append(windowHost);
  }
  window.addEventListener('message', event => {
    if (frame && event.source === frame.contentWindow && event.origin === `chrome-extension://${chrome.runtime.id}` && event.data?.type === 'yuki-theme-state') windowHost?.classList.toggle('dark', event.data.dark === true);
  });
  chrome.runtime.onMessage.addListener((message, _sender, respond) => {
    if (message?.type === 'reader-launcher-refresh') void refresh();
    if (message?.type === 'reader-window-open' && Number.isInteger(message.tabId)) { openWindow(message.tabId); respond({ ok: true }); }
  });
  state.__haruhiReaderLauncher = { refresh: () => { void refresh(); } };
  void refresh();
})();
