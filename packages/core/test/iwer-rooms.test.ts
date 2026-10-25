/// <reference types="vite/client" />

import { describe, expect, it } from 'vitest';
import {
  PUZZLES,
  buildRoom,
  dailySpec,
  generatePuzzle,
  solve,
  verifyPuzzle,
  type BuildRoomOptions,
  type PlaneInput,
} from '../src/index.js';

/**
 * Real room inputs captured from the IWER emulator rooms (planes and labelled
 * meshes exactly as IWSDK reported them, saved by e2e/agreement.mjs). The
 * same puzzles were replayed through Havok in those rooms; here the pure
 * model must agree with itself: every puzzle generates and verifies.
 */
const fixtures = import.meta.glob<BuildRoomOptions & { planes: PlaneInput[] }>('./fixtures/iwer-*.json', {
  eager: true,
  import: 'default',
});
const files = Object.entries(fixtures);

describe('IWER room fixtures', () => {
  it('has fixtures for the emulator rooms', () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
  for (const [path, input] of files) {
    const f = path.slice('./fixtures/'.length);
    it(`builds ${f} and every shipped puzzle verifies`, () => {
      const room = buildRoom(input.planes, { head: input.head, forward: input.forward, meshes: input.meshes });
      expect(room.kind).toBe('room');
      for (const spec of [...PUZZLES, dailySpec(new Date('2026-11-18T12:00:00Z'))]) {
        const p = generatePuzzle(room, spec);
        expect(verifyPuzzle(p), `${f} ${spec.id}`).toEqual({ ok: true });
        expect(solve(p.world, p.start, p.goal)?.length).toBe(p.par);
      }
    });
  }
});
