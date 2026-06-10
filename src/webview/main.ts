// Webview UI for the Pocket Operations dialog.
//
// Runs entirely client-side in Live's modal WebView. It receives the invocation
// context (window.__CTX__: entry point, optional initial pattern, theme, tempo),
// lets the user browse the bundled library, edit the step grid, pick a kit/bars/
// swing, optionally audition a synthesised preview (Web Audio — Live's own kit
// can't be sounded from here), then posts the chosen target + the rendered notes
// back over Live's WebView bridge. Note rendering + the pattern bank are the
// pure, unit-tested modules in ../grid and ../patternbank; nothing here touches
// the Live Set — the host writes the returned notes.
import {
  BEATS_PER_BAR,
  STEPS_PER_BAR,
  chainToNotes,
  gridCodes,
  toggleAccent,
  toggleCell,
  type Note,
  type StepGrid,
} from "../grid.js";
import {
  byGenre,
  byId,
  densityLine,
  genres,
  meta,
  patterns,
  toStepGrid,
  variantsOf,
  type Pattern,
} from "../patternbank.js";
import {
  INSTRUMENT_NAMES,
  MAPPINGS,
  ROW_ORDER,
  type InstrumentCode,
  type MappingId,
} from "../mapping.js";

// ── Host contract ──────────────────────────────────────────────────────────
type Entry = "slot" | "clip";
type Target = "slot" | "clip" | "track" | "replace";
interface Ctx {
  entry: Entry;
  patternId?: string;
  theme?: "light" | "dark";
  tempo?: number;
}
type Result =
  | { action: "cancel" }
  | { action: "apply"; target: Target; notes: Note[]; lengthBeats: number; name: string };

declare global {
  interface Window {
    __CTX__: Ctx;
    webkit?: { messageHandlers?: { live?: { postMessage(m: unknown): void } } };
    chrome?: { webview?: { postMessage(m: unknown): void } };
  }
}

function send(result: Result): void {
  const message = { method: "close_and_send", params: [JSON.stringify(result)] };
  if (window.webkit?.messageHandlers?.live) window.webkit.messageHandlers.live.postMessage(message);
  else if (window.chrome?.webview) window.chrome.webview.postMessage(message);
}

const ctx: Ctx = window.__CTX__ ?? { entry: "slot" };
const TEMPO = ctx.tempo && ctx.tempo > 0 ? ctx.tempo : 120;

// ── Control option tables ────────────────────────────────────────────────
const BARS_OPTIONS = [1, 2, 4];
const SWING_OPTIONS = [0, 15, 30, 50, 65]; // % of max 16th-swing → swing = pct/100
const TARGETS: { value: Exclude<Target, "replace">; label: string; sub: string }[] = [
  { value: "slot", label: "This slot", sub: "Replace the clicked clip slot" },
  { value: "clip", label: "New clip", sub: "Next empty slot on this track" },
  { value: "track", label: "New track", sub: "Fresh MIDI track for the pattern" },
];

// ── Mutable UI state ───────────────────────────────────────────────────────
function cloneGrid(p: Pattern): StepGrid {
  const g = toStepGrid(p);
  const rows: StepGrid["rows"] = {};
  for (const [code, row] of Object.entries(g.rows)) {
    if (row) rows[code as InstrumentCode] = row.slice();
  }
  return { rows, accents: g.accents?.slice(), ratchets: g.ratchets?.slice() };
}

function firstPattern(): Pattern {
  return (ctx.patternId ? byId(ctx.patternId) : undefined) ?? patterns()[0]!;
}

const state = {
  pattern: firstPattern(),
  grid: cloneGrid(firstPattern()),
  mappingId: "po" as MappingId,
  bars: 1,
  swingPct: 0,
  target: (ctx.entry === "clip" ? "replace" : "slot") as Target,
  theme: ctx.theme === "dark" ? "dark" : "light",
  // browse
  filterGenre: null as string | null,
  query: "",
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

// ── Pattern selection ──────────────────────────────────────────────────────
function loadPattern(p: Pattern): void {
  state.pattern = p;
  state.grid = cloneGrid(p);
  renderPicker();
  renderGrid();
  renderLegend();
}

function genreList(): Pattern[] {
  return patterns().filter((p) => p.genre === state.pattern.genre);
}

function step(delta: number): void {
  const list = genreList();
  const i = list.findIndex((p) => p.id === state.pattern.id);
  const next = list[(i + delta + list.length) % list.length];
  if (next) loadPattern(next);
}

// ── Rendering: picker ──────────────────────────────────────────────────────
function renderPicker(): void {
  $("genre-name").textContent = state.pattern.genre;
  const list = genreList();
  const idx = list.findIndex((p) => p.id === state.pattern.id);
  $("pattern-count").textContent = `pattern ${idx + 1} / ${list.length}`;
  $("pattern-name").textContent = state.pattern.name;

  const variants = variantsOf(state.pattern);
  const wrap = $("variants");
  wrap.innerHTML = "";
  if (variants.length > 1) {
    for (const v of variants) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "variant" + (v.id === state.pattern.id ? " active" : "");
      b.textContent = v.variant ?? "·";
      b.addEventListener("click", () => loadPattern(v));
      wrap.appendChild(b);
    }
  }
}

