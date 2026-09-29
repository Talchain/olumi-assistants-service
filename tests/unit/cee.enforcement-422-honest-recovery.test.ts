/**
 * The post-enforcement 422 must not be a DEAD END (draft-honesty lane, 2026-07-24).
 *
 * LIVE OBSERVATION (day-3 drafting matrix, build `3c544b8`, request
 * `d88c4376`): a moderate brief produced a complete model in 33s;
 * deterministic enforcement rejected it on `NO_PATH_TO_GOAL` for
 * `fac_ownership` and fail-closed with `CEE_GRAPH_INVALID`. Fail-closing is
 * CORRECT and is unchanged here. What was wrong is what the user was handed:
 * `retryable: false` and `recovery: null` — a hard dead end on a brief that
 * drafted cleanly TWICE in the same run (46.2s and 59.7s).
 *
 * `buildCeeErrorResponse` defaults `retryable` to `false` when the caller omits
 * it, so the dead end came from omission, not from a decision.
 *
 * NOTHING about the mechanism under test is stubbed: the REAL graph validator
 * produces the topology error and the REAL `buildCeeErrorResponse` builds the
 * envelope, so the assertions read the actual wire body.
 *
 * MUTATION: remove `retryable: true` and/or the `recovery` block from the
 * `CEE_GRAPH_INVALID` call in
 * `src/cee/unified-pipeline/stages/repair/graph-enforcement.ts`
 * → "carries an honest retry" / "carries actionable recovery copy" go RED.
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

import { applyDeterministicEnforcement } from "../../src/cee/unified-pipeline/stages/repair/graph-enforcement.js";
import type { StageContext } from "../../src/cee/unified-pipeline/types.js";

/**
 * The live failure shape: a CONTROLLABLE factor (it has an inbound option edge,
 * so `handleUnreachableFactors` never examines it, and
 * `fixDisconnectedObservables` never prunes it — "controllable factors are
 * never pruned") with NO outbound path to the goal. That is exactly the
 * `fac_ownership` topology from request `d88c4376`.
 */
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

/** A plain causal edge (V1_FLAT field names, as the live wire uses). */
function causal(mean: number) {
  return { strength_mean: mean, strength_std: 0.1, belief_exists: 0.9, effect_direction: "positive" } as const;
}

function makeBlockedCtx(): StageContext {
  return {
    requestId: "req-422-honesty",
    graph: {
      version: "1",
      default_seed: 17,
      meta: { roots: [], leaves: [], suggested_positions: {}, source: "test" },
      nodes: [
        { id: "dec_van", kind: "decision", label: "Van decision" },
        { id: "opt_buy", kind: "option", label: "Buy the van" },
        { id: "opt_lease", kind: "option", label: "Lease the van" },
        { id: "fac_cost", kind: "factor", label: "Upfront cost", category: "controllable", data: FACTOR_DATA },
        // The offender: option-connected (controllable) but nothing downstream.
        { id: "fac_ownership", kind: "factor", label: "Ownership", category: "controllable", data: FACTOR_DATA },
        { id: "out_margin", kind: "outcome", label: "Monthly margin" },
        { id: "goal_margin", kind: "goal", label: "Protect margin" },
      ],
      edges: [
        { from: "dec_van", to: "opt_buy", ...STRUCTURAL_EDGE },
        { from: "dec_van", to: "opt_lease", ...STRUCTURAL_EDGE },
        { from: "opt_buy", to: "fac_cost", ...STRUCTURAL_EDGE },
        { from: "opt_buy", to: "fac_ownership", ...STRUCTURAL_EDGE },
        { from: "opt_lease", to: "fac_ownership", ...STRUCTURAL_EDGE },
        { from: "fac_cost", to: "out_margin", ...causal(0.6) },
        { from: "out_margin", to: "goal_margin", ...causal(0.7) },
      ],
    },
    detectedEdgeFormat: "V1_FLAT",
    deterministicRepairs: [],
    repairTrace: {},
  } as unknown as StageContext;
}

