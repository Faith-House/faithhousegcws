import path from 'node:path';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, lstat, readFile, writeFile, rename, unlink, utimes } from 'node:fs/promises';

const magic = Buffer.from('JVSC01\r\n');
const fileName = /^[a-f0-9]{64}\.jva$/;
const digest = value => createHash('sha256').update(value).digest();
export const speechCacheKey = value => digest(JSON.stringify(value)).toString('hex');
export function canonicalSpeechWave(wave) {
  return Buffer.isBuffer(wave) && wave.length >= 46 && wave.toString('ascii', 0, 4) === 'RIFF'
    && wave.readUInt32LE(4) === wave.length - 8 && wave.toString('ascii', 8, 16) === 'WAVEfmt '
    && wave.readUInt32LE(16) === 16 && wave.readUInt16LE(20) === 1 && wave.readUInt16LE(22) === 1
    && wave.readUInt32LE(24) === 24000 && wave.readUInt32LE(28) === 48000 && wave.readUInt16LE(32) === 2 && wave.readUInt16LE(34) === 16
    && wave.toString('ascii', 36, 40) === 'data' && wave.readUInt32LE(40) === wave.length - 44
    && (wave.length - 44) % 2 === 0;
}

// Only hashed keys and checksummed audio are persisted, never prompts or transcripts.
export function createSpeechCache({ directory, maxBytes = 64 * 1024 * 1024, maxEntries = 128,
  maxEntryBytes = 4 * 1024 * 1024, ttlMs = 7 * 24 * 60 * 60 * 1000, now = Date.now } = {}) {
  if (!directory) throw Error('A private speech cache directory is required.');
  const root = path.resolve(directory);
  let hits = 0, misses = 0, writes = Promise.resolve();
  const serialize = work => { const result = writes.then(work); writes = result.catch(() => {}); return result; };
  const target = name => {
    if (!fileName.test(name)) throw Error('Invalid speech cache key.');
    const full = path.resolve(root, name);
    if (path.dirname(full) !== root) throw Error('Invalid speech cache path.');
    return full;
  };
  async function remove(name) { await unlink(target(name)).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  async function entries() {
    const names = await readdir(root).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    const result = [];
    for (const name of names.filter(name => fileName.test(name))) {
      const stat = await lstat(target(name)).catch(() => null);
      if (stat?.isFile() && !stat.isSymbolicLink()) result.push({ name, bytes: stat.size, usedAt: stat.mtimeMs });
    }
    return result;
  }
  async function prune() {
    const list = (await entries()).sort((a, b) => b.usedAt - a.usedAt);
    let bytes = 0, count = 0;
    for (const entry of list) {
      if (entry.usedAt < now() - ttlMs || count >= maxEntries || bytes + entry.bytes > maxBytes) await remove(entry.name);
      else { bytes += entry.bytes; count++; }
    }
  }
  async function get(key, { signal } = {}) {
    signal?.throwIfAborted();
    const name = key + '.jva', file = target(name);
    try {
      const stat = await lstat(file);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 94 || stat.size > maxEntryBytes + 48) throw Error('Invalid cache entry.');
      const stored = await readFile(file);
      const createdAt = Number(stored.readBigUInt64LE(8));
      const wave = stored.subarray(48);
      if (!stored.subarray(0, 8).equals(magic) || createdAt > now() + 60000 || createdAt < now() - ttlMs
        || !canonicalSpeechWave(wave) || !timingSafeEqual(stored.subarray(16, 48), digest(wave))) throw Error('Expired or damaged cache entry.');
      signal?.throwIfAborted();
      await utimes(file, new Date(now()), new Date(now())).catch(() => {});
      hits++;
      return wave;
    } catch (error) {
      if (signal?.aborted) throw signal.reason;
      if (error.code !== 'ENOENT') await remove(name).catch(() => {});
      misses++;
      return null;
    }
  }
  async function put(key, wave, { signal } = {}) {
    if (!canonicalSpeechWave(wave) || wave.length > maxEntryBytes) return false;
    let energy = 0;
    for (let offset = 44; offset < wave.length; offset += 2) energy += (wave.readInt16LE(offset) / 32768) ** 2;
    if (Math.sqrt(energy / ((wave.length - 44) / 2)) < 0.0001) return false;
    return serialize(async () => {
      signal?.throwIfAborted();
      await mkdir(root, { recursive: true });
      const file = target(key + '.jva'), temporary = file + '.' + randomUUID() + '.tmp';
      const header = Buffer.alloc(48); magic.copy(header); header.writeBigUInt64LE(BigInt(now()), 8); digest(wave).copy(header, 16);
      try {
        await writeFile(temporary, Buffer.concat([header, wave]), { mode: 0o600, flag: 'wx' });
        signal?.throwIfAborted();
        await rename(temporary, file);
        await utimes(file, new Date(now()), new Date(now()));
        await prune();
        return true;
      } finally { await unlink(temporary).catch(() => {}); }
    });
  }
  async function stats() {
    await prune();
    const list = await entries();
    return { entries: list.length, bytes: list.reduce((sum, x) => sum + x.bytes, 0), hits, misses, maxBytes, maxEntries, ttlDays: ttlMs / 86400000 };
  }
  const clear = () => serialize(async () => { for (const entry of await entries()) await remove(entry.name); return stats(); });
  return { get, put, stats, clear };
}
