import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeEvent, formatMessage } from '../src/adapters.mjs';

test('Codex 只接收回合完成，保留稳定回合标识且不转发用户输入', () => {
  const p = { type: 'agent-turn-complete', 'thread-id': 'thread', 'turn-id': 'turn', cwd: '/work/demo', 'last-assistant-message': '完成', 'input-messages': ['秘密输入'] };
  assert.deepEqual(normalizeEvent('codex-cli', p), { agent: 'codex', event: 'task-complete', sessionId: 'thread', turnId: 'turn', cwd: '/work/demo', details: '完成' });
  assert.equal(normalizeEvent('codex', { type: 'other' }), null);
});

test('Claude 完成、失败、通知与授权，忽略普通工具和认证成功', () => {
  for (const [hook, expected] of [['Stop', 'task-complete'], ['StopFailure', 'task-error'], ['Notification', 'needs-attention'], ['PermissionRequest', 'needs-attention']]) {
    assert.equal(normalizeEvent('claude-code', { hook_event_name: hook }).event, expected);
  }
  assert.equal(normalizeEvent('claude', { hook_event_name: 'StopFailure', error: 'rate_limit', error_details: '限流' }).details, '限流');
  assert.equal(normalizeEvent('claude', { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'secret' } }), null);
  for (const tool of ['AskUserQuestion', 'ExitPlanMode']) {
    const result = normalizeEvent('claude', { hook_event_name: 'PreToolUse', tool_name: tool, tool_input: { command: 'secret' } });
    assert.equal(result.event, 'needs-attention');
    assert.ok(!JSON.stringify(result).includes('secret'));
  }
  assert.equal(normalizeEvent('claude', { hook_event_name: 'Notification', notification_type: 'auth_success' }), null);
});

test('Gemini 只发送结束响应与通知，不转发 prompt 和工具详情', () => {
  const r = normalizeEvent('gemini-cli', { hook_event_name: 'AfterAgent', prompt_response: '结果', prompt: 'secret' });
  assert.equal(r.details, '结果');
  assert.equal(normalizeEvent('gemini', { hook_event_name: 'Notification', message: '等待确认', details: { command: 'secret' } }).details, '等待确认');
  assert.equal(normalizeEvent('gemini', { hook_event_name: 'AfterTool' }), null);
});

test('Cursor 映射完成、出错及中止，不将 sessionEnd 当作回合完成', () => {
  const r = normalizeEvent('cursor', { hook_event_name: 'stop', status: 'completed', conversation_id: 'c', generation_id: 'g', workspace_roots: ['/work/p'] });
  assert.equal(r.event, 'task-complete'); assert.equal(r.sessionId, 'c'); assert.equal(r.turnId, 'g'); assert.equal(r.cwd, '/work/p');
  assert.equal(normalizeEvent('cursor', { status: 'error' }).event, 'task-error');
  assert.equal(normalizeEvent('cursor', { status: 'aborted' }).details, '任务已中止');
  assert.equal(normalizeEvent('cursor', { hook_event_name: 'sessionEnd', status: 'completed' }), null);
  assert.equal(normalizeEvent('cursor', { status: 'unknown' }), null);
});

test('OpenCode idle 唯一触发，支持错误与人工处理但不发送权限参数', () => {
  const input = { directory: '/work/demo', event: { type: 'session.idle', properties: { sessionID: 's' } } };
  assert.equal(normalizeEvent('opencode', input).event, 'task-complete');
  assert.equal(normalizeEvent('opencode', { type: 'session.status', properties: { status: { type: 'idle' } } }), null);
  assert.equal(normalizeEvent('opencode', { type: 'session.error', properties: { error: { data: { message: '故障' } } } }).details, '故障');
  for (const type of ['permission.asked', 'question.asked']) {
    const r = normalizeEvent('opencode', { type, properties: { id: 'request', sessionID: 's', patterns: ['secret'] } });
    assert.equal(r.event, 'needs-attention'); assert.equal(r.eventId, 'request'); assert.ok(!JSON.stringify(r).includes('secret'));
  }
});

test('非法输入明确报错，未知事件忽略，字段不强制序列化', () => {
  for (const input of [null, [], 1, 'text']) assert.throws(() => normalizeEvent('codex', input), /JSON 对象/);
  assert.throws(() => normalizeEvent('missing', {}), /不支持/);
  assert.equal(normalizeEvent('generic', { event: 'unknown' }), null);
  assert.equal(normalizeEvent('generic', { event: 'task-error', details: { secret: true } }).details, '');
});

test('纯文本格式显示项目名，不泄露全路径，附带请勿直接回复分割线后缀且边界不切代理对', () => {
  const r = normalizeEvent('generic', { agent: 'my-agent', event: 'task-complete', sessionId: 's', cwd: 'C:\\Users\\private\\demo', details: '*结果*\n<code>ok</code>' });
  const message = formatMessage(r);
  assert.match(message, /项目：demo/); assert.ok(!message.includes('private'));
  assert.ok(message.includes('*结果*\n<code>ok</code>'));
  assert.ok(message.endsWith('\n\n──────── 仅通知 · 请勿直接回复 ────────'));
  const large = formatMessage({ ...r, details: '😀'.repeat(5000), sessionId: 'x'.repeat(1000), cwd: '/a/' + '😀'.repeat(1000) });
  assert.ok(large.length <= 4000); assert.equal(large.isWellFormed(), true);
  assert.ok(large.endsWith('\n\n──────── 仅通知 · 请勿直接回复 ────────'));
  const bounded = normalizeEvent('generic', { event: 'task-complete', details: 'x'.repeat(2999) + '😀' });
  assert.equal(bounded.details.length, 2999);
});
