// Records the raw takes for the Sakasa walkthrough film (grokbot/videos/sakasa/film-raw/).
// Each take is a real-time DevTools screencast of the managed IWER page at 1920 x 1080 with the
// app's own WebAudio output recorded from its master bus. Input is the emulated hands (or gaze on
// the Glasses take) driven through the in-page IWER device: aim, pinch, palm-up, exactly as a
// player acts. Only take setup uses debug hooks (loading puzzle 14), and the film caption says so.
// Usage: node e2e/record-film.mjs [splash|onboarding|puzzles|set3|sandbox|options|glasses]...
import { readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP, cli, evaluate, freshSession, sleep, state, waitSettled } from './lib.mjs';

const RAW = resolve(APP, '../../../../videos/sakasa/film-raw');
mkdirSync(RAW, { recursive: true });
const which = process.argv.slice(2);
const want = (n) => which.length === 0 || which.includes(n);
const W = 1920;
const H = 1080;

// Hide everything that is not the app canvas (emulator toolbar, workspace chrome) in the
// managed page, so the take is the full-frame emulator view.
const HIDE_CSS = `(() => {
  const s = document.createElement('style');
  s.id = 'film-hide';
  s.textContent = '.workspace-view-switcher { display: none !important; }';
  document.head.appendChild(s);
  return true;
})()`;

const HELPERS = `(() => {
  const D = window.IWER_DEVICE;
  const S = window.__sakasa;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function slerp(a, b, t) {
    let [ax, ay, az, aw] = a; let [bx, by, bz, bw] = b;
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) { cos = -cos; bx = -bx; by = -by; bz = -bz; bw = -bw; }
    let k0 = 1 - t, k1 = t;
    if (cos < 0.9995) { const o = Math.acos(cos); const s = Math.sin(o); k0 = Math.sin((1 - t) * o) / s; k1 = Math.sin(t * o) / s; }
    const r = [ax * k0 + bx * k1, ay * k0 + by * k1, az * k0 + bz * k1, aw * k0 + bw * k1];
    const l = Math.hypot(...r); return r.map((v) => v / l);
  }
  function look(from, to) {
    const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.hypot(dx, dz));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    return [cy * sp, sy * cp, -sy * sp, cy * cp];
  }
  const target = (who) => who === 'head' ? D : who === 'gaze' ? D.gaze : D.hands[who];
  const posOf = (who) => { const p = target(who).position; return [p.x, p.y, p.z]; };
  const moves = new Map();
  window.__rec = {
    turn(who, to, ms) {
      const o = target(who); const q = o.quaternion; const from = [q.x, q.y, q.z, q.w];
      const t0 = performance.now(); const id = Symbol(); moves.set(who + 'q', id);
      const step = () => {
        if (moves.get(who + 'q') !== id) return;
        const t = Math.min(1, (performance.now() - t0) / ms); const e = t * t * (3 - 2 * t);
        const r = slerp(from, to, e); o.quaternion.set(r[0], r[1], r[2], r[3]);
        if (t < 1) setTimeout(step, 11);
      };
      step(); return true;
    },
    move(who, to, ms) {
      const o = target(who); const from = [o.position.x, o.position.y, o.position.z];
      const t0 = performance.now(); const id = Symbol(); moves.set(who + 'p', id);
      const step = () => {
        if (moves.get(who + 'p') !== id) return;
        const t = Math.min(1, (performance.now() - t0) / ms); const e = t * t * (3 - 2 * t);
        o.position.set(from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e, from[2] + (to[2] - from[2]) * e);
        if (t < 1) setTimeout(step, 11);
      };
      step(); return true;
    },
    look(who, p, ms) { return this.turn(who, look(posOf(who), p), ms); },
    aimObj(who, name, ms) { const p = S.objectWorld(name); if (!p) return 'missing ' + name; this.look(who, p, ms); return p; },
    aimSurface(who, id, ms, from) { const p = S.aim(id, from ?? posOf(who === 'gaze' ? 'head' : who)); if (!p) return 'no aim ' + id; this.look(who, p, ms); return p; },
    aimBody(who, name, ms) { const b = S.bodies().find((x) => x.name === name); if (!b) return 'no body ' + name; this.look(who, b.p, ms); return b.p; },
    async pinch(hand, holdMs) {
      const h = D.hands[hand];
      for (let i = 0; i <= 8; i++) { h.updatePinchValue(i / 8); await sleep(14); }
      await sleep(holdMs);
      for (let i = 8; i >= 0; i--) { h.updatePinchValue(i / 8); await sleep(14); }
      return S.state().gravity;
    },
    pinchLater(hand, holdMs) { this.pinch(hand, holdMs); return true; },
    setPinch(hand, v) { D.hands[hand].updatePinchValue(v); return true; },
    pose(who, p, q) { const o = target(who); o.position.set(p[0], p[1], p[2]); o.quaternion.set(q[0], q[1], q[2], q[3]); return true; },
    state() { const s = S.state(); return { mode: s.mode, step: s.onboardingStep, gravity: s.gravity, menu: s.menuOpen, puzzle: s.puzzle && { id: s.puzzle.id, state: s.puzzle.state, flips: s.puzzle.flips }, settings: s.settings }; },
  };
  return true;
})()`;

