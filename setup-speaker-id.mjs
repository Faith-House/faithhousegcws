import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { MODEL_ROOT } from './voice-config.mjs';
const repository = 'onnx-community/wespeaker-voxceleb-resnet34-LM';
const revision = '6a61a1833ff2583aabeba044f5c8221f00b67ceb';
const names = ['config.json', 'preprocessor_config.json', 'onnx/model.onnx'];
const destination = path.join(MODEL_ROOT, 'speaker');
const response = await fetch(`https://huggingface.co/api/models/${repository}/revision/${revision}?blobs=true`, { signal: AbortSignal.timeout(30000) });
if (!response.ok) throw new Error('Could not read the official speaker model metadata.');
const metadata = await response.json();
if (metadata.sha !== revision) throw new Error('The speaker model revision did not match.');
const hash = data => createHash('sha256').update(data).digest('hex');
const files = [];
for (const name of names) {
  const remote = metadata.siblings.find(item => item.rfilename === name);
  if (!remote) throw new Error(`Missing speaker model file: ${name}`);
  const target = path.join(destination, name);
  let data;
  try { data = await readFile(target); } catch { /* Download missing files. */ }
  if (!data || data.length !== remote.size || (remote.lfs?.sha256 && hash(data) !== remote.lfs.sha256)) {
    console.log(`Downloading ${name}…`);
    const download = await fetch(`https://huggingface.co/${repository}/resolve/${revision}/${name}`, { signal: AbortSignal.timeout(90000) });
    if (!download.ok) throw new Error(`Could not download ${name}.`);
    data = Buffer.from(await download.arrayBuffer());
    if (data.length !== remote.size || (remote.lfs?.sha256 && hash(data) !== remote.lfs.sha256)) throw new Error(`Speaker model verification failed: ${name}`);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target + '.part', data); await rename(target + '.part', target);
  }
  files.push({ path: name, bytes: data.length, sha256: hash(data) });
}
await writeFile(path.join(destination, 'jarvis-model-manifest.json'), JSON.stringify({ repository, revision, license: 'CC-BY-4.0', files }, null, 2) + '\n');
console.log('Local speaker identification model is ready. Each roommate still needs to enroll their own voice.');
