// The flip, made big (Nov 15): checks the first-session beacon, the slow-motion ramp, the ghost-room tilt
// cue, the gravity rain, the slow-motion dial, the bigger marble/toys and the readable HUD, all driven by
// real hand pinches in the Meta Quest 3 profile. An in-page sampler records what is visible every 30 ms
// after each pinch, because a CLI round trip is slower than the effects themselves.
import { cli, clickTarget, consoleErrors, evaluate, freshSession, pinchSurface, report, sleep, state, waitSettled } from './lib.mjs';

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` - ${detail}` : ''}`);
}

const SAMPLER = `(() => {
  const S = window.__sakasa;
  const out = [];
  const t0 = performance.now();
  const id = setInterval(() => {
    const r = S.renderables();
    const s = S.state();
    out.push({ t: Math.round(performance.now() - t0), ts: s.timeScale, ghost: !!r['ghost-room'], rain: !!r['gravity-rain'], dial: !!r['slowmo-readout'], vignette: !!r['slowmo-readout'] });
    if (performance.now() - t0 > 6500) clearInterval(id);
  }, 30);
  window.__fxSamples = out;
  return true;
})()`;

function summarise(raw) {
  // times relative to the flip (the first sample in slow motion)
  const f = raw.find((x) => x.ts < 0.999)?.t ?? 0;
  const samples = raw.filter((x) => x.t >= f - 60).map((x) => ({ ...x, t: x.t - f }));
  const slow = samples.filter((x) => x.ts < 0.5);
  const first = (k) => samples.find((x) => x[k]);
  const last = (k) => [...samples].reverse().find((x) => x[k]);
  return {
    minTs: Math.min(...samples.map((x) => x.ts)),
    slowMs: slow.length > 1 ? slow[slow.length - 1].t - slow[0].t : 0,
    ghost: [first('ghost')?.t ?? null, last('ghost')?.t ?? null],
    rain: [first('rain')?.t ?? null, last('rain')?.t ?? null],
    dial: [first('dial')?.t ?? null, last('dial')?.t ?? null],
    vignette: !!first('vignette'),
    endTs: samples[samples.length - 1]?.ts,
    n: samples.length,
  };
}

const s0 = await freshSession();
await waitSettled();
const room = s0.room;
const ceilingY = room.surfaces.find((x) => x.id === 'ceiling').center[1];
let s = state();
check('beacon marks the ceiling on step 1', s.beacon && Math.abs(s.beacon[1] - ceilingY) < 0.05, `beacon ${s.beacon?.join(', ')}`);
const bodies = evaluate('window.__sakasa.bodies()');
check('12 bodies in the toy pile', bodies.length === 12, bodies.map((b) => b.name).join(' '));
const sizes = evaluate(`(() => { const out = {}; for (const n of ['marble', 'toy-0-cube']) { const b = window.__sakasa.geometryBounds(n); if (b && b[0]) out[n] = +(b[0].box[3] - b[0].box[0]).toFixed(3); } return out; })()`);
check('marble is 15 cm across', Math.abs((sizes.marble ?? 0) - 0.15) < 0.005, `${sizes.marble} m`);
check('paper cube is 18 cm', Math.abs((sizes['toy-0-cube'] ?? 0) - 0.18) < 0.005, `${sizes['toy-0-cube']} m`);
const hud = evaluate(`(() => { const b = window.__sakasa.geometryBounds('Sakasa HUD'); if (!b) return null; let w = 0; for (const g of b) if (g.box) w = Math.max(w, Math.hypot(g.box[3] - g.box[0], g.box[5] - g.box[2])); return +w.toFixed(3); })()`);
check('HUD is at least 0.64 m wide (18 mm body cap height at 1 m)', hud >= 0.64, `${hud} m`);

evaluate(SAMPLER);
await pinchSurface('ceiling');
await sleep(6800);
let fx = summarise(evaluate('window.__fxSamples'));
check('ceiling pinch: slow motion holds below 0.5x for at least 0.6 s', fx.minTs <= 0.16 && fx.slowMs >= 600, `min ${fx.minTs}, ${fx.slowMs} ms`);
check('ceiling pinch: time returns to 1x', fx.endTs === 1, `end ${fx.endTs}`);
check('ceiling pinch: ghost-room tilt cue shows, then clears', fx.ghost[0] !== null && fx.ghost[1] < 2400, `visible ${fx.ghost.join('-')} ms`);
check('ceiling pinch: gravity rain and slow-motion dial + edge glow show', fx.rain[0] !== null && fx.dial[0] !== null && fx.vignette, `rain ${fx.rain.join('-')} ms, dial ${fx.dial.join('-')} ms`);
s = state();
check('beacon moves to a wall on step 2', s.onboardingStep === 1 && s.beacon && Math.abs(s.beacon[1] - ceilingY) > 0.3, `beacon ${s.beacon?.join(', ')}`);

// Tilt cue off (comfort option) through the menu; the rain and slow motion stay.
await clickTarget('btn-menu');
await clickTarget('m-tilt');
s = state();
check('menu Tilt cue toggles off', s.settings.tilt === false);
await clickTarget('m-resume');
await waitSettled();
evaluate(SAMPLER);
await pinchSurface('floor');
await sleep(6800);
fx = summarise(evaluate('window.__fxSamples'));
check('with Tilt cue off the ghost room never shows, rain still does', fx.ghost[0] === null && fx.rain[0] !== null, `ghost ${fx.ghost.join('-')}, rain ${fx.rain.join('-')}`);
await clickTarget('btn-menu');
await clickTarget('m-tilt');
check('menu Tilt cue toggles back on', state().settings.tilt === true);
await clickTarget('m-resume');

const errors = consoleErrors();
check('zero console errors', errors.length === 0, errors.slice(0, 3).join(' | '));
cli(['xr', 'exit'], {}, { allowFail: true });
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} checks pass`);
report('flip-fx', { passed, total: results.length, results });
