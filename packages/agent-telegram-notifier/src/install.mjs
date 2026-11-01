import { readFile, lstat, mkdir, writeFile, rename, unlink, chmod } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
const digest = value => value === null ? null : createHash('sha256').update(value).digest('hex');

async function readOptional(file) {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error(`配置必须是普通文件：${file}`);
    return await readFile(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

// 仅处理顶层 notify 的字符串数组，保留 TOML 中其他配置和注释。
function notifyRange(text) {
  const match = /^notify\s*=\s*/m.exec(text);
  if (!match) return null;
  if (/^\s*\[(?!\s*["'])/m.test(text.slice(0, match.index))) {
    throw new Error('notify 不在 TOML 顶层，拒绝修改不明确的配置');
  }
  const start = match.index + match[0].length;
  if (text[start] !== '[') throw new Error('Codex notify 必须是字符串数组');
  let quote = null;
  let comment = false;
  for (let i = start + 1; i < text.length; i++) {
    const char = text[i];
    if (comment) { if (char === '\n') comment = false; continue; }
    if (quote) {
      if (quote === '"' && char === '\\') { i++; continue; }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") { quote = char; continue; }
    if (char === '#') { comment = true; continue; }
    if (char === ']') return { start, end: i + 1 };
    if (char === '[') throw new Error('Codex notify 不支持嵌套 TOML 数组');
  }
  throw new Error('Codex notify 数组未闭合');
}

function parseStringArray(text) {
  const values = [];
  let i = 1;
  const skip = () => {
    while (i < text.length) {
      if (/\s/.test(text[i])) { i++; continue; }
      if (text[i] === '#') { while (i < text.length && text[i] !== '\n') i++; continue; }
      break;
    }
  };
  while (true) {
    skip();
    if (text[i] === ']') break;
    const quote = text[i];
    if (quote !== '"' && quote !== "'") throw new Error('Codex notify 只能包含字符串');
    const start = i++;
    while (i < text.length && text[i] !== quote) {
      if (quote === '"' && text[i] === '\\') i++;
      i++;
    }
    if (i >= text.length) throw new Error('Codex notify 字符串未闭合');
    const token = text.slice(start, ++i);
    try { values.push(quote === "'" ? token.slice(1, -1) : JSON.parse(token)); }
    catch { throw new Error('Codex notify 含暂不支持的 TOML 字符串转义，请先规范为普通字符串'); }
    skip();
    if (text[i] === ',') { i++; continue; }
    if (text[i] !== ']') throw new Error('Codex notify 数组缺少逗号');
  }
  return values;
}

function rewriteNotify(command, replacement, seen = new Set(), depth = 0) {
  if (!Array.isArray(command) || command.some(part => typeof part !== 'string')) {
    throw new Error('Codex notify 链必须是字符串数组');
  }
  if (depth > 16) throw new Error('Codex notify 链过深，可能循环');
  const identity = JSON.stringify(command);
  if (seen.has(identity)) throw new Error('Codex notify 链出现循环');
  const visited = new Set(seen).add(identity);
  const slot = command.indexOf('--previous-notify');
  if (slot >= 0) {
    if (slot === command.length - 1) throw new Error('--previous-notify 缺少 JSON 参数');
    let nested;
    try { nested = JSON.parse(command[slot + 1]); }
    catch { throw new Error('--previous-notify 不是有效 JSON'); }
    const copy = [...command];
    copy[slot + 1] = JSON.stringify(rewriteNotify(nested, replacement, visited, depth + 1));
    return copy;
  }
  if (command.length === 0 || command.some(part => /(?:^|\/)confirmo-codex-hook\.js$/.test(part))) {
    return replacement;
  }
  if (command.includes(replacement[2]) && command.at(-2) === 'hook' && command.at(-1) === 'codex') {
    return replacement;
  }
  throw new Error('Codex 已配置其他 notify，拒绝覆盖；请显式提供通知链适配');
}

function updateCodex(before, command) {
  const text = before ?? '';
  const range = notifyRange(text);
  if (!range) return `notify = ${JSON.stringify(command)}\n${text}`;
  const next = rewriteNotify(parseStringArray(text.slice(range.start, range.end)), command);
  return `${text.slice(0, range.start)}${JSON.stringify(next)}${text.slice(range.end)}`;
}

function updateClaude(before, command) {
  const settings = before === null ? {} : JSON.parse(before);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Claude settings 必须是对象');
  settings.hooks ??= {};
  if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) throw new Error('Claude hooks 必须是对象');
  for (const [event, groups] of Object.entries(settings.hooks)) {
    if (!Array.isArray(groups)) throw new Error(`Claude ${event} hooks 格式无效`);
    settings.hooks[event] = groups.flatMap(group => {
      if (!Array.isArray(group.hooks)) throw new Error(`Claude ${event} hook 组缺少 hooks`);
      const hooks = group.hooks.filter(hook => {
        if (typeof hook.command !== 'string') return true;
        return !/confirmo-hook\.js(?:[\s"']|$)/.test(hook.command)
          && !hook.command.includes(command);
      });
      return hooks.length ? [{ ...group, hooks }] : [];
    });
    if (!settings.hooks[event].length) delete settings.hooks[event];
  }
  for (const [event, matcher] of [
    ['Stop', ''], ['StopFailure', ''], ['Notification', ''], ['PermissionRequest', ''],
    ['PreToolUse', 'AskUserQuestion|ExitPlanMode'],
  ]) {
    settings.hooks[event] ??= [];
    settings.hooks[event].push({ matcher, hooks: [{ type: 'command', command, timeout: 15 }] });
  }
  return json(settings);
}

// https://geminicli.com/docs/hooks/reference/：timeout 单位为毫秒。
function updateGemini(before, command) {
  const settings = before === null ? {} : JSON.parse(before);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Gemini settings 必须是对象');
  settings.hooks ??= {};
  if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) throw new Error('Gemini hooks 必须是对象');
  for (const event of ['AfterAgent', 'Notification']) {
    const groups = settings.hooks[event] ?? [];
    if (!Array.isArray(groups)) throw new Error(`Gemini ${event} hooks 格式无效`);
    settings.hooks[event] = groups.flatMap(group => {
      if (!Array.isArray(group.hooks)) throw new Error(`Gemini ${event} hook 组缺少 hooks`);
      const hooks = group.hooks.filter(hook => hook.name !== `agent-telegram-notifier-${event}` && hook.command !== command);
      return hooks.length ? [{ ...group, hooks }] : [];
    });
    settings.hooks[event].push({ hooks: [{ type: 'command', name: `agent-telegram-notifier-${event}`, command, timeout: 15000 }] });
  }
  return json(settings);
}

// https://cursor.com/docs/hooks：version=1，timeout 单位为秒。
function updateCursor(before, command) {
  const settings = before === null ? { version: 1 } : JSON.parse(before);
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Cursor hooks 配置必须是对象');
  if (settings.version !== undefined && settings.version !== 1) throw new Error('Cursor hooks 版本不是 1，拒绝覆盖');
  settings.version = 1;
  settings.hooks ??= {};
  if (typeof settings.hooks !== 'object' || Array.isArray(settings.hooks)) throw new Error('Cursor hooks 必须是对象');
  if (settings.hooks.stop !== undefined && !Array.isArray(settings.hooks.stop)) throw new Error('Cursor stop hooks 必须是数组');
  settings.hooks.stop = (settings.hooks.stop ?? []).filter(hook => hook.command !== command);
  settings.hooks.stop.push({ command, timeout: 15 });
  return json(settings);
}

function retryLaunchAgent(nodePath, cliPath) {
  const xml = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
  const args = [nodePath, '--use-env-proxy', cliPath, 'retry'].map(value => `      <string>${xml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
  <dict>
    <key>Label</key><string>local.personal-efficiency.agent-notifier-retry</string>
    <key>ProgramArguments</key>
    <array>
${args}
    </array>
    <key>StartInterval</key><integer>60</integer>
    <key>RunAtLoad</key><true/>
    <key>ProcessType</key><string>Background</string>
    <key>StandardOutPath</key><string>/dev/null</string>
    <key>StandardErrorPath</key><string>/dev/null</string>
  </dict>
</plist>
`;
}

function openCodePlugin(nodePath, cliPath) {
  return `// 由 agent-telegram-notifier 管理：按事件运行，无常驻子进程。\nimport { spawn } from 'node:child_process';\n\nexport const AgentTelegramNotifier = async ({ directory }) => ({\n  event: async ({ event }) => {\n    if (!['session.idle', 'session.error', 'permission.asked', 'question.asked'].includes(event.type)) return;\n    await new Promise(resolve => {\n      const child = spawn(${JSON.stringify(nodePath)}, ['--use-env-proxy', ${JSON.stringify(cliPath)}, 'hook', 'opencode'], {\n        shell: false, detached: false, stdio: ['pipe', 'ignore', 'ignore'],\n      });\n      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);\n      const done = () => { clearTimeout(timer); resolve(undefined); };\n      child.once('error', done);\n      child.once('close', done);\n      child.stdin.on('error', () => {});\n      child.stdin.end(JSON.stringify({ ...event, cwd: directory }));\n    });\n  },\n});\n`;
}

/** 返回可审查计划；after=null 表示将旧插件备份后移出自动加载目录。 */
export async function planInstall({ home, cliPath, nodePath, includeOtherAgents = false, includeOpenCode = false }) {
  for (const [name, value] of Object.entries({ home, cliPath, nodePath })) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) throw new Error(`${name} 必须为绝对路径`);
  }
  const plans = [];
  const add = async (file, transform, reason) => {
    const before = await readOptional(file);
    const after = transform(before);
    if (before !== after) plans.push({ path: file, before, after, reason });
  };
  await add(path.join(home, '.codex/config.toml'), before => updateCodex(before, [nodePath, '--use-env-proxy', cliPath, 'hook', 'codex']), '替换 Confirmo notify，保留 Computer Use 包装链');
  const claudeCommand = [nodePath, '--use-env-proxy', cliPath, 'hook', 'claude'].map(shellQuote).join(' ');
  await add(path.join(home, '.claude/settings.json'), before => updateClaude(before, claudeCommand), '迁移 Claude 完成、通知和待批准事件；保留第三方 hooks');
  if (includeOpenCode) {
    const base = path.join(home, '.config/opencode');
    // OpenCode 新旧目录名均可能被自动发现，移除已知 Confirmo 插件而不执行它。
    for (const folder of ['plugin', 'plugins']) {
      for (const filename of ['confirmo-plugin.ts', 'confirmo-plugin.js']) {
        await add(path.join(base, folder, filename), () => null, '备份并移出 Confirmo 自动加载插件');
      }
    }
    await add(path.join(base, 'plugins/agent-telegram-notifier.ts'), () => openCodePlugin(nodePath, cliPath), '安装按需运行且限制生命周期的 OpenCode 通知插件');
  }
  if (includeOtherAgents) {
    const command = agent => [nodePath, '--use-env-proxy', cliPath, 'hook', agent].map(shellQuote).join(' ');
    await add(path.join(home, '.gemini/settings.json'), before => updateGemini(before, command('gemini')), '添加 Gemini 完成和通知 hooks，保留其他配置');
    await add(path.join(home, '.cursor/hooks.json'), before => updateCursor(before, command('cursor')), '添加 Cursor stop hook，保留其他配置');
  }
  await add(path.join(home, 'Library/LaunchAgents/local.personal-efficiency.agent-notifier-retry.plist'), () => retryLaunchAgent(nodePath, cliPath), '添加每分钟按需补发队列的 LaunchAgent，不启动常驻进程');
  return plans;
}

async function atomicWrite(file, content) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const temp = `${file}.tmp-${randomUUID()}`;
  try {
    await writeFile(temp, content, { mode: 0o600, flag: 'wx' });
    await rename(temp, file);
  } finally {
    await unlink(temp).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

/** 先校验全部快照；保存可回滚备份，再原子写入各配置。 */
export async function applyPlan(plans, { backupDir }) {
  if (!path.isAbsolute(backupDir)) throw new Error('backupDir 必须为绝对路径');
  if (new Set(plans.map(plan => plan.path)).size !== plans.length) throw new Error('计划中包含重复路径');
  for (const plan of plans) {
    if (!path.isAbsolute(plan.path) || ![null, 'string'].includes(plan.after === null ? null : typeof plan.after)) throw new Error('安装计划无效');
    if (await readOptional(plan.path) !== plan.before) throw new Error(`配置已变化，请重新生成计划：${plan.path}`);
  }
  await mkdir(backupDir, { recursive: true, mode: 0o700 });
  await chmod(backupDir, 0o700);
  const manifest = [];
  for (const [index, plan] of plans.entries()) {
    const backupPath = plan.before === null ? null : path.join(backupDir, `${index}-${path.basename(plan.path)}.bak`);
    if (backupPath) await writeFile(backupPath, plan.before, { mode: 0o600, flag: 'wx' });
    manifest.push({ path: plan.path, backupPath, existed: plan.before !== null, beforeDigest: digest(plan.before), afterDigest: digest(plan.after) });
  }
  await writeFile(path.join(backupDir, 'manifest.json'), json(manifest), { mode: 0o600, flag: 'wx' });
  const applied = [];
  try {
    for (const plan of plans) {
      if (await readOptional(plan.path) !== plan.before) throw new Error(`配置已变化，请重新生成计划：${plan.path}`);
      if (plan.after === null) await unlink(plan.path);
      else await atomicWrite(plan.path, plan.after);
      applied.push(plan);
    }
  } catch (error) {
    const failures = [];
    for (const plan of applied.reverse()) {
      try {
        // 回滚也保留外部并发修改；无法自动回滚时保留备份供手工恢复。
        if (await readOptional(plan.path) !== plan.after) throw new Error(`回滚时配置已变化：${plan.path}`);
        if (plan.before === null) await unlink(plan.path);
        else await atomicWrite(plan.path, plan.before);
      } catch (rollbackError) { failures.push(rollbackError.message); }
    }
    if (failures.length) throw new AggregateError([error], `${error.message}；${failures.join('；')}；备份位于 ${backupDir}`);
    throw error;
  }
  return { applied: applied.length, backupDir, manifest };
}

/** 恢复前验证每个安装结果，避免覆盖安装后新增的用户配置。 */
export async function restoreBackup(backupDir) {
  if (!path.isAbsolute(backupDir)) throw new Error('backupDir 必须为绝对路径');
  const manifest = JSON.parse(await readFile(path.join(backupDir, 'manifest.json'), 'utf8'));
  if (!Array.isArray(manifest)) throw new Error('备份 manifest 格式无效');
  const plans = [];
  for (const entry of manifest) {
    if (!path.isAbsolute(entry.path)) throw new Error('备份包含无效目标路径');
    const current = await readOptional(entry.path);
    if (digest(current) !== entry.afterDigest) throw new Error(`安装后配置已变化，拒绝覆盖：${entry.path}`);
    let original = null;
    if (entry.existed) {
      if (path.dirname(entry.backupPath) !== backupDir) throw new Error('备份路径超出备份目录');
      original = await readOptional(entry.backupPath);
      if (original === null || digest(original) !== entry.beforeDigest) throw new Error(`备份缺失或已变化：${entry.backupPath}`);
    }
    plans.push({ path: entry.path, before: current, after: original, reason: '恢复安装前配置' });
  }
  return applyPlan(plans, { backupDir: path.join(backupDir, `restore-${randomUUID()}`) });
}
