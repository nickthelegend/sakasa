import { type Box, type Dir, type V3, dirAxis, dirSign, quantizeV } from './math.js';

/**
 * What a gravity flip does to a resting marble, solved analytically.
 *
 * The marble starts at rest. Gravity along one room axis accelerates it along
 * that axis only; it moves in a straight line until its sphere meets the room
 * boundary or a solid box, bounces, and settles in contact. So the settled
 * result of a flip is a sweep of a sphere along an axis against boxes inflated
 * by the radius.
 *
 * A sphere stops cleanly only when its centre travels over the face itself
 * (at least `hitMargin` inside the face's edges; Havok also rounds box edges
 * with a convex radius, so the default is a full radius). Between the face edge and
 * the radius-inflated edge it would strike a rounded edge and glance off (or
 * roll off an edge it rests on) in a rigid-body engine, so the sweep reports
 * that as ambiguous instead of guessing. A centre exactly one radius from a
 * side face (within `slideBand`) is a marble sliding along a face it already
 * touches, which an engine resolves cleanly, so it is not a hit. Slight
 * penetration (up to `contactSlop`, e.g. from quantised positions) still
 * counts as contact.
 */
export interface SweepWorld {
  min: V3;
  max: V3;
  solids: readonly Box[];
  radius: number;
}

export type SweepResult =
  | {
      ok: true;
      end: V3;
      distance: number;
      /** -1 = room boundary, otherwise the index into `world.solids`. */
      hit: number;
    }
  | { ok: false; reason: 'ambiguous'; solid: number; at: number };

export interface SweepOptions {
  /** How far the centre must be inside a face's edges for a clean stop (default r: engines round box edges). */
  hitMargin?: number;
  /** How far outside the inflated cross-section counts as a clean miss (default r/2). */
  edgeMargin?: number;
  slideBand?: number;
  contactSlop?: number;
}

export function sweep(
  world: SweepWorld,
  p: V3,
  d: Dir,
  opts: SweepOptions = {},
): SweepResult {
  const r = world.radius;
  const edgeMargin = opts.edgeMargin ?? 0.5 * r;
  const hitMargin = opts.hitMargin ?? r;
  const slideBand = opts.slideBand ?? 0.1 * r;
  const contactSlop = opts.contactSlop ?? 2e-3;
  const a = dirAxis(d);
  const s = dirSign(d);
  const b = (a + 1) % 3;
  const c = (a + 2) % 3;

  const limit = s > 0 ? world.max[a] - r : world.min[a] + r;
  let best = Math.max(0, (limit - p[a]) * s);
  let hit = -1;
  let ambiguousAt = Infinity;
  let ambiguousSolid = -1;

  for (let i = 0; i < world.solids.length; i++) {
    const box = world.solids[i];
    const entry = s > 0 ? box.min[a] - r - p[a] : p[a] - (box.max[a] + r);
    if (entry < -contactSlop) continue; // behind us (or we are inside it)
    const db = Math.min(p[b] - (box.min[b] - r), box.max[b] + r - p[b]);
    const dc = Math.min(p[c] - (box.min[c] - r), box.max[c] + r - p[c]);
    // inside > 0: within the inflated cross-section; inside - r > 0: over the face itself.
    const inside = Math.min(db, dc);
    if (inside - r > hitMargin) {
      if (entry < best) {
        best = Math.max(0, entry);
        hit = i;
      }
    } else if (inside > -edgeMargin && Math.abs(inside) > slideBand) {
      // rounded edge or corner: the engine could deflect here
      if (entry < ambiguousAt) {
        ambiguousAt = entry;
        ambiguousSolid = i;
      }
    }
  }

  if (ambiguousAt <= best + 1e-6) {
    return { ok: false, reason: 'ambiguous', solid: ambiguousSolid, at: ambiguousAt };
  }
  const end: V3 = [p[0], p[1], p[2]];
  end[a] = p[a] + s * best;
  return { ok: true, end: quantizeV(end), distance: best, hit };
}

/** True when the sphere at `p` overlaps the room walls or any solid. */
export function overlaps(world: SweepWorld, p: V3, eps = 2e-4): boolean {
  const r = world.radius;
  for (let a = 0; a < 3; a++) {
    if (p[a] < world.min[a] + r - eps || p[a] > world.max[a] - r + eps) return true;
  }
  for (const box of world.solids) {
    let inside = true;
    for (let a = 0; a < 3; a++) {
      if (p[a] <= box.min[a] - r + eps || p[a] >= box.max[a] + r - eps) {
        inside = false;
        break;
      }
    }
    if (inside) return true;
  }
  return false;
}

/**
 * Cast a ray from `p` along a room axis and return the distance to the first
 * box face or room boundary (radius ignored). Used for gravity-aligned blob
 * shadows and landing markers.
 */
export function castAxis(world: SweepWorld, p: V3, d: Dir): { distance: number; hit: number } {
  const a = dirAxis(d);
  const s = dirSign(d);
  const b = (a + 1) % 3;
  const c = (a + 2) % 3;
  let best = Math.max(0, ((s > 0 ? world.max[a] : world.min[a]) - p[a]) * s);
  let hit = -1;
  for (let i = 0; i < world.solids.length; i++) {
    const box = world.solids[i];
    if (p[b] < box.min[b] || p[b] > box.max[b] || p[c] < box.min[c] || p[c] > box.max[c]) continue;
    const t = s > 0 ? box.min[a] - p[a] : p[a] - box.max[a];
    if (t >= -2e-3 && t < best) {
      best = Math.max(0, t);
      hit = i;
    }
  }
  return { distance: best, hit };
}
