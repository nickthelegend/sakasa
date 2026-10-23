import {
  CustomBlending,
  type Material,
  OneFactor,
  SrcAlphaFactor,
  ZeroFactor,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  DynamicDrawUsage,
  EdgesGeometry,
  Group,
  IcosahedronGeometry,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  ShaderMaterial,
  SphereGeometry,
  SRGBColorSpace,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import { Rng } from '@sakasa/core';

/** Sakasa palette (BRANDS.md): ink, flip blue, paper. */
export const INK = new Color('#0b0d10');
export const FLIP = new Color('#22b8ff');
export const PAPER = new Color('#e9f6fd');

/**
 * Additive light for mixed reality. The XR layer composites premultiplied
 * colour over passthrough, so glow must add colour while leaving the alpha
 * channel untouched; ordinary additive blending also adds alpha, which
 * darkens the passthrough behind faded particles.
 */
export function glowBlend<T extends Material>(m: T): T {
  m.blending = CustomBlending;
  m.blendSrc = SrcAlphaFactor;
  m.blendDst = OneFactor;
  m.blendSrcAlpha = ZeroFactor;
  m.blendDstAlpha = OneFactor;
  m.transparent = true;
  m.depthWrite = false;
  return m;
}

function radialTexture(inner: string, outer: string, size = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

let glowTex: CanvasTexture | null = null;
let blobTex: CanvasTexture | null = null;
export function glowTexture(): CanvasTexture {
  glowTex ??= radialTexture('rgba(255,255,255,1)', 'rgba(255,255,255,0)');
  return glowTex;
}
export function blobTexture(): CanvasTexture {
  blobTex ??= radialTexture('rgba(0,0,0,0.75)', 'rgba(0,0,0,0)');
  return blobTex;
}

// ---------------------------------------------------------------- materials

export const paperMaterial = new MeshStandardMaterial({
  color: PAPER,
  roughness: 0.92,
  metalness: 0,
  flatShading: true,
});
export const bluePaperMaterial = new MeshStandardMaterial({
  color: new Color('#7fd3ff'),
  roughness: 0.9,
  metalness: 0,
  flatShading: true,
});
export const inkLineMaterial = new LineBasicMaterial({
  color: INK,
  transparent: true,
  opacity: 0.55,
});

// ---------------------------------------------------------------- surfaces

const SURFACE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SURFACE_FRAG = /* glsl */ `
uniform vec2 uSize;
uniform vec2 uHit;
uniform vec2 uPulse;
uniform float uHover;
uniform float uActive;
uniform float uPaper;
uniform float uPress;
uniform float uTime;
uniform float uPulseT;
uniform vec3 uColor;
uniform vec3 uPaperColor;
varying vec2 vUv;
void main() {
  vec2 p = (vUv - 0.5) * uSize;
  vec2 q = p / 0.25;
  vec2 gw = abs(fract(q - 0.5) - 0.5) / max(fwidth(q), vec2(1e-4));
  float line = 1.0 - min(min(gw.x, gw.y), 1.0);
  float dHit = length(p - uHit);
  float near = smoothstep(1.4, 0.0, dHit);
  vec2 e2 = uSize * 0.5 - abs(p);
  float edge = min(e2.x, e2.y);
  float border = smoothstep(0.04, 0.0, edge);
  float age = uTime - uPulseT;
  float ring = 0.0;
  if (age >= 0.0 && age < 1.4) {
    float r = age * 3.2;
    ring = smoothstep(0.09, 0.0, abs(dHit * 0.0 + length(p - uPulse) - r)) * (1.0 - age / 1.4);
  }
  float spot = smoothstep(0.35, 0.0, dHit) * uHover * (0.25 + 0.35 * uPress);
  float a = line * (0.6 * near * uHover + 0.14 * uActive) + border * (0.75 * uHover + 0.3 * uActive) + ring * 0.95 + spot;
  a = clamp(a, 0.0, 1.0);
  vec3 col = mix(uColor, vec3(1.0), 0.25 * spot);
  float pa = uPaper * 0.78;
  // paper stand-ins get a faint fold pattern so they read as paper, not as glitches
  float fold = uPaper * 0.06 * step(0.5, fract((p.x + p.y) * 1.2));
  vec3 base = uPaperColor - fold;
  float outA = max(pa, a);
  vec3 outC = mix(base, col, pa > 0.0 ? a : 1.0);
  if (outA < 0.003) discard;
  gl_FragColor = vec4(outC, outA);
}`;

export interface SurfaceVisual {
  mesh: Mesh;
  material: ShaderMaterial;
}

export function makeSurfaceVisual(width: number, height: number, paper: boolean): SurfaceVisual {
  const material = new ShaderMaterial({
    vertexShader: SURFACE_VERT,
    fragmentShader: SURFACE_FRAG,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
    // one pass, not three's default back-then-front pair for transparent double-sided materials
    forceSinglePass: true,
    uniforms: {
      uSize: { value: [width, height] },
      uHit: { value: [0, 0] },
      uPulse: { value: [0, 0] },
      uHover: { value: 0 },
      uActive: { value: 0 },
      uPaper: { value: paper ? 1 : 0 },
      uPress: { value: 0 },
      uTime: { value: 0 },
      uPulseT: { value: -10 },
      uColor: { value: FLIP.clone() },
      uPaperColor: { value: PAPER.clone() },
    },
  });
  const mesh = new Mesh(new PlaneGeometry(width, height), material);
  mesh.renderOrder = 1;
  return { mesh, material };
}

// ---------------------------------------------------------------- bodies

export type ToyKind = 'cube' | 'blue-cube' | 'ball' | 'roll' | 'marble';

export function makeToyMesh(kind: ToyKind, size: number, seed: number): Object3D {
  if (kind === 'cube' || kind === 'blue-cube') {
    return new Mesh(new BoxGeometry(size, size, size), kind === 'cube' ? paperMaterial : bluePaperMaterial);
  }
  if (kind === 'ball') {
    // crumpled paper: a jittered icosahedron, flat shaded (deterministic per seed)
    const geo = new IcosahedronGeometry(size, 1);
    const rng = new Rng(seed);
    const pos = geo.getAttribute('position') as BufferAttribute;
    const keyed = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(4)},${pos.getY(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`;
      let k = keyed.get(key);
      if (k === undefined) {
        k = 0.82 + rng.next() * 0.2;
        keyed.set(key, k);
      }
      pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
    }
    geo.computeVertexNormals();
    return new Mesh(geo, paperMaterial);
  }
  if (kind === 'roll') {
    return new Mesh(new CylinderGeometry(size * 0.45, size * 0.45, size * 1.6, 10, 1), paperMaterial);
  }
  return makeMarbleMesh(size);
}

export function makeMarbleMesh(radius: number): Object3D {
  const core = new Mesh(
    new SphereGeometry(radius, 24, 16),
    new MeshStandardMaterial({
      color: new Color('#dff6ff'),
      emissive: FLIP,
      emissiveIntensity: 1.6,
      roughness: 0.2,
      metalness: 0,
    }),
  );
  const halo = new Mesh(
    new PlaneGeometry(radius * 7, radius * 7),
    glowBlend(new MeshBasicMaterial({ map: glowTexture(), color: FLIP, opacity: 0.85 })),
  );
  halo.name = 'marble-halo';
  halo.raycast = () => undefined;
  core.add(halo);
  return core;
}

// ---------------------------------------------------------------- trail

/** Camera-facing ribbon behind the marble. One draw call, no per-frame allocation. */
export class Trail {
  readonly mesh: Mesh;
  private readonly points: Float32Array;
  private count = 0;
  private readonly n: number;
  private readonly pos: Float32Array;
  private readonly alpha: Float32Array;
  private readonly tmpA = new Vector3();
  private readonly tmpB = new Vector3();
  private readonly tmpDir = new Vector3();
  private readonly tmpSide = new Vector3();
  private readonly tmpView = new Vector3();

  constructor(n: number, private readonly width: number) {
    this.n = n;
    this.points = new Float32Array(n * 3);
    this.pos = new Float32Array(n * 2 * 3);
    this.alpha = new Float32Array(n * 2);
    const geo = new BufferGeometry();
    const posAttr = new BufferAttribute(this.pos, 3);
    posAttr.setUsage(DynamicDrawUsage);
    const aAttr = new BufferAttribute(this.alpha, 1);
    aAttr.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', posAttr);
    geo.setAttribute('alpha', aAttr);
    const idx: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    geo.setIndex(idx);
    const mat = glowBlend(new ShaderMaterial({
      side: DoubleSide,
      forceSinglePass: true,
      uniforms: { uColor: { value: FLIP.clone() } },
      vertexShader: /* glsl */ `
        attribute float alpha; varying float vA;
        void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor; varying float vA;
        void main() { gl_FragColor = vec4(uColor, vA); }`,
    }));
    this.mesh = new Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => undefined;
  }

  reset(): void {
    this.count = 0;
    this.alpha.fill(0);
    (this.mesh.geometry.getAttribute('alpha') as BufferAttribute).needsUpdate = true;
  }

  push(x: number, y: number, z: number, eye: Vector3): void {
    const p = this.points;
    if (this.count > 0) {
      const dx = x - p[0];
      const dy = y - p[1];
      const dz = z - p[2];
      if (dx * dx + dy * dy + dz * dz < 0.0001) {
        // not moving: let the tail decay toward the head
        for (let i = this.n - 1; i > 0; i--) {
          p[i * 3] += (p[(i - 1) * 3] - p[i * 3]) * 0.12;
          p[i * 3 + 1] += (p[(i - 1) * 3 + 1] - p[i * 3 + 1]) * 0.12;
          p[i * 3 + 2] += (p[(i - 1) * 3 + 2] - p[i * 3 + 2]) * 0.12;
        }
        this.rebuild(eye);
        return;
      }
    }
    p.copyWithin(3, 0, (this.n - 1) * 3);
    p[0] = x;
    p[1] = y;
    p[2] = z;
    if (this.count === 0) for (let i = 1; i < this.n; i++) p.set([x, y, z], i * 3);
    this.count = Math.min(this.n, this.count + 1);
    this.rebuild(eye);
  }

  private rebuild(eye: Vector3): void {
    const p = this.points;
    for (let i = 0; i < this.n; i++) {
      const j = Math.min(i + 1, this.n - 1);
      const k = Math.max(i - 1, 0);
      this.tmpA.set(p[k * 3], p[k * 3 + 1], p[k * 3 + 2]);
      this.tmpB.set(p[j * 3], p[j * 3 + 1], p[j * 3 + 2]);
      this.tmpDir.subVectors(this.tmpA, this.tmpB);
      this.tmpView.set(p[i * 3] - eye.x, p[i * 3 + 1] - eye.y, p[i * 3 + 2] - eye.z);
      this.tmpSide.crossVectors(this.tmpDir, this.tmpView);
      const l = this.tmpSide.length();
      const t = 1 - i / (this.n - 1);
      const w = (this.width * (0.25 + 0.75 * t)) / 2;
      if (l > 1e-6) this.tmpSide.multiplyScalar(w / l);
      else this.tmpSide.set(0, 0, 0);
      this.pos[i * 6] = p[i * 3] + this.tmpSide.x;
      this.pos[i * 6 + 1] = p[i * 3 + 1] + this.tmpSide.y;
      this.pos[i * 6 + 2] = p[i * 3 + 2] + this.tmpSide.z;
      this.pos[i * 6 + 3] = p[i * 3] - this.tmpSide.x;
      this.pos[i * 6 + 4] = p[i * 3 + 1] - this.tmpSide.y;
      this.pos[i * 6 + 5] = p[i * 3 + 2] - this.tmpSide.z;
      const a = i < this.count ? t * t * 0.9 : 0;
      this.alpha[i * 2] = a;
      this.alpha[i * 2 + 1] = a;
    }
    const geo = this.mesh.geometry;
    (geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('alpha') as BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------- shadows

/** Gravity-aligned blob shadows for every body: one instanced draw call. */
export class BlobShadows {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly s = new Vector3();
  private readonly up = new Vector3(0, 0, 1);

  constructor(max: number) {
    const mat = new MeshBasicMaterial({
      map: blobTexture(),
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.mesh = new InstancedMesh(new PlaneGeometry(1, 1), mat, max);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => undefined;
    this.mesh.renderOrder = 2;
  }

  begin(): void {
    this.mesh.count = 0;
  }

  /** Place one blob at `p` on a surface with normal `n` (world), size and opacity via scale. */
  add(p: Vector3, n: Vector3, size: number): void {
    const i = this.mesh.count;
    if (i >= this.mesh.instanceMatrix.count) return;
    this.q.setFromUnitVectors(this.up, n);
    this.s.set(size, size, 1);
    this.m.compose(p, this.q, this.s);
    this.mesh.setMatrixAt(i, this.m);
    this.mesh.count = i + 1;
  }

  end(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- dots (preview path)

export class Dots {
  readonly mesh: InstancedMesh;
  private readonly m = new Matrix4();
  constructor(max: number, radius: number) {
    this.mesh = new InstancedMesh(
      new SphereGeometry(radius, 8, 6),
      new MeshBasicMaterial({ color: FLIP, transparent: true, opacity: 0.9, depthWrite: false }),
      max,
    );
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.raycast = () => undefined;
  }
  set(points: Vector3[], count: number): void {
    const n = Math.min(count, this.mesh.instanceMatrix.count);
    for (let i = 0; i < n; i++) {
      this.m.makeTranslation(points[i].x, points[i].y, points[i].z);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  clear(): void {
    this.mesh.count = 0;
  }
}

// ---------------------------------------------------------------- sparks

export class Sparks {
  readonly points: Points;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private next = 0;
  private seed = 7;

  constructor(private readonly max: number) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    const geo = new BufferGeometry();
    const pa = new BufferAttribute(this.pos, 3);
    pa.setUsage(DynamicDrawUsage);
    const ca = new BufferAttribute(this.col, 3);
    ca.setUsage(DynamicDrawUsage);
    geo.setAttribute('position', pa);
    geo.setAttribute('color', ca);
    this.points = new Points(
      geo,
      glowBlend(new PointsMaterial({ size: 0.025, map: glowTexture(), vertexColors: true, sizeAttenuation: true })),
    );
    this.points.frustumCulled = false;
    this.points.raycast = () => undefined;
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  burst(x: number, y: number, z: number, nx: number, ny: number, nz: number, count: number, speed: number): void {
    for (let k = 0; k < count; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      this.pos[i * 3] = x;
      this.pos[i * 3 + 1] = y;
      this.pos[i * 3 + 2] = z;
      const rx = this.rand() * 2 - 1;
      const ry = this.rand() * 2 - 1;
      const rz = this.rand() * 2 - 1;
      const v = speed * (0.4 + this.rand() * 0.8);
      this.vel[i * 3] = (nx * 0.8 + rx * 0.7) * v;
      this.vel[i * 3 + 1] = (ny * 0.8 + ry * 0.7) * v;
      this.vel[i * 3 + 2] = (nz * 0.8 + rz * 0.7) * v;
      this.life[i] = 0.5 + this.rand() * 0.4;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
        continue;
      }
      this.life[i] -= dt;
      const a = Math.max(0, this.life[i]) * 1.6;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.vel[i * 3] *= 0.94;
      this.vel[i * 3 + 1] *= 0.94;
      this.vel[i * 3 + 2] *= 0.94;
      this.col[i * 3] = FLIP.r * a;
      this.col[i * 3 + 1] = FLIP.g * a;
      this.col[i * 3 + 2] = FLIP.b * a;
    }
    const geo = this.points.geometry;
    (geo.getAttribute('position') as BufferAttribute).needsUpdate = true;
    (geo.getAttribute('color') as BufferAttribute).needsUpdate = true;
  }
}

// ---------------------------------------------------------------- goal, arrows, compass

export function makeGoal(radius: number): Group {
  const g = new Group();
  const ring = new Mesh(
    new TorusGeometry(radius, radius * 0.09, 8, 40),
    new MeshBasicMaterial({ color: FLIP }),
  );
  ring.name = 'goal-ring';
  g.add(ring);
  const disc = new Mesh(
    new PlaneGeometry(radius * 2.2, radius * 2.2),
    glowBlend(new MeshBasicMaterial({ map: glowTexture(), color: FLIP, opacity: 0.55 })),
  );
  disc.position.z = 0.002;
  g.add(disc);
  const beam = new Mesh(
    new CylinderGeometry(radius * 0.55, radius * 0.9, 0.5, 16, 1, true),
    glowBlend(new ShaderMaterial({
      side: DoubleSide,
      forceSinglePass: true,
      uniforms: { uColor: { value: FLIP.clone() } },
      vertexShader: /* glsl */ `varying float vY; void main(){ vY = position.y / 0.5 + 0.5; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `uniform vec3 uColor; varying float vY; void main(){ float a = (1.0 - vY) * 0.35; gl_FragColor = vec4(uColor, a); }`,
    })),
  );
  beam.rotation.x = Math.PI / 2;
  beam.position.z = 0.25;
  beam.name = 'goal-beam';
  g.add(beam);
  g.traverse((o) => {
    o.raycast = () => undefined;
  });
  return g;
}

/** Three chevrons pointing along local -Z (one merged mesh, one draw call). */
export function makeDownArrow(): Group {
  const g = new Group();
  const mat = new MeshBasicMaterial({
    color: FLIP,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    side: DoubleSide,
    forceSinglePass: true,
  });
  const parts: BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const c = new ConeGeometry(0.05, 0.07, 4, 1, true);
    c.rotateX(-Math.PI / 2);
    c.translate(0, 0, 0.09 - i * 0.07);
    parts.push(c.toNonIndexed());
  }
  const merged = new BufferGeometry();
  const count = parts.reduce((n, p) => n + p.getAttribute('position').count, 0);
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const p of parts) {
    const a = p.getAttribute('position').array as Float32Array;
    pos.set(a, o);
    o += a.length;
  }
  merged.setAttribute('position', new BufferAttribute(pos, 3));
  const mesh = new Mesh(merged, mat);
  mesh.name = 'chevrons';
  g.add(mesh);
  g.traverse((x) => {
    x.raycast = () => undefined;
  });
  return g;
}

