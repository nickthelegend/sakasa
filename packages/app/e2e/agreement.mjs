// Solver vs Havok agreement in IWER rooms the code never special-cases.
// Usage: node e2e/agreement.mjs room1 room2 ...  (default: all 8 IWER rooms)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { APP, cli, evaluate, freshSession, report, screenshot, sleep } from './lib.mjs';

const ROOMS = process.argv.slice(2).length > 0 ? process.argv.slice(2) : [
  'sunlit_living_room', 'home_office', 'conference_room', 'open_office', 'kitchen', 'bedroom', 'music_studio', 'open_studio',
];
const cfgPath = join(APP, 'iwsdk.config.json');
const original = readFileSync(cfgPath, 'utf8');
const all = [];
try {
  for (const env of ROOMS) {
    const cfg = JSON.parse(original);
    cfg.dev.emulator.environment = env;
    writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    await sleep(8000);
    let s;
    try {
      s = await freshSession();
    } catch (error) {
      console.log(`${env}: SESSION FAILED ${error.message.slice(0, 200)}`);
      all.push({ env, error: error.message.slice(0, 300), won: 0, total: 0, results: [] });
      continue;
    }
    // Save the exact room inputs as a core test fixture (planes and meshes IWER reported).
    const inputs = evaluate('window.__sakasa.roomInputs()');
    writeFileSync(join(APP, '../core/test/fixtures', `iwer-${env}.json`), JSON.stringify(inputs, null, 1) + '\n');
    const r = { room: null, results: [] };
    for (let from = -1; from < 20; from += 4) {
      const file = join(APP, 'e2e/.tmp', `agree-${from}.mjs`);
      writeFileSync(file, `import { runRange } from '../agreement-page.mjs';\nexport default ({ frame }) => runRange(frame, ${from}, ${Math.min(20, from + 4)});\n`);
      const part = cli(['browser', 'run', file, '--timeout', '105000'], undefined, { timeout: 120000 });
      r.room = part.room;
      r.results.push(...part.results);
    }
    const won = r.results.filter((x) => x.won).length;
    console.log(`${env}: ${s.room.kind} ${s.room.size.join('x')} m, ${s.room.planes} planes, notes: ${s.room.notes.join(' ') || '-'} -> ${won}/${r.results.length} won`);
    for (const x of r.results.filter((y) => !y.won)) console.log(`   miss ${x.id} par ${x.par} [${x.solution}] goalErr ${x.goalErr} startErr ${x.startErr} final ${x.final} goal ${x.goal}`);
    screenshot(`agreement-${env}`);
    all.push({ env, room: r.room, won, total: r.results.length, results: r.results });
    report('solver-havok-agreement-partial', all);
  }
} finally {
  writeFileSync(cfgPath, original);
}
const won = all.reduce((a, r) => a + r.won, 0);
const total = all.reduce((a, r) => a + r.total, 0);
console.log(`\nTOTAL ${won}/${total}`);
report('solver-havok-agreement', { won, total, rooms: all });
