import {
  Group,
  Matrix4,
  Object3D,
  PhysicsBody,
  PhysicsShape,
  PhysicsShapeType,
  PhysicsState,
  RayInteractable,
  Vector3,
  VisibilityState,
  XRMesh,
  XRPlane,
  createSystem,
} from '@iwsdk/core';
import {
  type MeshInput,
  type PlaneInput,
  type RoomModel,
  type Surface,
  type V3,
  buildRoom,
  dirToWorld,
  toWorld,
} from '@sakasa/core';
import { RoomCollider, RoomSurface } from './components.js';
import { makeSurfaceVisual } from './fx.js';
import { emit, logEvent, store } from './store.js';

const SCAN_TIMEOUT = 5;
const SCAN_STABLE = 1;
const SLAB = 0.3;

const _m = new Matrix4();
const _p = new Vector3();
const _x = new Vector3();
const _y = new Vector3();
const _z = new Vector3();

/** XRPlane polygon (plane space x/z) reduced to a rectangle in world space. */
function planeToInput(id: string, label: string, obj: Object3D, polygon: readonly DOMPointReadOnly[]): PlaneInput | null {
  if (!polygon || polygon.length < 3) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const pt of polygon) {
    minX = Math.min(minX, pt.x);
    maxX = Math.max(maxX, pt.x);
    minZ = Math.min(minZ, pt.z);
    maxZ = Math.max(maxZ, pt.z);
  }
  obj.updateWorldMatrix(true, false);
  _m.copy(obj.matrixWorld);
  _m.extractBasis(_x, _y, _z);
  _p.set((minX + maxX) / 2, 0, (minZ + maxZ) / 2).applyMatrix4(_m);
  _x.normalize();
  _y.normalize();
  return {
    id,
    label,
    center: [_p.x, _p.y, _p.z],
    normal: [_y.x, _y.y, _y.z],
    axisU: [_x.x, _x.y, _x.z],
    halfU: (maxX - minX) / 2,
    halfV: (maxZ - minZ) / 2,
  };
}

function meshToInput(id: string, label: string, obj: Object3D, min: Float32Array, max: Float32Array): MeshInput | null {
  if (!label) return null;
  obj.updateWorldMatrix(true, false);
  const lo: V3 = [Infinity, Infinity, Infinity];
  const hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const x of [min[0], max[0]]) {
    for (const y of [min[1], max[1]]) {
      for (const z of [min[2], max[2]]) {
        _p.set(x, y, z).applyMatrix4(obj.matrixWorld);
        lo[0] = Math.min(lo[0], _p.x);
        lo[1] = Math.min(lo[1], _p.y);
        lo[2] = Math.min(lo[2], _p.z);
        hi[0] = Math.max(hi[0], _p.x);
        hi[1] = Math.max(hi[1], _p.y);
        hi[2] = Math.max(hi[2], _p.z);
      }
    }
  }
  return { id, label, min: lo, max: hi };
}

/**
 * Scans the room (WebXR planes and meshes via IWSDK scene understanding),
 * builds the core room model, and turns it into static colliders plus one
 * pinchable surface per floor, wall, ceiling and furniture top.
 */
