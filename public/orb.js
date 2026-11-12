const TAU = Math.PI * 2;

// Preserve the import contract used by existing paired displays.
export class JarvisOrb {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext('2d', { alpha: true });
    this.state = 'idle'; this.time = 0; this.last = 0; this.level = 0;
    this.levelSource = () => 0; this.pulses = []; this.lastPulse = 0;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
    this.tick = this.tick.bind(this);
    this.frame = requestAnimationFrame(this.tick);
  }
  setState(state) { this.state = state; }
  setLevelSource(source) { this.levelSource = source; }
  resize() {
    const bounds = this.canvas.getBoundingClientRect();
    const ratio = Math.min(devicePixelRatio || 1, 1.5);
    this.canvas.width = Math.round(bounds.width * ratio);
    this.canvas.height = Math.round(bounds.height * ratio);
    this.draw();
  }
  tick(now) {
    this.frame = requestAnimationFrame(this.tick);
    if (document.hidden || now - this.last < (this.reduced.matches ? 250 : 33)) return;
    const elapsed = Math.min((now - (this.last || now)) / 1000, .12);
    this.last = now;
    const raw = this.levelSource();
    const target = Number.isFinite(raw) ? Math.max(0, Math.min(1, raw)) : 0;
    if (!this.reduced.matches && target > this.level + .12 && target > .12 && now - this.lastPulse > 220) {
      this.pulses.push({ age: 0, strength: target });
      this.pulses = this.pulses.slice(-5); this.lastPulse = now;
    }
    this.level += (target - this.level) * (target > this.level ? .46 : .15);
    if (!this.reduced.matches) {
      this.time += elapsed * ((this.state === 'thinking' ? 1.5 : this.state === 'idle' ? .64 : 1) + this.level * 1.25);
      for (const pulse of this.pulses) pulse.age += elapsed * .65;
      this.pulses = this.pulses.filter(pulse => pulse.age < 1);
    }
    this.draw();
  }
  draw() {
    const ctx = this.context;
    if (!ctx || !this.canvas.width) return;
    ctx.setTransform(this.canvas.width / 640, 0, 0, this.canvas.height / 640, 0, 0);
    ctx.clearRect(0, 0, 640, 640);
    ctx.globalCompositeOperation = 'source-over'; ctx.shadowBlur = 0;
    this.canvas.dataset.audioLevel = this.level.toFixed(3);
    const level = this.level, t = this.time;
    const energy = Math.sqrt(level);
    const light = (this.state === 'idle' ? .76 : 1) + energy * .24;
    const swell = this.reduced.matches ? 1 : 1 + level * .022;
    const color = (alpha, warm = false) => `rgba(255,${warm ? 175 : 108},${warm ? 74 : 19},${Math.min(1, alpha * light)})`;
    const arc = (radius, start, end, width, ink, glow = 0, round = false) => {
      ctx.beginPath(); ctx.arc(320, 320, radius * swell, start, end);
      ctx.lineWidth = width; ctx.lineCap = round ? 'round' : 'butt';
      ctx.strokeStyle = ink; ctx.shadowColor = '#ff6413'; ctx.shadowBlur = glow;
      ctx.stroke(); ctx.shadowBlur = 0;
    };
    const radial = (angle, inner, outer, width, ink) => {
      ctx.beginPath(); ctx.moveTo(320 + Math.cos(angle) * inner * swell, 320 + Math.sin(angle) * inner * swell);
      ctx.lineTo(320 + Math.cos(angle) * outer * swell, 320 + Math.sin(angle) * outer * swell);
      ctx.lineWidth = width; ctx.strokeStyle = ink; ctx.lineCap = 'butt'; ctx.stroke();
    };
    const halo = ctx.createRadialGradient(320, 320, 35, 320, 320, 310);
    halo.addColorStop(0, `rgba(255,110,14,${.08 + level * .10})`);
    halo.addColorStop(.38, 'rgba(148,42,6,.015)');
    halo.addColorStop(.73, `rgba(255,68,0,${.024 + level * .035})`);
    halo.addColorStop(1, 'rgba(255,68,0,0)');
    ctx.fillStyle = halo; ctx.fillRect(0, 0, 640, 640);

    // Fine machined tracks keep every layer visibly concentric.
    for (const radius of [59, 77, 91, 106, 120, 137, 164, 174, 195, 211, 228, 246, 260, 276, 289]) {
      arc(radius, 0, TAU, .6, color(radius % 2 ? .15 : .09));
    }
    for (let i = 0; i < 180; i++) {
      const angle = i * TAU / 180 + t * .018;
      radial(angle, i % 15 === 0 ? 280 : i % 5 === 0 ? 284 : 287, 291, i % 15 ? .65 : 1.3, color(i % 15 ? .25 : .74));
    }
    // Four substantial outer arcs, with luminous leading edges.
    for (let i = 0; i < 4; i++) {
      const start = t * .062 + i * TAU / 4;
      arc(269, start, start + 1.06, 4.2 + level * 1.5, color(.72), 11 + energy * 6);
      arc(273, start + .04, start + .95, .65, color(.55, true));
      arc(269, start + .89, start + 1.06, 2, color(.96, true), 8);
      radial(start - .04, 264, 274, 2, color(.65));
    }
    // A counter-rotating belt of separated metallic light tiles.
    for (let i = 0; i < 64; i++) {
      const start = -t * .11 + i * TAU / 64;
      arc(238, start, start + .063, i % 8 === 0 ? 7 : 4.6, color(i % 8 === 0 ? .95 : i % 3 ? .30 : .63, i % 8 === 0));
    }
    arc(248, -.3 + t * .14, .28 + t * .14, 1.4, color(.80, true), 7);
    arc(248, 2.3 + t * .14, 2.72 + t * .14, 1, color(.48));

    for (let i = 0; i < 3; i++) {
      const start = t * .18 + i * TAU / 3 + .6;
      arc(204, start, start + 1.58, 2.4, color(.91), 8);
      arc(198, start + .1, start + 1.35, .7, color(.46, true));
      arc(210, start + .18, start + .50, 3.8, color(.42));
      const tip = start + 1.58;
      ctx.beginPath(); ctx.arc(320 + Math.cos(tip) * 204 * swell, 320 + Math.sin(tip) * 204 * swell, 2.2, 0, TAU);
      ctx.fillStyle = '#ffce86'; ctx.fill();
    }
    // Fast inner indexing travels against the broad orange bands.
    for (let i = 0; i < 84; i++) {
      const angle = -t * .25 + i * TAU / 84;
      radial(angle, i % 7 ? 175 : 172, 179, i % 7 ? .8 : 1.5, color(i % 7 ? .36 : .84, i % 7 === 0));
    }
    arc(185, -t * .25, .58 - t * .25, 2.3, color(.90, true), 9);
    arc(185, 3.2 - t * .25, 3.6 - t * .25, .85, color(.62));

    // Radial filaments expand with measured audio amplitude, not a random meter.
    for (let i = 0; i < 112; i++) {
      const angle = i * TAU / 112 + t * .08;
      const shape = .28 + .72 * Math.abs(Math.sin(i * .37 + t * 2) * Math.cos(i * .19 - t));
      const length = 2.3 + level * (7 + shape * 18);
      radial(angle, 139, 139 + length, i % 4 ? .85 : 1.5, color(.30 + energy * shape * .68, i % 4 === 0));
    }
    arc(133, 0, TAU, .75, color(.38));
    for (let i = 0; i < 3; i++) {
      const start = -t * .34 + i * TAU / 3 + .2;
      arc(112, start, start + 1.48, 5.4 + level * 1.8, color(.85), 14);
      arc(108, start + .08, start + 1.38, .8, color(.94, true));
      arc(120, start + .2, start + .56, 1, color(.54));
    }

    // The central aperture remains open rather than filling the screen with text.
    for (let i = 0; i < 32; i++) {
      const angle = t * .43 + i * TAU / 32;
      radial(angle, 64, i % 4 ? 72 : 79, i % 4 ? 1 : 2.1, color(i % 4 ? .36 : .88, i % 4 === 0));
    }
    arc(87, t * .32, t * .32 + 4.7, 1.2, color(.82), 7);
    arc(58, 0, TAU, 1.1 + level, color(.60, true), 13);
    arc(49, 0, TAU, .6, color(.18));
    const core = ctx.createRadialGradient(320, 320, 0, 320, 320, 48);
    core.addColorStop(0, `rgba(255,222,153,${.68 + energy * .30})`);
    core.addColorStop(.08, `rgba(255,153,45,${.40 + energy * .42})`);
    core.addColorStop(.38, `rgba(255,90,0,${.07 + level * .12})`);
    core.addColorStop(1, 'rgba(255,90,0,0)');
    ctx.fillStyle = core; ctx.fillRect(272, 272, 96, 96);
    const flare = ctx.createLinearGradient(272, 0, 368, 0);
    flare.addColorStop(0, 'rgba(255,168,77,0)'); flare.addColorStop(.5, color(.65 + energy * .30, true)); flare.addColorStop(1, 'rgba(255,168,77,0)');
    ctx.fillStyle = flare; ctx.fillRect(272, 319.5, 96, 1);

    // Real voice attacks launch outward wavefronts; silence never creates them.
    for (const pulse of this.pulses) {
      const radius = 82 + pulse.age * 204;
      arc(radius, 0, TAU, .9, color((1 - pulse.age) ** 2 * pulse.strength * .28), 4);
    }
    if (level > .08) {
      for (let i = 0; i < 14; i++) {
        const angle = i * 2.39996 + t * (i % 2 ? -.23 : .19);
        const radius = 153 + (i % 5) * 24;
        arc(radius, angle, angle + .018 + level * .024, .85, color(energy * .62, true));
      }
    }
  }
  destroy() { cancelAnimationFrame(this.frame); this.resizeObserver.disconnect(); }
}
