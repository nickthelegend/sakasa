import {
  type Box,
  type Dir,
  type V3,
  Dir as D,
  add,
  cross,
  dirVector,
  dot,
  normalize,
  rotateY,
  scale,
  sub,
} from './math.js';

/**
 * One detected plane in world space (the XR reference space, +Y up), already
 * reduced to a rectangle: its centre, its normal, one in-plane axis and the
 * half extents of the polygon along that axis and the other in-plane axis.
 */
export interface PlaneInput {
  id: string;
  /** WebXR semantic label ('floor', 'wall', 'ceiling', 'table', ...) or ''. */
  label: string;
  center: V3;
  normal: V3;
  axisU: V3;
  halfU: number;
  halfV: number;
}

export type SurfaceKind = 'floor' | 'ceiling' | 'wall' | 'table' | 'furniture';

/** A pinchable surface. Pinching it makes gravity point along `dir`. */
export interface Surface {
  id: string;
  kind: SurfaceKind;
  dir: Dir;
  /** true when it came from a detected plane; false for a labelled paper stand-in. */
  real: boolean;
  label: string;
  /** Room frame. `center` lies on the surface; `normal` points into the room. */
  center: V3;
  normal: V3;
  uAxis: V3;
  vAxis: V3;
  size: [number, number];
  planeId?: string;
}

export interface Solid extends Box {
  id: string;
  kind: 'table' | 'furniture' | 'block';
  label: string;
}

export interface RoomFrame {
  /** world = rotateY(room, yaw) + origin */
  yaw: number;
  origin: V3;
}

export interface RoomModel {
  kind: 'room' | 'tabletop';
  frame: RoomFrame;
  /** Interior box in the room frame (floor at y = 0). */
  min: V3;
  max: V3;
  surfaces: Surface[];
  solids: Solid[];
  /** Lattice spacing target for puzzle pieces, metres. */
  cell: number;
  /** Marble radius, metres. */
  radius: number;
  /** Viewer head in the room frame. */
  head: V3;
  /** Viewer forward (horizontal, unit) in the room frame. */
  forward: V3;
  /** Plain-language notes about stand-ins, shown to the player and logged. */
  notes: string[];
}

/**
 * A detected mesh (XRMesh) reduced to its world-space bounding box. Quest
 * labels meshes ('table', 'couch', ...) even where planes carry no label.
 */
export interface MeshInput {
  id: string;
  label: string;
  min: V3;
  max: V3;
}

export interface BuildRoomOptions {
  /** Labelled scene meshes; labelled furniture becomes solids too. */
  meshes?: readonly MeshInput[];
  /** Viewer head position in world space. Default: seated eye height at the origin. */
  head?: V3;
  /** Viewer forward in world space. Default: -Z. */
  forward?: V3;
}

const PAPER_WALL_DISTANCE = 1.8;
const MAX_WALL_DISTANCE = 5;
const CAPPED_WALL_DISTANCE = 3;
const PAPER_CEILING = 2.4;
const MAX_CEILING = 4;
const ROOM_CELL = 0.25;
const TABLETOP_CELL = 0.1;

export function toWorld(frame: RoomFrame, p: V3): V3 {
  return add(rotateY(p, frame.yaw), frame.origin);
}

export function toRoom(frame: RoomFrame, p: V3): V3 {
  return rotateY(sub(p, frame.origin), -frame.yaw);
}

export function dirToWorld(frame: RoomFrame, v: V3): V3 {
  return rotateY(v, frame.yaw);
}

export function dirToRoom(frame: RoomFrame, v: V3): V3 {
  return rotateY(v, -frame.yaw);
}

function area(p: PlaneInput): number {
  return 4 * p.halfU * p.halfV;
}

function wrapQuarter(yaw: number): number {
  const q = Math.PI / 2;
  let y = yaw % q;
  if (y > q / 2) y -= q;
  if (y <= -q / 2) y += q;
  return y;
}

const FURNITURE_LABELS = new Set([
  'table',
  'desk',
  'couch',
  'bed',
  'storage',
  'other',
  'shelf',
  '',
]);