/** Wrist compass: a ring and an arrow that always points "down". */
export function makeCompass(): Group {
  const g = new Group();
  const ring = new Mesh(
    new TorusGeometry(0.014, 0.0014, 6, 32),
    new MeshBasicMaterial({ color: PAPER }),
  );
  g.add(ring);
  const arrow = new Group();
  arrow.name = 'compass-arrow';
  const shaft = new Mesh(new CylinderGeometry(0.002, 0.002, 0.02, 6), new MeshBasicMaterial({ color: FLIP }));
  shaft.position.y = -0.004;
  const tip = new Mesh(new ConeGeometry(0.006, 0.011, 10), new MeshBasicMaterial({ color: FLIP }));
  tip.rotation.x = Math.PI;
  tip.position.y = -0.017;
  arrow.add(shaft, tip);
  g.add(arrow);
  g.traverse((o) => {
    o.raycast = () => undefined;
  });
  return g;
}

export function makeBlocksMesh(boxes: { min: number[]; max: number[] }[]): Group {
  const g = new Group();
  for (const b of boxes) {
    const sx = b.max[0] - b.min[0];
    const sy = b.max[1] - b.min[1];
    const sz = b.max[2] - b.min[2];
    const geo = new BoxGeometry(sx * 0.985, sy * 0.985, sz * 0.985);
    const mesh = new Mesh(geo, paperMaterial);
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
    const edges = new LineSegments(new EdgesGeometry(geo), inkLineMaterial);
    mesh.add(edges);
    g.add(mesh);
  }
  g.traverse((o) => {
    o.raycast = () => undefined;
  });
  return g;
}