// ── Rendering: grid ────────────────────────────────────────────────────────
const isShade = (s: number): boolean => s < 4 || (s >= 8 && s < 12); // beats 1 & 3

function makeRow(label: string, cells: number[], code: InstrumentCode | "AC"): HTMLElement {
  const row = document.createElement("div");
  row.className = "grid-row" + (code === "AC" ? " ac-row" : "");
  const lab = document.createElement("div");
  lab.className = "row-label";
  lab.textContent = label;
  row.appendChild(lab);
  const cellWrap = document.createElement("div");
  cellWrap.className = "cells";
  for (let s = 0; s < STEPS_PER_BAR; s++) {
    const c = document.createElement("div");
    const hit = cells[s] === 1;
    c.className = "cell" + (isShade(s) ? " shade" : "") + (hit ? " hit" : "");
    c.textContent = code === "AC" ? (hit ? "^" : "") : hit ? String(s + 1) : "";
    c.dataset.code = code;
    c.dataset.step = String(s);
    cellWrap.appendChild(c);
  }
  row.appendChild(cellWrap);
  return row;
}

function renderGrid(): void {
  const grid = $("grid");
  grid.innerHTML = "";
  const accents = state.grid.accents ?? new Array(STEPS_PER_BAR).fill(0);
  grid.appendChild(makeRow("AC", accents, "AC"));
  for (const code of gridCodes(state.grid)) {
    grid.appendChild(makeRow(code, state.grid.rows[code]!, code));
  }
}

$("grid").addEventListener("click", (e) => {
  const cell = (e.target as HTMLElement).closest<HTMLElement>(".cell");
  if (!cell) return;
  const s = Number(cell.dataset.step);
  const code = cell.dataset.code as InstrumentCode | "AC";
  state.grid = code === "AC" ? toggleAccent(state.grid, s) : toggleCell(state.grid, code, s);
  renderGrid();
});

// ── Rendering: legend ──────────────────────────────────────────────────────
function renderLegend(): void {
  const legend = $("legend");
  legend.innerHTML = "";
  const add = (code: string, name: string): void => {
    const span = document.createElement("span");
    span.className = "legend-item";
    span.innerHTML = `<b>${code}</b>${name}`;
    legend.appendChild(span);
  };
  add("AC", "Accent");
  for (const code of gridCodes(state.grid)) add(code, INSTRUMENT_NAMES[code]);
}

