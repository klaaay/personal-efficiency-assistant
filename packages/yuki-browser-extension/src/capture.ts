import { Readability } from '@mozilla/readability';
import type { Source } from './core';

function visible(element: Element): boolean {
  return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden';
}
function transcriptText(): string {
  return Array.from(document.querySelectorAll('ytd-transcript-segment-renderer, transcript-segment-view-model'))
    .filter(visible)
    .map(segment => {
      // 新版将时间戳、无障碍标签和正文放在同一节点，分别读取。
      const content = segment.matches('transcript-segment-view-model') ? segment.querySelector('span[role="text"]') ?? segment : segment;
      const text = content.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!text) return '';
      const row = segment.querySelector('.ytwTranscriptSegmentViewModelTimestamp') ?? segment.closest('timeline-item-view-model');
      const timestamp = row?.textContent?.match(/\d{1,2}(?::\d{2}){1,2}/)?.[0];
      return timestamp ? `[${timestamp}] ${text}` : text;
    }).filter(Boolean).join('\n');
}
function waitFor<T>(read: () => T | undefined, timeoutMs: number): Promise<T | undefined> {
  const current = read();
  if (current !== undefined) return Promise.resolve(current);
  return new Promise(resolve => {
    const finish = (value: T | undefined) => { observer.disconnect(); clearTimeout(timer); resolve(value); };
    const observer = new MutationObserver(() => { const value = read(); if (value !== undefined) finish(value); });
    const timer = setTimeout(() => finish(undefined), timeoutMs);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  });
}
async function openTranscript(): Promise<string> {
  const findButton = () => Array.from(document.querySelectorAll<HTMLButtonElement>('ytd-video-description-transcript-section-renderer button')).find(visible);
  let button = findButton();
  if (!button) {
    const expand = Array.from(document.querySelectorAll<HTMLElement>('#description-inline-expander #expand, ytd-text-inline-expander #expand')).find(visible);
    if (expand) { expand.click(); button = await waitFor(findButton, 2000); }
  }
  if (!button) return '';
  button.click();
  return await waitFor(() => transcriptText() || undefined, 8000) || '';
}
export async function capture(): Promise<Source> {
  const base = { title: document.title, url: location.href };
  const selection = window.getSelection()?.toString().trim();
  if (selection) return { ...base, text: selection, kind: 'selection' };
  if (/(^|\.)youtube\.com$/.test(location.hostname) && new URL(location.href).searchParams.has('v')) {
    const expanded = transcriptText();
    if (expanded) return { ...base, kind: 'youtube', text: expanded };
    let html = '';
    try { html = await (await fetch(location.href, { signal: AbortSignal.timeout(15000) })).text(); }
    catch { /* 页面请求不可用时，继续尝试浏览器已加载的文字稿入口。 */ }
    const match = /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s.exec(html);
    let player;
    try { if (match) player = JSON.parse(match[1]); } catch { /* 页面数据格式变化时尝试文字稿。 */ }
    if (player) {
      if (player.videoDetails?.videoId !== new URL(location.href).searchParams.get('v')) throw new Error('字幕与当前视频不匹配，请刷新后重试。');
      const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const track = tracks.find((t: { languageCode: string }) => t.languageCode.startsWith(document.documentElement.lang)) ?? tracks[0];
      if (track) {
        const url = new URL(track.baseUrl);
        if (url.protocol !== 'https:' || !/(^|\.)youtube\.com$/.test(url.hostname)) throw new Error('字幕来源不受支持。');
        url.searchParams.set('fmt', 'json3');
        try {
          const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
          const payload = response.ok ? await response.text() : '';
          if (payload.trim()) {
            const captions = JSON.parse(payload);
            const text = (captions.events ?? []).filter((e: { segs?: unknown }) => e.segs).map((e: { tStartMs: number; segs: { utf8: string }[] }) => {
              const seconds = Math.floor(e.tStartMs / 1000);
              return `[${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}] ${e.segs.map(s => s.utf8).join('')}`;
            }).join('\n');
            if (text.trim()) return { ...base, text, kind: 'youtube' };
          }
        } catch { /* 空响应、无效字幕或网络失败交由页面文字稿兜底。 */ }
      }
    }
    const transcript = await openTranscript();
    if (transcript) return { ...base, kind: 'youtube', text: transcript };
    throw new Error('未读取到视频字幕。请在 YouTube 展开“内容转文字 / 显示文字稿”后重试，或粘贴字幕；不会用评论冒充视频内容。');
  }
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const text = article?.textContent?.trim() || document.querySelector<HTMLElement>('main, article')?.innerText?.trim();
  if (!text) throw new Error('未找到正文，请选择文字后重试，或粘贴内容 / 导入 PDF。');
  return { ...base, title: article?.title || base.title, text, kind: 'page' };
}
