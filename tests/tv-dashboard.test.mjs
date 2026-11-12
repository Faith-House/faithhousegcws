import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createLocalActions } from '../local-actions.mjs';
import { createJarvisServer } from '../server.mjs';

test('dashboard voice commands are deliberate and support returning to the minimal view', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-view-command-'));
  const actions = createLocalActions({ rooms: ['bedroom-1'], dataDirectory: directory });
  try {
    for (const question of ['Show the dashboard', 'Jarvis, pull up the dashboard.', 'Can you show me the dashboard on the TV?', 'Bring up our house dashboard']) assert.equal((await actions.handle({ room: 'bedroom-1', question })).view, 'dashboard');
    for (const question of ['Back to Jarvis', 'Close the dashboard', 'Return to Jarvis', 'Show the rings']) assert.equal((await actions.handle({ room: 'bedroom-1', question })).view, 'minimal');
    assert.equal(await actions.handle({ room: 'bedroom-1', question: 'What does a dashboard do?' }), null);
  } finally { await actions.close(); }
});

test('a paired TV can read its prompted dashboard, retains the mode, and never gains central controls or another room’s data', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-tv-dashboard-'));
  const model = http.createServer((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ models: [{ name: 'test' }] })); });
  await new Promise(resolve => model.listen(0, '127.0.0.1', resolve));
  const app = createJarvisServer({ model: 'test', ollamaUrl: `http://127.0.0.1:${model.address().port}`, displayBind: '127.0.0.1', actionsOptions: { dataDirectory: directory }, pairingOptions: { directory }, speech: { listVoices: async () => ({ available: true }), close() {} } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => app.displayServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`, tv = `http://127.0.0.1:${app.displayServer.address().port}`;
  const post = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  async function ask(question, room = 'bedroom-1') {
    const abort = new AbortController();
    const source = await fetch(base + `/api/events?room=${room}`, { signal: abort.signal });
    const response = await post(base + '/api/ask', { room, question }); assert.equal(response.status, 202); const { requestId } = await response.json();
    let buffer = '';
    try {
      for await (const chunk of source.body) {
        buffer += new TextDecoder().decode(chunk); let end;
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
          if (!packet.startsWith('data: ')) continue;
          const snapshot = JSON.parse(packet.slice(6)); if (snapshot.requestId === requestId && ['ready', 'error'].includes(snapshot.state)) return snapshot;
        }
      }
    } finally { abort.abort(); }
    throw new Error('No answer');
  }
  try {
    assert.equal((await fetch(tv + '/api/dashboard')).status, 401);
    const code = await (await post(base + '/api/pairing/start', { room: 'bedroom-1' })).json();
    const paired = await post(tv + '/api/pair', { code: code.code, name: 'Scoped TV test' }); const cookie = paired.headers.get('set-cookie').split(';')[0];
    const get = endpoint => fetch(tv + endpoint, { headers: { Cookie: cookie } });
    assert.equal((await get('/api/dashboard')).status, 403);
    await ask('Set a timer for thirty seconds called own-room');
    await ask('Set a timer for thirty seconds called other-room', 'bedroom-2');
    const shown = await ask('Show the dashboard'); assert.equal(shown.view, 'dashboard'); assert.equal(shown.resultKind, 'view');
    const dashboardResponse = await get('/api/dashboard?room=bedroom-2'); assert.equal(dashboardResponse.status, 200);
    const dashboard = await dashboardResponse.json();
    assert.deepEqual(dashboard.rooms.map(room => room.id), ['bedroom-1']);
    assert.deepEqual(dashboard.timers.timers.map(timer => timer.label), ['own-room']);
    assert.deepEqual(dashboard.displays.devices.map(device => device.room), ['bedroom-1']);
    for (const profile of dashboard.profiles) assert.deepEqual(Object.keys(profile), ['name']);
    assert.equal(JSON.stringify(dashboard).includes('voiceEnrolled'), false);
    assert.equal(JSON.stringify(dashboard).includes('other-room'), false);
    assert.equal(JSON.stringify(dashboard).includes('embedding'), false);
    assert.equal((await ask('What time is it?')).view, 'dashboard');
    await post(base + '/api/cancel', { room: 'bedroom-1' }); assert.equal((await get('/api/dashboard')).status, 200);
    assert.equal((await fetch(tv + '/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ room: 'bedroom-1', question: 'Close the dashboard' }) })).status, 403);
    assert.equal((await get('/api/weather')).status, 403); assert.equal((await get('/weather-view.js')).status, 200); assert.equal((await get('/weather.css')).status, 200);
    assert.equal((await get('/api/chores')).status, 403); assert.equal((await get('/chores')).status, 403);
    assert.equal((await get('/api/activity?room=bedroom-1')).status, 403); assert.equal((await get('/activity')).status, 403);
    assert.equal((await get('/api/profiles')).status, 403); assert.equal((await get('/dashboard.js')).status, 403);
    const display = await get('/'); assert.match(display.headers.get('permissions-policy'), /microphone=\(\)/);
    assert.match(await display.text(), /tv-dashboard/);
    const closed = await ask('Back to Jarvis'); assert.equal(closed.view, 'minimal'); assert.equal((await get('/api/dashboard')).status, 403);
    assert.equal((await ask('Show the dashboard', 'bedroom-3')).view, 'dashboard', 'The central computer can show its dashboard without a paired TV.');
  } finally { await app.shutdown(); await new Promise(resolve => model.close(resolve)); }
});
