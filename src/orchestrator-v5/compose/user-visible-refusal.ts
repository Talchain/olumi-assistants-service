/**
 * Is this response, as it ships, a REFUSAL the user can see?
 *
 * ⭐ WHY THIS EXISTS. Until now a turn that told the user *"I couldn't
 * complete that change, and nothing in your model has changed"* was recorded
 * by every instrument we own as a SUCCESS: `status: 200`, `completed: true`,
 * `outcome: answered`. Measured on a real session
 * (scenario `9677de7d-0af8-4bee-b2ac-0e63b45aff8e`, 2026-09-14): 18 turns
 * captured, `failed 0`, `answered 17`, while TWO of those turns were refusals.
 * The only trace was a `level 40` warn line carrying no `scenario_id` on the
 * one event that had a `request_id`, and no `request_id` on the one that had a
 * `scenario_id` — so a refusal could not be joined to a session by either.
 *
 * ⭐ WHY THE PREDICATE READS THE SHIPPED BYTES AND NOTHING ELSE. The question
 * is "what did the USER receive?", and the only artefact that answers it is
 * the wire body at the exactly-once egress seam. Derivation-level reads may
 * retry or recover, so a producer-side flag would over-count and would not
 * prove delivery — the same argument `V5ClaimSafetyFailClosedUnavailable`
 * already makes at that seam.
 *
 * ⭐ WHY NOT `v5.edit_graph.turn` OUTCOME `rejected`, which already exists.
 * It answers a DIFFERENT QUESTION (CLAUDE.md trap 21): it reports the
 * HANDLER's verdict, not what shipped. Measured on the live wire, the same
 * session at 17:12:57Z:
 *     outcome="rejected"  branch="clarify"  failure_code=null
 * — a turn whose own branch label is `clarify` and whose user-visible text was
 * a question ("Which option should I update: … or …?"). Counting
 * `outcome === 'rejected'` therefore scores a CLARIFICATION as a refusal.
 * A clarify is the product working; a refusal is the product declining. They
 * must not share a counter.
 *
 * ⭐ THE VOCABULARY IS ENTIRELY EXISTING. This module mints no taxonomy: it
 * reports the boundary's own `error_code` + `severity`, and the producer's own
 * `details.source` / `details.rejection_code`. If you find yourself adding a
 * new enum here, you have overshot the brief this was built for.
 *
 * ⚠ SCOPE, STATED EXACTLY (CLAUDE.md trap 20 — a row minted from an UNKNOWN
 * must restate the UNKNOWN's scope, never its generalisation). This predicate
 * sees a refusal ONLY where the refusal is MARKED ON THE WIRE. Three composers
 * deliberately ship a CLEAN BODY (`blocks: []`) for a recovered failure —
 * `composeRecoverableHandlerResponse`, `composeRecoverableValidationResponse`
 * and `composeUnsupportedActionResponse` — and their refusals are invisible
 * here BY CONSTRUCTION, not by oversight. Those are already countable via
 * `turn_executor.failure_response`, whose `session_id` IS the scenario id
 * (this repo writes `scenario_id: context.session_id` at ~30 sites), so the
 * two halves DO join to the same session — under two different field names.
 * The clean-body set is pinned by `user-visible-refusal.spec.ts` so it REDs if
 * it grows or shrinks.
 */

import type { OlumiResponse } from '@talchain/schemas/boundary';

/**
 * The single wire marker. `error` is the only member of the boundary block
 * union that carries a failure (the other thirteen are content), and the two
 * producers that ship one on a 200 — `buildBoundaryBlocks` for the edit family
 * and `validation-failure-responses` for the validator family — both emit it
 * ONLY on a refusal. `buildBoundaryBlocks` returns `[]` outright when
 * `!result.wasRejected`.
 *
 * Measured against a live opposite-direction corpus on deployed staging
 * (2026-09-14, scenario 95c3dcdc-ec4d-4824-a0d8-42d02c2ba81c) — the twins
 * matter more than the targets here (CLAUDE.md trap 22b):
 *   REFUSAL      "delete the outcome node"   -> error/warn ORPHAN_NODE
 *   REFUSAL      "remove every option"       -> error/warn FEWER_THAN_TWO_OPTIONS
 *   NOT refusal  applied edit                -> blocks: []
 *   NOT refusal  no-op fallback              -> blocks: []
 *   NOT refusal  held proposal               -> blocks: [held_proposal]
 *   NOT refusal  fresh draft                 -> blocks: [coaching x3]
 */
const REFUSAL_BLOCK_TYPE = 'error';

export interface UserVisibleRefusal {
  /** Boundary `BoundaryErrorCode` — existing closed enum, not re-spelled here. */
  readonly error_code: string;
  /** Boundary block severity as shipped ('warn' = recoverable, 'error' = fatal). */
  readonly severity: string | null;
  /** Producer's own `details.source` (e.g. 'edit_graph'). Null when unstated. */
  readonly source: string | null;
  /**
   * Producer's own `details.rejection_code` — an `EditRejectionCode` such as
   * `OPERATION_DID_NOT_LAND`. Null when the producer stated none; NEVER
   * defaulted to a guess, because "we do not know the cause" and "the cause was
   * X" are different claims.
   */
  readonly refusal_code: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Classify the response as shipped. Returns `null` when the turn is NOT a
 * user-visible refusal — which includes every success, every clarification and
 * every held proposal.
 *
 * Reads defensively (`unknown` in, never a cast) because this runs on the wire
 * body AFTER egress validation, where a shape drift must degrade to "not a
 * refusal" rather than throw on the send path.
 */
export function classifyUserVisibleRefusal(
  wireBody: OlumiResponse | unknown,
): UserVisibleRefusal | null {
  const envelope = asRecord(wireBody);
  if (!envelope) return null;

  const blocks = envelope.blocks;
  if (!Array.isArray(blocks)) return null;

  for (const raw of blocks) {
    const block = asRecord(raw);
    if (!block) continue;
    if (block.type !== REFUSAL_BLOCK_TYPE) continue;

    const details = asRecord(block.details);
    return {
      error_code: readString(block.error_code) ?? 'UNSPECIFIED',
      severity: readString(block.severity),
      source: details ? readString(details.source) : null,
      refusal_code: details ? readString(details.rejection_code) : null,
    };
  }

  return null;
}
