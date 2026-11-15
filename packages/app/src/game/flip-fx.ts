import {
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  MeshBasicMaterial,
  NormalBlending,
  PlaneGeometry,
  Quaternion,
  SRGBColorSpace,
  ShaderMaterial,
  TorusGeometry,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import {
  type Dir,
  Dir as D,
  type RoomModel,
  type TiltCue,
  type V3,
  boundaryFor,
  dirToWorld,
  dirVector,
  slowmoDone,
  tiltAngleAt,
  tiltCue,
  tiltDuration,
  toRoom,
  toWorld,
} from '@sakasa/core';
import { FLIP, PAPER, glowBlend, glowTexture } from './fx.js';
import { on, store } from './store.js';

/**
 * The flip, made big: everything here is drawn on top of the real room and
 * never moves it.
 * - Ghost room: a glowing outline of the room box that kicks about 12 degrees
 *   toward the new floor and settles back (the room-tilt cue; 4 degrees with
 *   gentle gravity, off with the Tilt cue setting).
 * - Gravity rain: 180 light streaks that fall the new way through the room,
 *   crawling during slow motion and speeding up as time returns.
 * - Slow-motion read-out: a flip-blue edge glow plus a dial at the bottom of
 *   the view that shows the time scale while it ramps from 0.15x back to 1x.
 * - Onboarding beacon: a pulsing ring and an animated pinch glyph on the
 *   surface the first-session step asks for.
 */

// ---------------------------------------------------------------- ghost room

function ghostRoomGeometry(min: V3, max: V3, t: number): BufferGeometry {
  const parts: BufferGeometry[] = [];
  const sx = max[0] - min[0];
  const sy = max[1] - min[1];
  const sz = max[2] - min[2];
  const cx = (min[0] + max[0]) / 2;
  const cy = (min[1] + max[1]) / 2;
  const cz = (min[2] + max[2]) / 2;
  for (const y of [min[1], max[1]]) {
    for (const z of [min[2], max[2]]) {
      const g = new BoxGeometry(sx, t, t);
      g.translate(cx, y, z);
      parts.push(g);
    }
    for (const x of [min[0], max[0]]) {
      const g = new BoxGeometry(t, t, sz);
      g.translate(x, y, cz);
      parts.push(g);
    }
  }
  for (const x of [min[0], max[0]]) {
    for (const z of [min[2], max[2]]) {
      const g = new BoxGeometry(t, sy, t);
      g.translate(x, cy, z);
      parts.push(g);
    }
  }
  // floor-level mid lines make the tilt readable even when corners are out of view
  for (const z of [cz]) {
    const g = new BoxGeometry(sx, t * 0.7, t * 0.7);
    g.translate(cx, min[1], z);
    parts.push(g);
  }
  return mergeNonIndexed(parts);
}

function mergeNonIndexed(parts: BufferGeometry[]): BufferGeometry {
  const flat = parts.map((p) => p.toNonIndexed());
  const count = flat.reduce((n, p) => n + p.getAttribute('position').count, 0);
  const pos = new Float32Array(count * 3);
  let o = 0;
  for (const p of flat) {
    const a = p.getAttribute('position').array as Float32Array;
    pos.set(a, o);
    o += a.length;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  return g;
}

// ---------------------------------------------------------------- gravity rain

const RAIN_COUNT = 180;

function makeRain(): { mesh: Mesh; mat: ShaderMaterial } {
  const quad = new InstancedBufferGeometry();
  // x across [-0.5, 0.5], y along the streak [0, 1]
  quad.setAttribute('position', new BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 1, 3, 2]);
  const offs = new Float32Array(RAIN_COUNT * 3);
  const phase = new Float32Array(RAIN_COUNT);
  let seed = 99;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < RAIN_COUNT; i++) {
    offs[i * 3] = rnd();
    offs[i * 3 + 1] = rnd();
    offs[i * 3 + 2] = rnd();
    phase[i] = rnd();
  }
  quad.setAttribute('aOff', new InstancedBufferAttribute(offs, 3));
  quad.setAttribute('aPhase', new InstancedBufferAttribute(phase, 1));
  quad.instanceCount = RAIN_COUNT;
  const mat = glowBlend(new ShaderMaterial({
    side: DoubleSide,
    forceSinglePass: true,
    uniforms: {
      uDir: { value: new Vector3(0, -1, 0) },
      uMin: { value: new Vector3() },
      uMax: { value: new Vector3(1, 1, 1) },
      uEye: { value: new Vector3() },
      uTravel: { value: 0 },
      uEnergy: { value: 0 },
      uLen: { value: 0.5 },
      uColor: { value: FLIP.clone() },
    },
    vertexShader: /* glsl */ `
      attribute vec3 aOff;
      attribute float aPhase;
      uniform vec3 uDir, uMin, uMax, uEye;
      uniform float uTravel, uEnergy, uLen;
      varying float vA;
      varying vec3 vP;
      void main() {
        vec3 size = uMax - uMin;
        vec3 p = uMin + aOff * size;
        // travel along gravity, wrapped inside the room box on that axis
        vec3 ad = abs(uDir);
        float span = dot(size, ad);
        float s = mod(aPhase * span + uTravel * (0.8 + aPhase * 0.6), span);
        vec3 lo = dot(uMin, ad) * ad;
        p = p - dot(p, ad) * ad + lo + ad * (dot(uDir, ad) > 0.0 ? s : span - s);
        vec3 view = normalize(uEye - p);
        vec3 side = normalize(cross(uDir, view));
        float len = uLen * (0.6 + aPhase * 0.8);
        vec3 w = p - uDir * position.y * len + side * position.x * 0.016;
        vP = w;
        float headFade = smoothstep(0.35, 0.9, length(w - uEye));
        vA = uEnergy * (1.0 - position.y) * headFade;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(w, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor, uMin, uMax;
      varying float vA;
      varying vec3 vP;
      void main() {
        if (any(lessThan(vP, uMin)) || any(greaterThan(vP, uMax))) discard;
        if (vA < 0.004) discard;
        gl_FragColor = vec4(mix(uColor, vec3(1.0), 0.3 * vA), vA * 0.9);
      }`,
  }));
  const mesh = new Mesh(quad, mat);
  mesh.frustumCulled = false;
  mesh.raycast = () => undefined;
  mesh.name = 'gravity-rain';
  return { mesh, mat };
}

