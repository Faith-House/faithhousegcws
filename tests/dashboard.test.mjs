import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createSystemHealth } from '../system-health.mjs';
import { createJarvisServer } from '../server.mjs';
import { createLocalActions } from '../local-actions.mjs';

test('the assistant name is authoritative and never confused with a roommate profile', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-identity-test-'));
  const actions = createLocalActions({ rooms: ['bedroom-1'], dataDirectory: directory });
  try {
    for (const question of ['What is your name?', 'Who are you?', 'Jarvis, please tell me your name.']) assert.equal((await actions.handle({ room: 'bedroom-1', question })).answer, 'I’m Jarvis, your local household assistant.');
    assert.equal(await actions.handle({ room: 'bedroom-1', question: 'What is my name?' }), null);
  } finally { await actions.close(); }
});

test('computer readings use measured counter deltas and leave unavailable readings empty', async () => {
  let clock = 1000, times = { user: 20, sys: 10, idle: 70, nice: 0, irq: 0 }, diskFails = false;
  const health = createSystemHealth({ now: () => clock, cacheMs: 0, cpus: () => [{ times }], totalmem: () => 800, freemem: () => 200, disk: async () => { if (diskFails) throw new Error('Unavailable'); return { blocks: 100, bavail: 40, bsize: 10 }; } });
  const first = await health.read(); assert.equal(first.cpuPercent, null); assert.equal(first.memory.usedBytes, 600); assert.equal(first.storage.freeBytes, 400);
  clock += 5000; times = { user: 50, sys: 30, idle: 120, nice: 0, irq: 0 };
  const next = await health.read(); assert.equal(next.cpuPercent, 50); assert.equal(next.uptimeSeconds, 5);
  diskFails = true; clock += 5000;
  const unavailable = await health.read(); assert.equal(unavailable.cpuPercent, null); assert.equal(unavailable.storage, null);
});

test('the dashboard retains every control required by the working assistant', async () => {
  const original = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const dashboard = await readFile(new URL('../public/dashboard.html', import.meta.url), 'utf8');
  const ids = [...original.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  const dashboardIds = [...dashboard.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(dashboardIds).size, dashboardIds.length, 'Element IDs must remain unique.');
  for (const id of ids) assert.equal(dashboardIds.filter(item => item === id).length, 1, `Missing existing assistant control: ${id}`);
  assert.match(dashboard, /No weather feed connected/);
  assert.match(dashboard, /Connect a shared Google household calendar in House setup/);
});

test('central dashboard shows real timers and stream connections without exposing private templates or control routes to TVs', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-dashboard-test-'));
  const model = http.createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ models: [{ name: 'dashboard-test' }] })); });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const speech = { listVoices: async () => ({ available: true, voices: [] }), close() {} };
  const app = createJarvisServer({ model: 'dashboard-test', ollamaUrl: `http://127.0.0.1:${model.address().port}`, speech, displayBind: '127.0.0.1', actionsOptions: { dataDirectory: directory }, pairingOptions: { directory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => app.displayServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`, tv = `http://127.0.0.1:${app.displayServer.address().port}`;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const abort = new AbortController(); let stream;
  try {
    const root = await fetch(base + '/'); assert.match(await root.text(), /Jarvis · Control room/); assert.match(root.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(await (await fetch(base + '/assistant')).text(), /Your minimal local Jarvis assistant/);
    let info = await (await fetch(base + '/api/dashboard')).json();
    assert.equal(info.ai.available, true); assert.equal(info.ai.modelInstalled, true); assert.equal(info.services.calendar, false);
    assert.equal(info.profiles.length, 4); assert.equal(info.timers.timers.length, 0); assert.equal(info.system.memory.totalBytes > 0, true);
    const code = await (await post(base + '/api/pairing/start', { room: 'bedroom-1' })).json();
    const pair = await post(tv + '/api/pair', { code: code.code, name: 'Dashboard test TV' });
    const cookie = pair.headers.get('set-cookie').split(';')[0];
    stream = await fetch(tv + '/api/events', { headers: { Cookie: cookie }, signal: abort.signal });
    const ask = await post(base + '/api/ask', { room: 'bedroom-2', question: 'Set a timer for twenty seconds called study' }); assert.equal(ask.status, 202);
    for (let i = 0; i < 30; i++) { info = await (await fetch(base + '/api/dashboard')).json(); if (info.timers.timers.length) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(info.timers.timers[0].label, 'study'); assert.equal(info.timers.timers[0].room, 'bedroom-2');
    assert.equal(info.displays.devices[0].receiving, true);
    assert.equal(JSON.stringify(info).includes('embedding'), false); assert.equal(JSON.stringify(info).includes('voiceprint'), false); assert.equal(JSON.stringify(info).includes(cookie.split('=')[1]), false);
    assert.equal((await fetch(tv + '/api/dashboard', { headers: { Cookie: cookie } })).status, 403);
    assert.equal((await fetch(base + '/api/dashboard', { headers: { Origin: 'https://untrusted.example' } })).status, 403);
  } finally { abort.abort(); await stream?.body.cancel().catch(() => {}); await app.shutdown(); await new Promise(resolve => model.close(resolve)); }
});
