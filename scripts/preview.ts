// Assemble the dialog HTML the way build.ts does (webview bundle → interface.html)
// but inject a sample __CTX__ and write a standalone file to /tmp, so the UI can
// be opened in a browser / Chrome DevTools for visual verification against the
// Pencil design without needing Live. Not part of the shipped build.
//
//   npx tsx scripts/preview.ts [slot|clip] [light|dark]  → prints the file path
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const entry = process.argv[2] === "clip" ? "clip" : "slot";
const theme = process.argv[3] === "dark" ? "dark" : "light";

const ui = await esbuild.build({
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  logLevel: "error",
  loader: { ".json": "json" },
});
const uiJs = ui.outputFiles[0]!.text;

const ctx = { entry, theme, patternId: "hip-hop--planet-rock", tempo: 120 };
const html = fs
  .readFileSync("src/webview/interface.html", "utf8")
  .replace("/*__UI_BUNDLE__*/", () => uiJs)
  .replace("__CTX_JSON__", () => JSON.stringify(ctx));

const out = path.join(os.tmpdir(), `po-preview-${entry}-${theme}.html`);
fs.writeFileSync(out, html);
console.log(out);
