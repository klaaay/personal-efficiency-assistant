import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, writeFile, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

const profile = await mkdtemp(join(tmpdir(), 'yuki-youtube-regression-'));
const fixture = join(profile, 'extension');
await cp(resolve('dist'), fixture, { recursive: true });
const manifest = JSON.parse(await readFile(join(fixture, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['https://www.youtube.com/*'];
await writeFile(join(fixture, 'manifest.json'), JSON.stringify(manifest));
let context; let mode = 'legacy'; let captionRequests = 0;
const modernTranscript = '<timeline-item-view-model><transcript-segment-view-model><div aria-hidden="true" class="ytwTranscriptSegmentViewModelTimestamp">0:10</div><div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">10秒钟</div><span role="text">第一条文字稿证据</span></transcript-segment-view-model></timeline-item-view-model><timeline-item-view-model><transcript-segment-view-model><div aria-hidden="true" class="ytwTranscriptSegmentViewModelTimestamp">1:05</div><div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">1分钟5秒钟</div><span role="text">第二条文字稿证据</span></transcript-segment-view-model></timeline-item-view-model>';
try {
  context = await chromium.launchPersistentContext(profile, { channel: 'chromium', headless: true, args: [`--disable-extensions-except=${fixture}`, `--load-extension=${fixture}`] });
  let [worker] = context.serviceWorkers(); worker ||= await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const extension = await context.newPage(); await extension.goto(`chrome-extension://${id}/index.html`);
  const youtube = await context.newPage();
  await youtube.route('https://www.youtube.com/**', route => {
    if (new URL(route.request().url()).pathname === '/api/timedtext') {
      captionRequests++;
      if (mode === 'network-error') return route.abort('failed');
      if (mode === 'http-error') return route.fulfill({ status: 503, body: '' });
      if (mode === 'empty' || mode === 'collapsed') return route.fulfill({ contentType: 'text/html', body: '' });
      if (mode === 'invalid-json') return route.fulfill({ contentType: 'text/html', body: 'not json' });
      return route.fulfill({ json: { events: [{ tStartMs: 65000, segs: [{ utf8: '远程字幕证据' }] }] } });
    }
    const tracks = mode === 'unavailable' || mode === 'modern' ? [] : [{ languageCode: 'zh', baseUrl: mode === 'bad-origin' ? 'https://untrusted.example.com/captions' : 'https://www.youtube.com/api/timedtext' }];
    const player = { videoDetails: { videoId: mode === 'mismatch' ? 'wrong-video' : 'regression' }, captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } } };
    const hasButton = ['empty', 'collapsed', 'invalid-json', 'http-error', 'network-error', 'bad-origin', 'mismatch'].includes(mode);
    return route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<html lang="zh"><title>视频字幕回归</title><body><main>评论不可作为视频资料</main>
      ${mode === 'legacy' ? '<ytd-transcript-segment-renderer>0:00 旧版文字稿证据</ytd-transcript-segment-renderer>' : ''}
      ${mode === 'modern' ? modernTranscript : ''}
      ${hasButton ? `<ytd-text-inline-expander><button id="expand">更多</button><ytd-video-description-transcript-section-renderer style="${mode === 'collapsed' ? 'display:none' : ''}"><button id="transcript">内容转文字</button></ytd-video-description-transcript-section-renderer></ytd-text-inline-expander>` : ''}
      <script>var ytInitialPlayerResponse = ${JSON.stringify(player)}; window.transcriptClicks=0;
      document.getElementById('expand')?.addEventListener('click',()=>document.querySelector('ytd-video-description-transcript-section-renderer').style.display='block');
      document.getElementById('transcript')?.addEventListener('click',()=>{window.transcriptClicks++;setTimeout(()=>document.body.insertAdjacentHTML('beforeend',${JSON.stringify(modernTranscript)}),20)});</script></body></html>` });
  });
  async function capture(nextMode) {
    mode = nextMode; captionRequests = 0;
    await youtube.goto('https://www.youtube.com/watch?v=regression');
    return extension.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://www.youtube.com/watch*' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['capture.js'] });
      const [result] = await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: async () => {
        try { return { source: await globalThis.YukiCapture.capture() }; } catch (error) { return { error: error.message }; }
      } });
      return result.result;
    });
  }
  const failures = [];
  async function check(name, run) {
    try { await run(); console.log(`PASS: ${name}`); }
    catch (error) { failures.push({ name, error: error.message }); console.error(`FAIL: ${name}: ${error.message}`); }
  }
  await check('旧版已展开文字稿保持可用', async () => {
    const result = await capture('legacy'); assert.equal(result.source?.kind, 'youtube'); assert.match(result.source.text, /旧版文字稿证据/); assert.equal(captionRequests, 0);
  });
  await check('新版文字稿及时间戳可直接读取，不调用字幕接口', async () => {
    const result = await capture('modern'); assert.equal(result.source?.kind, 'youtube', result.error);
    assert.equal(result.source.text, '[0:10] 第一条文字稿证据\n[1:05] 第二条文字稿证据'); assert.equal(captionRequests, 0);
  });
  await check('有效 JSON 字幕保持可用', async () => {
    const result = await capture('json'); assert.equal(result.source?.text, '[1:05] 远程字幕证据'); assert.equal(captionRequests, 1);
  });
  for (const failure of ['empty', 'invalid-json', 'http-error', 'network-error', 'collapsed']) await check(`${failure} 字幕失败时自动展开文字稿`, async () => {
    const result = await capture(failure); assert.equal(result.source?.kind, 'youtube', result.error);
    assert.match(result.source.text, /第一条文字稿证据/); assert.doesNotMatch(result.source.text, /评论/);
    assert.equal(await youtube.evaluate(() => window.transcriptClicks), 1);
  });
  await check('视频 ID 不匹配和非 YouTube 字幕来源仍被拒绝', async () => {
    assert.match((await capture('mismatch')).error, /字幕与当前视频不匹配/);
    assert.equal(await youtube.evaluate(() => window.transcriptClicks), 0);
    assert.match((await capture('bad-origin')).error, /字幕来源不受支持/);
    assert.equal(await youtube.evaluate(() => window.transcriptClicks), 0);
  });
  await check('没有字幕和文字稿时明确失败，不读取评论', async () => {
    const result = await capture('unavailable'); assert.match(result.error, /未读取到视频字幕/); assert.equal(result.source, undefined);
  });
  assert.deepEqual(failures, [], 'YouTube 字幕回归测试失败');
} finally { await context?.close(); await rm(profile, { recursive: true, force: true }); }
