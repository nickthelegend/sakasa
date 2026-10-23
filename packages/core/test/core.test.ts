import { describe, expect, it } from 'vitest';
import {
  Dir,
  PUZZLES,
  Rng,
  SYNTHETIC_ROOMS,
  buildRoom,
  dailySeed,
  dailySpec,
  dirToWorld,
  distance,
  explore,
  generatePuzzle,
  hashString,
  latticeOf,
  overlaps,
  replay,
  solve,
  stars,
  sweep,
  toRoom,
  toWorld,
  verifyPuzzle,
  type SweepWorld,
  type V3,
} from '../src/index.js';

const box = (min: V3, max: V3) => ({ min, max });

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    const xs = Array.from({ length: 50 }, () => a.next());
    const ys = Array.from({ length: 50 }, () => b.next());
    expect(xs).toEqual(ys);
    expect(new Set(xs).size).toBe(50);
    for (const x of xs) expect(x >= 0 && x < 1).toBe(true);
  });

  it('daily seed changes per UTC day and not within one', () => {
    const morning = dailySeed(new Date('2026-11-18T00:05:00Z'));
    const night = dailySeed(new Date('2026-11-18T23:55:00Z'));
    const next = dailySeed(new Date('2026-11-19T00:05:00Z'));
    expect(morning).toBe(night);
    expect(morning).not.toBe(next);
    expect(hashString('a')).not.toBe(hashString('b'));
  });
});

describe('sweep', () => {
  const world: SweepWorld = {
    min: [-2, 0, -2],
    max: [2, 2.5, 2],
    solids: [box([-0.25, 0, -1.25], [0.25, 0.5, -0.75])],
    radius: 0.06,
  };

  it('falls straight down to the floor', () => {
    const r = sweep(world, [1, 2, 1], Dir.NegY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.end).toEqual([1, 0.06, 1]);
      expect(r.hit).toBe(-1);
    }
  });

  it('lands on top of a block', () => {
    const r = sweep(world, [0, 2, -1], Dir.NegY);
    expect(r.ok && r.end[1]).toBe(0.56);
    expect(r.ok && r.hit).toBe(0);
  });

  it('flies sideways to a wall, keeping its height', () => {
    const r = sweep(world, [1, 0.06, 1], Dir.PosX);
    expect(r.ok && r.end).toEqual([1.94, 0.06, 1]);
  });

  it('stops against the side of a block', () => {
    const r = sweep(world, [-1.5, 0.2, -1], Dir.PosX);
    expect(r.ok && r.end[0]).toBeCloseTo(-0.31, 6);
  });

  it('slides along the floor past nothing when the block is out of the lane', () => {
    const r = sweep(world, [-1.5, 0.06, 0.5], Dir.PosX);
    expect(r.ok && r.end[0]).toBeCloseTo(1.94, 6);
  });

  it('reports a glancing edge hit as ambiguous', () => {
    // centre 0.02 m inside the inflated edge of the block (z = -0.75 + 0.06 - 0.02)
    const r = sweep(world, [-1.5, 0.2, -0.71], Dir.PosX);
    expect(r.ok).toBe(false);
  });

  it('treats a marble resting on top of the block as sliding, not blocked', () => {
    const r = sweep(world, [0, 0.56, -1], Dir.PosX);
    expect(r.ok && r.end[0]).toBeCloseTo(1.94, 6);
  });

  it('does not move when already resting that way', () => {
    const r = sweep(world, [1, 0.06, 1], Dir.NegY);
    expect(r.ok && r.distance).toBe(0);
  });

  it('detects overlap', () => {
    expect(overlaps(world, [0, 0.3, -1])).toBe(true);
    expect(overlaps(world, [1, 1, 1])).toBe(false);
    expect(overlaps(world, [1.99, 1, 1])).toBe(true);
  });
});

