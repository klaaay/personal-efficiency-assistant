import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, splitText, sourceMessages, streamCompletion, summarize, validateSettings } from '../src/core/index.ts';
const source = { title: '测试', url: 'https://example.com', text: '原始资料', kind: 'page' as const };
function sse(text: string) {
  const data = new TextEncoder().encode(text); let position = 0;
  return new Response(new ReadableStream({ pull(controller) {
    if (position >= data.length) { controller.close(); return; }
    controller.enqueue(data.slice(position, position += 2));
  } }), { headers: { 'content-type': 'text/event-stream' } });
}
test('Unicode 分段完整保留所有原文', () => {
  const input = '你好🌿。\n重复文章'.repeat(555);
  const chunks = splitText(input, 19);
  assert.equal(chunks.join(''), input); assert.ok(chunks.every(s => Array.from(s).length <= 19));
  assert.throws(() => splitText(input, 0));
});
test('正文与系统指令、历史消息隔离', () => {
  const messages = sourceMessages(source, defaults, '问题', [{ role: 'assistant', content: '上次回答' }]);
  assert.equal(messages[0].role, 'system'); assert.match(messages[1].content, /<document>/);
  assert.equal(messages.at(-1)?.content, '问题');
});
test('拒绝明文远端、URL 凭证和无效分段长度', () => {
  for (const endpoint of ['http://example.com', 'https://user:password@example.com', 'file:///tmp/test', 'https://example.com?key=secret']) assert.throws(() => validateSettings({ ...defaults, endpoint }));
  assert.equal(validateSettings({ ...defaults, endpoint: 'http://localhost:8080/v1/chat/completions' }).hostname, 'localhost');
  assert.throws(() => validateSettings({ ...defaults, chunkSize: 0 }));
});
test('SSE 支持跨字节中文、CRLF、结束标记和取消 reader', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () => sse(': ping\r\n\r\ndata: {"choices":[{"delta":{"content":"你好🌿"}}]}\r\n\r\ndata: [DONE]\r\n\r\n');
  try { assert.equal(await streamCompletion(defaults, [], () => {}), '你好🌿'); } finally { globalThis.fetch = original; }
});
test('中断数据流、远端错误和空响应不得作为成功回答', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => sse('data: {"choices":[{"delta":{"content":"未完成"}}]}\n\n');
    await assert.rejects(streamCompletion(defaults, [], () => {}), /中断/);
    globalThis.fetch = async () => sse('data: {"error":{"message":"secret"}}\n\n');
    await assert.rejects(streamCompletion(defaults, [], () => {}), /流式错误/);
    globalThis.fetch = async () => new Response('sensitive API key', { status: 401 });
    await assert.rejects(streamCompletion(defaults, [], () => {}), error => error instanceof Error && error.message.includes('401') && !error.message.includes('sensitive'));
  } finally { globalThis.fetch = original; }
});
test('长文先处理所有分段，再归并总结', async () => {
  const original = globalThis.fetch; const requests: any[] = [];
  globalThis.fetch = async (_url, options) => {
    requests.push(JSON.parse(options?.body as string));
    return new Response(JSON.stringify({ choices: [{ message: { content: '分段摘要' } }] }), { headers: { 'content-type': 'application/json' } });
  };
  try {
    assert.equal(await summarize({ ...source, text: '甲'.repeat(1000) + '乙'.repeat(1000) + '尾部证据' }, { ...defaults, chunkSize: 1000 }, () => {}, () => {}), '分段摘要');
    assert.equal(requests.length, 4); assert.match(requests[2].messages[1].content, /尾部证据/);
    assert.match(requests[3].messages[1].content, /分段摘要/);
  } finally { globalThis.fetch = original; }
});
test('取消操作传给请求，不继续后续分段', async () => {
  const abort = new AbortController(); abort.abort();
  await assert.rejects(summarize({ ...source, text: '甲'.repeat(3000) }, { ...defaults, chunkSize: 1000 }, () => {}, () => {}, abort.signal), { name: 'AbortError' });
});
test('截断不能成功，正常结束后的不完整尾事件不影响回答', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => sse('data: {"choices":[{"delta":{"content":"片段"},"finish_reason":"length"}]}\n\n');
    await assert.rejects(streamCompletion(defaults, [], () => {}), /未完整回答/);
    globalThis.fetch = async () => new Response('data: {"choices":[{"delta":{"content":"完整"},"finish_reason":"stop"}]}\n\ndata: {"usa', { headers: { 'content-type': 'text/event-stream' } });
    assert.equal(await streamCompletion(defaults, [], () => {}), '完整');
  } finally { globalThis.fetch = original; }
});

test('非流式兼容响应同样拒绝截断和空回答', async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'length', message: { content: '片段' } }] }), { headers: { 'content-type': 'application/json' } });
    await assert.rejects(streamCompletion(defaults, [], () => {}), /未完整回答/);
    globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: ' ' } }] }), { headers: { 'content-type': 'application/json' } });
    await assert.rejects(streamCompletion(defaults, [], () => {}), /未返回可读回答/);
  } finally { globalThis.fetch = original; }
});
