import { describe, expect, it } from "vitest";
import {
  GM_KIT,
  INSTRUMENT_CODES,
  MAPPINGS,
  PO_KIT,
  ROW_ORDER,
  codeOf,
  pitchOf,
} from "./mapping.js";

describe("mapping", () => {
  it("PO kit matches the verified .als pads (BD/SN/CH = 36/37/38)", () => {
    expect(PO_KIT.BD).toBe(36);
    expect(PO_KIT.SN).toBe(37);
    expect(PO_KIT.CH).toBe(38);
    expect(PO_KIT.OH).toBe(39);
    expect(PO_KIT.CB).toBe(47);
  });

  it("every instrument code is mapped on both kits, with valid MIDI pitches", () => {
    for (const code of INSTRUMENT_CODES) {
      for (const kit of [PO_KIT, GM_KIT]) {
        const p = kit[code];
        expect(p, code).toBeGreaterThanOrEqual(0);
        expect(p, code).toBeLessThanOrEqual(127);
      }
    }
  });

  it("PO kit pitches are unique (one pad per instrument)", () => {
    const used = Object.values(PO_KIT);
    expect(new Set(used).size).toBe(used.length);
  });

  it("HC gets its own PO pad above CB, since the .als has no conga pad", () => {
    expect(PO_KIT.HC).toBe(48);
    expect(PO_KIT.HC).toBeGreaterThan(PO_KIT.CB);
  });

  it("ROW_ORDER lists each code exactly once", () => {
    expect([...ROW_ORDER].sort()).toEqual([...INSTRUMENT_CODES].sort());
  });

  it("pitchOf / codeOf round-trip on both kits", () => {
    for (const id of ["po", "gm"] as const) {
      for (const code of INSTRUMENT_CODES) {
        const pitch = pitchOf(code, id)!;
        expect(codeOf(pitch, id)).toBe(code);
      }
    }
  });

  it("pitchOf returns undefined for an unknown code", () => {
    expect(pitchOf("ZZ")).toBeUndefined();
  });

  it("exposes labelled choices", () => {
    expect(MAPPINGS.po.label).toMatch(/PO/);
    expect(MAPPINGS.gm.label).toMatch(/MIDI/);
  });
});
