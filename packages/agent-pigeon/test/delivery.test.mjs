import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { deliver, telegramSend, openStore, pending, deliveryStatus } from '../src/delivery.mjs';

const config = { botToken: 'test:DO_NOT_LEAK_TOKEN', chatId: 'DO_NOT_LEAK_CHAT' };
const event = { agent: 'codex', event: 'task-complete', sessionId: 's', turnId: 't', cwd: '/work/p', details: 'done' };
const ok = async () => ({ ok: true, json: async () => ({ ok: true, result: { message_id: 42 } }) });
function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), 'agent-delivery-test-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}
function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', reject);
    child.once('close', code => code === 0 ? resolve(stdout) : reject(new Error(`child ${code}: ${stderr}`)));
  });
}

test('Telegram 只在 ok:true 且有效 message_id 时确认，消息不使用 Markdown', async () => {
  let sent;
  const id = await telegramSend(config, '*literal*', { fetchImpl: async (url, init) => {
    sent = { url, ...JSON.parse(init.body) }; return ok();
  } });
  assert.equal(id, 42); assert.equal(sent.text, '*literal*'); assert.equal(sent.parse_mode, undefined);
  for (const body of [null, { ok: false, description: config.botToken }, { ok: true }, { ok: true, result: { message_id: '42' } }]) {
    await assert.rejects(telegramSend(config, 'message', { fetchImpl: async () => ({ ok: true, json: async () => body }) }), /未确认/);
  }
});

test('HTTP、解析、网络失败均隐藏凭据和响应正文', async () => {
  const responses = [
    async () => ({ ok: false, status: 401, text: async () => config.botToken }),
    async () => { throw new Error(config.botToken + config.chatId); },
    async () => ({ ok: true, json: async () => { throw new Error(config.botToken); } }),
  ];
  for (const fetchImpl of responses) await assert.rejects(telegramSend(config, 'private message', { fetchImpl }), error => {
    assert.ok(!error.message.includes(config.botToken)); assert.ok(!error.message.includes(config.chatId));
    assert.ok(!error.message.includes('private message')); return true;
  });
});

test('发送超时会中止请求并返回固定错误', async () => {
  // 模拟真实 fetch 对 AbortSignal 的响应；计时器维持测试事件循环。
  const keepAlive = setTimeout(() => {}, 500);
  try {
    const start = performance.now();
    await assert.rejects(telegramSend(config, 'x', { timeoutMs: 30, fetchImpl: async (_url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
    }) }), /网络失败或超时/);
    assert.ok(performance.now() - start < 400);
  } finally { clearTimeout(keepAlive); }
});

test('重复事件不会再发送，失败可通过同一记录重试', async t => {
  const directory = temporary(t); let calls = 0;
  const fetchImpl = async () => { calls++; return ok(); };
  assert.equal((await deliver(event, config, directory, { fetchImpl })).status, 'sent');
  assert.equal((await deliver(event, config, directory, { fetchImpl })).status, 'duplicate');
  assert.equal(calls, 1);
  const failed = { ...event, turnId: 'retry' };
  assert.equal((await deliver(failed, config, directory, { fetchImpl: async () => { throw new Error('offline'); } })).status, 'pending');
  const queue = pending(directory); assert.equal(queue.length, 1);
  assert.equal((await deliver(queue[0].event, config, directory, { id: queue[0].id, fetchImpl })).status, 'sent');
  assert.equal(pending(directory).length, 0);
  const db = openStore(directory);
  try { assert.equal(db.prepare('SELECT attempts FROM deliveries WHERE id=?').get(queue[0].id).attempts, 2); }
  finally { db.close(); }
});

test('同进程同时触发最多两个网络请求，其他进入可重试队列', async t => {
  const directory = temporary(t); let active = 0, peak = 0;
  const fetchImpl = async () => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 35)); active--; return ok(); };
  const results = await Promise.all(Array.from({ length: 8 }, (_, n) => deliver({ ...event, turnId: String(n) }, config, directory, { fetchImpl })));
  assert.equal(peak, 2); assert.equal(results.filter(r => r.status === 'sent').length, 2);
  assert.equal(results.filter(r => r.status === 'queued').length, 6); assert.equal(pending(directory).length, 6);
});

test('跨进程并发对同一事件只发送一次', async t => {
  const directory = temporary(t);
  const moduleUrl = new URL('../src/delivery.mjs', import.meta.url).href;
  const script = join(directory, 'worker.mjs');
  writeFileSync(script, `import {deliver} from ${JSON.stringify(moduleUrl)};
import {appendFileSync} from 'node:fs';
const r=await deliver(${JSON.stringify(event)},${JSON.stringify(config)},${JSON.stringify(directory)}, {fetchImpl:async()=>{
appendFileSync(${JSON.stringify(join(directory, 'calls'))}, 'send\\n');
await new Promise(r=>setTimeout(r,150));return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};}});
process.stdout.write(JSON.stringify(r));`);
  const results = (await Promise.all(Array.from({ length: 6 }, () => runNode([script])))).map(JSON.parse);
  assert.equal(results.filter(r => r.status === 'sent').length, 1);
  assert.equal(results.filter(r => r.status === 'duplicate').length, 5);
  assert.equal(readFileSync(join(directory, 'calls'), 'utf8'), 'send\n');
});

