import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createJarvisServer } from '../server.mjs';
import { createWakeWordService } from '../wakeword.mjs';
import { WakeAudioFrames, WakeWordListener } from '../public/wakeword.js';

test('streaming resampling preserves sample count across arbitrary 44.1/48 kHz chunks', () => {
  for (const rate of [16000, 44100, 48000]) {
    const result = [];
    const frames = new WakeAudioFrames(rate, bytes => result.push(bytes));
    const input = new Float32Array(rate * 2).fill(.5);
    for (let start = 0; start < input.length; start += 2048) frames.push(input.subarray(start, start + 2048));
    assert.equal(result.length, 25);
    for (const frame of result) {
      assert.equal(frame.byteLength, 2560);
      assert.equal(new DataView(frame).getInt16(100, true), 16384);
    }
  }
});

test('local wake routes enforce session, room, origin, size, and single-listener controls', async () => {
  const wakeword = createWakeWordService();
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-listening-test-'));
  const app = createJarvisServer({ wakeword, actionsOptions: { dataDirectory: directory }, pairingOptions: { directory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (endpoint, body, extra = {}) => fetch(base + endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', ...extra }, body: JSON.stringify(body) });
  const frame = (token, bytes = Buffer.alloc(2560), headers = {}) => fetch(base + '/api/listen/frame', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Jarvis-Listening': token, ...headers }, body: bytes });
  try {
    assert.equal((await post('/api/listen/start', { room: 'bad' })).status, 400);
    assert.equal((await post('/api/listen/start', { room: 'bedroom-1' }, { Origin: 'https://untrusted.example' })).status, 403);
    assert.equal((await fetch(base + '/wakeword-worker.mjs')).status, 404);
    assert.equal((await fetch(base + '/wakeword.js')).status, 200);
    assert.equal((await frame('invalid')).status, 409);
    if (!wakeword.status().available) return;
    const started = await post('/api/listen/start', { room: 'bedroom-1' });
    assert.equal(started.status, 200);
    const session = await started.json(); assert.equal(session.room, 'bedroom-1');
    assert.equal((await post('/api/listen/start', { room: 'bedroom-2' })).status, 409);
    assert.equal((await frame(session.token, Buffer.alloc(30))).status, 400);
    assert.equal((await frame(session.token, undefined, { 'Content-Type': 'audio/wav' })).status, 415);
    await post('/api/listen/stop', { token: 'a'.repeat(32) });
    assert.equal(wakeword.status().listening, true);
    assert.equal((await (await frame(session.token)).json()).detected, false);
    const source = await readFile(new URL('./fixtures/hey-jarvis-david.wav', import.meta.url));
    const padded = Buffer.concat([Buffer.alloc(32000), source.subarray(44), Buffer.alloc(32000)]);
    let detected = false;
    for (let at = 0; at + 2560 <= padded.length; at += 2560) {
      const result = await (await frame(session.token, padded.subarray(at, at + 2560))).json();
      if (result.detected) { detected = true; break; }
    }
    assert.equal(detected, true, 'The real local models should detect the recorded wake phrase.');
    await post('/api/listen/stop', { token: session.token });
    assert.equal(wakeword.status().listening, false);
    assert.equal((await frame(session.token)).status, 409);
  } finally { await app.shutdown(); }
});

test('late microphone permission cannot restart capture after Stop', async () => {
  const original = { window: globalThis.window, navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') };
  let resolvePermission, stopped = 0;
  globalThis.window = { isSecureContext: true, AudioWorkletNode: function () {} };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolvePermission = resolve; }) } } });
  const listener = new WakeWordListener();
  try {
    const enabling = listener.enable('bedroom-1', '');
    await new Promise(resolve => setImmediate(resolve));
    listener.disable();
    resolvePermission({ getTracks: () => [{ stop() { stopped++; } }] });
    await enabling;
    assert.equal(stopped, 1);
    assert.equal(listener.enabled, false);
    assert.equal(listener.state, 'off');
  } finally {
    listener.disable();
    if (original.window === undefined) delete globalThis.window; else globalThis.window = original.window;
    if (original.navigator) Object.defineProperty(globalThis, 'navigator', original.navigator); else delete globalThis.navigator;
  }
});

test('browser capture controller detects a real phrase, releases capture, and calls the question handler', async () => {
  const wakeword = createWakeWordService();
  if (!wakeword.status().available) return;
  const directory = await mkdtemp(path.join(tmpdir(), 'jarvis-wake-client-test-'));
  const app = createJarvisServer({ wakeword, actionsOptions: { dataDirectory: directory }, pairingOptions: { directory } });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const originals = Object.fromEntries(['window', 'navigator', 'AudioContext', 'AudioWorkletNode', 'fetch'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const nativeFetch = globalThis.fetch;
  let node, tracksStopped = 0, contextClosed = 0, wakes = 0;
  const track = { stop() { tracksStopped++; }, addEventListener() {} };
  const connection = () => ({ connect() {}, disconnect() {} });
  class Context {
    constructor() { this.sampleRate = 16000; this.state = 'running'; this.audioWorklet = { addModule: async () => {} }; }
    async resume() {}
    async close() { this.state = 'closed'; contextClosed++; }
    createMediaStreamSource() { return connection(); }
    createGain() { return { ...connection(), gain: { value: 1 } }; }
  }
  class Worklet { constructor() { node = this; this.port = {}; } connect() {} disconnect() {} }
  for (const [name, value] of Object.entries({ window: { isSecureContext: true, AudioWorkletNode: Worklet }, navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [track], getAudioTracks: () => [track] }) } }, AudioContext: Context, AudioWorkletNode: Worklet, fetch: (url, options) => nativeFetch(new URL(url, base), options) })) Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  const listener = new WakeWordListener(undefined, () => { wakes++; });
  try {
    await listener.enable('bedroom-1', ''); assert.equal(listener.state, 'listening');
    const wave = await readFile(new URL('./fixtures/hey-jarvis-zira.wav', import.meta.url));
    const padded = Buffer.concat([Buffer.alloc(32000), wave.subarray(44), Buffer.alloc(32000)]);
    for (let at = 0; at + 2560 <= padded.length && !wakes; at += 2560) {
      const samples = new Float32Array(1280);
      for (let i = 0; i < 1280; i++) samples[i] = padded.readInt16LE(at + i * 2) / 32768;
      node.port.onmessage({ data: samples });
      const deadline = Date.now() + 5000;
      while ((listener.inFlight || listener.queue.length) && listener.state === 'listening' && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 1));
      assert.ok(Date.now() < deadline, 'Audio processing should not stall.');
      await listener.cleanup;
    }
    assert.equal(wakes, 1);
    assert.equal(listener.state, 'paused');
    assert.equal(listener.enabled, true);
    assert.equal(tracksStopped, 1);
    assert.equal(contextClosed, 1);
    assert.equal(wakeword.status().listening, false);
    listener.disable(); await listener.cleanup;
    assert.equal(listener.enabled, false);
  } finally {
    listener.disable(); await listener.cleanup;
    for (const [name, descriptor] of Object.entries(originals)) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name]; }
    await app.shutdown();
  }
});
