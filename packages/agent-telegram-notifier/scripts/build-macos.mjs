import { mkdirSync, writeFileSync, cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(root, 'dist/AgentPigeon.app');
const executable = join(app, 'Contents/MacOS/AgentPigeon');
const resources = join(app, 'Contents/Resources');
mkdirSync(dirname(executable), {recursive:true}); mkdirSync(resources,{recursive:true});
execFileSync('xcrun',['swiftc','-swift-version','5','-O','-target',`${process.arch === 'arm64' ? 'arm64' : 'x86_64'}-apple-macosx14.0`,'-framework','AppKit','-framework','SwiftUI','-framework','ServiceManagement',join(root,'macos/AgentPigeon.swift'),'-o',executable],{stdio:'inherit'});
const iconset = join(root,'dist/AgentPigeon.iconset');
execFileSync('xcrun',['swift',join(root,'macos/Icon.swift'),iconset],{stdio:'inherit'});
execFileSync('iconutil',['-c','icns',iconset,'-o',join(resources,'AppIcon.icns')],{stdio:'inherit'});
writeFileSync(join(resources,'runtime.json'),JSON.stringify({node:process.execPath,cli:join(root,'src/cli.mjs')},null,2));
writeFileSync(join(app,'Contents/Info.plist'),`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>local.personal-efficiency.AgentPigeon</string>
<key>CFBundleName</key><string>AgentPigeon</string>
<key>CFBundleDisplayName</key><string>AgentPigeon</string>
<key>CFBundleExecutable</key><string>AgentPigeon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>1.1.1</string>
<key>CFBundleVersion</key><string>3</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
<key>NSHumanReadableCopyright</key><string>个人效率助手 · AgentPigeon</string>
</dict></plist>\n`);
execFileSync('codesign',['--force','--sign','-','--identifier','local.personal-efficiency.AgentPigeon',app],{stdio:'inherit'});
execFileSync('codesign',['--verify','--strict',app],{stdio:'inherit'});
console.log(`已构建 ${app}`);
if (process.argv.includes('--install')) {
  const destination='/Applications/AgentPigeon.app';
  if(existsSync(destination)) {
    const id=execFileSync('/usr/libexec/PlistBuddy',['-c','Print :CFBundleIdentifier',join(destination,'Contents/Info.plist')],{encoding:'utf8'}).trim();
    if(id!=='local.personal-efficiency.AgentPigeon') throw new Error('目标不是 AgentPigeon，拒绝覆盖');
    const backup=join(root,'dist/AgentPigeon.previous.app');
    rmSync(backup,{recursive:true,force:true}); cpSync(destination,backup,{recursive:true});
    rmSync(destination,{recursive:true});
  }
  cpSync(app,destination,{recursive:true});
  console.log(`已安装 ${destination}`);
}
