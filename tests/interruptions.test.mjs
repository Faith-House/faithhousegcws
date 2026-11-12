import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CaptureHandoff, PlaybackWakeGate, stripWakePhrase, isStopReply, wakeShouldPause } from '../public/interruptions.js';
import { LocalMicrophone } from '../public/microphone.js';
import { WakeWordEngine } from '../wakeword-engine.mjs';

test('playback needs consecutive strong wake scores; idle remains sensitive', () => {
  const gate = new PlaybackWakeGate();
  const score = n => ({ score: n, detected: n >= .5 });
  for (const n of [.6, .9, .2, .95]) assert.equal(gate.accept(score(n), true), false);
  assert.equal(gate.accept(score(.96), true), true);
  assert.equal(gate.accept(score(.55), false), true);
  gate.accept(score(.99), true); gate.reset();
  assert.equal(gate.accept(score(.99), true), false);
});

test('stop speech phrases do not swallow other household commands', () => {
  for (const phrase of ['Hey Jarvis, stop.', 'Okay Jarvis, stop talking please', 'Jarvis, be quiet']) assert.equal(isStopReply(stripWakePhrase(phrase)), true);
  for (const phrase of ['stop the pasta timer', 'stop listening', 'stop the TV', 'what time is it']) assert.equal(isStopReply(phrase), false);
  const state = { micState: 'idle', submitting: false, draftOpen: false, busy: true, speechState: 'playing', interruptions: true };
  assert.equal(wakeShouldPause(state), false);
  for (const patch of [{ interruptions: false }, { micState: 'recording' }, { draftOpen: true }, { submitting: true }]) assert.equal(wakeShouldPause({ ...state, ...patch }), true);
});

function graph() {
  const counts = { stopped: 0, closed: 0 };
  const track = { stop() { counts.stopped++; }, addEventListener() {} };
  const connection = () => ({ disconnect() {}, connect() {} });
  return { counts, stream: { getTracks: () => [track], getAudioTracks: () => [track] }, context: { sampleRate: 16000, state: 'running', async close() { this.state = 'closed'; counts.closed++; } }, source: connection(), node: { ...connection(), port: {} }, gain: { ...connection(), gain: { value: 0 } }, sampleRate: 16000 };
}

test('microphone adopts buffered wake audio without reopening or losing ownership', async () => {
  const descriptors = Object.fromEntries(['window', 'navigator'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { isSecureContext: true, AudioWorkletNode: function() {} } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia() { throw new Error('Must reuse capture'); } } } });
  const audio = graph(), handoff = new CaptureHandoff(audio, [new Float32Array(8000).fill(.1)]);
  let transcript, bytes;
  const microphone = new LocalMicrophone(() => {}, text => { transcript = text; });
  try {
    await microphone.start('bedroom-1', '', { capture: handoff, processAudio: async wave => { bytes = wave.size; return { text: 'Hey Jarvis, stop' }; } });
    await handoff.release();
    assert.equal(audio.counts.stopped, 0); assert.equal(microphone.samples, 8000);
    assert.throws(() => handoff.claim(), /expired/);
    await microphone.finish();
    assert.equal(transcript, 'Hey Jarvis, stop'); assert.equal(bytes, 16044);
    assert.equal(audio.counts.stopped, 1); assert.equal(audio.counts.closed, 1);
  } finally {
    microphone.cancel();
    for (const [key, descriptor] of Object.entries(descriptors)) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  }
});

test('unclaimed handoff bounds its buffer and releases an abandoned microphone', async () => {
  const audio = graph(), capture = new CaptureHandoff(audio, [], { maxMs: 100, timeoutMs: 15 });
  for (let n = 0; n < 10; n++) audio.node.port.onmessage({ data: new Float32Array(800) });
  assert.equal(capture.samples, 1600);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(audio.counts.stopped, 1); assert.equal(audio.counts.closed, 1);
  assert.throws(() => capture.claim(), /expired/);
});

test('stricter playback gate still accepts the recorded wake phrase with local models', async () => {
  const engine = new WakeWordEngine(), gate = new PlaybackWakeGate();
  const wav = await readFile(new URL('./fixtures/hey-jarvis-david.wav', import.meta.url));
  const padded = Buffer.concat([Buffer.alloc(32000), wav.subarray(44), Buffer.alloc(32000)]);
  let detected = false;
  try {
    for (let at = 0; at + 2560 <= padded.length; at += 2560) {
      const pcm = Float32Array.from({ length: 1280 }, (_, i) => padded.readInt16LE(at + i * 2));
      if (gate.accept(await engine.predict(pcm), true)) { detected = true; break; }
    }
    assert.equal(detected, true);
  } finally { await engine.close(); }
});
