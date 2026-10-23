import { type Dir, type V3, Dir as D, boxesOverlap, distance, opposite } from './math.js';
import {
  type Lattice,
  type RoomModel,
  type Solid,
  cellBox,
  cellCenter,
  latticeOf,
} from './room.js';
import { Rng, dailySeed, hashString, utcDateKey } from './rng.js';
import { type ReachState, explore, replay } from './solver.js';
import { type SweepWorld, overlaps, sweep } from './sweep.js';

export type PuzzleSet = 1 | 2 | 3;

export interface PuzzleSpec {
  id: string;
  set: PuzzleSet;
  index: number;
  title: string;
  seed: number;
  /** Minimum flips the generated puzzle must need (its par). */
  targetDepth: number;
  blocks: [number, number];
  /** Prefer goals whose shortest solution uses the ceiling. */
  preferCeiling: boolean;
}

export const SET_NAMES: Record<PuzzleSet, string> = {
  1: 'Fall',
  2: 'Sideways',
  3: 'Upside down',
};

const SET_RULES: Record<PuzzleSet, { depths: number[]; blocks: [number, number]; ceiling: boolean }> = {
  1: { depths: [1, 1, 2, 2, 2, 2], blocks: [0, 2], ceiling: false },
  2: { depths: [2, 2, 3, 3, 3, 3, 3], blocks: [2, 5], ceiling: false },
  3: { depths: [3, 3, 3, 4, 4, 4, 4], blocks: [4, 8], ceiling: true },
};

const TITLES = [
  'First fall', 'Over the edge', 'Two steps', 'Shelf life', 'Corner pocket', 'Drop zone',
  'Sideways', 'Wall run', 'Detour', 'Ricochet', 'Ledge', 'Crosswind', 'Long way round',
  'Upside down', 'Skylight', 'Vault', 'Loop', 'Attic', 'Gravity well', 'The whole room',
];

/** The 20 shipped puzzles in 3 sets (6 + 7 + 7). */
export const PUZZLES: readonly PuzzleSpec[] = (() => {
  const out: PuzzleSpec[] = [];
  let n = 0;
  for (const set of [1, 2, 3] as PuzzleSet[]) {
    const rules = SET_RULES[set];
    rules.depths.forEach((depth, i) => {
      out.push({
        id: `p${String(n + 1).padStart(2, '0')}`,
        set,
        index: n,
        title: TITLES[n],
        seed: hashString(`sakasa-puzzle-${n + 1}`),
        targetDepth: depth,
        blocks: rules.blocks,
        preferCeiling: rules.ceiling && i >= 2,
      });
      n++;
    });
  }
  return out;
})();

export function dailySpec(date: Date): PuzzleSpec {
  return {
    id: `daily-${utcDateKey(date)}`,
    set: 3,
    index: -1,
    title: `Daily ${utcDateKey(date)}`,
    seed: dailySeed(date),
    targetDepth: 3,
    blocks: [3, 7],
    preferCeiling: false,
  };
}

export interface Puzzle {
  spec: PuzzleSpec;
  /** Generated paper blocks (static colliders). */
  blocks: Solid[];
  /** Sweep world: room box, furniture and blocks. */
  world: SweepWorld;
  start: V3;
  goal: V3;
  /** Gravity direction of the winning flip; the goal cup sits on that side. */
  goalDir: Dir;
  /** Minimum number of flips (the par). */
  par: number;
  /** One shortest solution. */
  solution: Dir[];
  /** How many layouts the generator tried before this one. */
  attempts: number;
}

/** The marble wins when it settles within this distance of the goal centre. */
export function winRadius(world: SweepWorld): number {
  return 1.25 * world.radius;
}

export function stars(flips: number, par: number): 1 | 2 | 3 {
  if (flips <= par) return 3;
  if (flips <= par + 2) return 2;
  return 1;
}

