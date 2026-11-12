import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSpeakerIdentification, SPEAKER_MODEL, chooseSpeaker } from '../speaker-id.mjs';
import { meanEmbedding } from '../profiles.mjs';
import { decodeMicrophoneWave } from '../recognition.mjs';

test('real local speaker model matches new synthetic speech and rejects another synthetic voice', async t => {
  const model = createSpeakerIdentification();
  if (!model.status().available) { t.skip('Run SETUP-SPEAKER-ID.cmd to install the local model.'); return; }
  try {
    const embeddings = [];
    for (let i = 1; i <= 4; i++) embeddings.push((await model.embed({ audio: decodeMicrophoneWave(await readFile(new URL(`./fixtures/speaker-david-${i}.wav`, import.meta.url))) })).embedding);
    const profile = { id: 'synthetic-test-only', name: 'Synthetic test', voiceprint: { model: SPEAKER_MODEL, samples: 3, embedding: meanEmbedding(embeddings.slice(0, 3)) } };
    assert.equal(chooseSpeaker(embeddings[3], [profile]).profileId, 'synthetic-test-only');
    const other = await model.embed({ audio: decodeMicrophoneWave(await readFile(new URL('./fixtures/speaker-zira-test.wav', import.meta.url))) });
    assert.equal(chooseSpeaker(other.embedding, [profile]).status, 'unknown');
    assert.equal(chooseSpeaker(embeddings[3], [profile]).authorized, false);
  } finally { model.close(); }
});
