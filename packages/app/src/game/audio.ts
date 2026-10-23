import { store } from './store.js';

/**
 * Every sound in Sakasa is synthesised with WebAudio at runtime: no audio
 * files, no licences to track. Voices are short, capped, and spatialised
 * with an HRTF panner so a marble hitting the wall behind you sounds behind you.
 */
export type SurfaceTone = 'floor' | 'wall' | 'ceiling' | 'table' | 'block' | 'furniture' | 'toy';

const TONE_PITCH: Record<SurfaceTone, number> = {
  floor: 0.8,
  wall: 1.0,
  ceiling: 1.35,
  table: 1.15,
  block: 1.25,
  furniture: 0.9,
  toy: 1.5,
};

class Synth {
  ctx: AudioContext | null = null;
  master: GainNode | null = null;
  noise: AudioBuffer | null = null;
  private voices = 0;
  private lastImpact = 0;

  ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    try {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.8;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master.connect(comp).connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < len; i++) {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        data[i] = (seed / 0x7fffffff) * 2 - 1;
      }
    } catch (error) {
      console.warn('[sakasa] WebAudio unavailable; playing silently.', error);
      this.ctx = null;
    }
    return this.ctx;
  }

  resume(): void {
    const ctx = this.ensure();
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => undefined);
  }

  setListener(px: number, py: number, pz: number, fx: number, fy: number, fz: number, ux: number, uy: number, uz: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const l = ctx.listener;
    if (l.positionX) {
      const t = ctx.currentTime;
      l.positionX.setValueAtTime(px, t);
      l.positionY.setValueAtTime(py, t);
      l.positionZ.setValueAtTime(pz, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(fy, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(ux, t);
      l.upY.setValueAtTime(uy, t);
      l.upZ.setValueAtTime(uz, t);
    }
  }

  private out(x?: number, y?: number, z?: number): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx || !this.master || !store.settings.sound || ctx.state !== 'running') return null;
    if (x === undefined) return this.master;
    const p = ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 0.8;
    p.rolloffFactor = 0.9;
    p.positionX.value = x;
    p.positionY.value = y ?? 0;
    p.positionZ.value = z ?? 0;
    p.connect(this.master);
    return p;
  }

  private claim(ms: number): boolean {
    if (this.voices >= 10) return false;
    this.voices++;
    setTimeout(() => this.voices--, ms);
    return true;
  }

  /** The flip: a deep "whoomp" with a breathy tail; pitch by surface. */
  whoomp(tone: SurfaceTone, x: number, y: number, z: number): void {
    const ctx = this.ctx;
    const dest = this.out(x, y, z);
    if (!ctx || !dest || !this.noise || !this.claim(900)) return;
    const t = ctx.currentTime;
    const k = TONE_PITCH[tone];
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(150 * k, t);
    osc.frequency.exponentialRampToValueAtTime(42 * k, t + 0.55);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);
    osc.connect(g).connect(dest);
    osc.start(t);
    osc.stop(t + 0.8);

    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 0.9;
    bp.frequency.setValueAtTime(2400 * k, t);
    bp.frequency.exponentialRampToValueAtTime(260 * k, t + 0.6);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.35, t + 0.08);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    n.connect(bp).connect(ng).connect(dest);
    n.start(t, Math.random() * 0.5);
    n.stop(t + 0.75);
  }

  /** A bounce. Paper thuds, the marble pings; strength 0..1. */
  impact(tone: SurfaceTone, strength: number, glassy: boolean, x: number, y: number, z: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = performance.now();
    if (now - this.lastImpact < 18) return;
    const dest = this.out(x, y, z);
    if (!dest || !this.noise || !this.claim(400)) return;
    this.lastImpact = now;
    const t = ctx.currentTime;
    const k = TONE_PITCH[tone];
    const s = Math.min(1, Math.max(0.05, strength));
    if (glassy) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = 1500 * k + 300 * s;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = o.frequency.value * 2.76;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.32 * s, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      o.connect(g);
      o2.connect(g);
      g.connect(dest);
      o.start(t);
      o2.start(t);
      o.stop(t + 0.36);
      o2.stop(t + 0.36);
    }
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = (glassy ? 900 : 520) * k;
    f.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.5 * s, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(f).connect(g).connect(dest);
    n.start(t, Math.random() * 0.8);
    n.stop(t + 0.1);
  }

  /** Slow-motion breath on the flip. */
  whoosh(): void {
    const ctx = this.ctx;
    const dest = this.out();
    if (!ctx || !dest || !this.noise || !this.claim(1200)) return;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300, t);
    f.frequency.exponentialRampToValueAtTime(3200, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.5);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    n.connect(f).connect(g).connect(dest);
    n.start(t);
    n.stop(t + 1.15);
  }

  /** Solved: a rising pentatonic bell arpeggio. */
  chime(starsWon: number): void {
    const ctx = this.ctx;
    const dest = this.out();
    if (!ctx || !dest || !this.claim(2000)) return;
    const notes = [523.25, 587.33, 659.25, 783.99, 880, 1046.5];
    const count = 3 + starsWon;
    for (let i = 0; i < count; i++) {
      const t = ctx.currentTime + i * 0.09;
      const f = notes[i % notes.length];
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const o2 = ctx.createOscillator();
      o2.type = 'sine';
      o2.frequency.value = f * 3.01;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.22, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.2);
      o.connect(g);
      o2.connect(g);
      g.connect(dest);
      o.start(t);
      o2.start(t);
      o.stop(t + 1.25);
      o2.stop(t + 1.25);
    }
  }

  /** Short UI tick for hover and button presses. */
  tick(pressed: boolean): void {
    const ctx = this.ctx;
    const dest = this.out();
    if (!ctx || !dest || !this.claim(120)) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'square';
    o.frequency.value = pressed ? 1320 : 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(pressed ? 0.08 : 0.025, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (pressed ? 0.06 : 0.025));
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.07);
  }
}

export const synth = new Synth();