// ---------------------------------------------------------------- slow-motion read-out

/** Dial rectangle inside the 1.4 m read-out quad at 0.32 m: the dial reads as 0.4 x 0.16 m at 0.7 m, 0.17 m low. */
const DIAL_RECT = { cx: 0.5, cy: 0.5 - (0.17 * 0.32) / 0.7 / 1.4, w: (0.4 * 0.32) / 0.7 / 1.4, h: (0.16 * 0.32) / 0.7 / 1.4 };
const DIAL_RECT_GLASSES_CY = 0.5 - (0.1 * 0.32) / 0.7 / 1.4;

/** Slow-motion read-out: flip-blue edge glow plus the time dial, one head-locked quad (one draw call). */
function makeVignette(dial: CanvasTexture): { mesh: Mesh; mat: ShaderMaterial } {
  const mat = glowBlend(new ShaderMaterial({
    depthTest: false,
    uniforms: {
      uAmt: { value: 0 },
      uDialA: { value: 0 },
      uDial: { value: dial },
      uRect: { value: [DIAL_RECT.cx, DIAL_RECT.cy, DIAL_RECT.w, DIAL_RECT.h] },
      uColor: { value: FLIP.clone() },
    },
    vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */ `
      uniform float uAmt, uDialA; uniform vec4 uRect; uniform sampler2D uDial; uniform vec3 uColor; varying vec2 vUv;
      void main(){
        vec2 q = (vUv - 0.5) * 2.0;
        float r = length(q * vec2(1.0, 1.15));
        float a = smoothstep(0.55, 1.15, r) * uAmt;
        vec3 col = uColor * a;
        vec2 d = (vUv - uRect.xy) / uRect.zw + 0.5;
        if (uDialA > 0.0 && d.x >= 0.0 && d.x <= 1.0 && d.y >= 0.0 && d.y <= 1.0) {
          vec4 t = texture2D(uDial, d);
          float ta = t.a * uDialA;
          // the dial is drawn over passthrough: premultiplied colour, its own alpha
          gl_FragColor = vec4(mix(col, t.rgb, ta), max(a, ta));
          return;
        }
        if (a < 0.003) discard;
        gl_FragColor = vec4(uColor, a);
      }`,
  }));
  // the dial panel must darken what is behind it, so this quad uses normal alpha blending
  mat.blending = NormalBlending;
  mat.transparent = true;
  const mesh = new Mesh(new PlaneGeometry(1.4, 1.4), mat);
  mesh.renderOrder = 50;
  mesh.frustumCulled = false;
  mesh.raycast = () => undefined;
  mesh.name = 'slowmo-readout';
  return { mesh, mat };
}

