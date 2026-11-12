import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { mkdir, copyFile, unlink, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import path from 'node:path';
import { APP_ROOT, MODEL_ROOT } from './voice-config.mjs';
import { RECOGNITION_FILES } from './recognition.mjs';

const repository = 'onnx-community/whisper-tiny.en';
const destination = path.join(MODEL_ROOT, 'whisper');
const temporaryRoot = path.resolve(APP_ROOT, '..', '..', 'work', 'recognition-downloads');
await mkdir(destination, { recursive: true });
await mkdir(temporaryRoot, { recursive: true });
const response = await fetch(`https://huggingface.co/api/models/${repository}?blobs=true`);
if (!response.ok) throw new Error('Could not read the official recognition model metadata.');
const metadata = await response.json();
const revision = metadata.sha;
if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('The model revision could not be verified.');
async function hashFile(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
const manifest = { repository, revision, dtype: 'q8', license: 'MIT', files: [] };
for (const filename of RECOGNITION_FILES) {
  const remote = metadata.siblings.find(item => item.rfilename === filename);
  if (!remote) throw new Error(`Missing model file: ${filename}`);
  const target = path.resolve(destination, filename);
  if (!target.startsWith(destination + path.sep)) throw new Error('Invalid destination.');
  const expectedHash = remote.lfs?.sha256;
  const reusable = existsSync(target) && (await stat(target)).size === remote.size && (!expectedHash || await hashFile(target) === expectedHash);
  if (!reusable) {
    console.log(`Downloading ${filename}…`);
    const download = await fetch(`https://huggingface.co/${repository}/resolve/${revision}/${filename}`);
    if (!download.ok || !download.body) throw new Error(`Could not download ${filename}.`);
    const temporary = path.join(temporaryRoot, filename.replaceAll('/', '_') + '.part');
    await pipeline(Readable.fromWeb(download.body), createWriteStream(temporary));
    if ((await stat(temporary)).size !== remote.size || (expectedHash && await hashFile(temporary) !== expectedHash)) throw new Error(`Model verification failed: ${filename}`);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(temporary, target);
    await unlink(temporary);
  }
  manifest.files.push({ path: filename, bytes: (await stat(target)).size, sha256: await hashFile(target) });
}
await writeFile(path.join(destination, 'jarvis-model-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Local English speech recognition is ready. Recordings will not be sent to an outside service.');
