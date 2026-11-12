export function pcmWave(parts, sampleRate = 24000) {
  const pcm = Buffer.concat(parts), wave = Buffer.alloc(44 + pcm.length);
  wave.write('RIFF'); wave.writeUInt32LE(wave.length - 8, 4); wave.write('WAVEfmt ', 8);
  wave.writeUInt32LE(16, 16); wave.writeUInt16LE(1, 20); wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(sampleRate, 24); wave.writeUInt32LE(sampleRate * 2, 28);
  wave.writeUInt16LE(2, 32); wave.writeUInt16LE(16, 34); wave.write('data', 36); wave.writeUInt32LE(pcm.length, 40); pcm.copy(wave, 44);
  return wave;
}

export function nextSpeechSegment(text, final = false) {
  if (!text.trim()) return null;
  if (final && text.length <= 260) return { text: text.trim(), consumed: text.length };
  // Wait for punctuation followed by whitespace while tokens are still arriving.
  const boundaries = [...text.matchAll(/[.!?]["')\]]*\s+/g)];
  for (const boundary of boundaries) {
    const end = boundary.index + boundary[0].length;
    if (end < 25 || /\b(?:Mr|Mrs|Ms|Dr|Prof|St|e\.g|i\.e)\.\s+$/i.test(text.slice(0, end))) continue;
    if (end <= 280) return { text: text.slice(0, end).trim(), consumed: end };
    break;
  }
  if (text.length >= 240 || final) {
    const end = text.lastIndexOf(' ', Math.min(240, text.length));
    const used = end > 30 ? end + 1 : Math.min(text.length, 240);
    return { text: text.slice(0, used).trim(), consumed: used };
  }
  return null;
}

export async function streamReplySpeech({ response, requestId, voice, speech, snapshot, signal, keepAlive = () => {}, cache = () => {}, waitMs = 100 }) {
  const chunks = []; let consumed = 0, prefix = '', byteCount = 0;
  const send = data => {
    signal?.throwIfAborted();
    if (response.destroyed) throw new Error('Speech stream closed.');
    if (response.writableLength > 2 * 1024 * 1024) throw new Error('Audio connection is too slow.');
    response.write(JSON.stringify(data) + '\n');
  };
  response.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
  response.flushHeaders?.();
  send({ type: 'format', encoding: 'pcm-s16le', sampleRate: 24000, channels: 1 });
  try {
    while (true) {
      signal?.throwIfAborted();
      const current = snapshot();
      if (current.requestId !== requestId || !['answering', 'ready'].includes(current.state)) throw new Error('That reply was stopped or replaced.');
      const answer = current.answer || '';
      if (!answer.startsWith(prefix)) throw new Error('That reply changed while it was being spoken.');
      const segment = nextSpeechSegment(answer.slice(consumed), current.state === 'ready');
      if (!segment) {
        if (current.state === 'ready') break;
        await new Promise((resolve, reject) => {
          const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
          const timer = setTimeout(done, waitMs);
          const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(signal.reason); };
          signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted) abort();
        });
        continue;
      }
      keepAlive();
      let streamed = false;
      const onChunk = (pcm, sampleRate = 24000) => {
        if (sampleRate !== 24000 || pcm.length % 2) throw new Error('Unsupported streamed audio format.');
        if (snapshot().requestId !== requestId) throw new Error('Reply replaced.');
        byteCount += pcm.length; if (byteCount > 8 * 1024 * 1024) throw new Error('That spoken reply is too long.');
        streamed = true; chunks.push(pcm); keepAlive();
        send({ type: 'audio', pcm: pcm.toString('base64') });
      };
      const wave = await speech.synthesize({ text: segment.text, voice, signal, onChunk });
      if (!streamed) {
        if (wave.readUInt32LE(24) !== 24000 || wave.subarray(36, 40).toString() !== 'data') throw new Error('Unsupported audio format.');
        onChunk(wave.subarray(44));
      }
      consumed += segment.consumed; prefix = answer.slice(0, consumed);
    }
    const wave = pcmWave(chunks); cache(wave);
    keepAlive(Math.max(22000, Math.min(180000, byteCount / 48000 * 1000 + 12000)));
    send({ type: 'done' }); response.end();
  } catch (error) {
    if (!response.destroyed) { response.write(JSON.stringify({ type: 'error', error: signal?.aborted ? 'That spoken reply was stopped.' : error.message || 'The voice could not finish.' }) + '\n'); response.end(); }
  }
}
