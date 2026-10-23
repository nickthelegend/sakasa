// M1 frame-time budget gate. 600+ frames of the core loop under scripted hand
// input: 3 gravity flips with 12 bodies moving (pinched with the emulated hand),
// then a puzzle with the marble. Reports CPU ms per frame (ECS update + render
// submit), draw calls and triangles per view.
// Caveat: headless Chromium on a desktop; GPU time is not measured and a Quest 3
// CPU is several times slower. This is a relative proxy, unverified on hardware.
import { cli, evaluate, freshSession, pinchSurface, report, sleep, waitSettled } from './lib.mjs';

const s = await freshSession();
await waitSettled();
evaluate('(window.__sakasa.perf.reset(), true)');
for (const surface of ['ceiling', 'wall-x', 'floor']) {
  await pinchSurface(surface);
  await sleep(2500);
}
await pinchSurface('wall+x');
await sleep(2500);
const status = cli(['xr', 'status']);
const r = evaluate('window.__sakasa.perf.report()');
const budget = { p95Ms: 4.0, drawCalls: 100, triangles: 250000 };
const pass = r.cpuMs.p95 <= budget.p95Ms && r.drawCalls.max <= budget.drawCalls && r.triangles.max <= budget.triangles && r.frames >= 600;
console.log(JSON.stringify(r, null, 1));
console.log(`${pass ? 'PASS' : 'FAIL'} M1: p95 ${r.cpuMs.p95} ms (<= 4.0), draw calls max ${r.drawCalls.max} (<= 100), tris max ${r.triangles.max} (<= 250k), frames ${r.frames} (>= 600)`);
report('perf', { ...r, budget, pass, device: status.deviceName, room: s.room?.size, note: 'headless Chromium (hardware GPU via Metal), stereo off in IWER; relative proxy, unverified on Quest hardware' });
process.exit(pass ? 0 : 1);
