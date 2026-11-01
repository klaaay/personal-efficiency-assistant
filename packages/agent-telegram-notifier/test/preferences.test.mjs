import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliver, recentDeliveries } from '../src/delivery.mjs';

test('总开关和 Agent 开关关闭时不发送、不入队、不需要凭据', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pigeon-disabled-'));
  const state = join(directory, 'state');
  const event = { agent: 'codex', event: 'task-complete', sessionId: 's', turnId: 't' };
  try {
    assert.deepEqual(await deliver(event, { enabled: false }, state), { status: 'disabled' });
    assert.deepEqual(await deliver(event, { agents: { codex: false } }, state), { status: 'disabled' });
    assert.equal(existsSync(state), false);
  } finally { rmSync(directory, { recursive: true }); }
});

test('界面投递记录有界、包含收据、不返回配置或完整事件', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pigeon-history-'));
  const config = { botToken: 'secret-token', chatId: 'secret-chat' };
  try {
    await deliver({ agent: 'claude', event: 'task-complete', sessionId: 'private-session', turnId: 't', details: '测'.repeat(400) }, config, directory,
      { fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, result: { message_id: 99 } }) }) });
    const rows = recentDeliveries(directory);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].messageId, 99);
    assert.equal(rows[0].summary.length, 180);
    assert.equal(rows[0].state, 'sent');
    assert.equal(JSON.stringify(rows).includes('secret-'), false);
    assert.equal(JSON.stringify(rows).includes('private-session'), false);
  } finally { rmSync(directory, { recursive: true }); }
});
