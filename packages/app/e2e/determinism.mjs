// Deterministic physics replays: the same flip script, stepped frame by frame
// with a fixed timestep (ecs pause/step), must leave every Havok body in the
// same place on 3 fresh page loads. Bodies start from their exact home
// positions (dropAll) so only the replay decides the outcome.
import { cli, evaluate, freshSession, report, sleep, waitSettled } from './lib.mjs';

const RUNS = 3;
const DT = 1 / 72;
const SCRIPT = [
  { steps: 30 },
  { flip: 2, steps: 140 }, // up
  { flip: 1, steps: 140 }, // -X wall
  { flip: 5, steps: 140 }, // -Z wall
  { flip: 3, steps: 160 }, // down
];

const runs = [];
for (let r = 0; r < RUNS; r++) {
  await freshSession();
  await waitSettled();
  evaluate('(window.__sakasa.debug.sandbox(), true)');
  await sleep(300);
  cli(['ecs', 'pause'], {});
  evaluate('(window.__sakasa.debug.dropAll(), true)');
  cli(['ecs', 'step'], { count: 1, delta: DT });
  for (const s of SCRIPT) {
    if (s.flip !== undefined) evaluate(`(window.__sakasa.debug.flip(${s.flip}), true)`);
    cli(['ecs', 'step'], { count: s.steps, delta: DT });
  }
  const bodies = evaluate('window.__sakasa.bodies()');
  cli(['ecs', 'resume'], {});
  runs.push(bodies);
  console.log(`run ${r + 1}: ${bodies.length} bodies, marble at ${bodies.find((b) => b.name === 'marble')?.p.join(',')}`);
}
const key = (b) => JSON.stringify(b.map((x) => [x.name, x.p]));
const identical = runs.every((b) => key(b) === key(runs[0]));
let maxDiff = 0;
for (const b of runs.slice(1)) {
  b.forEach((x, i) => {
    maxDiff = Math.max(maxDiff, Math.hypot(...x.p.map((v, k) => v - runs[0][i].p[k])));
  });
}
console.log(identical ? `PASS ${RUNS} replays identical` : `FAIL replays differ (max ${maxDiff.toFixed(5)} m)`);
report('determinism', { runs: RUNS, dt: DT, script: SCRIPT, identical, maxDiffMeters: maxDiff, final: runs[0] });
process.exit(identical ? 0 : 1);
