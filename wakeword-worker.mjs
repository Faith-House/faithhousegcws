import { WakeWordEngine } from './wakeword-engine.mjs';
globalThis.fetch = async () => { throw new Error('Wake-word detection uses local files only.'); };
const engine = new WakeWordEngine({ threshold: Number(process.env.JARVIS_WAKE_THRESHOLD) || 0.5 });
let busy = false;
try { await engine.initialize(); process.send?.({ ready: true }); }
catch { process.send?.({ error: 'The wake-word models could not load. Run SETUP-LISTENING.cmd.' }); }
process.on('message', async message => {
  if (busy || !message?.id) return;
  busy = true;
  try {
    const bytes = Buffer.from(message.pcm);
    const pcm = new Int16Array(1280);
    for (let i = 0; i < pcm.length; i++) pcm[i] = bytes.readInt16LE(i * 2);
    process.send?.({ id: message.id, ...await engine.predict(pcm) });
  } catch { process.send?.({ id: message.id, error: 'The local wake-word detector stopped. Turn listening off and on to retry.' }); }
  finally { busy = false; }
});
process.on('disconnect', () => process.exit(0));
