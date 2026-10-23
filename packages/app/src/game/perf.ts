import { type WebGLRenderer, createSystem } from '@iwsdk/core';

/**
 * Frame-time probe for the M1 budget gate: CPU time of the ECS update plus
 * the render submit, and renderer.info draw calls / triangles, per frame.
 * Headless Chromium may use software GL, so this is a relative proxy and is
 * not a measurement of Quest 3 GPU time.
 */
const N = 4096;
const cpu = new Float32Array(N);
const ecs = new Float32Array(N);
const rnd = new Float32Array(N);
const calls = new Float32Array(N);
const tris = new Float32Array(N);
let count = 0;
let frameStart = 0;
let ecsEnd = 0;
let recording = true;

export class PerfStartSystem extends createSystem({}) {
  update(): void {
    frameStart = performance.now();
  }
}

export class PerfEndSystem extends createSystem({}) {
  update(): void {
    ecsEnd = performance.now();
  }
}

export function installRenderProbe(renderer: WebGLRenderer): void {
  const original = renderer.render.bind(renderer);
  renderer.render = (scene, camera) => {
    const t0 = performance.now();
    original(scene, camera);
    const t1 = performance.now();
    if (!recording || frameStart === 0) return;
    const i = count % N;
    ecs[i] = Math.max(0, ecsEnd - frameStart);
    rnd[i] = t1 - t0;
    cpu[i] = ecs[i] + rnd[i];
    calls[i] = renderer.info.render.calls;
    tris[i] = renderer.info.render.triangles;
    count++;
  };
}

function pct(a: Float32Array, n: number, p: number): number {
  const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y);
  if (s.length === 0) return 0;
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))];
}

export const perf = {
  reset(): void {
    count = 0;
    recording = true;
  },
  stop(): void {
    recording = false;
  },
  report() {
    const n = Math.min(count, N);
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return {
      frames: n,
      cpuMs: { p50: r(pct(cpu, n, 50)), p95: r(pct(cpu, n, 95)), max: r(pct(cpu, n, 100)) },
      ecsMs: { p50: r(pct(ecs, n, 50)), p95: r(pct(ecs, n, 95)) },
      renderMs: { p50: r(pct(rnd, n, 50)), p95: r(pct(rnd, n, 95)) },
      drawCalls: { p95: pct(calls, n, 95), max: pct(calls, n, 100) },
      triangles: { p95: pct(tris, n, 95), max: pct(tris, n, 100) },
    };
  },
};
