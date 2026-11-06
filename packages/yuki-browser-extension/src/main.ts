import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { defaults, templates, validateSettings, streamCompletion, sourceMessages, summarize, summaryMarkdown, type Source, type Settings, type Message } from './core';
import { readPdf } from './pdf';
import { createSettingsUI } from './settings-ui';
import { createSettingsTabs } from './settings-tabs';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const textArea = $<HTMLTextAreaElement>('source-text');
const extension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
const settingsPage = new URLSearchParams(location.search).get('view') === 'settings';
document.documentElement.classList.add(settingsPage ? 'settings-page' : 'reader-page');
if (settingsPage) { document.querySelector('h1')!.textContent = '阅读助手设置'; $('status').textContent = ''; $('settings-view').prepend($('status')); }
const settingsTabs = createSettingsTabs();
$('settings-form').addEventListener('invalid', () => settingsTabs.activate('settings'), true);
$('open-settings').addEventListener('click', () => {
  if (extension) void chrome.runtime.openOptionsPage();
  else window.open('index.html?view=settings', '_blank', 'noopener');
});
const embedded = new URLSearchParams(location.search).get('embedded') === '1';
if (embedded) document.documentElement.classList.add('embedded');
let pendingSourceKey = 'pendingSource';
let autoSummarizePending = false;
let lastCaptureRequestId: string | undefined;
function consumeCapturedSource(next: Source & { autoSummarize?: boolean }) {
  showSource(next);
  if (embedded && next.autoSummarize) {
    if (busy) autoSummarizePending = true;
    else $('summarize').click();
  }
}
let source: Source = { title: '粘贴内容', url: '', text: '', kind: 'paste' };
let history: Message[] = [];
let controller: AbortController | undefined;
let busy = false;
let longContext: string | undefined;
let queuedSource: Source | undefined;
let retryLast: (() => void) | undefined;
let usingFallback = false;
const fallbackNotice = () => { usingFallback = true; status('主接口暂不可用，正在尝试备用接口…'); };
const settingsUI = createSettingsUI(status, perform, settingsTabs.activate);
function status(message: string, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function resetConversation() { history = []; longContext = undefined; retryLast = undefined; $<HTMLButtonElement>('retry').disabled = true; $('conversation').replaceChildren(); }
function showSource(next: Source) {
  source = next; textArea.value = source.text; resetConversation();
  $('source-title').textContent = source.title;
  $('source-kind').textContent = ({ page: '网页', selection: '选区', youtube: '视频字幕', pdf: 'PDF', paste: '粘贴内容' })[source.kind];
  $('count').textContent = `${Array.from(source.text).length.toLocaleString()} 字符`;
}
function setBusy(value: boolean) {
  document.documentElement.classList.toggle('working', value);
  busy = value;
  for (const id of ['capture', 'pdf', 'load-pdf', 'summarize', 'ask', 'clear', 'template', 'instruction', 'question', 'system-instruction', 'prompt-profile', 'prompt-title', 'add-prompt', 'copy-prompt', 'delete-prompt', 'save-prompt', 'import-config']) {
    (document.getElementById(id) as HTMLInputElement).disabled = value;
  }
  textArea.disabled = value;
  $('settings-form').querySelectorAll<HTMLInputElement>('input, select, button').forEach(el => el.disabled = value);
  $<HTMLButtonElement>('cancel').disabled = !value || !controller;
  $<HTMLButtonElement>('retry').disabled = value || !retryLast;
}
async function perform(work: () => Promise<void>) {
  if (busy) return;
  usingFallback = false; setBusy(true);
  try { await work(); }
  catch (error) { status(error instanceof Error ? (error.name === 'AbortError' ? '已停止。本次未完成的回答没有加入对话。' : error.message) : String(error), true); }
  finally { controller = undefined; setBusy(false); if (queuedSource) { const next = queuedSource; queuedSource = undefined; consumeCapturedSource(next); }
    if (autoSummarizePending) { autoSummarizePending = false; $('summarize').click(); } }
}
function renderAnswer(role: 'user' | 'assistant', content = '', title?: string, sourceUrl = '') {
  const article = document.createElement('article'); article.className = `message ${role}`;
  const heading = document.createElement('h3'); heading.textContent = role === 'user' ? '你' : '阅读助手';
  const body = document.createElement('div'); article.append(heading, body); $('conversation').append(article);
  const sourceHeading = document.createElement('h2');
  if (title) { sourceHeading.className = 'summary-title'; sourceHeading.textContent = title; article.prepend(sourceHeading); heading.hidden = true; }
  const controls = document.createElement('div'); controls.className = 'toolbar';
  const counter = document.createElement('span'); counter.className = 'hint';
  let latest = content;
  if (role === 'assistant') {
    const copy = document.createElement('button'); copy.setAttribute('aria-label', title ? '复制总结' : '复制回答'); copy.title = title ? '复制标题与总结' : '复制回答'; copy.className = 'copy-answer';
    copy.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg>';
    const copyIcon = copy.innerHTML; const copyLabel = copy.getAttribute('aria-label')!; const copyTitle = copy.title;
    let copyTimer: ReturnType<typeof setTimeout>;
    copy.addEventListener('click', () => void navigator.clipboard.writeText(title ? summaryMarkdown(title, sourceUrl, latest) : latest).then(() => {
      clearTimeout(copyTimer); copy.innerHTML = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>'; copy.classList.add('copied'); copy.setAttribute('aria-label', '已复制'); copy.title = '已复制';
      copyTimer = setTimeout(() => { copy.innerHTML = copyIcon; copy.classList.remove('copied'); copy.setAttribute('aria-label', copyLabel); copy.title = copyTitle; }, 1800);
    }).catch(() => status('复制失败，请选中文本复制。', true)));
    controls.append(copy, counter); article.insertBefore(controls, body);
  }
  const update = (text: string) => {
    latest = text; counter.textContent = `${Array.from(text).length.toLocaleString()} 字符（非 token 用量）`;
    body.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { FORBID_TAGS: ['img', 'iframe', 'style', 'form', 'input', 'video', 'audio'], FORBID_ATTR: ['style'] });
    body.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  };
  update(content); return { update, article, updateTitle: (next: string) => { title = next; sourceHeading.textContent = next; } };
}
const currentSettings = settingsUI.currentSettings;
const ensureApi = settingsUI.ensureApi;
$('template').addEventListener('change', () => {
  const key = $<HTMLSelectElement>('template').value as keyof typeof templates;
  if (templates[key]) $<HTMLTextAreaElement>('instruction').value = templates[key];
});
textArea.addEventListener('input', () => {
  resetConversation(); source = { title: '粘贴 / 编辑内容', url: '', text: textArea.value, kind: 'paste' };
  $('source-title').textContent = source.title; $('source-kind').textContent = '粘贴内容';
  $('count').textContent = `${Array.from(source.text).length.toLocaleString()} 字符`;
});
$('capture').addEventListener('click', () => void perform(async () => {
  if (!extension) throw new Error('读取网页需要加载 dist 为 Chrome 扩展；预览模式支持粘贴和 PDF。');
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !/^https?:/.test(tab.url)) throw new Error('请切换到普通网页后点击扩展图标，再读取内容。浏览器内部页面不可读取。');
  status('正在读取正文或字幕…');
  await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
  const result = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
    try { return { source: await (globalThis as unknown as { YukiCapture: { capture: () => Promise<Source> } }).YukiCapture.capture() }; }
    catch (error) { return { error: error instanceof Error ? error.message : String(error) }; }
  } });
  const value = result[0]?.result;
  if (!value?.source) throw new Error(value?.error || '读取失败。PDF 请使用导入功能，其他页面可粘贴正文。');
  showSource(value.source); status('材料已读取，请确认内容后总结或提问。');
}));
$('pdf').addEventListener('change', () => void perform(async () => {
  const file = input('pdf').files?.[0]; if (!file) return;
  try {
    if (file.size > 30 * 1024 * 1024) throw new Error('PDF 超过 30 MB，请拆分后导入。');
    status('正在解析 PDF…'); showSource(await readPdf(await file.arrayBuffer(), file.name)); status('PDF 文字已读取。');
  } finally { input('pdf').value = ''; }
}));
$('load-pdf').addEventListener('click', () => {
  let url: URL, permission: Promise<boolean>;
  try {
    url = new URL(input('pdf-url').value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('在线 PDF 请使用不含凭证的 HTTPS 地址。');
    permission = extension ? chrome.permissions.request({ origins: [`${url.origin}/*`] }) : Promise.resolve(true);
  } catch (error) { status((error as Error).message, true); return; }
  void perform(async () => {
    if (!await permission) throw new Error('未授权 PDF 来源。');
    status('正在下载 PDF…');
    const response = await fetch(url.href, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`PDF 下载失败：HTTP ${response.status}`);
    if (!response.body) throw new Error('PDF 响应为空。');
    const reader = response.body.getReader(); const parts: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        size += value.byteLength; if (size > 30 * 1024 * 1024) throw new Error('PDF 超过 30 MB。'); parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const data = new Uint8Array(size); let offset = 0; for (const part of parts) { data.set(part, offset); offset += part.length; }
    showSource(await readPdf(data.buffer, decodeURIComponent(url.pathname.split('/').pop() || '在线 PDF'), url.href)); status('PDF 文字已读取。');
  });
});
$('summarize').addEventListener('click', () => void perform(async () => {
  if (extension) await settingsUI.initialize(); const config = currentSettings(); await ensureApi(config);
  if (!source.text.trim()) throw new Error('请先读取或粘贴正文。');
  resetConversation(); controller = new AbortController(); $<HTMLButtonElement>('cancel').disabled = false; const view = renderAnswer('assistant', '正在分析…', source.title, source.url);
  view.article.scrollIntoView({ block: 'start', behavior: 'smooth' });
  try {
    const partial = !settingsUI.summarizeFullText() && Array.from(source.text).length > config.chunkSize;
    const material = partial ? { ...source, text: Array.from(source.text).slice(0, config.chunkSize).join('') } : source;
    const answer = await summarize(material, config, view.update, text => status(`${partial ? '仅处理第一段，未覆盖全文。' : ''}${text}`), AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]), fallbackNotice, view.updateTitle);
    longContext = answer;
    history = [{ role: 'user', content: config.template }, { role: 'assistant', content: answer }];
    retryLast = () => $('summarize').click();
    status(`总结完成，${partial ? '本次仅处理第一段，未覆盖全文。' : '可以继续提问或导出。'}${usingFallback ? '已使用备用接口。' : ''}`);
  } catch (error) { view.article.remove(); throw error; }
}));
$('question-form').addEventListener('submit', event => {
  event.preventDefault(); const question = input('question').value.trim();
  void perform(async () => {
    if (extension) await settingsUI.initialize(); const config = currentSettings(); await ensureApi(config);
    if (!source.text.trim() || !question) throw new Error('请先准备正文并输入问题。');
    controller = new AbortController(); $<HTMLButtonElement>('cancel').disabled = false; const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]);
    let context = source;
    if (Array.from(source.text).length > config.chunkSize) {
      if (!longContext) longContext = await summarize(source, config, () => {}, text => status(text), signal, fallbackNotice);
      // 明确长文问答基于压缩后的资料，避免无提示截取前半篇。
      if (Array.from(longContext).length > config.chunkSize) throw new Error('摘要仍超过上下文预算，请用更简短的总结模板重新总结，或粘贴相关段落提问。');
      context = { ...source, text: longContext };
    }
    const user = renderAnswer('user', question); const answerView = renderAnswer('assistant', '正在回答…');
    status(context === source ? '正在回答…' : '正在基于长文摘要回答，摘要可能省略细节。');
    try {
      const recent: Message[] = []; let budget = config.chunkSize;
      for (let i = history.length - 2; i >= 0; i -= 2) {
        const pair = history.slice(i, i + 2); const length = pair.reduce((n, m) => n + m.content.length, 0);
        if (length > budget) break; recent.unshift(...pair); budget -= length;
      }
      const answer = await streamCompletion(config, sourceMessages(context, config, question, recent), answerView.update, signal, fallbackNotice);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: answer }); input('question').value = '';
      retryLast = () => {
        history.splice(-2); user.article.remove(); answerView.article.remove();
        input('question').value = question; $<HTMLFormElement>('question-form').requestSubmit();
      };
      status(`${context === source ? '回答完成。' : '回答完成。本次依据长文摘要；核对细节时可粘贴相关段落。'}${usingFallback ? '已使用备用接口。' : ''}`);
    } catch (error) { user.article.remove(); answerView.article.remove(); throw error; }
  });
});
$('retry').addEventListener('click', () => { const retry = retryLast; retryLast = undefined; $<HTMLButtonElement>('retry').disabled = true; retry?.(); });
$('cancel').addEventListener('click', () => controller?.abort());
$('clear').addEventListener('click', () => { showSource({ title: '粘贴内容', url: '', text: '', kind: 'paste' }); status('材料和对话已清空。'); });
$('export').addEventListener('click', () => {
  if (!history.length) { status('完成总结或问答后即可导出。', true); return; }
  const markdown = `# ${source.title}\n\n来源：${source.url || '本地导入 / 粘贴'}\n\n${history.map(m => `## ${m.role === 'user' ? '问题' : '回答'}\n\n${m.content}`).join('\n\n')}`;
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = '阅读笔记.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
function notifyTheme() { if (embedded) window.parent.postMessage({ type: 'yuki-theme-state', dark: document.documentElement.classList.contains('dark') }, '*'); }
if (embedded) window.addEventListener('message', event => { if (event.source === window.parent && event.data?.type === 'yuki-toggle-theme') $('theme').click(); });
$('theme').addEventListener('click', () => { document.documentElement.classList.toggle('dark'); localStorage.setItem('reader-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light'); notifyTheme(); });
async function initialize() {
  if (localStorage.getItem('reader-theme') === 'dark' || (!localStorage.getItem('reader-theme') && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
  notifyTheme();
  await settingsUI.initialize();
  if (settingsPage) return;
  if (extension) {
    if (embedded) {
      const context = await chrome.runtime.sendMessage({ type: 'reader-embedded-context' });
      if (!Number.isInteger(context?.tabId)) throw new Error('无法确认当前页面，请关闭浮窗后重新打开。');
      pendingSourceKey = `pendingSource:${context.tabId}`;
    }
    const consume = async (next: Source & { autoSummarize?: boolean; requestId?: string; error?: string }) => {
      if (next.requestId && next.requestId === lastCaptureRequestId) return;
      lastCaptureRequestId = next.requestId;
      await chrome.storage.session.remove(pendingSourceKey);
      if (next.error) { status(next.error, true); return; }
      if (busy) { queuedSource = next; controller?.abort(); }
      else consumeCapturedSource(next);
    };
    let settingsRefresh: ReturnType<typeof setTimeout>;
    chrome.storage.onChanged.addListener((changes, area) => {
      if ((area === 'local' && changes.readerConfig) || (area === 'session' && changes.readerProfileKeys)) {
        clearTimeout(settingsRefresh); settingsRefresh = setTimeout(() => { if (!busy) void settingsUI.initialize(); }, 100);
      }
      if (area === 'session' && changes[pendingSourceKey]?.newValue) void consume(changes[pendingSourceKey].newValue);
    });
    const session = await chrome.storage.session.get(pendingSourceKey);
    if (session[pendingSourceKey]) await consume(session[pendingSourceKey]);
  } else {
    status('网页预览模式：可粘贴正文、导入 PDF。读取标签页请加载构建后的 Chrome 扩展。');
  }
}
void initialize().catch(error => status(`初始化失败：${error.message}`, true));