test('跨进程不同事件遵守全局两个发送租约', async t => {
  const directory = temporary(t);
  const script = join(directory, 'worker.mjs');
  writeFileSync(script, `import {deliver} from ${JSON.stringify(new URL('../src/delivery.mjs', import.meta.url).href)};
import {appendFileSync} from 'node:fs';
const r=await deliver({...${JSON.stringify(event)},turnId:process.argv[2]},${JSON.stringify(config)},${JSON.stringify(directory)},{fetchImpl:async()=>{
appendFileSync(${JSON.stringify(join(directory, 'timeline'))},JSON.stringify({type:'start',pid:process.pid})+'\\n');
await new Promise(r=>setTimeout(r,600));
appendFileSync(${JSON.stringify(join(directory, 'timeline'))},JSON.stringify({type:'end',pid:process.pid})+'\\n');
return {ok:true,json:async()=>({ok:true,result:{message_id:1}})};}});process.stdout.write(JSON.stringify(r));`);
  const results = (await Promise.all(Array.from({ length: 6 }, (_, n) => runNode([script, String(n)])))).map(JSON.parse);
  let active = 0, peak = 0;
  for (const line of readFileSync(join(directory, 'timeline'), 'utf8').trim().split('\n')) {
    active += JSON.parse(line).type === 'start' ? 1 : -1; peak = Math.max(peak, active);
  }
  assert.equal(active, 0); assert.ok(peak <= 2);
  // Slow process startup may allow a later worker to acquire an already released lease.
  const sent = results.filter(r => r.status === 'sent').length;
  assert.ok(sent >= 2); assert.equal(results.filter(r => r.status === 'queued').length, 6 - sent);
  assert.equal(pending(directory).length, 6 - sent);
});

test('历史记录过期与数量上限生效，文件不向其他账户开放', async t => {
  const directory = temporary(t); const db = openStore(directory);
  try {
    const stmt = db.prepare('INSERT INTO deliveries(id,state,updated,event) VALUES(?,?,?,?)');
    stmt.run('expired', 'sent', Date.now() - 8 * 86400_000, JSON.stringify(event));
    db.exec('BEGIN');
    for (let n = 0; n < 1000; n++) stmt.run(`old-${n}`, 'sent', Date.now() - n, JSON.stringify(event));
    db.exec('COMMIT');
  } finally { db.close(); }
  await deliver(event, config, directory, { fetchImpl: ok });
  const after = openStore(directory);
  try { assert.equal(after.prepare("SELECT count(*) AS n FROM deliveries WHERE id='expired'").get().n, 0); }
  finally { after.close(); }
  const status = deliveryStatus(directory);
  assert.ok(status.counts.reduce((sum, row) => sum + row.count, 0) <= 1000);
  if (process.platform !== 'win32') {
    assert.equal(statSync(directory).mode & 0o777, 0o700);
    assert.equal(statSync(join(directory, 'delivery.sqlite')).mode & 0o777, 0o600);
  }
});

test('队列已满时明确返回容量错误，保留正在发送和未送达记录', async t => {
  const directory = temporary(t); const db = openStore(directory);
  try {
    db.exec('BEGIN');
    const stmt = db.prepare('INSERT INTO deliveries(id,state,updated,event) VALUES(?,?,?,?)');
    // 即使待重试记录过期，也不能悄悄删除用户尚未收到的消息。
    for (let n = 0; n < 999; n++) stmt.run(`pending-${n}`, 'pending', Date.now() - 8 * 86400_000, JSON.stringify(event));
    stmt.run('active', 'sending', Date.now(), JSON.stringify(event));
    db.exec('COMMIT');
  } finally { db.close(); }
  let calls = 0;
  const result = await deliver({ ...event, turnId: 'new' }, config, directory, { fetchImpl: async () => { calls++; return ok(); } });
  assert.equal(result.status, 'capacity'); assert.equal(calls, 0);
  const after = openStore(directory);
  try {
    assert.equal(after.prepare('SELECT count(*) AS n FROM deliveries').get().n, 1000);
    assert.equal(after.prepare("SELECT state FROM deliveries WHERE id='active'").get().state, 'sending');
    assert.equal(after.prepare("SELECT count(*) AS n FROM deliveries WHERE state='pending'").get().n, 999);
  } finally { after.close(); }
});

test('过滤事件不创建投递数据库', async t => {
  const directory = temporary(t);
  assert.equal((await deliver(event, { ...config, events: ['task-error'] }, directory)).status, 'filtered');
  assert.deepEqual(readdirSync(directory), []);
});
