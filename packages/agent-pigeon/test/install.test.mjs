import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, stat, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { planInstall, applyPlan, restoreBackup } from '../src/install.mjs';

async function fixture(t) {
  const home = await mkdtemp(path.join(tmpdir(), 'agent-pigeon-install-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const options = { home, cliPath: path.join(home, "my project's notifier/cli.mjs"), nodePath: process.execPath, platform: 'darwin' };
  const put = async (file, content) => {
    const absolute = path.join(home, file);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, typeof content === 'string' ? content : JSON.stringify(content));
    return absolute;
  };
  return { home, options, put };
}

const unwrap = command => command.includes('--previous-notify')
  ? unwrap(JSON.parse(command[command.indexOf('--previous-notify') + 1])) : command;

test('递归替换 Codex 的 Confirmo hook，保留两层包装和其他 TOML', async t => {
  const { options, put } = await fixture(t);
  const inner = ['/cu/client', 'turn-ended', '--previous-notify', JSON.stringify(['node', '/x/confirmo-codex-hook.js']), '--keep'];
  const outer = ['/outer/client', '--previous-notify', JSON.stringify(inner), 'extra'];
  const suffix = '\n# 其他配置\n[projects."/a"]\ntrust_level = "trusted"\n';
  const file = await put('.codex/config.toml', `model = "sample"\nnotify = ${JSON.stringify(outer)}${suffix}`);
  const plan = (await planInstall(options)).find(item => item.path === file);
  const rewritten = JSON.parse(plan.after.split('\n')[1].slice('notify = '.length));
  assert.equal(rewritten[0], outer[0]);
  assert.equal(rewritten.at(-1), 'extra');
  assert.equal(JSON.parse(rewritten[2]).at(-1), '--keep');
  assert.deepEqual(unwrap(rewritten), [options.nodePath, '--use-env-proxy', options.cliPath, 'hook', 'codex']);
  assert.ok(plan.after.endsWith(suffix));
});

test('支持有注释和单引号的多行 notify；拒绝陌生通知命令和过深链', async t => {
  const { options, put } = await fixture(t);
  const file = await put('.codex/config.toml', "notify = [\n 'node', # runtime\n '/x/confirmo-codex-hook.js',\n]\n");
  assert.ok((await planInstall(options)).find(item => item.path === file));
  await put('.codex/config.toml', 'notify = ["custom", "notify"]\n');
  await assert.rejects(planInstall(options), /拒绝覆盖/);
  let command = ['node', '/x/confirmo-codex-hook.js'];
  // JSON 字符串嵌套大小随层数增长，17 层足以验证防循环深度上限。
  for (let i = 0; i < 17; i++) command = ['wrapper', '--previous-notify', JSON.stringify(command)];
  await put('.codex/config.toml', `notify = ${JSON.stringify(command)}\n`);
  await assert.rejects(planInstall(options), /过深/);
});

test('Claude 保留第三方命令和设置，仅替换 Confirmo 并添加低频事件', async t => {
  const { options, put } = await fixture(t);
  const external = { type: 'command', command: 'my-audit --check', timeout: 7 };
  const file = await put('.claude/settings.json', {
    model: 'keep-model', permissions: { allow: ['Read'] },
    hooks: {
      PostToolUse: [{ matcher: 'Edit', hooks: [external, { type: 'command', command: 'node "/x/confirmo-hook.js"' }] }],
      SessionStart: [{ hooks: [{ type: 'command', command: 'node /x/confirmo-hook.js' }] }],
      Stop: [{ matcher: '', hooks: [external] }],
    },
  });
  const result = JSON.parse((await planInstall(options)).find(item => item.path === file).after);
  assert.equal(result.model, 'keep-model');
  assert.deepEqual(result.permissions, { allow: ['Read'] });
  assert.deepEqual(result.hooks.PostToolUse, [{ matcher: 'Edit', hooks: [external] }]);
  assert.equal(result.hooks.SessionStart, undefined);
  assert.deepEqual(result.hooks.Stop[0].hooks, [external]);
  assert.equal(result.hooks.Stop.length, 2);
  assert.equal(result.hooks.StopFailure.length, 1);
  assert.equal(result.hooks.PreToolUse[0].matcher, 'AskUserQuestion|ExitPlanMode');
  assert.match(result.hooks.Stop[1].hooks[0].command, /--use-env-proxy/);
  assert.match(result.hooks.Stop[1].hooks[0].command, /'\\''/);
});

test('备份旧插件并移出自动加载目录，安装幂等且可安全恢复', async t => {
  const { home, options, put } = await fixture(t);
  const codex = await put('.codex/config.toml', 'notify = ["node", "/x/confirmo-codex-hook.js"]\n');
  const old = await put('.config/opencode/plugin/confirmo-plugin.ts', '// old plugin');
  const before = await readFile(codex, 'utf8');
  const withOpenCode = { ...options, includeOpenCode: true };
  assert.ok(!(await planInstall(options)).some(item => item.path.includes('/opencode/')));
  const plans = await planInstall(withOpenCode);
  assert.equal(plans.find(item => item.path === old).after, null);
  assert.ok(!plans.some(item => /\.gemini|\.cursor/.test(item.path)));
  const backupDir = path.join(home, 'backups', 'first');
  const result = await applyPlan(plans, { backupDir });
  assert.equal(result.applied, plans.length);
  await assert.rejects(stat(old), { code: 'ENOENT' });
  for (const entry of result.manifest) {
    if (entry.backupPath && process.platform !== 'win32') assert.equal((await stat(entry.backupPath)).mode & 0o777, 0o600);
  }
  assert.deepEqual(await planInstall(withOpenCode), []);
  await restoreBackup(backupDir);
  assert.equal(await readFile(codex, 'utf8'), before);
  assert.equal(await readFile(old, 'utf8'), '// old plugin');
  await assert.rejects(stat(path.join(home, '.config/opencode/plugins/agent-pigeon.ts')), { code: 'ENOENT' });
});

test('安装时拒绝并发修改，恢复时同样保留新配置', async t => {
  const { home, options, put } = await fixture(t);
  const plans = await planInstall(options);
  await put('.claude/settings.json', '{"userEdit":true}');
  await assert.rejects(applyPlan(plans, { backupDir: path.join(home, 'rejected') }), /已变化/);
  await assert.rejects(stat(path.join(home, '.codex/config.toml')), { code: 'ENOENT' });
  const backupDir = path.join(home, 'backups');
  await applyPlan(await planInstall(options), { backupDir });
  await put('.claude/settings.json', '{"anotherEdit":true}');
  await assert.rejects(restoreBackup(backupDir), /已变化/);
  assert.equal(await readFile(path.join(home, '.claude/settings.json'), 'utf8'), '{"anotherEdit":true}');
});

test('部分写入失败自动恢复已修改文件，原始备份仍可读取', async t => {
  const { home, put } = await fixture(t);
  const first = await put('first.json', 'original');
  const second = await put('b'.repeat(240), 'second-original');
  const plans = [
    { path: first, before: 'original', after: 'changed', reason: 'test' },
    { path: second, before: 'second-original', after: 'new', reason: 'test' },
  ];
  // 原文件名和备份名合法，第二次原子写的临时文件名超过 NAME_MAX。
  const backupDir = path.join(home, 'backup');
  await assert.rejects(applyPlan(plans, { backupDir }), error => ['ENAMETOOLONG', 'ENOENT'].includes(error.code));
  assert.equal(await readFile(first, 'utf8'), 'original');
  assert.equal(await readFile(second, 'utf8'), 'second-original');
  assert.equal(await readFile(path.join(backupDir, '0-first.json.bak'), 'utf8'), 'original');
});

test('OpenCode 插件只转发完成、错误、权限和问题事件，等待子进程退出且不使用 shell', async t => {
  const { home, options, put } = await fixture(t);
  const target = path.join(home, 'payload.json');
  await put(path.relative(home, options.cliPath), `import { writeFile } from 'node:fs/promises';\nlet s='';for await(const c of process.stdin)s+=c;await new Promise(r=>setTimeout(r,40));await writeFile(${JSON.stringify(target)},s);`);
  const plugin = (await planInstall({ ...options, includeOpenCode: true })).find(item => item.path.endsWith('agent-pigeon.ts'));
  assert.match(plugin.after, /detached: false/);
  assert.match(plugin.after, /shell: false/);
  assert.match(plugin.after, /15000/);
  assert.match(plugin.after, /SIGKILL/);
  const module = await import(`data:text/javascript;base64,${Buffer.from(plugin.after).toString('base64')}`);
  assert.deepEqual(Object.keys(module), ['AgentPigeonPlugin']);
  const handler = await module.AgentPigeonPlugin({ directory: '/test/project' });
  await handler.event({ event: { type: 'message.updated' } });
  await assert.rejects(stat(target), { code: 'ENOENT' });
  await handler.event({ event: { type: 'session.idle', properties: { sessionID: 'sample' } } });
  assert.deepEqual(JSON.parse(await readFile(target, 'utf8')), { type: 'session.idle', properties: { sessionID: 'sample' }, cwd: '/test/project' });
  await handler.event({ event: { type: 'question.asked', properties: { sessionID: 'sample' } } });
  assert.equal(JSON.parse(await readFile(target, 'utf8')).type, 'question.asked');
});

test('显式扩展 Gemini/Cursor，保留第三方 hooks 与设置，反复安装不重复', async t => {
  const { home, options, put } = await fixture(t);
  const gemini = await put('.gemini/settings.json', {
    model: { name: 'keep-model' },
    hooks: {
      AfterAgent: [{ matcher: 'custom', hooks: [{ type: 'command', name: 'other', command: 'other-check' }] }],
      BeforeTool: [{ hooks: [{ type: 'command', command: 'audit-tool' }] }],
    },
  });
  const cursor = await put('.cursor/hooks.json', {
    version: 1,
    hooks: { stop: [{ command: 'other-stop', timeout: 30 }], afterFileEdit: [{ command: 'format' }] },
  });
  const expanded = { ...options, includeOtherAgents: true };
  const plans = await planInstall(expanded);
  const g = JSON.parse(plans.find(plan => plan.path === gemini).after);
  assert.deepEqual(g.model, { name: 'keep-model' });
  assert.equal(g.hooks.AfterAgent.length, 2);
  assert.equal(g.hooks.AfterAgent[1].hooks[0].timeout, 15000);
  assert.equal(g.hooks.Notification[0].hooks[0].name, 'agent-pigeon-Notification');
  assert.equal(g.hooks.BeforeTool[0].hooks[0].command, 'audit-tool');
  const c = JSON.parse(plans.find(plan => plan.path === cursor).after);
  assert.equal(c.version, 1);
  assert.equal(c.hooks.stop.length, 2);
  assert.equal(c.hooks.stop[1].timeout, 15);
  assert.equal(c.hooks.afterFileEdit[0].command, 'format');
  await applyPlan(plans, { backupDir: path.join(home, 'backup') });
  assert.deepEqual(await planInstall(expanded), []);
});

test('拒绝覆盖未知 Cursor hooks 配置版本', async t => {
  const { options, put } = await fixture(t);
  await put('.cursor/hooks.json', { version: 2, hooks: {} });
  await assert.rejects(planInstall({ ...options, includeOtherAgents: true }), /版本不是 1/);
});

test('重试 LaunchAgent 使用绝对参数并正确转义 XML，不驻留和不重定向私人日志', async t => {
  const { home, options } = await fixture(t);
  const plans = await planInstall({ ...options, cliPath: path.join(home, 'space & <tag> "quoted"/cli.mjs') });
  const plan = plans.find(item => item.path.endsWith('local.personal-efficiency.agent-pigeon-retry.plist'));
  assert.equal(plan.path, path.join(home, 'Library/LaunchAgents/local.personal-efficiency.agent-pigeon-retry.plist'));
  assert.match(plan.after.replaceAll('\\', '/'), /space &amp; &lt;tag&gt; &quot;quoted&quot;\/cli\.mjs/);
  assert.ok(plan.after.includes(`<string>${process.execPath}</string>`));
  assert.match(plan.after, /<string>--use-env-proxy<\/string>/);
  assert.match(plan.after, /<string>retry<\/string>/);
  assert.match(plan.after, /<key>StartInterval<\/key><integer>60<\/integer>/);
  assert.match(plan.after, /<key>RunAtLoad<\/key><true\/>/);
  assert.match(plan.after, /<key>ProcessType<\/key><string>Background<\/string>/);
  assert.equal((plan.after.match(/<string>\/dev\/null<\/string>/g) ?? []).length, 2);
  assert.ok(!plan.after.includes('KeepAlive'));
});

test('改名迁移四种旧入口并保持 CUA 包装、第三方 hook 和安装幂等', async t => {
  const {home,options,put}=await fixture(t);
  options.cliPath = path.join(home, 'packages/agent-pigeon/src/cli.mjs');
  const old='/repo/packages/agent-telegram-notifier/src/cli.mjs';
  const oldCommand=agent=>`'${process.execPath}' '--use-env-proxy' '${old}' 'hook' '${agent}'`;
  await put('.codex/config.toml', `notify = ${JSON.stringify(['/cu/client','--previous-notify',JSON.stringify([process.execPath,'--use-env-proxy',old,'hook','codex'])])}\n`);
  await put('.claude/settings.json',{hooks:{Stop:[{hooks:[{type:'command',command:oldCommand('claude')},{type:'command',command:'external-keep'}]}]}});
  await put('.gemini/settings.json',{hooks:{AfterAgent:[{hooks:[{type:'command',name:'agent-telegram-notifier-AfterAgent',command:oldCommand('gemini')}]}]}});
  await put('.cursor/hooks.json',{version:1,hooks:{stop:[{command:oldCommand('cursor')},{command:'external-keep'}]}});
  await put('Library/LaunchAgents/local.personal-efficiency.agent-notifier-retry.plist',`<string>local.personal-efficiency.agent-notifier-retry</string><string>${old}</string>`);
  const plans=await planInstall({...options,includeOtherAgents:true});
  await applyPlan(plans,{backupDir:path.join(home,'backups/rename')});
  const toml=await readFile(path.join(home,'.codex/config.toml'),'utf8');
  const notify=JSON.parse(toml.trim().slice('notify = '.length));
  assert.equal(notify[0],'/cu/client'); assert.equal(unwrap(notify)[2],options.cliPath);
  for(const file of ['.claude/settings.json','.gemini/settings.json','.cursor/hooks.json']) {
    const text=await readFile(path.join(home,file),'utf8');
    assert.equal(text.includes('agent-telegram-notifier'),false);
    assert.equal(text.includes(options.cliPath) || text.includes(JSON.stringify(options.cliPath).slice(1,-1)),true);
  }
  assert.ok((await readFile(path.join(home,'.claude/settings.json'),'utf8')).includes('external-keep'));
  assert.ok((await readFile(path.join(home,'.cursor/hooks.json'),'utf8')).includes('external-keep'));
  await assert.rejects(stat(path.join(home,'Library/LaunchAgents/local.personal-efficiency.agent-notifier-retry.plist')),{code:'ENOENT'});
  assert.deepEqual(await planInstall({...options,includeOtherAgents:true}),[]);
});
