$ErrorActionPreference = 'Stop'
$settingsPath = Join-Path $PSScriptRoot 'private\startup.json'
if (-not (Test-Path -LiteralPath $settingsPath)) { Write-Error 'Run INSTALL-STARTUP.ps1 first.'; exit 1 }
$settings = Get-Content -LiteralPath $settingsPath -Raw | ConvertFrom-Json
$stopPath = Join-Path $PSScriptRoot 'private\runtime\stop.request'
if (Test-Path -LiteralPath $stopPath) { Remove-Item -LiteralPath $stopPath }
& $settings.nodePath (Join-Path $PSScriptRoot 'supervisor.mjs')
exit $LASTEXITCODE
