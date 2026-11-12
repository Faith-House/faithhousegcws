import path from 'node:path';
import { MODEL_ROOT } from './voice-config.mjs';

let modelPromise;
let busy = false;
async function loadModel() {
  if (!modelPromise) modelPromise = (async () => {
    const { env, StyleTextToSpeech2Model, AutoTokenizer } = await import('@huggingface/transformers');
    const { KokoroTTS } = await import('kokoro-js');
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    env.localModelPath = MODEL_ROOT + path.sep;
    env.useBrowserCache = false;
    globalThis.fetch = async () => { throw new Error('The speech worker uses local files only.'); };
    const [model, tokenizer] = await Promise.all([
      StyleTextToSpeech2Model.from_pretrained('kokoro', {
        dtype: 'q8', device: 'cpu', local_files_only: true,
        session_options: { intraOpNumThreads: Math.max(1, Math.min(4, Number(process.env.JARVIS_SPEECH_THREADS) || 4)), interOpNumThreads: 1 },
      }),
      AutoTokenizer.from_pretrained('kokoro', { local_files_only: true }),
    ]);
    return new KokoroTTS(model, tokenizer);
  })();
  return modelPromise;
}

function chunksForSpeech(text) {
  const sentences = Array.from(new Intl.Segmenter('en', { granularity: 'sentence' }).segment(text), part => part.segment.trim()).filter(Boolean);
  const chunks = [];
  let current = '';
  for (const sentence of sentences) {
    for (const word of sentence.split(/\s+/)) {
      if ((current + ' ' + word).length > 230 && current) { chunks.push(current); current = ''; }
      current += (current ? ' ' : '') + word;
    }
    if (current.length >= 90) { chunks.push(current); current = ''; }
  }
  if (current) chunks.push(current);
  return chunks;
}

function encodeWave(parts) {
  const sampleCount = parts.reduce((sum, part) => sum + part.length, 0);
  const wave = Buffer.alloc(44 + sampleCount * 2);
  wave.write('RIFF', 0); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(24000, 24); wave.writeUInt32LE(48000, 28); wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34);
  wave.write('data', 36); wave.writeUInt32LE(sampleCount * 2, 40);
  let offset = 44;
  for (const part of parts) for (const sample of part) {
    const value = Math.max(-1, Math.min(1, sample));
    wave.writeInt16LE(Math.round(value < 0 ? value * 32768 : value * 32767), offset);
    offset += 2;
  }
  return wave;
}

process.on('message', async message => {
  if (!message || message.type !== 'speak') return;
  if (busy) return process.send?.({ id: message.id, error: 'The voice is busy.' });
  busy = true;
  const began = performance.now();
  try {
    const tts = await loadModel();
    const audioParts = [];
    for (const chunk of chunksForSpeech(message.text)) {
      const audio = await tts.generate(chunk, { voice: message.voice, speed: 0.98 });
      audioParts.push(audio.audio);
    }
    const wave = encodeWave(audioParts);
    process.send?.({ id: message.id, audio: wave, metrics: { generationMs: Math.round(performance.now() - began), durationSeconds: (wave.length - 44) / 48000, workerMemoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024) } });
  } catch {
    process.send?.({ id: message.id, error: 'The local neural voice could not be prepared. Check the model files and try again.' });
  } finally { busy = false; }
});
process.on('disconnect', () => process.exit(0));
