#!/usr/bin/env python3
"""Independent pixel verification: detect filled (black) grid cells geometrically
from the rendered page, with NO reliance on the printed digits. This is the
"images matter" ground truth. For each instrument row we sample the 16 cell
centres; a dark cell = a hit.

Three sources now exist per pattern:
  1. printed value   (extract_patterns.py, the digit in the cell)
  2. pixel cell-fill (this script, the black square)
  3. .als notes      (verify_als.py, Erin's hand recreation)
When 1 and 2 disagree, the pixel reading is authoritative for step *position*.
We report every cell where pixel-fill disagrees with the parsed JSON so the few
conflicts can be resolved.
"""
import json
import sys
from collections import defaultdict
from pathlib import Path

import fitz
import numpy as np

from extract_patterns import (
    PDF_DEFAULT, cluster_lines, calibrate, INSTRUMENTS, ROW_CODES,
    LABEL_MAX_X, HEADER_MAX_Y, FOOTER_MIN_Y, INSTRUMENTS as INSTR,
)

JSON = Path(__file__).resolve().parent.parent / "data" / "patterns.json"
DPI = 200
SCALE = DPI / 72.0


def page_patterns_geometry(page):
    """Re-walk a page into patterns, keeping each row's y and the column model."""
    words = page.get_text("words")
    if not words:
        return []
    lines = cluster_lines(words)
    pats = []
    cur = None
    for y, ws in lines:
        if y < HEADER_MAX_Y or y > FOOTER_MIN_Y:
            continue
        first = ws[0]
        if first[0] < LABEL_MAX_X and first[4] in ROW_CODES:
            if cur is None:
                cur = {"title": None, "rows": [], "ints": []}
            ints = [w for w in ws[1:] if w[4].isdigit() and 1 <= int(w[4]) <= 16]
            cur["ints"].extend(ints)
            cur["rows"].append((first[4], y, ws[1:]))
        else:
            text = " ".join(w[4] for w in ws).strip()
            letters = "".join(c for c in text if c.isalpha())
            if letters and text == text.upper() and len(letters) >= 2:
                if cur and cur["rows"]:
                    pats.append(cur)
                cur = {"title": text, "rows": [], "ints": []}
    if cur and cur["rows"]:
        pats.append(cur)
    return pats


def sample_cell(arr, xc, yc, half=3):
    """Mean luminance in a small box centred on (xc,yc); lower = darker."""
    h, w = arr.shape
    x0, x1 = max(0, int(xc - half)), min(w, int(xc + half + 1))
    y0, y1 = max(0, int(yc - half)), min(h, int(yc + half + 1))
    if x1 <= x0 or y1 <= y0:
        return 255.0
    return float(arr[y0:y1, x0:x1].mean())


def main():
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else PDF_DEFAULT
    doc = fitz.open(pdf)
    parsed = {p["id"]: p for p in json.loads(JSON.read_text())["patterns"]}

    # Index parsed patterns by (pdf_page, name, variant) for matching geometry.
    by_key = defaultdict(list)
    for p in parsed.values():
        by_key[p["pdf_page"]].append(p)

    conflicts = []
    checked = 0
    for i in range(len(doc)):
        page = doc[i]
        geoms = page_patterns_geometry(page)
        if not geoms:
            continue
        pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), colorspace=fitz.csGRAY)
        arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)

        json_pats = by_key.get(i + 1, [])
        for gi, g in enumerate(geoms):
            if not g["ints"]:
                continue
            m, b = calibrate(g["ints"])
            if gi >= len(json_pats):
                continue
            jp = json_pats[gi]  # positional match within page
            # Column centre in points: digit x0 sits ~ left of cell; the cell
            # centre is a bit right. Calibrate cell centre = b + (s-1)*m + m*0.15.
            for code, y, _markers in g["rows"]:
                if code not in INSTRUMENTS:
                    continue  # skip AC accent rows here
                json_row = jp["rows"].get(code)
                if json_row is None:
                    continue
                for s in range(1, 17):
                    xc_pt = b + (s - 1) * m + m * 0.18
                    xc = xc_pt * SCALE
                    yc = y * SCALE
                    lum = sample_cell(arr, xc, yc)
                    pixel_hit = lum < 110          # dark square => hit
                    json_hit = bool(json_row[s - 1])
                    if pixel_hit != json_hit:
                        conflicts.append((jp["name"], jp.get("variant"), code, s,
                                          round(lum), "pixel-only" if pixel_hit else "json-only"))
                checked += 1

    print(f"rows checked: {checked}   cell conflicts (pixel vs json): {len(conflicts)}")
    for name, var, code, s, lum, kind in conflicts:
        full = name + (f" - {var}" if var else "")
        print(f"  {full:40s} {code} step{s:2d} lum={lum:3d} {kind}")


if __name__ == "__main__":
    main()
