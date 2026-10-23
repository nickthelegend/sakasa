/** Plain tuple vectors keep the core free of any renderer dependency. */
export type V3 = [number, number, number];

/**
 * The six gravity directions in the room frame. A surface is pinched to make
 * it "down", so the gravity direction is the direction *towards* that surface.
 */
export const Dir = {
  PosX: 0,
  NegX: 1,
  PosY: 2,
  NegY: 3,
  PosZ: 4,
  NegZ: 5,
} as const;
export type Dir = (typeof Dir)[keyof typeof Dir];

export const ALL_DIRS: readonly Dir[] = [0, 1, 2, 3, 4, 5];

export const DIR_NAMES: Record<Dir, string> = {
  0: '+X',
  1: '-X',
  2: 'up',
  3: 'down',
  4: '+Z',
  5: '-Z',
};

/** Axis index (0 = x, 1 = y, 2 = z) of a direction. */
export function dirAxis(d: Dir): 0 | 1 | 2 {
  return (d >> 1) as 0 | 1 | 2;
}

/** +1 or -1 along the axis. */
export function dirSign(d: Dir): 1 | -1 {
  return d % 2 === 0 ? 1 : -1;
}

export function dirVector(d: Dir): V3 {
  const v: V3 = [0, 0, 0];
  v[dirAxis(d)] = dirSign(d);
  return v;
}

export function opposite(d: Dir): Dir {
  return (d % 2 === 0 ? d + 1 : d - 1) as Dir;
}

export function add(a: V3, b: V3): V3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: V3, b: V3): V3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: V3, s: number): V3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function length(a: V3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function normalize(a: V3): V3 {
  const l = length(a);
  return l > 1e-12 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}

export function distance(a: V3, b: V3): number {
  return length(sub(a, b));
}

/** Rotate a vector about +Y by `yaw` radians (right-handed, as three.js). */
export function rotateY(v: V3, yaw: number): V3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * v[0] + s * v[2], v[1], -s * v[0] + c * v[2]];
}

/** Round to a fixed grid so floating noise never splits identical states. */
export function quantize(x: number, step = 1e-4): number {
  const q = Math.round(x / step) * step;
  return Object.is(q, -0) ? 0 : Number(q.toFixed(6));
}

export function quantizeV(v: V3, step = 1e-4): V3 {
  return [quantize(v[0], step), quantize(v[1], step), quantize(v[2], step)];
}

export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/** Axis-aligned box in the room frame. */
export interface Box {
  min: V3;
  max: V3;
}

export function boxCenter(b: Box): V3 {
  return [
    (b.min[0] + b.max[0]) / 2,
    (b.min[1] + b.max[1]) / 2,
    (b.min[2] + b.max[2]) / 2,
  ];
}

export function boxSize(b: Box): V3 {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function boxesOverlap(a: Box, b: Box, eps = 1e-9): boolean {
  for (let i = 0; i < 3; i++) {
    if (a.max[i] <= b.min[i] + eps || b.max[i] <= a.min[i] + eps) return false;
  }
  return true;
}
