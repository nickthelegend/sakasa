import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PUZZLES, buildRoom, dailySpec, generatePuzzle, solve, verifyPuzzle } from '../src/index.js';

/**
 * Real room inputs captured from the IWER emulator rooms (planes and labelled
 * meshes exactly as IWSDK reported them, saved by e2e/agreement.mjs). The
 * same puzzles were replayed through Havok in those rooms; here the pure
 * model must agree with itself: every puzzle generates and verifies.
 */
const dir = join(__dirname, 'fixtures');
const files = readdirSync(dir).filter((f) => f.startsWith('iwer-') && f.endsWith('.json'));

describe('IWER room fixtures', () => {
  it('has fixtures for the emulator rooms', () => {
    expect(files.length).toBeGreaterThanOrEqual(1);
  });
  for (const f of files) {
    it(`builds ${f} and every shipped puzzle verifies`, () => {
      const input = JSON.parse(readFileSync(join(dir, f), 'utf8'));
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
