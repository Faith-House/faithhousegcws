import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJarvisServer } from '../server.mjs';

test('audio levels reach only their paired room; the TV cannot send commands or levels', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-visual-test-'));
  const app = createJarvisServer({ displayBind: '127.0.0.1', actionsOptions: { dataDirectory: directory }, pairingOptions: { directory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  await new Promise(resolve => app.displayServer.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`, tv = `http://127.0.0.1:${app.displayServer.address().port}`;
  const post = (url, body, origin) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) }, body: JSON.stringify(body) });
  const abort = new AbortController(); const packets = [];
  let reader;
  try {
    const code = await (await post(base + '/api/pairing/start', { room: 'bedroom-1' })).json();
    const pairing = await post(tv + '/api/pair', { code: code.code, name: 'Synthetic test display' });
    const cookie = pairing.headers.get('set-cookie').split(';')[0];
    const stream = await fetch(tv + '/api/events', { headers: { Cookie: cookie }, signal: abort.signal });
    reader = (async () => {
      let buffer = '';
      try {
        for await (const chunk of stream.body) {
          buffer += new TextDecoder().decode(chunk); let end;
          while ((end = buffer.indexOf('\n\n')) >= 0) {
            const packet = buffer.slice(0, end); buffer = buffer.slice(end + 2);
            if (packet.startsWith('event: visual\ndata: ')) packets.push(JSON.parse(packet.slice('event: visual\ndata: '.length)));
          }
        }
      } catch (error) { if (!abort.signal.aborted) throw error; }
    })();
    assert.equal((await post(base + '/api/visual', { room: 'bedroom-1', state: 'listening', level: 2 })).status, 400);
    assert.equal((await post(base + '/api/visual', { room: 'bedroom-1', state: 'record', level: .5 })).status, 400);
    assert.equal((await post(base + '/api/visual', { room: 'bedroom-1', state: 'listening', level: .5 }, 'https://untrusted.example')).status, 403);
    assert.equal((await post(base + '/api/visual', { room: 'bedroom-2', state: 'listening', level: .9 })).status, 200);
    await new Promise(resolve => setTimeout(resolve, 30)); assert.equal(packets.length, 0);
    await post(base + '/api/visual', { room: 'bedroom-1', state: 'speaking', level: .64 });
    for (let i = 0; i < 30 && !packets.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(packets[0], { state: 'speaking', level: .64 });
    await post(base + '/api/visual', { room: 'bedroom-1', state: null, level: .5 });
    for (let i = 0; i < 30 && packets.length < 2; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.deepEqual(packets[1], { state: null, level: 0 });
    assert.equal((await fetch(tv + '/api/visual', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ room: 'bedroom-1', state: 'speaking', level: 1 }) })).status, 403);
  } finally { abort.abort(); await reader; await app.shutdown(); }
});
