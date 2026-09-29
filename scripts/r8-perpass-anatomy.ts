/**
 * ROUND-8 — per-pass anatomy of the FOUR live failures: what the completion
 * actually contributed, and what the projector did with it.
 *
 * Answers the question the counterfactual raises and cannot answer on its own:
 * when a merged completion moves nodes/edges by ZERO, where did its claims go?
 */
import { readFileSync } from "node:fs";
import {
  projectRecordsToGraph,
  enumerateCompletionAsk,
  mergeCompletionClaims,
} from "../src/cee/draft/records/index.js";
import type { DraftRecordSet, DraftInferenceClaim } from "../src/cee/draft/records/grammar.js";

const DIR = process.env.R8_PASSES_DIR ?? "/private/tmp/r1-lane-r8-20260812-recproj/round7-passes";
const TARGETS = (process.env.R8_TARGETS ?? "03,05,07,10").split(",");

for (const t of TARGETS) {
  const p = JSON.parse(readFileSync(`${DIR}/pass${t}.json`, "utf8")) as {
    index: number;
    records: DraftRecordSet;
    completion: { claims: DraftInferenceClaim[] };
  };
  const before = projectRecordsToGraph(p.records);
  const merged = mergeCompletionClaims(p.records, { claims: p.completion.claims });
  if (!merged.ok) throw new Error(`merge declined for pass ${t}`);
  const after = projectRecordsToGraph(merged.records);

  const tally = (xs: readonly { reason: string }[]) => {
    const m = new Map<string, number>();
    for (const d of xs) m.set(d.reason, (m.get(d.reason) ?? 0) + 1);
    return [...m.entries()].sort().map(([k, n]) => `${k}×${n}`).join(" · ") || "—";
  };

  console.log(`\n════ pass${t} ════`);
  console.log(`  stated_items ${p.records.stated_items.length} · pass-1 claims ${p.records.claims.length} · completion claims ${p.completion.claims.length}`);
  console.log(`  graph  ${before.graph.nodes.length}n/${before.graph.edges.length}e  →  ${after.graph.nodes.length}n/${after.graph.edges.length}e`);
  console.log(`  node kinds after: ${JSON.stringify(after.graph.nodes.reduce<Record<string, number>>((a, n) => ({ ...a, [n.kind]: (a[n.kind] ?? 0) + 1 }), {}))}`);
  console.log(`  dropped BEFORE: ${tally(before.dropped)}`);
  console.log(`  dropped AFTER:  ${tally(after.dropped)}`);
  console.log(`  ask BEFORE: ${enumerateCompletionAsk(p.records, before).items.map((i) => i.kind).join(", ") || "—"}`);
  console.log(`  ask AFTER:  ${enumerateCompletionAsk(merged.records, after).items.map((i) => i.kind).join(", ") || "—"}`);

  // Which of the COMPLETION's own claims were dropped, and why? Bound by the
  // claim's LABEL (identity), never by position.
  const completionLabels = new Set(p.completion.claims.map((c) => c.label));
  const droppedCompletion = after.dropped.filter((d) => completionLabels.has(d.label));
  console.log(`  completion claims dropped: ${droppedCompletion.length}/${p.completion.claims.length}`);
  for (const d of droppedCompletion.slice(0, 14)) {
    console.log(`     ✗ ${d.reason}  ${JSON.stringify(String(d.label).slice(0, 62))}` +
      (d.from_kind || d.to_kind ? `  [${d.from_kind}→${d.to_kind}]` : ""));
  }
  const kindsOfCompletion = p.completion.claims.reduce<Record<string, number>>(
    (a, c) => ({ ...a, [c.claim_kind]: (a[c.claim_kind] ?? 0) + 1 }), {});
  console.log(`  completion claim_kinds: ${JSON.stringify(kindsOfCompletion)}`);
}