class TimeDial {
  private readonly canvas: HTMLCanvasElement;
  readonly tex: CanvasTexture;
  private last = -1;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 640;
    this.canvas.height = 256;
    this.tex = new CanvasTexture(this.canvas);
    this.tex.colorSpace = SRGBColorSpace;
    this.draw(1);
    // the canvas can only use the brand font once it has loaded; redraw then
    document.fonts?.load('600 110px "Albert Sans"').then(() => this.draw(this.last)).catch(() => undefined);
  }

  set(scale: number): void {
    const q = Math.round(scale * 20) / 20;
    if (q !== this.last) this.draw(q);
  }

  private draw(scale: number): void {
    this.last = scale;
    const g = this.canvas.getContext('2d')!;
    const W = this.canvas.width;
    const H = this.canvas.height;
    g.clearRect(0, 0, W, H);
    g.fillStyle = 'rgba(11,13,16,0.78)';
    g.beginPath();
    g.roundRect(8, 8, W - 16, H - 16, 40);
    g.fill();
    // arc gauge from 0x to 1x
    const cx = 140;
    const cy = H / 2 + 6;
    const r = 78;
    const a0 = Math.PI * 0.75;
    const a1 = Math.PI * 2.25;
    g.lineCap = 'round';
    g.lineWidth = 22;
    g.strokeStyle = '#12324a';
    g.beginPath();
    g.arc(cx, cy, r, a0, a1);
    g.stroke();
    g.strokeStyle = '#22b8ff';
    g.beginPath();
    g.arc(cx, cy, r, a0, a0 + (a1 - a0) * Math.max(0.02, scale));
    g.stroke();
    // hourglass glyph inside the gauge
    g.fillStyle = '#e9f6fd';
    g.beginPath();
    g.moveTo(cx - 22, cy - 30);
    g.lineTo(cx + 22, cy - 30);
    g.lineTo(cx + 3, cy);
    g.lineTo(cx + 22, cy + 30);
    g.lineTo(cx - 22, cy + 30);
    g.lineTo(cx - 3, cy);
    g.closePath();
    g.fill();
    g.fillStyle = '#e9f6fd';
    g.font = '600 110px "Albert Sans", system-ui, sans-serif';
    g.textBaseline = 'middle';
    g.fillText(`${scale.toFixed(2)}\u00d7`, 260, cy + 6);
    this.tex.needsUpdate = true;
  }
}

// ---------------------------------------------------------------- onboarding beacon

class Beacon {
  readonly group = new Group();
  private readonly disc: Mesh;
  private readonly discMat: ShaderMaterial;
  private readonly glyph: Mesh;
  private readonly frames: CanvasTexture[];
  private readonly glyphMat: MeshBasicMaterial;
  private frame = -1;

