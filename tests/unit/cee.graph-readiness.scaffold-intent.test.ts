/**
 * F4 (readiness↔run gate) — the readiness route's intent reconstruction.
 *
 * The proven over-report (review P1): the route used to pass the Zod-parsed
 * request `graph` as `rawPersistedGraph`. That graph's OptionData schema is
 * numeric-only, so a CONFIGURED-BUT-NON-NUMERIC option's intervention intent
 * cannot ride it — the option reads as un-configured and readiness advertises a
 * scaffold the run path will NOT perform (it leaves the option on the honest
 * configure path). `buildReadinessRawPersistedGraph` folds that intent back in
 * from the analysis_ready wire (needs_encoding + raw_interventions) so the ONE
 * shared predicate (`gateAnalysableOptions` /
 * `collectInterventionIntentOptionIds`) sees exactly what the run path sees.
 *
 * These tests pin the reconstruction AND the end-to-end parity: feeding the
 * reconstructed graph to the run predicate suppresses the scaffold for the
 * intent option, identical to the run path with its own raw persisted graph.
 */

import { describe, it, expect } from "vitest";

import { buildReadinessRawPersistedGraph } from "../../src/routes/assist.v1.graph-readiness.js";
import { gateAnalysableOptions } from "../../src/orchestrator-v5/tools/handlers/analysable-option-gate.js";

// A GraphV3-ish request graph. `fac_price` carries an `observed_state` so the
// STATUS-QUO HOLD has a projectable target; opt_a configured, opt_b the option
// under test. The parsed request graph never carries opt_b's non-numeric intent.
//
// ⚠ IT USED TO CARRY ONLY A PRIOR ("a prior neutral so the scaffold has a
// projectable target"). The prior-range MIDPOINT RUNG WAS DELETED with the
// no-rank ruling, so on the old fixture `opt_b` was excluded for TWO reasons at
// once — not the baseline, AND no holdable target — which CONFOUNDS the parity
// property this file exists to pin. With an observed value present, the
// `is_baseline` flag is the only variable, and the discriminating pair below
// measures what it claims to measure.
function makeGraph() {
  return {
    nodes: [
      { id: "goal", kind: "goal", label: "Goal" },
      { id: "decision", kind: "decision", label: "Decision" },
      {
        id: "fac_price",
        kind: "factor",
        label: "Price",
        observed_state: { value: 0.4 },
        prior: { distribution: "uniform", range_min: 10, range_max: 30 },
      },
      { id: "opt_a", kind: "option", label: "Premium" },
      { id: "opt_b", kind: "option", label: "UK launch" },
    ],
    edges: [
      { from: "opt_a", to: "fac_price" },
      { from: "opt_b", to: "fac_price" },
    ],
  };
}

const configured = (id: string, interventions: Record<string, number>) => ({
  option_id: id,
  label: id,
  interventions,
});
const unconfiguredProjection = (id: string) => ({ option_id: id, label: id, interventions: {} });

describe("F4 buildReadinessRawPersistedGraph — intent reconstruction from analysis_ready", () => {
  it("folds raw_interventions intent into the option node's data.interventions", () => {
    const raw = buildReadinessRawPersistedGraph(makeGraph(), [
      { id: "opt_a", status: "ready", interventions: { fac_price: 0.9 } },
      { id: "opt_b", status: "needs_encoding", interventions: {}, raw_interventions: { fac_price: "UK" } },
    ]) as { nodes: Array<Record<string, any>> };
    const optB = raw.nodes.find((n) => n.id === "opt_b")!;
    expect(Object.keys(optB.data.interventions).length).toBeGreaterThan(0);
    expect(optB.data.interventions).toHaveProperty("fac_price");
  });

  // ⚠ F4 #2 (Paul, 28 Jul) — this test previously asserted the OPPOSITE:
  // "needs_encoding with no raw_interventions still yields intent (contract:
  // implies raw values)". That contract claim is FALSE at the producer —
  // `reconcile-top-level-options.ts` stamps `needs_encoding` on ANY option with
  // no NUMERIC value, including an option added by chat with no values at all —
  // so the synthetic key fabricated intent for a genuinely empty option,
  // suppressed the scaffold, and blocked a run that `run_analysis` performs.
  // Intent is now read from VALUES ONLY.
  it("needs_encoding with NO values at all yields NO intent (the status alone never manufactures it)", () => {
    const raw = buildReadinessRawPersistedGraph(makeGraph(), [
      { id: "opt_b", status: "needs_encoding", interventions: {} },
    ]) as { nodes: Array<Record<string, any>> };
    const optB = raw.nodes.find((n) => n.id === "opt_b")!;
    // Unchanged node → the shared predicate sees no intent → scaffold-eligible.
    expect(optB.data).toBeUndefined();
  });

  it("needs_encoding with an explicitly EMPTY raw_interventions also yields NO intent", () => {
    const raw = buildReadinessRawPersistedGraph(makeGraph(), [
      { id: "opt_a", status: "ready", interventions: { fac_price: 0.9 } },
      { id: "opt_b", status: "needs_encoding", interventions: {}, raw_interventions: {} },
    ]) as { nodes: Array<Record<string, any>> };
    const optB = raw.nodes.find((n) => n.id === "opt_b")!;
    expect(optB.data).toBeUndefined();
  });

  it("a genuinely-empty option (no interventions, no raw, needs_user_mapping) gets NO synthetic intent", () => {
    const raw = buildReadinessRawPersistedGraph(makeGraph(), [
      { id: "opt_a", status: "ready", interventions: { fac_price: 0.9 } },
      { id: "opt_b", status: "needs_user_mapping", interventions: {} },
    ]) as { nodes: Array<Record<string, any>> };
    const optB = raw.nodes.find((n) => n.id === "opt_b")!;
    // No data.interventions added → the shared predicate sees no intent →
    // the option remains scaffold-eligible (the true-scaffold case).
    expect(optB.data).toBeUndefined();
  });

  it("does not mutate the input graph", () => {
    const graph = makeGraph();
    const before = JSON.stringify(graph);
    buildReadinessRawPersistedGraph(graph, [
      { id: "opt_b", status: "needs_encoding", interventions: {}, raw_interventions: { fac_price: "UK" } },
    ]);
    expect(JSON.stringify(graph)).toBe(before);
  });
});

