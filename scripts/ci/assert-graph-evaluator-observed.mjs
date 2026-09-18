#!/usr/bin/env node
/**
 * OBSERVABILITY GUARD for `tools/graph-evaluator`.
 *
 * WHY THIS EXISTS. Until this commit the tool had **no CI execution at all**.
 * Both repo-root runner configs exclude `tools/graph-evaluator/**`
 * (STANDALONE_TOOL_EXCLUSIONS, vitest.shared.ts) as a PACKAGE BOUNDARY — the
 * tool has its own package.json, its own lockfile and its own runner, and
 * collecting it from the root configs throws ERR_MODULE_NOT_FOUND on its
 * tool-local imports. That exclusion is CORRECT and stays. What was missing is
 * the other half the configs' own comments promised: a dedicated job. So the
 * tool's prompt-composition pin — currently FAILING on thirteen source
 * hashes — has been failing where nobody could see it.
 *
 * The lesson that shaped this file: **a test job that silently collects zero
 * tests is worse than no job.** vitest exits 0 on "No test files found"; a
 * green step over an empty run is indistinguishable from a green step over a
 * passing run, and it would re-create the exact invisibility this job exists
 * to end. Every assertion below fails LOUD (non-zero exit) rather than
 * degrading to a pass.
 *
 * WHAT IT ASSERTS, in three groups:
 *
 *   A. PRECONDITIONS — the environment the numbers depend on. The tool is NOT
 *      self-contained: `src/governed-draft-graph.ts` reads repo-root `src/**`
 *      files and spawns the repo-root `node_modules/.bin/tsx` with
 *      `cwd: REPO_ROOT`. MEASURED: with the tool-local `npm ci` alone and NO
 *      repo-root install, `tests/governed-draft-graph.test.ts` reports
 *      15 failed instead of 1 — a different and much worse number, produced by
 *      a broken environment rather than by the product. A guard that did not
 *      pin its own precondition would ratchet that in as "the baseline".
 *
 *   B. OBSERVABILITY — the run happened and was not vacuous. The collected
 *      test-FILE count is compared against the files on disk (DERIVED, never a
 *      hand-kept number), so a silent collect shrink REDs instead of passing.
 *
 *   C. KNOWN-RED RATCHET — `scripts/ci/graph-evaluator-known-red.json` records
 *      the currently-failing files and counts EXACTLY, and fails in BOTH
 *      directions: a NEW failure REDs at once (this is how a fourteenth
 *      drifted prompt hash becomes loud), and a FIXED one REDs until its entry
 *      is removed, so the list can only shrink toward empty. When it is empty,
 *      drop `continue-on-error` from the two content steps in
 *      `.github/workflows/graph-evaluator.yml` and the job can be promoted to
 *      a required check. A blanket `continue-on-error` with no ratchet would
 *      have left every FUTURE drift exactly as silent as the thirteen hashes
 *      that prompted this work.
 *
 * No dependencies, no network; reads only committed state plus the two logs.
 */

import { readFileSync, existsSync, readdirSync, statSync, appendFileSync } from "node:fs";
import { join, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, "..", "..");
const TOOL_ROOT = join(REPO_ROOT, "tools", "graph-evaluator");
const BASELINE_PATH = join(HERE, "graph-evaluator-known-red.json");

/* ------------------------------------------------------------------ args -- */

function fatal(msg) {
  console.error(`\nGRAPH-EVALUATOR OBSERVABILITY GUARD - HARD FAIL\n  ${msg}\n`);
  process.exit(2);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  if (i < 0 || i + 1 >= process.argv.length) {
    fatal(
      `usage: assert-graph-evaluator-observed.mjs --tests-log <path> --typecheck-log <path> (missing ${name})`,
    );
  }
  return process.argv[i + 1];
}

const failures = [];
function bad(msg) {
  failures.push(msg);
}

/* ----------------------------------------------------------------- utils -- */

/** vitest and tsc both colour their output; every parse below reads plain text. */
const ANSI = new RegExp(String.fromCharCode(27) + "\\[[0-9;]*m", "g");

