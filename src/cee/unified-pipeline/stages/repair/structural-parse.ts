/**
 * Stage 4 Substep 10: Structural parse (Zod safety net)
 *
 * Uses DraftGraphOutput.parse() to validate the final graph state.
 * This catches any schema violations before Stage 5 (Package).
 *
 * Note: DraftGraphOutput and its nested Graph/Node/Edge schemas all use
 * .passthrough(), so additive fields survive Zod validation here.
 * The parse is validation-only — ctx.graph is not replaced with the
 * parsed result, so no fields are actually stripped.
 */

import type { StageContext } from "../../types.js";
import { DraftGraphOutput } from "../../../../schemas/assist.js";
import { buildCeeErrorResponse } from "../../../validation/pipeline.js";
import { extractZodIssues } from "../../../../schemas/llmExtraction.js";
import { log } from "../../../../utils/telemetry.js";

// ---------------------------------------------------------------------------
// The structural-parse block signature (P0, 2026-09-21)
// ---------------------------------------------------------------------------
// These constants ARE the emission: the earlyReturn below uses them directly
// and the predicate beside them reads the same bytes, so a consumer's trigger
// cannot drift from the producer (derive, don't mirror; trap 12). This is the
// `isEnforcementBlockedResult` doctrine applied to the sibling emitter that
// never received it.
//
// ── WHY THIS EMITTER NEEDED A SIGNATURE AT ALL ────────────────────────────
// Measured on deployed staging (srv-d4slpaili9vc73eiq4og), window
// 2026-09-21T00:00:00Z..23:59:59Z, both log queries untruncated: 16 of 16
// draft-path 500s came from HERE, and every one reached the user as an empty
// reply. This emitter declared no `reason`, no `retryable` and no `recovery`,
// and `buildCeeErrorResponse` defaults `retryable: options.retryable ?? false`
// (pipeline.ts:157) — so silence here WAS the dead end. It is the same shape
// `graph-enforcement.ts`'s HONEST RETRY note (2026-07-24) records fixing for
// its own emission; this one was simply never revisited.

export const STRUCTURAL_PARSE_BLOCK_STATUS_CODE = 400;
export const STRUCTURAL_PARSE_BLOCK_ERROR_CODE = "CEE_GRAPH_INVALID" as const;

/**
 * The producer's own typed reason.
 *
 * ⚠ THE PATTERN IS THE CONSUMER'S, NOT A STYLE CHOICE. `draft-graph.ts:451`
 * admits a pipeline reason only if it matches `/^[a-z][a-z0-9_]{1,63}$/` and
 * silently drops anything else — which would strip the very signature the
 * route gates on. Pinned in this module's suite against that exact regex.
 */
export const STRUCTURAL_PARSE_BLOCK_REASON = "structural_parse_failed" as const;

/**
 * Recognises THIS module's block by the producer's own reason.
 *
 * ⚠ DELIBERATELY A SEPARATE QUESTION FROM `isPostEnforcementBlock` (trap 21).
 * That predicate answers "is this the post-enforcement gate's block?" and is
 * keyed on `details.validation_error_codes`; this one answers "is this the
 * Stage 4 structural-parse block?". Two failure classes, two producers, two
 * names — folding them into one widened predicate is how an estate ends up
 * with one predicate quietly answering two questions.
 */
export function isStructuralParseBlockReason(
  reason: string | null | undefined,
): boolean {
  return reason === STRUCTURAL_PARSE_BLOCK_REASON;
}

export function runStructuralParse(ctx: StageContext): void {
  if (!ctx.graph) return;

  const input = {
    graph: ctx.graph,
    rationales: ctx.rationales,
    confidence: ctx.confidence,
    goal_constraints: ctx.goalConstraints,
  };

  try {
    DraftGraphOutput.parse(input);
  } catch (error) {
    const zodError = (error as any)?.issues ? (error as any) : undefined;
    const issueCount = zodError?.issues?.length ?? 0;
    const firstIssues = zodError ? extractZodIssues(zodError, 3) : [];
    log.warn({
      event: "cee.structural_parse.failed",
      error_count: issueCount,
      first_issues: firstIssues,
      request_id: ctx.requestId,
    }, "Structural parse failed — graph does not conform to DraftGraphOutput schema");

    // ── DECLARE WHAT THIS GATE KNOWS ──────────────────────────────────────
    // `retryable: true` is the PRODUCER's judgement, on the same evidential
    // basis the enforcement gate's own declaration rests on: the staging
    // journey smoke gate sends ONE fixed brief five times per head and
    // observed 40/60/20/40/40% failure across today's five heads — identical
    // bytes, identical build, different outcome. Every measured failure here
    // is one stochastic field (`graph.nodes.N.observed_state`, `invalid_union`,
    // 20 of 20 issues), not a deficient brief, so telling this user to rewrite
    // their brief would be the cruel inversion the truncation arm documents.
    //
    // ⚠ NO `recovery` IS COMPOSED HERE, DELIBERATELY. We know the failure is
    // ours and we know it is often transient; we have NOT measured a retry
    // RECOVERY RATE for this class. Composing a sentence would mean authoring
    // a claim at exactly the point where the honest thing is to say only what
    // is known — so the route's already-reviewed olumi-fault fallback speaks
    // instead, and it promises nothing. A specific-and-false sentence is worse
    // than a pooled-but-true one.
    //
    // ⚠ STATUS STAYS 400 and NO `last_phase` is added: those are two of the
    // four conjuncts of `isEnforcementBlockedResult`, which is what funds the
    // bounded server-side auto-retry. Enrolling this class in auto-retry is a
    // separate, separately-evidenced decision and is NOT taken here. Pinned.
    ctx.earlyReturn = {
      statusCode: STRUCTURAL_PARSE_BLOCK_STATUS_CODE,
      body: buildCeeErrorResponse(
        STRUCTURAL_PARSE_BLOCK_ERROR_CODE,
        "Graph failed structural validation",
        {
          requestId: ctx.requestId,
          reason: STRUCTURAL_PARSE_BLOCK_REASON,
          retryable: true,
        },
      ),
    };
  }
}
