import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { Source } from './core';
GlobalWorkerOptions.workerSrc = workerUrl;
export async function readPdf(data: ArrayBuffer, title: string, url = ''): Promise<Source> {
  if (data.byteLength > 30 * 1024 * 1024) throw new Error('PDF 超过 30 MB，请拆分后导入。');
  const task = getDocument({ data, useSystemFonts: true });
  try {
    const doc = await task.promise;
    if (doc.numPages > 500) throw new Error('PDF 超过 500 页，请拆分后导入。');
    const pages: string[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join('').trim();
      if (text) pages.push(`[第 ${i} 页]\n${text}`);
      page.cleanup();
    }
    if (!pages.length) throw new Error('PDF 没有可提取的文字，扫描件需先进行 OCR。');
    return { title, url, text: pages.join('\n\n'), kind: 'pdf' };
  } finally { await task.destroy(); }
}
