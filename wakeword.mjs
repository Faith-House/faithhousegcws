import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_ROOT, MODEL_ROOT } from './voice-config.mjs';

const fail = (message, status = 503) => Object.assign(new Error(message), { status });
export function createWakeWordService({ idleMs = 30000, readyTimeoutMs = 15000, frameTimeoutMs = 5000 } = {}) {
  let child, lease, startup, pending, idleTimer;
  const installed = () => ['melspectrogram.onnx', 'embedding_model.onnx', 'hey_jarvis_v0.1.onnx'].every(name => existsSync(path.join(MODEL_ROOT, 'wakeword', name)));
  function finishFrame(error, result) {
    if (!pending) return;
    const job = pending; pending = null; clearTimeout(job.timer);
    if (error) job.reject(error); else job.resolve(result);
  }
  function stop(token) {
    if (token !== undefined && token !== lease?.token) return;
    lease = null; clearTimeout(idleTimer);
    const worker = child; child = null; worker?.kill();
    if (startup) { const job = startup; startup = null; clearTimeout(job.timer); job.reject(fail('Listening was stopped.', 409)); }
    finishFrame(fail('Listening was stopped.', 409));
  }
  function keepAlive() { clearTimeout(idleTimer); idleTimer = setTimeout(() => stop(), idleMs); idleTimer.unref(); }
  async function start(room) {
    if (!installed()) throw fail('Run SETUP-LISTENING.cmd to install Hey Jarvis detection.');
    if (lease) throw fail('Another Jarvis tab is listening. Stop listening there first.', 409);
    const token = randomBytes(24).toString('base64url');
    lease = { token, room }; keepAlive();
    child = fork(fileURLToPath(new URL('./wakeword-worker.mjs', import.meta.url)), [], { cwd: APP_ROOT, windowsHide: true, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    const worker = child; worker.stderr.resume();
    const ready = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { const job = startup; startup = null; stop(); job?.reject(fail('The wake-word detector took too long to start.')); }, readyTimeoutMs); timer.unref();
      startup = { resolve, reject, timer };
    });
    worker.on('message', message => {
      if (child !== worker) return;
      if (message.ready && startup) { const job = startup; startup = null; clearTimeout(job.timer); job.resolve(); return; }
      if (message.error) { const error = fail(message.error); if (startup) { const job = startup; startup = null; clearTimeout(job.timer); job.reject(error); } finishFrame(error); stop(); return; }
      if (pending && message.id === pending.id) finishFrame(null, { detected: message.detected, score: message.score });
    });
    const crashed = () => { if (child !== worker) return; stop(); };
    worker.on('error', crashed); worker.on('exit', crashed);
    await ready;
    if (lease?.token !== token) throw fail('Listening was stopped.', 409);
    keepAlive(); return { token, room, phrase: 'Hey Jarvis' };
  }
  function authorize(token) { return Boolean(lease && typeof token === 'string' && token === lease.token); }
  async function predict(token, pcm) {
    if (!authorize(token) || !child || startup) throw fail('This listening session has ended. Enable Hey Jarvis again.', 409);
    if (!Buffer.isBuffer(pcm) || pcm.length !== 2560) throw fail('Send one 80-millisecond PCM audio frame.', 400);
    if (pending) throw fail('The previous audio frame is still processing.', 429);
    keepAlive();
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const timer = setTimeout(() => { finishFrame(fail('Wake-word detection fell behind. Enable listening again.')); stop(); }, frameTimeoutMs); timer.unref();
      pending = { id, resolve, reject, timer };
      child.send({ id, pcm }, error => { if (error && pending?.id === id) { finishFrame(fail('Wake-word detection stopped.')); stop(); } });
    });
  }
  return { start, authorize, predict, stop, close: () => stop(), status: () => ({ available: installed(), phrase: 'Hey Jarvis', localOnly: true, engine: 'openwakeword-onnx-local', listening: Boolean(lease) }) };
}
