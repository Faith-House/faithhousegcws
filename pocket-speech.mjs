import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { APP_ROOT, POCKET_VOICES } from './voice-config.mjs';
import { pcmWave } from './speech-stream.mjs';
export function createPocketSpeech({ timeoutMs = 120000, idleMs = Math.max(90000, Math.min(1800000, Number(process.env.JARVIS_VOICE_IDLE_MS) || 300000)) } = {}) {
  const python = path.join(APP_ROOT, '.pocket-venv', process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python');
  let worker, pending, idleTimer, lastMetrics, warming;
  const failure = (message, status = 503) => Object.assign(new Error(message), { status });
  const installed = () => existsSync(python) && existsSync(path.join(APP_ROOT, 'models/pocket/jarvis-pocket-manifest.json'));
  function stop() { clearTimeout(idleTimer); const child = worker; worker = null; child?.kill(); }
  function finish(error, value) {
    if (!pending) return;
    const job = pending; pending = null; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error); else { lastMetrics = value.metrics; job.resolve(value.audio); }
    clearTimeout(idleTimer); idleTimer = setTimeout(stop, idleMs); idleTimer.unref();
  }
  function start() {
    if (worker) return;
    const child = spawn(python, ['-u', path.join(APP_ROOT, 'pocket-speech-worker.py')], { cwd: APP_ROOT, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    worker = child;
    child.stderr.resume();
    let bytes = 0;
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) { stop(); finish(failure('That spoken reply was too long.')); } });
    const lines = createInterface({ input: child.stdout });
    lines.on('line', line => {
      bytes = 0; if (worker !== child || !pending) return;
      try {
        const data = JSON.parse(line); if (data.id !== pending.id) return;
        if (data.error) return finish(failure(data.error));
        if (data.type === 'chunk') {
          const pcm = Buffer.from(data.audio || '', 'base64');
          if (data.sampleRate !== 24000 || !pcm.length || pcm.length % 2) throw new Error();
          pending.byteCount += pcm.length;
          if (pending.byteCount > 8 * 1024 * 1024) { stop(); return finish(failure('That spoken reply was too long.')); }
          pending.parts.push(pcm); pending.onChunk?.(pcm, data.sampleRate); return;
        }
        if (data.type === 'done') {
          if (pending.op === 'warmup') return finish(null, { audio: null, metrics: data.metrics });
          if (!pending.parts.length) throw new Error();
          return finish(null, { audio: pcmWave(pending.parts), metrics: { ...data.metrics, durationSeconds: pending.byteCount / 48000 } });
        }
        const audio = Buffer.from(data.audio || '', 'base64');
        if (audio.length < 44 || audio.subarray(0, 4).toString() !== 'RIFF' || audio.subarray(8, 12).toString() !== 'WAVE') throw new Error();
        finish(null, { audio, metrics: data.metrics });
      } catch { stop(); finish(failure('Pocket voice returned an invalid audio reply.')); }
    });
    child.on('error', () => { if (worker === child) { worker = null; finish(failure('Pocket voice could not start.')); } });
    child.on('exit', () => { if (worker === child) { worker = null; finish(failure('Pocket voice stopped before finishing.')); } });
    child.stdin.on('error', () => {});
  }
  async function listVoices() { return { available: installed(), voices: installed() ? POCKET_VOICES : [], defaultVoice: 'pocket_peter', engine: 'pocket-local', localOnly: true }; }
  async function dispatch({ text, voice = 'pocket_peter', signal, onChunk, op = 'speak' }) {
    if (!installed()) throw failure('Pocket voice needs its local setup files.');
    if (!POCKET_VOICES.some(item => item.name === voice) || (op !== 'warmup' && (typeof text !== 'string' || !text.trim() || text.length > 2400))) throw failure('Choose a Pocket voice and a short reply.', 400);
    if (pending) throw failure('The voice is preparing another reply.', 429);
    signal?.throwIfAborted(); clearTimeout(idleTimer); start();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => { stop(); finish(signal.reason || failure('Speech cancelled.', 409)); };
      const timer = setTimeout(() => { stop(); finish(failure('Pocket voice took too long. Try a shorter reply.')); }, timeoutMs); timer.unref();
      pending = { id, resolve, reject, signal, abort, timer, op, onChunk, parts: [], byteCount: 0 }; signal?.addEventListener('abort', abort, { once: true });
      worker.stdin.write(JSON.stringify({ id, voice, text, op, stream: Boolean(onChunk) }) + '\n', error => { if (error && pending?.id === id) finish(failure('Pocket voice could not receive the reply.')); });
    });
  }
  async function synthesize(options) { if (warming) await warming; return dispatch(options); }
  function warmup({ voice = 'pocket_peter', signal } = {}) {
    if (!warming && !pending) warming = dispatch({ voice, signal, op: 'warmup' }).finally(() => { warming = null; });
    return warming || Promise.resolve();
  }
  function close() { stop(); finish(failure('The voice service stopped.', 409)); clearTimeout(idleTimer); }
  return { listVoices, synthesize, warmup, close, get lastMetrics() { return lastMetrics; } };
}
