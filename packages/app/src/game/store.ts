import { Dir, type Puzzle, type RoomModel, type V3 } from '@sakasa/core';

export type Mode = 'idle' | 'scanning' | 'onboarding' | 'sandbox' | 'puzzle';
export type PuzzleState = 'idle' | 'playing' | 'won';
export type GlassesSetting = 'auto' | 'on' | 'off';

export interface Settings {
  gentle: boolean;
  glasses: GlassesSetting;
  sound: boolean;
}

export interface LogEntry {
  t: number;
  kind: string;
  detail: string;
}

/**
 * Shared game state. Systems own the behaviour; this module only holds the
 * facts they agree on, plus a tiny event bus. Test hooks read it as-is.
 */
export const store = {
  mode: 'idle' as Mode,
  room: null as RoomModel | null,
  /** The exact inputs the room was built from (planes, meshes, head, forward), for replays and fixtures. */
  roomInputs: null as unknown,
  roomSource: 'none' as 'none' | 'planes' | 'tabletop',
  planeCount: 0,
  gravity: Dir.NegY as Dir,
  /** Gravity before the latest flip (for undo). */
  undoGravity: Dir.NegY as Dir,
  totalFlips: 0,
  onboardingStep: 0,
  puzzleIndex: 0,
  isDaily: false,
  puzzle: null as Puzzle | null,
  puzzleState: 'idle' as PuzzleState,
  puzzleFlips: 0,
  lastStars: 0,
  undo: [] as { gravity: Dir; marble: V3 }[],
  settings: { gentle: false, glasses: 'auto', sound: true } as Settings,
  glassesActive: false,
  gazeDetected: false,
  paused: false,
  menuOpen: false,
  timeScale: 1,
  /** Set while the win slow-motion plays. */
  timeOverride: null as number | null,
  hoveredSurface: null as string | null,
  progress: {} as Record<string, number>,
  log: [] as LogEntry[],
};

type Listener = (detail?: unknown) => void;
const listeners = new Map<string, Set<Listener>>();

export function on(event: string, fn: Listener): () => void {
  let set = listeners.get(event);
  if (!set) {
    set = new Set();
    listeners.set(event, set);
  }
  set.add(fn);
  return () => set!.delete(fn);
}

export function emit(event: string, detail?: unknown): void {
  listeners.get(event)?.forEach((fn) => {
    try {
      fn(detail);
    } catch (error) {
      console.error(`[sakasa] listener for "${event}" failed:`, error);
    }
  });
}

export function logEvent(kind: string, detail: string): void {
  store.log.push({ t: Math.round(performance.now()), kind, detail });
  if (store.log.length > 200) store.log.shift();
}

const PROGRESS_KEY = 'sakasa.progress.v1';
const SETTINGS_KEY = 'sakasa.settings.v1';

export function loadPersisted(): void {
  try {
    const p = localStorage.getItem(PROGRESS_KEY);
    if (p) store.progress = JSON.parse(p) as Record<string, number>;
    const s = localStorage.getItem(SETTINGS_KEY);
    if (s) Object.assign(store.settings, JSON.parse(s) as Partial<Settings>);
  } catch {
    // Storage can be unavailable (private mode, blocked site data): play on without it.
  }
}

export function saveProgress(): void {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(store.progress));
  } catch {
    // ignore: progress is a convenience
  }
}

export function saveSettings(): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(store.settings));
  } catch {
    // ignore
  }
}

export function firstUnsolved(total: number, ids: string[]): number {
  for (let i = 0; i < total; i++) if (!store.progress[ids[i]]) return i;
  return 0;
}
