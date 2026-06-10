// Pocket Operations — drop classic drum-machine patterns onto a Drum Rack track.
//
// P2 (host wiring, no UI yet): two right-click actions prove the output path
// end to end. The browsable picker + grid editor arrive in a later phase once
// the Pencil design lands; for now a default pattern is used.
//
//   - ClipSlot → "Insert Drum Pattern": create a one-bar MIDI clip in the
//     clicked Session slot and fill it with the pattern's notes.
//   - MidiClip → "Replace with Drum Pattern": overwrite the clicked clip's
//     notes (single undo step).
//
// Pattern data + note rendering live in ./patternbank and ./grid (pure,
// unit-tested, SDK-free); this file is host glue only.
import {
  initialize,
  ClipSlot,
  MidiClip,
  type ActivationContext,
  type ExtensionContext,
  type Handle,
} from "@ableton-extensions/sdk";
import { BEATS_PER_BAR, gridToNotes, type Note } from "./grid.js";
import { byId, patterns, toStepGrid, type Pattern } from "./patternbank.js";
import type { MappingId } from "./mapping.js";

const ID = "pocket-operations";

// The default pattern used until the picker UI exists. BOOTS N' CATS is the
// canonical four-on-the-floor demo; fall back to the first pattern if the data
// is ever renamed.
const DEFAULT_PATTERN_ID = "basic-patterns--boots-n-cats";
const DEFAULT_MAPPING: MappingId = "po";

function defaultPattern(): Pattern {
  return byId(DEFAULT_PATTERN_ID) ?? patterns()[0]!;
}

function patternNotes(p: Pattern, mapping: MappingId): Note[] {
  return gridToNotes(toStepGrid(p), { mapping });
}

/**
 * Insert a pattern into a Session clip slot as a fresh one-bar MIDI clip. If the
 * slot is occupied we replace its clip (the action reads as "put a pattern
 * here"). Clip creation is async, so this runs outside withinTransaction (which
 * is sync-only); creation + note-fill is still atomic from the user's view.
 */
async function insertIntoSlot(
  slot: ClipSlot<"1.0.0">,
  p: Pattern,
  mapping: MappingId,
): Promise<void> {
  if (slot.clip !== null) await slot.deleteClip();
  const clip = await slot.createMidiClip(BEATS_PER_BAR);
  clip.notes = patternNotes(p, mapping);
  clip.name = p.name + (p.variant ? ` - ${p.variant}` : "");
}

/** Minimal error modal — SDK 1.0.0 has no toast, and an async rejection is
 * otherwise silent. Best-effort; the console.error at the call site stands. */
async function showError(context: ExtensionContext<"1.0.0">, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const esc = (s: string): string =>
    s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
  const html =
    `<!doctype html><meta charset="utf-8"><body style="margin:0;font:13px system-ui;` +
    `background:#161616;color:#eee"><div style="padding:18px 20px">` +
    `<b>Pocket Operations couldn't insert</b><p style="color:#ccc;white-space:pre-wrap">${esc(message)}</p>` +
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
  console.info(`[${ID}] activate() — ${patterns().length} patterns loaded`);

  // Insert the default pattern into the clicked Session clip slot.
  context.commands.registerCommand(`${ID}.insert-slot`, (arg: unknown) => {
    void (async () => {
      try {
        const slot = context.getObjectFromHandle(arg as Handle, ClipSlot);
        await insertIntoSlot(slot, defaultPattern(), DEFAULT_MAPPING);
      } catch (err) {
        console.error(`[${ID}] insert into slot failed:`, err);
        await showError(context, err);
      }
    })();
  });
  context.ui.registerContextMenuAction("ClipSlot", "Insert Drum Pattern", `${ID}.insert-slot`);

  // Replace the clicked MIDI clip's notes with the default pattern (one undo).
  context.commands.registerCommand(`${ID}.replace-clip`, (arg: unknown) => {
    try {
      const clip = context.getObjectFromHandle(arg as Handle, MidiClip);
      const next = patternNotes(defaultPattern(), DEFAULT_MAPPING);
      context.withinTransaction(() => {
        clip.notes = next;
      });
    } catch (err) {
      console.error(`[${ID}] replace clip failed:`, err);
      void showError(context, err);
    }
  });
  context.ui.registerContextMenuAction("MidiClip", "Replace with Drum Pattern", `${ID}.replace-clip`);
}
