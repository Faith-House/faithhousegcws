import path from 'node:path';
import { MODEL_ROOT } from './voice-config.mjs';

let transcriber;
let busy = false;
process.on('message', async message => {
  if (!message?.id || busy) return;
  busy = true;
  const began = performance.now();
  try {
    if (!transcriber) {
      const { env, pipeline } = await import('@huggingface/transformers');
      env.allowRemoteModels = false;
      env.allowLocalModels = true;
      env.useBrowserCache = false;
      env.localModelPath = MODEL_ROOT + path.sep;
      globalThis.fetch = async () => { throw new Error('Speech recognition uses local files only.'); };
      transcriber = await pipeline('automatic-speech-recognition', 'whisper', { dtype: 'q8', device: 'cpu', local_files_only: true, session_options: { intraOpNumThreads: 4, interOpNumThreads: 1 } });
    }
    const audio = new Float32Array(message.audio);
    const result = await transcriber(audio, { max_new_tokens: 128, do_sample: false, return_timestamps: false });
    process.send?.({ id: message.id, text: result.text, metrics: { transcriptionMs: Math.round(performance.now() - began), durationSeconds: audio.length / 16000, workerMemoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024) } });
  } catch (error) {
    console.error(error.message);
    process.send?.({ id: message.id, error: 'The local recognition model could not run. Check SETUP-MICROPHONE.cmd and try again.' });
  } finally { busy = false; }
});
process.on('disconnect', () => process.exit(0));
