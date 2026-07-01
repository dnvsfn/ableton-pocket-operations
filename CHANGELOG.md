# Changelog

All notable changes to **Pocket Operations** are documented here, in
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. This project
adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

The initial feature set. The pattern **data** is redistributed with Paul
Wenzel's permission (granted by email, 2026-06-30) and remains his property, not
relicensed — see [`ATTRIBUTION.md`](ATTRIBUTION.md).

### Added

- **Pattern data** — 269 drum-machine patterns extracted from Paul Wenzel's
  *Pocket Operations* booklet by geometric cell-detection (the filled black
  square is the datum) into `data/patterns.json`. 100% digit self-consistency;
  92% rhythm-match against the hand-built `.als` cross-check.
- **Pure logic** (`src/mapping.ts` · `src/grid.ts` · `src/patternbank.ts`) — the
  PO chromatic + General MIDI kit maps and canonical row order; a 16-step grid
  model with `gridToNotes` / `notesToGrid` (accents, ratchets, swing, A/B bar
  chaining); and the pattern bank (load, search, genre grouping, variant chains,
  density-sparkline data). No SDK dependency — runs on plain Node.
- **Right-click dialog** (`src/webview/`) — browse the pattern library and drop a
  pattern as a MIDI clip onto a Drum Rack track, via the host wiring in
  `src/extension.ts`.
- **27 unit tests** over the mapping, grid, and pattern-bank logic; CI runs the
  SDK-free typecheck + tests.

[Unreleased]: https://github.com/ecarter/ableton-pocket-operations/commits/main
