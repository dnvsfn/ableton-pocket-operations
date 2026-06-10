import { describe, expect, it } from "vitest";
import { gridToNotes } from "./grid.js";
import {
  byGenre,
  byId,
  densityLine,
  genres,
  meta,
  patterns,
  search,
  toStepGrid,
  variantsOf,
} from "./patternbank.js";

describe("pattern bank", () => {
  it("loads the full bundled library", () => {
    expect(patterns().length).toBeGreaterThan(250);
  });

  it("every pattern has a unique id, a name, a genre, and >=1 hit", () => {
    const ids = new Set<string>();
    for (const p of patterns()) {
      expect(p.id).toBeTruthy();
      expect(ids.has(p.id)).toBe(false);
      ids.add(p.id);
      expect(p.name).toBeTruthy();
      expect(p.genre).toBeTruthy();
      const hits = Object.values(p.rows).reduce(
        (n, row) => n + (row?.filter((c) => c === 1).length ?? 0),
        0,
      );
      expect(hits, p.id).toBeGreaterThan(0);
    }
  });

  it("every row is exactly 16 cells of 0/1", () => {
    for (const p of patterns()) {
      for (const [code, row] of Object.entries(p.rows)) {
        expect(row, `${p.id}.${code}`).toHaveLength(16);
        expect(row!.every((c) => c === 0 || c === 1)).toBe(true);
      }
    }
  });

  it("carries attribution metadata", () => {
    expect(meta().author).toBe("Paul Wenzel");
    expect(meta().source).toMatch(/Pocket Operations/);
  });

  it("groups by genre preserving booklet order", () => {
    const grouped = byGenre();
    expect([...grouped.keys()]).toEqual(genres());
    const total = [...grouped.values()].reduce((n, ps) => n + ps.length, 0);
    expect(total).toBe(patterns().length);
    expect(genres()[0]).toBe("Basic Patterns");
  });

  it("finds a known pattern and renders it to notes", () => {
    const boots = patterns().find((p) => p.name === "BOOTS N’ CATS");
    expect(boots).toBeDefined();
    expect(byId(boots!.id)).toBe(boots);
    const notes = gridToNotes(toStepGrid(boots!), { mapping: "po" });
    expect(notes.length).toBe(12);
  });

  it("search matches name and genre, case-insensitively", () => {
    expect(search("amen break").length).toBeGreaterThan(0);
    expect(search("hip hop").length).toBeGreaterThan(0);
    expect(search("").length).toBe(patterns().length);
  });

  it("links A/B/C variants into an ordered chain", () => {
    const amenA = patterns().find((p) => p.name === "AMEN BREAK" && p.variant === "A");
    expect(amenA).toBeDefined();
    const chain = variantsOf(amenA!);
    expect(chain.length).toBeGreaterThanOrEqual(2);
    expect(chain.map((p) => p.variant)).toEqual([...chain.map((p) => p.variant)].sort());
    expect(chain[0]!.variant).toBe("A");
  });

  it("densityLine is 16 wide and non-empty for a real pattern", () => {
    const p = patterns()[0]!;
    const d = densityLine(p);
    expect(d).toHaveLength(16);
    expect(d.reduce((a, b) => a + b, 0)).toBeGreaterThan(0);
  });
});
