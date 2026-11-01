import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { planInstall, applyPlan } from '../src/install.mjs';

test('Windows migration preserves nested Codex wrapper and other Claude hooks; repeat install is empty', async t => {
  const home = await mkdtemp(path.join(tmpdir(), 'pigeon windows '));
  t.after(() => rm(home, { recursive: true, force: true }));
  await mkdir(path.join(home, '.codex')); await mkdir(path.join(home, '.claude'));
  const old = ['node.exe', 'C:\\Users\\person\\.confirmo\\hooks\\confirmo-codex-hook.js'];
  const wrapper = ['C:\\Program Files\\CUA\\helper.exe', 'turn-ended', '--previous-notify', JSON.stringify(old)];
  await writeFile(path.join(home, '.codex/config.toml'), `notify = ${JSON.stringify(wrapper)}\nmodel = "keep"\n`);
  await writeFile(path.join(home, '.claude/settings.json'), JSON.stringify({ hooks: { Stop: [{ hooks: [{type:'command', command:'audit'}, {type:'command', command:'node "C:\\Users\\person\\.confirmo\\hooks\\confirmo-hook.js"'}]}]}}));
  const options = {home, nodePath:process.execPath, cliPath:path.join(home,"my project's app",'agent-pigeon/src/cli.mjs'), platform:'win32'};
  const plans = await planInstall(options);
  assert.equal(plans.length, 2); assert.ok(!plans.some(p => p.path.includes('LaunchAgents')));
  await applyPlan(plans, {backupDir:path.join(home,'backup')});
  const toml = await readFile(path.join(home,'.codex/config.toml'),'utf8');
  const command = JSON.parse(toml.split('\n')[0].slice(9));
  assert.equal(command[0], wrapper[0]); assert.equal(JSON.parse(command[3])[2],options.cliPath);
  const settings = JSON.parse(await readFile(path.join(home,'.claude/settings.json'),'utf8'));
  assert.equal(settings.hooks.Stop[0].hooks[0].command,'audit');
  const hook = settings.hooks.Stop[1].hooks[0].command;
  assert.ok(hook.includes('"'+options.cliPath.replaceAll('\\','/')+'"'));
  assert.ok(!JSON.stringify(settings).includes('confirmo'));
  assert.deepEqual(await planInstall(options),[]);
  if (process.platform === 'win32') {
    await mkdir(path.dirname(options.cliPath),{recursive:true});
    const payload = path.join(home,'payload.json');
    await writeFile(options.cliPath, `import{writeFileSync}from'node:fs';let input='';for await(const c of process.stdin)input+=c;writeFileSync(${JSON.stringify(payload)},JSON.stringify({args:process.argv.slice(2),input}));`);
    const result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d','/s','/c',`"${hook}"`], {input:'{"test":true}', encoding:'utf8', windowsVerbatimArguments:true});
    assert.equal(result.status,0,result.stderr);
    assert.deepEqual(JSON.parse(await readFile(payload,'utf8')), {args:['hook','claude'],input:'{"test":true}'});
  }
});
