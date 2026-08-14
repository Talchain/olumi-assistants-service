/**
 * THE PINNED-BRIEF ACCEPTANCE RUNNER — the regression witness for the 14 Aug
 * analysis outage.
 *
 * ── WHAT IT MEASURES ───────────────────────────────────────────────────────
 * The root-cause report's own semantic table, over N draws:
 *   risk count · scaffolded-outcome share · scaffolding markers · option
 *   provenance.
 *
 * The measurement function is IMPORTED from the replay harness
 * (`src/cee/draft/records/replay.ts` → `measureSemanticTable`) and is not
 * restated here. That is deliberate and load-bearing: a live measurement and a
 * fixture measurement that answered the same question two different ways would
 * let a regression hide in the gap between them (trap 12 — one authority).
 *
 * ── ⚠ WHAT THIS SCRIPT DOES *NOT* DO, AND WHY ─────────────────────────────
 * It does not drive staging, mint users, or hold a credential. The estate
 * already has ONE owner of the wire + auth protocol — the golden-journey driver
 * (`scripts/golden-journey/lib/{wire,auth}.mjs` at the PROGRAMME root, which is
 * where the outage's own `driver-P0.mjs` imports it from). Re-implementing a
 * signed-in draw here would be a second protocol authority, and the first time
 * the turn shape moved, one of the two would be measuring a request the product
 * no longer makes.
 *
 * So the split is: THE DRIVER OWNS THE DRAWS, THIS SCRIPT OWNS THE MEASUREMENT
 * AND THE VERDICT. Feed it the driver's output with `--draws`.
 *
 * ── MODES ─────────────────────────────────────────────────────────────────
 *   --fixtures            replay the repo's banked record-set captures through
 *                         the deterministic chain and evaluate every condition
 *                         a fixture CAN settle. Offline, no credential, and
 *                         what CI runs.
 *   --draws <path>        a JSON file or directory of GraphV3-shaped graphs
 *                         captured from live draws (the driver's `draws.json`
 *                         / `summary.json` / a directory of per-draw files).
 *   --n <k>               the minimum draw count the verdict requires
 *                         (default 5).
 *   --json                emit the machine-readable report only.
 *
 * ── ⚠ A CONDITION A RUN CANNOT SETTLE IS REPORTED `UNEVALUABLE`, NEVER `PASS` ─
 * Two of the five conditions are claims about what a LIVE MODEL emits under the
 * widened grammar. The banked captures predate that grammar — they carry no
 * risk or outcome claim and could not — so `--fixtures` CANNOT settle them, and
 * says so by name. A harness that scored them green offline would be reporting
 * on itself (trap 13).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { measureSemanticTable, replayRecordSet, type SemanticTable } from "../src/cee/draft/records/replay.js";
import type { DraftRecordSet } from "../src/cee/draft/records/grammar.js";

/** The user brief the outage was reproduced on, verbatim. */
export const PINNED_BRIEF =
  "Should I hire a Tech lead or two developers to increase productivity?";

const FIXTURE_DIR = "src/cee/draft/records/__tests__/fixtures";

export type Verdict = "PASS" | "FAIL" | "UNEVALUABLE";

export interface Condition {
  readonly id: string;
  readonly statement: string;
  readonly verdict: Verdict;
  readonly detail: string;
}

export interface Report {
  readonly brief: string;
  readonly mode: "fixtures" | "draws";
  readonly source: string;
  readonly drawCount: number;
  readonly minimumDraws: number;
  readonly perDraw: readonly { label: string; semantics: SemanticTable }[];
  readonly conditions: readonly Condition[];
  readonly overall: Verdict;
}

/**
 * ⭐ THE ACCEPTANCE CONDITIONS, and which class of run can settle each.
 *
 * A1/A2 are claims about LIVE MODEL BEHAVIOUR under the widened schema. Nothing
 * offline can establish them, and the build lane that shipped the widening
 * explicitly did not: they are the post-merge deploy witness's job.
 *
 * A3/A4/A5 are properties of the DETERMINISTIC CHAIN, so a fixture replay
 * settles them exactly as a live draw would.
 */