// ── Rendering: header / controls / footer ──────────────────────────────────
function renderStaticChrome(): void {
  $("count-n").textContent = String(patterns().length);
  const m = meta();
  $("about-meta").innerHTML =
    `<div>Compiled by ${m.author} — Minneapolis, MN</div>` +
    `<div>${m.edition ?? "Second Edition · Revision 3.1 · 2024"}</div>` +
    (m.isbn ? `<div>ISBN ${m.isbn}</div>` : "");
  const studio = $("about-studio") as HTMLAnchorElement;
  if (m.url) {
    studio.href = m.url;
    studio.lastChild!.textContent = m.url.replace(/^https?:\/\//, "");
  }
  $("browse-sub").textContent = `${patterns().length} patterns · ${genres().length} genres`;
}

function renderControls(): void {
  $("mapping-val").textContent = MAPPINGS[state.mappingId].id === "po" ? "PO kit" : "General MIDI";
  $("bars-val").textContent = state.bars === 1 ? "1 bar" : `${state.bars} bars`;
  $("swing-val").textContent = `${state.swingPct}%`;

  const isClip = ctx.entry === "clip";
  $("to-label").style.display = isClip ? "none" : "";
  $("f-target").style.display = isClip ? "none" : "";
  $("insert-label").textContent = isClip ? "Replace" : "Insert";
  if (!isClip) {
    const t = TARGETS.find((o) => o.value === state.target);
    $("target-val").textContent = t ? t.label : "This slot";
  }
}

// ── Custom dropdown popover ────────────────────────────────────────────────
interface MenuItem { label: string; sub?: string; value: string; checked: boolean; count?: number; }
const menu = $("menu");

function closeMenu(): void { menu.classList.remove("open"); }

function openMenu(anchor: HTMLElement, items: MenuItem[], onPick: (v: string) => void, withSearch = false): void {
  menu.innerHTML = "";
  let searchInput: HTMLInputElement | null = null;
  const list = document.createElement("div");

  const paint = (filter: string): void => {
    list.innerHTML = "";
    const q = filter.trim().toLowerCase();
    for (const it of items) {
      if (q && !it.label.toLowerCase().includes(q)) continue;
      const row = document.createElement("div");
      row.className = "menu-item";
      const check = document.createElement("div");
      check.className = "menu-check";
      check.textContent = it.checked ? "✓" : "";
      const body = document.createElement("div");
      body.className = "menu-body";
      const title = document.createElement("div");
      title.className = "menu-title";
      title.innerHTML = it.label + (it.count !== undefined ? ` <span class="ct">${it.count}</span>` : "");
      body.appendChild(title);
      if (it.sub) {
        const sub = document.createElement("div");
        sub.className = "menu-sub";
        sub.textContent = it.sub;
        body.appendChild(sub);
      }
      row.appendChild(check);
      row.appendChild(body);
      row.addEventListener("click", () => { closeMenu(); onPick(it.value); });
      list.appendChild(row);
    }
  };

  if (withSearch) {
    searchInput = document.createElement("input");
    searchInput.className = "menu-search";
    searchInput.placeholder = "Filter…";
    searchInput.addEventListener("input", () => paint(searchInput!.value));
    menu.appendChild(searchInput);
  }
  paint("");
  menu.appendChild(list);

  // position below the anchor, clamped to the viewport
  const r = anchor.getBoundingClientRect();
  menu.classList.add("open");
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  let left = r.left, top = r.bottom + 4;
  if (left + mw > window.innerWidth - 8) left = window.innerWidth - 8 - mw;
  if (top + mh > window.innerHeight - 8) top = Math.max(8, r.top - 4 - mh);
  menu.style.left = `${Math.max(8, left)}px`;
  menu.style.top = `${top}px`;
  searchInput?.focus();
}

// ── Browse view ────────────────────────────────────────────────────────────
function uniqueNames(list: Pattern[]): Pattern[] {
  const seen = new Set<string>();
  const out: Pattern[] = [];
  for (const p of list) {
    if (seen.has(p.name)) continue;
    seen.add(p.name);
    out.push(p);
  }
  return out;
}

function barcode(p: Pattern): HTMLElement {
  const wrap = document.createElement("div");
  wrap.className = "barcode";
  const dens = densityLine(p);
  const max = Math.max(1, ...dens);
  for (const v of dens) {
    const b = document.createElement("div");
    b.className = "bar" + (v === 0 ? " off" : "");
    b.style.height = v === 0 ? "2px" : `${Math.round(4 + (v / max) * 14)}px`;
    wrap.appendChild(b);
  }
  return wrap;
}

function browseRow(name: Pattern): HTMLElement {
  const variants = variantsOf(name);
  const row = document.createElement("div");
  row.className = "browse-row" + (name.name === state.pattern.name && name.genre === state.pattern.genre ? " active" : "");
  row.appendChild(barcode(variants[0] ?? name));
  const label = document.createElement("div");
  label.className = "browse-row-name";
  label.textContent = name.name;
  row.appendChild(label);
  if (variants.length > 1) {
    const vw = document.createElement("div");
    vw.className = "row-variants";
    for (const v of variants) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "variant";
      b.textContent = v.variant ?? "·";
      b.addEventListener("click", (e) => { e.stopPropagation(); loadPattern(v); showMain(); });
      vw.appendChild(b);
    }
    row.appendChild(vw);
  }
  row.addEventListener("click", () => { loadPattern(variants[0] ?? name); showMain(); });
  return row;
}

