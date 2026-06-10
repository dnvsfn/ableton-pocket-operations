// Pocket Operations — drop classic drum-machine patterns onto a Drum Rack track.
//
// Two right-click actions open the dialog (the webview in ./webview, inlined at
// build time as __INTERFACE_HTML__); the dialog does all pattern selection, grid
// editing and note rendering client-side and posts back the chosen target plus
// the finished notes. This file is host glue only: show the dialog, then write
// the returned notes to the Set.
//
//   - ClipSlot → "Insert Drum Pattern": dialog picks a destination
//     (this slot / a new clip on the track / a new track) and we create the clip.
//   - MidiClip → "Replace with Drum Pattern": overwrite the clicked clip's notes
//     (single undo step).
import {
  initialize,
  ClipSlot,
  MidiClip,
  MidiTrack,
  type ActivationContext,
  type ExtensionContext,
  type Handle,
  type NoteDescription,
} from "@ableton-extensions/sdk";
import { BEATS_PER_BAR } from "./grid.js";

const ID = "pocket-operations";
const DEFAULT_PATTERN_ID = "basic-patterns--boots-n-cats"; // webview falls back if absent

declare const __INTERFACE_HTML__: string;

type Entry = "slot" | "clip";
interface ApplyResult {
  action: "apply";
  target: "slot" | "clip" | "track" | "replace";
  notes: NoteDescription[];
  lengthBeats: number;
  name: string;
}
type DialogResult = { action: "cancel" } | ApplyResult;

/**
 * Show the dialog and return the user's choice. The clip's context (entry point,
 * a starting pattern, the song tempo for the audition preview) is injected by
 * replacing the __CTX_JSON__ token in the inlined HTML. The SDK types numeric
 * getters as `number` but some return BigInt at runtime; JSON.stringify throws on
 * BigInt, so coerce in the replacer or the dialog silently won't open.
 */
async function openDialog(
  context: ExtensionContext<"1.0.0">,
  entry: Entry,
): Promise<DialogResult> {
  const ctx = {
    entry,
    patternId: DEFAULT_PATTERN_ID,
    theme: "light",
    tempo: context.application.song.tempo,
  };
  const json = JSON.stringify(ctx, (_k, v) => (typeof v === "bigint" ? Number(v) : v));
  const html = __INTERFACE_HTML__.replace("__CTX_JSON__", () => json);
  const raw = await context.ui.showModalDialog(
    `data:text/html,${encodeURIComponent(html)}`,
    960,
    660,
  );
  return JSON.parse(raw) as DialogResult;
}

/** Replace a slot's clip with a fresh MIDI clip carrying the pattern's notes. */
async function writeToSlot(slot: ClipSlot<"1.0.0">, r: ApplyResult): Promise<void> {
  if (slot.clip !== null) await slot.deleteClip();
  const clip = await slot.createMidiClip(Math.max(BEATS_PER_BAR, r.lengthBeats));
  clip.notes = r.notes;
  clip.name = r.name;
}

/** Route an "apply" from the ClipSlot entry point to its chosen destination. */
async function applyFromSlot(
  context: ExtensionContext<"1.0.0">,
  slot: ClipSlot<"1.0.0">,
  r: ApplyResult,
): Promise<void> {
  if (r.target === "track") {
    const track = await context.application.song.createMidiTrack();
    const first = track.clipSlots[0];
    if (!first) throw new Error("the new track has no clip slots (no scenes?)");
    await writeToSlot(first, r);
    return;
  }
  if (r.target === "clip") {
    // Next empty slot on the clicked slot's own track; fall back to the slot.
    const parent = slot.parent;
    const track = parent ? context.getObjectFromHandle(parent.handle, MidiTrack) : null;
    const empty = track?.clipSlots.find((s) => s.clip === null);
    await writeToSlot(empty ?? slot, r);
    return;
  }
  await writeToSlot(slot, r); // "slot" (and any unexpected value): this slot
}

/** Minimal error modal — the SDK has no toast and an async rejection is
 * otherwise silent. Best-effort; the console.error at the call site stands. */
async function showError(context: ExtensionContext<"1.0.0">, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const esc = (s: string): string =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html =
    `<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px system-ui;` +
    `background:#fff;color:#111"><div style="padding:18px 20px">` +
    `<b>Pocket Operations couldn't apply</b><p style="color:#555;white-space:pre-wrap">${esc(message)}</p>` +
    `</div><div style="padding:10px 20px;text-align:right">` +
    `<button id="ok" autofocus style="font:inherit;padding:6px 14px">OK</button></div><script>` +
    `var s=function(){var m={method:"close_and_send",params:["ok"]};` +
    `if(window.webkit&&webkit.messageHandlers&&webkit.messageHandlers.live)webkit.messageHandlers.live.postMessage(m);` +
    `else if(window.chrome&&chrome.webview)chrome.webview.postMessage(m);};` +
    `document.getElementById("ok").onclick=s;onkeydown=function(e){if(e.key==="Enter"||e.key==="Escape")s();};</script>`;
  try {
    await context.ui.showModalDialog(`data:text/html,${encodeURIComponent(html)}`, 440, 190);
  } catch {
    /* even the error dialog failed to open */
  }
}

export function activate(activation: ActivationContext) {
  const context = initialize(activation, "1.0.0");
  console.info(`[${ID}] activate()`);

  // ClipSlot → open the dialog, then write to the chosen destination.
  context.commands.registerCommand(`${ID}.insert-slot`, (arg: unknown) => {
    void (async () => {
      try {
        const slot = context.getObjectFromHandle(arg as Handle, ClipSlot);
        const result = await openDialog(context, "slot");
        if (result.action === "apply") await applyFromSlot(context, slot, result);
      } catch (err) {
        console.error(`[${ID}] insert into slot failed:`, err);
        await showError(context, err);
      }
    })();
  });
  context.ui.registerContextMenuAction("ClipSlot", "Insert Drum Pattern", `${ID}.insert-slot`);

  // MidiClip → open the dialog, then replace the clicked clip's notes (one undo).
  context.commands.registerCommand(`${ID}.replace-clip`, (arg: unknown) => {
    void (async () => {
      try {
        const clip = context.getObjectFromHandle(arg as Handle, MidiClip);
        const result = await openDialog(context, "clip");
        if (result.action !== "apply") return;
        context.withinTransaction(() => {
          clip.notes = result.notes;
        });
        clip.name = result.name;
      } catch (err) {
        console.error(`[${ID}] replace clip failed:`, err);
        await showError(context, err);
      }
    })();
  });
  context.ui.registerContextMenuAction("MidiClip", "Replace with Drum Pattern", `${ID}.replace-clip`);
}
