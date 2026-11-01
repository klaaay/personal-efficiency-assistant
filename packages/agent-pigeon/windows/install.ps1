param([Parameter(Mandatory=$true)][string]$Source)
$ErrorActionPreference = 'Stop'
$destination = Join-Path $env:LOCALAPPDATA 'Programs\AgentPigeon'
$data = Join-Path $env:USERPROFILE '.config\agent-pigeon'
New-Item -ItemType Directory -Path $destination,$data -Force | Out-Null
# Windows chmod does not implement Unix permissions; protect the complete data tree with an ACL.
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $data /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw '无法保护配置目录' }
$running = @(Get-Process AgentPigeon -ErrorAction SilentlyContinue | Where-Object Path -EQ (Join-Path $destination 'AgentPigeon.exe'))
foreach ($process in $running) { Stop-Process -Id $process.Id -Force; $process.WaitForExit() }
Copy-Item -Path (Join-Path $Source '*') -Destination $destination -Recurse -Force
$runtime = Get-Content -LiteralPath (Join-Path $destination 'runtime.json') -Raw | ConvertFrom-Json
$cli = Join-Path $destination 'src\cli.mjs'
& $runtime.node $cli install
if ($LASTEXITCODE -ne 0) { throw 'Hook 安装失败' }
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Programs')) 'AgentPigeon.lnk'))
$shortcut.TargetPath = Join-Path $destination 'AgentPigeon.exe'
$shortcut.Arguments = '--settings'
$shortcut.IconLocation = (Join-Path $destination 'AgentPigeon.ico') + ',0'
$shortcut.Save()
# Run the short-lived retry command without a console, even when the tray is closed.
$node = $runtime.node.Replace('"','""')
$script = $cli.Replace('"','""')
$vbs = 'CreateObject("WScript.Shell").Run """' + $node + '"" --use-env-proxy ""' + $script + '"" retry", 0, True'
$retry = Join-Path $destination 'retry.vbs'
[IO.File]::WriteAllText($retry, $vbs, [Text.Encoding]::Unicode)
$action = New-ScheduledTaskAction -Execute (Join-Path $env:WINDIR 'System32\wscript.exe') -Argument ('"' + $retry + '"')
$trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 1)
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName 'AgentPigeon Retry' -Action $action -Trigger $trigger -Settings $settings -Description 'AgentPigeon Telegram pending delivery retry' -Force | Out-Null
Write-Output "Installed: $destination"
Start-Process -FilePath (Join-Path $destination 'AgentPigeon.exe') -WindowStyle Hidden
