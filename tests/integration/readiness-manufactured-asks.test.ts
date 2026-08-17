/**
 * ⭐ ROADMAP 2.1266 — THE DETERMINISTIC SWEEP MUST NOT MANUFACTURE WORK FOR THE USER.
 *
 * THE DEFECT: `fixStatusQuoConnectivity` wires each DISCONNECTED option to the
 * UNION of every factor the CONNECTED options target, with no intervention value.
 * Readiness then minted one `MISSING_OPTION_VALUE` ask per manufactured edge, so
 * **the product asked the user to supply effect values for links it had drawn
 * itself, in the user's own name, with nothing saying so.**
 *
 * ── WHY THIS SUITE IS TWO-ARM, AND WHY ARM B IS THE LOAD-BEARING ONE ─────────
 * MEASURED at pristine `8be62df9` in an isolated worktree, arm B's shape:
 *
 *   PRE-SWEEP   total=2  content=["-::fac_u1","-::fac_u2"]        status=needs_user_mapping
 *               questions=["Which factors and values should be specified for: Hold position?"]
 *   POST-SWEEP  total=2  content=["opt_hold::fac_f1","opt_hold::fac_f2"]  status=needs_user_input
 *               questions=[]
 *
 * **THE TOTAL DID NOT MOVE.** Two factor-level asks were removed by the sweep at
 * the same moment two manufactured option×factor asks were added, so every
 * aggregate — count, status-is-non-ready, "blockers exist" — reads IDENTICAL
 * across the defect. Only CONTENT exposes it. That is why no assertion in this
 * file counts blockers as its primary evidence, and why the honest question's
 * SURVIVAL is asserted: the defect silently deleted it (`questions=[]`), which is
 * the harm an aggregate can never see. (CLAUDE.md: an aggregate cannot see it;
 * trap 13e's kin — a probe that returns the same number either way is not
 * evidence about the world.)
 *
 * Arm A is the visible case (brief-04 shape, 2 disconnected options × 7 union
 * targets = 14 manufactured asks, 8→21 in the row's own measurement).
 *
 * ── THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT THE FAILURE MODE (trap 13d) ─
 * Not "there are no longer 14 asks" — that is the symptom's metric (trap 23).
 * The spec: EVERY option-scoped ask must be grounded in an option→factor link the
 * product did not author. `assertNoManufacturedAsks` states exactly that, over
 * the WHOLE blocker set, and is applied in both arms.
 *
 * ── THE DISCRIMINATION THAT KEEPS THIS HONEST (trap 19, and it is not optional) ─
 * `drafter-authored option→factor edges with no value STILL mint their ask`.
 * Without it, deleting the entire blocker loop would satisfy every other test
 * here. That case is the GREEN half of the discriminating pair: the guard must be
 * bound to repair-authored edges BY PROVENANCE, never to "an ask I would rather
 * not make".
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn(() => 0),
  TelemetryEvents: {},
}));

vi.mock("../../src/config/index.js", () => ({
  config: { cee: {}, features: { optionShortcutRepair: true } },
  isProduction: () => false,
}));

import { runDeterministicSweep } from "../../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { buildAnalysisReadyPayload } from "../../src/cee/transforms/analysis-ready.js";
import { transformResponseToV3 } from "../../src/cee/transforms/schema-v3.js";
import { assessCanonicalAnalysisReadiness } from "../../src/orchestrator/tools/analysis-ready-helper.js";
import { EdgeOrigin } from "../../src/schemas/graph.js";
import {
  REPAIR_AUTHORED_ORIGIN,
  isRepairAuthoredOptionFactorEdge,
} from "../../src/graph/repair-authored-edge.js";

// Kept adjacent to the kernel import so the reader sees the relationship: the
// suite's oracle is INDEPENDENT of the predicate, and one test below checks the
// two agree. Independence and agreement are different claims and this file makes
// both, separately.

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

interface AnyEdge { from: string; to: string; origin?: unknown }

/**
 * ⚠ THE CLASSIFIER BELOW IS DELIBERATELY TEST-LOCAL AND DOES NOT CALL THE
 * PRODUCTION PREDICATE — the whole point is an INDEPENDENT oracle.
 *
 * An earlier draft of this suite routed its edge classification through
 * `isRepairAuthoredOptionFactorEdge`, and a mutation run exposed it: mutating the
 * predicate moved the MEASUREMENT and the SUBJECT together, so two assertions
 * were checking that the code agreed with itself (trap 13b, "a guard agreeing
 * with itself"). Ground truth here is the literal marker the producer writes
 * (`status-quo-fix.ts:200`), spelled out, so a predicate that drifts from the
 * producer's own stamp REDs instead of redefining the question.
 */
