// Instrument-code -> MIDI pitch maps, and the canonical row order.
//
// A Pocket Operations pattern stores instrument *codes* (BD, SN, CH, …), never
// pitches, so the same pattern data drops onto any kit by swapping the map. Two
// ship by default:
//
//   - "po"  Erin's PO kit: a chromatic run from C1 (36), one semitone per
//           instrument. This matches the hand-built .als recreation
//           (BOOTS N' CATS -> 36/37/38, etc.).
//   - "gm"  General MIDI percussion, for stock GM kits / hardware.
//
// Pure data; no SDK dependency.

/** The 13 instrument codes that appear in the booklet (12 legend + HC). */
export const INSTRUMENT_CODES = [
  "BD", "SN", "LT", "RS", "MT", "CB", "HT", "CY", "CL", "OH", "SH", "CH", "HC",
] as const;
export type InstrumentCode = (typeof INSTRUMENT_CODES)[number];

export const INSTRUMENT_NAMES: Record<InstrumentCode, string> = {
  BD: "Bass Drum", SN: "Snare", LT: "Low Tom", RS: "Rimshot",
  MT: "Medium Tom", CB: "Cowbell", HT: "High Tom", CY: "Cymbal",
  CL: "Hand Clap", OH: "Open Hat", SH: "Shaker", CH: "Closed Hat",
  HC: "High Conga",
};

/**
 * Canonical top-to-bottom display/render order: hats & metals high, kick low.
 * A pattern only renders the rows it actually contains, in this order.
 */
export const ROW_ORDER: InstrumentCode[] = [
  "CY", "OH", "CH", "SH", "CB", "HC", "HT", "MT", "LT", "RS", "CL", "SN", "BD",
];

export type MappingId = "po" | "gm";

/**
 * Erin's PO kit: chromatic from C1=36. The .als recreation only uses 36–47 and
 * 51 (no distinct conga pad), so HC is assigned 48 here — the next semitone
 * above CB (47) — to keep one pad per instrument.
 */
export const PO_KIT: Record<InstrumentCode, number> = {
  BD: 36, SN: 37, CH: 38, OH: 39, CL: 40, SH: 41, CY: 42,
  LT: 43, MT: 44, HT: 45, RS: 46, CB: 47, HC: 48,
};

/** General MIDI percussion key map. */
export const GM_KIT: Record<InstrumentCode, number> = {
  BD: 36, // Bass Drum 1
  SN: 38, // Acoustic Snare
  RS: 37, // Side Stick
  CL: 39, // Hand Clap
  LT: 45, // Low Tom
  MT: 47, // Low-Mid Tom
  HT: 50, // High Tom
  CH: 42, // Closed Hi-Hat
  OH: 46, // Open Hi-Hat
  CY: 49, // Crash Cymbal 1
  CB: 56, // Cowbell
  SH: 82, // Shaker
  HC: 63, // Open Hi Conga
};

export interface MappingChoice {
  id: MappingId;
  label: string;
  pitches: Record<InstrumentCode, number>;
}

export const MAPPINGS: Record<MappingId, MappingChoice> = {
  po: { id: "po", label: "PO kit (C1 up)", pitches: PO_KIT },
  gm: { id: "gm", label: "General MIDI", pitches: GM_KIT },
};

/** Pitch for an instrument code under a mapping (undefined if not mapped). */
export function pitchOf(code: string, mapping: MappingId = "po"): number | undefined {
  return (MAPPINGS[mapping].pitches as Record<string, number>)[code];
}

/** Reverse lookup pitch -> code for a mapping (first code wins on collision). */
export function codeOf(pitch: number, mapping: MappingId = "po"): InstrumentCode | undefined {
  const pitches = MAPPINGS[mapping].pitches;
  for (const code of INSTRUMENT_CODES) {
    if (pitches[code] === pitch) return code;
  }
  return undefined;
}
