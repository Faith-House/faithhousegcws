$ErrorActionPreference = 'Stop'
try {
    $route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.NextHop -ne '0.0.0.0' } | Sort-Object RouteMetric | Select-Object -First 1
    if (-not $route) {
        @{ connected = $false; gatewayResponds = $null; detail = 'No IPv4 default route is available.' } | ConvertTo-Json -Compress
        exit 0
    }
    $adapter = Get-NetAdapter | Where-Object { $_.ifIndex -eq $route.InterfaceIndex } | Select-Object -First 1
    $stats = $adapter | Get-NetAdapterStatistics
    $ping = New-Object System.Net.NetworkInformation.Ping
    try {
        $reply = $ping.Send($route.NextHop, 1200)
        $responds = $reply.Status -eq [System.Net.NetworkInformation.IPStatus]::Success
        $latency = if ($responds) { $reply.RoundtripTime } else { $null }
    } catch { $responds = $false; $latency = $null }
    finally { $ping.Dispose() }
    @{
        connected = $adapter.Status -eq 'Up'
        adapter = $adapter.Name
        linkSpeed = [string]$adapter.LinkSpeed
        gatewayResponds = $responds
        gatewayLatencyMs = $latency
        receivedBytes = [double]$stats.ReceivedBytes
        sentBytes = [double]$stats.SentBytes
        detail = if ($responds) { 'The central computer can reach its gateway.' } else { 'The gateway did not answer a ping; some routers block ping.' }
    } | ConvertTo-Json -Compress
} catch {
    @{ connected = $null; gatewayResponds = $null; detail = 'Windows could not read network health.' } | ConvertTo-Json -Compress
}