// ⚠ RE-POINTED BY THE NO-RANK RULING (2026-08-14). The run predicate no longer
// SCAFFOLDS an unconfigured option — it EXCLUDES it (only a flagged status quo
// is held). The parity property under test is unchanged and is the whole point
// of this file: whatever the run path does with `opt_b`, the readiness
// predicate must do the same, because they are one computation.
describe("F4 parity — reconstructed intent suppresses the gate exactly as the run path does", () => {
  const options = [configured("opt_a", { fac_price: 0.9 }), unconfiguredProjection("opt_b")];

  it("configured-but-non-numeric opt_b → run predicate does NOT scaffold it (intent), matching the run path", () => {
    const rawPersistedGraph = buildReadinessRawPersistedGraph(makeGraph(), [
      { id: "opt_a", status: "ready", interventions: { fac_price: 0.9 } },
      { id: "opt_b", status: "needs_encoding", interventions: {}, raw_interventions: { fac_price: "UK" } },
    ]);
    const outcome = gateAnalysableOptions({
      options,
      graph: makeGraph(),
      rawPersistedGraph,
      scaleNetEnabled: true,
    });
    // Intent is user authorship: never written over, and never held at values
    // CEE chose. Unchanged by the ruling.
    expect(outcome.held).toEqual([]);
    // ⭐ AND IT IS NOT SILENTLY DROPPED EITHER — it is excluded, which is a
    // NAMED, disclosed outcome. Without this assertion "not held" would be
    // equally satisfied by the option vanishing without trace.
    expect(outcome.excluded.map((s) => s.option_id)).toEqual(["opt_b"]);
  });

  // ⚠ F4 #2: the `needs_user_mapping` arm below is a status the CHAT-ADD
  // producer never emits — `reconcile-top-level-options.ts` stamps
  // `needs_encoding`. Keeping it alone made this "true-scaffold case preserved"
  // control vacuous for the state Paul actually hit, so the `needs_encoding`
  // arm is added beside it and is the one that reproduces his journey.
  it("genuinely-empty opt_b (needs_encoding — the chat-add producer's status) → run predicate EXCLUDES it", () => {
    const rawPersistedGraph = buildReadinessRawPersistedGraph(makeGraph(), [
      { id: "opt_a", status: "ready", interventions: { fac_price: 0.9 } },
      { id: "opt_b", status: "needs_encoding", interventions: {} },
    ]);
    const outcome = gateAnalysableOptions({
      options,
      graph: makeGraph(),
      rawPersistedGraph,
      scaleNetEnabled: true,
    });
    // This is the state Paul actually hit. It is no longer filled with values
    // CEE chose and then RANKED — it is excluded and disclosed by name.
    expect(outcome.excluded.map((s) => s.option_id)).toEqual(["opt_b"]);
    expect(outcome.held).toEqual([]);
  });

  it("genuinely-empty opt_b → EXCLUDED; the SAME option flagged as the status quo is HELD (discriminating pair)", () => {
    const rawPersistedGraph = buildReadinessRawPersistedGraph(makeGraph(), [
      { id: "opt_a", status: "ready", interventions: { fac_price: 0.9 } },
      { id: "opt_b", status: "needs_user_mapping", interventions: {} },
    ]);
    const outcome = gateAnalysableOptions({
      options,
      graph: makeGraph(),
      rawPersistedGraph,
      scaleNetEnabled: true,
    });
    expect(outcome.excluded.map((s) => s.option_id)).toEqual(["opt_b"]);

    // ⭐ THE DISCRIMINATING HALF: byte-identical input except `is_baseline`.
    // Without it, "excluded" above is equally consistent with a gate that
    // excludes everything unconfigured, which would silently delete the status
    // quo from every comparison.
    const heldOutcome = gateAnalysableOptions({
      options: [options[0], { ...options[1], is_baseline: true }],
      graph: makeGraph(),
      rawPersistedGraph,
      scaleNetEnabled: true,
    });
    expect(heldOutcome.held.map((s) => s.option_id)).toEqual(["opt_b"]);
    expect(heldOutcome.excluded).toEqual([]);
  });
});
