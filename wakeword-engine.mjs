import path from 'node:path';
import * as ort from 'onnxruntime-node';
import { MODEL_ROOT } from './voice-config.mjs';

export class WakeWordEngine {
  constructor({ directory = path.join(MODEL_ROOT, 'wakeword'), threshold = 0.5 } = {}) {
    this.directory = directory;
    this.threshold = threshold;
    this.reset();
  }
  reset() {
    this.tail = new Float32Array(480);
    this.melHistory = new Float32Array(76 * 32).fill(1);
    this.embeddings = new Float32Array(16 * 96);
    this.frames = 0;
  }
  async initialize() {
    if (this.mel) return;
    const options = { executionProviders: ['cpu'], intraOpNumThreads: 1, interOpNumThreads: 1 };
    this.mel = await ort.InferenceSession.create(path.join(this.directory, 'melspectrogram.onnx'), options);
    this.embed = await ort.InferenceSession.create(path.join(this.directory, 'embedding_model.onnx'), options);
    this.keyword = await ort.InferenceSession.create(path.join(this.directory, 'hey_jarvis_v0.1.onnx'), options);
  }
  async predict(pcm) {
    if (pcm.length !== 1280) throw new Error('Wake-word frames must contain 1280 PCM samples.');
    await this.initialize();
    const began = performance.now();
    const samples = new Float32Array(1760);
    samples.set(this.tail); samples.set(pcm, 480);
    this.tail.set(samples.subarray(samples.length - 480));
    const melResult = await this.mel.run({ [this.mel.inputNames[0]]: new ort.Tensor('float32', samples, [1, samples.length]) });
    const melValues = melResult[this.mel.outputNames[0]].data;
    const count = melValues.length;
    if (count % 32 || count > this.melHistory.length) throw new Error('Unexpected wake-word audio features.');
    this.melHistory.copyWithin(0, count);
    for (let i = 0; i < count; i++) this.melHistory[this.melHistory.length - count + i] = melValues[i] / 10 + 2;
    const embeddingResult = await this.embed.run({ [this.embed.inputNames[0]]: new ort.Tensor('float32', this.melHistory, [1, 76, 32, 1]) });
    const features = embeddingResult[this.embed.outputNames[0]].data;
    if (features.length !== 96) throw new Error('Unexpected wake-word embedding.');
    this.embeddings.copyWithin(0, 96); this.embeddings.set(features, this.embeddings.length - 96);
    const result = await this.keyword.run({ [this.keyword.inputNames[0]]: new ort.Tensor('float32', this.embeddings, [1, 16, 96]) });
    this.frames++;
    const score = this.frames <= 5 ? 0 : Number(result[this.keyword.outputNames[0]].data[0]);
    return { score, detected: score >= this.threshold, inferenceMs: performance.now() - began };
  }
  async close() {
    await Promise.all([this.mel, this.embed, this.keyword].filter(Boolean).map(session => session.release()));
    this.mel = this.embed = this.keyword = null;
  }
}