export function evaluate(perDraw: readonly { label: string; semantics: SemanticTable }[], mode: Report["mode"], minimumDraws: number): Condition[] {
  const tables = perDraw.map((d) => d.semantics);
  const conditions: Condition[] = [];

  // ── A1 — risks are expressible, and the model uses them.
  const drawsWithRisk = tables.filter((t) => t.riskCount > 0).length;
  conditions.push({
    id: "A1",
    statement: "at least one draw carries a risk node (pre-fix: 0 of 5)",
    verdict:
      mode === "fixtures"
        ? "UNEVALUABLE"
        : drawsWithRisk > 0
          ? "PASS"
          : "FAIL",
    detail:
      mode === "fixtures"
        ? "the banked captures PREDATE the widened grammar and carry no risk claim — a fixture cannot settle what a live model emits"
        : `${drawsWithRisk}/${tables.length} draws carry ≥1 risk node`,
  });

  // ── A2 — the outcome layer is no longer entirely ours.
  const shares = tables.map((t) => t.scaffoldedOutcomeShare).filter((s): s is number => s !== null);
  const meanShare = shares.length === 0 ? null : shares.reduce((a, b) => a + b, 0) / shares.length;
  conditions.push({
    id: "A2",
    statement: "the mean scaffolded-outcome share is below 1.0 (pre-fix: 1.0 in 5 of 5)",
    verdict:
      mode === "fixtures"
        ? "UNEVALUABLE"
        : meanShare === null
          ? "FAIL"
          : meanShare < 1
            ? "PASS"
            : "FAIL",
    detail:
      mode === "fixtures"
        ? "same reason as A1 — the captures cannot author an outcome, so their share is 1.0 by construction and says nothing about the fix"
        : `mean scaffolded share ${meanShare === null ? "n/a (no outcomes anywhere)" : meanShare.toFixed(3)} over ${shares.length} draws`,
  });

  // ── A3 — every machine-minted outcome is DISCLOSED as one.
  //
  // Compares the two independent readings the semantic table carries: nodes
  // marked `projector_structural`, and nodes whose id matches the mint pattern.
  // A disagreement means one of the three mint sites stopped marking, which a
  // single count could never reveal.
  const unmarked = perDraw.flatMap((d) =>
    d.semantics.impactPatternOutcomeIds
      .filter((id) => !d.semantics.scaffoldedOutcomeIds.includes(id))
      .map((id) => `${d.label}:${id}`),
  );
  conditions.push({
    id: "A3",
    statement: "every minted outcome carries the machine-readable scaffolding marker",
    verdict: unmarked.length === 0 ? "PASS" : "FAIL",
    detail:
      unmarked.length === 0
        ? "the marker reading and the mint-id reading agree on every draw"
        : `UNMARKED minted outcomes: ${unmarked.join(", ")}`,
  });

  // ── A4 — no option reaches a user unclassified.
  const unclassified = perDraw.flatMap((d) =>
    d.semantics.optionProvenance.filter((o) => o.provenance_class === null).map((o) => `${d.label}:${o.id}`),
  );
  conditions.push({
    id: "A4",
    statement: "every option node carries a provenance class",
    verdict: unclassified.length === 0 ? "PASS" : "FAIL",
    detail:
      unclassified.length === 0
        ? "every option is classified stated / ai_inferred / projector_structural"
        : `UNCLASSIFIED options: ${unclassified.join(", ")}`,
  });

  // ── A5 — the distribution is measured, not one lucky draw.
  conditions.push({
    id: "A5",
    statement: `at least ${minimumDraws} draws (the drafter is nondeterministic; one draw is an anecdote)`,
    verdict: perDraw.length >= minimumDraws ? "PASS" : "FAIL",
    detail: `${perDraw.length} draw(s) measured`,
  });

  return conditions;
}

/** Every `*.json` in the fixtures dir that is a record set, bare or wrapped. */
export function loadFixtureRecordSets(root: string): { label: string; records: DraftRecordSet }[] {
  const dir = resolve(root, FIXTURE_DIR);
  const out: { label: string; records: DraftRecordSet }[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!name.endsWith(".json")) continue;
    const raw = JSON.parse(readFileSync(join(dir, name), "utf8")) as Record<string, unknown>;
    const candidate = (raw.records ?? raw) as Partial<DraftRecordSet>;
    if (!Array.isArray(candidate.stated_items) || !Array.isArray(candidate.claims)) continue;
    out.push({ label: name, records: candidate as DraftRecordSet });
  }
  return out;
}

/** Pull every GraphV3-shaped object out of a driver artefact, however nested. */
export function collectGraphs(value: unknown, path: string, into: { label: string; graph: unknown }[]): void {
  if (value === null || typeof value !== "object") return;
  const rec = value as Record<string, unknown>;
  if (Array.isArray(rec.nodes) && Array.isArray(rec.edges)) {
    into.push({ label: path, graph: rec });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectGraphs(v, `${path}[${i}]`, into));
    return;
  }
  for (const [k, v] of Object.entries(rec)) collectGraphs(v, path === "" ? k : `${path}.${k}`, into);
}

