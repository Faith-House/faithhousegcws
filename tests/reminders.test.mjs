import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createReminders, reminderTime } from '../reminders.mjs';
import { createJarvisServer } from '../server.mjs';
const fixture = () => mkdtemp(path.join(tmpdir(), 'jarvis-reminders-'));
const start = Date.parse('2026-11-10T18:00:00Z');

test('spoken relative and tomorrow reminders resolve accurately without guessing AM/PM', async () => {
  const directory = await fixture(), service = createReminders({ directory, rooms: ['bedroom-1'], now: () => start });
  try {
    const relative = await service.handle({ room: 'bedroom-1', question: 'Hey Jarvis, please remind me to check the oven in twenty minutes.' });
    assert.equal(relative.reminder.dueAt, start + 20 * 60000);
    const tomorrow = await service.handle({ room: 'bedroom-1', question: 'Remind me to take out the trash tomorrow at 7 PM' });
    assert.equal(tomorrow.reminder.dueAt, Date.parse('2026-11-12T01:00:00Z'));
    assert.equal(tomorrow.reminder.title, 'take out the trash');
    const firstTime = await service.handle({ room: 'bedroom-1', question: 'Could you remind me tomorrow at 7 PM to pack my bag?' });
    assert.equal(firstTime.reminder.dueAt, tomorrow.reminder.dueAt);
    assert.match((await service.handle({ room: 'bedroom-1', question: 'Remind me to study tomorrow at 7' })).answer, /AM or PM/);
    assert.equal(await service.handle({ room: 'bedroom-1', question: "Don't remind me to study in twenty minutes" }), null);
    assert.equal((await service.list()).reminders.length, 3);
  } finally { await service.close(); }
});

test('due reminders survive restart and are only cleared in the owning room', async () => {
  const directory = await fixture(); let now = start;
  let service = createReminders({ directory, rooms: ['bedroom-1', 'bedroom-2'], now: () => now });
  const item = await service.add({ room: 'bedroom-1', title: 'Laundry', dueAt: start + 10000 });
  await service.close(); now += 30000;
  service = createReminders({ directory, rooms: ['bedroom-1', 'bedroom-2'], now: () => now });
  try {
    assert.equal((await service.list('bedroom-1')).reminders[0].due, true);
    assert.equal((await service.list('bedroom-2')).reminders.length, 0);
    await assert.rejects(service.remove('bedroom-2', [item.id]));
    assert.equal((await service.list('bedroom-1')).reminders.length, 1);
    await service.remove('bedroom-1', [item.id]);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'reminders.json'), 'utf8')), []);
  } finally { await service.close(); }
});

test('invalid, past and DST-ambiguous times do not become reminders', async () => {
  assert.throws(() => reminderTime('2026-02-30T19:00'));
  assert.throws(() => reminderTime('2026-03-08T02:30'));
  assert.throws(() => reminderTime('2026-11-01T01:30'));
  assert.equal(reminderTime('2026-11-10T19:00'), Date.parse('2026-11-11T01:00:00Z'));
  const service = createReminders({ directory: await fixture(), rooms: ['bedroom-1'], now: () => start });
  try {
    await assert.rejects(service.add({ room: 'bedroom-1', title: 'Past', dueAt: start - 1 }));
    await assert.rejects(service.add({ room: 'bedroom-1', title: 'Too far', dueAt: start + 31 * 86400000 }));
    assert.equal((await service.list()).reminders.length, 0);
  } finally { await service.close(); }
});

test('damaged storage stays intact and reports unavailable', async () => {
  const directory = await fixture(), file = path.join(directory, 'reminders.json');
  await writeFile(file, 'invalid json');
  const service = createReminders({ directory, rooms: ['bedroom-1'], now: () => start });
  try {
    assert.equal((await service.list()).available, false);
    await assert.rejects(service.add({ room: 'bedroom-1', title: 'Laundry', dueAt: start + 10000 }));
    assert.equal(await readFile(file, 'utf8'), 'invalid json');
  } finally { await service.close(); }
});

test('server restores room alerts, serves new assets, and persists acknowledgement', async () => {
  const directory = await fixture();
  await writeFile(path.join(directory, 'reminders.json'), JSON.stringify([{ id: 'due-test', room: 'bedroom-1', title: 'Laundry', dueAt: start - 1000, createdAt: start - 2000 }, { id: 'due-second', room: 'bedroom-1', title: 'Take out the trash', dueAt: start - 500, createdAt: start - 2000 }]));
  const app = createJarvisServer({ displayBind: '', actionsOptions: { dataDirectory: directory, now: () => start }, pairingOptions: { directory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function snapshot(room) {
    const controller = new AbortController();
    const response = await fetch(base + '/api/events?room=' + room, { signal: controller.signal });
    try { const reader = response.body.getReader(); const part = await reader.read(); return JSON.parse(new TextDecoder().decode(part.value).split('\n')[0].slice(6)); }
    finally { controller.abort(); }
  }
  try {
    assert.equal((await fetch(base + '/api/reminders?room=bedroom-1')).status, 200);
    const current = await snapshot('bedroom-1'); assert.equal(current.notification.kind, 'reminder'); assert.match(current.notification.message, /Laundry/);
    assert.equal((await snapshot('bedroom-2')).notification, null);
    for (const route of ['/reminders', '/reminders.js', '/reminders.css', '/agenda.js', '/calendar.css']) assert.equal((await fetch(base + route)).status, 200, route);
    await post('/api/cancel', { room: 'bedroom-1' }); assert.equal((await snapshot('bedroom-1')).notification.id, current.notification.id);
    assert.equal((await post('/api/dismiss-alert', { room: 'bedroom-1', id: current.notification.id })).status, 200);
    const next = await snapshot('bedroom-1');
    assert.match(next.notification.message, /Take out the trash/);
    assert.equal((await post('/api/dismiss-alert', { room: 'bedroom-1', id: next.notification.id })).status, 200);
    assert.equal((await snapshot('bedroom-1')).notification, null);
    assert.deepEqual(JSON.parse(await readFile(path.join(directory, 'reminders.json'), 'utf8')), []);
  } finally { await app.shutdown(); }
});