const js = (s) => s;
const q = (v) => JSON.stringify(v);

function headLook(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

function devicePose(device) {
  const who = device === 'headset' ? 'D' : device === 'gaze' ? 'D.gaze' : `D.hands.${device === 'hand-left' ? 'left' : 'right'}`;
  return evaluate(`(() => { const D = window.IWER_DEVICE; const o = ${who}; return { p: [o.position.x, o.position.y, o.position.z], q: [o.quaternion.x, o.quaternion.y, o.quaternion.z, o.quaternion.w] }; })()`);
}

/** A hand pose the CLI sets (palm up / palm down), read back as position + quaternion. */
function cliHandPose(device, position, orientation) {
  const before = devicePose(device);
  cli(['xr', 'set-transform'], { device, position, orientation });
  const pose = devicePose(device);
  cli(['xr', 'set-transform'], {
    device,
    position: { x: before.p[0], y: before.p[1], z: before.p[2] },
    orientation: { x: before.q[0], y: before.q[1], z: before.q[2], w: before.q[3] },
  });
  return pose;
}

function setHead(target) {
  const head = devicePose('headset').p;
  const qh = headLook(head, target);
  cli(['xr', 'set-transform'], { device: 'headset', orientation: { x: qh[0], y: qh[1], z: qh[2], w: qh[3] } });
}

function runCapture(name, durationMs, timeline) {
  const dir = join(APP, 'e2e/.tmp', `film-${name}`);
  rmSync(dir, { recursive: true, force: true });
  const file = join(APP, 'e2e/.tmp', `film-${name}.mjs`);
  writeFileSync(
    file,
    `import { capture } from '../capture.mjs';\nexport default ({ frame, cdp }) => capture({ frame, cdp }, ${q(dir)}, ${durationMs}, ${q(timeline)}, { width: ${W}, height: ${H}, audio: true, hideCss: ${q(HIDE_CSS)} });\n`,
  );
  const r = cli(['browser', 'run', file, '--timeout', String(durationMs + 30000)], undefined, { timeout: durationMs + 60000 });
  return { dir, ...r };
}

/** Frames + recorded audio -> one 1920 x 1080, 30 fps take (no captions; the edit adds them). */
function encode(name, dir) {
  const out = join(RAW, `${name}.mp4`);
  const args = ['-nostdin', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.ffconcat')];
  let hasAudio = false;
  try {
    readFileSync(join(dir, 'audio.webm'));
    hasAudio = true;
  } catch {
    hasAudio = false;
  }
  if (hasAudio) args.push('-i', join(dir, 'audio.webm'));
  else args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
  args.push('-vf', `fps=30,scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=0x0b0d10`);
  args.push('-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p');
  args.push('-af', 'apad', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-ac', '2', '-shortest');
  args.push('-movflags', '+faststart', out);
  execFileSyncSafe('ffmpeg', args);
  return out;
}

import { execFileSync } from 'node:child_process';
function execFileSyncSafe(cmd, args) {
  execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
}

const results = {};
function save(name, r, extra = {}) {
  const out = encode(name, r.dir);
  results[name] = { out, frames: r.frames, seconds: r.seconds, fps: r.fps, audioState: r.audioState, audioBytes: r.audioBytes, log: r.log, ...extra };
  console.log(`${name}: ${out} ${r.frames} frames ${r.seconds}s ${r.fps}fps audio ${r.audioState} ${r.audioBytes}B`);
  const rep = join(RAW, 'takes.json');
  let all = {};
  try {
    all = JSON.parse(readFileSync(rep, 'utf8'));
  } catch {
    all = {};
  }
  all[name] = results[name];
  writeFileSync(rep, JSON.stringify(all, null, 2));
}

const TABLE = [0.1, 0.55, -1.95];

// ---------------------------------------------------------------- takes

if (want('splash')) {
  // First launch as a player sees it: the 2D page, "Enter your room", the scan, the first cue.
  try {
    evaluate('(localStorage.clear(), true)');
  } catch {
    // page may not be up yet
  }
  cli(['xr', 'set-input-mode'], { mode: 'hand' }, { allowFail: true });
  cli(['browser', 'reload'], {}, { allowFail: true });
  await sleep(9000);
  const T = [
    { at: 4500, js: js(`(document.getElementById('enter').click(), true)`) },
    { at: 13000, js: js(`window.__sakasa.state().mode`) },
  ];
  const r = runCapture('splash', 15000, T);
  if (cli(['xr', 'status'], undefined, { allowFail: true }).sessionActive !== true) cli(['xr', 'enter'], {}, { allowFail: true });
  cli(['xr', 'set-input-mode'], { mode: 'hand' });
  save('splash', r, { final: state().mode });
}

if (want('onboarding')) {
  // First launch: fresh storage, the room is scanned, then the three onboarding pinches.
  const s0 = (() => {
    try {
      return state();
    } catch {
      return null;
    }
  })();
  if (!s0 || s0.mode !== 'onboarding' || s0.onboardingStep !== 0 || s0.totalFlips !== 0) await freshSession();
  await waitSettled();
  setHead(TABLE);
  cli(['xr', 'set-transform'], { device: 'hand-right', orientation: { x: 0, y: 0, z: 0, w: 1 } });
  evaluate(HELPERS);
  await sleep(600);
  const T = [
    // look at the HUD + toys, then up to the beacon on the ceiling
    { at: 2600, js: js(`__rec.look('head', [0.1, 2.3, -1.7], 1500)`) },
    { at: 3000, js: js(`__rec.aimSurface('right', 'ceiling', 900)`) },
    { at: 5200, js: js(`__rec.pinchLater('right', 500)`) },
    { at: 7600, js: js(`__rec.look('head', [0.1, 1.0, -1.9], 1600)`) },
    // wall
    { at: 12500, js: js(`(() => { const b = window.__sakasa.state().beacon; __rec.look('head', [b[0] * 0.8, 1.3, b[2] * 0.8 - 0.3], 1500); return b; })()`) },
    { at: 13000, js: js(`(() => { const b = window.__sakasa.state().beacon; __rec.look('right', b, 900); return b; })()`) },
    { at: 15400, js: js(`__rec.pinchLater('right', 450)`) },
    // floor
    { at: 22500, js: js(`__rec.look('head', [0.1, 0.7, -1.9], 1500)`) },
    { at: 23000, js: js(`__rec.aimSurface('right', 'floor', 900)`) },
    { at: 25200, js: js(`__rec.pinchLater('right', 450)`) },
    { at: 28500, js: js(`__rec.turn('right', [0, 0, 0, 1], 900)`) },
    { at: 31500, js: js(`__rec.state()`) },
  ];
  const r = runCapture('onboarding', 33000, T);
  save('onboarding', r, { final: state().onboardingStep });
}

if (want('puzzles')) {
  // Continue from the end of onboarding: Play -> puzzle 1 -> Next -> puzzle 2 with undo and reset.
  let s = state();
  if (s.mode !== 'onboarding' || s.onboardingStep < 3) {
    await freshSession();
    await waitSettled();
    evaluate(`(window.__sakasa.debug.flip(3), true)`);
  }
  setHead([0.1, 0.8, -1.9]);
  evaluate(HELPERS);
  await sleep(500);
  const p1 = evaluate(`(() => { return window.__sakasa.state().room.surfaces.map((x) => x.id); })()`);
  const T = [
    { at: 1500, js: js(`__rec.aimObj('right', 'btn-a', 800)`) },
    { at: 2800, js: js(`__rec.pinchLater('right', 200)`) },
    // puzzle 1 shows its goal; solve with its single flip (read from the live puzzle)
    { at: 5000, js: js(`(() => { const p = window.__sakasa.state().puzzle; window.__p1 = p; __rec.look('head', p.goal, 1400); return p.solutionNames; })()`) },
    { at: 7600, js: js(`(() => { const n = window.__p1.solutionNames[0]; const id = { '+X': 'wall+x', '-X': 'wall-x', up: 'ceiling', down: 'floor', '+Z': 'wall+z', '-Z': 'wall-z' }[n]; return __rec.aimSurface('right', id, 900); })()`) },
    { at: 9000, js: js(`__rec.pinchLater('right', 500)`) },
    { at: 13500, js: js(`__rec.look('head', [0.1, 0.8, -1.9], 1200)`) },
    { at: 15000, js: js(`__rec.aimObj('right', 'btn-a', 800)`) },
    { at: 16300, js: js(`__rec.pinchLater('right', 200)`) },
    // puzzle 2: a wrong flip first, then Undo, then the real solution
    { at: 19000, js: js(`(() => { const p = window.__sakasa.state().puzzle; window.__p2 = p; __rec.look('head', p.goal, 1400); return p.solutionNames; })()`) },
    { at: 21500, js: js(`(() => { const sol = window.__p2.solutionNames; const ids = { '+X': 'wall+x', '-X': 'wall-x', up: 'ceiling', down: 'floor', '+Z': 'wall+z', '-Z': 'wall-z' }; const wrong = ['ceiling', 'wall+x', 'wall-x'].find((w) => w !== ids[sol[0]]); window.__wrong = wrong; return __rec.aimSurface('right', wrong, 900); })()`) },
    { at: 22900, js: js(`__rec.pinchLater('right', 450)`) },
    { at: 26500, js: js(`__rec.look('head', [0.1, 0.8, -1.9], 1200)`) },
    { at: 28000, js: js(`__rec.aimObj('right', 'btn-a', 800)`) },
    { at: 29300, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 31500, js: js(`(() => { const n = window.__p2.solutionNames[0]; const id = { '+X': 'wall+x', '-X': 'wall-x', up: 'ceiling', down: 'floor', '+Z': 'wall+z', '-Z': 'wall-z' }[n]; __rec.look('head', window.__p2.goal, 1200); return __rec.aimSurface('right', id, 900); })()`) },
    { at: 33500, js: js(`__rec.pinchLater('right', 500)`) },
    { at: 38500, js: js(`__rec.look('head', [0.1, 0.8, -1.9], 1200)`) },
    { at: 40500, js: js(`__rec.state()`) },
  ];
  const r = runCapture('puzzles', 42000, T);
  save('puzzles', r, { surfaces: p1, final: state().puzzle });
}

if (want('set3')) {
  // Puzzle 14 (set 3, uses the ceiling), loaded for the take with the debug hook; solved by hand.
  evaluate('(window.__sakasa.debug.startPuzzle(13), true)');
  await sleep(500);
  await waitSettled();
  const p = state().puzzle;
  setHead(p.start);
  evaluate(HELPERS);
  await sleep(400);
  const ids = { '+X': 'wall+x', '-X': 'wall-x', up: 'ceiling', down: 'floor', '+Z': 'wall+z', '-Z': 'wall-z' };
  const T = [
    { at: 1200, js: js(`__rec.look('head', ${q(p.goal)}, 1500)`) },
    { at: 3600, js: js(`__rec.look('head', ${q(p.start)}, 1200)`) },
  ];
  let t = 5200;
  for (const n of p.solutionNames) {
    const id = ids[n];
    T.push({ at: t, js: js(`(() => { const m = window.__sakasa.state().marble; const a = window.__sakasa.aim(${q(id)}, [0.2, 1.1, -0.3]); __rec.look('head', [m[0] * 0.5 + a[0] * 0.5, 1.2 + (a[1] - 1.2) * 0.6, m[2] * 0.5 + a[2] * 0.5], 1000); return __rec.aimSurface('right', ${q(id)}, 800); })()`) });
    T.push({ at: t + 1400, js: js(`__rec.pinchLater('right', 550)`) });
    t += 5600;
  }
  T.push({ at: t, js: js(`__rec.look('head', ${q(p.goal)}, 1200)`) });
  T.push({ at: t + 400, js: js(`__rec.turn('right', [0, 0, 0, 1], 800)`) });
  T.push({ at: t + 4500, js: js(`__rec.state()`) });
  const r = runCapture('set3', t + 6000, T);
  save('set3', r, { puzzle: p.id, solution: p.solutionNames, final: state().puzzle });
}

if (want('sandbox')) {
  // Palm-up wrist menu -> Sandbox; flip walls, grab a toy and throw it, flip mid-flight.
  const palmUp = cliHandPose('hand-left', { x: -0.15, y: 1.15, z: -0.35 }, { fingers: [0.3, 0.1, -1], palm: 'up' });
  const palmDown = cliHandPose('hand-left', { x: -0.25, y: 1.0, z: -0.3 }, { fingers: [0, 0, -1], palm: 'down' });
  setHead([0.1, 0.8, -1.9]);
  evaluate(HELPERS);
  await sleep(400);
  const T = [
    { at: 1200, js: js(`__rec.look('head', [-0.15, 1.05, -0.6], 1000)`) },
    { at: 1400, js: js(`__rec.pose('left', ${q(palmUp.p)}, ${q(palmUp.q)})`) },
    { at: 3200, js: js(`__rec.aimObj('right', 'm-sandbox', 700)`) },
    { at: 4300, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 5200, js: js(`__rec.pose('left', ${q(palmDown.p)}, ${q(palmDown.q)})`) },
    { at: 5400, js: js(`__rec.look('head', [0.1, 0.8, -1.9], 1100)`) },
    // flip toward the +X wall, then the ceiling
    { at: 7200, js: js(`__rec.look('head', [2.2, 1.4, -1.6], 1300)`) },
    { at: 7500, js: js(`__rec.aimSurface('right', 'wall+x', 800)`) },
    { at: 9100, js: js(`__rec.pinchLater('right', 450)`) },
    { at: 14000, js: js(`__rec.look('head', [0.6, 2.2, -1.6], 1300)`) },
    { at: 14300, js: js(`__rec.aimSurface('right', 'ceiling', 800)`) },
    { at: 15900, js: js(`__rec.pinchLater('right', 450)`) },
    { at: 20500, js: js(`__rec.look('head', [0.1, 0.9, -1.9], 1300)`) },
    { at: 20700, js: js(`__rec.aimSurface('right', 'floor', 800)`) },
    { at: 22200, js: js(`__rec.pinchLater('right', 450)`) },
    // grab a paper ball and throw it
    { at: 26500, js: js(`__rec.aimBody('right', 'toy-2-ball', 700)`) },
    { at: 27600, js: js(`__rec.setPinch('right', 1)`) },
    { at: 28200, js: js(`__rec.look('right', [0.2, 1.6, -1.2], 500)`) },
    { at: 29000, js: js(`__rec.look('right', [-1.0, 2.0, -2.2], 220)`) },
    { at: 29150, js: js(`__rec.setPinch('right', 0)`) },
    { at: 29600, js: js(`__rec.aimSurface('right', 'wall-x', 500)`) },
    { at: 30300, js: js(`__rec.pinchLater('right', 300)`) },
    { at: 34500, js: js(`__rec.state()`) },
  ];
  const r = runCapture('sandbox', 36000, T);
  save('sandbox', r, { final: state().mode });
}

if (want('options')) {
  // HUD menu button -> the options: gentle gravity, tilt cue, sound; then the daily puzzle.
  setHead([0.1, 0.8, -1.9]);
  evaluate(HELPERS);
  await sleep(400);
  const T = [
    { at: 1000, js: js(`__rec.aimObj('right', 'btn-menu', 700)`) },
    { at: 2000, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 3500, js: js(`__rec.look('head', [0.0, 1.1, -1.4], 900)`) },
    { at: 4800, js: js(`__rec.aimObj('right', 'm-gentle', 600)`) },
    { at: 5700, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 7000, js: js(`__rec.aimObj('right', 'm-tilt', 600)`) },
    { at: 7900, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 9200, js: js(`__rec.aimObj('right', 'm-sound', 600)`) },
    { at: 10100, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 11300, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 12600, js: js(`__rec.aimObj('right', 'm-tilt', 600)`) },
    { at: 13500, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 14800, js: js(`__rec.aimObj('right', 'm-gentle', 600)`) },
    { at: 15700, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 17000, js: js(`__rec.aimObj('right', 'm-daily', 600)`) },
    { at: 18000, js: js(`__rec.pinchLater('right', 200)`) },
    { at: 19800, js: js(`(() => { const p = window.__sakasa.state().puzzle; __rec.look('head', p.goal, 1400); return p && p.id; })()`) },
    { at: 23500, js: js(`__rec.state()`) },
  ];
  const r = runCapture('options', 25000, T);
  save('options', r, { final: state().settings });
}

if (want('glasses')) {
  const cfgPath = join(APP, 'iwsdk.config.json');
  const original = readFileSync(cfgPath, 'utf8');
  try {
    const cfg = JSON.parse(original);
    cfg.dev.emulator.device = 'metaVRGlasses';
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    await sleep(8000);
    await freshSession();
    await waitSettled();
    setHead([0, 1.2, -2]);
    evaluate(HELPERS);
    const head = devicePose('headset').p;
    evaluate(`(__rec.look('gaze', [0.1, 1.0, -1.95], 10), true)`);
    await sleep(400);
    const T = [
      { at: 1800, js: js(`__rec.look('head', [0, 2.3, -1.4], 1200)`) },
      { at: 2100, js: js(`__rec.look('gaze', ${q([head[0], 2.7, head[2] - 1.1])}, 600)`) },
      { at: 3900, js: js(`__rec.pinchLater('right', 300)`) },
      { at: 8500, js: js(`__rec.look('head', [-2.4, 1.3, -1.2], 1300)`) },
      { at: 8800, js: js(`__rec.aimSurface('gaze', 'wall-x', 600)`) },
      { at: 10400, js: js(`__rec.pinchLater('right', 300)`) },
      { at: 15500, js: js(`__rec.look('head', [0, 1.2, -2], 1300)`) },
      { at: 15800, js: js(`__rec.look('gaze', [0.1, 1.0, -1.95], 600)`) },
      { at: 19500, js: js(`__rec.state()`) },
    ];
    const r = runCapture('glasses', 21000, T);
    save('glasses', r, {});
  } finally {
    writeFileSync(cfgPath, original);
  }
}
