// Meta VR Glasses profile (IWER metaVRGlasses: gaze + hands, narrow FoV).
// Gaze picks the surface or button, a hand pinch commits (after the 400 ms
// dwell). Checks the HUD fits the glasses' field of view, the gaze fallback to
// hand rays, and completes onboarding, a puzzle, the menu, and exit.
// Run with dev.emulator.device = "metaVRGlasses" (the script switches it and restores it).
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  APP, DIR_SURFACE, actions, cli, clickTarget, consoleErrors, deviceState, freshSession,
  pinchSurface, report, screenshot, sleep, state, waitFor, waitSettled,
} from './lib.mjs';

const cfgPath = join(APP, 'iwsdk.config.json');
const original = readFileSync(cfgPath, 'utf8');
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
};
const G = { aimDevice: 'gaze', device: 'hand-right' };

// Angles of a world point in the head frame (identity-ish head pose looking down -Z).
function viewAngles(p, head, q) {
  // rotate (p - head) by the inverse head quaternion
  const v = [p.x - head.x, p.y - head.y, p.z - head.z];
  const [x, y, z, w] = [-q.x, -q.y, -q.z, q.w];
  const t = [2 * (y * v[2] - z * v[1]), 2 * (z * v[0] - x * v[2]), 2 * (x * v[1] - y * v[0])];
  const r = [v[0] + w * t[0] + (y * t[2] - z * t[1]), v[1] + w * t[1] + (z * t[0] - x * t[2]), v[2] + w * t[2] + (x * t[1] - y * t[0])];
  return { h: (Math.atan2(r[0], -r[2]) * 180) / Math.PI, v: (Math.atan2(r[1], -r[2]) * 180) / Math.PI };
}

let summary;
try {
  const cfg = JSON.parse(original);
  cfg.dev.emulator.device = 'metaVRGlasses';
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
  await sleep(7000);
  const s0 = await freshSession();
  const st = cli(['xr', 'status']);
  check('glasses profile with gaze granted', st.deviceName === 'Meta VR Glasses' && st.enabledFeatures.includes('gaze-tracking'), `${st.deviceName}; ${st.enabledFeatures.join(',')}`);
  await sleep(500);
  check('Glasses mode turns on automatically from the gaze source', state().glassesActive && state().gazeDetected);
  screenshot('glasses-00-onboarding');

  // FoV: the HUD and its buttons must sit inside 37 deg left/right, 25 up, 43 down (with 3 deg margin).
  const d = deviceState();
  const head = d.headset.position;
  const q = d.headset.orientation;
  const targets = cli(['xr', 'list-targets']).targets;
  const hud = targets.find((t) => t.name === 'hud-root');
  const corners = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) corners.push({ x: hud.position.x + (sx * hud.size.x) / 2, y: hud.position.y + (sy * hud.size.y) / 2, z: hud.position.z });
  const angles = corners.map((c) => viewAngles(c, head, q));
  const fits = angles.every((a) => Math.abs(a.h) <= 34 && a.v <= 22 && a.v >= -40);
  check('HUD corners inside the glasses FoV (3 deg margin)', fits, angles.map((a) => `(${a.h.toFixed(1)}, ${a.v.toFixed(1)})`).join(' '));

  // Onboarding by gaze + pinch.
  await pinchSurface('ceiling', G);
  check('gaze at ceiling + pinch flips up', state().gravity === 'up' && state().onboardingStep === 1, `hovered ${actions.log.at(-1).hovered}`);
  cli(['xr', 'look-at'], { device: 'gaze', target: { x: 0, y: 1.4, z: -2 } });
  await sleep(1200);
  screenshot('glasses-01-ceiling');
  await waitSettled();
  await pinchSurface('wall-x', G);
  check('gaze at a wall + pinch flips sideways', state().gravity === '-X' && state().onboardingStep === 2);
  await waitSettled();
  await pinchSurface('floor', G);
  check('gaze at floor + pinch brings it home', state().gravity === 'down' && state().onboardingStep === 3);
  await waitSettled();

  // Play and solve puzzle 1 by gaze.
  cli(['xr', 'look-at'], { device: 'gaze', target: { x: 0, y: 1.4, z: -2 } });
  await sleep(300);
  await clickTarget('btn-a', G);
  const sp = await waitFor(() => (state().mode === 'puzzle' ? state() : null), { label: 'puzzle' });
  check('gaze + pinch on Play starts puzzle 1', sp.puzzle.id === 'p01');
  await waitSettled();
  for (const dir of sp.puzzle.solution) {
    await pinchSurface(DIR_SURFACE[dir], G);
    await waitSettled();
  }
  const won = await waitFor(() => (state().puzzle?.state === 'won' ? state() : null), { timeout: 8000, label: 'won' }).catch(() => state());
  check('puzzle 1 solved with gaze + pinch', won.puzzle.state === 'won', `flips ${won.puzzle.flips} par ${won.puzzle.par}`);
  screenshot('glasses-02-solved');

  // Menu through the HUD button (the glasses path), then Sandbox.
  cli(['xr', 'look-at'], { device: 'gaze', target: { x: 0, y: 1.4, z: -2 } });
  await sleep(300);
  await clickTarget('btn-menu', G);
  check('gaze + pinch on the HUD menu button opens the menu', state().menuOpen);
  const m = cli(['xr', 'list-targets']).targets.find((t) => t.name === 'menu-root');
  if (m) {
    const ma = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) ma.push(viewAngles({ x: m.position.x + (sx * m.size.x) / 2, y: m.position.y + (sy * m.size.y) / 2, z: m.position.z }, deviceState().headset.position, deviceState().headset.orientation));
    check('menu corners inside the glasses FoV', ma.every((a) => Math.abs(a.h) <= 37 && a.v <= 25 && a.v >= -43), ma.map((a) => `(${a.h.toFixed(1)}, ${a.v.toFixed(1)})`).join(' '));
  }
  screenshot('glasses-03-menu');
  await clickTarget('m-sandbox', G);
  check('menu Sandbox by gaze', state().mode === 'sandbox' && !state().menuOpen);

  // Fallback: gaze disconnected -> hand ray selects.
  cli(['xr', 'set-connected'], { device: 'gaze', connected: false });
  await sleep(600);
  await pinchSurface('wall+x');
  check('with gaze disconnected the hand ray still flips', state().gravity === '+X');
  cli(['xr', 'set-connected'], { device: 'gaze', connected: true });
  await sleep(600);
  await waitSettled();

  // Exit.
  cli(['xr', 'look-at'], { device: 'gaze', target: { x: 0, y: 1.4, z: -2 } });
  await sleep(300);
  await clickTarget('btn-menu', G);
  await clickTarget('m-exit', G).catch(() => undefined);
  await sleep(800);
  check('Exit ends the session', cli(['xr', 'status']).sessionActive === false);
  const errors = consoleErrors();
  check('zero console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  const passed = results.filter((r) => r.ok).length;
  summary = { profile: st.deviceName, input: 'gaze + hand pinch (dwell 400 ms)', passed, total: results.length, totalHandActions: actions.count, results, actions: actions.log };
  console.log(`\n${passed}/${results.length} passed`);
} finally {
  writeFileSync(cfgPath, original);
}
report('hands-glasses', summary);
process.exit(summary && summary.passed === summary.total ? 0 : 1);
