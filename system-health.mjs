import os from 'node:os';
import { statfs } from 'node:fs/promises';

export function createSystemHealth({ cpus = os.cpus, totalmem = os.totalmem, freemem = os.freemem, disk = () => statfs(process.cwd()), now = Date.now, cacheMs = 5000 } = {}) {
  let previous, cached, pending;
  const started = now();
  async function read() {
    if (cached && now() - cached.checkedAt < cacheMs) return cached;
    if (pending) return pending;
    pending = (async () => {
      const sample = cpus().reduce((sum, cpu) => ({ idle: sum.idle + cpu.times.idle, total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0) }), { idle: 0, total: 0 });
      const delta = previous ? sample.total - previous.total : 0;
      const cpuPercent = delta > 0 ? Math.round(Math.max(0, Math.min(1, 1 - (sample.idle - previous.idle) / delta)) * 100) : null;
      previous = sample;
      const total = totalmem(), free = freemem();
      let storage = null;
      try { const volume = await disk(); storage = { totalBytes: volume.blocks * volume.bsize, freeBytes: volume.bavail * volume.bsize, usedBytes: (volume.blocks - volume.bavail) * volume.bsize }; } catch { /* A missing volume must not become a made-up usage value. */ }
      cached = { checkedAt: now(), cpuPercent, memory: { totalBytes: total, freeBytes: free, usedBytes: Math.max(0, total - free) }, storage, uptimeSeconds: Math.max(0, Math.floor((now() - started) / 1000)) };
      return cached;
    })().finally(() => { pending = null; });
    return pending;
  }
  return { read };
}
