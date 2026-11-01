import { Readability } from '@mozilla/readability';
import type { Source } from './core';

export async function capture(): Promise<Source> {
  const base = { title: document.title, url: location.href };
  const selection = window.getSelection()?.toString().trim();
  if (selection) return { ...base, text: selection, kind: 'selection' };
  if (/(^|\.)youtube\.com$/.test(location.hostname) && new URL(location.href).searchParams.has('v')) {
    const segments = Array.from(document.querySelectorAll('ytd-transcript-segment-renderer'));
    if (segments.length) return { ...base, kind: 'youtube', text: segments.map(el => el.textContent?.trim()).join('\n') };
    const html = await (await fetch(location.href, { signal: AbortSignal.timeout(15000) })).text();
    const match = /ytInitialPlayerResponse\s*=\s*(\{.+?\});/s.exec(html);
    if (match) {
      const player = JSON.parse(match[1]);
      if (player.videoDetails?.videoId !== new URL(location.href).searchParams.get('v')) throw new Error('字幕与当前视频不匹配，请刷新后重试。');
      const tracks = player.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
      const track = tracks.find((t: { languageCode: string }) => t.languageCode.startsWith(document.documentElement.lang)) ?? tracks[0];
      if (track) {
        const url = new URL(track.baseUrl);
        if (url.protocol !== 'https:' || !/(^|\.)youtube\.com$/.test(url.hostname)) throw new Error('字幕来源不受支持。');
        url.searchParams.set('fmt', 'json3');
        const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
        if (response.ok) {
          const captions = await response.json();
          const text = (captions.events ?? []).filter((e: { segs?: unknown }) => e.segs).map((e: { tStartMs: number; segs: { utf8: string }[] }) => {
            const seconds = Math.floor(e.tStartMs / 1000);
            return `[${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}] ${e.segs.map(s => s.utf8).join('')}`;
          }).join('\n');
          if (text.trim()) return { ...base, text, kind: 'youtube' };
        }
      }
    }
    throw new Error('未读取到视频字幕。请在 YouTube 展开“显示文字稿”后重试，或粘贴字幕；不会用评论冒充视频内容。');
  }
  const article = new Readability(document.cloneNode(true) as Document).parse();
  const text = article?.textContent?.trim() || document.querySelector<HTMLElement>('main, article')?.innerText?.trim();
  if (!text) throw new Error('未找到正文，请选择文字后重试，或粘贴内容 / 导入 PDF。');
  return { ...base, title: article?.title || base.title, text, kind: 'page' };
}
