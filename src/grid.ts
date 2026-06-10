// The step-grid model and its conversion to/from Live notes. Pure — no SDK.
//
// A grid is 16 sixteenth-note steps over one 4/4 bar, with one 0/1 row per
// instrument code, plus optional 16-cell `accents` (louder hits) and `ratchets`
// (a step subdivided into a fast roll / beat-repeat). `gridToNotes` flattens it
// to the Note[] the host writes into a clip; `notesToGrid` is the inverse used
// for round-trip editing and tests.

import {
  MAPPINGS,
  ROW_ORDER,
  type InstrumentCode,
  type MappingId,
} from "./mapping.js";

export const STEPS_PER_BAR = 16;
export const BEATS_PER_BAR = 4;
export const STEP_BEATS = BEATS_PER_BAR / STEPS_PER_BAR; // 0.25 (a 16th note)

export const DEFAULT_VELOCITY = 90;
export const DEFAULT_ACCENT_VELOCITY = 110;

/** Structurally compatible with the SDK's NoteDescription. */
export interface Note {
  pitch: number;
  startTime: number; // beats from clip start
  duration: number; // beats
  velocity: number; // 1..127
}

/** One pattern's grid: rows keyed by instrument code, each exactly 16 cells. */
export interface StepGrid {
  rows: Partial<Record<InstrumentCode, number[]>>;
  accents?: number[];
  ratchets?: number[];
}

export interface RenderOptions {
  mapping?: MappingId;
  baseVelocity?: number;
  accentVelocity?: number;
  /** 0 = straight, 1 = maximum 16th swing (delays the off-16ths). */
  swing?: number;
  /** Note length in beats; defaults to one step (0.25). */
  gate?: number;
  /** Hits a ratcheted step is subdivided into. */
  ratchetHits?: number;
  /** Beat offset added to every note (for chaining bars). */
  startBeat?: number;
}

const isHit = (cell: number | undefined): boolean => cell === 1;

/** Delay applied to a step's onset for a given swing amount (beats). */
function swingOffset(stepIndex: number, swing: number): number {
  // Off-16ths are the odd indices (the "e" and "a"); push them late.
  if (swing <= 0 || stepIndex % 2 === 0) return 0;
  return swing * STEP_BEATS * 0.5;
}

/** Make an empty grid for the given codes (all rests). */
export function emptyGrid(codes: InstrumentCode[]): StepGrid {
  const rows: Partial<Record<InstrumentCode, number[]>> = {};
  for (const c of codes) rows[c] = new Array(STEPS_PER_BAR).fill(0);
  return { rows };
}

/** Instrument codes present in a grid, in canonical render order. */
export function gridCodes(grid: StepGrid): InstrumentCode[] {
  return ROW_ORDER.filter((c) => grid.rows[c] !== undefined);
}

/** Total hits per step across all instruments (drives a density sparkline). */
export function stepDensity(grid: StepGrid): number[] {
  const out = new Array(STEPS_PER_BAR).fill(0);
  for (const code of gridCodes(grid)) {
    const row = grid.rows[code]!;
    for (let s = 0; s < STEPS_PER_BAR; s++) if (isHit(row[s])) out[s] += 1;
  }
  return out;
}

/** Immutable single-cell toggle. */
export function toggleCell(grid: StepGrid, code: InstrumentCode, step: number): StepGrid {
  const existing = grid.rows[code] ?? new Array(STEPS_PER_BAR).fill(0);
  const row = existing.slice();
  row[step] = isHit(row[step]) ? 0 : 1;
  return { ...grid, rows: { ...grid.rows, [code]: row } };
}

/** Immutable accent toggle for a step. */
export function toggleAccent(grid: StepGrid, step: number): StepGrid {
  const accents = (grid.accents ?? new Array(STEPS_PER_BAR).fill(0)).slice();
  accents[step] = isHit(accents[step]) ? 0 : 1;
  return { ...grid, accents };
}

/** Flatten a one-bar grid to notes for the host to write. */
export function gridToNotes(grid: StepGrid, opts: RenderOptions = {}): Note[] {
  const mapping = MAPPINGS[opts.mapping ?? "po"].pitches;
  const base = opts.baseVelocity ?? DEFAULT_VELOCITY;
  const accentVel = opts.accentVelocity ?? DEFAULT_ACCENT_VELOCITY;
  const gate = opts.gate ?? STEP_BEATS;
  const ratchetHits = Math.max(1, opts.ratchetHits ?? 2);
  const startBeat = opts.startBeat ?? 0;
  const swing = opts.swing ?? 0;

  const notes: Note[] = [];
  for (const code of gridCodes(grid)) {
    const pitch = (mapping as Record<string, number>)[code];
    if (pitch === undefined) continue; // instrument not on this kit
    const row = grid.rows[code]!;
    for (let s = 0; s < STEPS_PER_BAR; s++) {
      if (!isHit(row[s])) continue;
      const onset = startBeat + s * STEP_BEATS + swingOffset(s, swing);
      const velocity = isHit(grid.accents?.[s]) ? accentVel : base;
      if (isHit(grid.ratchets?.[s]) && ratchetHits > 1) {
        const sub = STEP_BEATS / ratchetHits;
        for (let r = 0; r < ratchetHits; r++) {
          notes.push({ pitch, startTime: onset + r * sub, duration: sub, velocity });
        }
      } else {
        notes.push({ pitch, startTime: onset, duration: gate, velocity });
      }
    }
  }
  return notes.sort((a, b) => a.startTime - b.startTime || a.pitch - b.pitch);
}

/**
 * Chain several one-bar grids back to back (A/B/… variants -> a longer clip).
 * Returns the notes and the total length in beats.
 */
export function chainToNotes(
  grids: StepGrid[],
  opts: RenderOptions = {},
): { notes: Note[]; lengthBeats: number } {
  const notes: Note[] = [];
  grids.forEach((g, i) => {
    notes.push(...gridToNotes(g, { ...opts, startBeat: (opts.startBeat ?? 0) + i * BEATS_PER_BAR }));
  });
  return { notes, lengthBeats: Math.max(1, grids.length) * BEATS_PER_BAR };
}

/**
 * Inverse of `gridToNotes` for one bar: quantise each note to its step and set
 * the matching instrument cell. Swing/ratchet detail is intentionally dropped
 * (a note landing inside a step counts as that step's hit), so a straight grid
 * round-trips exactly.
 */
export function notesToGrid(notes: Note[], mapping: MappingId = "po"): StepGrid {
  const pitches = MAPPINGS[mapping].pitches;
  const pitchToCode = new Map<number, InstrumentCode>();
  for (const code of ROW_ORDER) pitchToCode.set(pitches[code], code);

  const rows: Partial<Record<InstrumentCode, number[]>> = {};
  for (const n of notes) {
    const code = pitchToCode.get(n.pitch);
    if (code === undefined) continue;
    const step = Math.round(n.startTime / STEP_BEATS);
    if (step < 0 || step >= STEPS_PER_BAR) continue;
    const row = (rows[code] ??= new Array(STEPS_PER_BAR).fill(0));
    row[step] = 1;
  }
  return { rows };
}