export class RoomSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
  surfaces: { required: [RoomSurface] },
  colliders: { required: [RoomCollider] },
}) {
  private scanStart = -1;
  private lastCount = -1;
  private stableSince = 0;
  private readonly head = new Vector3();
  private readonly fwd = new Vector3();

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((v) => {
        if (v !== VisibilityState.NonImmersive && store.room == null && store.mode === 'idle') {
          this.beginScan();
        }
        if (v === VisibilityState.NonImmersive) {
          this.clearRoom();
          store.room = null;
          store.mode = 'idle';
          emit('mode');
        }
      }),
    );
    (window as unknown as { __sakasaRescan?: () => void }).__sakasaRescan = () => this.beginScan();
  }

  beginScan(): void {
    this.clearRoom();
    store.room = null;
    store.mode = 'scanning';
    this.scanStart = -1;
    this.lastCount = -1;
    logEvent('scan', 'started');
    emit('mode');
  }

  update(_delta: number, time: number): void {
    if (store.mode !== 'scanning') return;
    if (this.scanStart < 0) {
      this.scanStart = time;
      this.stableSince = time;
    }
    const count = this.queries.planes.entities.size;
    if (count !== this.lastCount) {
      this.lastCount = count;
      this.stableSince = time;
    }
    store.planeCount = count;
    const elapsed = time - this.scanStart;
    if ((count > 0 && time - this.stableSince >= SCAN_STABLE) || elapsed >= SCAN_TIMEOUT) {
      this.build();
    }
  }

  private build(): void {
    const planes: PlaneInput[] = [];
    let i = 0;
    for (const e of this.queries.planes.entities) {
      const plane = e.getValue(XRPlane, '_plane') as XRPlane & { semanticLabel?: string; polygon: DOMPointReadOnly[] };
      if (!plane || !e.object3D) continue;
      const input = planeToInput(`plane-${i++}`, plane.semanticLabel ?? '', e.object3D, plane.polygon);
      if (input) planes.push(input);
    }
    const meshes: MeshInput[] = [];
    let j = 0;
    for (const e of this.queries.meshes.entities) {
      if (!e.object3D || !e.getValue(XRMesh, 'isBounded3D')) continue;
      const label = e.getValue(XRMesh, 'semanticLabel') ?? '';
      const input = meshToInput(`mesh-${j++}`, label, e.object3D, e.getVectorView(XRMesh, 'min') as Float32Array, e.getVectorView(XRMesh, 'max') as Float32Array);
      if (input) meshes.push(input);
    }
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.fwd);
    const room = buildRoom(planes, {
      head: [this.head.x, this.head.y, this.head.z],
      forward: [this.fwd.x, 0, this.fwd.z],
      meshes,
    });
    store.room = room;
    store.roomInputs = {
      planes,
      meshes,
      head: [this.head.x, this.head.y, this.head.z],
      forward: [this.fwd.x, 0, this.fwd.z],
    };
    store.roomSource = room.kind === 'tabletop' ? 'tabletop' : 'planes';
    store.planeCount = planes.length;
    this.instantiate(room);
    logEvent(
      'room',
      `${room.kind} ${planes.length} planes, ${meshes.length} meshes, box ${(room.max[0] - room.min[0]).toFixed(2)} x ${room.max[1].toFixed(2)} x ${(room.max[2] - room.min[2]).toFixed(2)} m, ${room.solids.length} furniture; ${room.notes.join(' ')}`,
    );
    for (const n of room.notes) console.info(`[sakasa] ${n}`);
    emit('room', room);
  }

  private clearRoom(): void {
    for (const e of [...this.queries.surfaces.entities]) e.dispose();
    for (const e of [...this.queries.colliders.entities]) e.dispose();
  }

  private instantiate(room: RoomModel): void {
    const q = new Group();
    q.rotation.y = room.frame.yaw;
    const yawQ = q.quaternion.clone();
    // Static colliders: six slabs just outside the interior box, plus furniture volumes.
    const { min, max } = room;
    const cx = (min[0] + max[0]) / 2;
    const cy = (min[1] + max[1]) / 2;
    const cz = (min[2] + max[2]) / 2;
    const sx = max[0] - min[0] + 2 * SLAB;
    const sy = max[1] - min[1] + 2 * SLAB;
    const sz = max[2] - min[2] + 2 * SLAB;
    const slabs: { id: string; c: V3; d: V3 }[] = [
      { id: 'floor', c: [cx, min[1] - SLAB / 2, cz], d: [sx, SLAB, sz] },
      { id: 'ceiling', c: [cx, max[1] + SLAB / 2, cz], d: [sx, SLAB, sz] },
      { id: 'wall-x', c: [min[0] - SLAB / 2, cy, cz], d: [SLAB, sy, sz] },
      { id: 'wall+x', c: [max[0] + SLAB / 2, cy, cz], d: [SLAB, sy, sz] },
      { id: 'wall-z', c: [cx, cy, min[2] - SLAB / 2], d: [sx, sy, SLAB] },
      { id: 'wall+z', c: [cx, cy, max[2] + SLAB / 2], d: [sx, sy, SLAB] },
    ];
    for (const s of room.solids) {
      slabs.push({
        id: s.id,
        c: [(s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2],
        d: [s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]],
      });
    }
    for (const s of slabs) {
      const o = new Object3D();
      o.name = `collider:${s.id}`;
      const w = toWorld(room.frame, s.c);
      o.position.set(w[0], w[1], w[2]);
      o.quaternion.copy(yawQ);
      const e = this.world.createTransformEntity(o);
      e.addComponent(RoomCollider, { solidId: s.id });
      e.addComponent(PhysicsShape, {
        shape: PhysicsShapeType.Box,
        dimensions: s.d,
        friction: 0.6,
        restitution: 0.35,
      });
      e.addComponent(PhysicsBody, { state: PhysicsState.Static });
    }
    for (const surface of room.surfaces) this.makeSurface(room, surface);
  }

  private makeSurface(room: RoomModel, s: Surface): void {
    const { mesh } = makeSurfaceVisual(s.size[0], s.size[1], !s.real);
    mesh.name = `surface:${s.id}`;
    const inset = 0.004;
    const c = toWorld(room.frame, [
      s.center[0] + s.normal[0] * inset,
      s.center[1] + s.normal[1] * inset,
      s.center[2] + s.normal[2] * inset,
    ]);
    mesh.position.set(c[0], c[1], c[2]);
    const u = dirToWorld(room.frame, s.uAxis);
    const v = dirToWorld(room.frame, s.vAxis);
    const n = dirToWorld(room.frame, s.normal);
    _x.set(u[0], u[1], u[2]);
    _y.set(v[0], v[1], v[2]);
    _z.set(n[0], n[1], n[2]);
    _m.makeBasis(_x, _y, _z);
    mesh.quaternion.setFromRotationMatrix(_m);
    const e = this.world.createTransformEntity(mesh);
    e.addComponent(RoomSurface, { surfaceId: s.id, dir: s.dir, real: s.real });
    e.addComponent(RayInteractable);
  }
}