  constructor() {
    this.group.name = 'onboarding-beacon';
    // ring, outward ripple and soft glow in one quad (one draw call)
    this.discMat = glowBlend(new ShaderMaterial({
      side: DoubleSide,
      forceSinglePass: true,
      uniforms: { uT: { value: 0 }, uAlpha: { value: 0 }, uColor: { value: FLIP.clone() } },
      vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: /* glsl */ `
        uniform float uT, uAlpha; uniform vec3 uColor; varying vec2 vUv;
        void main(){
          float r = length(vUv - 0.5) * 1.6;
          float R = 0.34 * (1.0 + 0.08 * sin(uT * 6.3));
          float ring = smoothstep(0.034, 0.018, abs(r - R));
          float beat = fract(uT * 1.1);
          float ripple = smoothstep(0.016, 0.0, abs(r - (0.34 + beat * 0.44))) * (1.0 - beat);
          float glow = exp(-r * r * 9.0) * 0.35;
          float a = clamp(ring + ripple * 0.9 + glow, 0.0, 1.0) * uAlpha;
          if (a < 0.003) discard;
          gl_FragColor = vec4(mix(uColor, vec3(1.0), ring * 0.25), a);
        }`,
    }));
    this.disc = new Mesh(new PlaneGeometry(1.6, 1.6), this.discMat);
    this.disc.name = 'beacon-ring';
    this.frames = [pinchFrame(false), pinchFrame(true)];
    this.glyphMat = new MeshBasicMaterial({ map: this.frames[0], transparent: true, depthWrite: false });
    this.glyph = new Mesh(new PlaneGeometry(0.42, 0.42), this.glyphMat);
    this.glyph.name = 'beacon-pinch';
    this.group.add(this.disc, this.glyph);
    this.group.traverse((o) => {
      o.raycast = () => undefined;
    });
    this.group.visible = false;
  }

  /** Place on a surface point with its inward normal; t = seconds for the animation. */
  update(p: Vector3, n: Vector3, eye: Vector3, t: number, alpha: number): void {
    this.group.visible = alpha > 0.01;
    if (!this.group.visible) return;
    this.group.position.copy(p).addScaledVector(n, 0.012);
    this.group.lookAt(this.tmp.copy(p).add(n));
    this.discMat.uniforms.uT.value = t;
    this.discMat.uniforms.uAlpha.value = alpha;
    // the pinch glyph floats off the surface and faces the viewer
    this.glyph.position.set(0, 0, 0.3 + 0.03 * Math.sin(t * 3));
    this.glyph.lookAt(eye);
    const f = (t * 1.6) % 2 < 1.15 ? 0 : 1;
    if (f !== this.frame) {
      this.frame = f;
      this.glyphMat.map = this.frames[f];
      this.glyphMat.needsUpdate = true;
    }
    this.glyphMat.opacity = alpha;
  }

  private readonly tmp = new Vector3();
}

/**
 * Two frames of a pinch, drawn as a side-view hand: open (thumb and index
 * apart), then closed (tips touching, with a flip-blue flash).
 */
