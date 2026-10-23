// Records the emulator test clips (20-40 s each) to grokbot/videos/sakasa/.
// Real-time screencast of the managed IWER page; input is the emulated hands
// and gaze driven through IWER (aim + pinch), exactly as a player would act.
// Only clip setup uses debug hooks (loading a given puzzle), and that is
// stated in the clip caption. Usage: node e2e/record-clips.mjs [whoa|puzzle|glasses]
import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { APP, cli, evaluate, freshSession, handPos, headPos, sleep, state, waitSettled } from './lib.mjs';

const VIDEOS = resolve(APP, '../../../../videos/sakasa');
const which = process.argv.slice(2);
const want = (n) => which.length === 0 || which.includes(n);

const HELPERS = `(() => {
  const D = window.IWER_DEVICE;
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
  const target = (who) => who === 'head' ? D : who === 'gaze' ? D.gaze : D.hands[who];
  window.__rec = {
    turn(who, to, ms) {
      const o = target(who); const q = o.quaternion; const from = [q.x, q.y, q.z, q.w];
      const t0 = performance.now();
      const step = () => {
        const t = Math.min(1, (performance.now() - t0) / ms); const e = t * t * (3 - 2 * t);
        const r = slerp(from, to, e); o.quaternion.set(r[0], r[1], r[2], r[3]);
        if (t < 1) setTimeout(step, 11);
      };
      step(); return true;
    },
    async pinch(hand, holdMs) {
      const h = D.hands[hand];
      for (let i = 0; i <= 8; i++) { h.updatePinchValue(i / 8); await sleep(14); }
      await sleep(holdMs);
      for (let i = 8; i >= 0; i--) { h.updatePinchValue(i / 8); await sleep(14); }
      return window.__sakasa.state().gravity;
    },
    pinchLater(hand, holdMs) { this.pinch(hand, holdMs); return true; },
  };
  return true;
})()`;

/** Head orientation looking from `from` to `to` with no roll (yaw, then pitch). */
function headLook(from, to) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.atan2(dy, Math.hypot(dx, dz));
  const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
  // q = qYaw * qPitch
  return [cy * sp, sy * cp, -sy * sp, cy * cp];
}

/** Orientation that makes `device` look at `target`, measured through the real CLI, then read back. */
function quatFor(device, t) {
  if (device === 'headset') return headLook(headPos(), t);
  cli(['xr', 'look-at'], { device, target: { x: t[0], y: t[1], z: t[2] } });
  const who = device === 'headset' ? 'D' : device === 'gaze' ? 'D.gaze' : `D.hands.${device === 'hand-left' ? 'left' : 'right'}`;
  return evaluate(`(() => { const D = window.IWER_DEVICE; const q = ${who}.quaternion; return [q.x, q.y, q.z, q.w]; })()`);
}

function aimPoint(surface, from) {
  return evaluate(`window.__sakasa.aim(${JSON.stringify(surface)}, ${JSON.stringify(from)})`);
}

function runCapture(name, durationMs, timeline) {
  const dir = join(APP, 'e2e/.tmp', `frames-${name}`);
  rmSync(dir, { recursive: true, force: true });
  const file = join(APP, 'e2e/.tmp', `clip-${name}.mjs`);
  writeFileSync(
    file,
    `import { capture } from '../capture.mjs';\nexport default ({ frame, cdp }) => capture({ frame, cdp }, ${JSON.stringify(dir)}, ${durationMs}, ${JSON.stringify(timeline)});\n`,
  );
  const r = cli(['browser', 'run', file, '--timeout', '105000'], undefined, { timeout: 120000 });
  return { dir, ...r };
}

function encode(name, dir, caption) {
  const out = join(VIDEOS, `${name}.mp4`);
  const png = join(dir, 'caption.png');
  execFileSync('python3', ['-I', join(APP, 'e2e/caption.py'), png, '1280', caption, join(APP, 'public/fonts/B612Mono-Regular.ttf')]);
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.ffconcat'), '-i', png,
    '-filter_complex', '[0:v]fps=30,scale=1280:-2:flags=lanczos[v];[v][1:v]overlay=0:0',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ]);
  rmSync(dir, { recursive: true, force: true });
  return out;
}

const results = [];
if (which[0] === 'encode') {
  console.log(encode(which[1], join(APP, 'e2e/.tmp', `frames-${which[2]}`), which[3]));
  process.exit(0);
}

