// Runs inside the managed browser (iwsdk browser run): for every shipped puzzle,
// load it, then apply the solver's solution flips to the live Havok simulation
// and check the marble really settles in the goal ring. This proves the
// analytic solver and the rigid-body engine agree in this emulated room.
// Uses the debug flip (no hand input): the hands-only path is covered by
// hands-quest.mjs / hands-glasses.mjs.
export async function runRange(frame, from, to) {
  return await frame.evaluate(async ([from, to]) => {
    const S = window.__sakasa;
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    async function settle(maxMs = 9000) {
      const t0 = performance.now();
      let calm = 0;
      await sleep(300);
      while (performance.now() - t0 < maxMs) {
        const b = S.bodies();
        const v = Math.max(0, ...b.map((x) => Math.hypot(...x.v)));
        calm = v < 0.03 ? calm + 1 : 0;
        if (calm >= 4) return true;
        await sleep(100);
      }
      return false;
    }
    const room = S.state().room;
    const out = [];
    for (let i = from; i < to; i++) {
      S.debug.startPuzzle(i);
      await settle();
      const p0 = S.state().puzzle;
      const start = S.state().marble;
      const startErr = Math.hypot(...start.map((v, k) => v - p0.start[k]));
      for (const d of p0.solution) {
        S.debug.flip(d);
        await settle();
      }
      await sleep(500);
      const s = S.state();
      const err = Math.hypot(...s.marble.map((v, k) => v - s.puzzle.goal[k]));
      out.push({ final: s.marble, goal: s.puzzle.goal, id: p0.id, par: p0.par, solution: p0.solutionNames.join(' '), blocks: p0.blocks, startErr: Math.round(startErr * 1000) / 1000, goalErr: Math.round(err * 1000) / 1000, won: s.puzzle.state === 'won' });
    }
    return { room, results: out };
  }, [from, to]);
}

