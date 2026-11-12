$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$speechSynthesizer = $null
$waveStream = $null
try {
    $requestData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -AssemblyName System.Speech
    $speechSynthesizer = [System.Speech.Synthesis.SpeechSynthesizer]::new()
    if ($requestData.mode -eq 'voices') {
        $voiceResults = @($speechSynthesizer.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
            [pscustomobject]@{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name }
        })
        [Console]::Out.Write((@{ voices = $voiceResults } | ConvertTo-Json -Depth 4 -Compress))
    } elseif ($requestData.mode -eq 'speak') {
        if ([string]::IsNullOrWhiteSpace($requestData.text) -or $requestData.text.Length -gt 2400) {
            throw 'Invalid speech text.'
        }
        if (-not [string]::IsNullOrWhiteSpace($requestData.voice)) {
            $speechSynthesizer.SelectVoice([string]$requestData.voice)
        }
        $speechSynthesizer.Rate = 0
        $speechSynthesizer.Volume = 100
        $waveStream = [System.IO.MemoryStream]::new()
        $speechSynthesizer.SetOutputToWaveStream($waveStream)
        $speechSynthesizer.Speak([string]$requestData.text)
        $speechSynthesizer.SetOutputToNull()
        $encodedAudio = [Convert]::ToBase64String($waveStream.ToArray())
        [Console]::Out.Write((@{ audio = $encodedAudio } | ConvertTo-Json -Compress))
    } else {
        throw 'Unknown speech operation.'
    }
} catch {
    [Console]::Error.WriteLine('Local Windows speech synthesis could not complete.')
    exit 1
} finally {
    if ($speechSynthesizer) { $speechSynthesizer.Dispose() }
    if ($waveStream) { $waveStream.Dispose() }
}