function loadDraws(target: string): { label: string; graph: unknown }[] {
  const into: { label: string; graph: unknown }[] = [];
  const stats = statSync(target);
  const files = stats.isDirectory()
    ? readdirSync(target).filter((f) => f.endsWith(".json")).sort().map((f) => join(target, f))
    : [target];
  for (const file of files) {
    collectGraphs(JSON.parse(readFileSync(file, "utf8")), file, into);
  }
  return into;
}

export async function buildReport(args: {
  readonly repoRoot: string;
  readonly drawsPath?: string;
  readonly minimumDraws: number;
}): Promise<Report> {
  let perDraw: { label: string; semantics: SemanticTable }[];
  let mode: Report["mode"];
  let source: string;

  if (args.drawsPath !== undefined) {
    mode = "draws";
    source = args.drawsPath;
    perDraw = loadDraws(args.drawsPath).map((d) => ({
      label: d.label,
      semantics: measureSemanticTable(d.graph),
    }));
  } else {
    mode = "fixtures";
    source = FIXTURE_DIR;
    perDraw = [];
    for (const fixture of loadFixtureRecordSets(args.repoRoot)) {
      const result = await replayRecordSet(fixture.records, { brief: PINNED_BRIEF });
      if (!result.ok) {
        // A capture that will not replay is a FINDING, not a row to skip
        // silently — a runner that quietly drops its inputs reports on itself.
        throw new Error(`fixture ${fixture.label} failed to replay: ${result.reason} — ${result.detail}`);
      }
      perDraw.push({ label: fixture.label, semantics: result.semantics });
    }
  }

  if (perDraw.length === 0) {
    throw new Error(`no graphs found at ${source} — refusing to report a verdict over an empty population`);
  }

  const conditions = evaluate(perDraw, mode, args.minimumDraws);
  const overall: Verdict = conditions.some((c) => c.verdict === "FAIL")
    ? "FAIL"
    : conditions.some((c) => c.verdict === "UNEVALUABLE")
      ? "UNEVALUABLE"
      : "PASS";

  return {
    brief: PINNED_BRIEF,
    mode,
    source,
    drawCount: perDraw.length,
    minimumDraws: args.minimumDraws,
    perDraw,
    conditions,
    overall,
  };
}

/** `PASS` → 0 · `FAIL` → 1 · `UNEVALUABLE` → 2. "Could not measure" is never a pass. */
export function exitCodeFor(overall: Verdict): number {
  return overall === "PASS" ? 0 : overall === "UNEVALUABLE" ? 2 : 1;
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const arg = (name: string): string | undefined => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const asJson = argv.includes("--json");
  const minimumDraws = Number.parseInt(arg("n") ?? "5", 10);
  const drawsPath = arg("draws");
  const repoRoot = resolve(new URL("..", import.meta.url).pathname);

  const report = await buildReport({ repoRoot, drawsPath, minimumDraws });
  const { perDraw, conditions, overall, mode, source } = report;

  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`\nPINNED-BRIEF ACCEPTANCE — mode=${mode} source=${source}\n`);
    process.stdout.write(`brief: ${PINNED_BRIEF}\n\n`);
    for (const draw of perDraw) {
      const s = draw.semantics;
      process.stdout.write(
        `  ${draw.label}\n` +
          `    nodes ${s.nodeCount} · edges ${s.edgeCount} · risks ${s.riskCount} · outcomes ${s.outcomeCount}\n` +
          `    scaffolded outcomes ${s.scaffoldedOutcomeIds.length}/${s.outcomeCount}` +
          ` (share ${s.scaffoldedOutcomeShare === null ? "n/a" : s.scaffoldedOutcomeShare.toFixed(3)})\n` +
          `    options ${s.optionCount}\n`,
      );
    }
    process.stdout.write("\n");
    for (const c of conditions) {
      process.stdout.write(`  [${c.verdict.padEnd(11)}] ${c.id} — ${c.statement}\n            ${c.detail}\n`);
    }
    process.stdout.write(`\nOVERALL: ${overall}\n\n`);
  }

  // UNEVALUABLE is exit 2, never exit 0. "Could not measure" is not a pass —
  // it is the state a reader must be forced to notice.
  return exitCodeFor(overall);
}

// Run only when INVOKED, never on import: a test that imports this module to
// exercise `evaluate` must not also execute the CLI and call `process.exit`.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      process.stderr.write(`${String(err)}\n`);
      process.exit(1);
    },
  );
}
