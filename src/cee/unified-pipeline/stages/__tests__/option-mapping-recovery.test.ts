/**
 * Stage 3b — OPTION MAPPING RECOVERY.
 *
 * ⚠ WHAT THESE TESTS ARE EVIDENCE ABOUT, stated before the first assertion.
 * Every `call` here is a fake, so NOTHING below is evidence about model
 * behaviour (trap 16: a fixture you wrote yourself is not evidence about the
 * wire). What they pin is (a) the SELECTION — which options the stage is even
 * allowed to ask about, (b) the APPLICATION — the exact edge it writes, and
 * (c) THE CHAIN CLAIM, measured through the REAL readiness producer
 * (`buildAnalysisReadyPayload`) rather than through a restatement of it.
 */

import { describe, expect, it } from "vitest";
import type { GraphT } from "../../../../schemas/graph.js";
import { buildAnalysisReadyPayload } from "../../../transforms/analysis-ready.js";
import { isRepairAuthoredOptionFactorEdge } from "../../../../graph/repair-authored-edge.js";
import { CANONICAL_EDGE } from "../../../../validators/graph-validator.types.js";
import type { OptionFactorMapModelCall } from "../../../draft/option-factor-mapper.js";
import {
  applyOptionFactorMappings,
  OPTION_MAPPING_RECOVERY_ORIGIN,
  runStageOptionMappingRecovery,
  selectUnmappedOptions,
  type OptionMappingRecoveryOutcome,
} from "../option-mapping-recovery.js";
import { fixStatusQuoConnectivity } from "../repair/status-quo-fix.js";
import type { StageContext } from "../../types.js";

// ───────────────────────────────────────────────────────────────────────────
// Fixture — the witnessed shape: siblings mapped, one option not.
// ───────────────────────────────────────────────────────────────────────────

const OPT_LEAD = "opt_tech_lead";
const OPT_TWO_DEVS = "opt_two_developers";
const FAC_CAPACITY = "fac_delivery_capacity";
const FAC_LEADERSHIP = "fac_technical_leadership";
const GOAL = "goal_ship_faster";

/** A structural option→factor edge in the format the draft path emits. */
const structuralEdge = (from: string, to: string, origin?: string) =>
  ({
    from,
    to,
    effect_direction: "positive",
    strength_mean: CANONICAL_EDGE.mean,
    strength_std: CANONICAL_EDGE.std,
    belief_exists: CANONICAL_EDGE.prob,
    ...(origin ? { origin } : {}),
  }) as never;

function draftGraph(overrides: { unmappedInterventions?: Record<string, number>; unmappedIsBaseline?: boolean } = {}): GraphT {
  return {
    nodes: [
      { id: GOAL, kind: "goal", label: "Ship faster" },
      { id: FAC_CAPACITY, kind: "factor", label: "Delivery capacity", data: { value: 0.4 } },
      { id: FAC_LEADERSHIP, kind: "factor", label: "Technical leadership", data: { value: 0.3 } },
      {
        id: OPT_LEAD,
        kind: "option",
        label: "Hire a tech lead",
        data: { interventions: { [FAC_LEADERSHIP]: 0.8 } },
      },
      {
        id: OPT_TWO_DEVS,
        kind: "option",
        label: "Hire two developers only",
        ...(overrides.unmappedIsBaseline === true ? { is_baseline: true } : {}),
        ...(overrides.unmappedInterventions
          ? { data: { interventions: overrides.unmappedInterventions } }
          : {}),
      },
    ],
    edges: [
      structuralEdge(OPT_LEAD, FAC_LEADERSHIP),
      { from: FAC_LEADERSHIP, to: GOAL, effect_direction: "positive" },
      { from: FAC_CAPACITY, to: GOAL, effect_direction: "positive" },
    ],
  } as never;
}

const stubCall =
  (payload: unknown): OptionFactorMapModelCall =>
  async () => ({ content: JSON.stringify(payload) });

function makeCtx(graph: GraphT | undefined): StageContext {
  return {
    requestId: "req_test",
    graph,
    effectiveBrief: "Should we hire a tech lead or two developers?",
    start: Date.now(),
  } as unknown as StageContext;
}