/**
 * Turn detected planes into an axis-aligned room model: a room frame aligned
 * with the dominant wall, an interior box, the pinchable surfaces, and
 * furniture volumes. Missing surfaces become labelled paper stand-ins; no
 * planes at all gives the virtual tabletop room.
 */
export function buildRoom(
  planes: readonly PlaneInput[],
  options: BuildRoomOptions = {},
): RoomModel {
  const headWorld: V3 = options.head ?? [0, 1.2, 0];
  const fwdWorld: V3 = normalize(options.forward ?? [0, 0, -1]);
  const notes: string[] = [];

  const oriented = planes.map((p) => {
    let n = normalize(p.normal);
    const lab = p.label.toLowerCase();
    if (lab === 'floor' && n[1] < 0) n = scale(n, -1);
    else if (lab === 'ceiling' && n[1] > 0) n = scale(n, -1);
    else if (lab !== 'floor' && lab !== 'ceiling') {
      if (dot(n, sub(headWorld, p.center)) < 0) n = scale(n, -1);
    }
    return { ...p, label: lab, normal: n };
  });

  const horizontalUp = oriented.filter((p) => p.normal[1] > 0.85);
  const horizontalDown = oriented.filter((p) => p.normal[1] < -0.85);
  const vertical = oriented.filter((p) => Math.abs(p.normal[1]) < 0.3);

  // Labels are optional: IWSDK documents none, so classify by orientation,
  // height and size when a plane is unlabelled.
  let floors = horizontalUp.filter((p) => p.label === 'floor');
  if (floors.length === 0) {
    const big = horizontalUp.filter((p) => p.label === '' && area(p) > 1);
    if (big.length > 0) {
      const lowest = Math.min(...big.map((p) => p.center[1]));
      floors = big.filter((p) => p.center[1] < lowest + 0.1 && p.center[1] < headWorld[1] - 0.9);
    }
  }
  let walls = vertical.filter((p) => p.label === 'wall');
  if (walls.length === 0) {
    walls = vertical.filter(
      (p) => p.label === '' && area(p) > 1.5 && 2 * Math.min(p.halfU, p.halfV) > 1,
    );
  }

  if (floors.length === 0 && walls.length === 0) {
    return buildTabletop(headWorld, fwdWorld, planes.length === 0
      ? 'No room planes were found, so Sakasa built a paper room on a virtual table.'
      : 'No floor or wall planes were found, so Sakasa built a paper room on a virtual table.');
  }

  let floorY = 0;
  if (floors.length > 0) {
    const biggest = floors.reduce((a, b) => (area(b) > area(a) ? b : a));
    floorY = biggest.center[1];
  } else {
    notes.push('No floor plane: using the tracking floor (y = 0).');
  }

  let yaw = 0;
  if (walls.length > 0) {
    const main = walls.reduce((a, b) => (area(b) > area(a) ? b : a));
    yaw = wrapQuarter(Math.atan2(main.normal[0], main.normal[2]));
  }
  const frame: RoomFrame = { yaw, origin: [0, floorY, 0] };
  const head = toRoom(frame, headWorld);
  const fwd = dirToRoom(frame, fwdWorld);
  const forward = normalize([fwd[0], 0, fwd[2]]);

  // Walls: for each of the four horizontal directions keep the nearest real
  // wall on the correct side of the viewer.
  type WallPick = { offset: number; plane: PlaneInput } | null;
  const picks: Record<'px' | 'nx' | 'pz' | 'nz', WallPick> = {
    px: null,
    nx: null,
    pz: null,
    nz: null,
  };
  for (const w of walls) {
    const c = toRoom(frame, w.center);
    const n = dirToRoom(frame, w.normal);
    const ax = Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2;
    if (Math.abs(n[ax]) < 0.9) continue;
    // Inward normal +X means the wall is on the -X side of the room.
    const side = n[ax] > 0 ? -1 : 1;
    const rel = c[ax] - head[ax];
    if (rel * side <= 0.2) continue;
    const key = (side > 0 ? 'p' : 'n') + (ax === 0 ? 'x' : 'z') as keyof typeof picks;
    const cur = picks[key];
    if (cur == null || Math.abs(rel) < Math.abs(cur.offset - head[ax])) {
      picks[key] = { offset: c[ax], plane: w };
    }
  }

  const wallBound = (key: keyof typeof picks, ax: 0 | 2, side: 1 | -1) => {
    const pick = picks[key];
    if (pick == null) {
      notes.push(`No wall plane on the ${sideName(key)} side: a paper wall stands in.`);
      return { value: head[ax] + side * PAPER_WALL_DISTANCE, real: false, plane: undefined };
    }
    const dist = Math.abs(pick.offset - head[ax]);
    if (dist > MAX_WALL_DISTANCE) {
      notes.push(
        `The ${sideName(key)} wall is ${dist.toFixed(1)} m away: a paper wall stands in at ${CAPPED_WALL_DISTANCE} m.`,
      );
      return { value: head[ax] + side * CAPPED_WALL_DISTANCE, real: false, plane: undefined };
    }
    return { value: pick.offset, real: true, plane: pick.plane };
  };
  const wpx = wallBound('px', 0, 1);
  const wnx = wallBound('nx', 0, -1);
  const wpz = wallBound('pz', 2, 1);
  const wnz = wallBound('nz', 2, -1);

  let ceilingH = PAPER_CEILING;
  let ceilingReal = false;
  let ceilingPlane: PlaneInput | undefined;
  const ceilings = horizontalDown.filter(
    (p) => p.label === 'ceiling' || (p.label === '' && p.center[1] - floorY > 1.8),
  );
  if (ceilings.length > 0) {
    const c = ceilings.reduce((a, b) => (area(b) > area(a) ? b : a));
    const h = c.center[1] - floorY;
    if (h > MAX_CEILING) {
      notes.push(`The ceiling is ${h.toFixed(1)} m high: a paper ceiling stands in at ${PAPER_CEILING} m.`);
    } else if (h < 1.6) {
      notes.push('The ceiling plane is lower than 1.6 m: a paper ceiling stands in.');
    } else {
      ceilingH = h;
      ceilingReal = true;
      ceilingPlane = c;
    }
  } else {
    notes.push(`No ceiling plane: a paper ceiling stands in at ${PAPER_CEILING} m.`);
  }

  const min: V3 = [wnx.value, 0, wnz.value];
  const max: V3 = [wpx.value, ceilingH, wpz.value];

  // Furniture: horizontal up-facing planes between knee and chest height.
  const solids: Solid[] = [];
  const furnitureSurfaces: Surface[] = [];
  for (const p of horizontalUp) {
    if (p.label === 'floor' || floors.includes(p) || !FURNITURE_LABELS.has(p.label)) continue;
    const h = p.center[1] - floorY;
    if (h < 0.15 || h > 1.4 || area(p) < 0.06) continue;
    const axisV = normalize(cross(p.normal, p.axisU));
    const corners: V3[] = [];
    for (const su of [-1, 1]) {
      for (const sv of [-1, 1]) {
        corners.push(
          toRoom(frame, add(p.center, add(scale(p.axisU, su * p.halfU), scale(axisV, sv * p.halfV)))),
        );
      }
    }
    let x0 = Math.min(...corners.map((c) => c[0]));
    let x1 = Math.max(...corners.map((c) => c[0]));
    let z0 = Math.min(...corners.map((c) => c[2]));
    let z1 = Math.max(...corners.map((c) => c[2]));
    x0 = Math.max(x0, min[0]);
    x1 = Math.min(x1, max[0]);
    z0 = Math.max(z0, min[2]);
    z1 = Math.min(z1, max[2]);
    if (x1 - x0 < 0.2 || z1 - z0 < 0.2) continue;
    // Never build a solid under the viewer (they may be sitting on that couch).
    if (head[0] > x0 - 0.3 && head[0] < x1 + 0.3 && head[2] > z0 - 0.3 && head[2] < z1 + 0.3) {
      continue;
    }
    const kind = p.label === 'table' || p.label === 'desk' ? 'table' : 'furniture';
    const id = `${kind}:${p.id}`;
    solids.push({ id, kind, label: p.label || 'surface', min: [x0, 0, z0], max: [x1, h, z1] });
    furnitureSurfaces.push({
      id,
      kind,
      dir: D.NegY,
      real: true,
      label: p.label || 'surface',
      center: [(x0 + x1) / 2, h, (z0 + z1) / 2],
      normal: [0, 1, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, -1],
      size: [x1 - x0, z1 - z0],
      planeId: p.id,
    });
  }

  // Furniture from labelled meshes, unless a plane already described it.
  for (const m of options.meshes ?? []) {
    const lab = m.label.toLowerCase();
    if (!MESH_FURNITURE.has(lab)) continue;
    const cs: V3[] = [];
    for (const x of [m.min[0], m.max[0]]) for (const z of [m.min[2], m.max[2]]) cs.push(toRoom(frame, [x, 0, z]));
    let x0 = Math.max(Math.min(...cs.map((c) => c[0])), min[0]);
    let x1 = Math.min(Math.max(...cs.map((c) => c[0])), max[0]);
    let z0 = Math.max(Math.min(...cs.map((c) => c[2])), min[2]);
    let z1 = Math.min(Math.max(...cs.map((c) => c[2])), max[2]);
    const h = m.max[1] - floorY;
    if (x1 - x0 < 0.2 || z1 - z0 < 0.2 || h < 0.15 || h > 1.4) continue;
    if (head[0] > x0 - 0.3 && head[0] < x1 + 0.3 && head[2] > z0 - 0.3 && head[2] < z1 + 0.3) continue;
    const cand = { min: [x0, 0, z0] as V3, max: [x1, h, z1] as V3 };
    if (solids.some((s) => overlapXZ(s, cand) > 0.5 * (x1 - x0) * (z1 - z0))) continue;
    const kind = lab === 'table' || lab === 'desk' ? 'table' : 'furniture';
    const id = `${kind}:mesh:${m.id}`;
    solids.push({ id, kind, label: lab, ...cand });
    furnitureSurfaces.push({
      id,
      kind,
      dir: D.NegY,
      real: true,
      label: lab,
      center: [(x0 + x1) / 2, h, (z0 + z1) / 2],
      normal: [0, 1, 0],
      uAxis: [1, 0, 0],
      vAxis: [0, 0, -1],
      size: [x1 - x0, z1 - z0],
    });
  }

  const surfaces = boundarySurfaces(min, max, {
    floor: { real: floors.length > 0, planeId: floors[0]?.id },
    ceiling: { real: ceilingReal, planeId: ceilingPlane?.id },
    px: { real: wpx.real, planeId: wpx.plane?.id },
    nx: { real: wnx.real, planeId: wnx.plane?.id },
    pz: { real: wpz.real, planeId: wpz.plane?.id },
    nz: { real: wnz.real, planeId: wnz.plane?.id },
  });

  return {
    kind: 'room',
    frame,
    min,
    max,
    surfaces: [...surfaces, ...furnitureSurfaces],
    solids,
    cell: ROOM_CELL,
    radius: ROOM_CELL * 0.24,
    head,
    forward,
    notes,
  };
}

