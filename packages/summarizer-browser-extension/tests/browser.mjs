import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';

const dist = resolve('dist');
const artifacts = resolve('../../.local/verification/summarizer');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'haruhi-reader-test-'));
const fixture = join(profile, 'extension');
await cp(dist, fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
// 无头浏览器无法操作原生权限对话框；只在测试副本预授予本地测试服务域。
manifest.host_permissions = ['http://127.0.0.1/*', 'https://www.youtube.com/*'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const calls = [];
const server = createServer((req, res) => {
  if (req.url === '/article') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(`<html lang="zh-CN"><title>阅读助手验收文章</title><body><nav>不要把导航当正文</nav><main><h1>项目阅读效率报告</h1>${Array.from({ length: 12 }, (_, i) => `<p>第 ${i + 1} 段：阅读助手应该完整提取文章的关键证据，帮助用户分析事实、比较不同观点并总结结论。团队本周完成三项任务，下一阶段将在周五之前完成资料整理和验收工作。</p>`).join('')}</main></body></html>`); return;
  }
  if (req.url === '/v1/chat/completions') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => {
      calls.push(JSON.parse(body)); res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
      res.end('data: '+JSON.stringify({ choices: [{ delta: { content: '## 阅读结论\n\n- 三项任务已完成。\n- 下一阶段在周五前完成。\n\n<script>window.__unsafe=true</script><img src="https://example.com/tracker">' } }] })+'\n\ndata: [DONE]\n\n');
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
  await page.locator('#provider').selectOption('custom');
  await page.locator('#endpoint').fill(`${origin}/v1/chat/completions`);
  await page.locator('#model').fill('test-model');
  await page.getByRole('button', { name: '保存并授权接口' }).click();
  await expect(page.locator('#status')).toContainText('设置已保存', { timeout: 10000 });
  const article = await context.newPage(); await article.goto(`${origin}/article`);
  // 本地来源在测试副本预授权；验证实际构建的注入文件及隔离世界调用。
  const extracted = await page.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url: `${url}/article` });
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.HaruhiCapture.capture() });
    return result.result;
  }, origin);
  expect(extracted.kind).toBe('page'); expect(extracted.text).toContain('第 12 段');
  await article.evaluate(() => { const range = document.createRange(); range.selectNodeContents(document.querySelector('p')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
  const selected = await page.evaluate(async url => {
    const [tab] = await chrome.tabs.query({ url: `${url}/article` });
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.HaruhiCapture.capture() });
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
    const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => globalThis.HaruhiCapture.capture() });
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
  expect(calls.length).toBe(1); expect(calls[0].messages[1].content).toContain('第 12 段');
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
  expect(errors).toEqual([]);
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ extensionId: id, passed: ['extension-load', 'settings-with-pregranted-local-host', 'article-extraction', 'selection', 'youtube-fixture-transcript-and-captions', 'stream-summary', 'followup', 'markdown-sanitization', 'export', 'pdf-worker', 'theme'], api: 'local mock; no external model called', permissionPrompt: 'not tested; localhost and mocked YouTube pregranted in temporary manifest', errors }, null, 2));
  console.log('PASS: 扩展加载、已授权接口设置、正文/选区提取、流式总结、追问、Markdown净化、导出、PDF worker、主题；模型接口为本地测试服务。');
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); }
