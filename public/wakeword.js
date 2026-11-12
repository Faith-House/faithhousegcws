import { CaptureHandoff, PlaybackWakeGate } from './interruptions.js';
// Preserve fractional sample intervals across chunks, including 44.1 kHz input.
export class WakeAudioFrames {
  constructor(sampleRate, onFrame) {
    this.ratio = sampleRate / 16000; this.onFrame = onFrame;
    this.sum = 0; this.weight = 0; this.index = 0;
    this.frame = new Int16Array(1280);
  }
  push(samples) {
    for (const sample of samples) {
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += sample * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-9) {
          const value = Math.max(-1, Math.min(1, this.sum / this.ratio));
          this.frame[this.index++] = Math.round(value * (value < 0 ? 32768 : 32767));
          this.sum = 0; this.weight = 0;
          if (this.index === this.frame.length) {
            const bytes = new ArrayBuffer(2560), view = new DataView(bytes);
            for (let i = 0; i < 1280; i++) view.setInt16(i * 2, this.frame[i], true);
            this.onFrame(bytes); this.index = 0;
          }
        }
      }
    }
  }
}

export class WakeWordListener {
  constructor(onChange, onWake, { handoff = false, onDetected = null, isPlaybackActive = () => false } = {}) {
    this.onChange = onChange; this.onWake = onWake;
    this.enabled = false; this.state = 'off'; this.message = '';
    this.sequence = 0; this.queue = []; this.cleanup = Promise.resolve();
    this.handoff = handoff; this.onDetected = onDetected; this.isPlaybackActive = isPlaybackActive;
    this.preRoll = []; this.preRollSamples = 0; this.gate = new PlaybackWakeGate();
  }
  notify() { this.onChange?.(); }
  async enable(room, deviceId) {
    this.enabled = true; this.room = room; this.deviceId = deviceId;
    await this.resume();
  }
  pause(message = 'Listening paused') {
    this.sequence++; clearTimeout(this.permissionTimer);
    this.controller?.abort(); this.controller = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    this.source?.disconnect(); this.node?.disconnect(); this.gain?.disconnect();
    this.source = this.node = this.gain = null;
    const context = this.context; this.context = null;
    const token = this.token; this.token = null;
    const closeAudio = context && context.state !== 'closed' ? context.close().catch(() => {}) : Promise.resolve();
    const stopDetector = token ? fetch('/api/listen/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), keepalive: true }).catch(() => {}) : Promise.resolve();
    const finishStart = this.startRequest ? this.startRequest.then(({ info }) => {
      if (info.token) return fetch('/api/listen/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: info.token }), keepalive: true });
    }).catch(() => {}) : Promise.resolve();
    this.cleanup = Promise.all([this.cleanup, closeAudio, stopDetector, finishStart]);
    this.queue = []; this.inFlight = false;
    this.preRoll = []; this.preRollSamples = 0; this.gate.reset();
    this.state = this.enabled ? 'paused' : 'off'; this.message = this.enabled ? message : '';
    this.notify();
  }
  disable() { this.enabled = false; this.pause(); }
  error(message) { this.disable(); this.state = 'error'; this.message = message; this.notify(); }
  async resume() {
    if (!this.enabled || ['listening', 'starting'].includes(this.state)) return;
    this.state = 'starting'; this.message = 'Starting local Hey Jarvis…'; this.notify();
    const sequence = ++this.sequence;
    await this.cleanup;
    if (sequence !== this.sequence || !this.enabled) return;
    this.permissionTimer = setTimeout(() => { if (sequence === this.sequence) this.error('The microphone did not open. Check browser microphone permission and enable Hey Jarvis again.'); }, 15000);
    this.controller = new AbortController();
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || !window.AudioWorkletNode) throw new Error('Open Jarvis on localhost in a browser with microphone support.');
      const stream = await navigator.mediaDevices.getUserMedia({ video: false, audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(this.deviceId ? { deviceId: { exact: this.deviceId } } : {}) } });
      if (sequence !== this.sequence) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      stream.getAudioTracks()[0].addEventListener('ended', () => { if (sequence === this.sequence) this.error('The microphone disconnected. Reconnect it and enable Hey Jarvis again.'); });
      const context = new AudioContext(); this.context = context;
      await context.audioWorklet.addModule('/microphone-worklet.js');
      if (sequence !== this.sequence) return;
      await context.resume();
      if (sequence !== this.sequence) return;
      const starting = fetch('/api/listen/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ room: this.room }), signal: AbortSignal.timeout(20000) }).then(async response => ({ response, info: await response.json() }));
      this.startRequest = starting;
      const { response, info } = await starting;
      if (this.startRequest === starting) this.startRequest = null;
      if (sequence !== this.sequence) {
        if (info.token) await fetch('/api/listen/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: info.token }), keepalive: true }).catch(() => {});
        return;
      }
      if (!response.ok) throw new Error(info.error || 'The wake-word detector could not start.');
      this.token = info.token; clearTimeout(this.permissionTimer);
      this.source = context.createMediaStreamSource(stream);
      this.node = new AudioWorkletNode(context, 'jarvis-microphone');
      this.gain = context.createGain(); this.gain.gain.value = 0;
      this.source.connect(this.node); this.node.connect(this.gain); this.gain.connect(context.destination);
      const frames = new WakeAudioFrames(context.sampleRate, frame => {
        if (sequence !== this.sequence || this.state !== 'listening') return;
        this.queue.push({ frame, playback: this.isPlaybackActive() });
        if (this.queue.length > 8) return this.error('This computer could not keep up with live listening. Close other busy apps and enable Hey Jarvis again.');
        void this.pump(sequence);
      });
      this.node.port.onmessage = event => {
        if (sequence !== this.sequence || this.state !== 'listening') return;
        if (this.handoff) {
          this.preRoll.push(event.data); this.preRollSamples += event.data.length;
          while (this.preRollSamples > context.sampleRate * 1.4 && this.preRoll.length > 1) this.preRollSamples -= this.preRoll.shift().length;
        }
        frames.push(event.data);
      };
      this.state = 'listening'; this.message = 'Listening for “Hey Jarvis”'; this.notify();
    } catch (error) {
      if (sequence !== this.sequence) return;
      this.error(({ NotAllowedError: 'Microphone access was blocked. Allow it for Jarvis, then enable Hey Jarvis again.', NotFoundError: 'No microphone was found. Connect one and try again.', NotReadableError: 'The microphone is unavailable or busy.', OverconstrainedError: 'Choose the default microphone and try again.' })[error.name] || error.message);
    }
  }
  async pump(sequence) {
    if (this.inFlight) return;
    this.inFlight = true;
    try {
      while (this.queue.length && sequence === this.sequence && this.state === 'listening') {
        const item = this.queue.shift();
        const response = await fetch('/api/listen/frame', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Jarvis-Listening': this.token }, body: item.frame, signal: this.controller.signal });
        const result = await response.json();
        if (sequence !== this.sequence) return;
        if (!response.ok) throw new Error(result.error || 'Live listening stopped.');
        if (this.gate.accept(result, item.playback)) {
          let capture;
          if (this.handoff && this.stream && this.context && this.node) {
            capture = new CaptureHandoff({ stream: this.stream, context: this.context, source: this.source, node: this.node, gain: this.gain, sampleRate: this.context.sampleRate }, this.preRoll);
            this.stream = this.context = this.source = this.node = this.gain = null;
          }
          this.pause('Wake word heard');
          try {
            this.onDetected?.();
            await this.cleanup;
            if (this.enabled && this.onWake) await this.onWake(capture);
          } finally { await capture?.release(); }
          return;
        }
      }
    } catch (error) { if (sequence === this.sequence) this.error(error.message); }
    finally { if (sequence === this.sequence) this.inFlight = false; }
  }
}
