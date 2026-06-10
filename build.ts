// Two-stage build:
//   1. Bundle the webview UI (src/webview/main.ts) for the browser. The pattern
//      library (data/patterns.json) is pulled in transitively via patternbank
//      and inlined by esbuild's JSON loader, so browsing/filtering is fully
//      client-side — no host round-trips.
//   2. Inline that JS into the dialog HTML template (src/webview/interface.html).
//   3. Bundle the extension (src/extension.ts) for Node, inlining the assembled
//      HTML as the __INTERFACE_HTML__ constant so the .ablx stays one file.
import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

// 1. webview UI → browser JS string
const ui = await esbuild.build({
  entryPoints: ["src/webview/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  write: false,
  minify: production,
  sourcemap: false,
  logLevel: "info",
  loader: { ".json": "json" },
});
const uiJs = ui.outputFiles[0]!.text;

// 2. inline the UI bundle into the dialog HTML (function replacer avoids
//    `$&`-style special patterns in the bundled JS being interpreted)
const template = fs.readFileSync("src/webview/interface.html", "utf8");
const html = template.replace("/*__UI_BUNDLE__*/", () => uiJs);

// 3. extension → Node CJS, with the assembled HTML inlined as a constant
await esbuild.build({
  entryPoints: ["src/extension.ts"],
  outfile: manifest.entry,
  bundle: true,
  format: "cjs",
  platform: "node",
  sourcesContent: false,
  logLevel: "info",
  minify: production,
  sourcemap: !production,
  loader: { ".json": "json", ".html": "text" },
  define: { __INTERFACE_HTML__: JSON.stringify(html) },
});
