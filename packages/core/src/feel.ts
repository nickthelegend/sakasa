import { type Dir, type V3, cross, dirAxis, dirVector } from './math.js';

/**
 * The "feel" of a flip, kept pure so it can be unit tested: the slow-motion
 * profile, the room-tilt cue, and the toy pile layout. The app only renders
 * what these return.
 */

/** Slow motion on a pinch flip: hold at `floor`, then ease back to real time over `ramp` seconds. */
export const SLOWMO = { floor: 0.15, hold: 0.35, ramp: 1.1 } as const;

/** Time scale `t` seconds (real time) after a pinch flip. */
export function slowmoScale(t: number): number {
  if (t < 0) return 1;
  if (t < SLOWMO.hold) return SLOWMO.floor;
  const u = (t - SLOWMO.hold) / SLOWMO.ramp;
  if (u >= 1) return 1;
  const e = u * u * (3 - 2 * u);
  return SLOWMO.floor + (1 - SLOWMO.floor) * e;
}

export function slowmoDone(t: number): boolean {
  return t >= SLOWMO.hold + SLOWMO.ramp;
}

/** Peak tilt of the ghost room outline on a flip, degrees (the real room never moves). */
export const TILT_PEAK_DEG = 12;
/** Gentle gravity also softens the tilt cue to this fraction. */
export const TILT_GENTLE = 0.35;
const TILT_RISE = 0.2;
const TILT_SETTLE = 1.1;

export interface TiltCue {
  /** Unit axis in the room frame. */
  axis: V3;
  /** Peak angle, radians. */
  peak: number;
}

/**
 * The ghost room outline tips about `axis` so the surface that becomes
 * "down" swings toward the old floor: rotating `to` about `to x from` moves
 * it toward `from`. Opposite flips (floor to ceiling) tip about a horizontal
 * axis; same-direction flips get no cue.
 */
export function tiltCue(from: Dir, to: Dir, gentle = false): TiltCue | null {
  if (from === to) return null;
  const a = dirVector(to);
  const b = dirVector(from);
  let axis = cross(a, b);
  if (axis[0] === 0 && axis[1] === 0 && axis[2] === 0) {
    // Opposite directions: tip about an axis perpendicular to both (x for floor/ceiling, y for walls).
    axis = dirAxis(to) === 1 ? [1, 0, 0] : [0, 1, 0];
  }
  const peak = ((TILT_PEAK_DEG * Math.PI) / 180) * (gentle ? TILT_GENTLE : 1);
  return { axis, peak };
}

/** Tilt angle `t` seconds after the flip: a quick kick, then a smooth settle back to level. */
export function tiltAngleAt(t: number, peak: number): number {
  if (t <= 0) return 0;
  if (t < TILT_RISE) {
    const u = t / TILT_RISE;
    return peak * (1 - (1 - u) * (1 - u) * (1 - u));
  }
  const u = (t - TILT_RISE) / TILT_SETTLE;
  if (u >= 1) return 0;
  return peak * (1 - u * u * (3 - 2 * u));
}

export function tiltDuration(): number {
  return TILT_RISE + TILT_SETTLE;
}

/**
 * Where the onboarding / sandbox toys start: a centred grid that fits the
 * supporting surface (`width` along x, `depth` along z), stacked in layers
 * when one layer does not fit. Offsets are relative to the support's top
 * centre; y is the height of the toy's centre above the top before it drops.
 */
export function pileLayout(count: number, size: number, width: number, depth: number, maxCols = 4, maxRows = 3): V3[] {
  const pitch = size * 1.25;
  const margin = 0.06;
  const fit = (extent: number, max: number) =>
    Math.max(1, Math.min(max, Math.floor((extent - margin - size) / pitch) + 1));
  const cols = fit(width, maxCols);
  const rows = fit(depth, maxRows);
  const perLayer = cols * rows;
  const out: V3[] = [];
  for (let i = 0; i < count; i++) {
    const layer = Math.floor(i / perLayer);
    const j = i % perLayer;
    const c = j % cols;
    const r = Math.floor(j / cols);
    // upper layers sit a quarter pitch over so they rest across the toys below
    const cx = (c - (cols - 1) / 2) * pitch + (layer % 2 === 1 ? pitch * 0.25 : 0);
    out.push([cx, size * 0.5 + 0.12 + layer * size * 1.2, (r - (rows - 1) / 2) * pitch]);
  }
  return out;
}
