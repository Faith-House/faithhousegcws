import { LocalSpeech } from './speech.js';

export function createPhoneSpeech({ audio, notice, onState = () => {} }) {
  let catalog, sequence = 0;
  const speech = new LocalSpeech(audio, (state, message) => {
    notice.hidden = !['preparing', 'blocked', 'error'].includes(state);
    notice.textContent = state === 'preparing' ? 'Preparing local voice…' : message;
    if (state === 'idle' && speech.objectUrl) { audio.src = speech.objectUrl; audio.hidden = false; }
    onState(state);
  });
  async function load() {
    const response = await fetch('/api/voices', { cache: 'no-store' });
    if (!response.ok) throw Error('The local voice is unavailable.');
    catalog = await response.json();
    if (catalog.available) speech.warm({ voice: catalog.voice });
    return catalog;
  }
  async function hear({ requestId, full = false }) {
    const turn = ++sequence;
    try {
      if (!catalog) await load();
      if (turn !== sequence) return;
      if (!catalog.available) throw Error('The local voice is unavailable.');
      await speech.speak({ requestId, voice: catalog.voice, full });
    } catch (error) { notice.hidden = false; notice.textContent = error.message; }
  }
  return { load, hear, stop: () => { sequence++; speech.stop(); }, get state() { return speech.state; }, get streaming() { return catalog?.streaming === true; } };
}
