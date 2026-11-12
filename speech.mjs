import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createNeuralSpeech } from './neural-speech.mjs';
import { createPocketSpeech } from './pocket-speech.mjs';

const workerPath = fileURLToPath(new URL('./local-speech.ps1', import.meta.url));

export function createLocalSpeech() {
  if (process.env.JARVIS_VOICE_ENGINE === 'windows') return createWindowsSpeech();
  const kokoro = createNeuralSpeech(), pocket = createPocketSpeech();
  let active, busy = false;
  async function listVoices() {
    const [a, b] = await Promise.all([kokoro.listVoices(), pocket.listVoices()]);
    const voices = [...(a.available ? a.voices : []), ...(b.available ? b.voices : [])];
    const preferred = process.env.JARVIS_SPEECH_VOICE;
    const defaultVoice = voices.find(v => v.name === preferred)?.name || (a.available ? a.defaultVoice : b.defaultVoice);
    return { available: voices.length > 0, voices, defaultVoice, engine: 'local-neural', localOnly: true, protocolVersion: 2, streamingVoices: b.available ? b.voices.map(v => v.name) : [] };
  }
  async function synthesize(options) {
    if (busy) throw Object.assign(new Error('The voice is preparing another reply.'), { status: 429 });
    busy = true;
    try {
      const info = await listVoices(), voice = options.voice || info.defaultVoice;
      if (!info.voices.some(v => v.name === voice)) throw Object.assign(new Error('Choose an installed local voice.'), { status: 400 });
      const engine = voice.startsWith('pocket_') ? pocket : kokoro;
      if (active && active !== engine) active.close(); active = engine;
      return await engine.synthesize({ ...options, voice });
    }
    finally { busy = false; }
  }
  async function warmup({ voice = 'pocket_peter' } = {}) {
    if (busy || !voice.startsWith('pocket_')) return;
    const info = await pocket.listVoices(); if (!info.available) return;
    if (active && active !== pocket) active.close(); active = pocket;
    return pocket.warmup({ voice });
  }
  return { listVoices, synthesize, warmup, close() { kokoro.close(); pocket.close(); }, get lastMetrics() { return active?.lastMetrics; } };
}

export function createWindowsSpeech({ executable = process.env.JARVIS_POWERSHELL || path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'), timeoutMs = 20000 } = {}) {
  let voicesPromise;
  let busy = false;
  const available = process.platform === 'win32' && existsSync(executable);
  const speechError = message => Object.assign(new Error(message), { status: 503 });

  function run(payload, signal) {
    if (!available) return Promise.reject(speechError('This local voice engine needs Windows with an installed speech voice.'));
    if (signal?.aborted) return Promise.reject(signal.reason || new Error('Speech cancelled.'));
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', workerPath], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      const chunks = [];
      let length = 0;
      let settled = false;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(value);
      };
      const abort = () => { child.kill(); finish(signal.reason || new Error('Speech cancelled.')); };
      const timer = setTimeout(() => { child.kill(); finish(speechError('Preparing the voice took too long. Please try again.')); }, timeoutMs);
      timer.unref();
      signal?.addEventListener('abort', abort, { once: true });
      child.stdout.on('data', chunk => {
        length += chunk.length;
        if (length > 8 * 1024 * 1024) { child.kill(); finish(speechError('This spoken reply was too long. Try a shorter answer.')); }
        else chunks.push(chunk);
      });
      child.stderr.resume();
      child.on('error', () => finish(speechError('The local Windows voice engine could not start.')));
      child.on('close', code => {
        if (code !== 0) return finish(speechError('The local voice could not be prepared. Check the selected voice and try again.'));
        try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, ''))); }
        catch { finish(speechError('The local voice engine returned an unreadable reply.')); }
      });
      child.stdin.on('error', () => {});
      child.stdin.end(JSON.stringify(payload));
    });
  }

  async function listVoices() {
    if (!available) return { available: false, voices: [], defaultVoice: '' };
    if (!voicesPromise) {
      voicesPromise = run({ mode: 'voices' }).then(result => {
        const voices = Array.isArray(result.voices) ? result.voices : [];
        const preferred = process.env.JARVIS_SPEECH_VOICE;
        const defaultVoice = voices.find(voice => voice.name === preferred)?.name || voices.find(voice => /David/i.test(voice.name))?.name || voices[0]?.name || '';
        return { available: voices.length > 0, voices, defaultVoice };
      }).catch(error => { voicesPromise = undefined; throw error; });
    }
    return voicesPromise;
  }

  async function synthesize({ text, voice, signal }) {
    const info = await listVoices();
    if (signal?.aborted) throw signal.reason || new Error('Speech cancelled.');
    if (!info.available) throw speechError('No local Windows voice is available.');
    const selected = voice || info.defaultVoice;
    if (!info.voices.some(item => item.name === selected)) throw Object.assign(new Error('Choose an installed local voice.'), { status: 400 });
    if (busy) throw Object.assign(new Error('The voice is preparing another reply. Try again in a moment.'), { status: 429 });
    if (typeof text !== 'string' || !text.trim() || text.length > 2400) throw Object.assign(new Error('This reply is too long for the prototype voice.'), { status: 400 });
    busy = true;
    try {
      const result = await run({ mode: 'speak', text, voice: selected }, signal);
      const audio = Buffer.from(result.audio || '', 'base64');
      if (audio.length < 44 || audio.subarray(0, 4).toString() !== 'RIFF' || audio.subarray(8, 12).toString() !== 'WAVE') {
        throw speechError('The local voice did not produce playable audio.');
      }
      return audio;
    } finally { busy = false; }
  }
  return { listVoices, synthesize };
}
