import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const cli = fileURLToPath(new URL('../src/cli.mjs', import.meta.url));
function fixture(t) {
  const home = mkdtempSync(join(tmpdir(), 'agent-cli-test-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, run(args, input = '', preload = '') {
    const imports = preload ? ['--import', `data:text/javascript,${encodeURIComponent(preload)}`] : [];
    return spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', ...imports, cli, ...args], {
      env: { ...process.env, AGENT_PIGEON_HOME: home }, input, encoding: 'utf8', timeout: 5000,
    });
  } };
}

test('hook 无效 JSON/非对象/缺配置均不阻断 Agent 且不泄漏输入', t => {
  const { run } = fixture(t);
  for (const input of ['{"secret":"DO_NOT_LEAK"', 'null', '[]', JSON.stringify({ type: 'agent-turn-complete', 'last-assistant-message': 'DO_NOT_LEAK' })]) {
    const result = run(['hook', 'codex'], input);
    assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.ok(!result.stderr.includes('DO_NOT_LEAK'));
    assert.match(result.stderr, /操作失败/);
  }
});

test('不相关 hook 事件无需配置且不产生状态文件', t => {
  const { run, home } = fixture(t);
  const result = run(['hook', 'codex'], JSON.stringify({ type: 'unsupported' }));
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.equal(existsSync(join(home, 'state')), false);
});

test('stdin 超过 256 KiB 时安全退出；参数 JSON 同样可用', t => {
  const { run } = fixture(t);
  const tooLarge = run(['hook', 'generic'], JSON.stringify({ event: 'task-complete', details: 'x'.repeat(300000) }));
  assert.equal(tooLarge.status, 0); assert.equal(tooLarge.stdout, ''); assert.match(tooLarge.stderr, /操作失败/);
  const argument = run(['hook', 'codex', '{"type":"other"}']);
  assert.equal(argument.status, 0); assert.equal(argument.stdout, ''); assert.equal(argument.stderr, '');
});

test('过滤的有效 hook 不访问网络，stdout 保持空白', t => {
  const { run, home } = fixture(t);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ botToken: 'unused', chatId: 'unused', events: ['task-error'] }));
  const result = run(['hook', 'codex'], JSON.stringify({ type: 'agent-turn-complete' }));
  assert.equal(result.status, 0); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
  assert.equal(existsSync(join(home, 'state')), false);
});

test('doctor 只输出配置状态，不输出 token/chatId', t => {
  const { run, home } = fixture(t);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ botToken: 'DO_NOT_LEAK_TOKEN', chatId: 'DO_NOT_LEAK_CHAT', events: ['task-complete'] }));
  const result = run(['doctor']);
  assert.equal(result.status, 0); assert.equal(JSON.parse(result.stdout).configured, true);
  assert.ok(!result.stdout.includes('DO_NOT_LEAK')); assert.ok(!result.stderr.includes('DO_NOT_LEAK'));
});

test('管理命令失败返回非零退出码', t => {
  const { run } = fixture(t);
  const result = run(['doctor']);
  assert.equal(result.status, 1); assert.equal(result.stdout, '');
});

test('真实 CLI 入口发送成功和网络失败都不污染 hook stdout', t => {
  const { run, home } = fixture(t);
  writeFileSync(join(home, 'config.json'), JSON.stringify({ botToken: 'DO_NOT_LEAK_TOKEN', chatId: 'DO_NOT_LEAK_CHAT' }));
  const payload = { type: 'agent-turn-complete', 'thread-id': 's', 'turn-id': 'sent' };
  const success = run(['hook', 'codex'], JSON.stringify(payload), 'globalThis.fetch=async()=>({ok:true,json:async()=>({ok:true,result:{message_id:123}})});');
  assert.equal(success.status, 0); assert.equal(success.stdout, ''); assert.equal(success.stderr, '');
  const failure = run(['hook', 'codex'], JSON.stringify({ ...payload, 'turn-id': 'pending' }), 'globalThis.fetch=async()=>{throw new Error("DO_NOT_LEAK_TOKEN DO_NOT_LEAK_CHAT")};');
  assert.equal(failure.status, 0); assert.equal(failure.stdout, ''); assert.match(failure.stderr, /待重试/);
  assert.ok(!failure.stderr.includes('DO_NOT_LEAK'));
  const status = JSON.parse(run(['doctor']).stdout);
  assert.deepEqual(Object.fromEntries(status.counts.map(row => [row.state, row.count])), { pending: 1, sent: 1 });
});
