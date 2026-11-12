import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { APP_ROOT, MODEL_ROOT, NEURAL_VOICES, DEFAULT_NEURAL_VOICE } from './voice-config.mjs';

const workerPath = fileURLToPath(new URL('./neural-speech-worker.mjs', import.meta.url));
export function createNeuralSpeech({ timeoutMs = 60000, idleMs = 90000 } = {}) {
  const voices = NEURAL_VOICES.filter(voice => !voice.name.startsWith('pocket_'));
  let worker;
  let pending;
  let idleTimer;
  let lastMetrics;
  const installed = () => existsSync(path.join(APP_ROOT, 'node_modules', 'kokoro-js', 'package.json')) && ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'].every(filename => existsSync(path.join(MODEL_ROOT, 'kokoro', filename)));
  const fail = (message, status = 503) => Object.assign(new Error(message), { status });

  function stopWorker() {
    clearTimeout(idleTimer);
    const previous = worker;
    worker = null;
    if (previous && !previous.killed) previous.kill();
  }
  function finish(error, audio, metrics) {
    if (!pending) return;
    const job = pending;
    pending = null;
    clearTimeout(job.timer);
    job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error); else { lastMetrics = metrics; job.resolve(audio); }
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stopWorker, idleMs);
    idleTimer.unref();
  }
  function ensureWorker() {
    if (worker && !worker.killed) return;
    worker = fork(workerPath, [], { cwd: APP_ROOT, execArgv: [], windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], serialization: 'advanced' });
    const child = worker;
    child.stderr.resume();
    child.on('message', message => {
      if (worker !== child || !pending || message.id !== pending.id) return;
      if (message.error) return finish(fail(message.error));
      const audio = Buffer.from(message.audio || []);
      if (audio.length < 44 || audio.subarray(0, 4).toString() !== 'RIFF') return finish(fail('The neural voice did not produce playable audio.'));
      finish(null, audio, message.metrics);
    });
    child.on('error', () => { if (worker === child) { worker = null; finish(fail('The local neural voice could not start.')); } });
    child.on('exit', () => { if (worker === child) { worker = null; finish(fail('The local neural voice stopped. Try again.')); } });
  }
  async function listVoices() {
    const configured = process.env.JARVIS_SPEECH_VOICE;
    const defaultVoice = voices.some(voice => voice.name === configured) ? configured : DEFAULT_NEURAL_VOICE;
    return { available: installed(), voices, defaultVoice, engine: 'kokoro-local', localOnly: true };
  }
  async function synthesize({ text, voice, signal }) {
    if (!installed()) throw fail('The neural voice needs its local model files. Run the voice setup, then try again.');
    if (typeof text !== 'string' || !text.trim() || text.length > 2400) throw fail('This reply is too long for the prototype voice.', 400);
    const selected = voice || (await listVoices()).defaultVoice;
    if (!voices.some(item => item.name === selected)) throw fail('Choose an installed local voice.', 400);
    if (signal?.aborted) throw signal.reason || fail('Speech cancelled.', 409);
    if (pending) throw fail('The voice is preparing another reply. Try again in a moment.', 429);
    clearTimeout(idleTimer);
    ensureWorker();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => { stopWorker(); finish(signal.reason || fail('Speech cancelled.', 409)); };
      const timer = setTimeout(() => { stopWorker(); finish(fail('The neural voice took too long. Try a shorter answer.')); }, timeoutMs);
      timer.unref();
      pending = { id, resolve, reject, timer, signal, abort };
      signal?.addEventListener('abort', abort, { once: true });
      worker.send({ id, type: 'speak', text, voice: selected }, error => { if (error && pending?.id === id) finish(fail('The neural voice could not receive this reply.')); });
    });
  }
  function close() { stopWorker(); finish(fail('The voice service stopped.', 409)); clearTimeout(idleTimer); }
  return { listVoices, synthesize, close, get lastMetrics() { return lastMetrics; } };
}
