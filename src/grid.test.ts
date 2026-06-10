import { describe, expect, it } from "vitest";
import {
  BEATS_PER_BAR,
  DEFAULT_ACCENT_VELOCITY,
  DEFAULT_VELOCITY,
  STEP_BEATS,
  chainToNotes,
  emptyGrid,
  gridCodes,
  gridToNotes,
  notesToGrid,
  stepDensity,
  toggleAccent,
  toggleCell,
  type StepGrid,
} from "./grid.js";
import { PO_KIT } from "./mapping.js";

// BOOTS N' CATS: BD on 1/9, SN on 5/13, CH on every odd 16th.
function bootsNCats(): StepGrid {
  const hit = (steps: number[]) => {
    const r = new Array(16).fill(0);
    for (const s of steps) r[s - 1] = 1;
    return r;
  };
  return {
    rows: {
      CH: hit([1, 3, 5, 7, 9, 11, 13, 15]),
      SN: hit([5, 13]),
      BD: hit([1, 9]),
    },
  };
}

describe("grid -> notes", () => {
  it("places each hit on its 16th-note beat with the mapped pitch", () => {
    const notes = gridToNotes(bootsNCats(), { mapping: "po" });
    // 8 CH + 2 SN + 2 BD = 12 notes
    expect(notes).toHaveLength(12);
    const bd = notes.filter((n) => n.pitch === PO_KIT.BD);
    expect(bd.map((n) => n.startTime)).toEqual([0, 8 * STEP_BEATS]);
    const ch = notes.filter((n) => n.pitch === PO_KIT.CH);
    expect(ch.map((n) => n.startTime)).toEqual([0, 1, 2, 3, 4, 5, 6, 7].map((i) => i * 2 * STEP_BEATS));
  });

  it("accented steps render louder", () => {
    let g = bootsNCats();
    g = toggleAccent(g, 0); // accent step 1
    const notes = gridToNotes(g);
    const atZero = notes.filter((n) => n.startTime === 0);
    expect(atZero.every((n) => n.velocity === DEFAULT_ACCENT_VELOCITY)).toBe(true);
    const atFour = notes.filter((n) => n.startTime === 4 * STEP_BEATS);
    expect(atFour.every((n) => n.velocity === DEFAULT_VELOCITY)).toBe(true);
  });

  it("skips instruments the chosen kit does not map", () => {
    const g: StepGrid = { rows: { HC: new Array(16).fill(0) } };
    g.rows.HC![0] = 1;
    // PO maps HC; an empty custom mapping would not — emulate by GM which maps it too.
    expect(gridToNotes(g, { mapping: "po" })).toHaveLength(1);
  });

  it("ratchets subdivide a step into N evenly spaced hits", () => {
    const g: StepGrid = { rows: { CH: new Array(16).fill(0) }, ratchets: new Array(16).fill(0) };
    g.rows.CH![0] = 1;
    g.ratchets![0] = 1;
    const notes = gridToNotes(g, { ratchetHits: 4 });
    expect(notes).toHaveLength(4);
    expect(notes.map((n) => n.startTime)).toEqual([0, 1, 2, 3].map((i) => (i * STEP_BEATS) / 4));
  });

  it("swing delays the off-16ths only", () => {
    const g: StepGrid = { rows: { CH: new Array(16).fill(1) } };
    const straight = gridToNotes(g, { swing: 0 });
    const swung = gridToNotes(g, { swing: 1 });
    // even steps (index 0,2,…) unchanged; odd steps pushed late
    expect(swung[0]!.startTime).toBe(straight[0]!.startTime);
    expect(swung[1]!.startTime).toBeGreaterThan(straight[1]!.startTime);
  });
});

describe("notes -> grid round-trip", () => {
  it("a straight grid survives gridToNotes -> notesToGrid", () => {
    const g = bootsNCats();
    const back = notesToGrid(gridToNotes(g, { mapping: "po" }), "po");
    expect(back.rows.BD).toEqual(g.rows.BD);
    expect(back.rows.SN).toEqual(g.rows.SN);
    expect(back.rows.CH).toEqual(g.rows.CH);
  });
});

describe("chaining", () => {
  it("places the B bar a whole bar after A", () => {
    const a = bootsNCats();
    const { notes, lengthBeats } = chainToNotes([a, a]);
    expect(lengthBeats).toBe(2 * BEATS_PER_BAR);
    const late = notes.filter((n) => n.startTime >= BEATS_PER_BAR);
    expect(late.length).toBe(notes.length / 2);
  });
});

describe("helpers", () => {
  it("emptyGrid is all rests", () => {
    const g = emptyGrid(["BD", "SN"]);
    expect(gridToNotes(g)).toHaveLength(0);
    expect(gridCodes(g)).toEqual(["SN", "BD"]); // canonical order
  });

  it("toggleCell flips a single cell immutably", () => {
    const g = emptyGrid(["BD"]);
    const g2 = toggleCell(g, "BD", 0);
    expect(g.rows.BD![0]).toBe(0); // original untouched
    expect(g2.rows.BD![0]).toBe(1);
    expect(toggleCell(g2, "BD", 0).rows.BD![0]).toBe(0);
  });

  it("stepDensity counts hits per column", () => {
    const d = stepDensity(bootsNCats());
    expect(d[0]).toBe(2); // CH + BD on step 1
    expect(d[4]).toBe(2); // CH + SN on step 5
    expect(d[1]).toBe(0); // step 2 empty
  });
});