function horizontalAngle(from: V3, to: V3, forward: V3): number {
  const dx = to[0] - from[0];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return 0;
  const c = (dx * forward[0] + dz * forward[2]) / len;
  return (Math.acos(Math.max(-1, Math.min(1, c))) * 180) / Math.PI;
}

function horizontalDistance(a: V3, b: V3): number {
  return Math.hypot(a[0] - b[0], a[2] - b[2]);
}

function baseWorld(room: RoomModel, blocks: Solid[]): SweepWorld {
  return {
    min: room.min,
    max: room.max,
    solids: [...room.solids, ...blocks],
    radius: room.radius,
  };
}

/**
 * Generate a puzzle for this room from a spec. Deterministic: the same spec
 * in the same room always gives the same puzzle. Solvability is by
 * construction: the goal is a resting position the solver reached at exactly
 * the target depth (the minimum flips), and the tests replay it.
 */
export function generatePuzzle(room: RoomModel, spec: PuzzleSpec): Puzzle {
  const rng = new Rng(spec.seed);
  const lattice = latticeOf(room);
  const near = room.kind === 'tabletop' ? 0 : 0.75;
  for (let depth = spec.targetDepth; depth >= 1; depth--) {
    for (let attempt = 0; attempt < 80; attempt++) {
      const blocks = placeBlocks(room, lattice, rng, spec, near);
      const world = baseWorld(room, blocks);
      const start = pickStart(room, lattice, world, rng);
      if (!start) continue;
      const reach = explore(world, start, depth);
      const goalState = pickGoal(room, world, reach, start, depth, rng, spec.preferCeiling);
      if (!goalState || goalState.last == null) continue;
      return {
        spec,
        blocks,
        world,
        start,
        goal: goalState.pos,
        goalDir: goalState.last,
        par: goalState.depth,
        solution: goalState.path,
        attempts: attempt + 1,
      };
    }
  }
  throw new Error(`Could not generate puzzle ${spec.id} in this room`);
}

function placeBlocks(
  room: RoomModel,
  lattice: Lattice,
  rng: Rng,
  spec: PuzzleSpec,
  near: number,
): Solid[] {
  const [lo, hi] = spec.blocks;
  const count = rng.int(lo, hi);
  const blocks: Solid[] = [];
  const [nx, ny, nz] = lattice.counts;
  let guard = 0;
  while (blocks.length < count && guard++ < 400) {
    const i = rng.int(0, nx - 1);
    const k = rng.int(0, nz - 1);
    // Most blocks rest against a surface (floor, ceiling or furniture top).
    const attach = rng.next();
    let j: number;
    if (attach < 0.45) j = 0;
    else if (attach < 0.6) j = ny - 1;
    else j = rng.int(1, Math.max(1, ny - 2));
    const box = cellBox(lattice, i, j, k);
    const center = cellCenter(lattice, i, j, k);
    if (near > 0 && horizontalDistance(center, room.head) < near) continue;
    if (room.solids.some((s) => boxesOverlap(s, box, 1e-4))) {
      // Put it on top of the furniture instead.
      const top = room.solids.find((s) => boxesOverlap(s, box, 1e-4));
      if (!top) continue;
      const above = Math.ceil((top.max[1] - lattice.min[1]) / lattice.size[1] - 1e-6);
      if (above >= ny) continue;
      const b2 = cellBox(lattice, i, above, k);
      if (room.solids.some((s) => boxesOverlap(s, b2, 1e-4))) continue;
      b2.min[1] = top.max[1];
      if (b2.max[1] - b2.min[1] < 0.5 * lattice.size[1]) continue;
      if (blocks.some((b) => boxesOverlap(b, b2, 1e-4))) continue;
      blocks.push({ ...b2, id: `block-${blocks.length}`, kind: 'block', label: 'paper block' });
      continue;
    }
    if (blocks.some((b) => boxesOverlap(b, box, 1e-4))) continue;
    blocks.push({ ...box, id: `block-${blocks.length}`, kind: 'block', label: 'paper block' });
  }
  return blocks;
}

