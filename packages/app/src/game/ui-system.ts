import {
  type Entity,
  Group,
  Quaternion,
  type UIKit,
  type UIKitDocument,
  type UIKitMLAsset,
  Vector3,
  createSystem,
} from '@iwsdk/core';
import { Dir as D, PUZZLES, SET_NAMES, boundaryFor, dirToWorld, toWorld } from '@sakasa/core';
import { synth } from './audio.js';
import { makeCompass } from './fx.js';
import { GravitySystem } from './gravity-system.js';
import { PlaySystem } from './play-system.js';
import { emit, firstUnsolved, logEvent, on, saveSettings, store } from './store.js';

type Action = (() => void) | null;

interface HudContent {
  eyebrow: string;
  stats: string;
  guide: ('up' | 'side' | 'down' | 'point' | 'pinch')[];
  title: string;
  body: string;
  stars: number;
  a: { label: string; run: Action } | null;
  b: { label: string; run: Action } | null;
}

const PUZZLE_IDS = PUZZLES.map((p) => p.id);
const DOWN_NAMES: Record<number, string> = {
  [D.PosX]: 'WALL',
  [D.NegX]: 'WALL',
  [D.PosY]: 'CEILING',
  [D.NegY]: 'FLOOR',
  [D.PosZ]: 'WALL',
  [D.NegZ]: 'WALL',
};

/**
 * The two UIKitML panels (HUD and wrist menu), their placement (lazy-follow
 * HUD, palm-up wrist menu, centred menu in Glasses mode), the wrist gravity
 * compass, and Glasses mode detection.
 */
export class UiSystem extends createSystem({}) {
  private hud!: UIKitMLAsset;
  private menu!: UIKitMLAsset;
  private hudEntity!: Entity;
  private menuEntity!: Entity;
  private el = new Map<string, UIKit.Text>();
  private actions: { a: Action; b: Action } = { a: null, b: null };
  private compass!: Group;
  private readonly head = new Vector3();
  private readonly fwd = new Vector3();
  private readonly tmp = new Vector3();
  private readonly tmp2 = new Vector3();
  private readonly q = new Quaternion();
  private readonly down = new Vector3(0, -1, 0);
  private hudYaw = 0;
  private hudAnchored = false;
  private palmUpTime = 0;
  private palmDownTime = 0;
  private menuFromPalm = false;
  private menuHand: XRHandedness = 'left';
  private menuHovered = 0;
  private dirty = true;
  private lastStats = '';

