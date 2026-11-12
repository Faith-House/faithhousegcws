import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, MODEL_ROOT } from './voice-config.mjs';

export const RECOGNITION_FILES = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
export const MAX_AUDIO_SECONDS = 20;
export const MAX_AUDIO_BYTES = 44 + MAX_AUDIO_SECONDS * 16000 * 2;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

// The browser sends a deliberately small, canonical PCM wave; other formats are rejected.
export function decodeMicrophoneWave(wave) {
  if (!Buffer.isBuffer(wave) || wave.length < 44 || wave.length > MAX_AUDIO_BYTES || wave.toString('ascii', 0, 4) !== 'RIFF' || wave.toString('ascii', 8, 16) !== 'WAVEfmt ' || wave.toString('ascii', 36, 40) !== 'data' || wave.readUInt32LE(4) !== wave.length - 8 || wave.readUInt32LE(16) !== 16 || wave.readUInt16LE(20) !== 1 || wave.readUInt16LE(22) !== 1 || wave.readUInt32LE(24) !== 16000 || wave.readUInt32LE(28) !== 32000 || wave.readUInt16LE(32) !== 2 || wave.readUInt16LE(34) !== 16 || wave.readUInt32LE(40) !== wave.length - 44 || (wave.length - 44) % 2) {
    throw fail('Please record up to 20 seconds of mono microphone audio.');
  }
  const count = (wave.length - 44) / 2;
  if (count < 4000) throw fail('The recording was too short. Try speaking a complete question.');
  const audio = new Float32Array(count);
  let energy = 0;
  let peak = 0;
  for (let i = 0; i < count; i++) {
    const sample = wave.readInt16LE(44 + i * 2) / 32768;
    audio[i] = sample;
    energy += sample * sample;
    peak = Math.max(peak, Math.abs(sample));
  }
  if (Math.sqrt(energy / count) < 0.0015 || peak < 0.008) throw fail('I did not hear speech. Check your microphone and try again.', 422);
  return audio;
}

export function createLocalRecognition({ timeoutMs = 60000, idleMs = 30000 } = {}) {
  let worker;
  let pending;
  let idleTimer;
  let lastMetrics;
  const installed = () => RECOGNITION_FILES.every(file => existsSync(path.join(MODEL_ROOT, 'whisper', file)));
  function stop() {
    clearTimeout(idleTimer);
    const child = worker;
    worker = null;
    child?.kill();
  }
  function finish(error, text, metrics) {
    if (!pending) return;
    const job = pending;
    pending = null;
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error); else { lastMetrics = metrics; job.resolve({ text, metrics }); }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, idleMs);
    idleTimer.unref();
  }
  function ensureWorker() {
    if (worker && !worker.killed) return;
    worker = fork(fileURLToPath(new URL('./recognition-worker.mjs', import.meta.url)), [], { cwd: APP_ROOT, execArgv: [], windowsHide: true, serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const child = worker;
    child.stderr.resume();
    child.on('message', message => {
      if (worker !== child || !pending || message.id !== pending.id) return;
      if (message.error) { stop(); return finish(fail(message.error, 503)); }
      const text = String(message.text || '').trim();
      if (!text || /^\[(?:blank_audio|silence|music|applause)\]$/i.test(text)) return finish(fail('I could not make out a question. Try again a little closer to the microphone.', 422));
      finish(null, text.slice(0, 600), message.metrics);
    });
    child.on('error', () => { if (worker === child) { worker = null; finish(fail('Local speech recognition could not start.', 503)); } });
    child.on('exit', () => { if (worker === child) { worker = null; finish(fail('Speech recognition stopped. Please try again.', 503)); } });
  }
  async function transcribe({ audio, signal }) {
    if (!installed()) throw fail('Run SETUP-MICROPHONE.cmd to download the local speech recognition model.', 503);
    if (signal?.aborted) throw signal.reason || fail('Recording cancelled.', 409);
    if (pending) throw fail('Jarvis is already transcribing. Try again in a moment.', 429);
    clearTimeout(idleTimer);
    ensureWorker();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => { stop(); finish(fail('Recording cancelled.', 409)); };
      const timer = setTimeout(() => { stop(); finish(fail('Speech recognition took too long. Try a shorter question.', 503)); }, timeoutMs);
      timer.unref();
      pending = { id, resolve, reject, signal, abort, timer };
      signal?.addEventListener('abort', abort, { once: true });
      worker.send({ id, audio }, error => { if (error && pending?.id === id) { stop(); finish(fail('Speech recognition could not receive the recording.', 503)); } });
    });
  }
  function close() { stop(); finish(fail('Speech recognition stopped.', 409)); clearTimeout(idleTimer); }
  return { transcribe, close, status: () => ({ available: installed(), engine: 'whisper-tiny.en-local', localOnly: true, maxSeconds: MAX_AUDIO_SECONDS, language: 'en' }), get lastMetrics() { return lastMetrics; } };
}
