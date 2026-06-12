# Pocket Operations — Ableton Live extension

A right-click drum-pattern library for Ableton Live 12, built on the official
Extensions SDK. Browse the classic drum-machine patterns from Paul Wenzel's
*Pocket Operations* booklet and drop them as MIDI clips onto a Drum Rack track.

## Status

- **P0 — pattern data** ✅ 269 patterns extracted from the booklet PDF by
  geometric cell-detection (the filled black square is the data). See
  [`scripts/README.md`](scripts/README.md). 100% digit self-consistency; 92%
  rhythm-match vs the hand-built `.als` cross-check.
- **P1 — pure logic** ✅ `src/mapping.ts`, `src/grid.ts`, `src/patternbank.ts`
  with full unit tests (`npm test`). No SDK dependency; runs on plain Node.
- **UI** — not started; awaiting a Pencil design sketch before any webview work.
- Host wiring, audition, themes — later phases.

## Develop

```sh
nvm use            # node 24
npm install
npm test           # vitest
npm run typecheck
```

## Modules (P1)

- **`mapping.ts`** — instrument codes → MIDI pitch, two kits (Erin's PO chromatic
  kit, General MIDI) + canonical row order.
- **`grid.ts`** — the 16-step grid model and `gridToNotes` / `notesToGrid`
  (accents, ratchets, swing, A/B bar chaining).
- **`patternbank.ts`** — loads `data/patterns.json`; search, genre grouping,
  variant chains, density sparkline data.

## Licensing

Code is MIT (© E. T. Carter). The pattern **data** is © Paul Wenzel
(*Pocket Operations*, Some Rights Reserved) and is **not** relicensed — see
[`ATTRIBUTION.md`](ATTRIBUTION.md). Public redistribution of the data is not yet
cleared; confirm the license before any public release.
