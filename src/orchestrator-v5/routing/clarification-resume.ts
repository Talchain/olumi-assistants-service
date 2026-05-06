/**
 * V5 deterministic pre-route for clarification continuity.
 *
 * After a value-update clarify ("Which one should I update? Owner
 * Time Commitment / Engineering Time Commitment?"), a user who
 * types JUST a factor label ("Engineering Time Commitment") with no
 * quantity would lose the parsed quantity from the prior turn — the
 * existing `tryDeterministicValueUpdate` returns
 * `skip_reason: 'no_quantity'` and the message falls through to the
 * LLM with no clarification context.
 *
 * This pre-route reads the most-recent prior turn's pending actions
 * and looks for a `set_factor_value` pending whose target factor
 * label matches the user's reply. On a unique match the persisted
 * quantity + operator + factor_id are reconstructed into the same
 * proposal `tryDeterministicValueUpdate` would have produced — same
 * synthesis path, same handler dispatch, no LLM call.
 *
 * Negative gates (fall through to existing flow):
 *   - message contains an edit verb or quantity (handled by
 *     `tryDeterministicValueUpdate` directly)
 *   - message looks like a confirmation ("yes", "ok") (handled by
 *     `tryShortConfirmResume`)
 *   - no `set_factor_value` pending actions on the prior turn
 *   - no factor whose label matches the message
 *
 * Recovery dispatches (focused direct_answer, no LLM call):
 *   - all candidates expired
 *   - persisted graph_hash differs from live graph hash
 *   - all candidate factors have been removed from the live graph
 *   - the reply matches multiple candidates (re-clarify with chips)
 *
 * `edit_graph_add_risk` continuity is a planned follow-up and is
 * NOT handled here. The shape it needs is different (the user's
 * reply is a DRIVER factor, not the target risk label) and the
 * deterministic add path lives in legacy `handleEditGraph` rather
 * than the V5 handler registry.
 */

import type { GraphLookup } from './validator.js';
import { bigramDice } from './validator.js';
import type { PendingAction } from '../session/pending-action.js';

/**
 * Same negative-gate regex `tryShortConfirmResume` and
 * `tryDeterministicValueUpdate` use. Defence in depth — if either
 * pre-route ordering changes, this module still doesn't claim
 * messages that belong to those paths.
 */
const EDIT_VERB_OR_QUANTITY_PATTERN =
  /\b(?:increase|decrease|reduce|raise|lower|set|change|update|make|adjust|add|remove|replace|simplif|rebuild)\b|\d/i;

const SHORT_CONFIRM_LIKELIHOOD =
  /^\s*(?:yes|yep|yeah|sure|ok(?:ay)?|do(?:\s+(?:it|that))?|go(?:\s+ahead)?|apply(?:\s+it)?|confirm(?:ed)?|please\s+do)\b/i;

/**
 * Skip reasons where the resumer correctly defers to the LLM. The
 * caller routes the message normally — these are not actionable
 * clarifications and should not produce focused recovery copy.
 */
export type ClarificationResumeSkipReason =
  | 'message_likely_value_update'
  | 'message_likely_short_confirm'
  | 'no_pending_clarification'
  | 'no_graph'
  | 'no_label_match';

/**
 * The resumer claimed the turn for a deterministic dispatch. Each
 * dispatch maps to a distinct response shape the caller produces:
 *   - `set_factor_value`        — synthesise a handler proposal and run
 *                                 the V5 lifecycle.
 *   - `recovery_expired`        — curated copy: the offer expired.
 *   - `recovery_graph_changed`  — curated copy: the model changed since
 *                                 the clarification was emitted, so the
 *                                 persisted operator/value would be
 *                                 unsafe to apply.
 *   - `recovery_targets_missing` — curated copy: the candidate factors
 *                                 the clarification was about have all
 *                                 been removed from the graph.
 *   - `recovery_label_ambiguous` — focused re-clarification: the user's
 *                                 reply matched multiple candidates.
 *                                 The caller emits one chip per
 *                                 candidate and never calls the LLM.
 */
