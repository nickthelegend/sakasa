import {
  type Entity,
  Group,
  Mesh,
  type ShaderMaterial,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { type Dir, Dir as D, dirToWorld, sweep, toRoom, toWorld } from '@sakasa/core';
import { type SurfaceTone, synth } from './audio.js';
import { RoomSurface } from './components.js';
import { Dots, makeDownArrow } from './fx.js';
import { GravitySystem } from './gravity-system.js';
import { PlaySystem } from './play-system.js';
import { logEvent, on, store } from './store.js';

/** Glasses mode: a surface must be gazed at this long before a pinch commits. */
export const DWELL_SECONDS = 0.4;

interface PointerLike {
  point?: Vector3;
  pointerId?: number;
  pointerType?: string;
}

interface SurfaceState {
  entity: Entity;
  mesh: Mesh;
  mat: ShaderMaterial;
  id: string;
  dir: Dir;
  hoverIds: Set<number>;
  pressIds: Set<number>;
  hover: number;
  press: number;
  hoverSince: number;
  guide: number;
  detach: () => void;
}

function toneOf(id: string): SurfaceTone {
  if (id === 'floor') return 'floor';
  if (id === 'ceiling') return 'ceiling';
  if (id.startsWith('wall')) return 'wall';
  if (id.startsWith('table')) return 'table';
  return 'furniture';
}

/**
 * Point at a surface (hand ray on Quest, eye gaze on Meta VR Glasses) and it
 * lights up with its "down" chevrons; pinch-and-hold previews the marble's
 * path; release commits the flip. Everything is driven by IWSDK pointer
 * events on RayInteractable surfaces, so hands, gaze and the desktop
 * emulator share one path. No controller code.
 */
export class SurfaceSystem extends createSystem({
  surfaces: { required: [RoomSurface] },
}) {
  private readonly states = new Map<Entity, SurfaceState>();
  private arrow!: Group;
  private dots!: Dots;
  private readonly local = new Vector3();
  private readonly hitWorld = new Vector3();
  private readonly target = new Vector3();
  private readonly normal = new Vector3();
  private readonly dotPts: Vector3[] = [];
  private time = 0;
  private activeHover: SurfaceState | null = null;

  init(): void {
    this.arrow = makeDownArrow();
    this.arrow.name = 'down-arrow';
    this.arrow.visible = false;
    this.dots = new Dots(48, 0.008);
    const holder = new Group();
    holder.name = 'surface-fx';
    holder.add(this.arrow, this.dots.mesh);
    this.world.createTransformEntity(holder, { persistent: true });
    for (let i = 0; i < 48; i++) this.dotPts.push(new Vector3());

    this.cleanupFuncs.push(
      this.queries.surfaces.subscribe('qualify', (e) => this.attach(e)),
      this.queries.surfaces.subscribe('disqualify', (e) => this.detach(e)),
      on('flip', (d) => this.onFlip(d as { dir: Dir; surfaceId?: string; point?: Vector3 })),
    );
  }

  private attach(e: Entity): void {
    const mesh = e.object3D as Mesh;
    if (!mesh || this.states.has(e)) return;
    const st: SurfaceState = {
      entity: e,
      mesh,
      mat: mesh.material as ShaderMaterial,
      id: e.getValue(RoomSurface, 'surfaceId') ?? '',
      dir: (e.getValue(RoomSurface, 'dir') ?? D.NegY) as Dir,
      hoverIds: new Set(),
      pressIds: new Set(),
      hover: 0,
      press: 0,
      hoverSince: 0,
      guide: 0,
      detach: () => undefined,
    };
    const enter = (ev: PointerLike) => {
      if (st.hoverIds.size === 0) st.hoverSince = this.time;
      st.hoverIds.add(ev.pointerId ?? 0);
      this.setHit(st, ev);
      synth.tick(false);
    };
    const move = (ev: PointerLike) => this.setHit(st, ev);
    const leave = (ev: PointerLike) => {
      st.hoverIds.delete(ev.pointerId ?? 0);
      st.pressIds.delete(ev.pointerId ?? 0);
    };
    const down = (ev: PointerLike) => {
      st.pressIds.add(ev.pointerId ?? 0);
      this.setHit(st, ev);
    };
    const up = (ev: PointerLike) => {
      const id = ev.pointerId ?? 0;
      if (!st.pressIds.has(id)) return;
      st.pressIds.delete(id);
      this.commit(st, ev);
    };
    const cancel = (ev: PointerLike) => {
      st.pressIds.delete(ev.pointerId ?? 0);
      st.hoverIds.delete(ev.pointerId ?? 0);
    };
    const o = mesh as unknown as {
      addEventListener: (t: string, f: (e: PointerLike) => void) => void;
      removeEventListener: (t: string, f: (e: PointerLike) => void) => void;
    };
    o.addEventListener('pointerenter', enter);
    o.addEventListener('pointermove', move);
    o.addEventListener('pointerleave', leave);
    o.addEventListener('pointerdown', down);
    o.addEventListener('pointerup', up);
    o.addEventListener('pointercancel', cancel);
    st.detach = () => {
      o.removeEventListener('pointerenter', enter);
      o.removeEventListener('pointermove', move);
      o.removeEventListener('pointerleave', leave);
      o.removeEventListener('pointerdown', down);
      o.removeEventListener('pointerup', up);
      o.removeEventListener('pointercancel', cancel);
    };
    this.states.set(e, st);
  }

  private detach(e: Entity): void {
    const st = this.states.get(e);
    if (!st) return;
    st.detach();
    if (this.activeHover === st) this.activeHover = null;
    this.states.delete(e);
  }

  private setHit(st: SurfaceState, ev: PointerLike): void {
    if (!ev.point) return;
    this.local.copy(ev.point);
    st.mesh.worldToLocal(this.local);
    const u = st.mat.uniforms.uHit.value as number[];
    u[0] = this.local.x;
    u[1] = this.local.y;
    this.hitWorld.copy(ev.point);
  }

  /** Is this surface allowed to flip right now (dwell gate in Glasses mode)? */
  armed(st: SurfaceState): boolean {
    if (!store.glassesActive) return true;
    return this.time - st.hoverSince >= DWELL_SECONDS;
  }

  private commit(st: SurfaceState, ev: PointerLike): void {
    if (store.menuOpen || store.mode === 'scanning' || store.mode === 'idle') return;
    if (!this.armed(st)) {
      logEvent('flip-blocked', `${st.id} not yet armed (dwell)`);
      return;
    }
    const point = ev.point ? this.target.copy(ev.point) : st.mesh.getWorldPosition(this.target);
    const u = st.mat.uniforms.uPulse.value as number[];
    this.local.copy(point);
    st.mesh.worldToLocal(this.local);
    u[0] = this.local.x;
    u[1] = this.local.y;
    st.mat.uniforms.uPulseT.value = this.time;
    this.world.getSystem(GravitySystem)!.flip({
      dir: st.dir,
      source: 'pinch',
      surfaceId: st.id,
      tone: toneOf(st.id),
      point: point.clone(),
    });
  }

  private onFlip(d: { dir: Dir; surfaceId?: string }): void {
    for (const st of this.states.values()) {
      st.mat.uniforms.uActive.value = st.dir === d.dir ? 1 : 0;
    }
  }

  /** The surface the onboarding asks for next (highlighted with a slow pulse). */
  private guideDir(): Dir | null {
    if (store.mode !== 'onboarding') return null;
    return ([D.PosY, -1, D.NegY] as (Dir | -1)[])[store.onboardingStep] as Dir | null ?? null;
  }

  update(delta: number): void {
    this.time += delta;
    const guide = this.guideDir();
    const step = store.mode === 'onboarding' ? store.onboardingStep : -1;
    let best: SurfaceState | null = null;
    for (const st of this.states.values()) {
      const hovered = st.hoverIds.size > 0 && !store.menuOpen;
      const pressed = st.pressIds.size > 0;
      // Glasses: the highlight ramps over the dwell time; Quest: it is immediate.
      const target = hovered ? (store.glassesActive ? Math.min(1, (this.time - st.hoverSince) / DWELL_SECONDS) : 1) : 0;
      st.hover += (target - st.hover) * Math.min(1, delta * 14);
      st.press += ((pressed ? 1 : 0) - st.press) * Math.min(1, delta * 14);
      const isGuide =
        (guide != null && guide >= 0 && st.dir === guide && !st.id.includes(':')) ||
        (step === 1 && st.id.startsWith('wall'));
      st.guide += ((isGuide ? 1 : 0) - st.guide) * Math.min(1, delta * 4);
      const pulse = st.guide * (0.5 + 0.5 * Math.sin(this.time * 3.2));
      const m = st.mat.uniforms;
      m.uHover.value = Math.max(st.hover, pulse * 0.55);
      m.uPress.value = st.press;
      m.uTime.value = this.time;
      if (st.guide > 0.01 && st.hoverIds.size === 0) {
        (m.uHit.value as number[])[0] = 0;
        (m.uHit.value as number[])[1] = 0;
      }
      if (hovered && (best == null || st.hover > best.hover)) best = st;
    }
    this.activeHover = best;
    store.hoveredSurface = best ? best.id : null;
    this.updateArrow(best);
    this.updatePreview(best);
  }

  private updateArrow(st: SurfaceState | null): void {
    if (!st || st.hover < 0.05 || !store.room) {
      this.arrow.visible = false;
      return;
    }
    const room = store.room;
    const nRoom = room.surfaces.find((s) => s.id === st.id)?.normal ?? [0, 1, 0];
    const n = dirToWorld(room.frame, nRoom);
    this.normal.set(n[0], n[1], n[2]);
    // the arrow floats off the surface at the pointed spot and points into it
    const lift = 0.22 + 0.06 * Math.sin(this.time * 5);
    this.arrow.position.copy(this.hitWorld).addScaledVector(this.normal, lift);
    this.target.copy(this.arrow.position).add(this.normal);
    this.arrow.lookAt(this.target);
    this.arrow.scale.setScalar(0.6 + 0.4 * st.hover + 0.3 * st.press);
    this.arrow.visible = true;
    for (let i = 0; i < 3; i++) {
      const c = this.arrow.children[i];
      c.position.z = 0.09 - i * 0.07 - ((this.time * 0.25) % 0.07);
    }
  }

  /** Pinch-and-hold: dots trace where the marble would fall. */
  private updatePreview(st: SurfaceState | null): void {
    const room = store.room;
    const play = this.world.getSystem(PlaySystem);
    const world = play?.sweepWorld();
    const mw = play?.marbleWorld();
    if (!st || st.press < 0.5 || !room || !world || !mw) {
      this.dots.clear();
      return;
    }
    const start = toRoom(room.frame, mw);
    const res = sweep(world, start, st.dir);
    const end = res.ok ? res.end : start;
    const len = Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]);
    const count = Math.min(48, Math.max(2, Math.floor(len / 0.06)));
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      const w = toWorld(room.frame, [
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
        start[2] + (end[2] - start[2]) * t,
      ]);
      this.dotPts[i].set(w[0], w[1], w[2]);
    }
    this.dots.set(this.dotPts, count);
  }
}
