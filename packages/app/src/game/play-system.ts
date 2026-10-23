import {
  DistanceGrabbable,
  type Entity,
  GrabSystem,
  Grabbed,
  Group,
  MovementMode,
  Object3D,
  PhysicsBody,
  PhysicsManipulation,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  PhysicsSystem,
  PointLight,
  Quaternion,
  RayInteractable,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import {
  type Dir,
  Dir as D,
  PUZZLES,
  type Puzzle,
  type PuzzleSpec,
  type RoomModel,
  type SweepWorld,
  type V3,
  castAxis,
  dailySpec,
  dirToWorld,
  dirVector,
  generatePuzzle,
  stars,
  toRoom,
  toWorld,
  winRadius,
} from '@sakasa/core';
import { type SurfaceTone, synth } from './audio.js';
import { GoalCup, Marble, PaperBlock, Toy } from './components.js';
import {
  BlobShadows,
  FLIP,
  type ToyKind,
  Sparks,
  Trail,
  makeBlocksMesh,
  makeGoal,
  makeToyMesh,
} from './fx.js';
import { GravitySystem } from './gravity-system.js';
import { emit, logEvent, on, saveProgress, store } from './store.js';

const TOY_KINDS: ToyKind[] = [
  'marble', 'cube', 'blue-cube', 'ball', 'cube', 'roll',
  'ball', 'cube', 'blue-cube', 'ball', 'roll', 'cube',
];
const MAX_BODIES = 16;
const MARBLE_SLOT = 15;

interface ToySpec {
  kind: ToyKind;
  size: number;
  shape: (typeof PhysicsShapeType)[keyof typeof PhysicsShapeType];
  dims: [number, number, number];
  density: number;
  restitution: number;
  friction: number;
}

function toySpec(kind: ToyKind, scale: number, marbleR: number): ToySpec {
  const s = 0.12 * scale;
  switch (kind) {
    case 'cube':
    case 'blue-cube':
      return { kind, size: s, shape: PhysicsShapeType.Box, dims: [s, s, s], density: 0.5, restitution: 0.25, friction: 0.7 };
    case 'ball':
      return { kind, size: s * 0.5, shape: PhysicsShapeType.Sphere, dims: [s * 0.5 * 0.92, 0, 0], density: 0.3, restitution: 0.5, friction: 0.6 };
    case 'roll':
      return { kind, size: s * 0.5, shape: PhysicsShapeType.Cylinder, dims: [s * 0.45 * 0.5, s * 1.6 * 0.5, 0], density: 0.4, restitution: 0.3, friction: 0.6 };
    default:
      return { kind, size: marbleR, shape: PhysicsShapeType.Sphere, dims: [marbleR, 0, 0], density: 2.5, restitution: 0.45, friction: 0.4 };
  }
}

/**
 * Spawns and runs the play modes: the onboarding toy pile, the sandbox,
 * and solver-generated puzzles (marble, paper blocks, goal ring). Also owns
 * the per-frame juice: marble trail and light, gravity-aligned blob shadows,
 * impact sparks and impact sounds.
 */
export class PlaySystem extends createSystem({
  toys: { required: [Toy] },
  marbles: { required: [Marble] },
  goals: { required: [GoalCup] },
  blocks: { required: [PaperBlock] },
  grabbedToys: { required: [Toy, Grabbed] },
}) {
  private physics!: PhysicsSystem;
  private gravity!: GravitySystem;
  private trail!: Trail;
  private shadows!: BlobShadows;
  private sparks!: Sparks;
  private marbleLight!: PointLight;
  private fxRoot!: Group;
  private readonly prevVel = new Float32Array(MAX_BODIES * 3);
  private readonly sizes = new Float32Array(MAX_BODIES);
  private readonly homes: V3[] = [];
  private winHold = 0;
  private winSlowmoT = -1;
  private readonly eye = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly n = new Vector3();
  private readonly q = new Quaternion();
  private readonly zAxis = new Vector3(0, 0, 1);
  private goalPulse = 0;

  init(): void {
    this.physics = this.world.getSystem(PhysicsSystem)!;
    this.gravity = this.world.getSystem(GravitySystem)!;
    this.fxRoot = new Group();
    this.fxRoot.name = 'fx-root';
    this.trail = new Trail(40, 0.035);
    this.shadows = new BlobShadows(MAX_BODIES + 2);
    this.sparks = new Sparks(96);
    this.marbleLight = new PointLight(FLIP, 0.6, 1.4, 2);
    this.marbleLight.visible = false;
    this.fxRoot.add(this.trail.mesh, this.shadows.mesh, this.sparks.points, this.marbleLight);
    this.world.createTransformEntity(this.fxRoot, { persistent: true });

    this.cleanupFuncs.push(
      on('room', () => this.startOnboarding()),
      on('flip', (d) => this.onFlip(d as { dir: Dir; source: string; changed: boolean })),
      on('mode', () => {
        if (store.mode === 'idle') this.clearAll();
      }),
    );
    this.cleanupFuncs.push(
      this.queries.grabbedToys.subscribe('qualify', (e) => {
        synth.tick(true);
        logEvent('grab', e.object3D?.name ?? 'toy');
      }),
      // Released bodies can be left asleep by the grab; wake them with the
      // hand's release velocity so a flick becomes a throw.
      this.queries.grabbedToys.subscribe('disqualify', (e) => {
        if (!e.hasComponent(PhysicsBody) || e.hasComponent(PhysicsManipulation)) return;
        const v = e.getVectorView(PhysicsBody, '_linearVelocity');
        const vx = Number.isFinite(v[0]) ? v[0] : 0;
        const vy = Number.isFinite(v[1]) ? v[1] : 0;
        const vz = Number.isFinite(v[2]) ? v[2] : 0;
        const tiny = Math.hypot(vx, vy, vz) < 0.01;
        e.addComponent(PhysicsManipulation, { linearVelocity: tiny ? [0, -0.01, 0] : [vx, vy, vz] });
        logEvent('release', e.object3D?.name ?? 'toy');
      }),
    );
  }

  // ------------------------------------------------------------- modes

  startOnboarding(): void {
    this.clearPuzzle();
    store.mode = 'onboarding';
    store.onboardingStep = 0;
    this.spawnToys();
    this.gravity.flip({ dir: D.NegY, source: 'reset' });
    logEvent('mode', 'onboarding');
    emit('mode');
  }

  startSandbox(): void {
    this.clearPuzzle();
    store.mode = 'sandbox';
    if (this.queries.toys.entities.size === 0) this.spawnToys();
    logEvent('mode', 'sandbox');
    emit('mode');
  }

  /** Index into PUZZLES, or -1 for today's daily puzzle. */
  startPuzzle(index: number): void {
    const room = store.room;
    if (!room) return;
    this.clearToys();
    this.clearPuzzle();
    const spec: PuzzleSpec = index < 0 ? dailySpec(new Date()) : PUZZLES[Math.max(0, Math.min(PUZZLES.length - 1, index))];
    let puzzle: Puzzle;
    try {
      puzzle = generatePuzzle(room, spec);
    } catch (error) {
      console.error(`[sakasa] ${spec.id} could not be generated in this room:`, error);
      logEvent('error', `generate ${spec.id} failed`);
      this.startSandbox();
      return;
    }
    store.isDaily = index < 0;
    store.puzzleIndex = index < 0 ? store.puzzleIndex : spec.index;
    store.puzzle = puzzle;
    store.puzzleFlips = 0;
    store.puzzleState = 'playing';
    store.undo = [];
    store.mode = 'puzzle';
    store.timeOverride = null;
    this.winHold = 0;
    this.buildPuzzle(room, puzzle);
    this.gravity.flip({ dir: D.NegY, source: 'reset' });
    logEvent('puzzle', `${spec.id} "${spec.title}" par ${puzzle.par} solution ${puzzle.solution.join(',')} blocks ${puzzle.blocks.length}`);
    emit('mode');
    emit('puzzle');
  }

  resetPuzzle(): void {
    const p = store.puzzle;
    const room = store.room;
    const marble = this.marble();
    if (!p || !room || !marble) return;
    store.puzzleFlips = 0;
    store.undo = [];
    store.puzzleState = 'playing';
    store.timeOverride = null;
    this.winHold = 0;
    this.placeBody(marble, toWorld(room.frame, p.start));
    this.trail.reset();
    this.gravity.flip({ dir: D.NegY, source: 'reset' });
    logEvent('puzzle', 'reset');
    emit('puzzle');
  }

  undo(): void {
    const room = store.room;
    const marble = this.marble();
    const last = store.undo.pop();
    if (!last || !room || !marble || store.puzzleState !== 'playing') return;
    store.puzzleFlips = Math.max(0, store.puzzleFlips - 1);
    this.placeBody(marble, toWorld(room.frame, last.marble));
    this.trail.reset();
    this.gravity.flip({ dir: last.gravity, source: 'undo' });
    logEvent('puzzle', 'undo');
    emit('puzzle');
  }

  dropAll(): void {
    const room = store.room;
    if (!room) return;
    for (const e of this.queries.toys.entities) {
      const slot = e.getValue(Toy, 'slot') ?? 0;
      const home = this.homes[slot];
      if (home) this.placeBody(e, toWorld(room.frame, home));
    }
    this.gravity.flip({ dir: D.NegY, source: 'reset' });
    logEvent('sandbox', 'drop all');
  }

  // ------------------------------------------------------------- building

  private placeBody(e: Entity, w: V3): void {
    this.physics.setBodyTransform(e, { position: [w[0], w[1], w[2]], quaternion: [0, 0, 0, 1] }, { resetVelocity: true });
    if (e.object3D) e.object3D.position.set(w[0], w[1], w[2]);
  }

  /** Toys start on the table in front of you (or the floor ahead), dropped from a little height. */
  private spawnToys(): void {
    const room = store.room;
    if (!room) return;
    this.clearToys();
    const scale = room.kind === 'tabletop' ? 0.5 : 1;
    const support = this.supportTop(room);
    this.homes.length = 0;
    const cols = 4;
    const gap = 0.17 * scale;
    TOY_KINDS.forEach((kind, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const local: V3 = [
        support.center[0] + (col - (cols - 1) / 2) * gap,
        support.top + 0.22 * scale + row * 0.05 * scale,
        support.center[2] + (row - 1) * gap,
      ];
      const slot = kind === 'marble' ? MARBLE_SLOT : i;
      this.homes[slot] = local;
      this.spawnBody(kind, toWorld(room.frame, local), slot, scale, room.radius, kind !== 'marble');
    });
    logEvent('toys', `12 bodies on ${support.label}`);
  }

  private supportTop(room: RoomModel): { center: V3; top: number; label: string } {
    let best: { center: V3; top: number; label: string } | null = null;
    let bestScore = Infinity;
    for (const s of room.solids) {
      if (s.kind !== 'table' && s.kind !== 'furniture') continue;
      const c: V3 = [(s.min[0] + s.max[0]) / 2, s.max[1], (s.min[2] + s.max[2]) / 2];
      const dx = c[0] - room.head[0];
      const dz = c[2] - room.head[2];
      const dist = Math.hypot(dx, dz);
      const cos = (dx * room.forward[0] + dz * room.forward[2]) / Math.max(dist, 1e-6);
      if (dist > 2.6 || cos < 0.5 || s.max[0] - s.min[0] < 0.5 || s.max[2] - s.min[2] < 0.4) continue;
      const score = dist + (s.kind === 'table' ? 0 : 0.6);
      if (score < bestScore) {
        bestScore = score;
        best = { center: c, top: s.max[1], label: s.label };
      }
    }
    if (best) return best;
    if (room.kind === 'tabletop') return { center: [0, 0, 0], top: 0, label: 'paper table' };
    const f = room.forward;
    return {
      center: [room.head[0] + f[0] * 1.1, 0, room.head[2] + f[2] * 1.1],
      top: 0,
      label: 'floor',
    };
  }

  private spawnBody(kind: ToyKind, w: V3, slot: number, scale: number, marbleR: number, grabbable: boolean): Entity {
    const spec = toySpec(kind, scale, marbleR);
    const mesh = makeToyMesh(kind, kind === 'marble' ? marbleR : spec.size, slot + 11);
    mesh.name = kind === 'marble' ? 'marble' : `toy-${slot}-${kind}`;
    mesh.position.set(w[0], w[1], w[2]);
    const e = this.world.createTransformEntity(mesh);
    e.addComponent(PhysicsShape, {
      shape: spec.shape,
      dimensions: spec.dims,
      density: spec.density,
      restitution: spec.restitution,
      friction: spec.friction,
    });
    e.addComponent(PhysicsBody, {
      state: PhysicsState.Dynamic,
      linearDamping: kind === 'marble' ? 0.02 : 0.08,
      angularDamping: kind === 'marble' ? 0.6 : 0.25,
    });
    if (kind === 'marble') {
      e.addComponent(Marble);
    } else {
      e.addComponent(Toy, { kind, slot });
    }
    if (grabbable) {
      e.addComponent(RayInteractable);
      e.addComponent(DistanceGrabbable, { movementMode: MovementMode.MoveFromTarget, scale: false });
    }
    if (kind === 'marble' && store.mode !== 'puzzle') e.addComponent(Toy, { kind, slot });
    this.sizes[slot] = kind === 'marble' ? marbleR : spec.size;
    this.prevVel.fill(0, slot * 3, slot * 3 + 3);
    return e;
  }

  private buildPuzzle(room: RoomModel, p: Puzzle): void {
    // Paper blocks: one visual group (2 draw calls per block) and one static collider each.
    const blocksVisual = makeBlocksMesh(p.blocks);
    blocksVisual.name = 'puzzle-blocks';
    const holder = new Group();
    holder.add(blocksVisual);
    const origin = toWorld(room.frame, [0, 0, 0]);
    holder.position.set(origin[0], origin[1], origin[2]);
    holder.rotation.y = room.frame.yaw;
    const visualEntity = this.world.createTransformEntity(holder);
    visualEntity.addComponent(PaperBlock);
    holder.scale.setScalar(0.001);
    this.growIn = { obj: holder, t: 0 };
    p.blocks.forEach((b, i) => {
      const o = new Object3D();
      o.name = `block-collider-${i}`;
      const c = toWorld(room.frame, [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2]);
      o.position.set(c[0], c[1], c[2]);
      o.rotation.y = room.frame.yaw;
      const e = this.world.createTransformEntity(o);
      e.addComponent(PaperBlock);
      e.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Box,
        dimensions: [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]],
        friction: 0.6,
        restitution: 0.35,
      });
      e.addComponent(PhysicsBody, { state: PhysicsState.Static });
    });

    // Goal ring on the surface the winning flip lands against.
    const r = p.world.radius;
    const goalRing = makeGoal(winRadius(p.world));
    goalRing.name = 'goal';
    const down = dirVector(p.goalDir);
    const onSurface = toWorld(room.frame, [p.goal[0] + down[0] * r * 0.98, p.goal[1] + down[1] * r * 0.98, p.goal[2] + down[2] * r * 0.98]);
    goalRing.position.set(onSurface[0], onSurface[1], onSurface[2]);
    const nw = dirToWorld(room.frame, [-down[0], -down[1], -down[2]]);
    this.n.set(nw[0], nw[1], nw[2]);
    goalRing.quaternion.setFromUnitVectors(this.zAxis, this.n);
    const ge = this.world.createTransformEntity(goalRing);
    ge.addComponent(GoalCup);

    // The marble drops onto its start spot.
    const room0 = p.world;
    const up = castAxis(room0, p.start, D.PosY).distance;
    const drop = Math.max(0, Math.min(0.2, up - r * 1.2));
    const startW = toWorld(room.frame, [p.start[0], p.start[1] + drop, p.start[2]]);
    this.spawnBody('marble', startW, MARBLE_SLOT, 1, r, false);
    this.trail.reset();
  }

  private growIn: { obj: Object3D; t: number } | null = null;

  private clearToys(): void {
    for (const e of [...this.queries.toys.entities]) e.dispose();
    for (const e of [...this.queries.marbles.entities]) e.dispose();
    this.trail.reset();
  }

  private clearPuzzle(): void {
    for (const e of [...this.queries.goals.entities]) e.dispose();
    for (const e of [...this.queries.blocks.entities]) e.dispose();
    // the puzzle marble only; the sandbox marble is also a Toy and stays
    for (const e of [...this.queries.marbles.entities]) if (!e.hasComponent(Toy)) e.dispose();
    store.puzzle = null;
    store.puzzleState = 'idle';
    store.timeOverride = null;
  }

  private clearAll(): void {
    this.clearPuzzle();
    this.clearToys();
  }

  marble(): Entity | undefined {
    return this.queries.marbles.entities.values().next().value;
  }

  /** The sweep world for shadows and previews (room plus puzzle blocks). */
  sweepWorld(): SweepWorld | null {
    if (store.puzzle) return store.puzzle.world;
    const room = store.room;
    if (!room) return null;
    return { min: room.min, max: room.max, solids: room.solids, radius: room.radius };
  }

  // ------------------------------------------------------------- events

  private onFlip(d: { dir: Dir; source: string; changed: boolean }): void {
    if (d.source !== 'pinch') return;
    if (store.mode === 'onboarding') {
      const step = store.onboardingStep;
      const ok =
        (step === 0 && d.dir === D.PosY) ||
        (step === 1 && d.dir !== D.PosY && d.dir !== D.NegY) ||
        (step === 2 && d.dir === D.NegY);
      if (ok) {
        store.onboardingStep++;
        logEvent('onboarding', `step ${store.onboardingStep}`);
        emit('onboarding');
      }
    }
    if (store.mode === 'puzzle' && store.puzzleState === 'playing' && d.changed) {
      const room = store.room;
      const m = this.marble();
      if (room && m?.object3D) {
        const p = toRoom(room.frame, [m.object3D.position.x, m.object3D.position.y, m.object3D.position.z]);
        store.undo.push({ gravity: store.undoGravity, marble: p });
      }
      store.puzzleFlips++;
      emit('puzzle');
    }
    store.undoGravity = d.dir;
  }

  // ------------------------------------------------------------- per frame

  update(delta: number): void {
    const room = store.room;
    if (!room) return;
    this.camera.getWorldPosition(this.eye);
    const world = this.sweepWorld();
    const gdir = store.gravity;
    const down = dirVector(gdir);

    if (this.growIn) {
      this.growIn.t = Math.min(1, this.growIn.t + delta * 2.2);
      const t = this.growIn.t;
      const s = 1 - Math.pow(1 - t, 3) * Math.cos(t * 4);
      this.growIn.obj.scale.setScalar(Math.max(0.001, s));
      if (t >= 1) {
        this.growIn.obj.scale.setScalar(1);
        this.growIn = null;
      }
    }

    // Shadows, impacts.
    this.shadows.begin();
    const shadeBody = (e: Entity, slot: number, glassy: boolean) => {
      const o = e.object3D;
      if (!o || !world) return;
      const p = toRoom(room.frame, [o.position.x, o.position.y, o.position.z]);
      const hit = castAxis(world, p, gdir);
      const size = this.sizes[slot] || 0.06;
      const dist = Math.max(0, hit.distance - size);
      const pw = toWorld(room.frame, [p[0] + down[0] * (hit.distance - 0.003), p[1] + down[1] * (hit.distance - 0.003), p[2] + down[2] * (hit.distance - 0.003)]);
      const nw = dirToWorld(room.frame, [-down[0], -down[1], -down[2]]);
      this.tmp.set(pw[0], pw[1], pw[2]);
      this.n.set(nw[0], nw[1], nw[2]);
      const fade = Math.max(0.25, 1 - dist / 2.2);
      this.shadows.add(this.tmp, this.n, size * 3.2 * fade);

      // impact: a sudden velocity change while moving along gravity
      const v = e.getVectorView(PhysicsBody, '_linearVelocity');
      const i3 = slot * 3;
      const pvx = this.prevVel[i3];
      const pvy = this.prevVel[i3 + 1];
      const pvz = this.prevVel[i3 + 2];
      const dv = Math.hypot(v[0] - pvx, v[1] - pvy, v[2] - pvz);
      const speedBefore = Math.hypot(pvx, pvy, pvz);
      if (dv > 0.9 && speedBefore > 0.6 && store.timeScale > 0) {
        const tone = this.toneFor(world, hit.hit, gdir);
        synth.impact(tone, dv / 6, glassy, o.position.x, o.position.y, o.position.z);
        if (glassy) {
          this.sparks.burst(o.position.x, o.position.y, o.position.z, nw[0], nw[1], nw[2], Math.min(14, 4 + Math.round(dv * 2)), 0.6 + dv * 0.15);
        }
      }
      this.prevVel[i3] = v[0];
      this.prevVel[i3 + 1] = v[1];
      this.prevVel[i3 + 2] = v[2];
    };
    for (const e of this.queries.toys.entities) {
      if (e.hasComponent(Marble)) continue;
      shadeBody(e, e.getValue(Toy, 'slot') ?? 0, false);
    }
    const marble = this.marble();
    if (marble) shadeBody(marble, MARBLE_SLOT, true);
    this.shadows.end();
    this.sparks.update(delta);

    // Marble trail and light.
    if (marble?.object3D) {
      const mp = marble.object3D.position;
      this.trail.push(mp.x, mp.y, mp.z, this.eye);
      this.marbleLight.visible = true;
      this.marbleLight.position.copy(mp);
      const halo = marble.object3D.getObjectByName('marble-halo');
      if (halo) {
        this.q.copy(marble.object3D.quaternion).invert();
        halo.quaternion.copy(this.camera.quaternion).premultiply(this.q);
      }
    } else {
      this.marbleLight.visible = false;
    }

    // Goal pulse and win check.
    this.goalPulse += delta;
    for (const g of this.queries.goals.entities) {
      const ring = g.object3D?.getObjectByName('goal-ring');
      if (ring) ring.scale.setScalar(1 + 0.06 * Math.sin(this.goalPulse * 4));
    }
    this.checkWin(delta);
  }

  private toneFor(world: SweepWorld, hit: number, dir: Dir): SurfaceTone {
    if (hit >= 0) {
      const s = world.solids[hit] as { kind?: string };
      if (s.kind === 'block') return 'block';
      if (s.kind === 'table') return 'table';
      return 'furniture';
    }
    if (dir === D.NegY) return 'floor';
    if (dir === D.PosY) return 'ceiling';
    return 'wall';
  }

  private checkWin(delta: number): void {
    const p = store.puzzle;
    const room = store.room;
    const m = this.marble();
    if (this.winSlowmoT >= 0) {
      this.winSlowmoT += delta;
      store.timeOverride = this.winSlowmoT < 1.2 ? 0.35 : null;
      if (this.winSlowmoT >= 1.2) this.winSlowmoT = -1;
    }
    if (!p || !room || !m?.object3D || store.puzzleState !== 'playing' || store.timeScale === 0) return;
    const mp = m.object3D.position;
    const rp = toRoom(room.frame, [mp.x, mp.y, mp.z]);
    const dist = Math.hypot(rp[0] - p.goal[0], rp[1] - p.goal[1], rp[2] - p.goal[2]);
    const v = m.getVectorView(PhysicsBody, '_linearVelocity');
    const speed = Math.hypot(v[0], v[1], v[2]);
    if (dist <= winRadius(p.world) && speed < 0.3) {
      this.winHold += delta;
      if (this.winHold >= 0.3) this.win();
    } else {
      this.winHold = 0;
    }
  }

  private win(): void {
    const p = store.puzzle!;
    const s = stars(store.puzzleFlips, p.par);
    store.puzzleState = 'won';
    store.lastStars = s;
    const id = p.spec.id;
    store.progress[id] = Math.max(store.progress[id] ?? 0, s);
    saveProgress();
    synth.chime(s);
    this.winSlowmoT = 0;
    const g = this.queries.goals.entities.values().next().value as Entity | undefined;
    const gp = g?.object3D?.position;
    if (gp) {
      this.tmp2.set(0, 0, 1).applyQuaternion(g!.object3D!.quaternion);
      this.sparks.burst(gp.x, gp.y, gp.z, this.tmp2.x, this.tmp2.y, this.tmp2.z, 40, 1.4);
    }
    logEvent('win', `${id} in ${store.puzzleFlips} flips (par ${p.par}) stars ${s}`);
    emit('win');
    emit('puzzle');
  }

  /** Test hook helper: world-space marble position. */
  marbleWorld(): V3 | null {
    const o = this.marble()?.object3D;
    return o ? [o.position.x, o.position.y, o.position.z] : null;
  }

  /** Test hook helper: every dynamic body's position and velocity, sorted by name. */
  bodyStates(): { name: string; p: number[]; v: number[] }[] {
    const r4 = (x: number) => Math.round(x * 1e4) / 1e4;
    const out: { name: string; p: number[]; v: number[] }[] = [];
    const seen = new Set<Entity>();
    for (const e of [...this.queries.toys.entities, ...this.queries.marbles.entities]) {
      if (seen.has(e) || !e.object3D) continue;
      seen.add(e);
      const o = e.object3D;
      const v = e.getVectorView(PhysicsBody, '_linearVelocity');
      out.push({ name: o.name, p: [r4(o.position.x), r4(o.position.y), r4(o.position.z)], v: [r4(v[0]), r4(v[1]), r4(v[2])] });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  releaseAll(): void {
    const grab = this.world.getSystem(GrabSystem);
    for (const e of this.queries.toys.entities) if (e.hasComponent(Grabbed)) grab?.forceRelease(e);
  }

}
