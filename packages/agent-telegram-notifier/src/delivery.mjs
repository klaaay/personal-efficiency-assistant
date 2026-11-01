import { mkdirSync, chmodSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { formatMessage } from './adapters.mjs';

const TTL = 7 * 86400_000;
export function openStore(directory) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const file = join(directory, 'delivery.sqlite');
  const db = new DatabaseSync(file);
  chmodSync(file, 0o600);
  db.exec(`PRAGMA busy_timeout=1000;
    CREATE TABLE IF NOT EXISTS deliveries (
      id TEXT PRIMARY KEY, state TEXT NOT NULL, lease TEXT, updated INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, event TEXT NOT NULL, message_id INTEGER, error TEXT
    );`);
  return db;
}

export function eventKey(event, now = Date.now()) {
  // 有原生事件/轮次 ID 时精确去重；其余仅压制 10 秒内同内容重复事件。
  const identity = event.eventId || event.turnId || Math.floor(now / 10000);
  return createHash('sha256').update(JSON.stringify([
    event.agent, event.event, event.sessionId, identity,
    ...(event.eventId || event.turnId ? [] : [event.details, event.cwd]),
  ])).digest('hex');
}

function claim(db, event, now, id = eventKey(event, now)) {
  const lease = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare("DELETE FROM deliveries WHERE updated < ? AND state='sent'").run(now - TTL);
    const previous = db.prepare('SELECT * FROM deliveries WHERE id = ?').get(id);
    if (previous?.state === 'sent' || (previous?.state === 'sending' && previous.updated > now - 30000)) {
      db.exec('COMMIT');
      return { status: 'duplicate', id };
    }
    if (!previous && db.prepare('SELECT count(*) AS count FROM deliveries').get().count >= 1000) {
      const oldest = db.prepare("SELECT id FROM deliveries WHERE state='sent' ORDER BY updated LIMIT 1").get();
      if (!oldest) { db.exec('COMMIT'); return { status: 'capacity', error: '通知队列已满，请运行 retry', id }; }
      db.prepare('DELETE FROM deliveries WHERE id=?').run(oldest.id);
    }
    const active = db.prepare("SELECT count(*) AS count FROM deliveries WHERE state='sending' AND updated > ?").get(now - 30000).count;
    const state = active >= 2 ? 'pending' : 'sending';
    db.prepare(`INSERT INTO deliveries(id,state,lease,updated,event) VALUES(?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET state=excluded.state,lease=excluded.lease,updated=excluded.updated`)
      .run(id, state, lease, now, JSON.stringify(event));
    db.exec('COMMIT');
    return { status: state === 'pending' ? 'queued' : 'claimed', id, lease };
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}

export async function telegramSend(config, text, { fetchImpl = fetch, timeoutMs = 4000 } = {}) {
  let response;
  try {
    response = await fetchImpl(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: config.chatId, text, link_preview_options: { is_disabled: true } }),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch { throw new Error('Telegram 网络失败或超时'); }
  // 不返回服务器原始报错，避免凭据/消息内容通过异常泄漏。
  if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
  let data;
  try { data = await response.json(); } catch { throw new Error('Telegram 返回无效 JSON'); }
  if (data?.ok !== true || !Number.isInteger(data.result?.message_id)) throw new Error('Telegram 未确认消息投递');
  return data.result.message_id;
}

export async function deliver(event, config, directory, options = {}) {
  if (!config.botToken || !config.chatId) throw new Error('Telegram 配置不完整');
  if (config.events && !config.events.includes(event.event)) return { status: 'filtered' };
  const db = openStore(directory);
  try {
    const claimed = claim(db, event, Date.now(), options.id);
    if (claimed.status !== 'claimed') return claimed;
    try {
      const messageId = await telegramSend(config, formatMessage(event), options);
      db.prepare("UPDATE deliveries SET state='sent',updated=?,attempts=attempts+1,message_id=?,error=NULL WHERE id=? AND lease=?")
        .run(Date.now(), messageId, claimed.id, claimed.lease);
      return { status: 'sent', messageId };
    } catch (error) {
      db.prepare("UPDATE deliveries SET state='pending',updated=?,attempts=attempts+1,error=? WHERE id=? AND lease=?")
        .run(Date.now(), error.message, claimed.id, claimed.lease);
      return { status: 'pending', error: error.message };
    }
  } finally { db.close(); }
}

export function pending(directory, limit = 10) {
  const db = openStore(directory);
  try {
    return db.prepare("SELECT id,event FROM deliveries WHERE state='pending' OR (state='sending' AND updated < ?) ORDER BY updated LIMIT ?")
      .all(Date.now() - 30000, limit).map(row => ({ id: row.id, event: JSON.parse(row.event) }));
  } finally { db.close(); }
}

export function deliveryStatus(directory) {
  const db = openStore(directory);
  try { return { counts: db.prepare('SELECT state,count(*) AS count FROM deliveries GROUP BY state').all(), bytes: statSync(join(directory, 'delivery.sqlite')).size }; }
  finally { db.close(); }
}
