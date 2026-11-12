import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createChores, householdDate } from '../chores.mjs';
import { createJarvisServer } from '../server.mjs';
import { createHouseTools } from '../house-tools.mjs';
const profiles = { list: async () => ({ profiles: [{ id: 'cooper', name: 'Cooper' }, { id: 'wade', name: 'Wade' }] }) };
const directory = () => mkdtemp(path.join(tmpdir(), 'jarvis-chores-'));

test('starter chores are unassigned without deadlines and restart never duplicates them', async () => {
  const dir = await directory(); const store = createChores({ directory: dir, profiles });
  const first = await store.list(); assert.equal(first.chores.length, 8);
  assert.ok(first.chores.every(c => c.assigneeId === null && c.dueDate === null && !c.done));
  await store.close(); const restored = await createChores({ directory: dir, profiles }).list();
  assert.deepEqual(restored.chores, first.chores);
});

test('assignment, due dates, completion and reopening persist; versions prevent lost updates', async () => {
  const dir = await directory(); const stamp = Date.parse('2026-11-12T03:00:00Z');
  const store = createChores({ directory: dir, profiles, now: () => stamp, seed: false });
  const item = await store.add({ title: 'Wash the dishes', assigneeId: 'cooper', dueDate: '2026-11-10' });
  const info = await store.list(); assert.equal(info.today, '2026-11-11'); assert.equal(info.chores[0].overdue, true);
  const done = await store.update({ id: item.id, version: 1, done: true }); assert.equal(done.completedAt, stamp);
  await assert.rejects(store.update({ id: item.id, version: 1, assigneeId: 'wade' }), error => error.status === 409);
  assert.equal((await store.list()).chores[0].assigneeId, 'cooper');
  const reopened = await store.update({ id: item.id, version: done.version, done: false, dueDate: null, assigneeId: null });
  assert.equal(reopened.completedAt, null); assert.equal(reopened.dueDate, null);
  const disk = await createChores({ directory: dir, profiles }).list(); assert.equal(disk.chores[0].done, false); assert.equal(disk.chores[0].version, 3);
  assert.equal(householdDate(stamp, 'America/Chicago'), '2026-11-11');
});

test('bad dates, assignments, duplicates and invalid updates cannot change saved chores', async () => {
  const store = createChores({ directory: await directory(), profiles, seed: false });
  await assert.rejects(store.add({ title: 'Test', dueDate: '2026-02-30' }));
  await assert.rejects(store.add({ title: 'Test', assigneeId: 'unknown' }));
  const original = await store.add({ title: 'Clean bathroom' });
  await assert.rejects(store.add({ title: 'clean BATHROOM' }));
  await assert.rejects(store.update({ id: original.id, version: 1, done: 'true' }));
  await assert.rejects(store.update({ id: original.id, version: 1, private: 'value' }));
  assert.equal((await store.list()).chores.length, 1); assert.equal((await store.list()).chores[0].version, 1);
});

test('damaged storage is preserved and never overwritten with starter chores', async () => {
  const dir = await directory(), file = path.join(dir, 'chores.json'); await writeFile(file, 'broken original');
  const store = createChores({ directory: dir, profiles }); assert.equal((await store.list()).available, false);
  await assert.rejects(store.add({ title: 'New chore' }), error => error.status === 503);
  assert.equal(await readFile(file, 'utf8'), 'broken original');
});

test('direct voice commands list, add, and complete chores without guessing identity', async () => {
  const store = createChores({ directory: await directory(), profiles, seed: false });
  assert.equal((await store.handle('Show my chores')).needsInterpretation, true);
  assert.equal((await store.handle('Add wash dishes to the chore list')).ok, true);
  assert.match((await store.handle('Show the household chores')).summary, /wash dishes, unassigned/);
  assert.equal((await store.handle('Mark chore wash dishes as done')).ok, true);
  assert.equal((await store.list()).chores[0].done, true);
});

test('server exposes shared chores, rejects cross-origin changes, and logs UI writes', async () => {
  const dir = await directory();
  const app = createJarvisServer({ displayBind: '', actionsOptions: { dataDirectory: dir }, pairingOptions: { directory: dir }, speech: { listVoices: async () => ({ available: false }), close() {} } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (url, body, headers) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await fetch(base + '/chores')).status, 200);
    const list = await (await fetch(base + '/api/chores')).json(); assert.equal(list.profiles.length, 4); assert.equal(list.chores.length, 8);
    const item = await (await post('/api/chores', { title: 'API chore', assigneeId: 'cooper' })).json();
    assert.equal((await post('/api/chores/update', { id: item.id, version: 1, done: true }, { Origin: 'https://other.example' })).status, 403);
    assert.equal((await post('/api/chores/update', { id: item.id, version: 1, done: true })).status, 200);
    assert.equal((await post('/api/chores/update', { id: item.id, version: 1, done: false })).status, 409);
    const log = await (await fetch(base + '/api/activity?room=living-room')).json(); assert.ok(log.entries.some(e => e.tool === 'add_chore' && e.status === 'completed'));
    assert.equal(JSON.stringify(log).includes('API chore'), false);
    const tools = await (await fetch(base + '/api/tools?room=living-room')).json(); assert.ok(tools.tools.some(t => t.name === 'list_chores')); assert.ok(tools.tools.some(t => t.name === 'assign_chore'));
    assert.equal((await fetch(base + '/private/chores.json')).status, 404);
  } finally { await app.shutdown(); }
});

test('voice tools require explicit completion and assignment intent before writes', async () => {
  const chores = createChores({ directory: await directory(), profiles, seed: false });
  const factory = createHouseTools({ chores, homeAssistant: { status: async () => ({ configured: false }) } });
  const tools = await factory({ room: 'bedroom-1', profileId: 'cooper' });
  const complete = tools.find(t => t.name === 'set_chore_status'), assign = tools.find(t => t.name === 'assign_chore'), add = tools.find(t => t.name === 'add_chore');
  assert.equal(complete.check({ done: true }, 'Show me the chore list'), false);
  assert.equal(complete.check({ done: true }, 'I have not done the dishes'), false);
  assert.equal(complete.check({ done: true }, 'I finished the dishes'), true);
  assert.equal(complete.check({ done: false }, 'Reopen the dishes chore'), true);
  assert.equal(assign.check({ assigneeId: 'wade' }, 'Assign the dishes chore to Wade'), true);
  assert.equal(assign.check({ assigneeId: 'wade' }, 'What chores does Wade have?'), false);
  assert.equal(assign.check({ assigneeId: 'wade' }, 'Assign this chore to me'), false);
  assert.equal(add.check({ title: 'Dishes', assigneeId: 'wade' }, 'Add a dishes chore'), false);
  assert.equal(add.check({ title: 'Dishes' }, 'Add a dishes chore'), true);
});
