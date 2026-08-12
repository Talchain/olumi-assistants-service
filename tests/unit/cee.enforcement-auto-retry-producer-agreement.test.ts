/**
 * ROADMAP 2.1086 — PRODUCER↔TRIGGER AGREEMENT, at the real bytes.
 *
 * The auto-retry trigger (`isEnforcementBlockedResult`) claims to recognise
 * the post-enforcement gate's own emission. A fixture written by the retry
 * lane cannot prove that (trap 16: a self-authored fixture encodes the
 * author's model of the producer, not the producer). This spec drives the
 * REAL `applyDeterministicEnforcement` — real deterministic validator, real
 * `buildCeeErrorResponse`, real config — into its fail-closed path and
 * asserts the trigger fires on what it ACTUALLY produced, and that the
 * decision layer funds the retry at the BASELINE-observed failure latency.
 *
 * CONTRAST CONTROL (trap 13e): the same probe on a healthy graph must NOT
 * trigger — proving the trigger discriminates rather than agreeing with
 * everything.
 *
 * Fixture provenance: the blocked topology is the live `fac_ownership` shape
 * from request d88c4376 (day-3 drafting matrix), copied from
 * tests/unit/cee.enforcement-422-honest-recovery.test.ts, which pins the same
 * producer's copy fields.
 *
 * RED at pristine 335a9380: the trigger/decision modules do not exist yet.
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
} from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import { decideEnforcementAutoRetry } from "../../src/cee/unified-pipeline/draft-auto-retry.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";

/** Shape the deterministic validator requires of a controllable factor. */
const FACTOR_DATA = {
  value: 0.5,
  extractionType: "inferred",
  factor_type: "continuous",
  uncertainty_drivers: ["market variation"],
} as const;

/** Canonical option→factor structural edge values the validator enforces. */
const STRUCTURAL_EDGE = {
  strength_mean: 1,
  strength_std: 0.01,
  belief_exists: 1,
  effect_direction: "positive",
} as const;

function causal(mean: number) {
  return { strength_mean: mean, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" } as const;
}

/** `withOffender: true` reproduces the live blocked topology (fac_ownership
 *  controllable but pathless to goal); `false` is the healthy contrast. */
function makeCtx(withOffender: boolean): StageContext {
  const nodes = [
    { id: "dec_van", kind: "decision", label: "Van decision" },
    { id: "opt_buy", kind: "option", label: "Buy the van" },
    { id: "opt_lease", kind: "option", label: "Lease the van" },
    { id: "fac_cost", kind: "factor", label: "Upfront cost", category: "controllable", data: FACTOR_DATA },
    { id: "out_margin", kind: "outcome", label: "Monthly margin" },
    { id: "goal_margin", kind: "goal", label: "Protect margin" },
  ];
  const edges: Array<Record<string, unknown>> = [
    { from: "dec_van", to: "opt_buy", ...STRUCTURAL_EDGE },
    { from: "dec_van", to: "opt_lease", ...STRUCTURAL_EDGE },
    { from: "opt_buy", to: "fac_cost", ...STRUCTURAL_EDGE },
    // Both options intervene on the goal-connected factor so the HEALTHY
    // variant is genuinely healthy (a dangling opt_lease would block for an
    // unrelated reason and hollow the contrast out).
    { from: "opt_lease", to: "fac_cost", ...STRUCTURAL_EDGE },
    { from: "fac_cost", to: "out_margin", ...causal(0.6) },
    { from: "out_margin", to: "goal_margin", ...causal(0.7) },
  ];
  if (withOffender) {
    nodes.splice(4, 0, {
      id: "fac_ownership",
      kind: "factor",
      label: "Ownership",
      category: "controllable",
      data: FACTOR_DATA,
    } as never);
    edges.push(
      { from: "opt_buy", to: "fac_ownership", ...STRUCTURAL_EDGE },
      { from: "opt_lease", to: "fac_ownership", ...STRUCTURAL_EDGE },
    );
  }
  return {
    requestId: "req-producer-agreement",
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

describe("2.1086 — the retry trigger recognises the REAL producer's emission", () => {
  it("POSITIVE: the real gate's fail-closed earlyReturn satisfies the trigger, and the decision funds a retry at the observed failure latency", () => {
    const ctx = makeCtx(true);
    applyDeterministicEnforcement(ctx);

    // The gate genuinely fired (this is the same positive control the
    // honest-recovery spec runs — without it every assertion below is vacuous).
    expect(ctx.earlyReturn, "fixture must actually block").toBeDefined();

    // The trigger recognises what the producer ACTUALLY emitted.
    expect(isEnforcementBlockedResult(ctx.earlyReturn!)).toBe(true);

    // And the decision layer funds the retry at the BASELINE worst case.
    const decision = decideEnforcementAutoRetry(ctx.earlyReturn!, 28_300);
    expect(decision.retry).toBe(true);
  });

  it("CONTRAST: a healthy graph produces no earlyReturn and the trigger stays silent", () => {
    const ctx = makeCtx(false);
    applyDeterministicEnforcement(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(isEnforcementBlockedResult(ctx.earlyReturn as never)).toBe(false);
  });
});
