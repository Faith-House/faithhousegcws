import test from 'node:test';
import assert from 'node:assert/strict';
import { createNeuralSpeech } from '../neural-speech.mjs';
import { createPocketSpeech } from '../pocket-speech.mjs';
import { createLocalSpeech } from '../speech.mjs';

test('engine selection exposes installed voices and Kokoro cannot receive Pocket IDs', async () => {
  const kokoro = createNeuralSpeech(), pocket = createPocketSpeech(), combined = createLocalSpeech();
  try {
    const a = await kokoro.listVoices(), b = await pocket.listVoices(), both = await combined.listVoices();
    assert.equal(a.voices.some(voice => voice.name.startsWith('pocket_')), false);
    assert.equal(both.localOnly, true);
    assert.equal(new Set(both.voices.map(v => v.name)).size, both.voices.length);
    if (b.available) {
      assert.ok(both.voices.some(v => v.name === 'pocket_peter'));
      assert.ok(both.voices.some(v => v.name === 'pocket_charles'));
    }
    await assert.rejects(kokoro.synthesize({ text: 'Test.', voice: 'pocket_peter' }), /Choose an installed/);
    await assert.rejects(combined.synthesize({ text: 'Test.', voice: 'unknown' }), /Choose an installed/);
  } finally { kokoro.close(); pocket.close(); combined.close(); }
});