function pickStart(
  room: RoomModel,
  lattice: Lattice,
  world: SweepWorld,
  rng: Rng,
): V3 | null {
  const [nx, , nz] = lattice.counts;
  const candidates: { p: V3; onTable: boolean }[] = [];
  const minDist = room.kind === 'tabletop' ? 0 : 0.8;
  const maxDist = room.kind === 'tabletop' ? 10 : 2.4;
  for (let i = 0; i < nx; i++) {
    for (let k = 0; k < nz; k++) {
      const c = cellCenter(lattice, i, 0, k);
      const hd = horizontalDistance(c, room.head);
      if (hd < minDist || hd > maxDist) continue;
      if (room.kind === 'room' && horizontalAngle(room.head, c, room.forward) > 50) continue;
      const top: V3 = [c[0], room.max[1] - room.radius - 1e-3, c[2]];
      if (overlaps(world, top)) continue;
      const res = sweep(world, top, D.NegY);
      if (!res.ok) continue;
      const onTable = res.hit >= 0 && world.solids[res.hit] != null && (world.solids[res.hit] as Solid).kind === 'table';
      candidates.push({ p: res.end, onTable });
    }
  }
  if (candidates.length === 0) return null;
  const tables = candidates.filter((c) => c.onTable);
  const pool = tables.length > 0 && rng.next() < 0.75 ? tables : candidates;
  return rng.pick(pool).p;
}

function pickGoal(
  room: RoomModel,
  world: SweepWorld,
  reach: Map<string, ReachState>,
  start: V3,
  depth: number,
  rng: Rng,
  preferCeiling: boolean,
): ReachState | null {
  const minHeadDist = room.kind === 'tabletop' ? 0.15 : 0.7;
  const shallower = [...reach.values()].filter((s) => s.depth < depth);
  const exclusion = 2 * winRadius(world);
  const options: { s: ReachState; w: number }[] = [];
  for (const s of reach.values()) {
    if (s.depth !== depth) continue;
    // A goal must not sit next to a spot fewer flips can reach.
    if (shallower.some((o) => distance(o.pos, s.pos) < exclusion)) continue;
    if (distance(s.pos, start) < 2 * room.radius) continue;
    if (distance(s.pos, room.head) < minHeadDist) continue;
    const ang = horizontalAngle(room.head, s.pos, room.forward);
    if (room.kind === 'room' && ang > 110) continue;
    let w = 1;
    if (s.restsOn >= 0) w += 2; // resting on a block or furniture reads as a designed spot
    if (ang < 60) w += 2;
    if (preferCeiling && s.path.includes(D.PosY)) w += 12;
    // Avoid an immediate undo-style final flip (A then opposite(A)) as the whole solution.
    if (s.path.length >= 2 && s.path[s.path.length - 1] === opposite(s.path[s.path.length - 2])) w *= 0.5;
    options.push({ s, w });
  }
  if (options.length === 0) return null;
  const total = options.reduce((a, o) => a + o.w, 0);
  let t = rng.next() * total;
  for (const o of options) {
    t -= o.w;
    if (t <= 0) return o.s;
  }
  return options[options.length - 1].s;
}

/** Check a puzzle: its solution replays to the goal and nothing shorter exists. */
export function verifyPuzzle(p: Puzzle): { ok: boolean; reason?: string } {
  const path = replay(p.world, p.start, p.solution);
  if (!path) return { ok: false, reason: 'solution contains an ambiguous flip' };
  if (distance(path[path.length - 1], p.goal) > 1e-3) return { ok: false, reason: 'solution misses the goal' };
  const reach = explore(p.world, p.start, p.par);
  const tol = winRadius(p.world);
  for (const s of reach.values()) {
    if (distance(s.pos, p.goal) <= tol && s.depth < p.par) {
      return { ok: false, reason: `goal reachable in ${s.depth} < par ${p.par}` };
    }
  }
  return { ok: true };
}