  init(): void {
    this.hud = this.world.requireSceneObject<UIKitMLAsset>('hud-panel');
    this.menu = this.world.requireSceneObject<UIKitMLAsset>('menu-panel');
    this.hudEntity = this.world.requireSceneEntity('hud-panel');
    this.menuEntity = this.world.requireSceneEntity('menu-panel');
    this.hud.name = 'Sakasa HUD';
    this.menu.name = 'Sakasa Menu';
    const ids = [
      'hud-eyebrow', 'hud-stats', 'hud-title', 'hud-body', 'hud-guide', 'hud-stars', 'hud-buttons',
      'g-up', 'g-side', 'g-down', 'g-point', 'g-pinch', 'star-1', 'star-2', 'star-3',
      'btn-a', 'btn-b', 'btn-menu', 'btn-a-label', 'btn-b-label',
    ];
    for (const id of ids) {
      const e = this.hud.requireElementById<UIKit.Text>(id);
      e.name = id;
      this.el.set(id, e);
    }
    const menuIds = [
      'm-prev', 'm-next', 'm-level', 'm-meta', 'm-play', 'm-play-label', 'm-daily', 'm-sandbox',
      'm-gentle', 'm-gentle-label', 'm-glasses', 'm-glasses-label', 'm-sound', 'm-sound-label',
      'm-rescan', 'm-resume', 'm-exit',
    ];
    for (const id of menuIds) {
      const e = this.menu.requireElementById<UIKit.Text>(id);
      e.name = id;
      this.el.set(id, e);
    }
    this.click('btn-a', () => this.actions.a?.());
    this.click('btn-b', () => this.actions.b?.());
    this.click('btn-menu', () => this.openMenu(false));
    this.click('m-prev', () => this.shiftLevel(-1));
    this.click('m-next', () => this.shiftLevel(1));
    this.click('m-play', () => this.closeMenuThen(() => this.playSys().startPuzzle(store.puzzleIndex)));
    this.click('m-daily', () => this.closeMenuThen(() => this.playSys().startPuzzle(-1)));
    this.click('m-sandbox', () => this.closeMenuThen(() => this.playSys().startSandbox()));
    this.click('m-gentle', () => {
      store.settings.gentle = !store.settings.gentle;
      saveSettings();
      this.world.getSystem(GravitySystem)?.refresh();
      this.refreshMenu();
    });
    this.click('m-glasses', () => {
      const order = ['auto', 'on', 'off'] as const;
      store.settings.glasses = order[(order.indexOf(store.settings.glasses) + 1) % 3];
      saveSettings();
      this.refreshMenu();
    });
    this.click('m-sound', () => {
      store.settings.sound = !store.settings.sound;
      saveSettings();
      this.refreshMenu();
    });
    this.click('m-rescan', () => this.closeMenuThen(() => (window as unknown as { __sakasaRescan?: () => void }).__sakasaRescan?.()));
    this.click('m-resume', () => this.closeMenu());
    this.click('m-exit', () => {
      this.closeMenu();
      logEvent('exit', 'menu');
      this.world.exitXR();
    });
    const menuObj = this.menu as unknown as { addEventListener: (t: string, f: () => void) => void };
    menuObj.addEventListener('pointerenter', () => this.menuHovered++);
    menuObj.addEventListener('pointerleave', () => (this.menuHovered = Math.max(0, this.menuHovered - 1)));

    this.compass = makeCompass();
    this.compass.name = 'wrist-compass';
    this.compass.visible = false;
    this.world.createTransformEntity(this.compass, { persistent: true });

    this.menu.visible = false;
    for (const ev of ['mode', 'room', 'flip', 'onboarding', 'puzzle', 'win', 'pause']) {
      this.cleanupFuncs.push(on(ev, () => (this.dirty = true)));
    }
    this.cleanupFuncs.push(
      on('pause', () => {
        if (!store.menuOpen) this.openMenu(false);
      }),
    );
  }

  private playSys(): PlaySystem {
    return this.world.getSystem(PlaySystem)!;
  }

  private click(id: string, fn: () => void): void {
    const e = this.el.get(id)!;
    const handler = () => {
      synth.resume();
      synth.tick(true);
      logEvent('ui', id);
      fn();
      this.dirty = true;
    };
    e.addEventListener('click', handler);
    this.cleanupFuncs.push(() => e.removeEventListener('click', handler));
  }

  private set(id: string, props: Record<string, unknown>): void {
    this.el.get(id)?.setProperties(props as never);
  }

  private show(id: string, on: boolean): void {
    this.set(id, { display: on ? 'flex' : 'none' });
  }

  // ------------------------------------------------------------- menu

  openMenu(fromPalm: boolean): void {
    if (store.mode === 'idle' || store.mode === 'scanning') return;
    store.menuOpen = true;
    this.menuFromPalm = fromPalm;
    this.menu.visible = true;
    this.refreshMenu();
    this.placeMenuInFront();
    logEvent('menu', fromPalm ? 'open (palm up)' : 'open');
    emit('menu');
  }

  closeMenu(): void {
    if (!store.menuOpen) return;
    store.menuOpen = false;
    store.paused = false;
    this.menu.visible = false;
    this.menuHovered = 0;
    logEvent('menu', 'close');
    emit('menu');
  }

  private closeMenuThen(fn: () => void): void {
    this.closeMenu();
    fn();
  }

  private shiftLevel(d: number): void {
    store.puzzleIndex = (store.puzzleIndex + d + PUZZLES.length) % PUZZLES.length;
    this.refreshMenu();
  }

