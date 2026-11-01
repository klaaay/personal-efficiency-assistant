import { mkdirSync, writeFileSync, copyFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

if (process.platform !== 'win32') throw new Error('请在 Windows 上构建');
const root = fileURLToPath(new URL('../', import.meta.url));
const out = path.join(root, 'dist', 'windows');
mkdirSync(path.join(out, 'src'), { recursive: true });
const compiler = path.join(process.env.WINDIR || 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe');
const iconBuilder = path.join(root, 'dist', 'IconBuilder.exe');
const iconCompile = spawnSync(compiler, ['/nologo', '/reference:System.Drawing.dll', `/out:${iconBuilder}`, path.join(root, 'windows', 'Icon.cs')], { encoding: 'utf8', windowsHide: true });
if (iconCompile.status !== 0) throw new Error(iconCompile.stdout || iconCompile.stderr || 'Icon compilation failed');
const icon = path.join(out, 'AgentPigeon.ico');
const iconResult = spawnSync(iconBuilder, [icon], { encoding: 'utf8', windowsHide: true });
if (iconResult.status !== 0) throw new Error(iconResult.stderr || 'Icon generation failed');
const result = spawnSync(compiler, ['/nologo', '/target:winexe', '/optimize+', `/win32icon:${icon}`, `/win32manifest:${path.join(root, 'windows', 'app.manifest')}`, '/reference:System.Windows.Forms.dll', '/reference:System.Drawing.dll', '/reference:System.Web.Extensions.dll', `/out:${path.join(out, 'AgentPigeon.exe')}`, path.join(root, 'windows', 'AgentPigeon.cs')], { encoding: 'utf8', windowsHide: true });
if (result.status !== 0) throw new Error(result.stdout || result.stderr || '构建失败');
for (const file of readdirSync(path.join(root, 'src'))) if (file.endsWith('.mjs')) copyFileSync(path.join(root, 'src', file), path.join(out, 'src', file));
writeFileSync(path.join(out, 'runtime.json'), JSON.stringify({ node: process.execPath }, null, 2));
console.log(`已构建：${path.join(out, 'AgentPigeon.exe')}`);
if (process.argv.includes('--install')) {
  const install = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'windows', 'install.ps1'), '-Source', out], { stdio: 'inherit', windowsHide: true });
  process.exitCode = install.status ?? 1;
}
