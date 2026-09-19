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

/**
 * The block a held mutation ships. Named as a constant beside
 * {@link REFUSAL_BLOCK_TYPE} so the two wire vocabularies this function
 * discriminates between are declared in one place rather than inlined.
 */
const HELD_PROPOSAL_BLOCK_TYPE = 'held_proposal';

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

  /**
   * ⭐⭐ A LIVE HOLD IS NEVER A REFUSAL, WHATEVER SHIPS BESIDE IT.
   *
   * This function's own docstring above has always promised to return null for
   * "every held proposal". It did not. `edit-graph-dispatch.ts:3875-3885` ships
   * the redacted public reason as a LEADING `error` block and THEN appends the
   * held proposal, so an ordinary add-node/add-edge hold reaches the wire as
   * `[error, held_proposal]` — and the loop below returns on the FIRST error
   * block it meets. So every routine confirmation hold was counted as a
   * user-visible refusal.
   *
   * WITNESSED, not inferred. Paul's staging session, 17 Sep 2026:
   *   18:06:51.698  v5.edit_graph.turn  outcome:"proposal" failure_code:null
   *                                     branch:"graph_management_held"
   *   18:06:53.141  cee.turn.refused    error_code:"INTERNAL_ERROR" severity:"warn"
   * The turn SUCCEEDED — the user confirmed 28 seconds later and the change
   * applied. Three held mutations on that one turn, so this is the NORMAL path
   * for structural edits, not an edge case.
   *
   * ⚠ WHY THE FIX IS HERE AND NOT AT THE PRODUCER. Removing the error block
   * from the held arm would be the tidier root fix, and it is NOT safe as a
   * small change: `turn-executor.ts:1011` short-circuits the zero-resolved
   * selection honesty projection on `blocks.some(b => b.type === 'error')`, so a
   * held turn is currently exempt from that projection ONLY because it carries
   * this block. Strip it and a hold with `resolved_count === 0` would newly have
   * its `assistant_text` REPLACED — a user-visible copy change arriving as a
   * side effect of a telemetry fix. Correcting the CLASSIFIER leaves the wire
   * byte-identical, so that guard, the UI's `case 'error': return null`, and the
   * held-proposal card are all untouched.
   *
   * The presence test is deliberately independent of ORDER. Keying on "error
   * before held_proposal" would encode the producer's current block order as a
   * contract, and the producer is free to reorder.
   */
  const carriesLiveHold = blocks.some(
    (raw) => asRecord(raw)?.type === HELD_PROPOSAL_BLOCK_TYPE,
  );
  if (carriesLiveHold) return null;

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
