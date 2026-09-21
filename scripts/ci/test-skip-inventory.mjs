#!/usr/bin/env node
/**
 * Test-skip inventory gate (O-6) — replaces the old grep in
 * .github/workflows/test-skip-guard.yml.
 *
 * WHY: the old guard grepped only `tests/` for the literal `.skip(`. It could
 * not see:
 *   - `src/(and sdk/, tools/, scripts/) test roots at all (~500 test files);
 *   - `it.todo(...)` / `describe.todo(...)`;
 *   - `describe.skipIf(...)` / `describe.runIf(...)` (runtime-conditional);
 *   - `const suite = ready ? describe : describe.skip` (no `(` after skip —
 *     the exact pattern used by 11 Supabase-gated integration files);
 *   - options-form `it("...", { skip: cond }, fn)`;
 *   - `xit` / `xdescribe` / `xtest` aliases.
 *
 * WHAT: a TypeScript-AST scan of EVERY tracked test file, compared against a
 * committed per-file inventory (test-skip-inventory.json) that must match
 * EXACTLY in both directions:
 *   - occurrences grow, or a new file gains any skip construct → RED
 *     (add/adjust the inventory entry, with a non-empty reason, in the same
 *     reviewed PR — never a silent join);
 *   - occurrences shrink, or an inventoried file disappears → RED (shrink the
 *     inventory in the same PR — never a stale entry);
 *   - any inventory entry with an empty/missing reason → RED.
 * The inventory is the ratchet baseline: the intended direction is DOWN.
 *
 * POSITIVE CONTROL: before making any claim, the scanner parses an inline
 * fixture containing one of each construct and asserts the exact expected
 * counts. If the scanner ever goes blind, the run fails with exit 2 rather
 * than passing vacuously.
 *
 * Modes:
 *   node scripts/ci/test-skip-inventory.mjs           # check (CI gate)
 *   node scripts/ci/test-skip-inventory.mjs --write   # regenerate inventory
 *       (preserves existing reasons; new entries get a draft reason from the
 *        nearest comment/title and MUST be reviewed — empty reasons fail).
 *
 * Exit codes: 0 = clean · 1 = drift/violation · 2 = scanner self-test failure.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const REPO_ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const INVENTORY_PATH = join(REPO_ROOT, "scripts", "ci", "test-skip-inventory.json");

/** Test-runner roots whose property accesses count. */
const TEST_FNS = new Set(["describe", "it", "test", "suite", "bench"]);
/** Property names that mark a skipped/deferred/conditional test. */
const MARKER_PROPS = new Set(["skip", "todo", "skipIf", "runIf"]);
/** Bare aliases that skip without any property access. */
const X_ALIASES = new Set(["xit", "xdescribe", "xtest", "xspecify"]);

const CATEGORIES = ["skip", "todo", "skipIf", "runIf", "optionsSkip"];

/** Leftmost identifier of a property/call chain (`it.skip.each` → `it`). */
function chainRoot(node) {
  let cur = node;
  while (
    ts.isPropertyAccessExpression(cur) ||
    ts.isCallExpression(cur) ||
    ts.isNonNullExpression(cur) ||
    ts.isParenthesizedExpression(cur)
  ) {
    cur = ts.isPropertyAccessExpression(cur) ? cur.expression : cur.expression;
  }
  return ts.isIdentifier(cur) ? cur.text : null;
}

/**
 * Scan one source text. Returns { skip, todo, skipIf, runIf, optionsSkip }.
 */
