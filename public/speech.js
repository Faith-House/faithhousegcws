function streamedWave(parts, rate) {
  const length = parts.reduce((sum, part) => sum + part.length, 0), header = new ArrayBuffer(44), view = new DataView(header);
  const text = (at, value) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)); };
  text(0, 'RIFF'); view.setUint32(4, length + 36, true); text(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, length, true);
  return new Blob([header, ...parts], { type: 'audio/wav' });
}
class PCMPlayback {
  constructor(context, analyser, onState) { this.context = context; this.analyser = analyser; this.onState = onState; this.sources = new Set(); this.nextTime = 0; this.done = false; this.cancelled = false; this.blocked = context?.state !== 'running'; }
  push(bytes, rate) {
    if (this.cancelled || this.blocked) return;
    const buffer = this.context.createBuffer(1, bytes.length / 2, rate), samples = buffer.getChannelData(0), data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let i = 0; i < samples.length; i++) samples[i] = data.getInt16(i * 2, true) / 32768;
    const source = this.context.createBufferSource(); source.buffer = buffer;
    source.connect(this.context.destination); if (this.analyser) source.connect(this.analyser);
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); source.disconnect(); if (!this.cancelled && !this.sources.size) this.onState(this.done ? 'idle' : 'preparing'); };
    const start = Math.max(this.context.currentTime + (this.nextTime ? 0.015 : 0.16), this.nextTime);
    this.nextTime = start + buffer.duration; source.start(start); this.onState('playing');
  }
  finish() { this.done = true; if (!this.sources.size && !this.cancelled) this.onState(this.blocked ? 'blocked' : 'idle'); }
  stop() { this.cancelled = true; for (const source of this.sources) { source.onended = null; try { source.stop(); } catch {} source.disconnect(); } this.sources.clear(); }
}

