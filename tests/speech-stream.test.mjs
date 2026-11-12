import test from 'node:test';
import assert from 'node:assert/strict';
import { nextSpeechSegment, pcmWave, streamReplySpeech } from '../speech-stream.mjs';
function sink() {
  const packets = [];
  return { packets, destroyed: false, writableLength: 0, writeHead(code, headers) { this.status = code; this.headers = headers; }, flushHeaders() {}, write(line) { packets.push(JSON.parse(line)); }, end() { this.ended = true; } };
}
test('sentence boundaries allow early speech without sending unfinished text or abbreviations alone', () => {
  assert.equal(nextSpeechSegment('This is an unfinished sentence'), null);
  assert.equal(nextSpeechSegment('Hi. A longer unfinished thought'), null);
  const text = 'This is a complete first sentence. Another thought';
  assert.equal(nextSpeechSegment(text).text, 'This is a complete first sentence.');
  assert.equal(nextSpeechSegment('Dr. Smith will arrive soon. Next thought').text, 'Dr. Smith will arrive soon.');
  assert.equal(nextSpeechSegment('All done.', true).text, 'All done.');
});
test('chunks leave while text generation is unfinished, then the exact remainder is spoken once', async () => {
  const response = sink(), heard = [], pcm = Buffer.alloc(4800);
  let current = { requestId: 'one', state: 'answering', answer: 'This is a complete first sentence. Another' }, cached;
  const speech = { async synthesize({ text, onChunk }) {
    heard.push(text); onChunk(pcm, 24000);
    if (heard.length === 1) {
      assert.equal(current.state, 'answering');
      assert.ok(response.packets.some(packet => packet.type === 'audio'));
      current = { ...current, state: 'ready', answer: 'This is a complete first sentence. Another complete sentence.' };
    }
    return pcmWave([pcm]);
  } };
  await streamReplySpeech({ response, requestId: 'one', voice: 'pocket_peter', speech, snapshot: () => current, cache: wave => { cached = wave; } });
  assert.deepEqual(heard, ['This is a complete first sentence.', 'Another complete sentence.']);
  assert.equal(response.packets.filter(p => p.type === 'audio').length, 2);
  assert.equal(response.packets.at(-1).type, 'done');
  assert.equal(cached.length, 44 + pcm.length * 2);
});
test('a replaced request stops remaining speech and does not cache a partial replay', async () => {
  const response = sink(), pcm = Buffer.alloc(480);
  let current = { requestId: 'one', state: 'ready', answer: ('This is a complete first sentence. ').repeat(12) }, calls = 0, cached = false;
  await streamReplySpeech({ response, requestId: 'one', voice: 'pocket_peter', snapshot: () => current, cache: () => { cached = true; }, speech: { async synthesize({ onChunk }) { calls++; onChunk(pcm, 24000); current = { requestId: 'two', state: 'thinking' }; return pcmWave([pcm]); } } });
  assert.equal(calls, 1); assert.equal(cached, false);
  assert.equal(response.packets.at(-1).type, 'error');
});
test('abort while waiting for text ends the stream without preparing speech', async () => {
  const response = sink(), controller = new AbortController();
  const running = streamReplySpeech({ response, requestId: 'one', voice: 'pocket_peter', snapshot: () => ({ requestId: 'one', state: 'answering', answer: 'Still thinking' }), signal: controller.signal, speech: { synthesize() { assert.fail('Must not prepare unfinished text'); } } });
  controller.abort(new Error('Stopped'));
  await running;
  assert.equal(response.packets.at(-1).type, 'error'); assert.equal(response.ended, true);
});