export function scanSource(fileName, sourceText) {
  const counts = { skip: 0, todo: 0, skipIf: 0, runIf: 0, optionsSkip: 0 };
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, kind);

  const visit = (node) => {
    // it.skip / describe.todo / test.skipIf / describe.runIf — counted whether
    // or not they are CALLED (the `ready ? describe : describe.skip` ternary
    // has no call parens; the old grep missed it).
    if (
      ts.isPropertyAccessExpression(node) &&
      MARKER_PROPS.has(node.name.text) &&
      TEST_FNS.has(chainRoot(node.expression))
    ) {
      counts[node.name.text] += 1;
    }

    // xit(...) / xdescribe(...) aliases → skip.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      X_ALIASES.has(node.expression.text)
    ) {
      counts.skip += 1;
    }

    // Options form: it("name", { skip: cond, ... }, fn) — the object literal
    // must be argument index 1 with a later function argument, so data-shaped
    // `{ skip: ... }` fixtures elsewhere in the call do not false-positive.
    if (
      ts.isCallExpression(node) &&
      TEST_FNS.has(chainRoot(node.expression)) &&
      node.arguments.length >= 3 &&
      ts.isObjectLiteralExpression(node.arguments[1]) &&
      (ts.isArrowFunction(node.arguments[2]) || ts.isFunctionExpression(node.arguments[2]))
    ) {
      const hasSkipProp = node.arguments[1].properties.some(
        (p) =>
          (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
          ts.isIdentifier(p.name) &&
          (p.name.text === "skip" || p.name.text === "todo"),
      );
      if (hasSkipProp) counts.optionsSkip += 1;
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return counts;
}

// ── Scanner self-test (positive control) ─────────────────────────────────────
function selfTest() {
  const fixture = `
    describe.skip("dead suite", () => {});
    it.todo("write this");
    describe.skipIf(!process.env.X)("gated", () => {});
    describe.runIf(ready)("gated too", () => {});
    const suite = ready ? describe : describe.skip; // ternary, no call parens
    xit("aliased skip", () => {});
    it("options form", { timeout: 5, skip: !!reason }, async () => {});
    // Negative space: none of these may count —
    const data = { skip: true }; // data-shaped object, not an options arg
    foo.skip("not a test fn");
    it("plain test", () => {});
  `;
  const got = scanSource("fixture.ts", fixture);
  const want = { skip: 3, todo: 1, skipIf: 1, runIf: 1, optionsSkip: 1 };
  const ok = CATEGORIES.every((c) => got[c] === want[c]);
  if (!ok) {
    console.error(
      `SELF-TEST FAILED — scanner is blind or over-counting.\n` +
        `  expected ${JSON.stringify(want)}\n  got      ${JSON.stringify(got)}\n` +
        `A guard that cannot see its target proves nothing; refusing to run.`,
    );
    process.exit(2);
  }
}

// ── File enumeration: every tracked test file, all roots ─────────────────────
function listTestFiles() {
  const out = execFileSync(
    "git",
    [
      "ls-files",
      "*.test.ts",
      "*.test.tsx",
      "*.test.js",
      "*.test.mjs",
      "*.spec.ts",
      "*.spec.js",
    ],
    { encoding: "utf8", cwd: REPO_ROOT },
  );
  return out.split("\n").filter(Boolean).sort();
}

/** Draft reason for --write: nearest preceding comment or skipped title. */
function draftReason(sourceText) {
  const m =
    sourceText.match(/\/\/\s*(TODO[^\n]*|QUARANTINED[^\n]*|[^\n]*skip[^\n]*)/i) ||
    sourceText.match(/\.(?:skip|todo)\(\s*["'`]([^"'`\n]{5,120})/);
  return m ? m[1].trim().slice(0, 160) : "";
}

function main() {
  selfTest();

  const files = listTestFiles();
  if (files.length < 500) {
    // The enumeration itself needs a floor: this repo has ~1,370 tracked test
    // files. A near-empty listing means git/cwd broke, not that skips vanished.
    console.error(
      `SELF-TEST FAILED — only ${files.length} test files enumerated; ` +
        `expected well over 500. Refusing to make absence claims.`,
    );
    process.exit(2);
  }

  const actual = {};
  for (const f of files) {
    const counts = scanSource(f, readFileSync(join(REPO_ROOT, f), "utf8"));
    if (CATEGORIES.some((c) => counts[c] > 0)) {
      const entry = {};
      for (const c of CATEGORIES) if (counts[c] > 0) entry[c] = counts[c];
      actual[f] = entry;
    }
  }

  if (process.argv.includes("--write")) {
    let existing = { files: {} };
    try {
      existing = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
    } catch {
      /* first run */
    }
    const filesOut = {};
    for (const [f, entry] of Object.entries(actual)) {
      const prior = existing.files?.[f];
      filesOut[f] = {
        ...entry,
        reason:
          prior?.reason ||
          draftReason(readFileSync(join(REPO_ROOT, f), "utf8")) ||
          "",
      };
    }
    const doc = {
      $comment:
        "Per-file inventory of test-skip constructs (see scripts/ci/test-skip-inventory.mjs). " +
        "Counts must match the AST scan EXACTLY (growth and staleness both fail) and every " +
        "entry needs a non-empty reason. Regenerate with --write; the ratchet direction is DOWN.",
      files: filesOut,
    };
    writeFileSync(INVENTORY_PATH, JSON.stringify(doc, null, 2) + "\n");
    console.log(`Wrote ${Object.keys(filesOut).length} entries to ${INVENTORY_PATH}`);
    const empty = Object.entries(filesOut).filter(([, e]) => !e.reason);
    if (empty.length) {
      console.log(`NOTE: ${empty.length} entries have EMPTY reasons — fill them or the check fails:`);
      for (const [f] of empty) console.log(`  - ${f}`);
    }
    return;
  }

  // ── Check mode ────────────────────────────────────────────────────────────
  let inventory;
  try {
    inventory = JSON.parse(readFileSync(INVENTORY_PATH, "utf8"));
  } catch (e) {
    console.error(`Cannot read inventory at ${INVENTORY_PATH}: ${e.message}`);
    process.exit(1);
  }
  const baseline = inventory.files ?? {};
  const problems = [];

  for (const [f, entry] of Object.entries(actual)) {
    const base = baseline[f];
    if (!base) {
      problems.push(
        `NEW: ${f} has ${JSON.stringify(entry)} but no inventory entry. ` +
          `Un-skip it, or add an entry WITH a reason (reviewed, never silent).`,
      );
      continue;
    }
    for (const c of CATEGORIES) {
      const a = entry[c] ?? 0;
      const b = base[c] ?? 0;
      if (a > b) problems.push(`GROWTH: ${f} ${c} ${b} → ${a}. Un-skip, or update the inventory with a reason.`);
      if (a < b) problems.push(`STALE: ${f} ${c} ${b} → ${a}. Shrink the inventory entry (ratchet down).`);
    }
  }
  for (const [f, base] of Object.entries(baseline)) {
    if (!actual[f]) {
      problems.push(`STALE: ${f} is inventoried (${JSON.stringify(base)}) but has no skip constructs (or no longer exists). Remove the entry.`);
    }
    if (typeof base.reason !== "string" || base.reason.trim() === "") {
      problems.push(`NO REASON: ${f} inventory entry must carry a non-empty reason.`);
    }
  }

  const totals = {};
  for (const c of CATEGORIES) totals[c] = Object.values(actual).reduce((s, e) => s + (e[c] ?? 0), 0);
  console.log(
    `Scanned ${files.length} test files; ${Object.keys(actual).length} carry skip constructs. ` +
      `Totals: ${CATEGORIES.map((c) => `${c}=${totals[c]}`).join(" ")}`,
  );

  if (problems.length) {
    console.error(`\n❌ Test-skip inventory drift (${problems.length} problem(s)):`);
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      `\nFix the tests, or regenerate with \`node scripts/ci/test-skip-inventory.mjs --write\` ` +
        `and fill in reasons — the diff is the review surface.`,
    );
    process.exit(1);
  }
  console.log("✅ Inventory matches exactly and every entry carries a reason.");
}

main();
