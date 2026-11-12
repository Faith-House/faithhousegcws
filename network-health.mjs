import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
const run = promisify(execFile);
export function createNetworkHealth({ read = readHostNetwork, cacheMs = 10000 } = {}) {
  let previous, cached, pending;
  async function check() {
    if (cached && Date.now() - cached.checkedAt < cacheMs) return cached;
    if (pending) return pending;
    pending = (async () => {
      const current = await read();
      const now = Date.now();
      const elapsed = previous ? (now - previous.checkedAt) / 1000 : 0;
      const sameAdapter = previous?.adapter === current.adapter;
      const rate = key => sameAdapter && elapsed > 0 && Number.isFinite(previous[key]) && Number.isFinite(current[key]) && current[key] >= previous[key] ? Math.round((current[key] - previous[key]) * 8 / elapsed / 1000) : null;
      cached = { ...current, checkedAt: now, scope: 'central-computer', internetVerified: false, downloadKbps: rate('receivedBytes'), uploadKbps: rate('sentBytes') };
      previous = cached;
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  }
  return { check, peek: () => cached || null };
}
async function readHostNetwork() {
  if (process.platform === 'win32') {
    try {
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', fileURLToPath(new URL('./network-health.ps1', import.meta.url))], { timeout: 20000, maxBuffer: 32768, windowsHide: true });
      return JSON.parse(stdout.trim().replace(/^\uFEFF/, ''));
    } catch { return { connected: null, gatewayResponds: null, detail: 'Network diagnostics are unavailable on this computer.' }; }
  }
  const adapters = Object.entries(networkInterfaces()).filter(([, addresses]) => addresses.some(address => !address.internal && address.family === 'IPv4'));
  return { connected: adapters.length > 0, adapter: adapters.map(([name]) => name).join(', '), gatewayResponds: null, detail: 'A network interface is available. Gateway diagnostics have not been configured on this operating system.' };
}
export function describeNetwork(info) {
  if (info.connected === false) return 'The central computer has no active network connection. I cannot check the other rooms from here.';
  if (info.connected !== true) return 'I could not check the central computer’s network connection. No whole-house Wi-Fi result is available.';
  const gateway = info.gatewayResponds ? `Its gateway answered${Number.isFinite(info.gatewayLatencyMs) ? ` in ${info.gatewayLatencyMs} milliseconds` : ''}.` : 'Its gateway did not answer a ping, which can also happen when the router blocks ping.';
  return `The central computer is connected${info.adapter ? ` through ${info.adapter}` : ''}. ${gateway} This does not verify internet access or Wi-Fi coverage in other rooms.`;
}
