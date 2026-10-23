// Screencast capture for emulator clips, used from inside `iwsdk browser run`
// scripts. Frames come from the Chrome DevTools screencast of the managed IWER
// page (exactly what the emulator renders: passthrough room, emulated hands,
// the app). Input during a clip is driven through the in-page IWER device
// (window.IWER_DEVICE), the same emulated hands the CLI drives.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {{frame: any, cdp: any}} ctx
 * @param {string} dir output directory for JPEG frames + ffconcat list
 * @param {number} durationMs
 * @param {{at: number, js: string}[]} timeline expressions evaluated in the app frame at times (ms)
 */
export async function capture({ frame, cdp }, dir, durationMs, timeline = []) {
  mkdirSync(dir, { recursive: true });
  const frames = [];
  const onFrame = (e) => {
    frames.push({ ts: e.metadata.timestamp, data: e.data });
    cdp.send('Page.screencastFrameAck', { sessionId: e.sessionId }).catch(() => undefined);
  };
  cdp.on('Page.screencastFrame', onFrame);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 88, maxWidth: 1600, maxHeight: 1600, everyNthFrame: 1 });
  const t0 = Date.now();
  const log = [];
  try {
    for (const step of timeline) {
      const wait = step.at - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      try {
        const r = await frame.evaluate(step.js);
        log.push({ at: Date.now() - t0, ok: true, r: typeof r === 'object' ? JSON.stringify(r).slice(0, 200) : r });
      } catch (error) {
        log.push({ at: Date.now() - t0, ok: false, error: String(error).slice(0, 300) });
      }
    }
    const rest = durationMs - (Date.now() - t0);
    if (rest > 0) await sleep(rest);
  } finally {
    await cdp.send('Page.stopScreencast').catch(() => undefined);
    cdp.off?.('Page.screencastFrame', onFrame);
  }
  // Write frames and an ffconcat list with the real inter-frame durations.
  const lines = ['ffconcat version 1.0'];
  frames.forEach((f, i) => {
    const name = `f${String(i).padStart(5, '0')}.jpg`;
    writeFileSync(join(dir, name), Buffer.from(f.data, 'base64'));
    const next = frames[i + 1];
    const dur = next ? Math.max(0.001, next.ts - f.ts) : 1 / 30;
    lines.push(`file ${name}`, `duration ${dur.toFixed(4)}`);
  });
  if (frames.length > 0) lines.push(`file f${String(frames.length - 1).padStart(5, '0')}.jpg`);
  writeFileSync(join(dir, 'frames.ffconcat'), lines.join('\n') + '\n');
  const span = frames.length > 1 ? frames[frames.length - 1].ts - frames[0].ts : 0;
  return { frames: frames.length, seconds: Math.round(span * 10) / 10, fps: span > 0 ? Math.round((frames.length / span) * 10) / 10 : 0, log };
}
