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
 * `edit_graph_add_risk` continuity (F-HELD fix 4b, A-variant): the
 * add-risk clarify ("What factor drives it most?") persists an
 * `edit_graph_add_risk` pending (emitted by edit-graph-dispatch's
 * clarify branch), and this module claims the DRIVER answer — either
 * an answer-shaped reply ("Team size drives it most.") or a bare
 * factor label — against that pending, with the same liveness + hash
 * gates as set_factor_value. The deterministic add path still lives
 * in legacy `handleEditGraph` (no V5 add handler exists), so the
 * dispatch is a deterministic continuation in TurnExecutor: an
 * acknowledgement restating risk + driver plus an EXECUTABLE replay
 * chip whose compound message routes to the edit pipeline. The
 * answered pending is consumed by that turn's commit.
 */

import type { GraphLookup } from './validator.js';
import { bigramDice } from './validator.js';
import type { ElicitTargetBaselinePending, PendingAction } from '../session/pending-action.js';
import {
  filterLivePendingActions,
  findSoleLiveElicitBaselinePending,
  findBaselineAskCollision,
} from '../session/pending-action.js';
import { classifyElicitedBaselineAnswer } from '../../cee/factor-extraction/stated-level.js';

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
 * PR #413 review FIXUP 2 — the resumer's claimability predicate, exported
 * for chip EMITTERS. A chip whose replay relies on this pre-route (e.g.
 * the A2 "extend the scale" rescale chip, whose structured {value, unit,
 * cap} rides a pending action that ONLY this resumer reconstructs) must
 * not ship a replay message this module would refuse to claim: a factor
 * label containing a digit ("Phase 2 Cost") or an edit verb ("Set-up
 * Cost" — \bset\b matches across the hyphen) trips the negative gates
 * below, the click falls through to the LLM WITHOUT the structured
 * payload, and the user loops on the same failure. Emitters call this
 * with the exact rendered replay message and suppress the chip when it
 * returns false (degrade-only: honest copy still ships).
 */
export function isClaimableByClarificationResume(message: string): boolean {
  return (
    !EDIT_VERB_OR_QUANTITY_PATTERN.test(message) &&
    !SHORT_CONFIRM_LIKELIHOOD.test(message)
  );
}

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
    }
  | {
      /**
       * F-HELD fix 4b — the add-risk driver answer was claimed. The caller
       * (TurnExecutor) composes the deterministic continuation:
       * acknowledgement + executable replay chip, consuming `pending`.
       */
      readonly matched: true;
      readonly dispatch: 'edit_graph_add_risk';
      readonly pending: PendingAction;
      /** The risk label the clarify was about (persisted on the pending). */
      readonly riskLabel: string;
      /**
       * The driver named in the reply — the GRAPH label when it resolved to
       * an existing factor, else the user's own phrase (a new-concept
       * driver; the clarify's own examples routinely suggest factors that
       * do not exist yet).
       */
      readonly driverLabel: string;
      /** Resolved factor id, or null for a new-concept driver. */
      readonly driverFactorId: string | null;
      readonly matchKind: 'exact' | 'substring' | 'fuzzy' | 'answer_shape';
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

/**
 * Per-kind safety classification. Resuming a "mutating" kind against
 * a graph that has diverged since the pending was emitted is unsafe
 * — the target could have moved, structure could have changed, or
 * another mutation could have invalidated the original intent.
 *
 * `apply_proposed_change` and `edit_graph_add_risk` are both
 * graph-mutating kinds (their docstring in `pending-action.ts` notes
 * they depend on `graph_hash`). `apply_proposed_change` is now
 * emitted by `compose/proposed-change.ts::emitProposedChange` and
 * resumed via the deterministic short-confirm path, with hash
 * divergence enforced by `decideProposedChangeSynthesis` before
 * dispatch. `edit_graph_add_risk` is emitted by the add-risk clarify
 * branch in edit-graph-dispatch (F-HELD fix 4a) and resumed by this
 * module's driver-answer branch; the `mutating` classification below
 * is what makes its hash gate fail closed.
 * Classifying both as `mutating` means the divergence guard fires
 * by default rather than slipping through the non-mutating branch.
 *
 * Type design: `Record<PendingActionKind, ...>` is exhaustive at
 * compile time — adding a kind to the `PendingAction.action.kind`
 * union without classifying it here is a TypeScript error. The
 * regression test in `clarification-resume.test.ts` iterates this
 * record at runtime and pins each kind to its expected value, so a
 * future RECLASSIFICATION (e.g. moving set_factor_value out of
 * `mutating` by mistake) trips the test even though the type still
 * compiles.
 */
type SafetyClass = 'mutating' | 'non_mutating';

export const PENDING_ACTION_KIND_SAFETY_CLASSIFICATION: Record<
  PendingAction['action']['kind'],
  SafetyClass
> = {
  // Graph-mutating: applying the persisted operator/value changes
  // the graph. Hash divergence between emit and resume is unsafe.
  set_factor_value: 'mutating',
  // Reserved-but-not-emitted graph-mutating kinds. Classified as
  // mutating now so they fail closed by default when wired.
  apply_proposed_change: 'mutating',
  edit_graph_add_risk: 'mutating',
  // ROADMAP 2.1352 — the configure-option clarify intercept's asked cell.
  // Not resumed by this module today; classified MUTATING fail-closed because
  // answering it WRITES an option→factor effect value, and because the cell's
  // identity can be invalidated by a graph change between the ask and the
  // answer (an option or factor can be renamed or removed). Fail-closed is the
  // load-bearing half: an unclassified-but-wired kind would slip through the
  // non-mutating branch and skip the divergence guard entirely.
  elicit_option_effect: 'mutating',
  // ROADMAP 2.1353 — the two value-ask exits' offered cells. Not resumed by
  // this module today, and classified MUTATING for exactly 2.1352's reasoning:
  // answering "which of these does your 0.12 belong to?" WRITES an
  // option→factor effect value, and every candidate the pending names can be
  // invalidated by a graph change between the ask and the answer. Fail-closed
  // is the load-bearing half — an unclassified-but-wired kind would slip
  // through the non-mutating branch and skip the divergence guard.
  elicit_effect_target: 'mutating',
  // ROADMAP 2.1353 — the edit-clarify intercepts' offered targets. MUTATING on
  // the same fail-closed reasoning, and it is the right default even though the
  // question itself is weaker: the copy asks for "the specific factor, edge,
  // option, or value to change", so any answer this referent helps bind is an
  // EDIT, and its offered node ids are exactly what a graph change can move.
  elicit_edit_target: 'mutating',
  // ROADMAP 2.63 C3/C4 — the draft/redraft offer. Never resumed by this
  // module (route-v2's draft-offer pre-route owns it; here it falls
  // through like any unclassified-for-resume kind), but classified
  // MUTATING fail-closed: consenting to the C4 variant REPLACES the
  // persisted graph, and the offer pins `preconditions.graph_hash` so
  // divergence guards fire by default anywhere the kind is evaluated.
  draft_graph: 'mutating',
  // Non-mutating: resuming reads from analysis state but does not
  // change the graph; hash divergence is not a safety concern.
  run_analysis: 'non_mutating',
  what_would_flip: 'non_mutating',
  // V5 P0 proposal-memory continuation. The resumer in
  // `edit-graph-dispatch::decideNoOpRecovery` only emits deterministic
  // clarification copy (Stage 1 risk/factor/note chips or Stage 2
  // affect-target chips); no graph mutation is performed. Hash
  // divergence is still observed by the edit-graph-dispatch caller
  // (which emits `v5.proposal_continuation.invalidated` and skips
  // the resume), but for the safety classification here it is
  // non-mutating because applying the persisted concept does not
  // change the graph.
  proposed_concept: 'non_mutating',
  // Clarify v2 (E0-B, ROADMAP 1.94 Option A replacement). Draft-preflight
  // clarification round state, claimed exclusively by the flag-gated
  // clarify-v2 pre-route in route-v2. Resuming re-runs the deterministic
  // brief rubric and either asks again or proceeds to draft — it never
  // applies a persisted operator/value to the graph (there IS no graph at
  // the pre-draft stage), so hash divergence is not a safety concern.
  clarify_v2_round: 'non_mutating',
  // ROADMAP 2.918 — the pending baseline question. Resuming replays the
  // registered constraint through add_constraint, whose mint writes
  // `observed_state` on the target — a graph mutation, so hash divergence
  // between ask and answer fails closed (a diverged graph may carry a
  // CHANGED row, and replaying the persisted value would overwrite it).
  elicit_target_baseline: 'mutating',
};

const MUTATING_KINDS: ReadonlySet<PendingAction['action']['kind']> = new Set(
  (
    Object.entries(PENDING_ACTION_KIND_SAFETY_CLASSIFICATION) as Array<
      [PendingAction['action']['kind'], SafetyClass]
    >
  )
    .filter(([, safety]) => safety === 'mutating')
    .map(([kind]) => kind),
);

/**
 * Convenience export for the regression test and any external caller
 * that needs to read the classification without re-deriving it.
 */
export const PENDING_ACTION_KIND_SAFETY = {
  mutating: MUTATING_KINDS,
  byKind: PENDING_ACTION_KIND_SAFETY_CLASSIFICATION,
} as const;

function graphHashConflicts(
  pa: PendingAction,
  currentGraphHash: string | undefined,
): boolean {
  const persisted = pa.preconditions?.graph_hash;
  // Mutating kinds: missing hash on EITHER side is unsafe. A pending
  // emitted before the hash invariant existed (legacy row), a pending
  // emitted via a path that forgot to pass the hash, or a turn where
  // the hash cannot be computed (no graph state) all fail closed —
  // treat as conflict and let the caller surface a focused recovery.
  // For non-mutating kinds (`run_analysis`, `what_would_flip`) the
  // hash is intentionally not persisted; absence is fine.
  if (MUTATING_KINDS.has(pa.action.kind)) {
    if (!persisted) return true;
    if (currentGraphHash === undefined) return true;
    return persisted !== currentGraphHash;
  }
  // Non-mutating kinds: only flag when both sides exist and differ.
  if (!persisted) return false;
  if (currentGraphHash === undefined) return true;
  return persisted !== currentGraphHash;
}

/** Emit timestamp in ms for most-recent-wins ordering; malformed → oldest. */
function emittedAtMs(pa: PendingAction): number {
  const ms = Date.parse(pa.emitted_at_iso);
  return Number.isFinite(ms) ? ms : 0;
}

/**
 * F-HELD fix 4b — driver-answer shapes for the add-risk clarify question
 * ("What factor drives it most — for example team size, hiring pace, or
 * onboarding complexity?"). All anchored ^…$ with optional trailing
 * punctuation, capturing the driver phrase. Kept deliberately narrow: the
 * scaffold ("… drives it most") is the strong evidence the reply is
 * answering OUR question, which is what licenses claiming a driver that is
 * not (yet) a factor in the graph.
 */
const DRIVER_ANSWER_SCAFFOLDS: readonly RegExp[] = [
  // "Team size drives it most." / "Team size affects it the most"
  /^\s*(.+?)\s+(?:drives|affects|influences|impacts)\s+(?:it|this|that)(?:\s+(?:the\s+)?most)?\s*[.!?]*\s*$/i,
  // "Mostly team size." / "Mainly hiring pace"
  /^\s*(?:mostly|mainly|primarily|probably)\s+(.+?)\s*[.!?]*\s*$/i,
  // "It's mostly team size." / "It is mainly hiring pace"
  /^\s*it(?:['’]s|\s+is)\s+(?:mostly|mainly|primarily)\s+(.+?)\s*[.!?]*\s*$/i,
  // "Team size is the main driver." / "Hiring pace would be the biggest factor"
  /^\s*(.+?)\s+(?:is|would\s+be)\s+the\s+(?:main|biggest|primary|key|strongest)\s+(?:driver|factor)\s*[.!?]*\s*$/i,
];

/**
 * Bounded driver phrase: non-empty, ≤ 80 chars, not a bare pronoun, and not
 * a negation/filler. The stop-list (round-2 FIXUP 4) closes the false
 * positive where scaffold 2 captured "not" from "Probably not" and claimed
 * a declined clarify as the new-driver concept "not" — a declined or
 * non-committal reply must fall to the LLM, never mint a continuation.
 */
const DRIVER_STOP_LIST =
  /^(?:it|its|it['’]s|this|that|these|those|they|them|one|not|no|none|nothing|neither|nope|maybe|unsure|(?:i\s+)?don['’]?t\s+know|dunno|no\s+idea|not\s+sure)$/i;

function normaliseDriverCandidate(raw: string): string | null {
  const candidate = raw.trim().replace(/\s+/g, ' ');
  if (candidate.length < 2 || candidate.length > 80) return null;
  if (DRIVER_STOP_LIST.test(candidate)) return null;
  return candidate;
}

function extractDriverCandidate(
  message: string,
): { readonly candidate: string; readonly viaScaffold: boolean } | null {
  for (const re of DRIVER_ANSWER_SCAFFOLDS) {
    const m = re.exec(message);
    if (m !== null) {
      const candidate = normaliseDriverCandidate(m[1]!);
      if (candidate !== null) return { candidate, viaScaffold: true };
    }
  }
  // Bare-label reply (terse answer / chip echo): the whole message is the
  // candidate. Only ever claimed when it actually matches a graph factor.
  const bare = normaliseDriverCandidate(message);
  return bare !== null ? { candidate: bare, viaScaffold: false } : null;
}

/**
 * Resolve the driver phrase against the live graph's FACTOR labels. Same
 * exact → substring → fuzzy ladder as the set_factor_value flow; a match is
 * returned only when it is UNIQUE at its tier (an ambiguous driver falls back
 * to the scaffold path — the edit pipeline disambiguates with full context).
 */
function matchDriverToFactors(
  candidate: string,
  graphLookup: GraphLookup | undefined,
): { readonly id: string; readonly label: string; readonly matchKind: 'exact' | 'substring' | 'fuzzy' } | null {
  if (graphLookup === undefined) return null;
  const norm = candidate.toLowerCase();
  // The lookup vocabulary collapses factor/outcome/decision/risk/action into
  // the generic 'node' bucket (see graph-lookup-adapter.ts toEntityKind), so
  // this matches against all generic node labels — a uniqueness-gated label
  // match over that set is the closest available "factor label" resolution.
  const factors = graphLookup
    .listEntitiesByKind('node')
    .filter((f): f is { id: string; label: string } => typeof f.label === 'string' && f.label.trim().length > 0);
  const exact = factors.filter((f) => f.label.trim().toLowerCase() === norm);
  if (exact.length === 1) return { id: exact[0]!.id, label: exact[0]!.label, matchKind: 'exact' };
  if (exact.length > 1) return null;
  const substring = factors.filter((f) => {
    const normLabel = f.label.trim().toLowerCase();
    return norm.includes(normLabel) || normLabel.includes(norm);
  });
  if (substring.length === 1) {
    return { id: substring[0]!.id, label: substring[0]!.label, matchKind: 'substring' };
  }
  if (substring.length > 1) return null;
  let best: { id: string; label: string; score: number } | null = null;
  let bestIsUnique = true;
  for (const f of factors) {
    const score = bigramDice(norm, f.label.trim().toLowerCase());
    if (score < FUZZY_DICE_FLOOR) continue;
    if (best === null || score > best.score) {
      best = { id: f.id, label: f.label, score };
      bestIsUnique = true;
    } else if (score === best.score) {
      bestIsUnique = false;
    }
  }
  return best !== null && bestIsUnique
    ? { id: best.id, label: best.label, matchKind: 'fuzzy' }
    : null;
}

/**
 * F-HELD fix 4b — the add-risk driver-answer branch. Mirrors the
 * set_factor_value house style (kind gate → liveness → hash gate → match),
 * with ONE deliberate asymmetry: the answer-shape/label test runs FIRST, so
 * an arbitrary free-text reply is never claimed by an expiry/divergence
 * recovery. (The set_factor clarify expects any reply; the add-risk clarify's
 * answer either carries the scaffold or names a factor.)
 */
function tryAddRiskDriverResume(
  input: TryClarificationResumeInput,
  addRiskPendings: readonly PendingAction[],
): ClarificationResumeDispatch {
  const extraction = extractDriverCandidate(input.message);
  if (extraction === null) {
    return { matched: false, skip_reason: 'no_label_match' };
  }
  const match = matchDriverToFactors(extraction.candidate, input.graphLookup);
  if (match === null && !extraction.viaScaffold) {
    return { matched: false, skip_reason: 'no_label_match' };
  }

  const live = filterLivePendingActions(addRiskPendings, input.nowMs);
  if (live.length === 0) {
    return {
      matched: true,
      dispatch: 'recovery_expired',
      expired_count: addRiskPendings.length,
    };
  }
  const hashSafe = live.filter(
    (pa) => !graphHashConflicts(pa, input.currentGraphHash),
  );
  if (hashSafe.length === 0) {
    return { matched: true, dispatch: 'recovery_graph_changed' };
  }
  // Newest wins (single-slot in practice — each clarify emit supersedes by
  // key at commit; distinct labels can briefly coexist, freshest question first).
  const pending = [...hashSafe].sort((a, b) => emittedAtMs(b) - emittedAtMs(a))[0]!;
  const action = pending.action;
  if (action.kind !== 'edit_graph_add_risk') {
    return { matched: false, skip_reason: 'no_pending_clarification' };
  }
  return {
    matched: true,
    dispatch: 'edit_graph_add_risk',
    pending,
    riskLabel: action.label,
    driverLabel: match?.label ?? extraction.candidate,
    driverFactorId: match?.id ?? null,
    matchKind: match?.matchKind ?? 'answer_shape',
  };
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
  // F-HELD fix 4b — the add-risk driver-answer branch. Runs only when NO
  // set_factor_value clarification is pending: the two clarify kinds are not
  // co-emitted in practice, and if they ever coexist the value-update
  // clarify (an already-DECIDED change awaiting only its target) keeps its
  // existing precedence.
  if (setFactorPendings.length === 0) {
    const addRiskPendings = input.pendingActions.filter(
      (p) => p.action.kind === 'edit_graph_add_risk',
    );
    if (addRiskPendings.length > 0) {
      return tryAddRiskDriverResume(input, addRiskPendings);
    }
    return { matched: false, skip_reason: 'no_pending_clarification' };
  }

  // Apply expiry + graph-hash invalidation BEFORE label matching.
  // The remaining candidates are the only ones safe to apply.
  // Dispatch a focused recovery (rather than falling through to the
  // LLM) when the user's message would otherwise reach Sonnet with no
  // clarification context — the LLM can only guess, and the brief's
  // "every promise has an executable path" rule says the system should
  // surface the lapse and offer a real next step instead.
  // Track 2 — the shared read-time liveness authority (same wall + turn-count
  // rule the short-confirm resumer and the route-level suppressor use); this
  // was previously a third private `isExpired` copy of the identical predicate.
  const live = filterLivePendingActions(setFactorPendings, input.nowMs);
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

/**
 * ROADMAP 2.918 — the ANSWER-TURN pre-route for the pending baseline
 * question. When the immediately prior turn asked "Roughly what percentage
 * is <target> at right now?" (an `elicit_target_baseline` pending is live)
 * and the user's reply parses as a level answer for THAT target — elliptical
 * ("about 12%") through the question-context carry, or full-sentence through
 * the unchanged #868 grammar — the caller (TurnExecutor) synthesises a
 * value-identical `add_constraint` replay from the pending's own fields, so
 * the mint runs through the ONE existing writer with zero LLM calls.
 *
 * EVERY non-match falls through SILENTLY to the normal flow (no recovery
 * copy): the elicitation is additive by contract — a lapsed, diverged or
 * ignored question must leave behaviour exactly as it was before 2.918. The
 * skip reasons exist for telemetry only.
 *
 * Gates, in order, all fail-closed:
 *   - exactly ONE live pending question (two are ambiguous for a bare
 *     number — same unanimity doctrine as the extractor's competitor rule);
 *   - graph hash unchanged since the ask (MUTATING kind: the replay carries
 *     the persisted value, and a diverged graph may carry a CHANGED row that
 *     the replay would silently overwrite);
 *   - the target still exists with a usable label;
 *   - the message actually parses as a level answer bound to the target,
 *     via the SAME shared extractor the handler will re-run (one parser,
 *     called twice on identical inputs — deterministic, so match and mint
 *     cannot disagree).
 */
export type BaselineElicitationResumeDispatch =
  | {
      readonly matched: false;
      readonly skip_reason:
        | 'no_pending_question'
        | 'graph_diverged'
        | 'target_missing'
        | 'not_an_answer';
    }
  | {
      /**
       * R2918B — the user ANSWERED and the product cannot read the answer.
       * Distinct from `matched: false` on purpose: there is nothing to mint, so
       * this is not a bind, but staying silent here is the defect this closes.
       * The caller re-asks, naming the shape it needs, and re-persists the
       * question so the next attempt still has a referent to bind through.
       */
      readonly matched: false;
      readonly skip_reason: 'unreadable_answer';
      readonly pending: ElicitTargetBaselinePending;
      readonly targetLabel: string;
      readonly reason: 'out_of_range' | 'ambiguous_scale' | 'unreadable';
    }
  | {
      /**
       * TWO OF OUR OWN QUESTIONS ARE OPEN AND THIS MESSAGE ANSWERS THE SHAPE OF
       * BOTH. Nothing is minted and nothing binds: the caller ASKS which
       * question was meant, and both questions stay live.
       *
       * Distinct from `no_pending_question` on purpose. Before this verdict the
       * two were the same silent fall-through, and the turn landed in a lane
       * that does not refuse — writing the user's number onto an unrelated
       * cell. `competing` is non-empty by construction, so the ask can name the
       * other question rather than gesture at it.
       */
      readonly matched: false;
      readonly skip_reason: 'competing_ask';
      readonly pending: ElicitTargetBaselinePending;
      readonly targetLabel: string;
      readonly competing: readonly PendingAction[];
    }
  | {
      /**
       * ⭐⭐ THE REPLY BROUGHT ITS OWN SUBJECT, so the collision does not govern
       * it and this path must NOT claim it.
       *
       * A competing ask makes an ELLIPTICAL answer ambiguous — "30%" has no
       * subject and has to borrow the question's, so with two questions open we
       * cannot tell which one lent it. A reply that NAMES what it is talking
       * about ("Churn rate is 30%", "Churn is about 12%.") borrows nothing: it
       * binds by identity against the target's label with competitor unanimity,
       * exactly as it would on a turn with no pending question at all.
       *
       * Named apart from `no_pending_question` deliberately, even though both
       * fall through. They are different facts — "we were not asked" versus "we
       * were asked, two questions are open, and this reply resolves its own
       * subject anyway" — and collapsing two facts into one value is the defect
       * class this whole transition exists to close. A test can bind to this by
       * identity; telemetry can count it; a future reader cannot mistake it for
       * silence.
       *
       * WHAT HAPPENS NEXT is the pre-existing behaviour, unchanged: the turn
       * continues to the handler, whose own gate (`ellipticalAllowed === false`
       * when the sole-pending rule refuses) runs the subject-bearing limb and
       * records the baseline against the node the user named. This verdict
       * RESTORES that route; it does not add one.
       */
      readonly matched: false;
      readonly skip_reason: 'subject_bound_answer';
      readonly pending: ElicitTargetBaselinePending;
      readonly targetLabel: string;
    }
  | {
      readonly matched: true;
      readonly pending: ElicitTargetBaselinePending;
      /** The LIVE label of the target node (used for the receipt and replay). */
      readonly targetLabel: string;
    };

/**
 * The LIVE label of a baseline question's target, or `null` when the node has
 * gone or carries no usable label. One derivation, shared by both refusal
 * paths, so a target that vanished can never be named in copy.
 */
function resolveLiveTargetLabel(
  pending: ElicitTargetBaselinePending,
  graphNodes: ReadonlyArray<{ id?: unknown; label?: unknown }> | undefined,
): string | null {
  const target = graphNodes?.find((n) => n.id === pending.action.target_id);
  const label = typeof target?.label === 'string' ? target.label : undefined;
  if (target === undefined || label === undefined || label.trim() === '') return null;
  return label;
}

/** 2.960 R2 population: EVERY other labelled node in the live graph. */
function competingNodeLabels(
  graphNodes: ReadonlyArray<{ id?: unknown; label?: unknown }> | undefined,
  targetId: string,
): readonly (string | undefined)[] {
  return (graphNodes ?? [])
    .filter((n) => n.id !== targetId)
    .map((n) => (typeof n.label === 'string' ? n.label : undefined));
}

export function tryBaselineElicitationResume(input: {
  readonly message: string;
  readonly pendingActions: readonly PendingAction[];
  readonly nowMs: number;
  readonly currentGraphHash?: string;
  /** The live graph's nodes — the answer's competitor population (2.960 R2). */
  readonly graphNodes: ReadonlyArray<{ id?: unknown; label?: unknown }> | undefined;
}): BaselineElicitationResumeDispatch {
  const pending = findSoleLiveElicitBaselinePending(input.pendingActions, input.nowMs);
  if (pending === null) {
    // THE SOLE-PENDING GATE REFUSES FOR TWO REASONS AND ONLY ONE OF THEM IS
    // SILENCE. If a baseline question is live and merely COMPETING with another
    // bare-number ask, an answer-shaped reply must resolve here — by asking
    // which question it answers — never by falling through to a lane that binds
    // it to something the user was not asked about.
    const collision = findBaselineAskCollision(input.pendingActions, input.nowMs);
    if (collision === null) {
      return { matched: false, skip_reason: 'no_pending_question' };
    }
    const collisionLabel = resolveLiveTargetLabel(collision.baseline, input.graphNodes);
    // No target ⇒ nothing truthful to ask about ⇒ the pre-2.918 silence.
    if (collisionLabel === null) {
      return { matched: false, skip_reason: 'no_pending_question' };
    }
    // ONE classifier decides "is this an answer at all", the SAME one the
    // non-collision path uses — never a second text predicate (trap 12). This
    // is what keeps the counterpart harm safe: "set the pilot's effect on cost
    // to 0.3" is `not_an_answer`, so a genuine new INSTRUCTION still reaches
    // the edit lane untouched. Only a message shaped like a reply to the
    // question we asked is claimed here.
    //
    // NO GRAPH-HASH GATE, deliberately, and the asymmetry is the point: the
    // mutating path below fails closed on divergence because it REPLAYS a
    // persisted value. This branch mints nothing and writes nothing — it asks a
    // question — so the only thing it owes the user is that the target it names
    // still exists, which is checked immediately above.
    const collisionVerdict = classifyElicitedBaselineAnswer(
      input.message,
      collisionLabel,
      competingNodeLabels(input.graphNodes, collision.baseline.action.target_id),
    );
    if (collisionVerdict.outcome === 'not_an_answer') {
      return { matched: false, skip_reason: 'no_pending_question' };
    }
    // ⭐⭐ INDEPENDENT SUBJECT AUTHORITY BEATS THE COLLISION.
    //
    // The soleness rule is the licence for ELLIPTICAL CARRY — for a reply with
    // no subject that must borrow the question's. A reply that names its own
    // subject never borrowed anything, so a second open question cannot make it
    // ambiguous, and refusing it is a false positive that DROPS a legitimate
    // answer. The two harms cannot share one window: dropping a real answer is a
    // gap, minting an unasked-for edit is a lie.
    //
    // ⚠ NOT "accept every bound result" — that is the over-correction this
    // guard is written to avoid. A bare "30%" is ALSO `bound`; it is bound
    // `elliptical`, and it stays intercepted below. The discriminator is WHICH
    // LIMB bound it, which is recorded by the classifier itself rather than
    // re-derived here, so there is no second predicate over user text to drift
    // against the first.
    if (collisionVerdict.outcome === 'bound' && collisionVerdict.authority === 'subject') {
      return {
        matched: false,
        skip_reason: 'subject_bound_answer',
        pending: collision.baseline,
        targetLabel: collisionLabel,
      };
    }
    return {
      matched: false,
      skip_reason: 'competing_ask',
      pending: collision.baseline,
      targetLabel: collisionLabel,
      competing: collision.competing,
    };
  }
  // Mutating kind: missing hash on either side is a conflict (fail closed).
  if (graphHashConflicts(pending, input.currentGraphHash)) {
    return { matched: false, skip_reason: 'graph_diverged' };
  }
  const liveLabel = resolveLiveTargetLabel(pending, input.graphNodes);
  if (liveLabel === null) {
    return { matched: false, skip_reason: 'target_missing' };
  }
  const competingLabels = competingNodeLabels(input.graphNodes, pending.action.target_id);
  const verdict = classifyElicitedBaselineAnswer(input.message, liveLabel, competingLabels);
  if (verdict.outcome === 'unresolved') {
    // The user answered; the product cannot read it. Told, not swallowed.
    return {
      matched: false,
      skip_reason: 'unreadable_answer',
      pending,
      targetLabel: liveLabel,
      reason: verdict.reason,
    };
  }
  if (verdict.outcome !== 'bound') {
    // Not an answer to THIS question at all. Silence is contractual here: the
    // elicitation is additive, so an ignored question must leave the flow
    // exactly as it was before 2.918.
    return { matched: false, skip_reason: 'not_an_answer' };
  }
  return { matched: true, pending, targetLabel: liveLabel };
}
