// Shared helpers for the Sakasa emulator e2e scripts.
// Everything goes through the real IWSDK CLI against the managed IWER browser:
// XR input (hands, gaze, pinch) is emulated by IWER and reaches the app through
// the same pointer events a headset produces. window.__sakasa is read for state.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const APP = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const OUT = resolve(APP, '../../e2e-out');
const BIN = join(APP, 'node_modules/.bin/iwsdk');
mkdirSync(OUT, { recursive: true });
mkdirSync(join(APP, 'e2e/.tmp'), { recursive: true });

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function cli(args, input, { allowFail = false, timeout = 120000 } = {}) {
  const a = [...args];
  if (input !== undefined) a.push('--input-json', JSON.stringify(input));
  let out;
  try {
    out = execFileSync(BIN, a, { cwd: APP, encoding: 'utf8', maxBuffer: 64e6, timeout, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    out = e.stdout?.toString() ?? '';
    if (!out) throw new Error(`iwsdk ${args.join(' ')} failed: ${e.message}`);
  }
  let j;
  try {
    j = JSON.parse(out);
  } catch {
    throw new Error(`iwsdk ${args.join(' ')}: non-JSON output: ${out.slice(0, 300)}`);
  }
  if (!j.ok && !allowFail) throw new Error(`iwsdk ${args.join(' ')}: ${JSON.stringify(j.error).slice(0, 500)}`);
  return j.ok ? (j.data?.result ?? j.data) : j;
}

let evalN = 0;
/** Evaluate a JS expression in the app frame and return its JSON value. */
export function evaluate(expr) {
  const file = join(APP, 'e2e/.tmp', `eval-${process.pid}-${evalN++ % 4}.mjs`);
  writeFileSync(file, `export default async function run({ frame }) { return await frame.evaluate(() => (${expr})); }\n`);
  return cli(['browser', 'run', file]);
}

export const state = () => evaluate('window.__sakasa.state()');
export const bodies = () => evaluate('window.__sakasa.bodies()');

export async function waitFor(fn, { timeout = 15000, interval = 300, label = 'condition' } = {}) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < timeout) {
    last = await fn();
    if (last) return last;
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}`);
}

/** Wait until every body is (nearly) at rest. */
export async function waitSettled(timeout = 25000) {
  await sleep(600);
  return waitFor(
    () => {
      const b = bodies();
      const max = Math.max(0, ...b.map((x) => Math.hypot(...x.v)));
      return max < 0.08 ? { max } : null;
    },
    { timeout, interval: 400, label: 'bodies at rest' },
  );
}

export function deviceState() {
  return cli(['xr', 'get-device-state']);
}

export function handPos(device = 'hand-right') {
  const d = deviceState();
  const h = device === 'hand-left' ? d.hands.left : d.hands.right;
  return [h.position.x, h.position.y, h.position.z];
}

/** Counted hand actions (pinches/selects) for the "actions to payoff" metric. */
export const actions = { count: 0, log: [] };

export async function pinchSurface(surfaceId, { device = 'hand-right', aimDevice } = {}) {
  const from = aimDevice === 'gaze' ? headPos() : handPos(device);
  const p = evaluate(`window.__sakasa.aim(${JSON.stringify(surfaceId)}, ${JSON.stringify(from)})`);
  if (!p) throw new Error(`no clear aim point on ${surfaceId}`);
  cli(['xr', 'look-at'], { device: aimDevice ?? device, target: { x: p[0], y: p[1], z: p[2] } });
  await sleep(aimDevice === 'gaze' ? 600 : 250);
  const hovered = state().hoveredSurface;
  cli(['xr', 'select'], { device });
  actions.count++;
  actions.log.push({ pinch: surfaceId, hovered, aim: aimDevice ?? device });
  await sleep(150);
  return { point: p, hovered };
}

export function headPos() {
  const d = deviceState();
  return [d.headset.position.x, d.headset.position.y, d.headset.position.z];
}

export function target(name) {
  const t = cli(['xr', 'list-targets']).targets.find((x) => x.name === name);
  if (!t) throw new Error(`target ${name} not found`);
  return t.position;
}

/** Point the hand ray (or gaze) at a named UI element and pinch. */
export async function clickTarget(name, { device = 'hand-right', aimDevice } = {}) {
  const p = target(name);
  cli(['xr', 'look-at'], { device: aimDevice ?? device, target: p });
  await sleep(aimDevice === 'gaze' ? 500 : 200);
  cli(['xr', 'select'], { device });
  actions.count++;
  actions.log.push({ click: name, aim: aimDevice ?? device });
  await sleep(250);
}

export function screenshot(name) {
  const file = join(OUT, `${name}.png`);
  cli(['browser', 'screenshot', '--output-file', file], undefined, { allowFail: true });
  return file;
}

export function consoleErrors() {
  const r = cli(['browser', 'logs'], { count: 200 });
  const logs = Array.isArray(r) ? r : r.logs ?? [];
  return logs.filter((l) => l.level === 'error').map((l) => String(l.message ?? l.text).slice(0, 300));
}

export async function freshSession({ inputMode = 'hand', clearStorage = true } = {}) {
  if (clearStorage) {
    try {
      evaluate('(localStorage.clear(), true)');
    } catch {
      // page may not be up yet
    }
  }
  cli(['browser', 'reload'], {}, { allowFail: true });
  await waitFor(() => /"browserCommandReady": true/.test(execFileSync(BIN, ['dev', 'status'], { cwd: APP, encoding: 'utf8' })), {
    timeout: 60000,
    interval: 1500,
    label: 'browser ready',
  });
  await sleep(1500);
  cli(['xr', 'enter'], {}, { allowFail: true });
  await sleep(800);
  cli(['xr', 'set-input-mode'], { mode: inputMode });
  return waitFor(
    () => {
      try {
        const s = state();
        return s.mode !== 'scanning' && s.mode !== 'idle' ? s : null;
      } catch {
        return null;
      }
    },
    { timeout: 30000, interval: 700, label: 'room built' },
  );
}

export const DIR_SURFACE = { 0: 'wall+x', 1: 'wall-x', 2: 'ceiling', 3: 'floor', 4: 'wall+z', 5: 'wall-z' };

export function report(name, data) {
  const file = join(OUT, `${name}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2));
  return file;
}
