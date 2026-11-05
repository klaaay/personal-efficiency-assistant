import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, expandPrompt, splitText, sourceMessages, streamCompletion, summarize, validateSettings } from '../src/core/index.ts';
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

const anthropic = { ...defaults, protocol: 'anthropic' as const, endpoint: 'https://example.com/v1/messages', apiKey: 'test-secret' };
const anthropicEvent = (value: object) => `data: ${JSON.stringify(value)}\r\n\r\n`;
const anthropicText = (text: string) => anthropicEvent({ type: 'content_block_delta', delta: { type: 'text_delta', text } });
const anthropicEnd = (reason = 'end_turn') => anthropicEvent({ type: 'message_delta', delta: { stop_reason: reason } }) + anthropicEvent({ type: 'message_stop' });
test('Anthropic 映射系统消息、最大输出与两种鉴权；旧设置保持 OpenAI 请求', async () => {
  const original = globalThis.fetch; const requests: { url: unknown; options: RequestInit | undefined }[] = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options });
    return sse(requests.length <= 2 ? anthropicText('完成') + anthropicEnd() : 'data: {"choices":[{"delta":{"content":"完成"}}]}\n\ndata: [DONE]\n\n');
  };
  const messages = sourceMessages(source, anthropic, '问题', [{ role: 'assistant', content: '历史' }]);
  messages.splice(2, 0, { role: 'system', content: '补充系统要求' });
  try {
    await streamCompletion(anthropic, messages, () => {});
    await streamCompletion({ ...anthropic, authMode: 'bearer', maxTokens: 1234 }, messages, () => {});
    await streamCompletion({ ...defaults, apiKey: 'old-key' }, messages, () => {});
    const first = requests[0]; const body = JSON.parse(first.options?.body as string);
    assert.equal(first.url, anthropic.endpoint);
    assert.equal(first.options?.redirect, 'error');
    assert.deepEqual(first.options?.headers, { 'Content-Type': 'application/json', 'x-api-key': 'test-secret', 'anthropic-version': '2023-06-01' });
    assert.equal(body.system, `${messages[0].content}\n\n补充系统要求`);
    assert.deepEqual(body.messages, messages.filter(m => m.role !== 'system'));
    assert.equal(body.max_tokens, 4096); assert.equal(body.stream, true);
    assert.equal((requests[1].options?.headers as Record<string, string>).Authorization, 'Bearer test-secret');
    assert.equal((requests[1].options?.headers as Record<string, string>)['x-api-key'], undefined);
    assert.equal(JSON.parse(requests[1].options?.body as string).max_tokens, 1234);
    assert.deepEqual(JSON.parse(requests[2].options?.body as string), { model: defaults.model, messages, stream: true });
    assert.equal((requests[2].options?.headers as Record<string, string>).Authorization, 'Bearer old-key');
    assert.equal((requests[2].options?.headers as Record<string, string>)['anthropic-version'], undefined);
  } finally { globalThis.fetch = original; }
});
test('Anthropic SSE 跨字节中文、多个文本片段、ping、thinking 与正常结束', async () => {
  const original = globalThis.fetch; const updates: string[] = [];
  globalThis.fetch = async () => sse(anthropicEvent({ type: 'message_start', message: { stop_reason: null } }) + anthropicEvent({ type: 'ping' }) + anthropicEvent({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: '不显示' } }) + anthropicText('你好🌿') + anthropicText('完成') + anthropicEnd('stop_sequence'));
  try {
    assert.equal(await streamCompletion(anthropic, [], text => updates.push(text)), '你好🌿完成');
    assert.deepEqual(updates, ['你好🌿', '你好🌿完成']);
  } finally { globalThis.fetch = original; }
});
test('Anthropic 缺少 message_stop、结束原因、输出截断、工具调用与服务错误均失败', async () => {
  const original = globalThis.fetch;
  try {
    for (const [events, pattern] of [
      [anthropicText('片段'), /中断/],
      [anthropicText('片段') + anthropicEvent({ type: 'message_delta', delta: { stop_reason: 'end_turn' } }), /中断/],
      [anthropicText('片段') + anthropicEvent({ type: 'message_stop' }), /未完整回答/],
      [anthropicText('片段') + anthropicEnd('max_tokens'), /max_tokens/],
      [anthropicText('片段') + anthropicEnd('tool_use'), /tool_use/],
      [anthropicText('片段') + anthropicEnd('unknown-secret'), /未完整回答/],
      [anthropicEvent({ type: 'error', error: { message: 'secret' } }), /流式错误/],
      ['data: {"secret"\n\n', /无效流式数据/],
      [anthropicEnd(), /未返回文本/],
    ] as [string, RegExp][]) {
      globalThis.fetch = async () => sse(events);
      await assert.rejects(streamCompletion(anthropic, [], () => {}), error => error instanceof Error && pattern.test(error.message) && !error.message.includes('secret'));
    }
  } finally { globalThis.fetch = original; }
});
test('Anthropic JSON 响应提取文本并拒绝截断、工具调用、错误与空输出', async () => {
  const original = globalThis.fetch;
  const json = (body: object) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });
  try {
    globalThis.fetch = async () => json({ content: [{ type: 'thinking', thinking: '不显示' }, { type: 'text', text: '你好' }, { type: 'text', text: '🌿' }], stop_reason: 'end_turn' });
    assert.equal(await streamCompletion(anthropic, [], () => {}), '你好🌿');
    for (const [body, pattern] of [
      [{ content: [{ type: 'text', text: '片段' }], stop_reason: 'max_tokens' }, /max_tokens/],
      [{ content: [{ type: 'text', text: '片段' }], stop_reason: 'tool_use' }, /tool_use/],
      [{ content: [{ type: 'text', text: '片段' }] }, /未完整回答/],
      [{ content: [], stop_reason: 'end_turn' }, /未返回可读回答/],
      [{ type: 'error', error: { message: 'secret' } }, /服务返回错误/],
    ] as [object, RegExp][]) {
      globalThis.fetch = async () => json(body);
      await assert.rejects(streamCompletion(anthropic, [], () => {}), error => error instanceof Error && pattern.test(error.message) && !error.message.includes('secret'));
    }
  } finally { globalThis.fetch = original; }
});
test('Anthropic 取消传播至请求，读取期间取消会释放流', async () => {
  const original = globalThis.fetch; const abort = new AbortController(); let cancelled = false;
  globalThis.fetch = async (_url, options) => {
    assert.ok(options?.signal instanceof AbortSignal);
    return new Response(new ReadableStream({ pull(controller) {
      controller.enqueue(new TextEncoder().encode(anthropicText('部分'))); abort.abort();
    }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  try {
    await assert.rejects(streamCompletion(anthropic, [], () => {}, abort.signal), { name: 'AbortError' });
    assert.equal(cancelled, true);
    await assert.rejects(streamCompletion(anthropic, [], () => {}, abort.signal), { name: 'AbortError' });
  } finally { globalThis.fetch = original; }
});
test('协议和最大输出参数在请求前校验', () => {
  for (const maxTokens of [0, -1, 1.5, Number.NaN]) assert.throws(() => validateSettings({ ...anthropic, maxTokens }));
  assert.throws(() => validateSettings({ ...defaults, protocol: 'unknown' as never }));
  assert.throws(() => validateSettings({ ...defaults, authMode: 'unknown' as never }));
});

const dual = { ...anthropic, fallback: { endpoint: 'https://fallback.example.com/chat/completions', model: 'deepseek-chat', apiKey: 'backup-only-key' } };
const openaiSuccess = () => sse('data: {"choices":[{"delta":{"content":"备用回答"}}]}\n\ndata: [DONE]\n\n');
test('主服务失败清空片段后回退，备用请求使用独立协议与密钥', async () => {
  const original = globalThis.fetch; const urls: string[] = []; const texts: string[] = []; let switched = 0;
  globalThis.fetch = async (url, options) => {
    urls.push(String(url));
    if (urls.length === 1) return sse(anthropicText('主服务未完成'));
    const headers = options?.headers as Record<string, string>; const body = JSON.parse(options?.body as string);
    assert.equal(headers.Authorization, 'Bearer backup-only-key');
    assert.equal(headers['x-api-key'], undefined); assert.equal(headers['anthropic-version'], undefined);
    assert.equal(body.model, 'deepseek-chat'); assert.equal(body.max_tokens, undefined);
    assert.ok(!(options?.body as string).includes('test-secret'));
    return openaiSuccess();
  };
  try {
    assert.equal(await streamCompletion(dual, [], text => texts.push(text), undefined, () => switched++), '备用回答');
    assert.deepEqual(urls, [dual.endpoint, dual.fallback.endpoint]);
    assert.deepEqual(texts, ['主服务未完成', '', '备用回答']); assert.equal(switched, 1);
  } finally { globalThis.fetch = original; }
});
test('主服务成功或用户取消均不调用备用', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; return sse(anthropicText('主回答') + anthropicEnd()); };
  try {
    assert.equal(await streamCompletion(dual, [], () => {}), '主回答'); assert.equal(calls, 1);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(streamCompletion(dual, [], () => {}, controller.signal), { name: 'AbortError' });
    assert.equal(calls, 1);
    globalThis.fetch = async () => { calls++; throw new DOMException('已取消', 'AbortError'); };
    await assert.rejects(streamCompletion(dual, [], () => {}), { name: 'AbortError' });
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
test('主备用均失败不泄露响应或网络错误细节', async () => {
  const original = globalThis.fetch; let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error('test-secret backup-only-key https://secret.example.com'); };
  try {
    await assert.rejects(streamCompletion(dual, [], () => {}), error => error instanceof Error && /主服务和备用服务/.test(error.message) && !/secret|backup-only/.test(error.message));
    assert.equal(calls, 2);
  } finally { globalThis.fetch = original; }
});
test('主服务首响应或流读取超时会中止并回退', async () => {
  const original = globalThis.fetch;
  try {
    for (const stage of ['fetch', 'read']) {
      let calls = 0; let primarySignal: AbortSignal | null | undefined; let cancelled = false;
      globalThis.fetch = async (_url, options) => {
        calls++; if (calls > 1) return openaiSuccess();
        primarySignal = options?.signal;
        if (stage === 'fetch') return new Promise<Response>(() => {});
        return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(anthropicText('片段'))); }, cancel() { cancelled = true; } }), { headers: { 'content-type': 'text/event-stream' } });
      };
      assert.equal(await streamCompletion({ ...dual, requestTimeoutMs: 15 }, [], () => {}), '备用回答');
      assert.equal(calls, 2); assert.equal(primarySignal?.aborted, true);
      if (stage === 'read') assert.equal(cancelled, true);
    }
  } finally { globalThis.fetch = original; }
});
test('提示词占位符单次展开，自定义系统消息与历史保留', () => {
  const material = { ...source, title: '{{CONTENT}} 标题', text: '正文 {{URL}}' };
  assert.equal(expandPrompt('{{TITLE}}|{{ CONTENT }}|{{URL}}|{{SELECTED_LANGUAGE}}|{{TEXT_CONTENT}}|{{VIDEO_SUBTITLES}}', material, '中文'), '{{CONTENT}} 标题|正文 {{URL}}|https://example.com|中文|正文 {{URL}}|');
  assert.equal(expandPrompt('{{VIDEO_SUBTITLES}} {{UNKNOWN}}', { ...material, kind: 'youtube' }, '中文'), '正文 {{URL}} {{UNKNOWN}}');
  const history = [{ role: 'assistant' as const, content: '{{TITLE}} 历史' }];
  const messages = sourceMessages(material, { ...defaults, systemMessage: '请使用 {{SELECTED_LANGUAGE}}：{{TITLE}}' }, '总结 {{CONTENT}}', history);
  assert.equal(messages[0].content, '请使用 简体中文：{{CONTENT}} 标题');
  assert.equal(messages.at(-1)?.content, '总结 正文 {{URL}}'); assert.equal(messages[2].content, '{{TITLE}} 历史');
  assert.match(sourceMessages(source, defaults, '原始问题')[0].content, /你是阅读助手/);
});
test('长文总结转发备用通知', async () => {
  const original = globalThis.fetch; let switched = 0;
  globalThis.fetch = async url => String(url) === dual.endpoint ? new Response('', { status: 503 }) : openaiSuccess();
  try {
    assert.equal(await summarize(source, dual, () => {}, () => {}, undefined, () => switched++), '备用回答'); assert.equal(switched, 1);
  } finally { globalThis.fetch = original; }
});
