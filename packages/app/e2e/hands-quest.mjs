// Hands-only completion in the Meta Quest 3 profile (IWER, hand input mode).
// From a cold page load: onboarding (ceiling, wall, floor), Play, solve puzzle 1
// and 2 by pinching real room surfaces, undo/reset, palm-up wrist menu (pause),
// sandbox with a ray grab, resume, and exit. No controller, no debug hooks.
import {
  DIR_SURFACE, actions, cli, clickTarget, consoleErrors, freshSession, pinchSurface,
  report, screenshot, sleep, state, waitFor, waitSettled,
} from './lib.mjs';

const results = [];
const t0 = Date.now();
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

async function solveCurrent(label) {
  const s = state();
  const sol = s.puzzle.solution;
  for (const d of sol) {
    await pinchSurface(DIR_SURFACE[d]);
    await waitSettled();
  }
  const won = await waitFor(() => (state().puzzle?.state === 'won' ? state() : null), { timeout: 8000, label: `${label} won` }).catch(() => null);
  const after = state();
  check(`${label} solved with ${sol.length} pinches (par ${s.puzzle.par})`, won && after.puzzle.state === 'won', `flips ${after.puzzle.flips}, stars ${after.puzzle.stars}`);
  return after;
}

const s0 = await freshSession();
const device = cli(['xr', 'status']).deviceName;
check('cold load builds the room from planes', s0.room?.kind === 'room' && s0.room.planes > 0, `${device}: ${s0.room?.planes} planes, ${s0.room?.size.join(' x ')} m`);
check('onboarding starts', s0.mode === 'onboarding' && s0.onboardingStep === 0);
screenshot('quest-00-onboarding');

// Onboarding: point at the ceiling and pinch -> everything falls up.
const tStart = Date.now();
await pinchSurface('ceiling');
let s = state();
check('pinch ceiling flips gravity up', s.gravity === 'up' && s.onboardingStep === 1);
await sleep(900);
screenshot('quest-01-ceiling');
const tWhoa = Date.now() - tStart;
await waitSettled();
await pinchSurface('wall-x');
s = state();
check('pinch a wall flips gravity sideways', s.gravity === '-X' && s.onboardingStep === 2);
await sleep(900);
screenshot('quest-02-wall');
await waitSettled();
await pinchSurface('floor');
s = state();
check('pinch floor brings it home', s.gravity === 'down' && s.onboardingStep === 3);
await waitSettled();
const onboardingActions = actions.count;

// Play.
await clickTarget('btn-a');
s = await waitFor(() => (state().mode === 'puzzle' ? state() : null), { label: 'puzzle mode' });
check('Play button starts puzzle 1', s.puzzle?.id === 'p01', `${s.puzzle?.title}, par ${s.puzzle?.par}, solution ${s.puzzle?.solutionNames.join(' ')}`);
await waitSettled();
screenshot('quest-03-puzzle1');
const p1 = await solveCurrent('puzzle 1');
check('puzzle 1 earns 3 stars at par', p1.puzzle.stars === 3);
screenshot('quest-04-solved');

// Next -> puzzle 2; a wrong flip, undo, reset, then solve.
await clickTarget('btn-a');
s = await waitFor(() => (state().puzzle?.id === 'p02' ? state() : null), { label: 'puzzle 2' });
check('Next button loads puzzle 2', !!s);
await waitSettled();
const wrong = [0, 1, 4, 5, 2].find((d) => d !== s.puzzle.solution[0]);
await pinchSurface(DIR_SURFACE[wrong]);
await waitSettled();
check('a flip counts', state().puzzle.flips === 1);
await clickTarget('btn-a'); // Undo
await waitSettled();
s = state();
check('Undo restores the marble and the flip count', s.puzzle.flips === 0, `marble ${s.marble}`);
await clickTarget('btn-b'); // Reset
await waitSettled();
s = state();
check('Reset puts the marble back on its start', Math.hypot(...s.marble.map((v, i) => v - s.puzzle.start[i])) < 0.05);
await solveCurrent('puzzle 2');

// Palm-up wrist menu (left hand) pauses the game.
cli(['xr', 'set-transform'], { device: 'hand-left', position: { x: -0.15, y: 1.15, z: -0.35 }, orientation: { fingers: [0.3, 0.1, -1], palm: 'up' } });
s = await waitFor(() => (state().menuOpen ? state() : null), { timeout: 6000, label: 'palm-up menu' }).catch(() => state());
check('palm-up opens the wrist menu and pauses', s.menuOpen && s.timeScale === 0);
screenshot('quest-05-wrist-menu');
await clickTarget('m-sandbox');
s = await waitFor(() => (state().mode === 'sandbox' ? state() : null), { label: 'sandbox' });
check('menu Sandbox button opens the sandbox', s.mode === 'sandbox' && !s.menuOpen);
cli(['xr', 'set-transform'], { device: 'hand-left', position: { x: -0.25, y: 1.2, z: -0.4 }, orientation: { fingers: [0, 0, -1], palm: 'down' } });
await waitSettled();

// Sandbox: flip sideways, then grab a toy with a ray pinch-hold and release it.
await pinchSurface('wall+x');
await sleep(1500);
screenshot('quest-06-sandbox-wall');
await waitSettled();
await pinchSurface('floor');
await waitSettled();
const toy = cli(['xr', 'list-targets']).targets.find((t) => /^toy-\d+-(cube|ball)/.test(t.name));
cli(['xr', 'look-at'], { device: 'hand-right', target: toy.position });
await sleep(250);
cli(['xr', 'set-select-value'], { device: 'hand-right', value: 1 });
await sleep(400);
const grabbed = cli(['ecs', 'find'], { withComponents: ['Grabbed'] });
const grabCount = (grabbed.entities ?? grabbed).length ?? 0;
cli(['xr', 'animate-to'], { device: 'hand-right', position: { x: 0.35, y: 1.45, z: -0.45 }, duration: 0.4 });
await sleep(600);
cli(['xr', 'set-select-value'], { device: 'hand-right', value: 0 });
actions.count++;
check('pinch-hold on a toy grabs it (DistanceGrabbable)', grabCount > 0, toy.name);
await waitSettled();

// HUD menu button -> Resume; menu -> Exit ends the session.
await clickTarget('btn-menu');
check('HUD menu button opens the menu', state().menuOpen);
await clickTarget('m-resume');
check('Resume closes the menu and unpauses', !state().menuOpen && state().timeScale > 0);
await clickTarget('btn-menu');
await clickTarget('m-exit').catch(() => undefined);
await sleep(800);
const st = cli(['xr', 'status']);
check('Exit ends the XR session', st.sessionActive === false);

const errors = consoleErrors();
check('zero console errors', errors.length === 0, errors.slice(0, 3).join(' | '));

const passed = results.filter((r) => r.ok).length;
const summary = {
  profile: device,
  input: 'hands (IWER hand mode; ray + pinch)',
  passed,
  total: results.length,
  secondsToWhoa: Math.round(tWhoa / 100) / 10,
  handActionsToWhoa: 1,
  onboardingActions,
  totalHandActions: actions.count,
  durationSeconds: Math.round((Date.now() - t0) / 1000),
  results,
  actions: actions.log,
};
console.log(`\n${passed}/${results.length} passed`);
report('hands-quest', summary);
process.exit(passed === results.length ? 0 : 1);