function readLog(path, label) {
  if (!existsSync(path)) {
    bad(
      `${label} log is MISSING at ${path} - the step never ran, or never wrote. A step that produces no log produces no evidence.`,
    );
    return null;
  }
  const raw = readFileSync(path, "utf8").replace(ANSI, "");
  if (raw.trim().length === 0) {
    bad(`${label} log at ${path} is EMPTY. An empty log is not a pass.`);
    return null;
  }
  return raw;
}

/** Every `*.test.ts` under the tool's tests/ dir - the runner's `include`. */
function testFilesOnDisk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) testFilesOnDisk(p, acc);
    else if (entry.endsWith(".test.ts")) acc.push(relative(TOOL_ROOT, p));
  }
  return acc;
}

/** `Tests  16 failed | 204 passed (220)` -> {failed, passed, skipped, todo, total} */
function parseSummaryLine(text, label) {
  const line = text
    .split("\n")
    .find((l) => new RegExp(`^\\s*${label}\\s{2,}\\d`).test(l));
  if (!line) return null;
  const counts = { failed: 0, passed: 0, skipped: 0, todo: 0 };
  for (const m of line.matchAll(/(\d+)\s+(failed|passed|skipped|todo)/g)) {
    counts[m[2]] = Number(m[1]);
  }
  const paren = line.match(/\((\d+)\)\s*$/);
  counts.total = paren
    ? Number(paren[1])
    : counts.failed + counts.passed + counts.skipped + counts.todo;
  return counts;
}

