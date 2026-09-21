/**
 * BEHAVIOUR WITNESS — the user's meaning survives brief → canonical model →
 * analysis payload, and one perturbed equivalent flips the outcome.
 *
 * Executed against the REAL projector and the REAL analysis-ready builder. The
 * shape is taken from the user's own staging draw (bundle `9077a1e3`); the
 * records are reconstructed because a debug bundle carries the projector's
 * OUTPUT, never its input.
 *
 * ⚠⚠ WHAT THIS WITNESS SHOWS IS STILL MISSING, recorded rather than asserted so
 * the suite stays honest: in the ANALYSIS PAYLOAD the user's own figure arrives
 * as `{ value: 0.59, source: "cee_hypothesis" }`. The OPTION is correctly his
 * (`provenance_class: "stated"`), and removing the duplicate restored single
 * ownership of £59 — but the INTERVENTION carrying his number is still stamped
 * as Olumi's. Gate-0 requires "£49 current / £59 proposed retain user
 * provenance", so this contract item is NOT yet met. Tracked as P5.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * ⚠ THE WITNESS ARTEFACT GOES TO A DIRECTORY THIS PROCESS CREATED.
 * It previously wrote to a hardcoded `/private/tmp/...` — a macOS-only absolute
 * path that does not exist on a CI runner, so the required check failed ENOENT
 * on both cases while the assertions themselves were fine. The artefact is the
 * point of a witness, so the fix creates the directory rather than dropping the
 * write; the path is reported so a reader can find it in a CI log.
 */
const OUT_DIR = mkdtempSync(join(tmpdir(), "capped-factor-witness-"));

import { buildAnalysisReadyPayload } from "../../src/cee/transforms/analysis-ready.js";
import { projectGraphAndOptionsToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { DraftRecordSet } from "../../src/cee/draft/records/grammar.js";
import { projectRecordsToGraph } from "../../src/cee/draft/records/projector.js";
import { GraphV3 } from "../../src/schemas/cee-v3.js";

const PRICE = "Pro Plan Monthly Price";
const CHURN = "Monthly Churn Rate";
const MINE = "increase the Pro plan price from £49 to £59 per month";

/** `restatementPrice === 59` ⇒ a semantic restatement of the user's option. */
function records(restatementPrice: number): DraftRecordSet {
  return {
    stated_items: [
      { kind: "goal", source_quote: "reaching £20k MRR within 12 months" },
      { kind: "option", source_quote: MINE },
      { kind: "constraint", source_quote: "keeping monthly churn under 4%", applies_to_claim: 1, direction: "ceiling", value: 0.04 },
    ],
    claims: [
      { claim_kind: "factor", label: PRICE },
      { claim_kind: "factor", label: CHURN },
      { claim_kind: "option_refinement", label: "Raise Price to £59 with Feature Release" },
      { claim_kind: "causal_link", label: "the stated rise sets the price", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 59 },
      { claim_kind: "causal_link", label: "the restatement sets a price", from_claim: 2, to_claim: 0, effect: "positive", sets_to: restatementPrice },
      { claim_kind: "causal_link", label: "the restatement invents a churn level", from_claim: 2, to_claim: 1, effect: "negative", sets_to: 0.045 },
      { claim_kind: "causal_link", label: "price bears on the goal", from_claim: 0, to_stated: 0, effect: "positive" },
      { claim_kind: "causal_link", label: "churn bears on the goal", from_claim: 1, to_stated: 0, effect: "negative" },
    ],
  } as DraftRecordSet;
}

function witness(restatementPrice: number) {
  const { graph, provenance, goalConstraints } = projectRecordsToGraph(records(restatementPrice)) as unknown as {
    graph: { nodes: Array<{ id: string; kind?: string; label?: string; data?: { interventions?: Record<string, number> } }> };
    provenance: Record<string, { provenance_class?: string }>;
    goalConstraints?: Array<Record<string, unknown>>;
  };
  const labelOf = (id: string) => graph.nodes.find((n) => n.id === id)?.label ?? id;
  const canonical = {
    options: graph.nodes.filter((n) => n.kind === "option").map((n) => ({
      label: n.label,
      provenance_class: provenance[n.id]?.provenance_class,
      sets: Object.fromEntries(Object.entries(n.data?.interventions ?? {}).map(([k, v]) => [labelOf(k), v])),
    })),
    constraints: (goalConstraints ?? []).map((c) => ({
      on: labelOf(String(c.node_id)), operator: c.operator, value: c.value, quote: c.source_quote,
    })),
  };
  // …and on through the REAL analysis-ready builder — the payload analysis sees.
  const p = projectGraphAndOptionsToV3(graph as never);
  const g3 = GraphV3.parse(p.graph);
  const goalId = g3.nodes.find((n) => n.kind === "goal")!.id;
  const ready = buildAnalysisReadyPayload(p.options, goalId, g3);
  const analysis = {
    options: (ready.options ?? []).map((o) => ({
      label: o.label, status: o.status,
      sets: Object.fromEntries(Object.entries(o.interventions ?? {}).map(([k, v]) => [
        g3.nodes.find((n) => n.id === k)?.label ?? k, v,
      ])),
    })),
  };
  return { canonical, analysis };
}

describe("BEHAVIOUR WITNESS — user meaning survives to the analysis payload", () => {
  it("A — the user's brief: one option, his figure, churn stays a constraint", () => {
    const w = witness(59);
    writeFileSync(join(OUT_DIR, "witness-A.json"), JSON.stringify(w, null, 1));

    expect(w.canonical.options.map((o) => o.label), "exactly one option, and it is his").toEqual([MINE]);
    expect(w.canonical.options[0]!.provenance_class, "it reads as the user's own").toBe("stated");
    expect(Object.keys(w.canonical.options[0]!.sets), "he intervenes on PRICE only").toEqual([PRICE]);
    expect(w.canonical.constraints, "his ceiling stays a constraint ON churn").toEqual([
      { on: CHURN, operator: "<=", value: 0.04, quote: "keeping monthly churn under 4%" },
    ]);
    // the payload analysis actually receives
    expect(w.analysis.options.map((o) => o.label)).toEqual([MINE]);
    expect(Object.keys(w.analysis.options[0]!.sets)).toEqual([PRICE]);
    expect(Object.values(w.analysis.options[0]!.sets), "no invented churn reaches analysis").not.toContain(0.045);
  });

  it("B — PERTURBED EQUIVALENT: the alternative proposes a DIFFERENT price, and survives", () => {
    // One property changed — 59 → 54 — and the outcome flips: it is no longer a
    // restatement, so it is a real alternative and is kept.
    const w = witness(54);
    writeFileSync(join(OUT_DIR, "witness-B.json"), JSON.stringify(w, null, 1));

    expect(w.canonical.options.map((o) => o.label), "two genuine alternatives now").toHaveLength(2);
    for (const o of w.canonical.options) {
      expect(Object.keys(o.sets), `"${o.label}" must not set the capped factor`).not.toContain(CHURN);
    }
    for (const o of w.analysis.options) {
      expect(Object.values(o.sets), `"${o.label}" carries an invented churn into analysis`).not.toContain(0.045);
    }
    expect(w.canonical.constraints[0]!.on, "the ceiling is still a constraint on churn").toBe(CHURN);
  });
});
