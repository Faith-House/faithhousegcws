import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createToolActivity } from '../tool-activity.mjs';
import { createJarvisServer } from '../server.mjs';

test('one lifecycle per attempt tracks duration and cannot turn interrupted work into success', async () => {
  let clock = 100, complete;
  const activity = createToolActivity({ now: () => clock });
  const context = { room: 'bedroom-1', requestId: 'request', question: 'PRIVATE', profileId: 'PRIVATE' };
  const pending = activity.track(context, 'search_web', () => new Promise(resolve => { complete = resolve; }));
  assert.equal(activity.list('bedroom-1')[0].status, 'running'); clock += 125;
  activity.endRequest('request', 'cancelled'); complete({ ok: true }); await pending;
  activity.event(context, 'search_web', 'completed');
  const list = activity.list('bedroom-1'); assert.equal(list.length, 1); assert.equal(list[0].status, 'cancelled'); assert.equal(list[0].durationMs, 125);
  assert.equal(JSON.stringify(list).includes('PRIVATE'), false); assert.deepEqual(activity.list('bedroom-2'), []);
  list[0].status = 'tampered'; assert.equal(activity.list('bedroom-1')[0].status, 'cancelled');
});

test('planner updates match their running attempt and completed entries are bounded', () => {
  const activity = createToolActivity({ limit: 3 });
  const context = { room: 'bedroom-1', requestId: 'r' };
  activity.event(context, 'start_timer', 'running'); activity.event(context, 'start_timer', 'completed');
  assert.equal(activity.list(context.room).length, 1);
  for (let n = 0; n < 6; n++) { const id = activity.start(context, 'get_time'); activity.finish(id); }
  assert.equal(activity.list(context.room).length, 3);
  const id = activity.start(context, 'candidate'); activity.finish(id, 'ignored');
  assert.equal(activity.list(context.room).some(e => e.tool === 'candidate'), false);
});

test('handler failure and missing details never become completed', async () => {
  const activity = createToolActivity(), context = { room: 'bedroom-1' };
  await activity.track(context, 'control_device', async () => ({ ok: false }));
  await activity.track(context, 'start_timer', async () => ({ needsInterpretation: true }));
  await assert.rejects(activity.track(context, 'search_web', async () => { throw Error('PRIVATE failure'); }));
  assert.deepEqual(activity.list(context.room).map(e => e.status), ['failed', 'waiting', 'failed']);
  assert.equal(JSON.stringify(activity.list(context.room)).includes('PRIVATE'), false);
});

test('server records direct commands, exposes running search and interruption, and isolates room results', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-activity-'));
  let started; const began = new Promise(resolve => { started = resolve; });
  const app = createJarvisServer({ displayBind: '', actionsOptions: { dataDirectory: directory }, pairingOptions: { directory }, speech: { listVoices: async () => ({ available: false }), close() {} }, webSearch: { status: () => ({ enabled: true }), answer: (_query, { signal }) => new Promise((resolve, reject) => { started(); signal.addEventListener('abort', () => reject(signal.reason), { once: true }); }) } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const list = room => fetch(base + '/api/activity?room=' + room).then(r => r.json());
  try {
    const request = await (await post('/api/ask', { room: 'bedroom-1', question: 'Search PRIVATE-QUERY' })).json(); await began;
    let entries = (await list('bedroom-1')).entries; assert.equal(entries.length, 1); assert.equal(entries[0].status, 'running'); assert.equal(entries[0].tool, 'search_web');
    await post('/api/cancel', { room: 'bedroom-1', requestId: request.requestId, interruption: true });
    assert.equal((await list('bedroom-1')).entries[0].status, 'cancelled');
    const abort = new AbortController(), events = await fetch(base + '/api/events?room=bedroom-1', { signal: abort.signal });
    const next = await (await post('/api/ask', { room: 'bedroom-1', question: 'What time is it?' })).json(); let buffer = '';
    try { outer: for await (const chunk of events.body) {
      buffer += new TextDecoder().decode(chunk); let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0) { const packet = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); if (!packet.startsWith('data: ')) continue; const state = JSON.parse(packet.slice(6)); if (state.requestId === next.requestId && ['ready', 'error'].includes(state.state)) break outer; }
    } } finally { abort.abort(); }
    entries = (await list('bedroom-1')).entries;
    assert.ok(entries.some(e => e.tool === 'get_time' && e.status === 'completed'));
    assert.equal(JSON.stringify(entries).includes('PRIVATE-QUERY'), false); assert.deepEqual((await list('bedroom-2')).entries, []);
    assert.equal((await fetch(base + '/api/activity?room=invalid')).status, 400);
    assert.equal((await fetch(base + '/api/activity?room=bedroom-1', { headers: { Origin: 'https://other.example' } })).status, 403);
    assert.equal((await fetch(base + '/activity')).status, 200);
  } finally { await app.shutdown(); }
});
