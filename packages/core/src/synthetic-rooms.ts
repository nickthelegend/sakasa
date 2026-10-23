import { type V3, add, cross, normalize, rotateY } from './math.js';
import type { PlaneInput } from './room.js';

/**
 * Synthetic rooms written as the planes a headset would report. Used by the
 * tests (and the app's offline preview) to prove puzzles adapt to rooms of
 * different sizes, orientations and missing surfaces.
 */
export interface SyntheticRoom {
  name: string;
  description: string;
  planes: PlaneInput[];
  head: V3;
}

interface RoomSpec {
  width: number;
  depth: number;
  height: number;
  /** Room centre offset from the viewer (world XZ). */
  offset: [number, number];
  yawDeg: number;
  ceiling: boolean;
  furniture: { label: string; x: number; z: number; w: number; d: number; h: number }[];
}

function plane(id: string, label: string, center: V3, normal: V3, axisU: V3, halfU: number, halfV: number): PlaneInput {
  return { id, label, center, normal: normalize(normal), axisU: normalize(axisU), halfU, halfV };
}

function roomPlanes(spec: RoomSpec): PlaneInput[] {
  const yaw = (spec.yawDeg * Math.PI) / 180;
  const at = (x: number, y: number, z: number): V3 =>
    add(rotateY([x, y, z], yaw), [spec.offset[0], 0, spec.offset[1]]);
  const dir = (x: number, y: number, z: number): V3 => rotateY([x, y, z], yaw);
  const hw = spec.width / 2;
  const hd = spec.depth / 2;
  const h = spec.height;
  const out: PlaneInput[] = [
    plane('floor', 'floor', at(0, 0, 0), [0, 1, 0], dir(1, 0, 0), hw, hd),
    plane('wall-n', 'wall', at(0, h / 2, -hd), dir(0, 0, 1), dir(1, 0, 0), hw, h / 2),
    plane('wall-s', 'wall', at(0, h / 2, hd), dir(0, 0, -1), dir(-1, 0, 0), hw, h / 2),
    plane('wall-w', 'wall', at(-hw, h / 2, 0), dir(1, 0, 0), dir(0, 0, -1), hd, h / 2),
    plane('wall-e', 'wall', at(hw, h / 2, 0), dir(-1, 0, 0), dir(0, 0, 1), hd, h / 2),
  ];
  if (spec.ceiling) {
    out.push(plane('ceiling', 'ceiling', at(0, h, 0), [0, -1, 0], dir(1, 0, 0), hw, hd));
  }
  spec.furniture.forEach((f, i) => {
    out.push(plane(`${f.label}-${i}`, f.label, at(f.x, f.h, f.z), [0, 1, 0], dir(1, 0, 0), f.w / 2, f.d / 2));
  });
  // A door and a window on the walls: real rooms report these, and they must not confuse the model.
  out.push(plane('door', 'door', at(hw - 0.01, 1.0, 1.0), dir(-1, 0, 0), dir(0, 0, 1), 0.45, 1.0));
  out.push(plane('window', 'window', at(0.5, 1.4, -hd + 0.01), dir(0, 0, 1), dir(1, 0, 0), 0.6, 0.5));
  return out;
}

export const SYNTHETIC_ROOMS: readonly SyntheticRoom[] = [
  {
    name: 'small-study',
    description: '3.0 x 3.2 m, 2.4 m ceiling, desk in front',
    head: [0, 1.2, 0.3],
    planes: roomPlanes({
      width: 3.0,
      depth: 3.2,
      height: 2.4,
      offset: [0, -0.3],
      yawDeg: 0,
      ceiling: true,
      furniture: [{ label: 'table', x: 0, z: -1.0, w: 1.2, d: 0.6, h: 0.74 }],
    }),
  },
  {
    name: 'living-room',
    description: '5.0 x 5.8 m, 2.7 m ceiling, coffee table and couch, viewer off-centre',
    head: [0.4, 1.2, 0.6],
    planes: roomPlanes({
      width: 5.0,
      depth: 5.8,
      height: 2.7,
      offset: [0, -0.5],
      yawDeg: 0,
      ceiling: true,
      furniture: [
        { label: 'table', x: 0.2, z: -0.9, w: 1.1, d: 0.6, h: 0.45 },
        { label: 'couch', x: 0, z: -2.4, w: 2.0, d: 0.8, h: 0.42 },
      ],
    }),
  },
  {
    name: 'rotated-loft',
    description: '6.5 x 7.0 m, 3.2 m ceiling, rotated 23 degrees to the tracking frame',
    head: [0, 1.2, 0],
    planes: roomPlanes({
      width: 6.5,
      depth: 7.0,
      height: 3.2,
      offset: [0.6, -0.8],
      yawDeg: 23,
      ceiling: true,
      furniture: [{ label: 'table', x: -0.6, z: -0.6, w: 1.6, d: 0.9, h: 0.76 }],
    }),
  },
  {
    name: 'no-ceiling',
    description: '4.0 x 4.5 m, walls and floor only (paper ceiling), desk to the side',
    head: [0, 1.2, 0],
    planes: roomPlanes({
      width: 4.0,
      depth: 4.5,
      height: 2.6,
      offset: [0, -0.4],
      yawDeg: -8,
      ceiling: false,
      furniture: [{ label: 'desk', x: 1.1, z: -1.2, w: 1.0, d: 0.6, h: 0.72 }],
    }),
  },
  {
    name: 'no-planes',
    description: 'no planes at all (virtual tabletop room)',
    head: [0, 1.2, 0],
    planes: [],
  },
];

/** Plane normal convenience for tests. */
export function planeAxisV(p: PlaneInput): V3 {
  return normalize(cross(p.normal, p.axisU));
}
