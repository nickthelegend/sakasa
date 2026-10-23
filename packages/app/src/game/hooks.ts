import type { World } from '@iwsdk/core';
import { type Dir, DIR_NAMES, toWorld } from '@sakasa/core';
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
    debug: {
      startPuzzle: (i: number) => play().startPuzzle(i),
      sandbox: () => play().startSandbox(),
      dropAll: () => play().dropAll(),
      flip: (dir: Dir) => world.getSystem(GravitySystem)!.flip({ dir, source: 'replay' }),
    },
  };
  (window as unknown as { __sakasa: typeof api }).__sakasa = api;
}
