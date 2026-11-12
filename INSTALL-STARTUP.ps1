param([switch]$StartNow)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $PSScriptRoot).Path
$node = (Get-Command node.exe -ErrorAction Stop).Source
$ollama = Get-Command ollama.exe -ErrorAction SilentlyContinue
$sha = [System.Security.Cryptography.SHA256]::Create()
$projectKey = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($root.ToLowerInvariant())))).Replace('-','').ToLowerInvariant().Substring(0,16)
$sha.Dispose()
$taskName = 'Jarvis-' + $projectKey.Substring(0,8) + '-Startup'
$user = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$privateDirectory = Join-Path $root 'private'
New-Item -ItemType Directory -Path $privateDirectory -Force | Out-Null
$supervisorPort = $null
$savedPath = Join-Path $privateDirectory 'startup.json'
$candidates = @(3212..3220)
if (Test-Path -LiteralPath $savedPath) {
    try { $saved = Get-Content -LiteralPath $savedPath -Raw | ConvertFrom-Json; if ($saved.projectId -eq $projectKey) { $candidates = @([int]$saved.supervisorPort) + $candidates } } catch {}
}
foreach ($candidate in ($candidates | Select-Object -Unique)) {
    $listener = Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue
    if (-not $listener) { $supervisorPort = $candidate; break }
    try { $probe = Invoke-RestMethod -Uri ('http://127.0.0.1:' + $candidate + '/health') -TimeoutSec 2; if ($probe.app -eq 'jarvis-supervisor' -and $probe.projectId -eq $projectKey) { $supervisorPort = $candidate; break } } catch {}
}
if (-not $supervisorPort) { throw 'No free local supervisor port was found. No unrelated processes were stopped.' }
$runner = Join-Path $root 'RUN-JARVIS.ps1'
$powerShell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$arguments = '-NoProfile -NonInteractive -WindowStyle Hidden -File "' + $runner + '"'
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($existing -and ($existing.Actions.Execute -ne $powerShell -or $existing.Actions.Arguments -ne $arguments)) { throw 'A different task already uses this Jarvis task name. It was not changed.' }
$action = New-ScheduledTaskAction -Execute $powerShell -Argument $arguments -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user.Name
$principal = New-ScheduledTaskPrincipal -UserId $user.User.Value -LogonType Interactive -RunLevel Limited
$taskSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -MultipleInstances IgnoreNew -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $taskSettings -Description 'Starts this Jarvis project at user sign-in. Supervises crashes without opening browsers.' -Force | Out-Null
$settings = [ordered]@{ taskName=$taskName; projectId=$projectKey; installedAt=[DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); nodePath=$node; ollamaPath=$(if($ollama){$ollama.Source}else{$null}); port=3210; supervisorPort=$supervisorPort; ensureOllama=$true; watch=$true; startupMode='Windows sign-in'; openBrowser=$false }
$settings | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $privateDirectory 'startup.json') -Encoding UTF8
if ($StartNow) { Start-ScheduledTask -TaskName $taskName }
[pscustomobject]@{ taskName=$taskName; state=(Get-ScheduledTask -TaskName $taskName).State; startup='Current user sign-in'; recovery='Server watchdog + Task Scheduler restart'; browser='Manual desktop shortcut' }
