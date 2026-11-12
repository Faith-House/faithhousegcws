import { createWriteStream, createReadStream, existsSync } from 'node:fs';
import { mkdir, copyFile, unlink, readFile, writeFile, stat } from 'node:fs/promises';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appRoot = fileURLToPath(new URL('.', import.meta.url));
const modelRoot = path.join(appRoot, 'models', 'kokoro');
const temporaryRoot = path.resolve(appRoot, '..', '..', 'work', 'neural-voice-downloads');
const repository = 'onnx-community/Kokoro-82M-v1.0-ONNX';
const files = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model_quantized.onnx'];
await mkdir(modelRoot, { recursive: true });
await mkdir(temporaryRoot, { recursive: true });
const metadataResponse = await fetch(`https://huggingface.co/api/models/${repository}?blobs=true`);
if (!metadataResponse.ok) throw new Error('Could not read the official voice model metadata.');
const metadata = await metadataResponse.json();
const revision = metadata.sha;
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('The model revision could not be verified.');
const manifest = { repository, revision, dtype: 'q8', license: 'Apache-2.0', files: [] };
async function hashFile(filename) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
for (const filename of files) {
  const target = path.resolve(modelRoot, filename);
  const relative = path.relative(modelRoot, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid model destination.');
  const remote = metadata.siblings.find(item => item.rfilename === filename);
  if (!remote) throw new Error(`Required model file is missing: ${filename}`);
  const expectedHash = remote.lfs?.sha256;
  let reusable = false;
  if (existsSync(target)) {
    const info = await stat(target);
    reusable = remote.size === info.size && (!expectedHash || await hashFile(target) === expectedHash);
  }
  if (!reusable) {
    console.log(`Downloading ${filename}${remote.size ? ` (${Math.round(remote.size / 1024 / 1024)} MB)` : ''}…`);
    const response = await fetch(`https://huggingface.co/${repository}/resolve/${revision}/${filename}`);
    if (!response.ok || !response.body) throw new Error(`Could not download ${filename}.`);
    const temporary = path.join(temporaryRoot, filename.replaceAll('/', '_') + '.part');
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    const actualHash = await hashFile(temporary);
    const info = await stat(temporary);
    if ((expectedHash && actualHash !== expectedHash) || (remote.size && remote.size !== info.size)) {
      throw new Error(`The downloaded file did not pass its integrity check: ${filename}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(temporary, target);
    await unlink(temporary);
  }
  manifest.files.push({ path: filename, sha256: await hashFile(target), bytes: (await stat(target)).size });
}
await writeFile(path.join(modelRoot, 'jarvis-model-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('The neural voice model is downloaded and verified. Runtime speech generation will use local files only.');