const MESH_FURNITURE = new Set(['table', 'desk', 'couch', 'bed', 'storage', 'shelf']);

function overlapXZ(a: Box, b: Box): number {
  const x = Math.min(a.max[0], b.max[0]) - Math.max(a.min[0], b.min[0]);
  const z = Math.min(a.max[2], b.max[2]) - Math.max(a.min[2], b.min[2]);
  return x > 0 && z > 0 ? x * z : 0;
}

function sideName(key: string): string {
  return { px: '+X', nx: '-X', pz: '+Z', nz: '-Z' }[key] ?? key;
}

type BoundaryInfo = Record<
  'floor' | 'ceiling' | 'px' | 'nx' | 'pz' | 'nz',
  { real: boolean; planeId?: string }
>;

function boundarySurfaces(min: V3, max: V3, info: BoundaryInfo): Surface[] {
  const c: V3 = [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2];
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  const make = (
    id: string,
    kind: SurfaceKind,
    dir: Dir,
    center: V3,
    uAxis: V3,
    vAxis: V3,
    size: [number, number],
    i: { real: boolean; planeId?: string },
  ): Surface => ({
    id,
    kind,
    dir,
    real: i.real,
    label: i.real ? kind : `paper ${kind}`,
    center,
    normal: scale(dirVector(dir), -1),
    uAxis,
    vAxis,
    size,
    planeId: i.planeId,
  });
  return [
    make('floor', 'floor', D.NegY, [c[0], min[1], c[2]], [1, 0, 0], [0, 0, -1], [sx, sz], info.floor),
    make('ceiling', 'ceiling', D.PosY, [c[0], max[1], c[2]], [1, 0, 0], [0, 0, 1], [sx, sz], info.ceiling),
    make('wall+x', 'wall', D.PosX, [max[0], c[1], c[2]], [0, 0, 1], [0, 1, 0], [sz, sy], info.px),
    make('wall-x', 'wall', D.NegX, [min[0], c[1], c[2]], [0, 0, -1], [0, 1, 0], [sz, sy], info.nx),
    make('wall+z', 'wall', D.PosZ, [c[0], c[1], max[2]], [-1, 0, 0], [0, 1, 0], [sx, sy], info.pz),
    make('wall-z', 'wall', D.NegZ, [c[0], c[1], min[2]], [1, 0, 0], [0, 1, 0], [sx, sy], info.nz),
  ];
}