export class LocalSpeech {
  constructor(audio, onState) {
    this.audio = audio;
    this.onState = onState;
    this.state = 'idle';
    this.message = '';
    this.sequence = 0;
    this.objectUrl = null;
    this.key = null;
    this.controller = null;
    audio.addEventListener('playing', () => { if (!this.streamingActive) this.setState('playing'); });
    audio.addEventListener('ended', () => { if (!this.streamingActive) this.setState('idle'); });
    audio.addEventListener('error', () => {
      if (!this.streamingActive && this.state !== 'idle') this.setState('error', 'The spoken reply could not play. You can still read the answer.');
    });
  }
  setState(state, message = '') {
    this.state = state;
    this.message = message;
    this.onState?.(state, message);
  }
  async enableAnalysis() {
    if (this.analysisPending) return this.analysisPending;
    this.analysisPending = (async () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        this.analysisContext ||= new AudioContextClass();
        await this.analysisContext.resume();
        if (this.analysisContext.state !== 'running' || this.analyser) return;
        const analyser = this.analysisContext.createAnalyser(); analyser.fftSize = 1024;
        const source = this.analysisContext.createMediaElementSource(this.audio);
        source.connect(this.analysisContext.destination);
        source.connect(analyser);
        this.audioSource = source; this.analyser = analyser;
        this.samples = new Float32Array(analyser.fftSize);
      } catch { /* Keep audio playback working when analysis is unavailable. */ }
    })().finally(() => { this.analysisPending = null; });
    return this.analysisPending;
  }
  getLevel() {
    if (this.state !== 'playing' || !this.analyser || this.analysisContext.state !== 'running') return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let energy = 0; for (const sample of this.samples) energy += sample * sample;
    return Math.min(1, Math.sqrt(energy / this.samples.length) * 6);
  }
  destroy() {
    this.stop(); this.audioSource?.disconnect(); this.analyser?.disconnect();
    void this.analysisContext?.close().catch(() => {});
  }
  stop() {
    this.sequence++;
    this.controller?.abort();
    this.controller = null;
    this.pcmPlayback?.stop(); this.pcmPlayback = null; this.streamingActive = false;
    this.setState('idle');
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load();
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = null;
    this.key = null;
  }
  async playPrepared(sequence = this.sequence) {
    this.pcmPlayback?.stop(); this.streamingActive = false;
    if (this.objectUrl && this.audio.src !== this.objectUrl) this.audio.src = this.objectUrl;
    try {
      await this.audio.play();
      if (sequence === this.sequence) this.setState('playing');
    } catch (error) {
      if (sequence !== this.sequence) return;
      if (error.name === 'NotAllowedError') this.setState('blocked', 'Select Hear reply to allow audio in this browser.');
      else this.setState('error', 'The spoken reply could not play. You can still read the answer.');
    }
  }
  async speak({ room, requestId, voice, test = false }) {
    const key = JSON.stringify([room, requestId, voice, test]);
    if (this.key === key && this.objectUrl) {
      this.audio.currentTime = 0;
      return this.playPrepared();
    }
    this.stop();
    const sequence = this.sequence;
    const controller = new AbortController();
    this.controller = controller;
    this.setState('preparing');
    try {
      if (!test && voice?.startsWith('pocket_') && (window.AudioContext || window.webkitAudioContext)) {
        await this.speakStream({ room, requestId, voice, sequence, controller, key }); return;
      }
      const response = await fetch(test ? '/api/speech-test' : '/api/speech', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ room, requestId, voice }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const problem = await response.json();
        throw new Error(problem.error || 'The local voice could not be prepared.');
      }
      const blob = await response.blob();
      if (sequence !== this.sequence || controller.signal.aborted) return;
      this.objectUrl = URL.createObjectURL(blob);
      this.key = key;
      this.audio.src = this.objectUrl;
      await this.playPrepared(sequence);
    } catch (error) {
      if (sequence === this.sequence && !controller.signal.aborted) this.setState('error', error.message || 'The local voice could not be prepared.');
    } finally { if (sequence === this.sequence) this.controller = null; }
  }
  async speakStream({ room, requestId, voice, sequence, controller, key }) {
    await this.enableAnalysis();
    if (sequence !== this.sequence || controller.signal.aborted) return;
    this.streamingActive = true;
    const parts = []; let rate = 24000, complete = false, byteCount = 0;
    const playback = this.pcmPlayback = new PCMPlayback(this.analysisContext, this.analyser, state => {
      if (sequence !== this.sequence) return;
      if (state === 'blocked') this.setState('blocked', 'Select Hear reply to allow audio in this browser.');
      else this.setState(state);
    });
    const response = await fetch('/api/speech-stream', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room, requestId, voice }), signal: controller.signal });
    if (!response.ok) { const problem = await response.json(); throw new Error(problem.error || 'The streamed voice could not start.'); }
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '';
    const packet = line => {
      if (!line.trim() || sequence !== this.sequence || controller.signal.aborted) return;
      const data = JSON.parse(line);
      if (data.type === 'error') throw new Error(data.error);
      if (data.type === 'format') { if (data.encoding !== 'pcm-s16le' || data.sampleRate !== 24000 || data.channels !== 1) throw new Error('Unsupported voice stream.'); rate = data.sampleRate; }
      if (data.type === 'audio') {
        const bytes = Uint8Array.from(atob(data.pcm), char => char.charCodeAt(0)); byteCount += bytes.length;
        if (bytes.length % 2 || byteCount > 8 * 1024 * 1024) throw new Error('Invalid voice stream.');
        parts.push(bytes); playback.push(bytes, rate);
      }
      if (data.type === 'done') complete = true;
    };
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buffer += decoder.decode(value, { stream: true });
        if (buffer.length > 2 * 1024 * 1024) throw new Error('Invalid voice stream.');
        let end; while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); packet(line); }
      }
      if (buffer.trim()) packet(buffer);
      if (sequence !== this.sequence || controller.signal.aborted) return;
      if (!complete || !parts.length) throw new Error('The spoken reply ended early.');
      this.objectUrl = URL.createObjectURL(streamedWave(parts, rate)); this.key = key;
      playback.finish();
    } catch (error) { playback.stop(); throw error; }
    finally { reader.releaseLock(); }
  }
  warm({ voice }) {
    if (!voice?.startsWith('pocket_') || (this.warmedVoice === voice && Date.now() - this.warmedAt < 240000)) return;
    this.warmedVoice = voice; this.warmedAt = Date.now();
    void fetch('/api/speech-warmup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ voice }) }).then(response => { if (!response.ok) this.warmedAt = 0; }).catch(() => { this.warmedAt = 0; });
  }
}
