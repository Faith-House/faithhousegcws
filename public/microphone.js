export function encodeMicrophoneWave(chunks, sourceRate) {
  const input = new Float32Array(chunks.reduce((n, chunk) => n + chunk.length, 0));
  let offset = 0;
  for (const chunk of chunks) { input.set(chunk, offset); offset += chunk.length; }
  const ratio = sourceRate / 16000;
  const count = Math.min(20 * 16000, Math.floor(input.length / ratio));
  const buffer = new ArrayBuffer(44 + count * 2);
  const view = new DataView(buffer);
  const write = (at, text) => { for (let i = 0; i < text.length; i++) view.setUint8(at + i, text.charCodeAt(i)); };
  write(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); write(8, 'WAVEfmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  write(36, 'data'); view.setUint32(40, count * 2, true);
  // Average source samples over each output interval to reduce aliasing when downsampling.
  for (let i = 0; i < count; i++) {
    const start = i * ratio;
    const end = (i + 1) * ratio;
    let sum = 0;
    for (let j = Math.floor(start); j < Math.ceil(end); j++) sum += (input[j] || 0) * (Math.min(end, j + 1) - Math.max(start, j));
    const sample = Math.max(-1, Math.min(1, sum / ratio));
    view.setInt16(44 + i * 2, Math.round(sample < 0 ? sample * 32768 : sample * 32767), true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export class LocalMicrophone {
  constructor(onChange, onTranscript) {
    this.onChange = onChange;
    this.onTranscript = onTranscript;
    this.state = 'idle';
    this.sequence = 0;
    this.level = 0;
    this.message = '';
  }
  notify() { this.onChange?.(); }
  async release() {
    clearTimeout(this.limit);
    clearTimeout(this.noSpeechTimer);
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    this.node?.disconnect(); this.source?.disconnect(); this.gain?.disconnect();
    this.node = this.source = this.gain = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== 'closed') await context.close().catch(() => {});
  }
  cancel() {
    clearTimeout(this.permissionTimer);
    this.sequence++;
    this.controller?.abort();
    this.controller = null;
    this.chunks = [];
    this.state = 'idle'; this.level = 0; this.message = '';
    void this.release(); this.notify();
  }
  async start(room, deviceId = '', { noSpeechTimeoutMs = 0, processAudio = null, identifySpeaker = false, capture = null } = {}) {
    this.cancel();
    const sequence = this.sequence;
    this.room = room;
    this.processAudio = processAudio; this.identifySpeaker = identifySpeaker;
    this.state = 'requesting'; this.message = 'Opening microphone…'; this.notify();
    this.permissionTimer = setTimeout(() => {
      if (sequence === this.sequence && this.state === 'requesting') {
        this.cancel(); this.message = 'The browser has not opened the microphone. Check its microphone permission, or open Jarvis in Chrome or Edge.'; this.notify();
      }
    }, 15000);
    try {
      if (!navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode || !window.isSecureContext) throw new Error('Use Jarvis on localhost in a browser with microphone support.');
      const transferred = capture?.claim();
      const stream = transferred?.stream || await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } });
      if (sequence !== this.sequence) {
        stream.getTracks().forEach(track => track.stop());
        if (transferred) { transferred.source.disconnect(); transferred.node.disconnect(); transferred.gain.disconnect(); await transferred.context.close().catch(() => {}); }
        return;
      }
      clearTimeout(this.permissionTimer);
      this.stream = stream;
      stream.getAudioTracks()[0].addEventListener('ended', () => { if (sequence === this.sequence && this.state === 'recording') { this.cancel(); this.message = 'The microphone disconnected. Choose another microphone.'; this.notify(); } });
      const context = transferred?.context || new AudioContext(); this.context = context;
      if (!transferred) {
        await context.audioWorklet.addModule('/microphone-worklet.js');
        if (sequence !== this.sequence) return;
        await context.resume();
        if (sequence !== this.sequence) return;
      }
      this.sampleRate = context.sampleRate;
      this.source = transferred?.source || context.createMediaStreamSource(stream);
      this.node = transferred?.node || new AudioWorkletNode(context, 'jarvis-microphone');
      this.gain = transferred?.gain || context.createGain(); this.gain.gain.value = 0;
      if (!transferred) { this.source.connect(this.node); this.node.connect(this.gain); this.gain.connect(context.destination); }
      this.chunks = []; this.samples = 0; this.voicedSamples = 0; this.lastSpeech = 0;
      const consume = (chunk, allowFinish = true) => {
        if (sequence !== this.sequence || this.state !== 'recording') return;
        const rms = Math.sqrt(chunk.reduce((sum, v) => sum + v * v, 0) / chunk.length);
        this.level = Math.min(1, rms * 8);
        this.chunks.push(chunk); this.samples += chunk.length;
        if (rms > 0.008) { this.lastSpeech = this.samples; this.voicedSamples += chunk.length; }
        this.elapsed = this.samples / this.sampleRate;
        this.notify();
        if (allowFinish && (this.elapsed >= 20 || (this.voicedSamples > this.sampleRate * 0.25 && (this.samples - this.lastSpeech) / this.sampleRate > 1.3 && this.elapsed > 1))) void this.finish();
      };
      this.node.port.onmessage = event => consume(event.data);
      this.state = 'recording'; this.message = 'Listening · speak, then pause'; this.elapsed = 0;
      for (const chunk of transferred?.chunks || []) consume(chunk, false);
      this.limit = setTimeout(() => { if (this.state === 'recording') void this.finish(); }, 20500);
      if (noSpeechTimeoutMs) this.noSpeechTimer = setTimeout(() => { if (this.state === 'recording' && this.voicedSamples < this.sampleRate * .2) void this.finish(); }, noSpeechTimeoutMs);
      this.notify();
    } catch (error) {
      await capture?.release();
      clearTimeout(this.permissionTimer);
      if (sequence !== this.sequence) return;
      await this.release();
      this.state = 'idle';
      this.message = ({ NotAllowedError: 'Microphone access was blocked. Allow it for Jarvis in your browser settings, then try again.', NotFoundError: 'No microphone was found. Connect a microphone and try again.', NotReadableError: 'The microphone is busy or unavailable. Close other recording apps and try again.', OverconstrainedError: 'That microphone is unavailable. Choose the default microphone.' })[error.name] || error.message;
      this.notify();
    }
  }
  async finish() {
    if (this.state !== 'recording') return;
    const sequence = this.sequence;
    this.state = 'transcribing'; this.message = 'Recognizing speech locally…'; this.level = 0;
    const chunks = this.chunks; this.chunks = [];
    await this.release(); this.notify();
    if (sequence !== this.sequence) return;
    if (this.voicedSamples < this.sampleRate * 0.2) { this.state = 'idle'; this.message = 'I did not hear speech. Check the microphone and try again.'; this.notify(); return; }
    this.controller = new AbortController();
    try {
      const wave = encodeMicrophoneWave(chunks, this.sampleRate);
      let result;
      if (this.processAudio) result = await this.processAudio(wave, this.controller.signal);
      else {
        const response = await fetch(`/api/transcribe?room=${encodeURIComponent(this.room)}${this.identifySpeaker ? '&identify=1' : ''}`, { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: wave, signal: this.controller.signal });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || 'Speech recognition failed.');
      }
      if (sequence !== this.sequence) return;
      this.state = 'idle'; this.message = 'Check what I heard, then send.';
      this.onTranscript(result.text || '', result);
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.state = 'idle'; this.message = error.message;
    } finally { if (sequence === this.sequence) { this.controller = null; this.notify(); } }
  }
}