/** A per-file line such as `x tests/a.test.ts (17 tests | 15 failed)`. */
function parsePerFileFailures(text) {
  const out = {};
  const re = /^\s*\S\s+(tests\/[^\s(]+\.test\.ts)\s+\((\d+)\s+tests?\s*\|\s*(\d+)\s+failed/gm;
  for (const m of text.matchAll(re)) out[m[1]] = Number(m[3]);
  return out;
}

/** `src/foo.ts(169,12): error TS2367: ...` -> { "src/foo.ts": 2 } */
function parseTypecheckErrors(text) {
  const out = {};
  // `[^(\r\n]*` and NOT `[^(]*`: a negated class matches newlines too, so the
  // looser form swallowed npm's two banner lines into the first file's key and
  // would have committed `"> graph-evaluator@1.0.0 typecheck\n...src/e2e-..."`
  // as a baseline entry. Caught by the bite harness, not by inspection.
  for (const m of text.matchAll(/^([^\s(][^(\r\n]*)\((\d+),(\d+)\):\s+error\s+TS\d+/gm)) {
    const file = m[1].trim();
    out[file] = (out[file] ?? 0) + 1;
  }
  return out;
}

function sortedEntries(obj) {
  return Object.keys(obj)
    .sort()
    .map((k) => [k, obj[k]]);
}

function sameMap(a, b) {
  return JSON.stringify(sortedEntries(a)) === JSON.stringify(sortedEntries(b));
}

/* --------------------------------------------------- A. PRECONDITIONS ----- */

const testsLogPath = arg("--tests-log");
const typecheckLogPath = arg("--typecheck-log");

// The tool's governed suite reaches OUT of the package: it reads repo-root
// `src/**` and spawns the repo-root tsx with `cwd: REPO_ROOT`. Without the
// product install those tests fail for an ENVIRONMENT reason, and the counts
// below would be measuring the CI job rather than the product.
const PRECONDITIONS = [
  [
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    "repo-root `node_modules/.bin/tsx` (spawned by tools/graph-evaluator/src/governed-draft-graph.ts with cwd: REPO_ROOT)",
  ],
  [
    join(REPO_ROOT, "node_modules", "@talchain", "schemas", "package.json"),
    "repo-root `@talchain/schemas` (reached through repo src/schemas/graph.ts during governed baseline validation)",
  ],
  [
    join(TOOL_ROOT, "node_modules", ".bin", "vitest"),
    "tool-local test runner (tools/graph-evaluator/node_modules)",
  ],
];
for (const [path, what] of PRECONDITIONS) {
  if (!existsSync(path)) {
    bad(
      `PRECONDITION MISSING: ${what} - expected at ${path}. The tool is NOT self-contained; without this the suite fails for an environment reason and any count taken here is void.`,
    );
  }
}

/* --------------------------------------------------- B. OBSERVABILITY ----- */

const testsLog = readLog(testsLogPath, "tests");
const typecheckLog = readLog(typecheckLogPath, "typecheck");

let observedTests = null;
let observedFiles = null;
let observedPerFile = {};

if (testsLog) {
  if (/No test files found/i.test(testsLog)) {
    bad(
      'tests log contains "No test files found" - vitest exits 0 on this. That is the exact vacuous green this guard exists to prevent.',
    );
  }
  observedFiles = parseSummaryLine(testsLog, "Test Files");
  observedTests = parseSummaryLine(testsLog, "Tests");
  if (!observedFiles) {
    bad(
      "tests log has NO `Test Files` summary line - the runner did not reach its summary (crash, OOM, or a reporter change).",
    );
  }
  if (!observedTests) {
    bad(
      "tests log has NO `Tests` summary line - the runner did not reach its summary (crash, OOM, or a reporter change).",
    );
  }
  if (observedTests && observedTests.total === 0) {
    bad("`Tests` summary line reports a ZERO collected count. Zero collected is a HARD ERROR, never a pass.");
  }
  if (observedFiles && observedFiles.total === 0) {
    bad("`Test Files` summary line reports ZERO collected files.");
  }

  // DERIVED completeness - never a hand-kept number. A spec that stops being
  // collected (a rename, a broken import, a stray `include` edit) is invisible
  // to every aggregate; this is the only assertion here that can see it.
  const onDisk = testFilesOnDisk(join(TOOL_ROOT, "tests"));
  if (onDisk.length === 0) {
    bad(
      "BLINDED: zero `*.test.ts` files found on disk under tools/graph-evaluator/tests - the derivation itself is broken.",
    );
  }
  if (observedFiles && onDisk.length > 0 && observedFiles.total !== onDisk.length) {
    bad(
      `COLLECT SHRINK: the runner collected ${observedFiles.total} test file(s) but ${onDisk.length} exist on disk ` +
        "(tools/graph-evaluator/tests/**/*.test.ts). A file that stops being collected contributes nothing and reddens nothing.",
    );
  }
  observedPerFile = parsePerFileFailures(testsLog);
}

const observedTypecheck = typecheckLog ? parseTypecheckErrors(typecheckLog) : {};

function reportFailuresAndExit() {
  console.error("\nGRAPH-EVALUATOR OBSERVABILITY GUARD - FAILED:\n");
  for (const f of failures) console.error("  [x] " + f);
  console.error("");
  process.exit(1);
}

// A broken instrument may not seed a baseline and may not be compared against
// one: both would ratchet in a number that measures the CI job rather than the
// product. Stop here, loudly, before either can happen.
if (failures.length > 0) reportFailuresAndExit();

/* ------------------------------------------------- C. KNOWN-RED RATCHET --- */

const observedBlock = {
  $comment:
    "SHRINK-ONLY RATCHET, measured in CI (never locally - the tool's governed suite depends on the repo-root install). " +
    "Every entry is a KNOWN failure that predates this CI job; the job is advisory only while this file is non-empty. " +
    "Fails in BOTH directions: a new failure REDs at once, a fixed one REDs until its entry is removed. " +
    "When both maps are empty, drop `continue-on-error` from .github/workflows/graph-evaluator.yml and promote the job to a required check.",
  measuredAt: process.env.GITHUB_SHA ?? "UNRECORDED",
  measuredAtNote:
    "GITHUB_SHA. On a pull_request event this is the EPHEMERAL MERGE COMMIT, not the PR head - use measuredIn (the run id) for provenance.",
  measuredIn: process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_REPOSITORY} run ${process.env.GITHUB_RUN_ID}`
    : "UNRECORDED",
  minPassingTests: observedTests ? observedTests.passed : 0,
  knownRedTestFiles: Object.fromEntries(sortedEntries(observedPerFile)),
  knownRedTypecheckFiles: Object.fromEntries(sortedEntries(observedTypecheck)),
};

if (!existsSync(BASELINE_PATH)) {
  console.error(
    "\nGRAPH-EVALUATOR KNOWN-RED BASELINE IS NOT SEEDED.\n\n" +
      "This is deliberate on the first run: the baseline may only be taken from CI, because the\n" +
      "tool's governed suite depends on the repo-root install and a local measurement produces a\n" +
      "different (worse) number. Commit the block below as scripts/ci/graph-evaluator-known-red.json\n" +
      "and push again.\n\n" +
      JSON.stringify(observedBlock, null, 2) +
      "\n",
  );
  process.exit(1);
}

let baseline = null;
try {
  baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
} catch (e) {
  fatal(`baseline ${BASELINE_PATH} is not readable JSON: ${e.message}`);
}

if (!sameMap(observedPerFile, baseline.knownRedTestFiles ?? {})) {
  bad(
    "TEST FAILURE SET DRIFTED from scripts/ci/graph-evaluator-known-red.json.\n" +
      `    observed: ${JSON.stringify(Object.fromEntries(sortedEntries(observedPerFile)))}\n` +
      `    baseline: ${JSON.stringify(Object.fromEntries(sortedEntries(baseline.knownRedTestFiles ?? {})))}\n` +
      "    A NEW or GROWN failure is a real regression - fix it. A SHRUNK or GONE failure means the\n" +
      "    ratchet is stale - remove the entry in the same commit as the fix. The list only shrinks.",
  );
}
if (!sameMap(observedTypecheck, baseline.knownRedTypecheckFiles ?? {})) {
  bad(
    "TYPECHECK ERROR SET DRIFTED from scripts/ci/graph-evaluator-known-red.json.\n" +
      `    observed: ${JSON.stringify(Object.fromEntries(sortedEntries(observedTypecheck)))}\n` +
      `    baseline: ${JSON.stringify(Object.fromEntries(sortedEntries(baseline.knownRedTypecheckFiles ?? {})))}`,
  );
}
// Asymmetric on purpose: adding tests is welcome, LOSING them is not.
const floor = Number(baseline.minPassingTests ?? 0);
if (observedTests && observedTests.passed < floor) {
  bad(
    `PASSING-TEST COUNT SHRANK: ${observedTests.passed} passed, baseline floor is ${floor}. ` +
      "Tests disappearing is the failure mode a green total cannot show.",
  );
}

/* ----------------------------------------------------------- report ------- */

const redTestFiles = Object.keys(observedPerFile).length;
const redTypecheckFiles = Object.keys(observedTypecheck).length;
const verdict =
  failures.length > 0
    ? "**GUARD FAILED - see the job log.**"
    : redTestFiles + redTypecheckFiles === 0
      ? "**GREEN and the ratchet is empty - remove `continue-on-error` from this workflow and promote the job to a required check.**"
      : "**OBSERVED. Content sits at its recorded known-red baseline, so this advisory job does not fail.** Any change to that baseline, in either direction, REDs this job.";

const report = [
  "### tools/graph-evaluator - advisory run",
  "",
  `- Test files collected: **${observedFiles ? observedFiles.total : "?"}**`,
  `- Tests: **${observedTests ? `${observedTests.failed} failed, ${observedTests.passed} passed (${observedTests.total})` : "?"}**`,
  `- Failing test files (known-red): ${redTestFiles === 0 ? "**none**" : "`" + Object.keys(observedPerFile).sort().join("`, `") + "`"}`,
  `- Typecheck error files (known-red): ${redTypecheckFiles === 0 ? "**none**" : "`" + Object.keys(observedTypecheck).sort().join("`, `") + "`"}`,
  "",
  verdict,
].join("\n");

console.log("\n" + report + "\n");
if (process.env.GITHUB_STEP_SUMMARY) {
  try {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, report + "\n");
  } catch {
    /* the summary is a convenience, never the evidence */
  }
}

if (failures.length > 0) reportFailuresAndExit();

if (redTestFiles + redTypecheckFiles > 0) {
  console.log(
    `::warning title=tools/graph-evaluator is standing-red::${redTestFiles} test file(s) and ${redTypecheckFiles} typecheck file(s) fail at their recorded baseline. Advisory, not blocking. Shrink scripts/ci/graph-evaluator-known-red.json as they are fixed.`,
  );
}
process.exit(0);
