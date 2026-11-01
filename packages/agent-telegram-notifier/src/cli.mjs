#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync, chmodSync, renameSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeEvent } from './adapters.mjs';
import { deliver, pending, deliveryStatus, recentDeliveries } from './delivery.mjs';

const home = process.env.AGENT_NOTIFY_HOME || join(homedir(), '.config', 'agent-telegram-notifier');
const configPath = join(home, 'config.json');
const directory = join(home, 'state');
const [command = 'help', agent, ...args] = process.argv.slice(2);
const isHook = command === 'hook';
// 所有网络/标准输入/子进程都必须在宿主 hook 的时间预算内结束。
const watchdog = setTimeout(() => process.exit(isHook ? 0 : 1), command === 'retry' ? 55000 : 12000);
watchdog.unref();

function readConfig() { return JSON.parse(readFileSync(configPath, 'utf8')); }
function saveConfig(config) {
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const temporary = configPath + '.' + process.pid;
  writeFileSync(temporary, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  renameSync(temporary, configPath);
}
async function input() {
  if (args[0]) {
    if (Buffer.byteLength(args[0]) > 256 * 1024) throw new Error('事件超过 256 KiB');
    return JSON.parse(args[0]);
  }
  if (process.stdin.isTTY) throw new Error('需要 JSON 事件输入');
  const chunks = []; let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    if (bytes > 256 * 1024) throw new Error('事件超过 256 KiB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function main() {
  if (command === 'hook') {
    const event = normalizeEvent(agent, await input());
    if (!event) return;
    const result = await deliver(event, readConfig(), directory);
    if (result.status === 'pending' || result.status === 'queued') process.stderr.write('[agent-notify] 通知已入本地待重试队列\n');
    if (result.status === 'capacity') process.stderr.write('[agent-notify] 通知队列已满，本条未入队；请运行 retry\n');
    // 成功事件顺便补发一条积压，仍保持最多两次网络请求和有限运行时间。
    if (result.status === 'sent') {
      const row = pending(directory, 1)[0];
      if (row) await deliver(row.event, readConfig(), directory, { id: row.id });
    }
    return;
  }
  if (command === 'import-confirmo') {
    if (existsSync(configPath)) throw new Error('目标配置已存在，拒绝覆盖');
    const source = agent || join(homedir(), 'Library', 'Application Support', 'confirmo', 'confirmo-settings.json');
    const settings = JSON.parse(readFileSync(source, 'utf8')).pushNotifications;
    if (!settings?.telegram?.botToken || !settings?.telegram?.chatId) throw new Error('原应用没有完整 Telegram 配置');
    saveConfig({ botToken: settings.telegram.botToken, chatId: settings.telegram.chatId,
      events: settings.events || ['task-complete', 'task-error', 'needs-attention'] });
    console.log('已迁移 Telegram 配置（权限 0600；未输出凭据）');
    return;
  }
  if (command === 'test') {
    const result = await deliver({ agent: 'agent-notify', event: 'task-complete',
      sessionId: 'installation-check', eventId: `test-${Date.now()}`, cwd: process.cwd(),
      details: 'AgentPigeon 测试消息：Telegram 通知已连通。' },
      { ...readConfig(), enabled: true, events: ['task-complete'] }, directory);
    console.log(JSON.stringify(result));
    if (result.status !== 'sent') process.exitCode = 1;
    return;
  }
  if (command === 'retry') {
    const config = readConfig();
    if (config.enabled === false) { console.log('[]'); return; }
    const results = [];
    for (const row of pending(directory)) results.push(await deliver(row.event, config, directory, { id: row.id }));
    console.log(JSON.stringify(results));
    if (results.some(r => r.status === 'pending' || r.status === 'queued')) process.exitCode = 1;
    return;
  }
  if (command === 'doctor') {
    const config = readConfig();
    console.log(JSON.stringify({ node: process.version, configured: Boolean(config.botToken && config.chatId),
      configPath, events: config.events, runtime: '按事件启动；无常驻进程', ...deliveryStatus(directory) }, null, 2));
    return;
  }
  if (command === 'ui-status') {
    const cliPath = fileURLToPath(import.meta.url);
    const agents = [
      ['codex', 'Codex', '.codex/config.toml'], ['claude', 'Claude Code', '.claude/settings.json'],
      ['gemini', 'Gemini CLI', '.gemini/settings.json'], ['cursor', 'Cursor', '.cursor/hooks.json'],
    ].map(([id, name, file]) => {
      let installed = false;
      try { installed = readFileSync(join(homedir(), file), 'utf8').includes(cliPath); } catch {}
      return { id, name, installed };
    });
    console.log(JSON.stringify({ ...deliveryStatus(directory), recent: recentDeliveries(directory), agents }));
    return;
  }
  if (command === 'plan' || command === 'install') {
    const { planInstall, applyPlan } = await import('./install.mjs');
    const flags = [agent, ...args];
    const plans = await planInstall({ home: homedir(), nodePath: process.execPath, cliPath: fileURLToPath(import.meta.url),
      includeOtherAgents: flags.includes('--all'), includeOpenCode: flags.includes('--with-opencode') });
    if (command === 'plan') { console.log(JSON.stringify(plans.map(p => ({ path: p.path, reason: p.reason, changed: p.before !== p.after })), null, 2)); return; }
    const backupDir = join(home, 'backups', new Date().toISOString().replaceAll(':', '-'));
    await applyPlan(plans, { backupDir });
    console.log(JSON.stringify({ installed: true, backupDir, files: plans.map(p => p.path) }));
    return;
  }
  if (command === 'restore') {
    const { restoreBackup } = await import('./install.mjs');
    const result = await restoreBackup(agent);
    console.log(JSON.stringify({ restored: true, backupDir: result.backupDir }));
    return;
  }
  console.log('agent-notify: import-confirmo | test | doctor | plan [--all] | install [--all] | restore <backupDir> | retry | hook <codex|claude|opencode|gemini|cursor|generic>');
}
try { await main(); }
catch {
  // 不输出输入、路径参数或底层网络异常，避免凭据进入 Agent 日志。
  process.stderr.write('[agent-notify] 操作失败；请检查配置、输入和 doctor 输出\n');
  if (!isHook) process.exitCode = 1;
} finally { clearTimeout(watchdog); }
