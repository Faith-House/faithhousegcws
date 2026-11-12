import path from 'node:path';
import { MODEL_ROOT } from './voice-config.mjs';
let processor, model, busy = false;
process.on('message', async message => {
  if (!message?.id || busy) return;
  busy = true;
  const began = performance.now();
  try {
    if (!model) {
      const { env, AutoFeatureExtractor, AutoModel } = await import('@huggingface/transformers');
      env.allowRemoteModels = false; env.allowLocalModels = true; env.useBrowserCache = false;
      env.localModelPath = MODEL_ROOT + path.sep;
      globalThis.fetch = async () => { throw new Error('Speaker identification uses local files only.'); };
      processor = await AutoFeatureExtractor.from_pretrained('speaker', { local_files_only: true });
      model = await AutoModel.from_pretrained('speaker', { device: 'cpu', dtype: 'fp32', local_files_only: true, session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 } });
    }
    const inputs = await processor(new Float32Array(message.audio));
    const result = await model(inputs);
    const output = result.embeddings || result.last_hidden_state || result[Object.keys(result)[0]];
    const vector = Array.from(output?.data || []);
    if (vector.length !== 256 || !vector.every(Number.isFinite)) throw new Error('Invalid speaker embedding.');
    const norm = Math.sqrt(vector.reduce((n, value) => n + value * value, 0));
    if (norm < 1e-8) throw new Error('Empty speaker embedding.');
    process.send?.({ id: message.id, embedding: vector.map(value => value / norm), metrics: { processingMs: Math.round(performance.now() - began), memoryMB: Math.round(process.memoryUsage().rss / 1048576) } });
  } catch (error) {
    console.error(error.message);
    process.send?.({ id: message.id, error: 'The local speaker model could not run. Check SETUP-SPEAKER-ID.cmd.' });
  } finally { busy = false; }
});
process.on('disconnect', () => process.exit(0));
