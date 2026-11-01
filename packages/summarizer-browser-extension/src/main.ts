import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { defaults, templates, validateSettings, streamCompletion, sourceMessages, summarize, type Source, type Settings, type Message } from './core';
import { readPdf } from './pdf';
import './style.css';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const textArea = $<HTMLTextAreaElement>('source-text');
const extension = typeof chrome !== 'undefined' && !!chrome.runtime?.id;
let settings: Settings = { ...defaults };
let source: Source = { title: '粘贴内容', url: '', text: '', kind: 'paste' };
let history: Message[] = [];
let controller: AbortController | undefined;
let busy = false;
let longContext: string | undefined;
let queuedSource: Source | undefined;
function status(message: string, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function resetConversation() { history = []; longContext = undefined; $('conversation').replaceChildren(); }
function showSource(next: Source) {
  source = next; textArea.value = source.text; resetConversation();
  $('source-title').textContent = source.title;
  $('source-kind').textContent = ({ page: '网页', selection: '选区', youtube: '视频字幕', pdf: 'PDF', paste: '粘贴内容' })[source.kind];
  $('count').textContent = `${Array.from(source.text).length.toLocaleString()} 字符`;
}
function setBusy(value: boolean) {
  busy = value;
  for (const id of ['capture', 'pdf', 'load-pdf', 'summarize', 'ask', 'clear', 'template', 'instruction', 'question']) {
    (document.getElementById(id) as HTMLInputElement).disabled = value;
  }
  textArea.disabled = value;
  $('settings-form').querySelectorAll<HTMLInputElement>('input, select, button').forEach(el => el.disabled = value);
  $<HTMLButtonElement>('cancel').disabled = !value || !controller;
}
async function perform(work: () => Promise<void>) {
  if (busy) return;
  setBusy(true);
  try { await work(); }
  catch (error) { status(error instanceof Error ? (error.name === 'AbortError' ? '已停止。本次未完成的回答没有加入对话。' : error.message) : String(error), true); }
  finally { controller = undefined; setBusy(false); if (queuedSource) { showSource(queuedSource); queuedSource = undefined; status('新的选区已读取。'); } }
}
function renderAnswer(role: 'user' | 'assistant', content = '') {
  const article = document.createElement('article'); article.className = `message ${role}`;
  const heading = document.createElement('h3'); heading.textContent = role === 'user' ? '你' : '阅读助手';
  const body = document.createElement('div'); article.append(heading, body); $('conversation').append(article);
  const update = (text: string) => {
    body.innerHTML = DOMPurify.sanitize(marked.parse(text, { async: false }) as string, { FORBID_TAGS: ['img', 'iframe', 'style', 'form', 'input', 'video', 'audio'], FORBID_ATTR: ['style'] });
    body.querySelectorAll('a').forEach(a => { a.target = '_blank'; a.rel = 'noopener noreferrer'; });
  };
  update(content); return { update, article };
}
function currentSettings() { return { ...settings, template: $<HTMLTextAreaElement>('instruction').value.trim() || templates.summary }; }
async function ensureApi(config: Settings) {
  const url = validateSettings(config);
  if (extension && !await chrome.permissions.contains({ origins: [`${url.origin}/*`] })) throw new Error('请先展开设置，保存并授权模型接口。');
}
function fillSettings() {
  for (const [id, value] of Object.entries({ endpoint: settings.endpoint, model: settings.model, 'api-key': settings.apiKey, language: settings.language, 'chunk-size': String(settings.chunkSize) })) input(id).value = value;
  $<HTMLTextAreaElement>('instruction').value = settings.template;
  $<HTMLSelectElement>('provider').value = settings.endpoint === defaults.endpoint ? 'openai' : settings.endpoint === 'https://api.deepseek.com/chat/completions' ? 'deepseek' : 'custom';
}
$('provider').addEventListener('change', () => {
  const provider = $<HTMLSelectElement>('provider').value;
  if (provider === 'openai') { input('endpoint').value = defaults.endpoint; input('model').value = defaults.model; }
  if (provider === 'deepseek') { input('endpoint').value = 'https://api.deepseek.com/chat/completions'; input('model').value = 'deepseek-chat'; }
  input('api-key').value = '';
});
$('settings-form').addEventListener('submit', event => {
  event.preventDefault();
  const next: Settings = { endpoint: input('endpoint').value.trim(), model: input('model').value.trim(), apiKey: input('api-key').value.trim(), language: input('language').value.trim(), chunkSize: Number(input('chunk-size').value), template: $<HTMLTextAreaElement>('instruction').value };
  let permission: Promise<boolean>;
  try {
    const url = validateSettings(next);
    // 权限请求必须同步发起于用户手势。
    permission = extension ? chrome.permissions.request({ origins: [`${url.origin}/*`] }) : Promise.resolve(true);
  } catch (error) { status((error as Error).message, true); return; }
  void perform(async () => {
    if (!await permission) throw new Error('接口访问未授权，设置尚未保存。');
    const remember = input('remember-key').checked;
    if (extension) {
      await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
      await chrome.storage.local.set({ settings: { ...next, apiKey: remember ? next.apiKey : '' }, remember });
      await chrome.storage.session.set({ apiKey: remember ? '' : next.apiKey });
    } else localStorage.setItem('reader-settings', JSON.stringify({ ...next, apiKey: '' }));
    settings = next; status('设置已保存。只有主动发起总结或提问时才会发送正文。');
    $<HTMLDetailsElement>('settings').open = false;
  });
});
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
    try { return { source: await (globalThis as unknown as { HaruhiCapture: { capture: () => Promise<Source> } }).HaruhiCapture.capture() }; }
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
  const config = currentSettings(); await ensureApi(config);
  if (!source.text.trim()) throw new Error('请先读取或粘贴正文。');
  resetConversation(); controller = new AbortController(); $<HTMLButtonElement>('cancel').disabled = false; const view = renderAnswer('assistant', '正在分析…');
  try {
    const answer = await summarize(source, config, view.update, text => status(text), AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]));
    longContext = answer;
    history = [{ role: 'user', content: config.template }, { role: 'assistant', content: answer }];
    status('总结完成，可以继续提问或导出。');
  } catch (error) { view.article.remove(); throw error; }
}));
$('question-form').addEventListener('submit', event => {
  event.preventDefault(); const question = input('question').value.trim();
  void perform(async () => {
    const config = currentSettings(); await ensureApi(config);
    if (!source.text.trim() || !question) throw new Error('请先准备正文并输入问题。');
    controller = new AbortController(); $<HTMLButtonElement>('cancel').disabled = false; const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(600000)]);
    let context = source;
    if (Array.from(source.text).length > config.chunkSize) {
      if (!longContext) longContext = await summarize(source, config, () => {}, text => status(text), signal);
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
      const answer = await streamCompletion(config, sourceMessages(context, config, question, recent), answerView.update, signal);
      history.push({ role: 'user', content: question }, { role: 'assistant', content: answer }); input('question').value = '';
      status(context === source ? '回答完成。' : '回答完成。本次依据长文摘要；核对细节时可粘贴相关段落。');
    } catch (error) { user.article.remove(); answerView.article.remove(); throw error; }
  });
});
$('cancel').addEventListener('click', () => controller?.abort());
$('clear').addEventListener('click', () => { showSource({ title: '粘贴内容', url: '', text: '', kind: 'paste' }); status('材料和对话已清空。'); });
$('export').addEventListener('click', () => {
  if (!history.length) { status('完成总结或问答后即可导出。', true); return; }
  const markdown = `# ${source.title}\n\n来源：${source.url || '本地导入 / 粘贴'}\n\n${history.map(m => `## ${m.role === 'user' ? '问题' : '回答'}\n\n${m.content}`).join('\n\n')}`;
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = '阅读笔记.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('theme').addEventListener('click', () => { document.documentElement.classList.toggle('dark'); localStorage.setItem('reader-theme', document.documentElement.classList.contains('dark') ? 'dark' : 'light'); });
async function initialize() {
  if (localStorage.getItem('reader-theme') === 'dark' || (!localStorage.getItem('reader-theme') && matchMedia('(prefers-color-scheme: dark)').matches)) document.documentElement.classList.add('dark');
  if (extension) {
    const [local, session] = await Promise.all([chrome.storage.local.get(['settings', 'remember']), chrome.storage.session.get(['apiKey', 'pendingSource'])]);
    settings = { ...defaults, ...local.settings, apiKey: local.remember ? local.settings?.apiKey || '' : session.apiKey || '' };
    input('remember-key').checked = !!local.remember;
    if (session.pendingSource) { showSource(session.pendingSource); await chrome.storage.session.remove('pendingSource'); }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'session' && changes.pendingSource?.newValue) {
        if (busy) { queuedSource = changes.pendingSource.newValue; controller?.abort(); } else showSource(changes.pendingSource.newValue); void chrome.storage.session.remove('pendingSource');
      }
    });
  } else {
    try { settings = { ...defaults, ...JSON.parse(localStorage.getItem('reader-settings') || '{}'), apiKey: '' }; } catch { /* 损坏设置回退默认值。 */ }
    status('网页预览模式：可粘贴正文、导入 PDF。读取标签页请加载构建后的 Chrome 扩展。');
  }
  fillSettings(); if (!settings.apiKey) $<HTMLDetailsElement>('settings').open = true;
}
void initialize().catch(error => status(`初始化失败：${error.message}`, true));