/**
 * Fallback room: a 0.8 x 0.5 x 0.6 m paper diorama on a virtual table in
 * front of the viewer. Everything is a labelled stand-in.
 */
export function buildTabletop(headWorld: V3, fwdWorld: V3, note: string): RoomModel {
  const f = normalize([fwdWorld[0], 0, fwdWorld[2]]);
  const yaw = Math.atan2(-f[0], -f[2]);
  const tableTop = Math.max(0.55, headWorld[1] - 0.45);
  const center = add([headWorld[0], tableTop, headWorld[2]], scale(f, 0.7));
  const frame: RoomFrame = { yaw, origin: center };
  const min: V3 = [-0.4, 0, -0.3];
  const max: V3 = [0.4, 0.5, 0.3];
  const none = { real: false };
  return {
    kind: 'tabletop',
    frame,
    min,
    max,
    surfaces: boundarySurfaces(min, max, {
      floor: none,
      ceiling: none,
      px: none,
      nx: none,
      pz: none,
      nz: none,
    }),
    solids: [],
    cell: TABLETOP_CELL,
    radius: TABLETOP_CELL * 0.24,
    head: toRoom(frame, headWorld),
    forward: [0, 0, -1],
    notes: [note],
  };
}

/** Lattice used to place puzzle pieces: whole cells per axis, wall to wall. */
export interface Lattice {
  min: V3;
  counts: [number, number, number];
  size: V3;
}

