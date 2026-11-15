import { describe, expect, it } from 'vitest';
import {
  Dir,
  type V3,
  SLOWMO,
  TILT_GENTLE,
  buildRoom,
  dirVector,
  pileLayout,
  slowmoDone,
  slowmoScale,
  tiltAngleAt,
  tiltCue,
  tiltDuration,
} from '../src/index.js';
import { SYNTHETIC_ROOMS } from '../src/synthetic-rooms.js';

/** Rodrigues rotation of v about unit axis k by angle a. */
function rotate(v: V3, k: V3, a: number): V3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const d = v[0] * k[0] + v[1] * k[1] + v[2] * k[2];
  const x: V3 = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map((i) => v[i] * c + x[i] * s + k[i] * d * (1 - c)) as V3;
}

describe('slow motion profile', () => {
  it('holds at the floor, then ramps monotonically back to real time', () => {
    expect(slowmoScale(-1)).toBe(1);
    expect(slowmoScale(0)).toBe(SLOWMO.floor);
    expect(slowmoScale(SLOWMO.hold * 0.9)).toBe(SLOWMO.floor);
    let prev = 0;
    for (let t = 0; t <= SLOWMO.hold + SLOWMO.ramp + 0.2; t += 0.02) {
      const s = slowmoScale(t);
      expect(s).toBeGreaterThanOrEqual(prev - 1e-12);
      expect(s).toBeGreaterThanOrEqual(SLOWMO.floor);
      expect(s).toBeLessThanOrEqual(1);
      prev = s;
    }
    expect(slowmoScale(SLOWMO.hold + SLOWMO.ramp)).toBe(1);
    expect(slowmoDone(SLOWMO.hold + SLOWMO.ramp)).toBe(true);
    expect(slowmoDone(SLOWMO.hold)).toBe(false);
  });

  it('is slow enough to see: under half speed for at least 0.7 s', () => {
    let slow = 0;
    for (let t = 0; t < 3; t += 0.01) if (slowmoScale(t) < 0.5) slow += 0.01;
    expect(slow).toBeGreaterThan(0.7);
  });
});

describe('room tilt cue', () => {
  const dirs = [Dir.PosX, Dir.NegX, Dir.PosY, Dir.NegY, Dir.PosZ, Dir.NegZ] as const;

  it('no cue when gravity does not change', () => {
    for (const d of dirs) expect(tiltCue(d, d)).toBeNull();
  });

  it('tips the new floor toward the old floor for every perpendicular flip', () => {
    for (const from of dirs) {
      for (const to of dirs) {
        if (from === to || (from >> 1) === (to >> 1)) continue;
        const cue = tiltCue(from, to)!;
        expect(Math.hypot(...cue.axis)).toBeCloseTo(1, 9);
        const before = dirVector(to);
        const after = rotate(before, cue.axis, 0.2);
        const target = dirVector(from);
        const dotBefore = before[0] * target[0] + before[1] * target[1] + before[2] * target[2];
        const dotAfter = after[0] * target[0] + after[1] * target[1] + after[2] * target[2];
        expect(dotAfter).toBeGreaterThan(dotBefore);
      }
    }
  });

  it('opposite flips tip about an axis perpendicular to both', () => {
    for (const [a, b] of [[Dir.NegY, Dir.PosY], [Dir.PosX, Dir.NegX], [Dir.PosZ, Dir.NegZ]] as const) {
      const cue = tiltCue(a, b)!;
      const v = dirVector(b);
      expect(Math.abs(cue.axis[0] * v[0] + cue.axis[1] * v[1] + cue.axis[2] * v[2])).toBe(0);
    }
  });

  it('kicks to the peak quickly, settles to level, and gentle gravity softens it', () => {
    const cue = tiltCue(Dir.NegY, Dir.NegX)!;
    const gentle = tiltCue(Dir.NegY, Dir.NegX, true)!;
    expect(gentle.peak).toBeCloseTo(cue.peak * TILT_GENTLE, 9);
    expect(tiltAngleAt(0, cue.peak)).toBe(0);
    expect(tiltAngleAt(0.2, cue.peak)).toBeCloseTo(cue.peak, 9);
    expect(tiltAngleAt(tiltDuration(), cue.peak)).toBe(0);
    let max = 0;
    for (let t = 0; t < 2; t += 0.01) max = Math.max(max, tiltAngleAt(t, cue.peak));
    expect(max).toBeLessThanOrEqual(cue.peak + 1e-12);
    expect((cue.peak * 180) / Math.PI).toBeLessThanOrEqual(15);
  });
});

describe('toy pile layout', () => {
  it('fits a coffee table: no two toys overlap and the bottom layer stays on the top', () => {
    const size = 0.18;
    const w = 1.1;
    const d = 0.55;
    const pile = pileLayout(12, size, w, d);
    expect(pile).toHaveLength(12);
    for (let i = 0; i < pile.length; i++) {
      for (let j = i + 1; j < pile.length; j++) {
        const [a, b] = [pile[i], pile[j]];
        expect(Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))).toBeGreaterThanOrEqual(size);
      }
    }
    const bottom = pile.filter((p) => p[1] === pile[0][1]);
    for (const p of bottom) {
      expect(Math.abs(p[0]) + size / 2).toBeLessThanOrEqual(w / 2);
      expect(Math.abs(p[2]) + size / 2).toBeLessThanOrEqual(d / 2);
    }
    expect(new Set(pile.map((p) => p[1])).size).toBeGreaterThan(1);
  });

  it('a tiny support still gets every toy, stacked', () => {
    const pile = pileLayout(12, 0.18, 0.2, 0.2);
    expect(pile).toHaveLength(12);
    expect(new Set(pile.map((p) => p[1])).size).toBe(12);
  });

  it('room models now carry a 7.5 cm marble (15 cm across) and a 3 cm tabletop marble', () => {
    for (const r of SYNTHETIC_ROOMS) {
      const room = buildRoom(r.planes, { head: r.head });
      expect(room.radius).toBeCloseTo(room.kind === 'tabletop' ? 0.03 : 0.075, 9);
    }
  });
});
