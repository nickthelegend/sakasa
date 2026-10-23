import {
  PhysicsManipulation,
  PhysicsSystem,
  Vector3,
  VisibilityState,
  createSystem,
} from '@iwsdk/core';
import { DIR_NAMES, type Dir, Dir as D, dirToWorld, dirVector } from '@sakasa/core';
import { type SurfaceTone, synth } from './audio.js';
import { Marble, Toy } from './components.js';
import { emit, logEvent, store } from './store.js';

export const EARTH = 9.81;
export const GENTLE = 4.2;
const SLOWMO_START = 0.2;
const SLOWMO_SECONDS = 0.95;

export interface FlipRequest {
  dir: Dir;
  source: 'pinch' | 'reset' | 'undo' | 'replay';
  surfaceId?: string;
  tone?: SurfaceTone;
  point?: Vector3;
}

/**
 * Owns which way is down. A flip sets the Havok world gravity (IWSDK's
 * reactive PhysicsSystem config), wakes every body, and plays the flip:
 * a short slow-motion ramp, the whoomp, and the surface pulse.
 *
 * Slow motion scales the delta the PhysicsSystem integrates; it keeps
 * stepping at a fixed interval, so the simulation itself is unchanged and
 * frame-stepped replays (ecs step) are not affected.
 */
export class GravitySystem extends createSystem({
  toys: { required: [Toy] },
  marbles: { required: [Marble] },
}) {
  private physics!: PhysicsSystem;
  private slowmoT = -1;
  private readonly g = new Vector3();

  init(): void {
    this.physics = this.world.getSystem(PhysicsSystem)!;
    const original = this.physics.update.bind(this.physics);
    this.physics.update = (delta: number) => original(delta * store.timeScale);
    this.applyGravity(D.NegY);
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        const blurred = v === VisibilityState.VisibleBlurred;
        if (blurred && !store.paused) {
          store.paused = true;
          logEvent('pause', 'session blurred');
          emit('pause');
        }
      }),
    );
    (globalThis as unknown as { __sakasaFlip?: (r: FlipRequest) => void }).__sakasaFlip = (r) => this.flip(r);
  }

  /** World-space gravity vector for a room-frame direction. */
  gravityVector(dir: Dir, out: Vector3): Vector3 {
    const room = store.room;
    const v = dirVector(dir);
    const w = room ? dirToWorld(room.frame, v) : v;
    const mag = store.settings.gentle ? GENTLE : EARTH;
    return out.set(w[0] * mag, w[1] * mag, w[2] * mag);
  }

  applyGravity(dir: Dir): void {
    this.gravityVector(dir, this.g);
    this.physics.config.gravity.value = [this.g.x, this.g.y, this.g.z];
  }

  flip(req: FlipRequest): void {
    const changed = req.dir !== store.gravity;
    store.gravity = req.dir;
    this.applyGravity(req.dir);
    this.wakeAll();
    if (req.source === 'pinch') {
      store.totalFlips++;
      this.slowmoT = 0;
      store.timeScale = SLOWMO_START;
      if (req.point) synth.whoomp(req.tone ?? 'wall', req.point.x, req.point.y, req.point.z);
      synth.whoosh();
    }
    logEvent('flip', `${req.source} ${DIR_NAMES[req.dir]}${req.surfaceId ? ` via ${req.surfaceId}` : ''}${changed ? '' : ' (same)'}`);
    emit('flip', { ...req, changed });
  }

  /** Re-apply the current gravity (after the gentle setting changes). */
  refresh(): void {
    this.applyGravity(store.gravity);
    this.wakeAll();
  }

  private wakeAll(): void {
    // A tiny impulse wakes sleeping bodies so they feel the new gravity.
    this.gravityVector(store.gravity, this.g).multiplyScalar(1e-5);
    const wake = (e: { hasComponent: (c: typeof PhysicsManipulation) => boolean; addComponent: (c: typeof PhysicsManipulation, v: object) => unknown }) => {
      if (!e.hasComponent(PhysicsManipulation)) {
        e.addComponent(PhysicsManipulation, { force: [this.g.x, this.g.y, this.g.z] });
      }
    };
    for (const e of this.queries.toys.entities) wake(e);
    for (const e of this.queries.marbles.entities) wake(e);
  }

  update(delta: number): void {
    if (store.paused || store.menuOpen) {
      store.timeScale = 0;
      return;
    }
    if (this.slowmoT >= 0) {
      this.slowmoT += delta;
      const t = Math.min(1, this.slowmoT / SLOWMO_SECONDS);
      const ease = t * t * (3 - 2 * t);
      store.timeScale = SLOWMO_START + (1 - SLOWMO_START) * ease;
      if (t >= 1) this.slowmoT = -1;
    } else {
      store.timeScale = store.timeOverride ?? 1;
    }
  }
}
