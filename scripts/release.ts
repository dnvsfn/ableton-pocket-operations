// One-command release pipeline for Pocket Operations.
//
//   npm run release            # bump patch (0.1.0 -> 0.1.1)
//   npm run release -- minor   # 0.1.0 -> 0.2.0
//   npm run release -- major   # 0.1.0 -> 1.0.0
//   npm run release -- 1.2.0   # explicit version
//   npm run release -- --dry-run [bump]   # gates + build only, no writes
//   npm run changelog [-- bump]           # print the notes only — no git/build/gh
//
// It guards the working state, runs the quality gates, syncs the version across
// package.json + manifest.json, promotes CHANGELOG.md's [Unreleased] section to
// the new version, packages the .ablx, then commits, tags, pushes, and publishes
// a GitHub Release whose notes come from that changelog section (not the raw
// commit list). The proprietary SDK (vendor/*.tgz) lives only on the dev's
// machine, so this is the one place a real build happens — CI just runs the tests.
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const REPO = "https://github.com/dnvsfn/ableton-pocket-operations";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const bump = args.find((a) => !a.startsWith("--")) ?? "patch";

const C = { dim: "\x1b[2m", red: "\x1b[31m", green: "\x1b[32m", cyan: "\x1b[36m", bold: "\x1b[1m", reset: "\x1b[0m" };
const step = (m: string) => console.log(`${C.cyan}▶${C.reset} ${C.bold}${m}${C.reset}`);
const info = (m: string) => console.log(`  ${C.dim}${m}${C.reset}`);
const ok = (m: string) => console.log(`  ${C.green}✓${C.reset} ${m}`);
function die(m: string): never {
  console.error(`${C.red}✗ ${m}${C.reset}`);
  process.exit(1);
}

/** Run a command, inheriting stdio (output is shown). Dies on non-zero exit. */
function run(cmd: string): void {
  info(`$ ${cmd}`);
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    die(`command failed: ${cmd}`);
  }
}
/** Run a command and capture trimmed stdout (no inherited output). */
function capture(cmd: string): string {
  return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
}
function tryCapture(cmd: string): string | null {
  try {
    return capture(cmd);
  } catch {
    return null;
  }
}

/** Bump a semver string by patch/minor/major, or accept an explicit x.y.z. */
function nextVersion(current: string, how: string): string {
  if (/^\d+\.\d+\.\d+$/.test(how)) return how;
  const [maj, min, pat] = current.split(".").map((n) => parseInt(n, 10));
  if (how === "major") return `${maj! + 1}.0.0`;
  if (how === "minor") return `${maj!}.${min! + 1}.0`;
  if (how === "patch") return `${maj!}.${min!}.${pat! + 1}`;
  die(`unknown bump "${how}" — use patch | minor | major | x.y.z`);
}