  private refreshMenu(): void {
    const spec = PUZZLES[store.puzzleIndex];
    const best = store.progress[spec.id];
    this.set('m-level', { text: `${String(spec.index + 1).padStart(2, '0')} ${spec.title}` });
    this.set('m-meta', { text: `SET ${spec.set} ${SET_NAMES[spec.set].toUpperCase()} / BEST ${best ? '*'.repeat(best) : '-'}` });
    this.set('m-gentle-label', { text: store.settings.gentle ? 'Gentle on' : 'Gentle off' });
    this.set('m-glasses-label', { text: `Glasses ${store.settings.glasses}` });
    this.set('m-sound-label', { text: store.settings.sound ? 'Sound on' : 'Sound off' });
  }

  // ------------------------------------------------------------- HUD content

  private content(): HudContent {
    const play = this.playSys();
    const room = store.room;
    const base: HudContent = { eyebrow: 'SAKASA', stats: '', guide: [], title: '', body: '', stars: -1, a: null, b: null };
    switch (store.mode) {
      case 'idle':
      case 'scanning':
        return { ...base, title: 'Scanning', body: 'Look around your room.' };
      case 'onboarding': {
        const step = store.onboardingStep;
        const note = room && room.notes.length > 0 ? room.notes[0] : '';
        const skip = { label: 'Skip', run: () => this.finishOnboarding() };
        if (step === 0) return { ...base, guide: ['up', 'point', 'pinch'], title: 'Point up. Pinch.', body: note, b: skip };
        if (step === 1) return { ...base, guide: ['side', 'point', 'pinch'], title: 'Now a wall.', b: skip };
        if (step === 2) return { ...base, guide: ['down', 'point', 'pinch'], title: 'Back down.', b: skip };
        return {
          ...base,
          title: 'Your room is the level.',
          body: 'Flip gravity to guide the light into the ring. Fewer flips, more stars.',
          a: { label: 'Play', run: () => play.startPuzzle(firstUnsolved(PUZZLES.length, PUZZLE_IDS)) },
          b: { label: 'Sandbox', run: () => play.startSandbox() },
        };
      }
      case 'sandbox':
        return {
          ...base,
          eyebrow: 'SANDBOX',
          stats: `DOWN ${DOWN_NAMES[store.gravity]}`,
          title: 'Drop everything.',
          body: 'Point at any surface and pinch. Pinch a toy to grab and throw it.',
          a: { label: 'Drop all', run: () => play.dropAll() },
          b: { label: 'Puzzles', run: () => play.startPuzzle(store.puzzleIndex) },
        };
      case 'puzzle': {
        const p = store.puzzle;
        if (!p) return base;
        const label = store.isDaily ? 'DAILY' : `PUZZLE ${String(p.spec.index + 1).padStart(2, '0')} / SET ${p.spec.set}`;
        if (store.puzzleState === 'won') {
          const nextIdx = store.isDaily ? store.puzzleIndex : Math.min(PUZZLES.length - 1, store.puzzleIndex + 1);
          return {
            ...base,
            eyebrow: label,
            stats: `FLIPS ${store.puzzleFlips} / PAR ${p.par}`,
            title: 'Solved.',
            body: store.puzzleFlips <= p.par ? 'Perfect: par.' : `Par is ${p.par}. Try it in fewer flips.`,
            stars: store.lastStars,
            a: { label: 'Next', run: () => play.startPuzzle(nextIdx) },
            b: { label: 'Replay', run: () => play.resetPuzzle() },
          };
        }
        return {
          ...base,
          eyebrow: label,
          stats: `FLIPS ${store.puzzleFlips} / PAR ${p.par}`,
          guide: p.spec.index === 0 && store.puzzleFlips === 0 && !store.isDaily ? ['point', 'pinch'] : [],
          title: p.spec.title,
          body: 'Guide the light into the ring.',
          a: { label: 'Undo', run: () => play.undo() },
          b: { label: 'Reset', run: () => play.resetPuzzle() },
        };
      }
    }
    return base;
  }

  private finishOnboarding(): void {
    store.onboardingStep = 3;
    logEvent('onboarding', 'skipped to end');
    emit('onboarding');
  }