describe('solver', () => {
  const world: SweepWorld = {
    min: [-2, 0, -2],
    max: [2, 2.5, 2],
    solids: [box([-0.25, 0, -1.25], [0.25, 0.5, -0.75])],
    radius: 0.06,
  };

  it('finds the shortest flip sequence and replays it', () => {
    const start: V3 = [0, 0.56, -1];
    const goal: V3 = [1.94, 2.44, -1];
    const sol = solve(world, start, goal);
    expect(sol).not.toBeNull();
    expect(sol!.length).toBe(2);
    const path = replay(world, start, sol!)!;
    expect(distance(path[path.length - 1], goal)).toBeLessThan(1e-6);
  });

  it('returns null for an unreachable goal', () => {
    expect(solve(world, [0, 0.56, -1], [0.3, 1.1, 0.3], 4)).toBeNull();
  });

  it('explores deterministically', () => {
    const a = [...explore(world, [0, 0.56, -1], 4).keys()];
    const b = [...explore(world, [0, 0.56, -1], 4).keys()];
    expect(a).toEqual(b);
    expect(a.length).toBeGreaterThan(10);
  });
});

describe('room model', () => {
  it('builds a box room from planes with real walls, floor and ceiling', () => {
    const r = SYNTHETIC_ROOMS.find((x) => x.name === 'small-study')!;
    const room = buildRoom(r.planes, { head: r.head });
    expect(room.kind).toBe('room');
    expect(room.max[1]).toBeCloseTo(2.4, 6);
    expect(room.max[0] - room.min[0]).toBeCloseTo(3.0, 6);
    expect(room.max[2] - room.min[2]).toBeCloseTo(3.2, 6);
    expect(room.surfaces.filter((s) => s.real).length).toBe(7); // 6 boundary + table
    expect(room.solids).toHaveLength(1);
    expect(room.solids[0].kind).toBe('table');
    expect(room.solids[0].max[1]).toBeCloseTo(0.74, 6);
    expect(room.notes).toEqual([]);
  });

  it('aligns the frame with a rotated room', () => {
    const r = SYNTHETIC_ROOMS.find((x) => x.name === 'rotated-loft')!;
    const room = buildRoom(r.planes, { head: r.head });
    expect((room.frame.yaw * 180) / Math.PI).toBeCloseTo(23, 4);
    expect(room.max[0] - room.min[0]).toBeCloseTo(6.5, 4);
    expect(room.max[2] - room.min[2]).toBeCloseTo(7.0, 4);
    // round trip
    const p: V3 = [1.2, 0.7, -2.1];
    const q = toRoom(room.frame, toWorld(room.frame, p));
    expect(distance(p, q)).toBeLessThan(1e-9);
    const down = dirToWorld(room.frame, [0, -1, 0]);
    expect(down[1]).toBeCloseTo(-1, 9);
  });

  it('stands in a labelled paper ceiling when there is none', () => {
    const r = SYNTHETIC_ROOMS.find((x) => x.name === 'no-ceiling')!;
    const room = buildRoom(r.planes, { head: r.head });
    const ceiling = room.surfaces.find((s) => s.id === 'ceiling')!;
    expect(ceiling.real).toBe(false);
    expect(ceiling.label).toBe('paper ceiling');
    expect(room.max[1]).toBe(2.4);
    expect(room.notes.join(' ')).toMatch(/paper ceiling/);
  });

  it('builds the virtual tabletop room with no planes', () => {
    const room = buildRoom([], { head: [0, 1.2, 0] });
    expect(room.kind).toBe('tabletop');
    expect(room.surfaces.every((s) => !s.real)).toBe(true);
    const c = toWorld(room.frame, [0, 0, 0]);
    expect(c[2]).toBeLessThan(-0.5);
  });

  it('replaces a missing wall with a paper wall and a far wall with a capped one', () => {
    const r = SYNTHETIC_ROOMS.find((x) => x.name === 'small-study')!;
    const planes = r.planes.filter((p) => p.id !== 'wall-e');
    const room = buildRoom(planes, { head: r.head });
    const east = room.surfaces.find((s) => s.id === 'wall+x')!;
    expect(east.real).toBe(false);
    expect(room.max[0]).toBeCloseTo(1.8, 6);
  });

  it('never puts furniture under the viewer', () => {
    const room = buildRoom(
      [
        { id: 'f', label: 'floor', center: [0, 0, 0], normal: [0, 1, 0], axisU: [1, 0, 0], halfU: 2, halfV: 2 },
        { id: 'c', label: 'couch', center: [0, 0.45, 0], normal: [0, 1, 0], axisU: [1, 0, 0], halfU: 1, halfV: 0.4 },
      ],
      { head: [0, 1.2, 0] },
    );
    expect(room.solids).toHaveLength(0);
  });

  it('cuts the room into whole cells wall to wall', () => {
    const r = SYNTHETIC_ROOMS[1];
    const room = buildRoom(r.planes, { head: r.head });
    const l = latticeOf(room);
    for (let a = 0; a < 3; a++) {
      expect(l.min[a] + l.counts[a] * l.size[a]).toBeCloseTo(room.max[a], 9);
      expect(l.size[a]).toBeGreaterThan(2 * room.radius);
    }
  });
});

