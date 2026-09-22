/**
 * ⭐⭐⭐ THE STRUCTURAL-PARSE BLOCK MUST DECLARE WHAT IT KNOWS.
 *
 * ── THE DEFECT, AS MEASURED ON DEPLOYED STAGING ───────────────────────────
 * Render service `cee-staging` (srv-d4slpaili9vc73eiq4og), window
 * 2026-09-21T00:00:00Z..23:59:59Z, BOTH queries untruncated (`hasMore: false`):
 *   draft 500 BoundaryError requests : 16
 *   cee.structural_parse.failed      : 16
 *   overlap                          : 16
 *   500s that are NOT structural_parse: 0
 * So 100% of that window's draft 500s came from THIS emitter — not enrichment
 * (`cee.enrich.crashed` -> 0 hits against a firing positive control), not the
 * post-enforcement gate, not the OPTIONS_IDENTICAL bypass.
 *
 * Every one of the 17 retained failure events reported the SAME single field,
 * with no truncation (max `error_count` 2 against `extractZodIssues`' cap of 3):
 *   paths {'graph.nodes.N.observed_state': 20}  codes {'invalid_union': 20}
 *
 * The user got HTTP 500 with an EMPTY `assistant_text`, `retryable=false` and
 * `recovery_suggestion=absent`, because this emitter declares NONE of the three
 * things its sibling gates declare. `buildCeeErrorResponse` defaults
 * `retryable: options.retryable ?? false` (pipeline.ts:157), so silence here IS
 * the dead end — exactly the shape `graph-enforcement.ts`'s own HONEST RETRY
 * comment (2026-07-24, lines 882-886) describes as the defect it fixed for ITS
 * emitter: "no `retryable` and no `recovery` meant the envelope defaulted to
 * `retryable: false` / `recovery: null`, i.e. a hard dead end."
 *
 * ── WHY `retryable: true` IS EVIDENCED, NOT ASSERTED ──────────────────────
 * The staging journey smoke gate sends a FIXED brief ("Should we open a second
 * bakery location in Leeds next quarter?") five times per head. Observed
 * failure rates across today's five staging heads: 40/60/20/40/40%. Identical
 * brief bytes, identical build, different outcome — the same evidential basis
 * the estate already accepted for the enforcement class (route-v2.ts:2314-2319).
 *
 * ⚠ WHAT THIS SUITE DOES NOT CLAIM: a retry RECOVERY RATE. No copy shipped by
 * this change promises a retry will work, and none is asserted here.
 *
 * RED at pristine `5104b244`: the emission passes only `{ requestId }`.
 */
import { describe, it, expect, vi } from "vitest";

import {
  runStructuralParse,
  STRUCTURAL_PARSE_BLOCK_REASON,
  STRUCTURAL_PARSE_BLOCK_STATUS_CODE,
  isStructuralParseBlockReason,
} from "../structural-parse.js";
import { isEnforcementBlockedResult } from "../graph-enforcement.js";
import type { StageContext } from "../../../types.js";