// ───────────────────────────────────────────────────────────────────────────
describe("Stage 3b selection — who may be asked about", () => {
  it("⭐ selects the option the drafter left unmapped, and only that one", () => {
    const graph = draftGraph();

    // PRECONDITION PIN (trap 13b): assert the fixture actually reaches the
    // branch under test. Without this, a fixture whose "mapped" sibling silently
    // carries no edge would make the sibling rule pass for the wrong reason.
    const optionFactorEdges = (graph.edges as Array<{ from: string; to: string }>).filter(
      (e) => e.from === OPT_LEAD && e.to === FAC_LEADERSHIP,
    );
    expect(optionFactorEdges).toHaveLength(1);

    const selection = selectUnmappedOptions(graph);
    expect(selection.unmapped.map((o) => o.option_id)).toEqual([OPT_TWO_DEVS]);
    expect(selection.mappedOptionCount).toBe(1);
    expect(selection.factors.map((f) => f.factor_id).sort()).toEqual(
      [FAC_CAPACITY, FAC_LEADERSHIP].sort(),
    );
  });

  it("never selects the baseline option — mapping it destroys the thing it represents", () => {
    const selection = selectUnmappedOptions(draftGraph({ unmappedIsBaseline: true }));
    expect(selection.unmapped).toEqual([]);
  });

  it("never selects an option whose mapping the drafter already stated as interventions", () => {
    const selection = selectUnmappedOptions(
      draftGraph({ unmappedInterventions: { [FAC_CAPACITY]: 0.7 } }),
    );
    expect(selection.unmapped).toEqual([]);
    expect(selection.mappedOptionCount).toBe(2);
  });

  it("⭐ THE HONEST REFUSAL, PRESERVED: with no mapped sibling anywhere, nothing is asked", () => {
    const graph = draftGraph();
    // Remove the ONLY sibling mapping — BOTH of its carriers. Stripping the edge
    // alone left `data.interventions` behind and the sibling still counted, which
    // is the first version of this test measuring the wrong arm; the precondition
    // assertions below are what caught it.
    (graph.edges as unknown[]).splice(0, 1);
    delete (graph.nodes as Array<{ id: string; data?: unknown }>).find((n) => n.id === OPT_LEAD)!
      .data;
    const selection = selectUnmappedOptions(graph);
    expect(selection.mappedOptionCount).toBe(0);
    expect(selection.unmapped).toEqual([]);
    // Contrast control in the same test: with the sibling restored it DOES select,
    // so the empty result above is the rule firing rather than the probe failing.
    expect(selectUnmappedOptions(draftGraph()).unmapped).toHaveLength(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("⭐ WHY STAGE 3b RUNS BEFORE REPAIR — measured, not asserted in a comment", () => {
  it("the connectivity repair makes an unmapped option look mapped to this selection", () => {
    const graph = draftGraph();

    // PRECONDITION PIN: the selection sees the option BEFORE the repair runs.
    expect(selectUnmappedOptions(graph).unmapped.map((o) => o.option_id)).toEqual([OPT_TWO_DEVS]);

    // The REAL repair, not a restatement of it.
    const result = fixStatusQuoConnectivity(graph, [{ code: "NO_PATH_TO_GOAL" }], "V1_FLAT");
    expect(result.fixed).toBe(true);

    // ⭐ AND NOW IT IS INVISIBLE. `selectUnmappedOptions` asks "does this option
    // carry an option→factor edge", which after the repair is TRUE — of edges the
    // repair drew. Running Stage 3b here would ask nothing and rescue nothing,
    // and teaching it to look through repair edges would mint a SECOND authority
    // on a question `isRepairAuthoredOptionFactorEdge` already owns (trap 21).
    // The ordering IS the design, and this is the measurement that says so.
    expect(selectUnmappedOptions(graph).unmapped).toEqual([]);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Stage 3b application — the edge it writes", () => {
  it("⭐ writes an edge readiness COUNTS, stamped with the drafter's origin and never the repair's", () => {
    const graph = draftGraph();
    const before = (graph.edges as unknown[]).length;

    const result = applyOptionFactorMappings(
      graph,
      [{ option_id: OPT_TWO_DEVS, factor_ids: [FAC_CAPACITY] }],
      2,
      "V1_FLAT",
    );

    expect(result.edgesAdded).toBe(1);
    expect(result.applications).toEqual([
      { option_id: OPT_TWO_DEVS, outcome: "wired", factor_ids: [FAC_CAPACITY] },
    ]);

    const minted = (graph.edges as Array<Record<string, unknown>>)[before]!;
    expect(minted.from).toBe(OPT_TWO_DEVS);
    expect(minted.to).toBe(FAC_CAPACITY);
    expect(minted.origin).toBe(OPTION_MAPPING_RECOVERY_ORIGIN);
    expect(minted.origin).not.toBe("repair");

    // Canonical, or the validator's STRUCTURAL_EDGE_NOT_CANONICAL_ERROR fires and
    // the draft fails closed. Bound to the validator's OWN constant, not to
    // re-typed numbers (trap 12).
    expect(minted.strength_mean).toBe(CANONICAL_EDGE.mean);
    expect(minted.strength_std).toBe(CANONICAL_EDGE.std);
    expect(minted.belief_exists).toBe(CANONICAL_EDGE.prob);
    expect(minted.effect_direction).toBe(CANONICAL_EDGE.direction);

    // ⭐ THE BINDING THAT MATTERS: the estate's ONE authority on "did the repair
    // draw this link" must say no. Asserting the string alone would pass even if
    // that predicate's question changed underneath us.
    const kinds = new Map<string, string>(
      (graph.nodes as Array<{ id: string; kind: string }>).map((n) => [n.id, n.kind]),
    );
    expect(isRepairAuthoredOptionFactorEdge(minted as never, kinds)).toBe(false);
  });

  it("a declined option acquires nothing", () => {
    const graph = draftGraph();
    const before = (graph.edges as unknown[]).length;
    const result = applyOptionFactorMappings(
      graph,
      [{ option_id: OPT_TWO_DEVS, factor_ids: [], declined_reason: "cannot say which" }],
      2,
      "V1_FLAT",
    );
    expect(result.edgesAdded).toBe(0);
    expect(result.applications).toEqual([{ option_id: OPT_TWO_DEVS, outcome: "declined" }]);
    expect((graph.edges as unknown[]).length).toBe(before);
  });

  it("⭐ refuses a NON-SELECTION: naming every factor is the repair's union by another route", () => {
    const graph = draftGraph();
    const before = (graph.edges as unknown[]).length;
    const result = applyOptionFactorMappings(
      graph,
      [{ option_id: OPT_TWO_DEVS, factor_ids: [FAC_CAPACITY, FAC_LEADERSHIP] }],
      2,
      "V1_FLAT",
    );
    expect(result.edgesAdded).toBe(0);
    expect(result.applications).toEqual([
      { option_id: OPT_TWO_DEVS, outcome: "refused_selected_every_factor" },
    ]);
    expect((graph.edges as unknown[]).length).toBe(before);

    // Opposite-direction twin (trap 22b): a PROPER subset of the same size-2
    // factor set is wired. The refusal bounds a non-selection, not a count.
    const ok = applyOptionFactorMappings(
      draftGraph(),
      [{ option_id: OPT_TWO_DEVS, factor_ids: [FAC_CAPACITY] }],
      2,
      "V1_FLAT",
    );
    expect(ok.edgesAdded).toBe(1);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("Stage 3b runner — fails open, always", () => {
  const run = (graph: GraphT | undefined, call?: OptionFactorMapModelCall) =>
    runStageOptionMappingRecovery(makeCtx(graph), call);

  it("applies the mapping on the witnessed shape", async () => {
    const graph = draftGraph();
    const outcome: OptionMappingRecoveryOutcome = await run(
      graph,
      stubCall({ mappings: [{ option_id: OPT_TWO_DEVS, factor_ids: [FAC_CAPACITY] }] }),
    );
    expect(outcome).toBe("applied");
    expect(
      (graph.edges as Array<{ from: string; to: string }>).filter(
        (e) => e.from === OPT_TWO_DEVS && e.to === FAC_CAPACITY,
      ),
    ).toHaveLength(1);
  });

  it("a throwing model leaves the graph byte-identical", async () => {
    const graph = draftGraph();
    const snapshot = JSON.stringify(graph);
    const outcome = await run(graph, async () => {
      throw new Error("upstream_timeout");
    });
    expect(outcome).toBe("model_error");
    expect(JSON.stringify(graph)).toBe(snapshot);
  });

  it("an off-contract response leaves the graph byte-identical", async () => {
    const graph = draftGraph();
    const snapshot = JSON.stringify(graph);
    // factor_ids empty AND no declined_reason — a blank, not a refusal.
    const outcome = await run(
      graph,
      stubCall({ mappings: [{ option_id: OPT_TWO_DEVS, factor_ids: [] }] }),
    );
    expect(outcome).toBe("model_off_contract");
    expect(JSON.stringify(graph)).toBe(snapshot);
  });

  it("makes no call at all when nothing is unmapped", async () => {
    let called = 0;
    const graph = draftGraph({ unmappedInterventions: { [FAC_CAPACITY]: 0.7 } });
    const outcome = await run(graph, async () => {
      called += 1;
      return { content: "{}" };
    });
    expect(outcome).toBe("nothing_unmapped");
    expect(called).toBe(0);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("⭐⭐ THE CHAIN CLAIM — measured through the real readiness producer", () => {
  /**
   * `buildAnalysisReadyPayload` is THE producer of the option status a user
   * sees. These two arms differ in ONE byte-level fact — the `origin` on the
   * unmapped option's edges — which is exactly what Stage 3b changes.
   */
  const v3Option = (id: string, label: string) =>
    ({ id, label, status: "needs_user_mapping", interventions: {} }) as never;

  const v3Graph = (unmappedOrigin: "repair" | "ai") =>
    ({
      nodes: [
        { id: GOAL, kind: "goal", label: "Ship faster" },
        { id: FAC_CAPACITY, kind: "factor", label: "Delivery capacity", data: { value: 0.4 } },
        { id: FAC_LEADERSHIP, kind: "factor", label: "Technical leadership", data: { value: 0.3 } },
        { id: OPT_LEAD, kind: "option", label: "Hire a tech lead" },
        { id: OPT_TWO_DEVS, kind: "option", label: "Hire two developers only" },
      ],
      edges: [
        { from: OPT_LEAD, to: FAC_LEADERSHIP, origin: "ai" },
        { from: OPT_TWO_DEVS, to: FAC_CAPACITY, origin: unmappedOrigin },
      ],
    }) as never;

  const statusOf = (unmappedOrigin: "repair" | "ai") => {
    const payload = buildAnalysisReadyPayload(
      [v3Option(OPT_LEAD, "Hire a tech lead"), v3Option(OPT_TWO_DEVS, "Hire two developers only")],
      GOAL,
      v3Graph(unmappedOrigin),
    );
    // Bind by IDENTITY (trap 19) — the option id, never a status predicate a
    // sibling could satisfy.
    const hit = payload.options.filter((o) => o.id === OPT_TWO_DEVS);
    expect(hit).toHaveLength(1);
    return hit[0]!.status;
  };

  it("TODAY, with the repair's edge: the option is needs_user_mapping", () => {
    expect(statusOf("repair")).toBe("needs_user_mapping");
  });

  it("⭐ AFTER STAGE 3b, with the drafter's edge: the option is needs_encoding", () => {
    // The whole value of Limb A in one assertion. `needs_encoding` is the state
    // whose readiness blocker carries a `factor_id`, which is what lets the
    // ALREADY-WIRED estimate batch propose a magnitude for it under review
    // (`readiness-value-batch.ts:294-313`). `needs_user_mapping` carries none and
    // lands in `unsettable{reason:'factor_unknown'}`.
    expect(statusOf("ai")).toBe("needs_encoding");
  });
});
