import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp } from 'node:fs/promises';
import { createJarvisServer } from '../server.mjs';
import { pcmWave } from '../speech-stream.mjs';

test('speech API separates brief narration from a full read without changing the visible answer', async () => {
  const answer = 'Wind moves because air pressure differs. Warmer air rises and cooler air moves in.';
  const model = http.createServer(async (request, response) => {
    for await (const _ of request) {}
    response.setHeader('Content-Type', 'application/x-ndjson');
    response.end(JSON.stringify(request.url === '/api/chat' ? { message: { content: answer }, done: true } : { models: [{ name: 'test-model' }] }) + '\n');
  });
  await new Promise(r => model.listen(0, '127.0.0.1', r));
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-speech-api-')), heard = [];
  const app = createJarvisServer({ model: 'test-model', ollamaUrl: 'http://127.0.0.1:' + model.address().port, displayBind: '', phoneBind: '',
    actionsOptions: { dataDirectory: directory }, pairingOptions: { directory },
    speech: { listVoices: async () => ({ available: true, voices: [{ name: 'voicebox_jarvis' }], defaultVoice: 'voicebox_jarvis' }),
      voicebox: { performance: async () => ({ conciseSpeech: true }), status: async () => ({ revision: 'test-voice' }) },
      synthesize: async ({ text }) => { heard.push(text); return pcmWave([Buffer.alloc(4800)]); }, close() {} } });
  await new Promise(r => app.server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + app.server.address().port;
  const post = (endpoint, body) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const controller = new AbortController();
  try {
    const accepted = await (await post('/api/ask', { room: 'living-room', question: 'Explain why wind moves.' })).json();
    const events = await fetch(base + '/api/events?room=living-room', { signal: controller.signal });
    let buffer = '', ready;
    for await (const chunk of events.body) {
      buffer += Buffer.from(chunk).toString();
      for (const event of buffer.split('\n\n')) if (event.startsWith('data: ')) {
        const state = JSON.parse(event.slice(6));
        if (state.requestId === accepted.requestId && state.state === 'ready') ready = state;
      }
      if (ready) break;
    }
    assert.equal(ready.answer, answer);
    const body = { room: 'living-room', requestId: accepted.requestId, voice: 'voicebox_jarvis' };
    assert.equal((await post('/api/speech', body)).status, 200);
    assert.equal(heard.at(-1), 'Wind moves because air pressure differs.');
    assert.equal((await post('/api/speech', { ...body, full: true })).status, 200);
    assert.equal(heard.at(-1), answer);
    const previous = heard.length;
    assert.equal((await post('/api/speech', body)).status, 200);
    assert.equal(heard.length, previous, 'request replay reuses the correct brief audio');
    assert.equal((await post('/api/speech', { ...body, full: 'yes' })).status, 400);
  } finally { controller.abort(); await app.shutdown(); await new Promise(r => model.close(r)); }
});