  private render(): void {
    const c = this.content();
    this.set('hud-eyebrow', { text: c.eyebrow });
    this.set('hud-stats', { text: c.stats });
    this.lastStats = c.stats;
    this.set('hud-title', { text: c.title });
    this.set('hud-body', { text: c.body });
    this.show('hud-body', c.body.length > 0);
    this.show('hud-guide', c.guide.length > 0);
    for (const g of ['up', 'side', 'down', 'point', 'pinch'] as const) this.show(`g-${g}`, c.guide.includes(g));
    this.show('hud-stars', c.stars > 0);
    for (let i = 1; i <= 3; i++) this.set(`star-${i}`, { color: i <= c.stars ? '#22b8ff' : '#2a3b46' });
    this.actions.a = c.a?.run ?? null;
    this.actions.b = c.b?.run ?? null;
    this.show('btn-a', c.a != null);
    this.show('btn-b', c.b != null);
    if (c.a) this.set('btn-a-label', { text: c.a.label });
    if (c.b) this.set('btn-b-label', { text: c.b.label });
    this.show('btn-menu', store.mode !== 'scanning' && store.mode !== 'idle');
  }

  // ------------------------------------------------------------- per frame

  update(delta: number): void {
    this.detectGlasses();
    if (this.dirty) {
      this.dirty = false;
      this.render();
    } else if (store.mode === 'sandbox') {
      const s = `DOWN ${DOWN_NAMES[store.gravity]}`;
      if (s !== this.lastStats) this.render();
    }
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.fwd);
    this.placeHud(delta);
    this.updateHands(delta);
    if (store.menuOpen && !this.menuFromPalm) this.faceHead(this.menu);
  }

  private detectGlasses(): void {
    const session = this.world.session;
    let gaze = false;
    if (session) for (const s of session.inputSources) if (s.targetRayMode === 'gaze') gaze = true;
    store.gazeDetected = gaze;
    const active = store.settings.glasses === 'on' || (store.settings.glasses === 'auto' && gaze);
    if (active !== store.glassesActive) {
      store.glassesActive = active;
      this.hudAnchored = false;
      logEvent('glasses', active ? 'on' : 'off');
      this.dirty = true;
    }
  }

  /** HUD: a little below eye level, re-centred lazily when you turn away. */
  private placeHud(delta: number): void {
    const glasses = store.glassesActive;
    const dist = glasses ? 0.85 : 1.0;
    const drop = glasses ? 0.12 : 0.3;
    const width = glasses ? 0.34 : 0.42;
    const yaw = Math.atan2(this.fwd.x, this.fwd.z);
    let diff = yaw - this.hudYaw;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    const threshold = glasses ? 0.35 : 0.6;
    if (!this.hudAnchored) {
      this.hudYaw = yaw;
      this.hudAnchored = true;
    } else if (Math.abs(diff) > threshold) {
      this.hudYaw += diff * Math.min(1, delta * 3);
    }
    this.size(this.hud.document, width);
    this.size(this.menu.document, glasses ? 0.36 : this.menuFromPalm ? 0.3 : 0.38);
    const o = this.hudEntity.object3D!;
    // Quest: down-left of centre so the table in front stays clear. Glasses: centred (narrow FoV).
    const side = glasses ? 0 : 0.32;
    this.tmp.set(Math.sin(this.hudYaw + side), 0, Math.cos(this.hudYaw + side));
    o.position.set(this.head.x + this.tmp.x * dist, this.head.y - drop, this.head.z + this.tmp.z * dist);
    this.faceHead(o);
    o.visible = !store.menuOpen || this.menuFromPalm;
  }

  private size(doc: UIKitDocument, width: number): void {
    if (doc.targetSize.width !== width) doc.setTargetDimensions(width, 2);
  }

  private faceHead(o: { position: Vector3; lookAt: (v: Vector3) => void }): void {
    this.tmp2.copy(this.head);
    o.lookAt(this.tmp2);
  }

  private placeMenuInFront(): void {
    const o = this.menuEntity.object3D!;
    this.camera.getWorldPosition(this.head);
    this.camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    this.fwd.normalize();
    const dist = store.glassesActive ? 0.75 : 0.7;
    o.position.set(this.head.x + this.fwd.x * dist, this.head.y - (store.glassesActive ? 0.06 : 0.18), this.head.z + this.fwd.z * dist);
    this.faceHead(o);
  }

  /** Palm-up wrist menu and wrist compass, from WebXR hand joints. */
  private updateHands(delta: number): void {
    const frame = this.xrFrame;
    const session = this.world.session;
    const ref = this.xrManager.getReferenceSpace();
    let compassPlaced = false;
    let palmUp: { hand: XRHandedness; pos: Vector3 } | null = null;
    if (frame && session && ref) {
      for (const source of session.inputSources) {
        const hand = source.hand;
        if (!hand) continue;
        const wrist = frame.getJointPose?.(hand.get('wrist')!, ref);
        const index = frame.getJointPose?.(hand.get('index-finger-metacarpal')!, ref);
        const pinky = frame.getJointPose?.(hand.get('pinky-finger-metacarpal')!, ref);
        if (!wrist || !index || !pinky) continue;
        const w = wrist.transform.position;
        const ax = index.transform.position.x - w.x;
        const ay = index.transform.position.y - w.y;
        const az = index.transform.position.z - w.z;
        const bx = pinky.transform.position.x - w.x;
        const by = pinky.transform.position.y - w.y;
        const bz = pinky.transform.position.z - w.z;
        // palm normal: for the right hand a x b points out of the palm, for the left b x a.
        const s = source.handedness === 'right' ? 1 : -1;
        const nx = s * (ay * bz - az * by);
        const ny = s * (az * bx - ax * bz);
        const nz = s * (ax * by - ay * bx);
        const nl = Math.hypot(nx, ny, nz) || 1;
        const up = ny / nl;
        if (source.handedness === 'left' || (!compassPlaced && source.handedness === 'right')) {
          // compass rides on the back of the wrist
          this.compass.position.set(w.x - (nx / nl) * 0.035, w.y - (ny / nl) * 0.035, w.z - (nz / nl) * 0.035);
          compassPlaced = true;
        }
        if (up > 0.7) {
          this.tmp.set(w.x, w.y, w.z);
          palmUp = { hand: source.handedness, pos: this.tmp.clone() };
        }
      }
    }
    // compass arrow points along gravity in the world
    if (compassPlaced && store.room) {
      const g = dirToWorld(store.room.frame, [
        [1, -1, 0, 0, 0, 0][store.gravity],
        [0, 0, 1, -1, 0, 0][store.gravity],
        [0, 0, 0, 0, 1, -1][store.gravity],
      ]);
      this.tmp2.set(g[0], g[1], g[2]);
      const arrow = this.compass.getObjectByName('compass-arrow');
      if (arrow) arrow.quaternion.setFromUnitVectors(this.down, this.tmp2);
      this.compass.lookAt(this.head);
      if (arrow) {
        // keep the arrow in world orientation regardless of the ring's facing
        this.q.copy(this.compass.quaternion).invert();
        arrow.quaternion.premultiply(this.q);
      }
      this.compass.visible = store.mode !== 'idle';
    } else {
      this.compass.visible = false;
    }

    if (palmUp && store.mode !== 'idle' && store.mode !== 'scanning') {
      this.palmUpTime += delta;
      this.palmDownTime = 0;
      if (!store.menuOpen && this.palmUpTime > 0.35) {
        this.menuHand = palmUp.hand;
        this.openMenu(true);
      }
      if (store.menuOpen && this.menuFromPalm && palmUp.hand === this.menuHand) {
        const o = this.menuEntity.object3D!;
        o.position.set(palmUp.pos.x, palmUp.pos.y + 0.16, palmUp.pos.z);
        this.faceHead(o);
      }
    } else {
      this.palmUpTime = 0;
      if (store.menuOpen && this.menuFromPalm) {
        this.palmDownTime += delta;
        if (this.palmDownTime > 1.0 && this.menuHovered === 0) this.closeMenu();
      }
    }
  }
}

/** Where is "down" relative to the viewer (for the edge hint)? Exposed for tests. */
export function downSurfaceWorld(): [number, number, number] | null {
  const room = store.room;
  if (!room) return null;
  const s = boundaryFor(room, store.gravity);
  return toWorld(room.frame, s.center);
}
