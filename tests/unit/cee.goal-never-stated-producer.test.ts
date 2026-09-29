/**
 * ROADMAP goalfence — AT THE REAL PRODUCER'S BYTES.
 *
 * `self-inflicted-goal-gap.test.ts` pins the predicate in isolation. A
 * predicate that is right about hand-built inputs proves nothing about the
 * graph the pipeline ACTUALLY holds at the block site (trap 16: a fixture you
 * wrote yourself is not evidence about the producer). This spec drives the REAL
 * `applyDeterministicEnforcement` — real deterministic validator, real
 * `buildCeeErrorResponse`, real config — into its fail-closed path, and asserts
 * the stamp on what it actually emitted.
 *
 * ⭐ THE DISCRIMINATING PAIR IS THE WHOLE INSTRUMENT. Both arms use the SAME
 * blocked topology and differ in ONE field — the goal's label. If the stamp
 * appeared on both, it would be measuring "did the gate fire?" (which
 * `isEnforcementBlockedResult` already answers) rather than "is the unreached
 * goal ours?". One arm alone could not tell those apart.
 *
 * Fixture provenance: the blocked topology is the live `fac_ownership` shape
 * from request d88c4376 (day-3 drafting matrix), carried over from
 * `cee.enforcement-auto-retry-producer-agreement.test.ts` so both specs bind to
 * one measured failure rather than two invented ones.
 *
 * RED at pristine 2212ae05: `goal_never_stated` is never stamped, so the
 * self-inflicted arm reads `undefined` and the retry is funded.
 */

import { describe, it, expect, vi } from "vitest";

// Silence pino only. Validator, config and error-envelope builder are REAL.
vi.mock("../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  calculateCost: vi.fn().mockReturnValue(0),
  TelemetryEvents: {
    CeeInboundSumRescaled: "cee.draft_graph.inbound_sum_rescaled",
    CeeBridgeChainRepaired: "cee.draft_graph.bridge_chain_repaired",
    CeeEnforcementCompleted: "cee.draft_graph.enforcement_completed",
    CeeEnforcementEdgeSkipped: "cee.draft_graph.enforcement_edge_skipped",
    CeeEnforcementPostValidationErrors: "cee.draft_graph.enforcement_post_validation_errors",
    CeeEnforcementPostValidationWarnings: "cee.draft_graph.enforcement_post_validation_warnings",
    CeeEnforcementPostValidationFailed: "cee.draft_graph.enforcement_post_validation_failed",
    CeeEnforcementBlocked: "cee.draft_graph.enforcement_blocked",
  },
}));

import {
  applyDeterministicEnforcement,
  isEnforcementBlockedResult,
  readEnforcementBlockCodes,
  readGoalNeverStated,
} from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { decideDraftAutoRetry } from "../../src/cee/unified-pipeline/draft-auto-retry.js";
import { DEFAULT_GOAL_LABEL } from "../../src/cee/structure/goal-inference.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";

const FACTOR_DATA = {
  value: 0.5,
  extractionType: "inferred",
  factor_type: "continuous",
  uncertainty_drivers: ["market variation"],
} as const;

const STRUCTURAL_EDGE = {
  strength_mean: 1,
  strength_std: 0.01,
  belief_exists: 1,
  effect_direction: "positive",
} as const;

function causal(mean: number) {
  return {
    strength_mean: mean,
    strength_std: 0.1,
    belief_exists: 0.9,
    effect_direction: "positive",
  } as const;
}

/**
 * ONE topology, TWO goals.
 *
 * `fac_ownership` is controllable and pathless to the goal, which is what
 * blocks (`NO_PATH_TO_GOAL`). Both options intervene on the goal-connected
 * `fac_cost`, so `NO_EFFECT_PATH` stays clear and the blocking set is purely
 * goal-connectivity — the shape the fence is for.
 *
 * `mintedGoal` is the ONLY thing that varies between arms.
 */
function makeCtx(mintedGoal: boolean): StageContext {
  const nodes = [
    { id: "dec_van", kind: "decision", label: "Van decision" },
    { id: "opt_buy", kind: "option", label: "Buy the van" },
    { id: "opt_lease", kind: "option", label: "Lease the van" },
    { id: "fac_cost", kind: "factor", label: "Upfront cost", category: "controllable", data: FACTOR_DATA },
    {
      id: "fac_ownership",
      kind: "factor",
      label: "Ownership",
      category: "controllable",
      data: FACTOR_DATA,
    },
    { id: "out_margin", kind: "outcome", label: "Monthly margin" },
    mintedGoal
      ? {
          // What `ensureGoalNode` mints when the brief designates no objective.
          id: "goal_inferred",
          kind: "goal",
          label: DEFAULT_GOAL_LABEL,
          provenance: { provenance_class: "projector_structural", source: "synthetic" },
        }
      : {
          // A goal the user actually stated — same topology, real objective.
          id: "goal_margin",
          kind: "goal",
          label: "Protect margin",
          source_quote: "protect margin",
          provenance: { provenance_class: "stated" },
        },
  ];
  const goalId = mintedGoal ? "goal_inferred" : "goal_margin";
  const edges: Array<Record<string, unknown>> = [
    { from: "dec_van", to: "opt_buy", ...STRUCTURAL_EDGE },
    { from: "dec_van", to: "opt_lease", ...STRUCTURAL_EDGE },
    { from: "opt_buy", to: "fac_cost", ...STRUCTURAL_EDGE },
    { from: "opt_lease", to: "fac_cost", ...STRUCTURAL_EDGE },
    { from: "opt_buy", to: "fac_ownership", ...STRUCTURAL_EDGE },
    { from: "opt_lease", to: "fac_ownership", ...STRUCTURAL_EDGE },
    { from: "fac_cost", to: "out_margin", ...causal(0.6) },
    { from: "out_margin", to: goalId, ...causal(0.7) },
  ];
  return {
    requestId: `req-goalfence-${mintedGoal ? "minted" : "stated"}`,
    graph: {
      version: "1",
      default_seed: 17,
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      nodes,
      edges,
    },
    detectedEdgeFormat: "V1_FLAT",
    deterministicRepairs: [],
    repairTrace: {},
  } as unknown as StageContext;
}