if (want('whoa')) {
  await freshSession();
  await waitSettled();
  const head = headPos();
  const hand = handPos('hand-right');
  const qHeadTable = quatFor('headset', [0.1, 0.55, -1.95]);
  const qHeadUp = quatFor('headset', [0.1, 2.3, -1.6]);
  const qHeadWall = quatFor('headset', [-2.4, 1.2, -1.6]);
  const qHeadBack = quatFor('headset', [0.1, 0.7, -1.9]);
  const pCeil = aimPoint('ceiling', hand);
  const pWall = [-2.49, 1.9, -1.3];
  const pFloor = aimPoint('floor', hand);
  const qHandRest = [0, 0, 0, 1];
  const qCeil = quatFor('hand-right', pCeil);
  const qWall = quatFor('hand-right', pWall);
  const qFloor = quatFor('hand-right', pFloor);
  cli(['xr', 'set-transform'], { device: 'hand-right', orientation: { x: 0, y: 0, z: 0, w: 1 } });
  cli(['xr', 'set-transform'], { device: 'headset', orientation: { x: qHeadTable[0], y: qHeadTable[1], z: qHeadTable[2], w: qHeadTable[3] } });
  evaluate(HELPERS);
  await sleep(500);
  const T = [
    { at: 2200, js: `__rec.turn('right', ${JSON.stringify(qCeil)}, 700)` },
    { at: 2400, js: `__rec.turn('head', ${JSON.stringify(qHeadUp)}, 1200)` },
    { at: 3300, js: `__rec.pinchLater('right', 500)` },
    { at: 8200, js: `__rec.turn('head', ${JSON.stringify(qHeadWall)}, 1400)` },
    { at: 8600, js: `__rec.turn('right', ${JSON.stringify(qWall)}, 800)` },
    { at: 10200, js: `__rec.pinchLater('right', 450)` },
    { at: 16500, js: `__rec.turn('head', ${JSON.stringify(qHeadBack)}, 1400)` },
    { at: 17000, js: `__rec.turn('right', ${JSON.stringify(qFloor)}, 800)` },
    { at: 18600, js: `__rec.pinchLater('right', 450)` },
    { at: 23500, js: `__rec.turn('right', ${JSON.stringify(qHandRest)}, 800)` },
    { at: 25000, js: `window.__sakasa.state().gravity` },
  ];
  const r = runCapture('whoa', 27000, T);
  const out = encode('sakasa-whoa-ceiling-wall-floor', r.dir, 'Sakasa / IWER emulator, Meta Quest 3 profile, hands only / real-time capture: pinch ceiling, wall, floor');
  results.push({ clip: out, frames: r.frames, seconds: r.seconds, fps: r.fps, log: r.log, head });
  console.log(`whoa: ${out} ${r.frames} frames ${r.seconds}s ${r.fps}fps`);
}