export function latticeOf(room: RoomModel): Lattice {
  const counts = [0, 0, 0] as [number, number, number];
  const size: V3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    const extent = room.max[a] - room.min[a];
    counts[a] = Math.max(3, Math.round(extent / room.cell));
    size[a] = extent / counts[a];
  }
  return { min: [...room.min] as V3, counts, size };
}

export function cellBox(l: Lattice, i: number, j: number, k: number): Box {
  const idx = [i, j, k];
  const min: V3 = [0, 0, 0];
  const max: V3 = [0, 0, 0];
  for (let a = 0; a < 3; a++) {
    min[a] = l.min[a] + idx[a] * l.size[a];
    max[a] = min[a] + l.size[a];
  }
  return { min, max };
}

export function cellCenter(l: Lattice, i: number, j: number, k: number): V3 {
  return [
    l.min[0] + (i + 0.5) * l.size[0],
    l.min[1] + (j + 0.5) * l.size[1],
    l.min[2] + (k + 0.5) * l.size[2],
  ];
}

/** The surface a gravity direction lands on (the boundary face). */
export function boundaryFor(room: RoomModel, dir: Dir): Surface {
  const s = room.surfaces.find(
    (x) => x.dir === dir && (x.kind === 'floor' || x.kind === 'ceiling' || x.kind === 'wall'),
  );
  if (!s) throw new Error(`room has no boundary surface for direction ${dir}`);
  return s;
}