describe("goalfence — the real enforcement gate stamps a self-inflicted block", () => {
  it("SELF-INFLICTED: the block carries goal_never_stated when the unreached goal is CEE's own placeholder", () => {
    const ctx = makeCtx(true);
    applyDeterministicEnforcement(ctx);

    // POSITIVE CONTROL — without this every assertion below is vacuous
    // (trap 13: an absence probe must first prove it can see a presence).
    expect(ctx.earlyReturn, "fixture must actually block").toBeDefined();
    expect(isEnforcementBlockedResult(ctx.earlyReturn!)).toBe(true);

    // PRECONDITION PINNED IN-TEST: assert the payload is the shape the fence is
    // for, so a green result is provably the predicate's doing and not the
    // fixture quietly drifting to some other blocking code (trap 13b).
    const codes = readEnforcementBlockCodes(ctx.earlyReturn!.body);
    expect(codes.length).toBeGreaterThan(0);
    expect(codes.every((c) => c === "NO_PATH_TO_GOAL" || c === "NO_EFFECT_PATH")).toBe(true);

    expect(readGoalNeverStated(ctx.earlyReturn!.body)).toBe(true);
  });

  /**
   * ⭐ THE TWIN. Same topology, same blocking codes, REAL goal — and the stamp
   * must be absent. Without this the spec above would pass on a stamp that
   * fired unconditionally.
   */
  it("CONTRAST: an identical block on a USER-STATED goal carries no stamp", () => {
    const ctx = makeCtx(false);
    applyDeterministicEnforcement(ctx);

    expect(ctx.earlyReturn, "contrast fixture must also block").toBeDefined();
    expect(isEnforcementBlockedResult(ctx.earlyReturn!)).toBe(true);

    // The contrast blocks for the SAME reason — so the only difference between
    // the arms is who authored the goal.
    const codes = readEnforcementBlockCodes(ctx.earlyReturn!.body);
    expect(codes.every((c) => c === "NO_PATH_TO_GOAL" || c === "NO_EFFECT_PATH")).toBe(true);

    expect(readGoalNeverStated(ctx.earlyReturn!.body)).toBe(false);
  });
});

describe("goalfence — the retry is not funded for a failure a re-draft cannot fix", () => {
  /**
   * MEASURED on build 2212ae0: the retry ran on all 11 captured short-brief
   * failures (`{attempted: true, attempts: 2}`, zero `skipped_reason`),
   * returned IDENTICAL codes both times, rescued 0 of 11, and spent ~18s.
   * The placeholder goal is minted deterministically, so attempt 2 starts from
   * the same contentless goal as attempt 1.
   */
  it("SELF-INFLICTED: the decision declines, naming the reason", () => {
    const ctx = makeCtx(true);
    applyDeterministicEnforcement(ctx);
    expect(ctx.earlyReturn, "fixture must actually block").toBeDefined();

    // 28_300ms is the BASELINE worst-case failure latency at which the retry
    // WAS funded before this change — so a decline here cannot be the budget
    // conjunct firing by accident.
    const decision = decideDraftAutoRetry(ctx.earlyReturn!, 28_300);
    expect(decision.retry).toBe(false);
    expect(decision.retry === false && decision.reason).toBe("goal_never_stated");
  });

  /**
   * ⭐ THE TWIN, AND IT IS THE ONE THAT PROVES THE FENCE IS NARROW. The
   * stochastic classes must still get their retry at the same latency — a fix
   * that quietly stopped funding every post-enforcement retry would pass the
   * test above and destroy a measured 3-in-5 recovery.
   */
  it("CONTRAST: an identical block on a user-stated goal still funds the retry", () => {
    const ctx = makeCtx(false);
    applyDeterministicEnforcement(ctx);
    expect(ctx.earlyReturn, "contrast fixture must also block").toBeDefined();

    const decision = decideDraftAutoRetry(ctx.earlyReturn!, 28_300);
    expect(decision.retry).toBe(true);
  });
});