function pinchFrame(closed: boolean): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(11,13,16,0.85)';
  g.beginPath();
  g.arc(128, 128, 122, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#22b8ff';
  g.lineWidth = 8;
  g.stroke();
  g.fillStyle = '#e9f6fd';
  g.strokeStyle = '#e9f6fd';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  // back of the hand and curled fingers
  g.beginPath();
  g.roundRect(46, 104, 84, 80, 30);
  g.fill();
  g.lineWidth = 20;
  for (const y of [150, 172]) {
    g.beginPath();
    g.moveTo(112, y);
    g.lineTo(140, y + 4);
    g.stroke();
  }
  const tipY = closed ? 140 : 112;
  // index finger reaching forward and down to the tip
  g.lineWidth = 24;
  g.beginPath();
  g.moveTo(104, 118);
  g.quadraticCurveTo(160, 92, 188, tipY);
  g.stroke();
  // thumb rising to meet it
  const thumbY = closed ? 148 : 176;
  g.beginPath();
  g.moveTo(100, 176);
  g.quadraticCurveTo(150, 190, 184, thumbY);
  g.stroke();
  if (closed) {
    g.strokeStyle = '#22b8ff';
    g.lineWidth = 7;
    g.beginPath();
    g.arc(190, 144, 26, 0, Math.PI * 2);
    g.stroke();
  } else {
    // arrows: the tips come together
    g.fillStyle = '#22b8ff';
    for (const [y, d] of [[96, 1], [194, -1]] as const) {
      g.beginPath();
      g.moveTo(206, y);
      g.lineTo(222, y);
      g.lineTo(214, y + d * 12);
      g.closePath();
      g.fill();
    }
  }
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// ---------------------------------------------------------------- system

export class FlipFxSystem extends createSystem({}) {
  private roomHolder!: Group;
  private pivot!: Group;
  private ghost!: Mesh;
  private ghostMat!: MeshBasicMaterial;
  private rain!: { mesh: Mesh; mat: ShaderMaterial };
  private vignette!: { mesh: Mesh; mat: ShaderMaterial };
  private dial!: TimeDial;
  private beacon!: Beacon;
  private builtFor: RoomModel | null = null;
  private cue: TiltCue | null = null;
  private flipT = -1;
  private rainEnergy = 0;
  private travel = 0;
  private readonly eye = new Vector3();
  private readonly eyeRoom = new Vector3();
  private readonly fwd = new Vector3();
  private readonly tmp = new Vector3();
  private readonly n = new Vector3();
  private readonly axis = new Vector3();
  private beaconAlpha = 0;
  private time = 0;
  /** Frames left in which every effect is drawn invisibly so its shader compiles before the first flip. */
  private warm = 0;

  init(): void {
    this.roomHolder = new Group();
    this.roomHolder.name = 'flip-fx-room';
    this.pivot = new Group();
    this.roomHolder.add(this.pivot);
    this.ghostMat = glowBlend(new MeshBasicMaterial({ color: new Color('#5fd0ff'), opacity: 0 }));
    this.ghost = new Mesh(new BufferGeometry(), this.ghostMat);
    this.ghost.name = 'ghost-room';
    this.ghost.frustumCulled = false;
    this.ghost.raycast = () => undefined;
    this.ghost.visible = false;
    this.pivot.add(this.ghost);
    this.rain = makeRain();
    this.rain.mesh.visible = false;
    this.roomHolder.add(this.rain.mesh);
    this.world.createTransformEntity(this.roomHolder, { persistent: true });

    const view = new Group();
    view.name = 'flip-fx-view';
    this.dial = new TimeDial();
    this.vignette = makeVignette(this.dial.tex);
    this.vignette.mesh.visible = false;
    this.beacon = new Beacon();
    view.add(this.vignette.mesh, this.beacon.group);
    this.world.createTransformEntity(view, { persistent: true });

    this.cleanupFuncs.push(
      on('flip', (d) => this.onFlip(d as { dir: Dir; source: string; changed: boolean; from?: Dir })),
    );
  }

  private ensureRoom(room: RoomModel): void {
    if (this.builtFor === room) return;
    this.builtFor = room;
    this.warm = 3;
    this.ghost.geometry.dispose();
    this.ghost.geometry = ghostRoomGeometry(room.min, room.max, 0.022);
    const o = toWorld(room.frame, [0, 0, 0]);
    this.roomHolder.position.set(o[0], o[1], o[2]);
    this.roomHolder.rotation.set(0, room.frame.yaw, 0);
    const u = this.rain.mat.uniforms;
    (u.uMin.value as Vector3).set(room.min[0], room.min[1], room.min[2]);
    (u.uMax.value as Vector3).set(room.max[0], room.max[1], room.max[2]);
  }

  private onFlip(d: { dir: Dir; source: string; changed: boolean; from?: Dir }): void {
    if (d.source !== 'pinch') return;
    const from = d.from ?? D.NegY;
    this.cue = store.settings.tilt ? tiltCue(from, d.dir, store.settings.gentle) : null;
    this.flipT = 0;
    this.rainEnergy = 1;
    const v = dirVector(d.dir);
    (this.rain.mat.uniforms.uDir.value as Vector3).set(v[0], v[1], v[2]);
  }

  update(delta: number): void {
    this.time += delta;
    const room = store.room;
    this.camera.getWorldPosition(this.eye);
    this.camera.getWorldDirection(this.fwd);
    if (!room) {
      this.ghost.visible = false;
      this.rain.mesh.visible = false;
      this.updateView(1, 0);
      this.beacon.update(this.eye, this.fwd, this.eye, 0, 0);
      return;
    }
    this.ensureRoom(room);
    const er = toRoom(room.frame, [this.eye.x, this.eye.y, this.eye.z]);
    this.eyeRoom.set(er[0], er[1], er[2]);

    // ghost room tilt (real time)
    let slowAmt = 0;
    if (this.flipT >= 0) {
      this.flipT += delta;
      const dur = tiltDuration();
      if (this.cue) {
        const ang = tiltAngleAt(this.flipT, this.cue.peak);
        this.pivot.position.copy(this.eyeRoom);
        this.ghost.position.set(-this.eyeRoom.x, -this.eyeRoom.y, -this.eyeRoom.z);
        this.axis.set(this.cue.axis[0], this.cue.axis[1], this.cue.axis[2]);
        this.pivot.quaternion.setFromAxisAngle(this.axis, ang);
        const fade = Math.max(0, 1 - this.flipT / (dur + 0.3));
        this.ghostMat.opacity = 0.95 * Math.sqrt(fade);
        this.ghost.visible = fade > 0;
      } else {
        this.ghost.visible = false;
      }
      if (this.flipT > dur + 0.3 && slowmoDone(this.flipT)) this.flipT = -1;
    } else {
      this.ghost.visible = false;
    }

    // gravity rain: crawls in slow motion, speeds up as time returns, then fades
    const ts = store.paused || store.menuOpen ? 0 : store.timeScale;
    if (this.rainEnergy > 0) {
      this.rainEnergy = Math.max(0, this.rainEnergy - delta * (ts < 0.9 ? 0.18 : 0.75));
      this.travel += delta * (0.6 + 5.5 * ts * ts);
      const u = this.rain.mat.uniforms;
      u.uTravel.value = this.travel;
      u.uEnergy.value = Math.min(1, this.rainEnergy * 1.4);
      u.uLen.value = 0.25 + 0.75 * ts;
      (u.uEye.value as Vector3).copy(this.eyeRoom);
      this.rain.mesh.visible = true;
    } else {
      this.rain.mesh.visible = false;
    }

    // slow-motion read-out, only while a pinch flip's ramp plays
    if (store.timeScale < 0.999 && !store.paused && !store.menuOpen && store.timeOverride == null) {
      slowAmt = (1 - store.timeScale) / (1 - 0.15);
    } else if (store.timeOverride != null && !store.paused && !store.menuOpen) {
      slowAmt = (1 - store.timeScale) * 0.8;
    }
    this.updateView(store.timeScale, slowAmt);
    this.updateBeacon(room, delta);
    if (this.warm > 0) {
      // Draw each effect at zero strength for a few frames: their shaders compile now,
      // not as an 80 ms hitch on the first pinch.
      this.warm--;
      if (!this.ghost.visible) {
        this.ghostMat.opacity = 0;
        this.ghost.visible = true;
      }
      if (!this.rain.mesh.visible) {
        this.rain.mat.uniforms.uEnergy.value = 0;
        this.rain.mesh.visible = true;
      }
      if (!this.vignette.mesh.visible) {
        this.vignette.mat.uniforms.uAmt.value = 0;
        this.vignette.mat.uniforms.uDialA.value = 0;
        this.vignette.mesh.position.copy(this.eye).addScaledVector(this.fwd, 0.32);
        this.vignette.mesh.visible = true;
      }
    }
  }

  private updateView(scale: number, amt: number): void {
    const v = this.vignette.mesh;
    v.visible = amt > 0.01;
    const u = this.vignette.mat.uniforms;
    u.uAmt.value = 0.42 * amt;
    u.uDialA.value = Math.min(1, amt * 2.5);
    (u.uRect.value as number[])[1] = store.glassesActive ? DIAL_RECT_GLASSES_CY : DIAL_RECT.cy;
    if (v.visible) {
      this.dial.set(scale);
      v.position.copy(this.eye).addScaledVector(this.fwd, 0.32);
      this.camera.getWorldQuaternion(v.quaternion);
    }
  }

  /** Where the current onboarding step wants a pinch. */
  private beaconTarget(room: RoomModel): { p: V3; n: V3 } | null {
    if (store.mode !== 'onboarding' || store.onboardingStep > 2 || store.menuOpen) return null;
    const step = store.onboardingStep;
    const f = room.forward;
    const h = room.head;
    if (step === 0) {
      const c = store.toyCentre ?? [h[0] + f[0] * 1.2, 0, h[2] + f[2] * 1.2];
      return { p: [c[0], room.max[1], c[2]], n: [0, -1, 0] };
    }
    if (step === 2) {
      const c = store.toyCentre;
      const ahead: V3 = [h[0] + f[0] * 1.0, 0, h[2] + f[2] * 1.0];
      // beside the pile, not under it, so the ring is not hidden by the table
      const p: V3 = c ? [ahead[0] + (ahead[0] - c[0]) * 0.0 - f[2] * 0.7, 0, ahead[2] + f[0] * 0.7] : ahead;
      return { p, n: [0, 1, 0] };
    }
    // step 1: the wall most to the side of the viewer's forward (a sideways fall reads best)
    let best: { p: V3; n: V3 } | null = null;
    let bestScore = -Infinity;
    for (const dir of [D.PosX, D.NegX, D.PosZ, D.NegZ] as Dir[]) {
      const s = boundaryFor(room, dir);
      const dv = dirVector(dir);
      const side = Math.abs(dv[0] * f[2] - dv[2] * f[0]);
      const ahead = dv[0] * f[0] + dv[2] * f[2];
      const score = side + ahead * 0.6 + (s.real ? 0.4 : 0);
      if (score > bestScore) {
        bestScore = score;
        const p: V3 = [s.center[0], Math.min(room.max[1] - 0.4, h[1] + 0.25), s.center[2]];
        // slide along the wall toward the viewer's forward
        const along = dv[0] !== 0 ? 2 : 0;
        p[along] = Math.max(room.min[along] + 0.5, Math.min(room.max[along] - 0.5, h[along] + f[along] * 1.4));
        best = { p, n: [-dv[0], -dv[1], -dv[2]] };
      }
    }
    return best;
  }

  private updateBeacon(room: RoomModel, delta: number): void {
    const t = this.beaconTarget(room);
    this.beaconAlpha += ((t ? 1 : 0) - this.beaconAlpha) * Math.min(1, delta * 5);
    if (!t) {
      if (this.beaconAlpha < 0.02) {
        this.beacon.update(this.eye, this.fwd, this.eye, this.time, 0);
        return;
      }
    }
    store.beacon = t ? (toWorld(room.frame, t.p) as V3) : null;
    if (t) {
      const p = toWorld(room.frame, t.p);
      const n = dirToWorld(room.frame, t.n);
      this.lastBeacon = { p: new Vector3(p[0], p[1], p[2]), n: new Vector3(n[0], n[1], n[2]) };
    }
    if (!this.lastBeacon) return;
    this.n.copy(this.lastBeacon.n);
    this.beacon.update(this.lastBeacon.p, this.n, this.eye, this.time, this.beaconAlpha);
  }

  private lastBeacon: { p: Vector3; n: Vector3 } | null = null;
}

export { PAPER };
