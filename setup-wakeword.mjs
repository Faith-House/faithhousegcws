import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_ROOT } from './voice-config.mjs';

const directory = path.join(MODEL_ROOT, 'wakeword');
const release = 'v0.5.1';
const names = ['melspectrogram.onnx', 'embedding_model.onnx', 'hey_jarvis_v0.1.onnx'];
const metadataResponse = await fetch(`https://api.github.com/repos/dscripka/openWakeWord/releases/tags/${release}`, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(30000) });
if (!metadataResponse.ok) throw new Error('Could not read the official wake-word model release.');
const metadata = await metadataResponse.json();
await mkdir(directory, { recursive: true });
const files = [];
for (const name of names) {
  const asset = metadata.assets.find(item => item.name === name);
  if (!asset || !asset.browser_download_url.startsWith(`https://github.com/dscripka/openWakeWord/releases/download/${release}/`)) throw new Error(`The official model release does not contain ${name}.`);
  const destination = path.join(directory, name);
  let data;
  try { data = await readFile(destination); } catch { /* Download missing files below. */ }
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const expectedHash = asset.digest?.startsWith('sha256:') ? asset.digest.slice(7) : null;
  if (!data || data.length !== asset.size || (expectedHash && hash(data) !== expectedHash)) {
    console.log(`Downloading ${name} (${Math.round(asset.size / 1024)} KB)…`);
    const response = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Could not download ${name}.`);
    data = Buffer.from(await response.arrayBuffer());
    if (data.length !== asset.size || (expectedHash && hash(data) !== expectedHash)) throw new Error(`Integrity check failed for ${name}.`);
    await writeFile(destination + '.part', data);
    await rename(destination + '.part', destination);
  }
  files.push({ name, bytes: data.length, sha256: hash(data), releaseAssetId: asset.id });
}
await writeFile(path.join(directory, 'jarvis-model-manifest.json'), JSON.stringify({ repository: 'dscripka/openWakeWord', release, files }, null, 2) + '\n');
console.log('Hey Jarvis models are ready. Wake-word detection will use local files only.');