function renderFilters(): void {
  const row = $("filter-row");
  row.innerHTML = "";
  const all = byGenre();
  const mkChip = (label: string, count: number, g: string | null): void => {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "filter-chip" + (state.filterGenre === g ? " active" : "");
    chip.innerHTML = `${label} <span class="ct">${count}</span>`;
    chip.addEventListener("click", () => { state.filterGenre = g; renderFilters(); renderBrowseCols(); });
    row.appendChild(chip);
  };
  mkChip("All", patterns().length, null);
  for (const [g, ps] of all) mkChip(g, ps.length, g);
}

function renderBrowseCols(): void {
  const cols = $("browse-cols");
  cols.innerHTML = "";
  const left = document.createElement("div");
  const right = document.createElement("div");
  left.className = right.className = "browse-col";
  cols.appendChild(left);
  cols.appendChild(right);
  let lc = 0, rc = 0;

  const q = state.query.trim().toLowerCase();
  const all = byGenre();
  for (const [g, ps] of all) {
    if (state.filterGenre && g !== state.filterGenre) continue;
    let names = uniqueNames(ps);
    if (q) names = names.filter((p) => p.name.toLowerCase().includes(q) || g.toLowerCase().includes(q));
    if (!names.length) continue;
    const target = lc <= rc ? left : right;
    const head = document.createElement("div");
    head.className = "group-head";
    head.innerHTML = `<span>${g}</span><span class="group-count">${ps.length} patterns</span>`;
    target.appendChild(head);
    for (const n of names) target.appendChild(browseRow(n));
    (target === left ? (lc += names.length) : (rc += names.length));
  }
}

function showBrowse(): void {
  renderFilters();
  renderBrowseCols();
  $("view-main").classList.remove("active");
  $("view-browse").classList.add("active");
}
function showMain(): void {
  $("view-browse").classList.remove("active");
  $("view-main").classList.add("active");
}

// ── Theme ──────────────────────────────────────────────────────────────────
const SUN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4.5"/><path d="M12 1.5v2M12 20.5v2M3.5 12h-2M22.5 12h-2M5 5l1.4 1.4M17.6 17.6 19 19M19 5l-1.4 1.4M6.4 17.6 5 19"/></svg>';
const MOON =
  '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

function applyTheme(): void {
  document.body.dataset.theme = state.theme;
  $("theme-toggle").innerHTML = state.theme === "dark" ? SUN : MOON;
  try { localStorage.setItem("po-theme", state.theme); } catch { /* WKWebView may block */ }
}

// ── Audition (Web Audio synth preview) ─────────────────────────────────────
type Voice = "kick" | "snare" | "clap" | "hat" | "openhat" | "tom" | "cymbal" | "perc";
const VOICE: Record<InstrumentCode, Voice> = {
  BD: "kick", SN: "snare", CL: "clap", CH: "hat", OH: "openhat", SH: "hat",
  CY: "cymbal", LT: "tom", MT: "tom", HT: "tom", RS: "perc", CB: "perc", HC: "perc",
};
let audioCtx: AudioContext | null = null;
let auditionTimer: number | null = null;

