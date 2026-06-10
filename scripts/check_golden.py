#!/usr/bin/env python3
"""Regression guard: the parsed patterns.json must reproduce the hand-encoded
golden fixtures (data/fixtures/golden.json), which were read off the rendered
PDF grids by eye. Catches any regression in the geometric extractor.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GOLDEN = json.loads((ROOT / "data/fixtures/golden.json").read_text())["patterns"]
PATS = json.loads((ROOT / "data/patterns.json").read_text())["patterns"]


def steps(row):
    return [i + 1 for i, v in enumerate(row) if v]


def find(name, variant):
    for p in PATS:
        if p["name"] == name and p.get("variant") == variant:
            return p
    return None


def main():
    fails = 0
    for g in GOLDEN:
        p = find(g["name"], g.get("variant"))
        label = g["name"] + (f" - {g['variant']}" if g.get("variant") else "")
        if p is None:
            print(f"  MISSING: {label}")
            fails += 1
            continue
        got = {c: steps(r) for c, r in p["rows"].items()}
        want = {c: sorted(v) for c, v in g["rows"].items()}
        if got != want:
            print(f"  MISMATCH {label}\n    want {want}\n    got  {got}")
            fails += 1
    total = len(GOLDEN)
    print(f"golden fixtures: {total - fails}/{total} pass")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
