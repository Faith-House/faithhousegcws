import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { APP_ROOT } from './voice-config.mjs';

const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const digest = token => createHash('sha256').update(token).digest('hex');
export function createDisplayPairing({ rooms, directory = path.join(APP_ROOT, 'private'), now = Date.now, onRevoke = () => {} } = {}) {
  const filename = path.join(directory, 'displays.json');
  let devices = [], pending = new Map(), attempts = new Map(), allAttempts = [];
  let loaded, corrupt = false, writes = Promise.resolve();
  let mutations = Promise.resolve();
  const serialize = operation => { const result = mutations.then(operation); mutations = result.catch(() => {}); return result; };
  async function initialize() {
    if (!loaded) loaded = (async () => {
      try {
        const value = JSON.parse(await readFile(filename, 'utf8'));
        if (!Array.isArray(value) || value.length > 12 || !value.every(device => /^[a-f0-9]{64}$/.test(device.hash) && typeof device.id === 'string' && rooms.includes(device.room) && typeof device.name === 'string' && device.name.length <= 50 && Number.isFinite(device.expiresAt))) throw new Error('Invalid device file');
        devices = value.filter(device => device.expiresAt > now());
      } catch (error) { if (error.code !== 'ENOENT') corrupt = true; }
    })();
    await loaded;
  }
  async function persist() {
    const contents = JSON.stringify(devices, null, 2) + '\n';
    const operation = writes.catch(() => {}).then(async () => {
      await mkdir(directory, { recursive: true });
      await writeFile(filename + '.tmp', contents, { mode: 0o600 });
      await rename(filename + '.tmp', filename);
    });
    writes = operation; await operation;
  }
  async function list() {
    await initialize();
    return { configurationError: corrupt, devices: devices.filter(device => device.expiresAt > now()).map(({ hash, ...device }) => device) };
  }
  async function startInternal(room) {
    await initialize();
    if (corrupt) throw fail('The saved TV pairing file needs attention before another TV can be paired.', 503);
    if (!rooms.includes(room)) throw fail('Choose a valid room.');
    if (devices.filter(device => device.expiresAt > now()).length >= 12) throw fail('Remove an old display before pairing another one.');
    for (const [code, entry] of pending) if (entry.expiresAt <= now() || entry.room === room) pending.delete(code);
    let code;
    do { code = String(randomInt(0, 1000000)).padStart(6, '0'); } while (pending.has(code));
    const entry = { room, expiresAt: now() + 300000 };
    pending.set(code, entry);
    return { code, ...entry };
  }
  async function pairInternal({ code, name, address }) {
    await initialize();
    if (corrupt) throw fail('TV pairing is unavailable until the saved pairing file is repaired.', 503);
    allAttempts = allAttempts.filter(time => now() - time < 300000);
    const recent = (attempts.get(address) || []).filter(time => now() - time < 300000);
    if (recent.length >= 5 || allAttempts.length >= 20) throw fail('Too many pairing attempts. Wait five minutes, then create a new code.', 429);
    recent.push(now()); attempts.set(address, recent); allAttempts.push(now());
    if (attempts.size > 100) attempts.delete(attempts.keys().next().value);
    const entry = typeof code === 'string' && /^\d{6}$/.test(code) ? pending.get(code) : null;
    if (!entry || entry.expiresAt <= now()) throw fail('That code is incorrect or expired. Create a new code on the central computer.', 401);
    if (typeof name !== 'string' || !name.trim() || name.length > 50) throw fail('Give this display a name using 1 to 50 characters.');
    pending.delete(code);
    const token = randomBytes(32).toString('base64url');
    const device = { id: randomUUID(), hash: digest(token), room: entry.room, name: name.trim(), createdAt: now(), expiresAt: now() + 30 * 86400000 };
    devices = devices.filter(item => item.expiresAt > now());
    if (devices.length >= 12) throw fail('Remove an old display before pairing another one.');
    devices.push(device);
    try { await persist(); } catch { devices = devices.filter(item => item.id !== device.id); throw fail('The pairing could not be saved. No display access was granted.', 503); }
    return { token, room: device.room, id: device.id, name: device.name };
  }
  async function authenticate(token) {
    await initialize();
    if (corrupt || typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) return null;
    const hash = digest(token);
    const device = devices.find(item => item.hash === hash && item.expiresAt > now());
    return device ? { id: device.id, room: device.room, name: device.name } : null;
  }
  async function revokeInternal(id) {
    await initialize();
    if (corrupt) throw fail('The saved pairing file needs attention. No pairing was changed.', 503);
    const previous = devices;
    devices = devices.filter(device => device.id !== id);
    try { await persist(); } catch { devices = previous; throw fail('The saved pairing could not be changed.', 503); }
    onRevoke(id);
  }
  return { list, start: room => serialize(() => startInternal(room)), pair: input => serialize(() => pairInternal(input)), authenticate, revoke: id => serialize(() => revokeInternal(id)), close: async () => { await mutations; await writes.catch(() => {}); } };
}
