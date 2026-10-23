import type { World } from '@iwsdk/core';
import { type Box, type Dir, DIR_NAMES, type V3, toRoom, toWorld } from '@sakasa/core';

function pointSegDist(p: number[], a: V3, b: V3): number {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2];
  const t = Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / Math.max(l2, 1e-9)));
  return Math.hypot(ap[0] - ab[0] * t, ap[1] - ab[1] * t, ap[2] - ab[2] * t);
}

/** Does the segment a->b pass through any box inflated by `m` (slab test)? */
function segmentBlocked(a: V3, b: V3, boxes: Box[], m: number): boolean {
  for (const box of boxes) {
    let t0 = 0;
    let t1 = 0.97;
    let hit = true;
    for (let k = 0; k < 3; k++) {
      const d = b[k] - a[k];
      const lo = box.min[k] - m;
      const hi = box.max[k] + m;
      if (Math.abs(d) < 1e-9) {
        if (a[k] < lo || a[k] > hi) {
          hit = false;
          break;
        }
      } else {
        let ta = (lo - a[k]) / d;
        let tb = (hi - a[k]) / d;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) {
          hit = false;
          break;
        }
      }
    }
    if (hit) return true;
  }
  return false;
}
import { GravitySystem } from './gravity-system.js';
import { perf } from './perf.js';
import { PlaySystem } from './play-system.js';
import { store } from './store.js';

export const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Read-only state for the emulator e2e scripts (window.__sakasa), plus a few
 * debug actions that are used only for deterministic replays and clip setup.
 * Hands-only completion tests never call `debug`: they pinch real surfaces
 * and buttons through IWER.
 */
export function installHooks(world: World): void {
  const play = () => world.getSystem(PlaySystem)!;
  const bodies = () => play().bodyStates();
  const api = {
    version: 1,
    state() {
      const room = store.room;
      const p = store.puzzle;
      return {
        mode: store.mode,
        gravity: DIR_NAMES[store.gravity],
        gravityDir: store.gravity,
        totalFlips: store.totalFlips,
        onboardingStep: store.onboardingStep,
        menuOpen: store.menuOpen,
        paused: store.paused,
        glassesActive: store.glassesActive,
        gazeDetected: store.gazeDetected,
        hoveredSurface: store.hoveredSurface,
        timeScale: store.timeScale,
        settings: { ...store.settings },
        room: room && {
          kind: room.kind,
          planes: store.planeCount,
          size: [r4(room.max[0] - room.min[0]), r4(room.max[1] - room.min[1]), r4(room.max[2] - room.min[2])],
          yawDeg: r4((room.frame.yaw * 180) / Math.PI),
          notes: room.notes,
          surfaces: room.surfaces.map((s) => ({
            id: s.id,
            kind: s.kind,
            real: s.real,
            dir: s.dir,
            center: toWorld(room.frame, s.center).map(r4),
          })),
          solids: room.solids.map((s) => ({ id: s.id, kind: s.kind, label: s.label })),
        },
        puzzle: p && room && {
          id: p.spec.id,
          title: p.spec.title,
          par: p.par,
          solution: p.solution,
          solutionNames: p.solution.map((d) => DIR_NAMES[d]),
          blocks: p.blocks.length,
          goal: toWorld(room.frame, p.goal).map(r4),
          start: toWorld(room.frame, p.start).map(r4),
          state: store.puzzleState,
          flips: store.puzzleFlips,
          stars: store.lastStars,
        },
        marble: play().marbleWorld()?.map(r4) ?? null,
        progress: { ...store.progress },
        log: store.log.slice(-40),
      };
    },
    bodies,
    perf,
    roomInputs: () => store.roomInputs,
    /**
     * A point on a surface that a ray from `from` (world) reaches without
     * passing through furniture, puzzle blocks, the HUD or any body. Test
     * support only: the e2e scripts aim the emulated hand with it.
     */
    aim(surfaceId: string, from: [number, number, number]) {
      const room = store.room;
      if (!room) return null;
      const s = room.surfaces.find((x) => x.id === surfaceId);
      if (!s) return null;
      const solids = [...room.solids, ...(store.puzzle?.blocks ?? [])];
      const fromR = toRoom(room.frame, from);
      const bodies = play().bodyStates().map((b) => toRoom(room.frame, b.p as [number, number, number]));
      const hud = world.getSceneObject('hud-panel');
      const hudR = hud ? toRoom(room.frame, [hud.position.x, hud.position.y, hud.position.z]) : null;
      let best: number[] | null = null;
      let bestScore = Infinity;
      for (let i = -4; i <= 4; i++) {
        for (let j = -4; j <= 4; j++) {
          const u = (i / 10) * s.size[0];
          const v = (j / 10) * s.size[1];
          const p: [number, number, number] = [
            s.center[0] + s.uAxis[0] * u + s.vAxis[0] * v,
            s.center[1] + s.uAxis[1] * u + s.vAxis[1] * v,
            s.center[2] + s.uAxis[2] * u + s.vAxis[2] * v,
          ];
          if (segmentBlocked(fromR, p, solids, 0.08)) continue;
          if (bodies.some((b) => pointSegDist(b, fromR, p) < 0.18)) continue;
          if (hudR && pointSegDist(hudR, fromR, p) < 0.35) continue;
          const d = [p[0] - fromR[0], p[1] - fromR[1], p[2] - fromR[2]];
          const len = Math.hypot(d[0], d[1], d[2]);
          const fwd = room.forward;
          const cos = (d[0] * fwd[0] + d[2] * fwd[2]) / Math.max(1e-6, len);
          const score = (1 - cos) * 2 + Math.hypot(u, v) * 0.15;
          if (score < bestScore) {
            bestScore = score;
            best = toWorld(room.frame, p).map(r4);
          }
        }
      }
      return best;
    },
    debug: {
      startPuzzle: (i: number) => play().startPuzzle(i),
      sandbox: () => play().startSandbox(),
      dropAll: () => play().dropAll(),
      flip: (dir: Dir) => world.getSystem(GravitySystem)!.flip({ dir, source: 'replay' }),
    },
  };
  (window as unknown as { __sakasa: typeof api }).__sakasa = api;
}
