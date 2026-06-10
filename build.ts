// Bundle src/extension.ts → one Node CJS file for the Extension Host (it does
// not resolve node_modules at runtime). No webview yet — the UI ships in a later
// phase, once the Pencil design lands. The bundled data/patterns.json is inlined
// by esbuild via the JSON loader, so the .ablx stays self-contained.
import * as esbuild from "esbuild";
import * as fs from "node:fs";

const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const production = process.argv.includes("--production");

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
  loader: { ".json": "json" },
});
