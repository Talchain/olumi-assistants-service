/**
 * ROUND-8 COUNTERFACTUAL REPLAY — the round-7 acceptance block's ELEVEN banked
 * completion passes, re-run through the FIXED keep/discard predicate, from disk.
 *
 * No provider call. Every input is the model's REAL emission, decoded from the
 * round-7 redacting-proxy captures and paired against the completion prompt that
 * was built from it (the pairing is corroborated independently and its negative
 * control rejects 10/10 deliberately-wrong partners).
 *
 * Everything below runs the PRODUCTION functions — `projectRecordsToGraph`,
 * `enumerateCompletionAsk`, `mergeCompletionClaims`, `countBlockingAskItems` —
 * plus the repo's acceptance oracle (`projectAndValidate`), which imports the
 * REAL validator and the REAL repair stages.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  projectRecordsToGraph,
  enumerateCompletionAsk,
  mergeCompletionClaims,
  countBlockingAskItems,
} from "../src/cee/draft/records/index.js";
import type { DraftRecordSet, DraftInferenceClaim } from "../src/cee/draft/records/grammar.js";
import { projectAndValidate } from "./records-validator-oracle.js";

const DIR = process.env.R8_PASSES_DIR ?? "/private/tmp/r1-lane-r8-20260812-recproj/round7-passes";

// Run attribution, derived from the round-7 results.jsonl + the CEE log's
// `enforcement_post_validation_errors` request ids, matched by wall-clock
// window. Recorded here so every line of output names the run it is about.
const ATTRIBUTION: Record<number, { run: number; brief: string; scenario: string; outcome: string }> = {
  1: { run: 4, brief: "B1", scenario: "1369f3d9", outcome: "PASS 20n/32e" },
  2: { run: 6, brief: "B3", scenario: "5d68e5d1", outcome: "PASS 21n/35e" },
  3: { run: 8, brief: "crm", scenario: "e6d078ca", outcome: "FAIL 500 · a586b871" },
  4: { run: 10, brief: "B1", scenario: "f559b7f5", outcome: "PASS 22n/31e" },
  5: { run: 12, brief: "B3", scenario: "4ffcc52c", outcome: "FAIL 500 · UNATTRIBUTED" },
  6: { run: 14, brief: "crm", scenario: "cbd421b3", outcome: "PASS 10n/16e" },
  7: { run: 16, brief: "B1", scenario: "4844d7e4", outcome: "FAIL 500 · 5dd2c1dc" },
  8: { run: 18, brief: "B3", scenario: "be8db25a", outcome: "PASS 21n/30e" },
  9: { run: 20, brief: "crm", scenario: "25e845e9", outcome: "PASS 11n/17e" },
  10: { run: 22, brief: "B1", scenario: "53288422", outcome: "FAIL 500 · 63cbac40" },
  11: { run: 24, brief: "B3", scenario: "a17af86b", outcome: "PASS 19n/32e" },
};

interface PassFile {
  index: number;
  draft_capture: string;
  completion_capture: string;
  records: DraftRecordSet;
  completion: { claims: DraftInferenceClaim[] };
}

const files = readdirSync(DIR).filter((f) => /^pass\d+\.json$/.test(f)).sort();
if (files.length === 0) throw new Error("HARD ERROR: no pass files — zero inputs is never a result");

const rows: Record<string, unknown>[] = [];
let flips = 0;

for (const f of files) {
  const p = JSON.parse(readFileSync(join(DIR, f), "utf8")) as PassFile;
  const attribution = ATTRIBUTION[p.index];
  if (!attribution) throw new Error(`HARD ERROR: pass ${p.index} has no run attribution`);
  if (p.records.stated_items.length === 0) throw new Error(`HARD ERROR: ${f} decoded 0 stated_items`);
  if (p.completion.claims.length === 0) throw new Error(`HARD ERROR: ${f} decoded 0 completion claims`);

  const projection = projectRecordsToGraph(p.records);
  const askBefore = enumerateCompletionAsk(p.records, projection);
  const blockingBefore = countBlockingAskItems(askBefore);

  const merged = mergeCompletionClaims(p.records, { claims: p.completion.claims });
  if (!merged.ok) throw new Error(`HARD ERROR: ${f} merge declined: ${merged.reason}`);
  const reprojected = projectRecordsToGraph(merged.records);
  const askAfter = enumerateCompletionAsk(merged.records, reprojected);
  const blockingAfter = countBlockingAskItems(askAfter);

  // The two verdicts, side by side. `oldVerdict` is the ROUND-7 expression,
  // reproduced literally so the comparison is against what actually ran.
  const oldVerdict = askAfter.items.length < askBefore.items.length;
  const newVerdict = blockingAfter <= blockingBefore;
  if (oldVerdict !== newVerdict) flips++;

  // What the graph is actually worth, judged by the REAL validator through the
  // REAL repair stages — for pass 1 alone and for the two-pass merge.
  const oracle1 = projectAndValidate(p.records);
  const oracle2 = projectAndValidate(merged.records);

  const codeCount = (v: readonly { code: string }[]) => {
    const m = new Map<string, number>();
    for (const x of v) m.set(x.code, (m.get(x.code) ?? 0) + 1);
    return [...m.entries()].map(([c, n]) => `${c}×${n}`).join(" · ") || "—";
  };

  rows.push({
    pass: p.index,
    run: attribution.run,
    brief: attribution.brief,
    scenario: attribution.scenario,
    live_outcome: attribution.outcome,
    ask_before: askBefore.items.length,
    ask_after: askAfter.items.length,
    blocking_before: blockingBefore,
    blocking_after: blockingAfter,
    old_verdict: oldVerdict ? "KEEP" : "DISCARD",
    new_verdict: newVerdict ? "KEEP" : "DISCARD",
    flipped: oldVerdict !== newVerdict,
    nodes_before: projection.graph.nodes.length,
    nodes_after: reprojected.graph.nodes.length,
    edges_before: projection.graph.edges.length,
    edges_after: reprojected.graph.edges.length,
    oracle_pass1_ok: oracle1.ok,
    oracle_pass1_blocking: codeCount(oracle1.blocking),
    oracle_twopass_ok: oracle2.ok,
    oracle_twopass_blocking: codeCount(oracle2.blocking),
    oracle_pass1_nodes_edges: `${oracle1.nodes}/${oracle1.edges}`,
    oracle_twopass_nodes_edges: `${oracle2.nodes}/${oracle2.edges}`,
    ask_before_kinds: askBefore.items.map((i) => i.kind).join(","),
    ask_after_kinds: askAfter.items.map((i) => i.kind).join(","),
  });
}

// ── OUTPUT ──────────────────────────────────────────────────────────────────
const pad = (s: unknown, n: number) => String(s).padEnd(n);
console.log("");
console.log(
  pad("pass", 5) + pad("run", 4) + pad("brief", 6) + pad("live outcome", 26) +
  pad("ask", 9) + pad("blocking", 10) + pad("v2 (round7)", 13) + pad("v3 (derived)", 13) + "flip",
);
console.log("-".repeat(110));
for (const r of rows) {
  console.log(
    pad(r.pass, 5) + pad(r.run, 4) + pad(r.brief, 6) + pad(r.live_outcome, 26) +
    pad(`${r.ask_before}→${r.ask_after}`, 9) +
    pad(`${r.blocking_before}→${r.blocking_after}`, 10) +
    pad(r.old_verdict, 13) + pad(r.new_verdict, 13) + (r.flipped ? "⭐" : ""),
  );
}
console.log("");
console.log(
  pad("pass", 5) + pad("nodes", 12) + pad("edges", 12) +
  pad("ORACLE pass1", 34) + "ORACLE two-pass",
);
console.log("-".repeat(110));
for (const r of rows) {
  console.log(
    pad(r.pass, 5) +
    pad(`${r.nodes_before}→${r.nodes_after}`, 12) +
    pad(`${r.edges_before}→${r.edges_after}`, 12) +
    pad(`${r.oracle_pass1_ok ? "ok" : "BLOCKED"} ${r.oracle_pass1_blocking}`, 34) +
    `${r.oracle_twopass_ok ? "ok" : "BLOCKED"} ${r.oracle_twopass_blocking}`,
  );
}

const keptOld = rows.filter((r) => r.old_verdict === "KEEP").length;
const keptNew = rows.filter((r) => r.new_verdict === "KEEP").length;
const failing = rows.filter((r) => String(r.live_outcome).startsWith("FAIL"));
console.log("");
console.log(`passes replayed: ${rows.length}`);
console.log(`kept under v2 (round-7 ask count):        ${keptOld}`);
console.log(`kept under v3 (derived blocking classes): ${keptNew}`);
console.log(`verdicts flipped:                         ${flips}`);
console.log("");
console.log("THE FOUR LIVE FAILURES:");
for (const r of failing) {
  console.log(
    `  run ${r.run} ${r.brief} ${r.scenario} — ${r.live_outcome}\n` +
    `      v2 ${r.old_verdict} → v3 ${r.new_verdict};  oracle pass1 ${r.oracle_pass1_ok ? "ok" : "BLOCKED " + r.oracle_pass1_blocking}` +
    `  →  two-pass ${r.oracle_twopass_ok ? "ok" : "BLOCKED " + r.oracle_twopass_blocking}` +
    `  (nodes/edges ${r.oracle_pass1_nodes_edges} → ${r.oracle_twopass_nodes_edges})`,
  );
}

console.log("\n--- JSON ---");
console.log(JSON.stringify(rows, null, 1));