function noiseBuffer(ac: AudioContext, seconds: number): AudioBuffer {
  const n = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, n, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function playVoice(ac: AudioContext, voice: Voice, t: number, accent: boolean): void {
  const gain = ac.createGain();
  gain.connect(ac.destination);
  const peak = accent ? 0.9 : 0.6;
  if (voice === "kick" || voice === "tom") {
    const osc = ac.createOscillator();
    const f0 = voice === "kick" ? 150 : 220;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(voice === "kick" ? 48 : 90, t + 0.12);
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + (voice === "kick" ? 0.22 : 0.3));
    osc.connect(gain); osc.start(t); osc.stop(t + 0.32);
  } else {
    const src = ac.createBufferSource();
    src.buffer = noiseBuffer(ac, 0.4);
    const hp = ac.createBiquadFilter();
    const decay = voice === "openhat" || voice === "cymbal" ? 0.32 : voice === "hat" ? 0.05 : 0.14;
    hp.type = voice === "snare" || voice === "clap" ? "bandpass" : "highpass";
    hp.frequency.value = voice === "snare" ? 1800 : voice === "clap" ? 1200 : voice === "perc" ? 800 : 7000;
    gain.gain.setValueAtTime(peak, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(hp); hp.connect(gain); src.start(t); src.stop(t + decay + 0.02);
  }
}

function stopAudition(): void {
  if (auditionTimer !== null) { clearTimeout(auditionTimer); auditionTimer = null; }
  $("audition-label").textContent = "Audition";
}

function audition(): void {
  if (auditionTimer !== null) { stopAudition(); return; }
  audioCtx ??= new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const ac = audioCtx;
  void ac.resume();
  const stepDur = 60 / TEMPO / 4;
  const accents = state.grid.accents ?? [];
  const codes = gridCodes(state.grid);
  const start = ac.currentTime + 0.06;
  for (let s = 0; s < STEPS_PER_BAR; s++) {
    const accent = accents[s] === 1;
    for (const code of codes) {
      if (state.grid.rows[code]?.[s] === 1) playVoice(ac, VOICE[code], start + s * stepDur, accent);
    }
  }
  $("audition-label").textContent = "Stop";
  auditionTimer = window.setTimeout(stopAudition, STEPS_PER_BAR * stepDur * 1000 + 350);
}

// ── Apply / cancel ─────────────────────────────────────────────────────────
function apply(): void {
  stopAudition();
  const grids = new Array(state.bars).fill(state.grid);
  const { notes, lengthBeats } = chainToNotes(grids, {
    mapping: state.mappingId,
    swing: state.swingPct / 100,
  });
  const name = state.pattern.name + (state.pattern.variant ? ` - ${state.pattern.variant}` : "");
  send({ action: "apply", target: state.target, notes, lengthBeats, name });
}
function cancel(): void { stopAudition(); send({ action: "cancel" }); }

// ── Wire events ────────────────────────────────────────────────────────────
function wire(): void {
  $("theme-toggle").addEventListener("click", () => { state.theme = state.theme === "dark" ? "light" : "dark"; applyTheme(); });
  $("prev").addEventListener("click", () => step(-1));
  $("next").addEventListener("click", () => step(1));
  $("open-browse").addEventListener("click", showBrowse);
  $("count-pill").addEventListener("click", showBrowse);
  $("browse-back").addEventListener("click", showMain);
  $("browse-close").addEventListener("click", showMain);
  $("open-about").addEventListener("click", () => $("about-overlay").classList.add("open"));
  $("about-close").addEventListener("click", () => $("about-overlay").classList.remove("open"));
  $("about-overlay").addEventListener("click", (e) => { if (e.target === $("about-overlay")) $("about-overlay").classList.remove("open"); });
  $("audition").addEventListener("click", audition);
  $("insert").addEventListener("click", apply);

  const search = $("browse-search") as HTMLInputElement;
  search.addEventListener("input", () => { state.query = search.value; renderBrowseCols(); });

  $("genre-chip").addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu($("genre-chip"), genres().map((g) => ({ label: g, value: g, checked: g === state.pattern.genre, count: byGenre().get(g)!.length })),
      (g) => { const first = patterns().find((p) => p.genre === g); if (first) loadPattern(first); }, true);
  });
  $("f-mapping").addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu($("f-mapping"), Object.values(MAPPINGS).map((m) => ({ label: m.label, value: m.id, sub: m.id === "po" ? "Chromatic from C1, matches the .als recreation" : "Standard GM percussion key map", checked: m.id === state.mappingId })),
      (v) => { state.mappingId = v as MappingId; renderControls(); });
  });
  $("f-bars").addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu($("f-bars"), BARS_OPTIONS.map((b) => ({ label: b === 1 ? "1 bar" : `${b} bars`, value: String(b), checked: b === state.bars })),
      (v) => { state.bars = Number(v); renderControls(); });
  });
  $("f-swing").addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu($("f-swing"), SWING_OPTIONS.map((p) => ({ label: `${p}%`, value: String(p), checked: p === state.swingPct })),
      (v) => { state.swingPct = Number(v); renderControls(); });
  });
  $("f-target").addEventListener("click", (e) => {
    e.stopPropagation();
    openMenu($("f-target"), TARGETS.map((t) => ({ label: t.label, sub: t.sub, value: t.value, checked: t.value === state.target })),
      (v) => { state.target = v as Target; renderControls(); });
  });

  document.addEventListener("click", () => closeMenu());
  window.addEventListener("resize", closeMenu);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (menu.classList.contains("open")) { closeMenu(); return; }
      if ($("about-overlay").classList.contains("open")) { $("about-overlay").classList.remove("open"); return; }
      if ($("view-browse").classList.contains("active")) { showMain(); return; }
      cancel();
    }
    if (e.key === "Enter" && $("view-main").classList.contains("active") && !menu.classList.contains("open")) apply();
  });
}

// ── Boot ─────────────────────────────────────────────────────────────────
applyTheme();
renderStaticChrome();
renderPicker();
renderGrid();
renderLegend();
renderControls();
wire();
