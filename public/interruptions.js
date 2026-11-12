// Audio stays in memory only. A handoff owns its capture until explicitly claimed.
export class CaptureHandoff {
  constructor(graph, chunks = [], { maxMs = 1800, timeoutMs = 4000 } = {}) {
    Object.assign(this, graph); this.chunks = []; this.samples = 0; this.maxSamples = Math.round(this.sampleRate * maxMs / 1000);
    for (const chunk of chunks) this.push(chunk);
    this.node.port.onmessage = event => this.push(event.data);
    this.timer = setTimeout(() => void this.release(), timeoutMs);
  }
  push(chunk) {
    if (this.claimed || this.released) return;
    this.chunks.push(chunk); this.samples += chunk.length;
    while (this.samples > this.maxSamples && this.chunks.length > 1) this.samples -= this.chunks.shift().length;
  }
  claim() {
    if (this.claimed || this.released) throw new Error('Microphone handoff expired. Try Hey Jarvis again.');
    clearTimeout(this.timer); this.claimed = true;
    const data = { stream: this.stream, context: this.context, source: this.source, node: this.node, gain: this.gain, chunks: this.chunks, sampleRate: this.sampleRate };
    this.stream = this.context = this.source = this.node = this.gain = null; this.chunks = []; return data;
  }
  async release() {
    clearTimeout(this.timer);
    if (this.claimed || this.released) return;
    this.released = true; this.chunks = [];
    this.stream?.getTracks().forEach(track => track.stop());
    this.source?.disconnect(); this.node?.disconnect(); this.gain?.disconnect();
    if (this.context && this.context.state !== 'closed') await this.context.close().catch(() => {});
    this.stream = this.context = this.source = this.node = this.gain = null;
  }
}

export class PlaybackWakeGate {
  constructor({ threshold = 0.75, frames = 2 } = {}) { this.threshold = threshold; this.frames = frames; this.hits = 0; }
  accept(result, playback) {
    if (!playback) { this.hits = 0; return Boolean(result.detected); }
    this.hits = result.detected && Number(result.score) >= this.threshold ? this.hits + 1 : 0;
    if (this.hits < this.frames) return false;
    this.hits = 0; return true;
  }
  reset() { this.hits = 0; }
}

export const stripWakePhrase = text => text.replace(/^(?:(?:hey|okay|ok)[,\s]+)?jarvis[,.!:\s]*/i, '').trim();
export const isStopReply = text => /^(?:stop(?: (?:talking|speaking|the reply|your reply))?|be quiet|that['’]?s enough|quiet please|never ?mind|forget it)(?:[, ]+please)?[.!?]*$/i.test(text.trim());

export function wakeShouldPause({ micState, submitting, draftOpen, busy, speechState, interruptions }) {
  return micState !== 'idle' || submitting || draftOpen || (!interruptions && (busy || ['preparing', 'playing'].includes(speechState)));
}
