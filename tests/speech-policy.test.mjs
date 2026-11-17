import test from 'node:test';
import assert from 'node:assert/strict';
import { firstSpokenSentence, spokenReplyText } from '../speech-policy.mjs';
import { streamReplySpeech, pcmWave } from '../speech-stream.mjs';

test('brief narration preserves the screen answer and full reads, coding, clarifications and action failures stay complete', () => {
  const snapshot = { question: 'Explain this', answer: 'This is the short answer. Here is additional detail.' };
  assert.equal(spokenReplyText(snapshot, { concise: true }), 'This is the short answer.');
  assert.equal(snapshot.answer, 'This is the short answer. Here is additional detail.');
  assert.equal(spokenReplyText(snapshot, { concise: true, full: true }), snapshot.answer);
  assert.equal(spokenReplyText(snapshot, { concise: false }), snapshot.answer);
  for (const resultKind of ['clarification', 'tool-agent', 'workbench', 'weather', 'undo']) assert.equal(spokenReplyText({ ...snapshot, resultKind }, { concise: true }), snapshot.answer);
  assert.equal(spokenReplyText({ ...snapshot, modelMode: 'coding' }, { concise: true }), snapshot.answer);
  assert.equal(spokenReplyText({ ...snapshot, question: 'Read the full answer aloud' }, { concise: true }), snapshot.answer);
});
test('brief narration waits for a completed sentence and keeps initials, decimals and titles intact', () => {
  assert.equal(firstSpokenSentence('An incomplete thought', false), null);
  assert.equal(firstSpokenSentence('Hello.', false), null);
  assert.equal(firstSpokenSentence('Dr. Smith needs 3.5 litres. More detail.', true).text, 'Dr. Smith needs 3.5 litres.');
  assert.equal(firstSpokenSentence('J. Smith is ready. More detail.', true).text, 'J. Smith is ready.');
  assert.equal(firstSpokenSentence('Sure. Still explaining', false), null);
  assert.equal(firstSpokenSentence('Sure. The answer is four. More detail.', true).text, 'Sure. The answer is four.');
});
test('brief streaming speaks one completed sentence while the rest of the answer is still generating', async () => {
  const heard = [], packets = [], lifetimes = [], snapshot = { requestId: 'one', state: 'answering', question: 'Explain this', answer: 'A short answer. Further detail is still coming' };
  await streamReplySpeech({ requestId: 'one', voice: 'voicebox_jarvis', concise: true, snapshot: () => snapshot,
    keepAlive: (delay = 300000) => lifetimes.push(delay),
    response: { destroyed: false, writableLength: 0, writeHead() {}, write(line) { packets.push(JSON.parse(line)); }, end() {} },
    speech: { async synthesize({ text }) { heard.push(text); return pcmWave([Buffer.alloc(4800)]); } } });
  assert.deepEqual(heard, ['A short answer.']);
  assert.equal(snapshot.state, 'answering');
  assert.equal(packets.at(-1).type, 'done');
  assert.ok(lifetimes.at(-1) >= 60000, 'fast audio must not expire the screen while its text is still generating');
});