if (want('puzzle')) {
  await freshSession();
  await waitSettled();
  // Pick a set-3 puzzle whose solution uses the ceiling, as this room generates it.
  let chosen = null;
  for (let i = 13; i < 20 && !chosen; i++) {
    evaluate(`(window.__sakasa.debug.startPuzzle(${i}), true)`);
    await sleep(400);
    const p = state().puzzle;
    if (p.solutionNames.includes('up') && p.par >= 3) chosen = { i, p };
  }
  if (!chosen) {
    evaluate('(window.__sakasa.debug.startPuzzle(13), true)');
    chosen = { i: 13, p: state().puzzle };
  }
  await waitSettled();
  const hand = handPos('hand-right');
  const DIRS = { '+X': 'wall+x', '-X': 'wall-x', up: 'ceiling', down: 'floor', '+Z': 'wall+z', '-Z': 'wall-z' };
  const steps = [];
  for (const name of chosen.p.solutionNames) {
    const s = DIRS[name];
    const p = s === 'ceiling' ? aimPoint(s, hand) : s === 'floor' ? aimPoint(s, hand) : aimPoint(s, hand);
    steps.push({ hand: quatFor('hand-right', p), head: quatFor('headset', [p[0] * 0.6, 1.2 + (p[1] - 1.2) * 0.5, p[2] * 0.6]) });
  }
  const goal = chosen.p.goal;
  const qHeadGoal = quatFor('headset', goal);
  const qHeadStart = quatFor('headset', chosen.p.start);
  cli(['xr', 'set-transform'], { device: 'hand-right', orientation: { x: 0, y: 0, z: 0, w: 1 } });
  cli(['xr', 'set-transform'], { device: 'headset', orientation: { x: qHeadStart[0], y: qHeadStart[1], z: qHeadStart[2], w: qHeadStart[3] } });
  evaluate(HELPERS);
  await sleep(400);
  const T = [{ at: 1500, js: `__rec.turn('head', ${JSON.stringify(qHeadGoal)}, 1500)` }, { at: 3800, js: `__rec.turn('head', ${JSON.stringify(qHeadStart)}, 1200)` }];
  let t = 5600;
  for (const s of steps) {
    T.push({ at: t, js: `__rec.turn('head', ${JSON.stringify(s.head)}, 900)` });
    T.push({ at: t + 200, js: `__rec.turn('right', ${JSON.stringify(s.hand)}, 700)` });
    T.push({ at: t + 1300, js: `__rec.pinchLater('right', 650)` });
    t += 5200;
  }
  T.push({ at: t, js: `__rec.turn('head', ${JSON.stringify(qHeadGoal)}, 1200)` });
  T.push({ at: t + 400, js: `__rec.turn('right', [0,0,0,1], 800)` });
  T.push({ at: t + 4500, js: `window.__sakasa.state().puzzle` });
  const dur = Math.min(100000, t + 6000);
  const r = runCapture('puzzle', dur, T);
  const final = state().puzzle;
  const out = encode(`sakasa-puzzle-${chosen.p.id}`, r.dir, `Sakasa / IWER emulator, Quest 3 profile / puzzle ${chosen.i + 1} loaded for the clip, then solved by hand: ${chosen.p.solutionNames.join(' ')}`);
  results.push({ clip: out, puzzle: chosen.p.id, solution: chosen.p.solutionNames, final, frames: r.frames, seconds: r.seconds, fps: r.fps, log: r.log });
  console.log(`puzzle: ${out} ${final?.state} flips ${final?.flips} ${r.frames} frames ${r.seconds}s ${r.fps}fps`);
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
    const head = headPos();
    const qGazeFwd = quatFor('gaze', [0.1, 1.0, -1.95]);
    const qGazeCeil = quatFor('gaze', [head[0], 2.7, head[2] - 1.1]);
    const pWall = aimPoint('wall-x', head);
    const qGazeWall = quatFor('gaze', pWall);
    const qHeadUp = quatFor('headset', [0, 2.3, -1.4]);
    const qHeadFwd = quatFor('headset', [0, 1.2, -2]);
    const qHeadLeft = quatFor('headset', [-2.4, 1.3, -1.2]);
    cli(['xr', 'set-transform'], { device: 'headset', orientation: { x: qHeadFwd[0], y: qHeadFwd[1], z: qHeadFwd[2], w: qHeadFwd[3] } });
    evaluate(HELPERS);
    evaluate(`(window.IWER_DEVICE.gaze.quaternion.set(...${JSON.stringify(qGazeFwd)}), true)`);
    await sleep(400);
    const T = [
      { at: 2000, js: `__rec.turn('head', ${JSON.stringify(qHeadUp)}, 1200)` },
      { at: 2300, js: `__rec.turn('gaze', ${JSON.stringify(qGazeCeil)}, 600)` },
      { at: 3900, js: `__rec.pinchLater('right', 300)` },
      { at: 8500, js: `__rec.turn('head', ${JSON.stringify(qHeadLeft)}, 1300)` },
      { at: 8800, js: `__rec.turn('gaze', ${JSON.stringify(qGazeWall)}, 600)` },
      { at: 10400, js: `__rec.pinchLater('right', 300)` },
      { at: 16000, js: `__rec.turn('head', ${JSON.stringify(qHeadFwd)}, 1300)` },
      { at: 16300, js: `__rec.turn('gaze', ${JSON.stringify(qGazeFwd)}, 600)` },
      { at: 20500, js: `window.__sakasa.state().gravity` },
    ];
    const r = runCapture('glasses', 22000, T);
    const out = encode('sakasa-glasses-gaze-pinch', r.dir, 'Sakasa / IWER emulator, Meta VR Glasses profile (FoV mask) / gaze picks the surface, a pinch flips it');
    results.push({ clip: out, frames: r.frames, seconds: r.seconds, fps: r.fps, log: r.log });
    console.log(`glasses: ${out} ${r.frames} frames ${r.seconds}s ${r.fps}fps`);
  } finally {
    writeFileSync(cfgPath, original);
  }
}

writeFileSync(join(APP, '../../e2e-out/clips.json'), JSON.stringify(results, null, 2));
