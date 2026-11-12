import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createDiagnostics, connectionChecks } from '../diagnostics.mjs';
import { createJarvisServer } from '../server.mjs';

test('checks distinguish installed, disconnected, unconfigured and unverified services without leaking credentials', async () => {
  const checks = connectionChecks({
    checkModel: async () => ({ available: true, modelInstalled: false, model: 'test' }),
    speech: { listVoices: async () => ({ available: true, voices: [{}] }) },
    recognition: { status: () => ({ available: false }) }, wakeword: { status: () => ({ available: true, listening: false }) }, speakerId: { status: () => ({ available: false }) },
    network: { check: async () => ({ connected: true, gatewayResponds: false }) },
    webSearch: { status: () => ({ enabled: true }), probe: async () => ({ ok: false }) },
    homeAssistant: { status: async () => ({ configured: false, token: 'private-secret' }) },
    calendar: { status: async () => ({ connected: true, refresh_token: 'private-secret' }) },
    pairing: { list: async () => ({ devices: [{ id: 'abc', address: 'private-secret' }] }) },
    displayStatus: () => ({ enabled: true, connectedIds: [] }), fetchImpl: async () => new Response('ok'),
  });
  const report = await createDiagnostics({ checks }).run(), byId = Object.fromEntries(report.items.map(i => [i.id, i]));
  assert.equal(byId.ai.status, 'error'); assert.match(byId.ai.fix, /test/);
  assert.equal(byId.recognition.status, 'error'); assert.equal(byId.speaker.status, 'setup');
  assert.equal(byId.wake.status, 'ok'); assert.match(byId.wake.detail, /off/);
  assert.equal(byId.network.status, 'warning'); assert.match(byId.network.fix, /block ping/);
  assert.equal(byId.home.status, 'setup'); assert.equal(byId.calendar.status, 'untested');
  assert.equal(byId.search.status, 'warning'); assert.equal(byId.internet.status, 'ok'); assert.equal(byId.tv.status, 'warning');
  assert.match(byId.tv.fix, /does not prove/); assert.equal(JSON.stringify(report).includes('private-secret'), false);
});

test('failed and hanging checks remain unknown; unconfigured services are not counted as broken', async () => {
  const diagnostics = createDiagnostics({ timeoutMs: 15, checks: [
    { id: 'hang', label: 'Hanging service', run: () => new Promise(() => {}) },
    { id: 'fail', label: 'Failed service', run: () => { throw Error('SECRET credential error'); } },
    { id: 'setup', label: 'Optional connection', run: () => ({ id: 'setup', label: 'Optional connection', status: 'setup' }) },
  ] });
  const report = await diagnostics.run();
  assert.equal(report.issues, 2); assert.equal(report.setup, 1);
  assert.equal(report.items[0].status, 'unknown'); assert.equal(report.items[1].status, 'unknown');
  assert.equal(JSON.stringify(report).includes('SECRET'), false);
});

test('concurrent runs share checks and cached results expire', async () => {
  let calls = 0, clock = 1000;
  const diagnostics = createDiagnostics({ now: () => clock, cacheMs: 100, checks: [{ id: 'service', label: 'Service', run: async () => { calls++; return { id: 'service', label: 'Service', status: 'ok' }; } }] });
  const [a, b] = await Promise.all([diagnostics.run(), diagnostics.run()]);
  assert.equal(a, b); assert.equal(calls, 1); await diagnostics.run(); assert.equal(calls, 1);
  clock += 101; await diagnostics.run(); assert.equal(calls, 2);
});

test('central diagnostics routes are read-only checks, same-origin, and available alongside the tool', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-diagnostics-'));
  let runs = 0;
  const app = createJarvisServer({ displayBind: '', actionsOptions: { dataDirectory: directory }, pairingOptions: { directory }, speech: { listVoices: async () => ({ available: false }), close() {} }, diagnosticsOptions: { checks: [{ id: 'test', label: 'Test service', run: async () => { runs++; return { id: 'test', label: 'Test service', status: 'ok', detail: 'Test answered' }; } }] } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const run = headers => fetch(base + '/api/diagnostics/run', { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: '{}' });
  try {
    for (const url of ['/diagnostics', '/diagnostics.js', '/diagnostics.css']) assert.equal((await fetch(base + url)).status, 200);
    assert.equal(runs, 0, 'Reading page assets must not run checks on the server');
    assert.equal((await run({ Origin: 'https://other.example' })).status, 403);
    assert.equal(runs, 0); const report = await (await run()).json(); assert.equal(report.items[0].detail, 'Test answered'); assert.equal(runs, 1);
    const controller = new AbortController();
    const events = await fetch(base + '/api/events?room=bedroom-1', { signal: controller.signal });
    const accepted = await (await fetch(base + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: 'bedroom-1', question: 'Please diagnose connections' }) })).json();
    let buffer = '', answer;
    try { outer: for await (const chunk of events.body) {
      buffer += new TextDecoder().decode(chunk); let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) {
        const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        if (!packet.startsWith('data: ')) continue;
        const state = JSON.parse(packet.slice(6));
        if (state.requestId === accepted.requestId && ['ready', 'error'].includes(state.state)) { answer = state; break outer; }
      }
    } } finally { controller.abort(); }
    assert.equal(answer.resultKind, 'diagnostics'); assert.match(answer.answer, /detailed checks/);
    const tools = await (await fetch(base + '/api/tools?room=bedroom-1')).json();
    assert.ok(tools.tools.some(tool => tool.name === 'diagnose_connections' && tool.readOnly));
  } finally { await app.shutdown(); }
});
