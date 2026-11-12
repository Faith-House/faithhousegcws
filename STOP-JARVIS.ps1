param([switch]$DisableStartup)
$ErrorActionPreference = 'Stop'
$settings = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'private\startup.json') -Raw | ConvertFrom-Json
if ($DisableStartup) { Disable-ScheduledTask -TaskName $settings.taskName | Out-Null }
$runtime = Join-Path $PSScriptRoot 'private\runtime'
New-Item -ItemType Directory -Path $runtime -Force | Out-Null
Set-Content -LiteralPath (Join-Path $runtime 'stop.request') -Value 'Stop requested by local operator.'
Write-Output 'Supervision will stop at its next check. Existing Ollama processes are left alone.'
if ($DisableStartup) { Write-Output 'Automatic startup is disabled. Run INSTALL-STARTUP.ps1 -StartNow to enable it again.' }
