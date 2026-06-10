#!/usr/bin/env python3
"""Build-time extractor: Pocket Operations PDF -> patterns.json.

Source of truth is the PDF booklet, and within it the FILLED BLACK CELL is the
pattern data (Erin: "the images in this PDF are important to the patterns").
Pixel verification proved the printed digit can lie: a handful of cells show the
wrong number, and some filled cells carry no number at all (and ratchet cells
use a '"' glyph). So hits are read GEOMETRICALLY from the rendered image; the
text layer is used only to locate rows, calibrate the 16 column centres, read
the title/genre, and place accents ('^') and ratchets ('"'). The printed number
is kept purely as a cross-check (mismatches are flagged, not trusted).

Each hit cell is scored by the fraction of dark pixels inside its rectangle, so
the white digit printed on a black square does not cause a false miss.

Emits data/patterns.json. Cross-checked by verify_als.py and verify_pixels.py.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

import fitz  # PyMuPDF
import numpy as np

PDF_DEFAULT = (
    Path.home()
    / "Music/Resources/Drums"
    / "Pocket_Operations - A Collection of Drum Machine Patterns - Revision 3.1.pdf"
)
OUT = Path(__file__).resolve().parent.parent / "data" / "patterns.json"

INSTRUMENTS = {
    "BD": "Bass Drum", "SN": "Snare", "LT": "Low Tom", "RS": "Rimshot",
    "MT": "Medium Tom", "CB": "Cowbell", "HT": "High Tom", "CY": "Cymbal",
    "CL": "Hand Clap", "OH": "Open High Hat", "SH": "Shaker",
    "CH": "Closed High Hat", "HC": "High Conga",
}
ROW_CODES = set(INSTRUMENTS) | {"AC"}
ORDER = ["CY", "OH", "CH", "SH", "CB", "HC", "HT", "MT", "LT", "RS", "CL", "SN", "BD"]

Y_TOL = 3.5
LABEL_MAX_X = 56
HEADER_MAX_Y = 56
FOOTER_MIN_Y = 460

DPI = 200
SCALE = DPI / 72.0
DARK = 128          # pixel <= DARK counts as "ink"
FILL_HIT = 0.45     # cell is a hit if >= this fraction of its box is ink
SKIP_HEADERS = {"your patterns", "introduction", "resources"}


def cluster_lines(words):
    rows = defaultdict(list)
    for w in words:
        rows[round(w[1] / Y_TOL)].append(w)
    out = []
    for key in sorted(rows):
        ws = sorted(rows[key], key=lambda w: w[0])
        y = sum(w[1] for w in ws) / len(ws)
        out.append((y, ws))
    return out


def cx(w):
    """Horizontal centre of a word box (the digit is centred in its cell)."""
    return (w[0] + w[2]) / 2.0


def calibrate(int_words):
    """Least-squares centre_x = m*(step-1) + b from (digit-centre, value) pairs.

    The digit is centred in its black cell, so the fitted centre_x[step] is the
    cell centre directly (no fudge). Using centres rather than left edges keeps
    one- and two-digit numbers on the same model.
    """
    pts = [(cx(w), int(w[4])) for w in int_words]
    n = len(pts)
    if n == 1:
        x, v = pts[0]
        return 12.83, x - (v - 1) * 12.83
    sx = sum(v - 1 for _, v in pts)
    sy = sum(x for x, _ in pts)
    sxx = sum((v - 1) ** 2 for _, v in pts)
    sxy = sum((v - 1) * x for x, v in pts)
    denom = n * sxx - sx * sx
    if denom == 0:
        return 12.83, sy / n
    m = (n * sxy - sx * sy) / denom
    b = (sy - m * sx) / n
    return m, b


def cell_fill(arr, xc_pt, y_pt, m):
    """Fraction of ink pixels in the cell box centred on the calibrated column."""
    half_w = m * 0.40 * SCALE
    half_h = 5.0 * SCALE
    xc, yc = xc_pt * SCALE, y_pt * SCALE
    h, w = arr.shape
    x0, x1 = max(0, int(xc - half_w)), min(w, int(xc + half_w))
    y0, y1 = max(0, int(yc - half_h)), min(h, int(yc + half_h))
    if x1 <= x0 or y1 <= y0:
        return 0.0
    box = arr[y0:y1, x0:x1]
    return float((box <= DARK).mean())


def parse_page(page, pdf_page):
    words = page.get_text("words")
    if not words:
        return None, []
    lines = cluster_lines(words)

    genre = None
    for y, ws in lines:
        if y < HEADER_MAX_Y:
            text = " ".join(w[4] for w in ws).strip()
            if text and not (ws[0][0] < LABEL_MAX_X and ws[0][4] in ROW_CODES):
                genre = text
            break

    # Group lines into patterns: title -> following instrument/AC rows.
    pats = []
    cur = None
    for y, ws in lines:
        if y < HEADER_MAX_Y or y > FOOTER_MIN_Y:
            continue
        first = ws[0]
        if first[0] < LABEL_MAX_X and first[4] in ROW_CODES:
            if cur is None:
                cur = {"title": None, "rows": [], "ints": []}
            cur["rows"].append((first[4], y, ws[1:]))
            cur["ints"].extend(w for w in ws[1:]
                               if re.fullmatch(r"\d{1,2}", w[4]) and 1 <= int(w[4]) <= 16)
        else:
            text = " ".join(w[4] for w in ws).strip()
            letters = re.sub(r"[^A-Za-z]", "", text)
            if letters and text == text.upper() and len(letters) >= 2:
                if cur and cur["rows"]:
                    pats.append(cur)
                cur = {"title": text, "rows": [], "ints": []}
    if cur and cur["rows"]:
        pats.append(cur)

    # Render once; read hits geometrically.
    pix = page.get_pixmap(matrix=fitz.Matrix(SCALE, SCALE), colorspace=fitz.csGRAY)
    arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)

    out = []
    for pat in pats:
        if not pat["ints"]:
            continue
        m, b = calibrate(pat["ints"])
        # fitted centre_x[step] IS the cell centre (digits are cell-centred);
        # col_x[s] is the centre of step s+1, so step 1 = b, step 16 = b+15m
        col_x = [b + s * m for s in range(16)]

        rows = {}
        accents = [0] * 16
        ratchets = [0] * 16
        warnings = []
        for code, y, markers in pat["rows"]:
            if code == "AC":
                for w in markers:
                    s = round((cx(w) - b) / m) + 1
                    if 1 <= s <= 16:
                        accents[s - 1] = 1
                continue
            if code not in INSTRUMENTS:
                continue
            grid = [0] * 16
            for s in range(16):
                if cell_fill(arr, col_x[s], y, m) >= FILL_HIT:
                    grid[s] = 1
            rows[code] = grid
            # cross-check: every printed digit should land on a pixel-hit
            for w in markers:
                if re.fullmatch(r"\d{1,2}", w[4]) and 1 <= int(w[4]) <= 16:
                    col = round((cx(w) - b) / m) + 1
                    val = int(w[4])
                    if val != col:
                        warnings.append(f"{code}: digit {val} sits in column {col}")
                    if 1 <= col <= 16 and not grid[col - 1]:
                        warnings.append(f"{code}: digit {val}@col{col} but cell not filled")
                elif w[4] in ('"', "”", "“", "''"):
                    s = round((cx(w) - b) / m) + 1
                    if 1 <= s <= 16:
                        ratchets[s - 1] = 1

        rows = {c: rows[c] for c in ORDER if c in rows and any(rows[c])}
        if not rows:
            continue

        title = pat["title"] or "(untitled)"
        title = re.sub(r"^[↳⮡\s]+", "", title)             # drop continuation arrows
        title = re.sub(r"^OR\s+FOLLOW", "FOLLOW", title)    # normalise alt-ending lead-in
        title = title.strip()
        variant = None
        mvar = re.search(r"\s*[-–]\s*([A-Z])\s*$", title)
        if mvar:
            variant = mvar.group(1)
            title = title[: mvar.start()].strip()

        rec = {"name": title, "pdf_page": pdf_page, "rows": rows}
        if variant:
            rec["variant"] = variant
        if any(accents):
            rec["accents"] = accents
        if any(ratchets):
            rec["ratchets"] = ratchets
        if warnings:
            rec["_warnings"] = warnings
        out.append(rec)
    return genre, out


def main():
    pdf = Path(sys.argv[1]) if len(sys.argv) > 1 else PDF_DEFAULT
    doc = fitz.open(pdf)
    all_patterns = []
    for i in range(len(doc)):
        genre, pats = parse_page(doc[i], i + 1)
        if not pats:
            continue
        g = (genre or "").strip()
        if g.lower() in SKIP_HEADERS:
            continue
        for p in pats:
            p["genre"] = g or "Unknown"
        all_patterns.extend(pats)

    seen = defaultdict(int)
    for p in all_patterns:
        slug = re.sub(r"[^a-z0-9]+", "-", p["name"].lower()).strip("-")
        gslug = re.sub(r"[^a-z0-9]+", "-", p["genre"].lower()).strip("-")
        base = f"{gslug}--{slug}" or "pattern"
        seen[base] += 1
        p["id"] = base if seen[base] == 1 else f"{base}-{seen[base]}"

    doc_out = {
        "meta": {
            "source": "Pocket Operations: A Collection of Drum Machine Patterns",
            "author": "Paul Wenzel",
            "edition": "Second Edition, Rev. 3.1",
            "isbn": "978-0-359-84908-6",
            "url": "https://shittyrecording.studio",
            "license": "Some Rights Reserved (educational use) - pattern data (c) Paul Wenzel",
            "instruments": INSTRUMENTS,
            "extraction": "pixel cell-fill (geometric); printed digits cross-check only",
        },
        "patterns": all_patterns,
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(doc_out, indent=2, ensure_ascii=False))

    by_genre = defaultdict(int)
    warned = variants = 0
    for p in all_patterns:
        by_genre[p["genre"]] += 1
        warned += 1 if p.get("_warnings") else 0
        variants += 1 if p.get("variant") else 0
    print(f"patterns: {len(all_patterns)}  -> {OUT}")
    print(f"variants: {variants}   patterns with cross-check warnings: {warned}")
    for g, n in by_genre.items():
        print(f"  {n:4d}  {g}")


if __name__ == "__main__":
    main()
