// Loads and queries the bundled pattern library (data/patterns.json, parsed
// from the Pocket Operations booklet). Pure — no SDK. The shipped extension
// bundles the JSON, so this is the single source of pattern data at runtime.

import raw from "../data/patterns.json" with { type: "json" };
import { STEPS_PER_BAR, type StepGrid } from "./grid.js";
import type { InstrumentCode } from "./mapping.js";

export interface Pattern {
  id: string;
  name: string;
  genre: string;
  variant?: string; // "A" | "B" | "C" | …  chainable
  pdfPage: number;
  rows: Partial<Record<InstrumentCode, number[]>>;
  accents?: number[];
  ratchets?: number[];
}

export interface LibraryMeta {
  source: string;
  author: string;
  edition?: string;
  isbn?: string;
  url?: string;
  license?: string;
}

interface RawPattern {
  id: string;
  name: string;
  genre: string;
  variant?: string;
  pdf_page: number;
  rows: Record<string, number[]>;
  accents?: number[];
  ratchets?: number[];
}

const DATA = raw as unknown as { meta: Record<string, unknown>; patterns: RawPattern[] };

const ALL: Pattern[] = DATA.patterns.map((p) => ({
  id: p.id,
  name: p.name,
  genre: p.genre,
  variant: p.variant,
  pdfPage: p.pdf_page,
  rows: p.rows as Partial<Record<InstrumentCode, number[]>>,
  accents: p.accents,
  ratchets: p.ratchets,
}));

const BY_ID = new Map(ALL.map((p) => [p.id, p]));

export function meta(): LibraryMeta {
  return DATA.meta as unknown as LibraryMeta;
}

export function patterns(): readonly Pattern[] {
  return ALL;
}

export function byId(id: string): Pattern | undefined {
  return BY_ID.get(id);
}

/** Genres in first-appearance (booklet) order. */
export function genres(): string[] {
  const seen: string[] = [];
  for (const p of ALL) if (!seen.includes(p.genre)) seen.push(p.genre);
  return seen;
}

/** Patterns grouped by genre, preserving booklet order within and across groups. */
export function byGenre(): Map<string, Pattern[]> {
  const out = new Map<string, Pattern[]>();
  for (const g of genres()) out.set(g, []);
  for (const p of ALL) out.get(p.genre)!.push(p);
  return out;
}

/** Case-insensitive substring search over name and genre. */
export function search(query: string): Pattern[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...ALL];
  return ALL.filter(
    (p) => p.name.toLowerCase().includes(q) || p.genre.toLowerCase().includes(q),
  );
}

/** Name without its " - A/B/…" variant suffix. */
export function baseName(p: Pattern): string {
  return p.name;
}

/**
 * The A/B/C… chain a pattern belongs to: every pattern in the same genre that
 * shares this base name, ordered by variant. A pattern with no variant returns
 * just itself.
 */
export function variantsOf(p: Pattern): Pattern[] {
  const chain = ALL.filter((q) => q.genre === p.genre && q.name === p.name);
  return chain.sort((a, b) => (a.variant ?? "").localeCompare(b.variant ?? ""));
}

/** Convert a stored pattern to a render-ready StepGrid. */
export function toStepGrid(p: Pattern): StepGrid {
  return { rows: p.rows, accents: p.accents, ratchets: p.ratchets };
}

/** 16-cell density (hits per step across instruments) for a compact sparkline. */
export function densityLine(p: Pattern): number[] {
  const out = new Array(STEPS_PER_BAR).fill(0);
  for (const row of Object.values(p.rows)) {
    if (!row) continue;
    for (let s = 0; s < STEPS_PER_BAR; s++) if (row[s] === 1) out[s] += 1;
  }
  return out;
}
