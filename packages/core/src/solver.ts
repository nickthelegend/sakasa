import { ALL_DIRS, type Dir, type V3, distance } from './math.js';
import { type SweepWorld, sweep } from './sweep.js';

export interface ReachState {
  pos: V3;
  depth: number;
  /** One shortest flip sequence from the start (deterministic: first found in dir order). */
  path: Dir[];
  /** Direction of the last flip (the surface the marble rests against). */
  last: Dir | null;
  /** -1 = room boundary, otherwise the solid index the marble rests on. */
  restsOn: number;
}

export function keyOf(p: V3): string {
  return `${p[0].toFixed(4)},${p[1].toFixed(4)},${p[2].toFixed(4)}`;
}

/**
 * Breadth-first search over gravity flips. Each flip is a sweep; ambiguous
 * sweeps are pruned. Returns every resting position reachable in at most
 * `maxDepth` flips with its minimum flip count.
 */
export function explore(
  world: SweepWorld,
  start: V3,
  maxDepth = 4,
): Map<string, ReachState> {
  const seen = new Map<string, ReachState>();
  const root: ReachState = { pos: start, depth: 0, path: [], last: null, restsOn: -1 };
  seen.set(keyOf(start), root);
  let frontier: ReachState[] = [root];
  for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
    const next: ReachState[] = [];
    for (const state of frontier) {
      for (const d of ALL_DIRS) {
        const res = sweep(world, state.pos, d);
        if (!res.ok || res.distance < 1e-4) continue;
        const k = keyOf(res.end);
        if (seen.has(k)) continue;
        const child: ReachState = {
          pos: res.end,
          depth,
          path: [...state.path, d],
          last: d,
          restsOn: res.hit,
        };
        seen.set(k, child);
        next.push(child);
      }
    }
    frontier = next;
  }
  return seen;
}

/** Shortest flip sequence from `start` that comes to rest within `tol` of `goal`, or null. */
export function solve(
  world: SweepWorld,
  start: V3,
  goal: V3,
  maxDepth = 4,
  tol = 1e-3,
): Dir[] | null {
  if (distance(start, goal) <= tol) return [];
  let best: ReachState | null = null;
  for (const s of explore(world, start, maxDepth).values()) {
    if (distance(s.pos, goal) <= tol && (best == null || s.depth < best.depth)) best = s;
  }
  return best ? best.path : null;
}

/** Replay a flip sequence through the sweep model. Returns each resting position, or null if a flip is ambiguous. */
export function replay(world: SweepWorld, start: V3, flips: readonly Dir[]): V3[] | null {
  const out: V3[] = [start];
  let p = start;
  for (const d of flips) {
    const res = sweep(world, p, d);
    if (!res.ok) return null;
    p = res.end;
    out.push(p);
  }
  return out;
}
