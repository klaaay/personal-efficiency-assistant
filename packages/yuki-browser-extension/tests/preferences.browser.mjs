import { chromium, expect } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile, readFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { createServer } from 'node:http';

const artifacts = resolve(process.env.YUKI_VERIFICATION_DIR || '../../.local/verification/yuki-preferences');
await mkdir(artifacts, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'yuki-preferences-test-'));
const fixture = join(profile, 'extension');
await cp(resolve('dist'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
// 仅在临时测试副本预授权；不操作用户浏览器，也不测试原生权限弹窗。
manifest.host_permissions = ['http://*/*', 'https://*/*'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
const articleText = '首段标记' + '甲'.repeat(1100) + '尾段证据' + '乙'.repeat(1100);
const calls = []; const passed = []; const errors = []; let liveYoutube;
const server = createServer((req, res) => {
  if (req.url === '/article') {
    res.setHeader('Content-Type', 'text/html;charset=utf-8');
    res.end(`<html lang="zh"><title>阅读偏好验收文章</title><body><main><h1>阅读偏好验收文章</h1><p>${articleText}</p></main></body></html>`); return;
  }
  if (req.url === '/v1/chat/completions') {
    let body = ''; req.on('data', chunk => body += chunk);
    req.on('end', () => {
      calls.push(JSON.parse(body));
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { content: '<yuki-title>验收标题</yuki-title>\n\n验收摘要。' }, finish_reason: 'stop' }] }));
    }); return;
  }
  res.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let context;
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true,
    ...(process.env.YUKI_BROWSER_PROXY ? { proxy: { server: process.env.YUKI_BROWSER_PROXY, bypass: 'localhost,127.0.0.1' } } : {}),
    args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`] });
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  let [worker] = context.serviceWorkers(); worker ||= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const settings = await context.newPage(); await settings.goto(`chrome-extension://${id}/index.html?view=settings`);
  await settings.locator('#provider').selectOption('custom');
  await settings.locator('#endpoint').fill(`${origin}/v1/chat/completions`);
  await settings.locator('#model').fill('preferences-local-fixture');
  await settings.locator('#api-key').fill('fake-local-key');
  await settings.locator('#chunk-size').fill('1000');
  async function savePreferences(web, youtube, fullText) {
    await settings.locator('#showSummarizeButton').setChecked(web);
    await settings.locator('#showYoutubeButton').setChecked(youtube);
    await settings.locator('#summarizeFullText').setChecked(fullText);
    await settings.getByRole('button', { name: '保存', exact: true }).click();
    await expect(settings.locator('#status')).toContainText('设置已保存');
    await settings.reload();
    await expect(settings.locator('#showSummarizeButton')).toBeChecked({ checked: web });
    await expect(settings.locator('#showYoutubeButton')).toBeChecked({ checked: youtube });
    await expect(settings.locator('#summarizeFullText')).toBeChecked({ checked: fullText });
    const saved = await settings.evaluate(() => chrome.storage.local.get(['readerConfig', 'readerPreferences']));
    const expected = { showSummarizeButton: web, showYoutubeButton: youtube, summarizeFullText: fullText };
    expect(saved.readerConfig.preferences).toEqual(expected); expect(saved.readerPreferences).toEqual(expected);
  }
  async function clickLauncher(page) {
    await page.bringToFront();
    // 总结浮窗会遮住右下角按钮，先通过浮窗关闭按钮结束上一轮。
    if (await page.locator('#yuki-reader-window').count()) {
      const windowBox = await page.locator('#yuki-reader-window').boundingBox();
      await page.mouse.click(windowBox.x + windowBox.width - 26, windowBox.y + 22);
      await expect(page.locator('#yuki-reader-window')).toHaveCount(0);
    }
    await expect(page.locator('#yuki-reader-launcher')).toBeAttached();
    await page.locator('#yuki-reader-launcher').click();
    await expect(page.locator('#yuki-reader-window')).toBeAttached();
    await expect.poll(() => page.frames().some(frame => frame.url().includes('/index.html?embedded=1'))).toBe(true);
    return page.frames().find(frame => frame.url().includes('/index.html?embedded=1'));
  }
  await savePreferences(false, false, true);
  const article = await context.newPage(); await article.goto(`${origin}/article`);
  const youtube = await context.newPage(); let transcript = false; let captionsAvailable = true;
  await youtube.route('https://www.youtube.com/**', route => {
    if (new URL(route.request().url()).pathname === '/api/timedtext') return route.fulfill({ json: { events: [{ tStartMs: 65000, segs: [{ utf8: '字幕证据：周五完成任务。' }] }] } });
    const player = { videoDetails: { videoId: 'preferences-fixture' }, ...(captionsAvailable ? { captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: 'zh', baseUrl: 'https://www.youtube.com/api/timedtext' }] } } } : {}) };
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<html lang="zh"><title>YouTube 阅读按钮验收</title><body><main>页面评论不应作为视频资料</main>${transcript ? '<ytd-transcript-segment-renderer>0:00 已展开文字稿证据</ytd-transcript-segment-renderer>' : ''}<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script></body></html>` });
  });
  await youtube.goto('https://www.youtube.com/watch?v=preferences-fixture');
  await expect(article.locator('#yuki-reader-launcher')).toHaveCount(0);
  await expect(youtube.locator('#yuki-reader-launcher')).toHaveCount(0);
  expect(calls).toHaveLength(0); passed.push('both-buttons-off-no-model-request');

  // 与用户截图相同：仅 YouTube 按钮开启，处理全文关闭。
  await savePreferences(false, true, false);
  await settings.screenshot({ path: join(artifacts, 'saved-screenshot-preferences.png'), fullPage: true });
  await expect(article.locator('#yuki-reader-launcher')).toHaveCount(0);
  let embedded = await clickLauncher(youtube);
  await expect(embedded.locator('#status')).toContainText('总结完成');
  await expect(embedded.locator('#source-kind')).toHaveText('视频字幕');
  expect(calls.at(-1).messages[1].content).toContain('[1:05] 字幕证据');
  expect(calls.at(-1).messages[1].content).not.toContain('页面评论');
  await youtube.screenshot({ path: join(artifacts, 'youtube-button-captions.png'), fullPage: true });
  passed.push('screenshot-preferences-persist-and-youtube-button-captions-summary');
  transcript = true; await youtube.reload(); embedded = await clickLauncher(youtube);
  await expect(embedded.locator('#status')).toContainText('总结完成');
  expect(calls.at(-1).messages[1].content).toContain('已展开文字稿证据');
  passed.push('youtube-button-expanded-transcript-summary');

  await savePreferences(true, false, true);
  await expect(youtube.locator('#yuki-reader-launcher')).toHaveCount(0);
  let before = calls.length; embedded = await clickLauncher(article);
  await expect(embedded.locator('#status')).toContainText('总结完成');
  const fullCalls = calls.slice(before);
  expect(fullCalls.length).toBeGreaterThan(1);
  expect(fullCalls.some(call => call.messages[1].content.includes('尾段证据'))).toBe(true);
  await expect(embedded.locator('#source-text')).toHaveValue(/尾段证据/);
  await article.screenshot({ path: join(artifacts, 'web-button-full-text.png'), fullPage: true });
  passed.push('web-button-only-and-full-text-includes-tail');

  await savePreferences(true, false, false);
  before = calls.length; embedded = await clickLauncher(article);
  await expect(embedded.locator('#status')).toContainText('本次仅处理第一段，未覆盖全文');
  const fullSource = await embedded.locator('#source-text').inputValue();
  expect(calls.length - before).toBe(1);
  const sentText = calls.at(-1).messages[1].content.split('<document>\n')[1].split('\n</document>')[0];
  expect(sentText).toBe(Array.from(fullSource).slice(0, 1000).join(''));
  expect(sentText).not.toContain('尾段证据'); expect(fullSource).toContain('尾段证据');
  await article.screenshot({ path: join(artifacts, 'web-button-first-chunk.png'), fullPage: true });
  passed.push('full-text-off-sends-exactly-first-1000-characters');

  await savePreferences(false, true, false);
  await expect(article.locator('#yuki-reader-launcher')).toHaveCount(0);
  transcript = false; captionsAvailable = false; await youtube.reload(); before = calls.length;
  embedded = await clickLauncher(youtube);
  await expect(embedded.locator('#status')).toContainText('无法读取当前页面', { timeout: 20000 });
  expect(calls.length).toBe(before); passed.push('missing-video-captions-reports-failure-no-model-request');

  if (process.env.YUKI_LIVE_YOUTUBE_URL) {
    const real = await context.newPage();
    try {
      const response = await real.goto(process.env.YUKI_LIVE_YOUTUBE_URL, { waitUntil: 'domcontentloaded', timeout: 20000 });
      liveYoutube = { url: real.url(), status: response?.status(), title: await real.title(), proxy: process.env.YUKI_BROWSER_PROXY || 'none' };
      await expect(real.locator('#yuki-reader-launcher')).toBeAttached({ timeout: 10000 });
      liveYoutube.buttonVisible = true; before = calls.length;
      const reader = await clickLauncher(real);
      await expect.poll(() => reader.locator('#status').textContent(), { timeout: 40000 }).toMatch(/总结完成|无法读取当前页面/);
      liveYoutube.readerStatus = await reader.locator('#status').textContent();
      liveYoutube.summarized = calls.length > before && liveYoutube.readerStatus.includes('总结完成');
      if (liveYoutube.summarized) {
        const source = await reader.locator('#source-text').inputValue();
        liveYoutube.source = { characters: Array.from(source).length, preview: source.slice(0, 180), tail: source.slice(-180), segments: await real.locator('transcript-segment-view-model, ytd-transcript-segment-renderer').count() };
        await writeFile(join(artifacts, 'live-transcript-segment.html'), await real.locator('transcript-segment-view-model').first().evaluate(node => node.outerHTML));
        await expect(reader.locator('#source-kind')).toHaveText('视频字幕');
        expect(source).toContain('Please visit us at stanford.edu');
        expect(source).toMatch(/Stay hungry/i);
        expect(source).not.toMatch(/\[\d{1,2}:\d{2}\]\s*\d{1,2}:\d{2}/);
        expect(calls.at(-1).messages[1].content).toContain('Please visit us at stanford.edu');
        await reader.locator('#source-details').evaluate(node => { node.open = true; });
        passed.push('live-youtube-one-click-auto-transcript-summary');
      }
      await real.screenshot({ path: join(artifacts, 'live-youtube.png'), fullPage: false });
      if (!liveYoutube.summarized) {
        liveYoutube.captureDiagnostic = await settings.evaluate(async url => {
          const [tab] = await chrome.tabs.query({ url });
          const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
            try { const source = await globalThis.YukiCapture.capture(); return { kind: source.kind, characters: source.text.length, preview: source.text.slice(0, 150) }; }
            catch (error) { return { error: error.message }; }
          } });
          return result.result;
        }, real.url());
        liveYoutube.pageDiagnostic = await real.evaluate(async () => {
          const player = window.ytInitialPlayerResponse;
          const html = await (await fetch(location.href)).text();
          const match = /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s.exec(html);
          let fetchedPlayer; try { fetchedPlayer = match ? JSON.parse(match[1]) : undefined; } catch {}
          const tracks = fetchedPlayer?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
          let captionResponse;
          if (tracks.length) {
            const url = new URL(tracks[0].baseUrl); url.searchParams.set('fmt', 'json3');
            const response = await fetch(url); const body = await response.text();
            captionResponse = { status: response.status, contentType: response.headers.get('content-type'), bytes: body.length, validJson: false };
            try { const captions = JSON.parse(body); captionResponse.validJson = true; captionResponse.events = captions.events?.length; } catch {}
          }
          return { playerVideoId: player?.videoDetails?.videoId, playability: player?.playabilityStatus?.status, playabilityReason: player?.playabilityStatus?.reason, playerCaptionTracks: player?.captions?.playerCaptionsTracklistRenderer?.captionTracks?.length, fetchedPlayerFound: !!fetchedPlayer, fetchedCaptionTracks: tracks.length, captionResponse, transcriptSegments: document.querySelectorAll('ytd-transcript-segment-renderer').length, modernTranscriptSegments: document.querySelectorAll('yt-transcript-segment-view-model').length, transcriptButtons: [...document.querySelectorAll('button')].filter(button => /transcript|文字稿|字幕/i.test(button.textContent)).map(button => ({ text: button.textContent, visible: !!button.getClientRects().length })) };
        });
        const windowBox = await real.locator('#yuki-reader-window').boundingBox();
        await real.mouse.click(windowBox.x + windowBox.width - 26, windowBox.y + 22);
        await real.locator('ytd-watch-metadata').scrollIntoViewIfNeeded();
        const more = real.locator('#description-inline-expander #expand, ytd-text-inline-expander #expand');
        if (await more.count()) await more.first().click();
        await real.screenshot({ path: join(artifacts, 'live-youtube-description.png'), fullPage: false });
        liveYoutube.descriptionDiagnostic = await real.evaluate(() => ({
          descriptions: [...document.querySelectorAll('#description, #description-inline-expander')].map(node => ({ tag: node.tagName, text: node.textContent?.slice(-2000) })),
          transcriptControls: [...document.querySelectorAll('button, a, tp-yt-paper-button')].filter(node => /transcript|文字稿|字幕|脚本|内容转文字|스크립트/i.test(node.textContent)).map(node => ({ tag: node.tagName, text: node.textContent?.slice(0, 100), visible: !!node.getClientRects().length })),
        }));
        const transcriptButton = real.getByRole('button', { name: /Show transcript|显示文字稿|顯示文字稿|显示转录|内容转文字|스크립트/i }).first();
        if (await transcriptButton.count()) {
          await transcriptButton.click();
          await real.getByText('Please visit us at stanford.edu', { exact: true }).first().waitFor({ timeout: 20000 });
          liveYoutube.transcriptDom = await real.evaluate(() => {
            const tags = {};
            for (const node of document.querySelectorAll('*')) if (/transcript|segment/i.test(node.tagName)) tags[node.tagName] = (tags[node.tagName] || 0) + 1;
            const text = [...document.querySelectorAll('*')].find(node => node.textContent?.trim() === 'Please visit us at stanford.edu');
            const parents = []; for (let node = text; node && parents.length < 6; node = node.parentElement) parents.push({ tag: node.tagName, class: node.className, id: node.id });
            return { tags, parents };
          });
          await real.screenshot({ path: join(artifacts, 'live-youtube-transcript-visible.png'), fullPage: false });
          before = calls.length; const expandedReader = await clickLauncher(real);
          await expect.poll(() => expandedReader.locator('#status').textContent(), { timeout: 20000 }).toMatch(/总结完成|无法读取当前页面/);
          liveYoutube.expandedTranscript = { segments: await real.locator('ytd-transcript-segment-renderer, transcript-segment-view-model').count(), readerStatus: await expandedReader.locator('#status').textContent(), summarized: calls.length > before };
          await expandedReader.locator('#source-details').evaluate(node => { node.open = true; });
          await real.screenshot({ path: join(artifacts, 'live-youtube-expanded-transcript.png'), fullPage: false });
        }
      }
    } catch (error) {
      liveYoutube = { ...liveYoutube, error: error.message };
      await real.screenshot({ path: join(artifacts, 'live-youtube-error.png'), fullPage: false }).catch(() => {});
    }
    await real.close();
  }
  await savePreferences(false, false, true);
  await expect(article.locator('#yuki-reader-launcher')).toHaveCount(0);
  await expect(youtube.locator('#yuki-reader-launcher')).toHaveCount(0);
  await expect.poll(() => worker.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts({ ids: ['reader-launcher'] })).length)).toBe(0);
  passed.push('buttons-remove-without-page-reload'); expect(errors).toEqual([]);
  await writeFile(join(artifacts, 'result.json'), JSON.stringify({ passed, liveYoutube, errors, model: 'local fixture only', permissionPrompt: 'HTTP(S) origins pregranted only in temporary test extension' }, null, 2));
  if (process.env.YUKI_REQUIRE_LIVE_SUCCESS || process.env.YUKI_LIVE_YOUTUBE_URL) {
    expect(liveYoutube?.error).toBeUndefined();
    expect(liveYoutube?.summarized, liveYoutube?.readerStatus).toBe(true);
  }
  console.log(JSON.stringify({ passed, liveYoutube, errors }, null, 2));
} finally { await context?.close(); await new Promise(resolve => server.close(resolve)); await rm(profile, { recursive: true, force: true }); }
