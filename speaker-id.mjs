import { fork } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { APP_ROOT, MODEL_ROOT } from './voice-config.mjs';
export const SPEAKER_MODEL = 'wespeaker-resnet34-LM:6a61a1833ff2583aabeba044f5c8221f00b67ceb';
const fail = (message, status = 503) => Object.assign(new Error(message), { status });
export const cosine = (a, b) => a.reduce((sum, value, index) => sum + value * b[index], 0);
export function checkSpeakerAudio(audio, enrolling = false) {
  let active = 0, clipped = 0;
  for (let at = 0; at < audio.length; at += 320) {
    const frame = audio.subarray(at, Math.min(audio.length, at + 320));
    let energy = 0;
    for (const value of frame) { energy += value * value; if (Math.abs(value) > .995) clipped++; }
    if (Math.sqrt(energy / frame.length) > .008) active += frame.length;
  }
  if (active < (enrolling ? 1.5 : .6) * 16000) throw fail('Use more clear speech and less silence, then record again.', 422);
  if (clipped / audio.length > .01) throw fail('The microphone is clipping. Lower its level or move back, then record again.', 422);
}
export function chooseSpeaker(embedding, profiles, { threshold = .75, margin = .12 } = {}) {
  const ranked = profiles.filter(profile => profile.voiceprint?.model === SPEAKER_MODEL && profile.voiceprint.samples === 3).map(profile => ({ id: profile.id, name: profile.name, score: cosine(embedding, profile.voiceprint.embedding) })).sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return { profileId: null, name: null, status: 'unknown', reason: 'no-enrollments', authorized: false };
  if (best.score < threshold || (ranked[1] && best.score - ranked[1].score < margin)) return { profileId: null, name: null, status: 'unknown', reason: best.score < threshold ? 'low-match' : 'ambiguous', authorized: false };
  return { profileId: best.id, name: best.name, status: 'matched', score: Math.round(best.score * 1000) / 1000, authorized: false };
}
export function createSpeakerIdentification({ timeoutMs = 45000 } = {}) {
  let child, pending;
  const installed = () => ['config.json', 'preprocessor_config.json', 'onnx/model.onnx'].every(name => existsSync(path.join(MODEL_ROOT, 'speaker', name)));
  function close() {
    const worker = child; child = null; worker?.kill();
    if (pending) finish(fail('Speaker processing stopped.', 409));
  }
  function finish(error, result) {
    if (!pending) return;
    const job = pending; pending = null; clearTimeout(job.timer); job.signal?.removeEventListener('abort', job.abort);
    if (error) job.reject(error); else job.resolve(result);
  }
  async function embed({ audio, signal }) {
    if (!installed()) throw fail('Run SETUP-SPEAKER-ID.cmd to install the local speaker model.');
    if (signal?.aborted) throw fail('Speaker processing cancelled.', 409);
    if (pending) throw fail('Speaker processing is busy. Try again in a moment.', 429);
    if (!(audio instanceof Float32Array) || audio.length < 24000 || audio.length > 320000) throw fail('Use 1.5 to 20 seconds of clear speech.', 422);
    if (!child) {
      child = fork(fileURLToPath(new URL('./speaker-worker.mjs', import.meta.url)), [], { cwd: APP_ROOT, windowsHide: true, execArgv: [], serialization: 'advanced', stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
      const worker = child; worker.stderr.resume();
      worker.on('message', message => {
        if (child !== worker || pending?.id !== message.id) return;
        if (message.error) { finish(fail(message.error)); close(); return; }
        if (!Array.isArray(message.embedding) || message.embedding.length !== 256 || !message.embedding.every(Number.isFinite)) { finish(fail('Speaker processing produced invalid data.')); close(); return; }
        finish(null, { embedding: message.embedding, metrics: message.metrics });
      });
      worker.on('error', () => { if (child === worker) close(); }); worker.on('exit', () => { if (child === worker) close(); });
    }
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const abort = () => close();
      const timer = setTimeout(() => { finish(fail('Speaker processing took too long. Try a shorter sample.')); close(); }, timeoutMs); timer.unref();
      pending = { id, resolve, reject, signal, abort, timer };
      signal?.addEventListener('abort', abort, { once: true });
      child.send({ id, audio }, error => { if (error && pending?.id === id) { finish(fail('Speaker processing could not receive audio.')); close(); } });
    });
  }
  return { embed, close, status: () => ({ available: installed(), localOnly: true, model: SPEAKER_MODEL, identityAuthorization: false }) };
}