describe('puzzles', () => {
  it('ships 20 puzzles in 3 sets', () => {
    expect(PUZZLES).toHaveLength(20);
    expect(PUZZLES.filter((p) => p.set === 1)).toHaveLength(6);
    expect(PUZZLES.filter((p) => p.set === 2)).toHaveLength(7);
    expect(PUZZLES.filter((p) => p.set === 3)).toHaveLength(7);
    expect(new Set(PUZZLES.map((p) => p.seed)).size).toBe(20);
  });

  it('rates stars against par', () => {
    expect(stars(2, 2)).toBe(3);
    expect(stars(4, 2)).toBe(2);
    expect(stars(5, 2)).toBe(1);
  });

  for (const r of SYNTHETIC_ROOMS) {
    it(`every shipped puzzle is solvable within 4 flips in ${r.name}`, () => {
      const room = buildRoom(r.planes, { head: r.head });
      for (const spec of PUZZLES) {
        const p = generatePuzzle(room, spec);
        expect(p.par).toBeGreaterThanOrEqual(1);
        expect(p.par).toBeLessThanOrEqual(4);
        const v = verifyPuzzle(p);
        expect(v, `${spec.id}: ${v.reason}`).toEqual({ ok: true });
        const sol = solve(p.world, p.start, p.goal, 4);
        expect(sol).not.toBeNull();
        expect(sol!.length).toBe(p.par);
        // pieces never overlap the start or the goal
        expect(overlaps(p.world, p.start)).toBe(false);
        expect(overlaps(p.world, p.goal)).toBe(false);
      }
    });
  }

  it('meets the target par in the real-size rooms for most puzzles', () => {
    let met = 0;
    let total = 0;
    for (const r of SYNTHETIC_ROOMS.slice(0, 4)) {
      const room = buildRoom(r.planes, { head: r.head });
      for (const spec of PUZZLES) {
        const p = generatePuzzle(room, spec);
        total++;
        if (p.par === spec.targetDepth) met++;
      }
    }
    expect(met / total).toBeGreaterThanOrEqual(0.9);
  });

  it('daily puzzles for 60 days are solvable in every synthetic room', () => {
    for (const r of SYNTHETIC_ROOMS) {
      const room = buildRoom(r.planes, { head: r.head });
      for (let d = 0; d < 60; d++) {
        const date = new Date(Date.UTC(2026, 10, 1 + d));
        const p = generatePuzzle(room, dailySpec(date));
        expect(verifyPuzzle(p).ok).toBe(true);
      }
    }
  });

  it('generation and solving are deterministic (3 identical runs)', () => {
    const r = SYNTHETIC_ROOMS[2];
    const runs = [0, 1, 2].map(() => {
      const room = buildRoom(r.planes, { head: r.head });
      return PUZZLES.map((spec) => {
        const p = generatePuzzle(room, spec);
        return JSON.stringify([p.start, p.goal, p.goalDir, p.par, p.solution, p.blocks, solve(p.world, p.start, p.goal)]);
      });
    });
    expect(runs[1]).toEqual(runs[0]);
    expect(runs[2]).toEqual(runs[0]);
  });

  it('the same seed adapts to different rooms', () => {
    const spec = PUZZLES[10];
    const goals = SYNTHETIC_ROOMS.map((r) => {
      const p = generatePuzzle(buildRoom(r.planes, { head: r.head }), spec);
      return p.goal.join(',');
    });
    expect(new Set(goals).size).toBe(goals.length);
  });

  it('set 3 puzzles mostly use the ceiling', () => {
    const r = SYNTHETIC_ROOMS[0];
    const room = buildRoom(r.planes, { head: r.head });
    const set3 = PUZZLES.filter((p) => p.set === 3 && p.preferCeiling);
    const usesCeiling = set3.filter((spec) => generatePuzzle(room, spec).solution.includes(Dir.PosY));
    expect(usesCeiling.length / set3.length).toBeGreaterThanOrEqual(0.6);
  });
});
