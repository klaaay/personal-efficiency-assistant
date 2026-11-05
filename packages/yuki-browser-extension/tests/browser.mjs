import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';

const dist = resolve('dist');
const artifacts = resolve('../../.local/verification/summarizer');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'yuki-reader-test-'));
const fixture = join(profile, 'extension');
await cp(dist, fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
// 无头浏览器无法操作原生权限对话框；只在测试副本预授予本地测试服务域。
manifest.host_permissions = ['http://127.0.0.1/*', 'https://www.youtube.com/*'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const calls = [];
let primaryFails = false;
const server = createServer((req, res) => {
  if (req.url === '/article') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(`<html lang="zh-CN"><title>阅读助手验收文章</title><body><nav>不要把导航当正文</nav><main><h1>项目阅读效率报告</h1>${Array.from({ length: 12 }, (_, i) => `<p>第 ${i + 1} 段：阅读助手应该完整提取文章的关键证据，帮助用户分析事实、比较不同观点并总结结论。团队本周完成三项任务，下一阶段将在周五之前完成资料整理和验收工作。</p>`).join('')}</main></body></html>`); return;
  }
  if (req.url === '/custom-gateway/completions') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => {
      calls.push({ ...JSON.parse(body), route: req.url, auth: req.headers.authorization }); res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
      res.end('data: '+JSON.stringify({ choices: [{ delta: { content: '## 阅读结论\n\n- 三项任务已完成。\n- 下一阶段在周五前完成。\n\n<script>window.__unsafe=true</script><img src="https://example.com/tracker">' } }] })+'\n\ndata: [DONE]\n\n');
    }); return;
  }
  if (req.url === '/v1/messages') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => {
      const request = JSON.parse(body);
      calls.push({ ...request, route: req.url, auth: req.headers.authorization, version: req.headers['anthropic-version'] });
      if (primaryFails) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: { message: 'local fixture outage' } })); return; }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const event of [
        { type: 'content_block_delta', delta: { type: 'text_delta', text: (request.messages.at(-1).content.includes('<yuki-title>') ? '<yuki-title>阅读效率报告</yuki-title>\n\n' : '') + 'Anthropic 协议总结已完成。' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' } },
        { type: 'message_stop' },
      ]) res.write(`data: ${JSON.stringify(event)}\n\n`);
      res.end();
    }); return;
  }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const errors = [];
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, headless: true, args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`] });
  let [worker] = context.serviceWorkers(); worker ||= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
  await page.goto(`chrome-extension://${id}/index.html`);
  await expect(page.locator('h1')).toHaveText('把阅读变成收获');
  await expect(page.locator('#settings-view')).toBeHidden();
  const optionsTab = context.waitForEvent('page'); await page.locator('#open-settings').click();
  const settings = await optionsTab; await settings.waitForLoadState();
  await expect(settings.locator('h1')).toHaveText('阅读助手设置');
  await expect(settings.locator('#reader-view')).toBeHidden();
  await page.locator('#source-details').evaluate(el => { el.open = true; });
  await settings.locator('#provider').selectOption('custom');
  await settings.locator('#endpoint').fill(`${origin}/custom-gateway/completions`);
  await settings.locator('#model').fill('test-model');
  await settings.getByRole('button', { name: '保存并授权接口' }).click();
  await expect(settings.locator('#status')).toContainText('设置已保存', { timeout: 10000 });
  await settings.reload(); await page.reload(); await page.locator('#source-details').evaluate(el => { el.open = true; });
  await expect(settings.locator('#endpoint')).toHaveValue(`${origin}/custom-gateway/completions`);
  await expect(settings.locator('#provider')).toHaveValue('custom');
  await expect(settings.locator('#model')).toHaveValue('test-model');
  const article = await context.newPage(); await article.goto(`${origin}/article`);
  // 本地来源在测试副本预授权；验证实际构建的注入文件及隔离世界调用。
  const extracted = await page.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url: `${url}/article` });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.YukiCapture.capture() });
    return result.result;
  }, origin);
  expect(extracted.kind).toBe('page'); expect(extracted.text).toContain('第 12 段');
  await article.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('p')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  const selected = await page.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url: `${url}/article` });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.YukiCapture.capture() });
    return result.result;
  }, origin);
  expect(selected.kind).toBe('selection'); expect(selected.text).toContain('第 1 段');
  const youtube = await context.newPage();
  let showTranscript = true;
  await youtube.route('https://www.youtube.com/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/timedtext') return route.fulfill({ json: { events: [{ tStartMs: 65000, segs: [{ utf8: '字幕中的关键证据' }] }] } });
    const player = JSON.stringify({ videoDetails: { videoId: 'fixture' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'zh', baseUrl: 'https://www.youtube.com/api/timedtext' }] } } });
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<html lang="zh"><title>字幕测试</title><body>${showTranscript ? '<ytd-transcript-segment-renderer>0:00 已展开的字幕</ytd-transcript-segment-renderer>' : ''}<script>var ytInitialPlayerResponse = ${player};</script></body></html>` });
  });
  await youtube.goto('https://www.youtube.com/watch?v=fixture');
  const readVideo = () => page.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.YukiCapture.capture() });
    return result.result;
  });
  expect((await readVideo()).text).toContain('已展开的字幕');
  showTranscript = false; await youtube.reload();
  const captions = await readVideo(); expect(captions.kind).toBe('youtube'); expect(captions.text).toBe('[1:05] 字幕中的关键证据');
  await youtube.close();
  await page.bringToFront();
  await page.locator('#source-text').fill(extracted.text);
  await page.locator('#summarize').click();
  await expect(page.locator('#status')).toContainText('总结完成');
  expect(calls.length).toBe(1); expect(calls[0].model).toBe('test-model'); expect(calls[0].messages[1].content).toContain('第 12 段');
  await expect(page.locator('#conversation script, #conversation img')).toHaveCount(0);
  expect(await page.evaluate(() => window.__unsafe)).toBeUndefined();
  await page.locator('#question').fill('下一步什么时候完成？'); await page.locator('#ask').click();
  await expect(page.locator('#status')).toContainText('回答完成');
  expect(calls.length).toBe(2); expect(calls[1].messages.at(-1).content).toContain('下一步');
  const download = page.waitForEvent('download'); await page.locator('#export').click(); await (await download).saveAs(join(artifacts, '阅读笔记.md'));
  // Chromium 生成带文本层的真实 PDF，再通过扩展内的 PDF.js worker 解析。
  const pdfPage = await context.newPage(); await pdfPage.setContent('<h1>Reader PDF verification</h1><p>Evidence: 42 tasks completed.</p>');
  const pdf = await pdfPage.pdf(); await pdfPage.close();
  await page.locator('#pdf').setInputFiles({ name: 'verification.pdf', mimeType: 'application/pdf', buffer: pdf });
  await expect(page.locator('#source-text')).toHaveValue(/42 tasks completed/, { timeout: 15000 });
  await expect(page.locator('#source-text')).toHaveValue(/第 1 页/);
  await expect(page.locator('#conversation')).toBeEmpty();
  await page.setViewportSize({ width: 420, height: 1000 });
  await page.screenshot({ path: join(artifacts, 'reader-light.png'), fullPage: true });
  await page.locator('#theme').click(); await page.screenshot({ path: join(artifacts, 'reader-dark.png'), fullPage: true });
  await settings.locator('#settings').evaluate(el => { el.open = true; });
  await settings.locator('#provider').selectOption('anthropic');
  await settings.locator('#endpoint').fill(`${origin}/v1/messages`);
  await settings.locator('#model').fill('test-model');
  await settings.locator('#auth-mode').selectOption('bearer');
  await settings.locator('#api-key').fill('local-test-token');
  await settings.locator('#max-tokens').fill('2048');
  await settings.getByRole('button', { name: '保存并授权接口' }).click();
  await expect(settings.locator('#status')).toContainText('设置已保存');
  await settings.reload(); await page.reload(); await page.locator('#source-details').evaluate(el => { el.open = true; });
  await expect(settings.locator('#protocol')).toHaveValue('anthropic');
  await expect(settings.locator('#auth-mode')).toHaveValue('bearer');
  await expect(settings.locator('#endpoint')).toHaveValue(`${origin}/v1/messages`);
  await page.locator('#source-text').fill('测试资料：本周完成三项任务。');
  await page.locator('#summarize').click();
  await expect(page.locator('#status')).toContainText('总结完成');
  await expect(page.locator('#conversation')).toContainText('Anthropic 协议总结已完成');
  expect(calls.at(-1).model).toBe('test-model');
  expect(calls.at(-1).max_tokens).toBe(2048);
  expect(calls.at(-1).auth).toBe('Bearer local-test-token');
  expect(calls.at(-1).version).toBe('2023-06-01');
  expect(calls.at(-1).system).toContain('阅读助手');
  expect(calls.at(-1).messages.every(message => message.role !== 'system')).toBe(true);
  await page.locator('#question').fill('完成多少项任务？');
  await page.locator('#ask').click();
  await expect(page.locator('#status')).toContainText('回答完成');
  expect(calls.at(-1).messages.at(-1).content).toBe('完成多少项任务？');
  // 仅使用假密钥和本地接口；导入不会访问真实迁移文件。
  const imported = { readerConfig: {
    version: 1,
    profiles: [
      { id: 'gateway', name: '优先网关', endpoint: `${origin}/v1/messages`, model: 'primary-fixture', apiKey: 'primary-only-key', protocol: 'anthropic', authMode: 'bearer', maxTokens: 2048, remember: true },
      { id: 'official', name: '官方备用夹具', endpoint: `${origin}/custom-gateway/completions`, model: 'fallback-fixture', apiKey: 'fallback-only-key', protocol: 'openai', authMode: 'bearer', maxTokens: 4096, remember: true },
    ], primaryProfileId: 'gateway', fallbackProfileId: 'official',
    prompts: [{ id: 'legacy-prompt', title: '迁移提示词', question: '概括 {{TITLE}} 的 {{CONTENT}}，使用 {{SELECTED_LANGUAGE}}。', systemMessage: '迁移系统指令：用 {{SELECTED_LANGUAGE}} 回答，只根据资料。' }],
    activePromptId: 'legacy-prompt', language: '简体中文', chunkSize: 12000,
    preferences: { showSummarizeButton: false, showYoutubeButton: false, summarizeFullText: true },
  } };
  await settings.locator('#import-config').setInputFiles({ name: 'fixture-reader-config.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(settings.locator('#status')).toContainText('已读取 2 套接口与 1 条提示词');
  await settings.getByRole('button', { name: '保存并授权接口' }).click();
  await expect(settings.locator('#status')).toContainText('设置已保存');
  await settings.reload(); await page.reload(); await page.locator('#source-details').evaluate(el => { el.open = true; });
  await expect(settings.locator('#primary-profile')).toHaveValue('gateway');
  await expect(settings.locator('#fallback-profile')).toHaveValue('official');
  await expect(settings.locator('#language')).toHaveValue('简体中文');
  await expect(settings.locator('#prompt-profile')).toHaveValue('legacy-prompt');
  await expect(settings.locator('#system-instruction')).toHaveValue(imported.readerConfig.prompts[0].systemMessage);
  // 配置导出默认脱敏，显式包含密钥时可完整还原双接口与提示词。
  async function exportConfig() {
    const pending = settings.waitForEvent('download'); await settings.locator('#export-config').click();
    const download = await pending; return JSON.parse(await readFile(await download.path(), 'utf8'));
  }
  const sanitized = await exportConfig();
  expect(sanitized.readerConfig.profiles.map(profile => profile.apiKey)).toEqual(['', '']);
  expect(sanitized.readerConfig.prompts).toEqual(imported.readerConfig.prompts);
  await settings.locator('#export-keys').check();
  const complete = await exportConfig(); expect(complete.readerConfig).toEqual(imported.readerConfig);
  await settings.locator('#import-config').setInputFiles({ name: 'roundtrip.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(complete)) });
  await expect(settings.locator('#status')).toContainText('已读取 2 套接口');
  await settings.getByRole('button', { name: '保存并授权接口' }).click();
  await expect(settings.locator('#status')).toContainText('设置已保存');
  await settings.locator('#import-config').setInputFiles({ name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{broken') });
  await expect(settings.locator('#status')).toContainText('不是有效 JSON');
  const saved = await page.evaluate(() => chrome.storage.local.get(['readerConfig', 'readerMigrationBackup']));
  expect(saved.readerConfig.profiles.map(profile => profile.apiKey)).toEqual(['primary-only-key', 'fallback-only-key']);
  expect(saved.readerMigrationBackup.snapshot).toBeTruthy();
  await page.locator('#source-text').fill('迁移资料：星期五完成三项任务。');
  const beforePrimary = calls.length;
  await page.locator('#summarize').click();
  await expect(page.locator('#status')).toContainText('总结完成');
  expect(calls.length).toBe(beforePrimary + 1);
  expect(calls.at(-1).route).toBe('/v1/messages');
  expect(calls.at(-1).auth).toBe('Bearer primary-only-key');
  expect(calls.at(-1).system).toContain('迁移系统指令：用 简体中文 回答');
  expect(calls.at(-1).messages.at(-1).content).toContain('迁移资料：星期五完成三项任务。');
  expect(calls.at(-1).messages.at(-1).content).not.toContain('{{CONTENT}}');
  await page.getByRole('button', { name: '复制总结', exact: true }).click();
  await expect(page.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '复制总结', exact: true })).toBeVisible({ timeout: 3000 });
  const beforeRetry = calls.length;
  await page.locator('#retry').click();
  await expect(page.locator('#status')).toContainText('总结完成');
  expect(calls.length).toBe(beforeRetry + 1);
  await expect(page.locator('#conversation .assistant')).toHaveCount(1);
  primaryFails = true;
  const beforeFallback = calls.length;
  await page.locator('#summarize').click();
  await expect(page.locator('#status')).toContainText('已使用备用接口');
  expect(calls.length).toBe(beforeFallback + 2);
  expect(calls.slice(-2).map(call => [call.route, call.auth, call.model])).toEqual([
    ['/v1/messages', 'Bearer primary-only-key', 'primary-fixture'],
    ['/custom-gateway/completions', 'Bearer fallback-only-key', 'fallback-fixture'],
  ]);
  await expect(page.locator('#conversation')).toContainText('阅读结论');
  primaryFails = false;
  await settings.locator('#copy-prompt').click();
  await expect(settings.locator('#status')).toContainText('提示词已创建');
  await settings.locator('#prompt-title').fill('编辑后的副本');
  await settings.locator('#instruction').fill('复述 {{CONTENT}}');
  await settings.locator('#system-instruction').fill('副本系统指令');
  await settings.locator('#save-prompt').click();
  await expect(settings.locator('#status')).toContainText('提示词已保存');
  const copiedPromptId = await settings.locator('#prompt-profile').inputValue();
  await settings.locator('#prompt-profile').selectOption('legacy-prompt');
  await expect(settings.locator('#status')).toContainText('已启用提示词');
  await expect(settings.locator('#instruction')).toHaveValue(imported.readerConfig.prompts[0].question);
  await settings.reload(); await page.reload(); await page.locator('#source-details').evaluate(el => { el.open = true; });
  await expect(settings.locator('#prompt-profile')).toHaveValue('legacy-prompt');
  await settings.locator('#prompt-profile').selectOption(copiedPromptId);
  await expect(settings.locator('#status')).toContainText('已启用提示词');
  await expect(settings.locator('#instruction')).toHaveValue('复述 {{CONTENT}}');
  await expect(settings.locator('#system-instruction')).toHaveValue('副本系统指令');
  await settings.locator('#delete-prompt').click();
  await expect(settings.locator('#status')).toContainText('提示词已删除');
  await expect(settings.locator('#prompt-profile option')).toHaveCount(1);
  // 广域原生授权弹窗不在无头测试范围；用已授予的本地来源验证开关与实际点击。
  await worker.evaluate(() => {
    chrome.storage.onChanged.addListener((changes, area) => { if (area === 'session') { const change = Object.entries(changes).find(([key, change]) => key.startsWith('pendingSource:') && change.newValue?.text); if (change) globalThis.__launcherCapturedSource = change[1].newValue; } });
    return chrome.storage.local.set({ readerPreferences: { showSummarizeButton: true, showYoutubeButton: false } });
  });
  await article.bringToFront();
  await article.evaluate(() => getSelection().removeAllRanges());
  await expect(article.locator('#yuki-reader-launcher')).toBeAttached();
  const launcherBox = await article.locator('#yuki-reader-launcher').boundingBox();
  await article.mouse.click(launcherBox.x + launcherBox.width / 2, launcherBox.y + launcherBox.height / 2);
  await expect.poll(() => worker.evaluate(() => globalThis.__launcherCapturedSource?.text)).toContain('第 12 段');
  await expect(article.locator('#yuki-reader-window')).toBeAttached();
  await expect.poll(() => article.frames().some(frame => frame.url().includes('/index.html?embedded=1'))).toBe(true);
  const embedded = article.frames().find(frame => frame.url().includes('/index.html?embedded=1'));
  await expect(embedded.locator('#source-text')).toHaveValue(/第 12 段/);
  await expect(embedded.locator('#status')).toContainText('总结完成', { timeout: 15000 });
  await expect(embedded.locator('#conversation')).toContainText('Anthropic 协议总结已完成');
  await expect(embedded.locator('.summary-title')).toHaveText('阅读效率报告');
  await expect(embedded.locator('#settings-view')).toBeHidden();
  const top = await embedded.locator('.summary-title').boundingBox(); expect(top.y).toBeLessThan(250);
  await embedded.evaluate(() => { Object.defineProperty(navigator.clipboard, 'writeText', { value: async text => { window.__copiedSummary = text; }, configurable: true }); });
  await embedded.getByRole('button', { name: '复制总结', exact: true }).evaluate(button => button.click());
  await expect(embedded.getByRole('button', { name: '已复制', exact: true })).toBeVisible();
  await expect(embedded.getByRole('button', { name: '复制总结', exact: true })).toBeVisible({ timeout: 3000 });
  await expect(embedded.locator('header')).toBeHidden();
  await expect(embedded.locator('#status')).toBeHidden();
  expect(await embedded.evaluate(() => window.__copiedSummary)).toBe(`### [阅读效率报告](${origin}/article)\n\nAnthropic 协议总结已完成。`);
  expect(calls.at(-1).route).toBe('/v1/messages');
  expect(calls.at(-1).messages.some(message => message.content.includes('第 12 段'))).toBe(true);
  const windowBox = await article.locator('#yuki-reader-window').boundingBox();
  expect(windowBox.width).toBeGreaterThan(550); expect(windowBox.x).toBeGreaterThan(0); expect(windowBox.y).toBeLessThan(30);
  await article.screenshot({ path: join(artifacts, 'reader-page-window.png'), fullPage: true });
  const wasDark = await embedded.locator('html').evaluate(el => el.classList.contains('dark'));
  await article.mouse.click(windowBox.x + windowBox.width - 90, windowBox.y + 22);
  await expect.poll(() => embedded.locator('html').evaluate(el => el.classList.contains('dark'))).toBe(!wasDark);
  const optionsOpened = context.waitForEvent('page');
  await settings.close();
  await article.mouse.click(windowBox.x + windowBox.width - 122, windowBox.y + 22);
  const toolbarSettings = await optionsOpened; await toolbarSettings.waitForLoadState();
  expect(toolbarSettings.url()).toContain('view=settings'); await toolbarSettings.close(); await article.bringToFront();
  // 外层 closed shadow 避免宿主样式/正文提取干扰，以真实坐标操作其折叠与关闭。
  await article.mouse.click(windowBox.x + windowBox.width - 58, windowBox.y + 22);
  await expect.poll(async () => (await article.locator('#yuki-reader-window').boundingBox()).height).toBeLessThan(80);
  await article.mouse.click(windowBox.x + windowBox.width - 58, windowBox.y + 22);
  await expect.poll(async () => (await article.locator('#yuki-reader-window').boundingBox()).height).toBeGreaterThan(200);
  await article.mouse.click(windowBox.x + windowBox.width - 26, windowBox.y + 22);
  await expect(article.locator('#yuki-reader-window')).toHaveCount(0);

  await worker.evaluate(() => chrome.storage.local.set({ readerPreferences: { showSummarizeButton: false, showYoutubeButton: false } }));
  await expect(article.locator('#yuki-reader-launcher')).toHaveCount(0);
  await expect.poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts({ ids: ['reader-launcher'] })).length)).toBe(0);
  expect(errors).toEqual([]);
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ extensionId: id, passed: ['separate-settings-page', 'config-export-redacted-and-full-roundtrip', 'invalid-import-preserves-config', 'summary-title-top-and-copy', 'extension-load', 'settings-with-pregranted-local-host', 'custom-endpoint-persisted-and-used', 'anthropic-settings-stream-and-followup', 'config-import-backup-and-persistence', 'primary-success-no-fallback', 'primary-failure-fallback-isolated-auth', 'prompt-copy-edit-activate-delete', 'answer-copy-retry', 'launcher-toggle-and-capture', 'page-window-auto-summary-collapse-close', 'article-extraction', 'selection', 'youtube-fixture-transcript-and-captions', 'stream-summary', 'followup', 'markdown-sanitization', 'export', 'pdf-worker', 'theme'], api: 'local mock; no external model called', permissionPrompt: 'not tested; localhost and mocked YouTube pregranted in temporary manifest', errors }, null, 2));
  console.log('PASS: 原有阅读流程及配置导入备份、双接口回退、密钥隔离、提示词管理、回答复制重试、网页按钮点击验收通过；模型接口均为本地测试服务。');
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); }