const PRODUCER_REPAIR_ORIGIN_LITERAL = "repair";

function isManufacturedEdgeByGroundTruth(
  edge: AnyEdge,
  kind: ReadonlyMap<string, string>,
): boolean {
  return (
    kind.get(edge.from) === "option"
    && kind.get(edge.to) === "factor"
    && edge.origin === PRODUCER_REPAIR_ORIGIN_LITERAL
  );
}

/**
 * THE SPEC. Every option-scoped `missing_value` ask must be grounded in at least
 * one option→factor edge the product did not author. An ask whose ONLY supporting
 * edge is repair-authored is the product billing the user for its own invention.
 *
 * Returns the offending `option::factor` pairs so a failure NAMES them (binding
 * by identity, never by count — trap 19).
 */
function manufacturedAskPairs(graph: { nodes: any[]; edges: AnyEdge[] }, payload: any): string[] {
  const kind = new Map<string, string>(graph.nodes.map((n: any) => [n.id, n.kind]));
  const offending: string[] = [];
  for (const blocker of payload.blockers ?? []) {
    if (blocker.blocker_type !== "missing_value") continue;
    const optionId = blocker.option_id;
    const factorId = blocker.factor_id;
    // A factor-level ask ("this factor is connected to no option") is a different,
    // legitimate blocker and is deliberately out of scope here.
    if (typeof optionId !== "string" || typeof factorId !== "string") continue;
    const supporting = graph.edges.filter((e) => e.from === optionId && e.to === factorId);
    const stated = supporting.filter((e) => !isManufacturedEdgeByGroundTruth(e, kind));
    if (stated.length === 0) offending.push(`${optionId}::${factorId}`);
  }
  return offending;
}

function assertNoManufacturedAsks(graph: any, payload: any): void {
  expect(manufacturedAskPairs(graph, payload)).toEqual([]);
}

function repairAuthoredOptionFactorEdges(graph: any): string[] {
  const kind = new Map<string, string>(graph.nodes.map((n: any) => [n.id, n.kind]));
  return graph.edges
    .filter((e: AnyEdge) => isManufacturedEdgeByGroundTruth(e, kind))
    .map((e: AnyEdge) => `${e.from}→${e.to}`);
}

function optionScopedMissingValuePairs(payload: any): string[] {
  return (payload.blockers ?? [])
    .filter((b: any) => b.blocker_type === "missing_value" && typeof b.option_id === "string")
    .map((b: any) => `${b.option_id}::${b.factor_id}`);
}

function valuedIntervention(factorId: string, value: number) {
  return { value, target_match: { node_id: factorId, match_type: "exact_id", confidence: "high" } };
}

// ---------------------------------------------------------------------------
// Arm A — brief-04 shape: the manufacture is VISIBLE in the totals (8 → 21)
// ---------------------------------------------------------------------------

const ARM_A_FACTORS = ["price", "reach", "margin", "churn", "capex", "speed", "brand"] as const;

