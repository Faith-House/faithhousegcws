$ErrorActionPreference = 'Stop'
$jarvisAddress = 'http://127.0.0.1:3210/'
$jarvisStatus = 'http://127.0.0.1:3210/api/health'
$isReady = $false
$identityHasher = [System.Security.Cryptography.SHA256]::Create()
$expectedProject = ([BitConverter]::ToString($identityHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes((Resolve-Path -LiteralPath $PSScriptRoot).Path.ToLowerInvariant())))).Replace('-','').ToLowerInvariant().Substring(0,16)
$identityHasher.Dispose()
$startupPath = Join-Path $PSScriptRoot 'private\startup.json'
if (Test-Path -LiteralPath $startupPath) {
    try {
        $startup = Get-Content -LiteralPath $startupPath -Raw | ConvertFrom-Json
        $task = Get-ScheduledTask -TaskName $startup.taskName -ErrorAction Stop
        if ($task.State -eq 'Disabled') { throw 'Automatic startup was disabled; start only this session.' }
        Start-ScheduledTask -TaskName $startup.taskName
    } catch {
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-File', ('"' + (Join-Path $PSScriptRoot 'RUN-JARVIS.ps1') + '"')) -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    }
}

try {
    $reply = Invoke-RestMethod -Uri $jarvisStatus -TimeoutSec 2
    $isReady = $reply.app -eq 'jarvis-local-house' -and $reply.projectId -eq $expectedProject
} catch {
    $nodeCommand = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $nodeCommand) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show('Install Node.js 22 or later, then try opening Jarvis again.', 'Jarvis') | Out-Null
        exit 1
    }

    if (-not (Test-Path -LiteralPath $startupPath)) {
        Start-Process -FilePath $nodeCommand.Source -ArgumentList @('--watch', '--env-file-if-exists=.env.local', 'server.mjs') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    }
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
        Start-Sleep -Milliseconds 700
        try {
            $reply = Invoke-RestMethod -Uri $jarvisStatus -TimeoutSec 2
            $isReady = $reply.app -eq 'jarvis-local-house' -and $reply.projectId -eq $expectedProject
            if ($isReady) { break }
        } catch { }
    }
}

if (-not $isReady) {
    Add-Type -AssemblyName System.Windows.Forms
    [System.Windows.Forms.MessageBox]::Show('Jarvis did not start. Open the jarvis-prototype folder and double-click START.cmd to see what needs attention.', 'Jarvis') | Out-Null
    exit 1
}

Start-Process $jarvisAddress
