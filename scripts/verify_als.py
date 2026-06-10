#!/usr/bin/env python3
"""Cross-check data/patterns.json (parsed from the PDF, source of truth) against
the hand-built .als recreation. A mismatch flags EITHER a PDF-parse bug OR a
manual error in the .als — every one gets reviewed by hand.

The .als is NOT authoritative (Erin's instruction): this only surfaces
disagreements for adjudication. Pitch->instrument uses Erin's verified chromatic
PO-kit map (C1=36). Unknown pitches (e.g. HC) are reported so we can learn them.
"""
import gzip
import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ALS = Path(sys.argv[1]) if len(sys.argv) > 1 else (
    Path.home()
    / "Music/Templates/Pocket Operations - A Collection of Drum Machine Patterns Project"
    / "Pocket Operations - A Collection of Drum Machine Patterns.als"
)
JSON = Path(__file__).resolve().parent.parent / "data" / "patterns.json"

PITCH2CODE = {
    36: "BD", 37: "SN", 38: "CH", 39: "OH", 40: "CL", 41: "SH",
    42: "CY", 43: "LT", 44: "MT", 45: "HT", 46: "RS", 47: "CB", 51: "RC",
}


def als_clips(path):
    root = ET.fromstring(gzip.open(path).read())
    clips = []
    unmapped = defaultdict(int)
    for clip in root.iter("MidiClip"):
        nm = clip.find("Name")
        name = nm.get("Value") if nm is not None else ""
        hits = defaultdict(set)
        for kt in clip.iter("KeyTrack"):
            mk = kt.find("MidiKey")
            if mk is None:
                continue
            pitch = int(mk.get("Value"))
            code = PITCH2CODE.get(pitch)
            for ne in kt.iter("MidiNoteEvent"):
                step = round(float(ne.get("Time")) / 0.25) + 1
                if not (1 <= step <= 16):
                    continue
                if code:
                    hits[code].add(step)
                else:
                    unmapped[pitch] += 1
        clips.append((name, hits))
    return clips, unmapped


def main():
    doc = json.loads(JSON.read_text())
    pats = doc["patterns"]

    # full name -> list of pdf hitsets (handle A/B sharing the base differently)
    def full(p):
        return p["name"] + ((" - " + p["variant"]) if p.get("variant") else "")

    pdf_by_name = defaultdict(list)
    for p in pats:
        hs = {c: {i + 1 for i, v in enumerate(row) if v} for c, row in p["rows"].items()}
        pdf_by_name[full(p)].append((p, hs))

    clips, unmapped = als_clips(ALS)
    als_by_name = defaultdict(list)
    for name, hits in clips:
        als_by_name[name].append(hits)

    print(f"PDF patterns: {len(pats)}   ALS clips: {len(clips)}")
    if unmapped:
        print(f"UNMAPPED .als pitches (instrument not in map): {dict(unmapped)}")

    pdf_names = set(pdf_by_name)
    als_names = set(als_by_name)
    only_pdf = pdf_names - als_names
    only_als = als_names - pdf_names
    print(f"\nnames only in PDF ({len(only_pdf)}): {sorted(only_pdf)[:20]}")
    print(f"names only in ALS ({len(only_als)}): {sorted(only_als)[:20]}")

    # Diff matched names (pair up by order when duplicated).
    mismatch = 0
    exact = 0
    for name in sorted(pdf_names & als_names):
        pdf_list = pdf_by_name[name]
        als_list = als_by_name[name]
        for idx, (p, pdf_hs) in enumerate(pdf_list):
            if idx >= len(als_list):
                break
            als_hs = als_list[idx]
            codes = set(pdf_hs) | set(als_hs)
            diffs = []
            for c in sorted(codes):
                a = pdf_hs.get(c, set())
                b = als_hs.get(c, set())
                if a != b:
                    diffs.append(f"{c}: pdf{sorted(a)} als{sorted(b)}")
            if diffs:
                mismatch += 1
                if mismatch <= 40:
                    flag = " [PDF warned]" if p.get("_warnings") else ""
                    print(f"\n  MISMATCH {name}{flag}")
                    for d in diffs:
                        print(f"      {d}")
            else:
                exact += 1
    print(f"\nexact-match patterns: {exact}   mismatched: {mismatch}")


if __name__ == "__main__":
    main()