function armAGraph(): any {
  const nodes: any[] = [
    { id: "dec_1", kind: "decision", label: "Which channel strategy?" },
    { id: "opt_a", kind: "option", label: "Direct sales" },
    { id: "opt_b", kind: "option", label: "Partner channel" },
    { id: "opt_c", kind: "option", label: "Hold position" },
    { id: "opt_d", kind: "option", label: "Hybrid pilot" },
    { id: "out_1", kind: "outcome", label: "Contribution" },
    { id: "goal_1", kind: "goal", label: "Maximise contribution" },
  ];
  const edges: any[] = ["opt_a", "opt_b", "opt_c", "opt_d"].map((o) => ({
    from: "dec_1", to: o, strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive",
  }));
  for (const f of ARM_A_FACTORS) {
    nodes.push({
      id: `fac_${f}`, kind: "factor", label: f, category: "controllable",
      data: { value: 0.5, extractionType: "inferred" }, observed_state: { value: 0.5 },
    });
    edges.push({ from: `fac_${f}`, to: "out_1", strength_mean: 0.4, strength_std: 0.15, belief_exists: 0.9, effect_direction: "positive" });
    // opt_a and opt_b state a lever on every factor → union of connected targets = 7
    edges.push({ from: "opt_a", to: `fac_${f}`, strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" });
    edges.push({ from: "opt_b", to: `fac_${f}`, strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" });
  }
  edges.push({ from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" });
  return { version: "1", default_seed: 42, nodes, edges, meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" } };
}

function armAOptions(): any[] {
  const valued = (id: string, label: string) => {
    const interventions: Record<string, unknown> = {};
    for (const f of ARM_A_FACTORS) interventions[`fac_${f}`] = valuedIntervention(`fac_${f}`, 0.6);
    return { id, label, status: undefined, interventions };
  };
  return [
    valued("opt_a", "Direct sales"),
    valued("opt_b", "Partner channel"),
    { id: "opt_c", label: "Hold position", status: undefined, interventions: {} },
    { id: "opt_d", label: "Hybrid pilot", status: undefined, interventions: {} },
  ];
}

describe("2.1266 arm A — brief-04 shape (manufacture visible in totals)", () => {
  it("the sweep wires the two disconnected options to all seven union targets", async () => {
    const graph = armAGraph();
    const ctx: any = { graph, requestId: "2p1266-arm-a-edges", repairTrace: {} };
    await runDeterministicSweep(ctx);

    // Identity, not count: the exact pairs the repair authored. `#disconnected ×
    // |union \ already-targeted|` = 2 × 7.
    expect(repairAuthoredOptionFactorEdges(graph).sort()).toEqual(
      [
        ...ARM_A_FACTORS.map((f) => `opt_c→fac_${f}`),
        ...ARM_A_FACTORS.map((f) => `opt_d→fac_${f}`),
      ].sort(),
    );
    // The wiring stays DISCLOSED on the channel the UI renders
    // (`stages/package.ts:751-752`) — this fix suppresses the ask, never the record.
    expect(
      (ctx.deterministicRepairs ?? []).filter((r: any) => r.code === "STATUS_QUO_WIRED"),
    ).toHaveLength(2);
  });

  it("mints ZERO asks for the manufactured links, and keeps the model non-ready", async () => {
    const graph = armAGraph();
    const ctx: any = { graph, requestId: "2p1266-arm-a-asks", repairTrace: {} };
    await runDeterministicSweep(ctx);

    const payload: any = buildAnalysisReadyPayload(armAOptions() as any, "goal_1", graph as any);

    assertNoManufacturedAsks(graph, payload);
    expect(optionScopedMissingValuePairs(payload)).toEqual([]);

    // ⚠ THE SAFETY PROPERTY, asserted explicitly because it is the one outcome
    // that would make this fix WORSE than the defect: suppressing the asks must
    // NOT promote the model to `ready` with options that have no lever at all —
    // the numerically-inert-option harm the NO-SILENT-INVENTION block in
    // `transforms/analysis-ready.ts` was written to remove. An option with empty
    // `interventions` keeps `hasIncompleteOptions` true, so the status floor holds.
    expect(payload.status).toBe("needs_user_mapping");
    expect(payload.status).not.toBe("ready");
    for (const optionId of ["opt_c", "opt_d"]) {
      const option = payload.options.find((o: any) => o.id === optionId);
      expect(option?.status).toBe("needs_user_mapping");
    }
  });

  it("asks the ONE true question instead — naming the options by label", async () => {
    const graph = armAGraph();
    const ctx: any = { graph, requestId: "2p1266-arm-a-question", repairTrace: {} };
    await runDeterministicSweep(ctx);

    const payload: any = buildAnalysisReadyPayload(armAOptions() as any, "goal_1", graph as any);
    const questions: string[] = payload.user_questions ?? [];

    // The honest ask exists and names the options whose lever is genuinely
    // unknown. Bound by LABEL identity, not by "some question was asked".
    expect(questions.length).toBeGreaterThan(0);
    const joined = questions.join(" | ");
    expect(joined).toContain("Hold position");
    expect(joined).toContain("Hybrid pilot");
  });
});

// ---------------------------------------------------------------------------
// Arm B — brief-08 shape: the manufacture is INVISIBLE in the totals (2 → 2)
// ---------------------------------------------------------------------------

function armBGraph(): any {
  const nodes: any[] = [
    { id: "dec_1", kind: "decision", label: "Channel strategy?" },
    { id: "opt_a", kind: "option", label: "Direct" },
    { id: "opt_b", kind: "option", label: "Partner" },
    { id: "opt_hold", kind: "option", label: "Hold position" },
    { id: "fac_f1", kind: "factor", label: "Price", category: "controllable", data: { value: 0.5 }, observed_state: { value: 0.5 } },
    { id: "fac_f2", kind: "factor", label: "Reach", category: "controllable", data: { value: 0.5 }, observed_state: { value: 0.5 } },
    // Two controllable factors with no option edge and no path to goal. The sweep
    // removes them, which removes their two FACTOR-LEVEL asks in the same pass
    // that the status-quo repair adds two OPTION-LEVEL ones. That cancellation is
    // the mask.
    { id: "fac_u1", kind: "factor", label: "Legacy tooling", category: "controllable", data: { value: 0.3 }, observed_state: { value: 0.3 } },
    { id: "fac_u2", kind: "factor", label: "Vendor lock-in", category: "controllable", data: { value: 0.2 }, observed_state: { value: 0.2 } },
    { id: "out_1", kind: "outcome", label: "Contribution" },
    { id: "goal_1", kind: "goal", label: "Maximise contribution" },
  ];
  const edges: any[] = [
    ...["opt_a", "opt_b", "opt_hold"].map((o) => ({
      from: "dec_1", to: o, strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive",
    })),
    { from: "opt_a", to: "fac_f1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { from: "opt_a", to: "fac_f2", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { from: "opt_b", to: "fac_f1", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { from: "opt_b", to: "fac_f2", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
    { from: "fac_f1", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
    { from: "fac_f2", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
    { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
  ];
  return { version: "1", default_seed: 42, nodes, edges, meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" } };
}

function armBOptions(): any[] {
  const valued = (id: string, label: string) => ({
    id, label, status: undefined,
    interventions: {
      fac_f1: valuedIntervention("fac_f1", 0.6),
      fac_f2: valuedIntervention("fac_f2", 0.7),
    },
  });
  return [
    valued("opt_a", "Direct"),
    valued("opt_b", "Partner"),
    { id: "opt_hold", label: "Hold position", status: undefined, interventions: {} },
  ];
}

describe("2.1266 arm B — brief-08 shape (manufacture INVISIBLE in totals)", () => {
  it("pins the cancellation that hides the defect from every aggregate", async () => {
    const graph = armBGraph();
    const before: any = buildAnalysisReadyPayload(armBOptions() as any, "goal_1", graph as any);

    // Pre-sweep: two FACTOR-level asks, no option scoped to either.
    const beforeFactorLevel = (before.blockers ?? []).filter(
      (b: any) => b.blocker_type === "missing_value" && b.option_id === undefined,
    );
    expect(beforeFactorLevel.map((b: any) => b.factor_id).sort()).toEqual(["fac_u1", "fac_u2"]);
    expect(optionScopedMissingValuePairs(before)).toEqual([]);

    const ctx: any = { graph, requestId: "2p1266-arm-b-mask", repairTrace: {} };
    await runDeterministicSweep(ctx);

    // THE MASK, asserted as the ARITHMETIC rather than as a historical number:
    // the repair authors exactly as many option→factor edges as the sweep removed
    // factor-level asks, so a count-based guard cancels to zero change. Measured
    // at pristine `8be62df9`: 2 blockers before, 2 after, entirely different
    // content. Pin the mechanism, and a future graph that changes the arithmetic
    // REDs here rather than silently weakening arm B into a tautology (trap 12b).
    const manufactured = repairAuthoredOptionFactorEdges(graph);
    expect(manufactured.sort()).toEqual(["opt_hold→fac_f1", "opt_hold→fac_f2"]);
    expect(manufactured).toHaveLength(beforeFactorLevel.length);
  });

  it("mints no manufactured ask, and the honest question SURVIVES the sweep", async () => {
    const graph = armBGraph();
    const ctx: any = { graph, requestId: "2p1266-arm-b-content", repairTrace: {} };
    await runDeterministicSweep(ctx);

    const after: any = buildAnalysisReadyPayload(armBOptions() as any, "goal_1", graph as any);

    // The content assertion the totals cannot make.
    assertNoManufacturedAsks(graph, after);
    expect(optionScopedMissingValuePairs(after)).toEqual([]);

    // ⭐ THE ASSERTION THAT CATCHES WHAT THE COUNT CANNOT. At pristine the defect
    // escalated the payload to `needs_user_input`, which SUPPRESSES
    // `user_questions` entirely (`transforms/analysis-ready.ts` only populates it
    // for `needs_user_mapping`) — measured `questions=[]`. So the manufactured
    // asks did not merely ADD work, they DELETED the one true question. Both
    // halves are asserted: the status floor, and the question's content.
    expect(after.status).toBe("needs_user_mapping");
    expect(after.status).not.toBe("needs_user_input");
    expect((after.user_questions ?? []).join(" | ")).toContain("Hold position");
  });
});

// ---------------------------------------------------------------------------
// The discrimination — the guard must be bound to PROVENANCE, not to convenience
// ---------------------------------------------------------------------------

describe("2.1266 — the suppression is bound to repair provenance, not to unvalued edges", () => {
  it("a DRAFTER-authored option→factor edge with no value STILL mints its ask", () => {
    // GREEN half of the discriminating pair (trap 19). Identical shape to a
    // manufactured edge in every respect a lazy predicate might key on — an
    // option→factor edge whose option has no intervention for that factor — and
    // differing ONLY in `origin`. If this goes silent, the fix has stopped being
    // a provenance rule and become "ask the user less", which is the opposite of
    // the intent.
    const graph = armBGraph();
    graph.edges.push({
      from: "opt_hold", to: "fac_f1",
      strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive",
      origin: "ai",
      provenance: { source: "cee_hypothesis", quote: "The brief implies holding still moves price" },
    });

    const payload: any = buildAnalysisReadyPayload(armBOptions() as any, "goal_1", graph as any);

    expect(optionScopedMissingValuePairs(payload)).toEqual(["opt_hold::fac_f1"]);
    // And it is NOT a manufactured ask: a stated edge grounds it.
    assertNoManufacturedAsks(graph, payload);
  });

  it("suppresses the SAME edge once its origin is the repair's", () => {
    // RED half: byte-identical to the case above but for `origin`.
    const graph = armBGraph();
    graph.edges.push({
      from: "opt_hold", to: "fac_f1",
      strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive",
      origin: REPAIR_AUTHORED_ORIGIN,
      provenance: { source: "synthetic", quote: "Status-quo option wired to factor" },
      provenance_source: "synthetic",
    });

    const payload: any = buildAnalysisReadyPayload(armBOptions() as any, "goal_1", graph as any);

    expect(optionScopedMissingValuePairs(payload)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// The V5 Run-admission path — the SAME manufacture, a DIFFERENT harm
// ---------------------------------------------------------------------------

/** A PERSISTED graph as V5 Run admission receives it: option nodes, no top-level `options[]`. */
function persistedRunGraph(): any {
  return {
    nodes: [
      { id: "dec_1", kind: "decision", label: "Channel strategy?" },
      { id: "opt_a", kind: "option", label: "Direct", data: { interventions: { fac_f1: 0.6 } } },
      { id: "opt_hold", kind: "option", label: "Hold position" },
      { id: "fac_f1", kind: "factor", label: "Price", category: "controllable", observed_state: { value: 0.5 } },
      { id: "out_1", kind: "outcome", label: "Contribution" },
      { id: "goal_1", kind: "goal", label: "Maximise contribution" },
    ],
    edges: [
      { from: "dec_1", to: "opt_a", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "dec_1", to: "opt_hold", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      { from: "opt_a", to: "fac_f1", strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: "positive" },
      // The manufactured link exactly as it appears on the V3 wire — note the
      // provenance is ALREADY `cee_hypothesis`, which is the whole reason the
      // predicate reads `origin`.
      {
        from: "opt_hold", to: "fac_f1", strength: { mean: 1, std: 0.01 }, exists_probability: 1,
        effect_direction: "positive", origin: REPAIR_AUTHORED_ORIGIN,
        provenance: { source: "cee_hypothesis", reasoning: "Status-quo option wired to factor" },
      },
      { from: "fac_f1", to: "out_1", strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.9, effect_direction: "positive" },
      { from: "out_1", to: "goal_1", strength: { mean: 0.9, std: 0.05 }, exists_probability: 1, effect_direction: "positive" },
    ],
  };
}

describe("2.1266 — V5 Run admission asks the right question, not a manufactured one", () => {
  it("replaces the invented per-factor ask with the true per-option one", () => {
    // MEASURED at pristine `8be62df9` on this exact graph, the defect produced:
    //   status  needs_user_input
    //   issues  MISSING_OPTION_VALUE opt_hold/fac_f1
    //           "Choose the missing effect value for \"Hold position\" on \"Price\"."
    //   option  opt_hold → needs_encoding
    // …i.e. it did not merely add an ask, it SWAPPED THE QUESTION CLASS. A
    // repair-wired option was reported as needing its values ENCODED, when
    // nothing had been stated to encode. `needs_encoding` is unanswerable here;
    // `needs_user_mapping` is the question the user can actually act on.
    const assessment: any = assessCanonicalAnalysisReadiness(persistedRunGraph());
    const issues: any[] = assessment.issues ?? [];
    const forHold = issues.filter((i) => i.option_id === "opt_hold");

    expect(forHold.map((i) => i.code)).toEqual(["OPTION_NEEDS_MAPPING"]);
    expect(forHold[0].message).toContain("Choose which factor");
    expect(forHold[0].message).toContain("Hold position");

    // The manufactured pair is named nowhere.
    expect(
      issues.filter((i) => i.code === "MISSING_OPTION_VALUE" && i.option_id === "opt_hold"),
    ).toEqual([]);
    expect(optionScopedMissingValuePairs(assessment.analysisReady ?? {})).toEqual([]);

    const hold = (assessment.analysisReady?.options ?? []).find(
      (o: any) => (o.option_id ?? o.id) === "opt_hold",
    );
    expect(hold?.status).toBe("needs_user_mapping");
    expect(hold?.status).not.toBe("needs_encoding");
  });
});

// ---------------------------------------------------------------------------
// The discriminator pin — why `origin` and not `provenance.source`
// ---------------------------------------------------------------------------

describe("2.1266 — `origin` is the only discriminator that survives to readiness", () => {
  it("the kernel's predicate agrees with the producer's own literal marker", () => {
    // The AGREEMENT check, stated separately from the independence above. The
    // suite's oracle spells the producer's marker literally; this asserts the
    // shipped predicate classifies the same edge the same way — so the two can
    // never quietly diverge, and the kernel itself stays directly covered.
    expect(REPAIR_AUTHORED_ORIGIN).toBe(PRODUCER_REPAIR_ORIGIN_LITERAL);

    const kind = new Map<string, string>([["opt_x", "option"], ["fac_y", "factor"]]);
    const manufactured = { from: "opt_x", to: "fac_y", origin: REPAIR_AUTHORED_ORIGIN };
    const drafted = { from: "opt_x", to: "fac_y", origin: "ai" };

    expect(isRepairAuthoredOptionFactorEdge(manufactured, kind)).toBe(true);
    expect(isManufacturedEdgeByGroundTruth(manufactured, kind)).toBe(true);
    expect(isRepairAuthoredOptionFactorEdge(drafted, kind)).toBe(false);
    expect(isManufacturedEdgeByGroundTruth(drafted, kind)).toBe(false);

    // The kind conjunction is load-bearing in the kernel even though both current
    // call sites pre-gate the kinds: it is what stops a future caller suppressing
    // a factor→outcome repair edge's obligations, which are a different question.
    const wrongKinds = new Map<string, string>([["fac_a", "factor"], ["out_b", "outcome"]]);
    expect(
      isRepairAuthoredOptionFactorEdge(
        { from: "fac_a", to: "out_b", origin: REPAIR_AUTHORED_ORIGIN },
        wrongKinds,
      ),
    ).toBe(false);
  });

  it("`repair` is a live member of the contract's EdgeOrigin vocabulary", () => {
    // Runtime half of the kernel's compile-time derivation. Together they mean a
    // vocabulary change cannot leave the predicate silently matching nothing
    // (trap 12: derive, and fail loud on drift).
    expect(EdgeOrigin.options).toContain(REPAIR_AUTHORED_ORIGIN);
  });

  it("the V3 transform KEEPS `origin` and COERCES provenance.source away from `synthetic`", () => {
    // ⚠ THE REFUTATION THIS TEST EXISTS TO PIN. The repair stamps its edges
    // `provenance.source: "synthetic"`, so keying the fix on that string is the
    // obvious implementation — AND IT WOULD NEVER FIRE. `EdgeV3.provenance.source`
    // is a closed four-member enum with no `synthetic`, and
    // `mapToV3ProvenanceSource` defaults unknown sources to `cee_hypothesis`. On
    // the wire readiness reads, a manufactured edge is provenance-identical to any
    // AI-hypothesised one. If this test ever goes red because `synthetic` now
    // survives, the kernel's comment — not just its predicate — needs revisiting.
    const v1: any = {
      graph: {
        version: "1", default_seed: 42,
        nodes: [
          { id: "dec_1", kind: "decision", label: "D" },
          { id: "opt_a", kind: "option", label: "A", data: { interventions: { fac_x: 0.4 } } },
          { id: "opt_c", kind: "option", label: "C" },
          { id: "fac_x", kind: "factor", label: "X", category: "controllable", data: { value: 0.5, extractionType: "inferred" } },
          { id: "out_1", kind: "outcome", label: "O" },
          { id: "goal_1", kind: "goal", label: "G" },
        ],
        edges: [
          { from: "dec_1", to: "opt_a", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "dec_1", to: "opt_c", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          { from: "opt_a", to: "fac_x", strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive" },
          {
            from: "opt_c", to: "fac_x",
            strength_mean: 1, strength_std: 0.01, belief_exists: 1, effect_direction: "positive",
            origin: REPAIR_AUTHORED_ORIGIN,
            provenance: { source: "synthetic", quote: "Status-quo option wired to factor" },
            provenance_source: "synthetic",
          },
          { from: "fac_x", to: "out_1", strength_mean: 0.5, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" },
          { from: "out_1", to: "goal_1", strength_mean: 0.9, strength_std: 0.05, belief_exists: 1, effect_direction: "positive" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      },
      quality: { overall: 7, structure: 7, coverage: 7, structural_proxy: 7 },
      trace: {
        request_id: "2p1266-discriminator", correlation_id: "2p1266-discriminator",
        engine: { provider: "openai", model: "gpt-4.1", version: "1.0.0" },
        goal_handling: { goal_source: "llm_generated", retry_attempted: false },
      },
    };

    const v3: any = transformResponseToV3(v1, { requestId: "2p1266-discriminator" });
    const edge = v3.edges.find((e: any) => e.from === "opt_c" && e.to === "fac_x");

    expect(edge).toBeDefined();
    expect(edge.origin).toBe(REPAIR_AUTHORED_ORIGIN);
    expect(edge.provenance?.source).toBe("cee_hypothesis");
    expect(edge.provenance?.source).not.toBe("synthetic");

    // …and end-to-end through the real transform, the manufactured link mints no ask.
    expect(optionScopedMissingValuePairs(v3.analysis_ready ?? {})).toEqual([]);
  });
});