describe("CEE_GRAPH_INVALID post-enforcement 422 — honest, actionable, still fail-closed", () => {
  it("POSITIVE CONTROL — the fixture really does block (the assertions below are not vacuous)", () => {
    const ctx = makeBlockedCtx();
    applyDeterministicEnforcement(ctx);

    // The gate fired at all — without this, every assertion on `earlyReturn`
    // would be checking an object that a passing graph never produces.
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn!.statusCode).toBe(422);
    const body = ctx.earlyReturn!.body as Record<string, any>;
    expect(body.code).toBe("CEE_GRAPH_INVALID");
    expect(body.details.validation_errors.map((e: { code: string }) => e.code)).toContain(
      "NO_PATH_TO_GOAL",
    );
    expect(body.details.last_phase).toBe("deterministic_enforcement");
  });

  it("a CONNECTED graph does not trip the gate (the guard discriminates)", () => {
    const ctx = makeBlockedCtx();
    // Give the offending factor a route to the goal.
    (ctx.graph as any).edges.push({ from: "fac_ownership", to: "out_margin", ...causal(0.3) });
    applyDeterministicEnforcement(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
  });

  it("carries an honest retry — retryable: true, not the omission default of false", () => {
    const ctx = makeBlockedCtx();
    applyDeterministicEnforcement(ctx);
    const body = ctx.earlyReturn!.body as Record<string, any>;

    expect(body.retryable).toBe(true);
  });

  it("carries actionable recovery copy, including the flat mirror the UI pins", () => {
    const ctx = makeBlockedCtx();
    applyDeterministicEnforcement(ctx);
    const body = ctx.earlyReturn!.body as Record<string, any>;

    expect(body.recovery).not.toBeNull();
    expect(typeof body.recovery.suggestion).toBe("string");
    expect(body.recovery.suggestion.length).toBeGreaterThan(20);
    expect(Array.isArray(body.recovery.hints)).toBe(true);
    expect(body.recovery.hints.length).toBeGreaterThan(0);
    // recovery_suggestion is the PINNED flat field (@talchain/schemas 0.19.0);
    // buildCeeErrorResponse mirrors it, so a recovery block with no mirror
    // means the block never reached the builder.
    expect(body.recovery_suggestion).toBe(body.recovery.suggestion);
    // Retry must be the LEADING hint — it is the honest primary lever here.
    expect(String(body.recovery.hints[0]).toLowerCase()).toContain("retry");
  });

  it("the copy does not blame the brief (the cruel inversion from the 23 Jul firefight)", () => {
    const ctx = makeBlockedCtx();
    applyDeterministicEnforcement(ctx);
    const body = ctx.earlyReturn!.body as Record<string, any>;
    const copy = [body.recovery.suggestion, ...body.recovery.hints].join(" ").toLowerCase();

    // Asking a user whose model failed on connectivity to "simplify" or "be
    // more specific" steers them straight back into the failure.
    for (const blame of ["simplify", "more specific", "be specific", "too vague", "shorter brief"]) {
      expect(copy).not.toContain(blame);
    }
  });

  it("ships codes-only validation_error_codes for the wire (ROADMAP 2.718 diagnosability)", () => {
    // The route boundary's details allowlist forwards ONLY safe fixed-enum
    // fields; the message-bearing `validation_errors` never cross it. Without
    // a codes-only field the wire says "topology error(s)" and the operator
    // must round-trip Render logs to learn WHICH — exactly what the 2026-08-06
    // diagnosis of runs de79da/39cf53 cost. The codes must mirror
    // `validation_errors` 1:1, same order (derived, not restated).
    const ctx = makeBlockedCtx();
    applyDeterministicEnforcement(ctx);
    const body = ctx.earlyReturn!.body as Record<string, any>;

    expect(Array.isArray(body.details.validation_error_codes)).toBe(true);
    expect(body.details.validation_error_codes).toEqual(
      body.details.validation_errors.map((e: { code: string }) => e.code),
    );
    expect(body.details.validation_error_codes).toContain("NO_PATH_TO_GOAL");
    // Codes only — never the message strings (they embed node labels).
    for (const code of body.details.validation_error_codes) {
      expect(typeof code).toBe("string");
      expect(code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it("still FAILS CLOSED — the invalid model is never packaged", () => {
    const ctx = makeBlockedCtx();
    applyDeterministicEnforcement(ctx);

    // earlyReturn is what skips Stage 5 packaging. Honest copy must not have
    // turned the guard into a warning.
    expect(ctx.earlyReturn!.statusCode).toBe(422);
    expect((ctx.repairTrace as any).deterministic_enforcement.blocked).toBe(true);
    expect((ctx.repairTrace as any).deterministic_enforcement.post_validation_error_count).toBeGreaterThan(0);
  });
});
