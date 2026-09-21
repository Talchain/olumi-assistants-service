/**
 * ⭐⭐ ONE DURABLE RECORD PER REPLACEMENT TURN — the decision chain, not a log.
 *
 * ── WHY THIS EXISTS, MEASURED RATHER THAN ARGUED ──────────────────────────
 * On 21 Sep a manual session (`95b92672`) returned two replies that were 71
 * characters of neutral fallback instead of an answer. Establishing WHICH of
 * the estate's FIVE production sites had replaced the text took hours and did
 * not succeed: four of them assign the constant directly inside
 * `edit-graph-dispatch.ts` and one is the egress guard, and the debug export
 * could not discriminate because it selects a single trace
 * (`cee_capture_selection.selected_trace_id`) that was a different turn.
 *
 * The same session also produced "I could not see how to make that change"
 * and "the target or constraint details were not valid" with nothing
 * recorded about which route ran, what operation was intended, which tool was
 * selected, or whether a write was ever attempted. **The estate cannot
 * reconstruct its own failures after the fact.** This layer does not inherit
 * that: one record per turn, written at both exits, carrying the whole chain.
 *
 * ── WHAT IT DELIBERATELY DOES NOT CARRY ───────────────────────────────────
 * No user prose, no assistant prose, no operation values, no quoted
 * agreement. Refusals are STABLE CODES, never the model-facing sentence —
 * that sentence embeds proposal ids and operation summaries, which are
 * user-derived. Operations are reported by KIND and COUNT. This is the
 * estate's standing rule for telemetry and it is what makes the record safe
 * to keep.
 *
 * ── WHY CODES AND NOT THE MESSAGE ─────────────────────────────────────────
 * A code survives a copy change; a substring match on prose does not. The
 * estate has paid for that difference more than once (a phrase-bound guard
 * that went stale the day its headline was reworded). The codes are declared
 * as a union so a new refusal site cannot be added without naming itself.
 */

/** Every reason this controller can refuse an accept. One per guard. */
export type ReplacementRefusalCode =
  /** No durable place to record that a save had started. */
  | 'no_checkpoint'
  /** This turn already committed to dispatching a write; the applier's grain
   *  is the turn, so a second one fails silently and totally. */
  | 'second_write_this_turn'
  /** The named proposal is not open (never offered, stale, or already gone). */
  | 'proposal_not_waiting'
  /** The quoted agreement is not the user's words on this turn. */
  | 'quote_not_from_message'
  /** The acceptance names a number the offer does not carry. */
  | 'acceptance_names_other_number'
  /** The checkpoint store refused, so nothing was sent. */
  | 'checkpoint_refused'
  /** The write was sent and did not come back. Outcome genuinely unknown. */
  | 'write_outcome_unknown'
  /** The writer reported an affirmative failure. */
  | 'write_failed'
  /** The write returned without the proof of commit. */
  | 'no_receipt';

/** How the turn ended. */
export type ReplacementTurnOutcome =
  /** An unresolved prior save owned the turn; no model call was made. */
  | 'reconciliation_owned'
  /** The agent loop ran to completion. */
  | 'completed';

export interface ReplacementTurnTrace {
  /** ⭐ THE CORRELATION ID. The same `turn_id` the UI sent and the writer
   *  keys its idempotency on, so one value spans UI → controller → write. */
  readonly correlation_id: string;
  readonly controller: 'replacement';
  /** The revision the turn was reasoned against. */
  readonly model_revision: string;
  readonly proposals_open: number;
  readonly proposals_in_flight: number;
  readonly accepted_proposal_id: string | null;
  /** Operation kinds the accepted proposal intended — kinds only, never values. */
  readonly intended_operation_kinds: readonly string[];
  readonly tools_called: readonly string[];
  readonly refusals: readonly ReplacementRefusalCode[];
  /** True once this turn committed to DISPATCHING a write, whatever followed. */
  readonly write_attempted: boolean;
  /** True only on a proof of commit. `write_attempted && !write_committed`
   *  with no refusal code is the shape that must never occur. */
  readonly write_committed: boolean;
  readonly receipt_id: string | null;
  readonly new_model_revision: string | null;
  readonly iterations: number;
  readonly outcome: ReplacementTurnOutcome;
}

/**
 * Mutable accumulator. Built through the turn and frozen at the exit.
 *
 * ⚠ Deliberately not a class and deliberately not async: a record that can
 * throw, await or reorder is a record that changes the behaviour it is
 * supposed to observe.
 */
export interface ReplacementTraceRecorder {
  refused(code: ReplacementRefusalCode): void;
  accepted(proposalId: string, operationKinds: readonly string[]): void;
  writeAttempted(): void;
  writeCommitted(receiptId: string): void;
  revisionAdvanced(revision: string): void;
  finish(args: {
    readonly outcome: ReplacementTurnOutcome;
    readonly proposalsOpen: number;
    readonly proposalsInFlight: number;
    readonly toolsCalled: readonly string[];
    readonly iterations: number;
  }): ReplacementTurnTrace;
}

export function createReplacementTraceRecorder(args: {
  readonly correlationId: string;
  readonly modelRevision: string;
}): ReplacementTraceRecorder {
  const refusals: ReplacementRefusalCode[] = [];
  let acceptedProposalId: string | null = null;
  let intendedOperationKinds: readonly string[] = [];
  let writeAttempted = false;
  let writeCommitted = false;
  let receiptId: string | null = null;
  let newModelRevision: string | null = null;

  return {
    refused(code) {
      refusals.push(code);
    },
    accepted(proposalId, operationKinds) {
      acceptedProposalId = proposalId;
      intendedOperationKinds = [...operationKinds];
    },
    writeAttempted() {
      writeAttempted = true;
    },
    writeCommitted(id) {
      writeCommitted = true;
      receiptId = id;
    },
    revisionAdvanced(revision) {
      newModelRevision = revision;
    },
    finish(fin) {
      return Object.freeze({
        correlation_id: args.correlationId,
        controller: 'replacement' as const,
        model_revision: args.modelRevision,
        proposals_open: fin.proposalsOpen,
        proposals_in_flight: fin.proposalsInFlight,
        accepted_proposal_id: acceptedProposalId,
        intended_operation_kinds: intendedOperationKinds,
        tools_called: [...fin.toolsCalled],
        refusals: [...refusals],
        write_attempted: writeAttempted,
        write_committed: writeCommitted,
        receipt_id: receiptId,
        new_model_revision: newModelRevision,
        iterations: fin.iterations,
        outcome: fin.outcome,
      });
    },
  };
}

/**
 * The one invariant worth asserting about a finished trace, and the reason
 * the record is worth keeping at all: a turn that DISPATCHED a write must
 * end either committed or carrying a refusal code that says why not.
 *
 * A trace with `write_attempted` true, `write_committed` false and NO refusal
 * is the shape in which a user's change disappears with nobody able to say
 * what happened — the class this whole layer exists to remove. Exported so a
 * test can assert it over any trace, rather than restating the condition.
 */
export function traceAccountsForItsWrite(trace: ReplacementTurnTrace): boolean {
  if (!trace.write_attempted) return true;
  return trace.write_committed || trace.refusals.length > 0;
}