export type ClarificationResumeDispatch =
  | { readonly matched: false; readonly skip_reason: ClarificationResumeSkipReason }
  | {
      readonly matched: true;
      readonly dispatch: 'set_factor_value';
      readonly pending: PendingAction;
      readonly factorLabel: string;
      readonly matchKind: 'exact' | 'substring' | 'fuzzy';
    }
  | {
      readonly matched: true;
      readonly dispatch: 'recovery_expired';
      readonly expired_count: number;
    }
  | {
      readonly matched: true;
      readonly dispatch: 'recovery_graph_changed';
    }
  | {
      readonly matched: true;
      readonly dispatch: 'recovery_targets_missing';
    }
  | {
      readonly matched: true;
      readonly dispatch: 'recovery_label_ambiguous';
      readonly candidates: ReadonlyArray<{
        readonly pending: PendingAction;
        readonly factorLabel: string;
      }>;
    };

export interface TryClarificationResumeInput {
  readonly message: string;
  readonly pendingActions: readonly PendingAction[];
  readonly graphLookup: GraphLookup | undefined;
  /**
   * `Date.now()` at dispatch time. Plumbed in for testability so unit
   * tests freeze the clock without monkey-patching `Date`.
   */
  readonly nowMs: number;
  /**
   * Hash of the analysis-affecting graph state at resume time. When a
   * pending action was persisted with `preconditions.graph_hash` and
   * the live hash differs, the persisted operator/value may no longer
   * be safe to apply (the target could have moved, structure could
   * have changed). Pass undefined when no graph hash is computable.
   */
  readonly currentGraphHash?: string;
}

const FUZZY_DICE_FLOOR = 0.5;

function isExpired(pa: PendingAction, nowMs: number): boolean {
  // Mirrors the wall-clock and turn-count checks in
  // `tryShortConfirmResume.isExpired`. Keep the rules in sync — both
  // resumers must agree on what "expired" means.
  const expiresMs = Date.parse(pa.expires_at_iso);
  if (!Number.isFinite(expiresMs)) return true;
  if (nowMs > expiresMs) return true;
  if (pa.expires_at_turn_count <= 0) return true;
  return false;
}

function graphHashConflicts(
  pa: PendingAction,
  currentGraphHash: string | undefined,
): boolean {
  // If the persisted action carries no hash precondition, no conflict
  // possible — any current hash is acceptable. If it does carry one
  // and the current hash is unknown OR differs, treat as conflict.
  const persisted = pa.preconditions?.graph_hash;
  if (!persisted) return false;
  if (currentGraphHash === undefined) return true;
  return persisted !== currentGraphHash;
}

