# Pattern extraction (build-time)

Offline pipeline that turns Paul Wenzel's *Pocket Operations* booklet into
`../data/patterns.json`, the data the extension ships. The shipped extension
never reads the PDF (the SDK filesystem is sandboxed); these scripts run once at
build time.

## Source of truth: the filled black cell

Each pattern in the booklet is a 16-step grid, one row per instrument. A
**filled black cell is a hit**. The white number printed inside a hit cell is
its step position — but pixel verification proved the number can lie: a handful
of cells print the wrong digit, and some hits carry no digit at all (and
ratchets use a `"` glyph). So hits are read **geometrically from the rendered
image**; the text layer only locates rows, calibrates the 16 column centres,
reads titles/genre, and places accents (`^`) / ratchets (`"`). Printed digits
are a cross-check, not the source.

## Setup

```sh
uv venv .venv && . .venv/bin/activate
uv pip install pymupdf numpy
```

## Run

```sh
python extract_patterns.py     # -> ../data/patterns.json (269 patterns)
python check_golden.py         # regression vs hand-read fixtures (9/9)
python verify_als.py           # cross-check vs the hand-built .als
python verify_pixels.py        # independent pixel pass (sanity)
```

## Validation status

- **100%** of the 3,691 printed digits land on a pixel-detected hit (self-consistent).
- **92%** instrument-agnostic rhythm-match against the hand-built `.als`; the
  ~20 disagreements are manual `.als` errors (PDF is authoritative — e.g.
  `DRUM ROLL 15`). See `../data/als_review_queue.txt`.
- 6 booklet digit-typos (digit printed in the wrong column) are flagged in
  `_warnings`; the hit follows the **cell position**, which the `.als` agrees with.

## Output schema (`patterns.json`)

```jsonc
{
  "meta": { "source", "author", "isbn", "url", "license", "instruments", "extraction" },
  "patterns": [{
    "id": "genre--name",          // stable slug
    "name": "PLANET ROCK",
    "variant": "A",               // optional, A/B/C... chainable
    "genre": "Hip Hop",           // the page running header
    "pdf_page": 19,
    "rows": { "CH": [0|1 x16], "SN": [...], "BD": [...] },  // canonical order
    "accents":  [0|1 x16],        // optional, from the AC ^ row
    "ratchets": [0|1 x16],        // optional, from " beat-repeat glyphs
    "_warnings": [ ... ]          // optional, booklet digit-typo notes
  }]
}
```

Pattern **data** is © Paul Wenzel (Some Rights Reserved, educational use); this
**code** is MIT. Do not relicense the data. See repository attribution.