const CHANGELOG = "CHANGELOG.md";
const today = (): string => new Date().toISOString().slice(0, 10);
/** Body of the CHANGELOG's [Unreleased] section, trimmed. */
function unreleasedNotes(md: string): string {
  const m = md.match(/## \[Unreleased\][^\n]*\n([\s\S]*?)(?=\n## \[|\n\[Unreleased\]:)/);
  return (m?.[1] ?? "").trim();
}
/** Promote [Unreleased] -> [ver] - date, refreshing the compare links. */
function promoteChangelog(md: string, ver: string, prev: string, tg: string, date: string): string {
  return md
    .replace(/^## \[Unreleased\][^\n]*\n/m, `## [Unreleased]\n\n## [${ver}] - ${date}\n`)
    .replace(/^\[Unreleased\]:.*$/m, `[Unreleased]: ${REPO}/compare/${tg}...HEAD`)
    .replace(/^(\[Unreleased\]:.*\n)/m, `$1[${ver}]: ${REPO}/compare/v${prev}...${tg}\n`);
}

// --- Preview (no git / build / gh; safe on a dirty tree) --------------------
// `npm run changelog [-- minor|major|x.y.z]` — print the notes that would be
// published, then exit. Touches nothing.
if (args.includes("--preview")) {
  if (!fs.existsSync(CHANGELOG)) die("CHANGELOG.md missing");
  const cur = JSON.parse(fs.readFileSync("package.json", "utf8")).version as string;
  const ver = nextVersion(cur, bump);
  const md = fs.readFileSync(CHANGELOG, "utf8");
  const n = unreleasedNotes(md);
  if (!n) die("CHANGELOG.md [Unreleased] is empty — nothing to preview");
  console.log(
    `${C.dim}Would release ${cur} → ${C.bold}${ver}${C.reset}${C.dim} as ${C.bold}v${ver} - ${today()}${C.reset}`,
  );
  console.log(`\n${C.dim}--- GitHub Release notes (CHANGELOG.md [Unreleased]) ---${C.reset}\n${n}\n`);
  process.exit(0);
}

// --- Preconditions ----------------------------------------------------------
step("Checking preconditions");
const branch = capture("git rev-parse --abbrev-ref HEAD");
if (branch !== "main") die(`must release from main (on "${branch}")`);
if (capture("git status --porcelain")) die("working tree is dirty — commit or stash first");
if (!fs.existsSync("vendor")) die("vendor/ (proprietary SDK + CLI) missing — can't package; see README 'Getting the SDK'");
if (!tryCapture("gh auth status")) die("GitHub CLI not authenticated — run `gh auth login`");
ok(`on main, clean tree, vendor present, gh authed`);

const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
const version = nextVersion(pkg.version, bump);
const tag = `v${version}`;
if (tryCapture(`git rev-parse -q --verify refs/tags/${tag}`)) die(`tag ${tag} already exists`);
info(`current ${pkg.version} → ${C.bold}${version}${C.reset}${C.dim} (${tag})`);

// --- Changelog notes --------------------------------------------------------
step("Reading CHANGELOG.md");
if (!fs.existsSync(CHANGELOG))
  die("CHANGELOG.md missing — create it (Keep a Changelog format) before releasing");
const prevVersion: string = pkg.version;
const changelogOrig = fs.readFileSync(CHANGELOG, "utf8");
const notes = unreleasedNotes(changelogOrig);
if (!notes) die("CHANGELOG.md [Unreleased] section is empty — add notes there before releasing");
ok(`release notes ready (${notes.split("\n").filter((l) => l.startsWith("- ")).length} entries)`);

// --- Quality gates ----------------------------------------------------------
step("Running quality gates (typecheck + tests)");
run("npm run typecheck");
run("npm test");
ok("typecheck + tests pass");

if (dryRun) {
  step("Dry run — building without publishing");
  run("npm run build");
  console.log(`\n${C.dim}--- release notes (from CHANGELOG.md [Unreleased]) ---${C.reset}\n${notes}`);
  console.log(`\n${C.green}${C.bold}Dry run OK.${C.reset} Would release ${C.bold}${tag}${C.reset}: promote CHANGELOG, bump versions, package .ablx, commit, tag, push, gh release.`);
  process.exit(0);
}

// --- Version sync -----------------------------------------------------------
step(`Syncing version to ${version}`);
pkg.version = version;
manifest.version = version;
fs.writeFileSync("package.json", JSON.stringify(pkg, null, 2) + "\n");
fs.writeFileSync("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
run("npm install --package-lock-only"); // refresh the lockfile's version

// Promote [Unreleased] -> [version] - <date>, leaving a fresh empty [Unreleased].
fs.writeFileSync(CHANGELOG, promoteChangelog(changelogOrig, version, prevVersion, tag, today()));
ok("package.json + manifest.json + lockfile + CHANGELOG.md updated");

// --- Package ----------------------------------------------------------------
step("Packaging .ablx");
run("npm run package");
const ablx = fs
  .readdirSync(".")
  .filter((f) => f.endsWith(".ablx"))
  .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
  .sort((a, b) => b.t - a.t)[0]?.f;
if (!ablx) die("no .ablx produced");
ok(`built ${ablx}`);

// --- Commit, tag, push ------------------------------------------------------
step("Committing, tagging, pushing");
run("git add package.json manifest.json package-lock.json CHANGELOG.md");
if (capture("git diff --cached --name-only")) {
  run(`git commit -m "release: ${tag}"`);
} else {
  info("version unchanged — tagging the current HEAD"); // e.g. the first release at the current version
}
run(`git tag -a ${tag} -m "${manifest.name} ${tag}"`);
run("git push origin main");
run(`git push origin ${tag}`);
ok(`pushed ${tag}`);

// --- GitHub Release ---------------------------------------------------------
step("Publishing GitHub Release");
const title = `${manifest.name} ${tag}`;
const notesFile = path.join(os.tmpdir(), `pocket-ops-release-notes-${version}.md`);
fs.writeFileSync(notesFile, notes + "\n");
run(`gh release create ${tag} "${ablx}" --title "${title}" --notes-file "${notesFile}"`);
fs.rmSync(notesFile, { force: true });
fs.rmSync(ablx, { force: true }); // tidy the gitignored artifact now it's uploaded
ok("release published");

console.log(`\n${C.green}${C.bold}Released ${tag}${C.reset} → ${capture("gh repo view --json url -q .url")}/releases/tag/${tag}`);