vi.mock("../../../../../utils/telemetry.js", async (importOriginal) => ({
  // ⚠ `vi.mock`'s factory REPLACES the module, so a hand-listed mock silently
  // drops every other export (trap 12). Spread the original and override the
  // ONE seam this suite needs quiet.
  ...(await importOriginal<Record<string, unknown>>()),
  log: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

/**
 * A graph whose `observed_state` fails BOTH union branches — the MEASURED
 * failure shape, not an imagined one.
 *
 * `NodeObservedState` (schemas/graph.ts:285) = union[ConstraintObservedState,
 * FactorObservedState]. BOTH branches require `value: z.number()`. A
 * provenance-only observed_state carries no numeric `value`, so it matches
 * neither branch and Zod reports `invalid_union` at
 * `graph.nodes.N.observed_state` — the exact path and code in all 20 measured
 * issues.
 */
function contextWithUnparseableObservedState(): StageContext {
  return {
    requestId: "req-structural-parse-fixture",
    graph: {
      nodes: [
        {
          id: "factor_churn",
          kind: "factor",
          label: "Customer churn",
          // Provenance-only: no numeric `value` => fails BOTH union branches.
          observed_state: { unit: "percent", source: "user_stated" },
        },
      ],
      edges: [],
    },
    rationales: undefined,
    confidence: undefined,
    goalConstraints: undefined,
  } as unknown as StageContext;
}

describe("structural parse — the producer declares its own signature", () => {
  it("blocks the measured unparseable observed_state and sets an earlyReturn", () => {
    const ctx = contextWithUnparseableObservedState();
    runStructuralParse(ctx);
    expect(ctx.earlyReturn).toBeDefined();
    expect(ctx.earlyReturn?.statusCode).toBe(STRUCTURAL_PARSE_BLOCK_STATUS_CODE);
  });

  it("declares a typed `reason` the route can read as `pipelineReason`", () => {
    const ctx = contextWithUnparseableObservedState();
    runStructuralParse(ctx);
    const body = ctx.earlyReturn?.body as Record<string, unknown>;

    // Bound BY IDENTITY to the producer's own exported constant, never a
    // substring another reason could satisfy (trap 19).
    expect((body.details as Record<string, unknown>).reason).toBe(
      STRUCTURAL_PARSE_BLOCK_REASON,
    );

    // ⚠ THE CONSUMER'S ACTUAL PREDICATE, not my reading of it. `draft-graph.ts:451`
    // drops any reason failing this pattern, which would silently strip the
    // signature the route gates on. Derived at the consumer's bytes (trap 13d).
    expect(STRUCTURAL_PARSE_BLOCK_REASON).toMatch(/^[a-z][a-z0-9_]{1,63}$/);
  });

  it("declares `retryable: true` so the route can offer a retry it can honour", () => {
    const ctx = contextWithUnparseableObservedState();
    runStructuralParse(ctx);
    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    expect(body.retryable).toBe(true);
  });

  it("its own reason predicate recognises it, and rejects the sibling classes", () => {
    const ctx = contextWithUnparseableObservedState();
    runStructuralParse(ctx);
    const body = ctx.earlyReturn?.body as Record<string, unknown>;
    const reason = (body.details as Record<string, unknown>).reason as string;

    // DISCRIMINATING PAIR (trap 19): the predicate must accept THIS producer's
    // reason and reject the neighbouring ones, or it is not binding to an object.
    expect(isStructuralParseBlockReason(reason)).toBe(true);
    expect(isStructuralParseBlockReason("empty_draft_graph")).toBe(false);
    expect(isStructuralParseBlockReason("enrichment_failed")).toBe(false);
    expect(isStructuralParseBlockReason("llm_truncated_max_tokens")).toBe(false);
    expect(isStructuralParseBlockReason(null)).toBe(false);
  });

  /**
   * ⭐ THE SAFETY PIN. Adding `retryable: true` puts THREE of the four conjuncts
   * of `isEnforcementBlockedResult` within reach, and that predicate is what the
   * bounded server-side auto-retry (`draft-auto-retry.ts`) fires on. Silently
   * enrolling this class in auto-retry would be an unreviewed behaviour change
   * that spends a second LLM attempt on every occurrence.
   *
   * It stays FALSE because the status code is 400 (not 422) and there is no
   * `details.last_phase`. This is PINNED rather than assumed, and it REDs if
   * anyone later moves this emitter to 422 or adds a phase marker.
   */
  it("does NOT satisfy isEnforcementBlockedResult — auto-retry stays off for this class", () => {
    const ctx = contextWithUnparseableObservedState();
    runStructuralParse(ctx);
    expect(isEnforcementBlockedResult(ctx.earlyReturn)).toBe(false);
    expect(ctx.earlyReturn?.statusCode).not.toBe(422);
    expect(
      (ctx.earlyReturn?.body as Record<string, unknown>).details as Record<string, unknown>,
    ).not.toHaveProperty("last_phase");
  });

  it("a graph that parses cleanly sets no earlyReturn (the negative control)", () => {
    const ctx = {
      requestId: "req-clean",
      graph: {
        nodes: [
          {
            id: "factor_churn",
            kind: "factor",
            label: "Customer churn",
            // Factor-shaped: numeric `value`, no constraint `metadata`.
            observed_state: { value: 0.04 },
          },
        ],
        edges: [],
      },
      rationales: undefined,
      confidence: undefined,
      goalConstraints: undefined,
    } as unknown as StageContext;
    runStructuralParse(ctx);
    expect(ctx.earlyReturn).toBeUndefined();
  });
});