export function tryClarificationResume(
  input: TryClarificationResumeInput,
): ClarificationResumeDispatch {
  // Negative gates: defer to the canonical pre-routes if the message
  // shape is theirs. A user who types "set Engineering Capacity to
  // 30%" carries everything needed for `tryDeterministicValueUpdate`
  // to dispatch directly; we should not intercept that.
  if (EDIT_VERB_OR_QUANTITY_PATTERN.test(input.message)) {
    return { matched: false, skip_reason: 'message_likely_value_update' };
  }
  if (SHORT_CONFIRM_LIKELIHOOD.test(input.message)) {
    return { matched: false, skip_reason: 'message_likely_short_confirm' };
  }

  const setFactorPendings = input.pendingActions.filter(
    (p) => p.action.kind === 'set_factor_value',
  );
  if (setFactorPendings.length === 0) {
    return { matched: false, skip_reason: 'no_pending_clarification' };
  }

  // Apply expiry + graph-hash invalidation BEFORE label matching.
  // The remaining candidates are the only ones safe to apply.
  // Dispatch a focused recovery (rather than falling through to the
  // LLM) when the user's message would otherwise reach Sonnet with no
  // clarification context — the LLM can only guess, and the brief's
  // "every promise has an executable path" rule says the system should
  // surface the lapse and offer a real next step instead.
  const live = setFactorPendings.filter((pa) => !isExpired(pa, input.nowMs));
  if (live.length === 0) {
    return {
      matched: true,
      dispatch: 'recovery_expired',
      expired_count: setFactorPendings.length,
    };
  }
  const hashSafe = live.filter(
    (pa) => !graphHashConflicts(pa, input.currentGraphHash),
  );
  if (hashSafe.length === 0) {
    return { matched: true, dispatch: 'recovery_graph_changed' };
  }

  if (input.graphLookup === undefined) {
    // No graph means we cannot resolve factor labels for matching.
    // The persisted pending action's factor_id would be unmatched
    // against an unknown graph; safer to fall through.
    return { matched: false, skip_reason: 'no_graph' };
  }

  const normMessage = input.message.trim().toLowerCase();
  if (normMessage.length === 0) {
    return { matched: false, skip_reason: 'no_label_match' };
  }

  // Build a working set of candidates whose target factor still
  // exists in the live graph. Persisted pending actions whose
  // factor_id has been deleted since are dropped here with a
  // distinct invalidation reason from "no label match".
  type Candidate = {
    pending: PendingAction;
    label: string;
    score: number;
    matchKind: 'exact' | 'substring' | 'fuzzy';
  };
  const targetsResolved: Array<{ pending: PendingAction; label: string }> = [];
  for (const pending of hashSafe) {
    const action = pending.action;
    if (action.kind !== 'set_factor_value') continue;
    const node = input.graphLookup.findEntityById(action.factor_id);
    if (!node?.label) continue;
    targetsResolved.push({ pending, label: node.label });
  }
  if (targetsResolved.length === 0) {
    return { matched: true, dispatch: 'recovery_targets_missing' };
  }

  // Pass 1: exact + substring match (deterministic, high-confidence).
  const directMatches: Candidate[] = [];
  for (const t of targetsResolved) {
    const normLabel = t.label.trim().toLowerCase();
    if (normLabel.length === 0) continue;
    if (normMessage === normLabel) {
      directMatches.push({ pending: t.pending, label: t.label, score: 1, matchKind: 'exact' });
    } else if (normMessage.includes(normLabel)) {
      directMatches.push({ pending: t.pending, label: t.label, score: 1, matchKind: 'substring' });
    }
  }

  // Pass 2: fuzzy bigram-Dice fallback. Only runs when no direct
  // matches were found. The candidate set in this pre-route is small
  // (at most 4, all label-similar to the prior turn's user message),
  // so a 0.5 threshold is conservative — typos like "Engneering Time
  // Comitmnt" still cluster well above 0.5 against "Engineering Time
  // Commitment", but unrelated factors do not. Above-threshold
  // matches sort by score; ambiguity goes to multiple_label_matches.
  let pickFrom: Candidate[] = directMatches;
  if (directMatches.length === 0) {
    const fuzzy: Candidate[] = [];
    for (const t of targetsResolved) {
      const normLabel = t.label.trim().toLowerCase();
      if (normLabel.length === 0) continue;
      const score = bigramDice(normMessage, normLabel);
      if (score >= FUZZY_DICE_FLOOR) {
        fuzzy.push({ pending: t.pending, label: t.label, score, matchKind: 'fuzzy' });
      }
    }
    pickFrom = fuzzy;
  }

  if (pickFrom.length === 0) {
    return { matched: false, skip_reason: 'no_label_match' };
  }
  if (pickFrom.length > 1) {
    // Surface the matched candidates so the caller can emit a focused
    // re-clarification (one chip per candidate) rather than send the
    // ambiguous reply to the LLM with no context. Sort high-score
    // first so the chip order is deterministic and the strongest
    // match leads.
    const sorted = [...pickFrom].sort((a, b) => b.score - a.score);
    return {
      matched: true,
      dispatch: 'recovery_label_ambiguous',
      candidates: sorted.map((c) => ({
        pending: c.pending,
        factorLabel: c.label,
      })),
    };
  }

  return {
    matched: true,
    dispatch: 'set_factor_value',
    pending: pickFrom[0]!.pending,
    factorLabel: pickFrom[0]!.label,
    matchKind: pickFrom[0]!.matchKind,
  };
}
