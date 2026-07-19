/**
 * Graph Management — edit_graph referee gate (the lane-8 live-wiring seam).
 *
 * Sits between `handleEditGraph` (which validated + applied the operations
 * in memory) and the dispatch's commit region. Projects the validated
 * `PatchOperation[]` into CandidateMutationEnvelopes, referees them against
 * the frame authorities (hash + pre-edit freshness, resolved by the CALLER —
 * the GM module never re-derives), and returns ONE governing decision.
 *
 * Mode semantics (CEE_GRAPH_MANAGEMENT_MODE):
 *  - 'shadow': evaluate + emit redacted v5.candidate_mutation.<verdict>
 *    telemetry; NEVER blocks — the existing path proceeds byte-identically
 *    (the A3 CAS-observe pattern).
 *  - 'live': verdicts route. would_apply (ALL envelopes) → proceed through
 *    the existing apply path unchanged. held → block the persist and emit a
 *    REAL pending confirmation (apply_proposed_change) carrying the
 *    executable payload: `inline_patch.operations` = the canonical
 *    validated PatchOperation batch (lane 34). `inline_patch.handler_id`
 *    stays OUTSIDE the synthesis allowlist — the generic synthesis path
 *    still resolves 'invalid' → decline-with-clarify — and the dedicated
 *    GM held-execute resume branch in TurnExecutor (handlers/
 *    gm-held-execute.ts) executes the confirmed batch ONLY when the mode
 *    is 'live' at resume time. When the payload cannot be embedded
 *    (oversize), the pending degrades to the lane-8 decline-with-clarify
 *    posture. stale → refresh/rerun recovery. rejected /
 *    clarify_required → recovery / clarify templates with the referee's
 *    REDACTED public reason (codes + fixed readables on a wire details
 *    block; blocker readables never enter assistant_text, where the egress
 *    forbidden-phrase guard could erase the whole response).
 *
 * Structural honesty: in live mode a blocked verdict means NO graph commit,
 * NO edit fact, NO analysis_ready stamp, NO ack prose — the caller gates all
 * four on `decision.blockApply`. GM itself never writes graph state; the
 * single durable writer remains `commitDirectAnswer`.
 *
 * Fail-closed (mission 2d): any exception inside the gate resolves to
 * log-only in shadow and a block-with-clarify decision in live — the turn
 * never crashes and a mutation is never silently applied past a broken
 * referee.
 *
 * All user-facing wording in this file: provisional_doctrine_v0.
 */

import { createHash, randomUUID } from 'node:crypto';

import { emit, log, TelemetryEvents } from '../../utils/telemetry.js';
import {
  editOperationsToCandidateEnvelopes,
  type EditPatchOperationLike,
} from '../graph-management/adapters/edit-graph-producer.js';
import { refereeMutationBatch } from '../graph-management/referee.js';
import { parseEnvelope } from '../graph-management/parse-envelope.js';
import { mutationTargetKey } from '../graph-management/pending-projection.js';
import {
  buildHeldProposalBlock,
  type HeldProposalBlockInput,
} from '../compose/held-proposal.js';
import { sanitisePublicCopyOrFallback } from '../compose/proposed-change.js';
import {
  clampLabel,
  describeHeldOperationsSubject,
  type HeldOpLike,
} from './describe-changeset.js';
import { optionIdsAddedWithInterventionIntent } from '../../orchestrator/tools/encode-option-interventions.js';
import type { HeldProposalBlock } from '@talchain/schemas/boundary';
import { mutationTelemetryEvent } from '../graph-management/telemetry.js';
import type {
  CandidateMutationEnvelope,
  FrameFreshness,
  MutationFrame,
  MutationVerdict,
  RefereeVerdict,
} from '../graph-management/types.js';
import {
  isPendingActionExpired,
  PENDING_ACTION_DEFAULT_WALL_TTL_MS,
  type PendingAction,
} from '../session/pending-action.js';

// ---------------------------------------------------------------------------
// Types.
// ---------------------------------------------------------------------------

export interface EditGmChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type?: 'run_analysis';
}

export interface EditGmEvaluationInput {
  readonly mode: 'shadow' | 'live';
  /** The validated canonical operations from `handleEditGraph`. */
  readonly operations: readonly EditPatchOperationLike[];
  /** Optional per-op rationales (operation_meta), parallel-indexed. */
  readonly rationales?: readonly (string | undefined)[];
  /** Frame-authority PRE-edit graph (strict persisted base, ingress fallback). */
  readonly currentGraph: unknown;
  /** Hash of `currentGraph` — resolved by the caller, never re-derived here. */
  readonly currentGraphHash: string | null;
  /** Hash of the graph the ops were generated against (the ingress echo). */
  readonly baseGraphHash: string | null;
  /** PRE-edit freshness verdict ('unknown' when the derivation degraded). */
  readonly freshness: FrameFreshness;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
  /**
   * Lane 34 — telemetry attribution for the redacted verdict events.
   * 'edit_graph' (default) = the hold-time gate at the dispatch seam;
   * 'gm_held_resume' = the confirm-time re-referee inside the held-execute
   * resume path. Event NAMES are unchanged (frozen registry).
   */
  readonly dispatchPath?: 'edit_graph' | 'gm_held_resume';
}

export type EditGmGoverningVerdict =
  | 'proceed'
  | 'held'
  | 'stale'
  | 'rejected'
  | 'clarify_required';

/**
 * Lane 34 — the GM held pending's dispatch key. Deliberately NOT a
 * `V5ActionType` and NOT in the synthesis `ALLOWED_HANDLER_IDS`: the generic
 * proposed-change synthesis resolves it 'invalid' (decline-with-clarify),
 * and ONLY the dedicated held-execute resume branch (TurnExecutor →
 * handlers/gm-held-execute.ts, live mode only) recognises it.
 */
export const GM_HELD_HANDLER_ID = 'graph_management_held_v1';

/** Lane 34 — pending carries the executable batch; confirm applies it. */
export const GM_HELD_APPLY_WIRING_EXECUTE = 'held_execute_v1';
/** Lane 8 posture — pending carries no payload; confirm declines. */
export const GM_HELD_APPLY_WIRING_DECLINE = 'decline_with_clarify_v0';

/**
 * Defensive cap on the embedded operations payload (JSON chars). The
 * pending persists in the `pending_actions` JSONB column alongside the
 * turn row; an oversized batch must degrade to the decline posture, never
 * jeopardise the commit write. Batches are ≤ 8 envelopes (referee cap), so
 * this bound is generous.
 */
export const GM_HELD_OPERATIONS_MAX_JSON_CHARS = 16_000;

/**
 * F-HELD fix 2a (wire finding 2026-07-11) — GM holds get their OWN turn-TTL,
 * longer than the chip-suggestion default (`PENDING_ACTION_DEFAULT_TURN_TTL`
 * = 2). A hold is an explicit consent question, not a disposable suggestion:
 * with the 2-turn default, one clarify detour plus one answer turn killed
 * the hold before the user could get back to it. Four turns gives a short
 * detour room to resolve while the wall-clock TTL
 * (`PENDING_ACTION_DEFAULT_WALL_TTL_MS`, unchanged) still bounds total
 * lifetime. When the hold DOES lapse by turn TTL, the commit carry-forward
 * surfaces an honest lapse notice (see commit.ts, F-HELD fix 2b) instead of
 * dropping it silently.
 *
 * RESIDUAL CLOSED for edit/draft (HOLD-WIPE fix, task_2e1b8c87): the
 * round-2 correction documented here that edit- and draft-classified
 * dispatch commits threaded NO `priorPendingActions` and silently WIPED
 * live holds. Both dispatchers now thread the prior pendings through
 * `threadHoldsThroughMutatingCommit` (handlers/hold-thread-through.ts):
 * a graph-writing commit validates each live hold against the
 * post-mutation graph (via `assessHeldBatchAgainstGraph` below) and either
 * threads it re-pinned or lapses it HONESTLY (deterministic notice +
 * redacted telemetry); non-mutating turns thread all priors unchanged.
 * REMAINING sharers of the wipe (not in this lane's scope): chip-click
 * dispatch (handlers/chip-click-dispatch.ts) and system-event dispatch
 * (system-events/dispatch.ts) still commit without `priorPendingActions`.
 */
export const GM_HELD_PENDING_TURN_TTL = 4;

export interface EditGmDecision {
  readonly governing: EditGmGoverningVerdict;
  /** True ONLY in live mode for a non-proceed governing verdict. */
  readonly blockApply: boolean;
  /** Replacement assistant text when blocking (provisional_doctrine_v0). */
  readonly assistantText: string | null;
  /** Replacement chip set when blocking. */
  readonly suggestedActions: readonly EditGmChip[] | null;
  /** Explicit pending actions to persist with the blocked turn (held only). */
  readonly pendingActions: readonly PendingAction[] | null;
  /**
   * Redacted public reason of the governing verdict for the wire details
   * block: verdict, mutation_class, blocker code + fixed readable,
   * candidate_id, base_hash_match — NEVER RefereeVerdict.candidate internals.
   */
  readonly publicReason: Record<string, unknown> | null;
  /** Per-verdict tally for logs/diagnostics (closed enum keys). */
  readonly verdictCounts: Readonly<Partial<Record<MutationVerdict, number>>>;
  /**
   * R8: schema-valid held_proposal block for the governing held verdict.
   * Present ONLY on the initial-hold (dispatchPath 'edit_graph')
   * held-with-pending path; null/absent everywhere else (incl. the
   * gm_held_resume re-referee — the block must not double-emit on confirm).
   * The dispatch seam appends it unconditionally (R8 flag deleted); a
   * null/absent block simply appends nothing.
   */
  readonly heldProposalBlock?: HeldProposalBlock | null;
}

const PROCEED_DECISION: EditGmDecision = {
  governing: 'proceed',
  blockApply: false,
  assistantText: null,
  suggestedActions: null,
  pendingActions: null,
  publicReason: null,
  verdictCounts: {},
};

// ---------------------------------------------------------------------------
// Copy (provisional_doctrine_v0) — swept against findSuccessClaimHit /
// findForbiddenPhraseHit by edit-graph-referee-gate.test.ts.
// ---------------------------------------------------------------------------

/** held — a real pending confirmation exists. provisional_doctrine_v0. */
export const GM_HELD_ASSISTANT_TEXT =
  "I'm holding that change rather than applying it straight away. Nothing in " +
  'the model moves until you confirm. Reply yes to continue, or tell me what ' +
  'to adjust instead.';

/** held chip copy. provisional_doctrine_v0 (no internal tokens, no em dash). */
export const GM_HELD_CHIP_LABEL = 'Continue with this change';
export const GM_HELD_CHIP_MESSAGE = 'Yes';

/** held, but no frame/pending could be established. provisional_doctrine_v0. */
export const GM_HELD_NO_PENDING_ASSISTANT_TEXT =
  "I can't safely take that change forward right now, so the model is " +
  'unchanged for the moment. Tell me again what you would like to change and ' +
  "I'll pick it up fresh.";

/** stale — the base moved or the analysis is not current. provisional_doctrine_v0. */
export const GM_STALE_ASSISTANT_TEXT =
  'The model has moved since that edit was prepared, so I held it rather ' +
  'than applying it against the wrong baseline. Run the analysis again to ' +
  'get back in sync, then tell me the change once more.';

/** rejected — integrity/safety failure. provisional_doctrine_v0. */
export const GM_REJECTED_ASSISTANT_TEXT =
  "I couldn't take that change forward, so the model is unchanged. Tell me " +
  'a different way you would like to change it and I will try again.';

/** clarify_required — well-formed but non-mutating/ambiguous. provisional_doctrine_v0. */
export const GM_CLARIFY_ASSISTANT_TEXT =
  'Before I change anything in the model I need a little more direction. ' +
  'Tell me exactly what you would like this change to affect.';

// ---------------------------------------------------------------------------
// CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11) — named consent asks.
// Doctrine (a): every consent ask states EXACTLY what the user is
// confirming. The held ask, its chip and its persisted public copy all
// name the held change; the generic constants above remain the safe
// fallbacks when no subject can be derived (or the derived subject would
// leak unsafe copy).
// ---------------------------------------------------------------------------

// CHANGESET HONESTY MECHANISM (ROADMAP 1.134, kills F6+F7 — Paul,
// 2026-07-16): the batch description is derived by ONE source function,
// `describeChangeset` (./describe-changeset.ts), which names EVERY
// operation specifically — the pre-mechanism collapse of ops 2..n into
// "and N more changes" left GM unable to audit its own applied changeset
// on all three surfaces (hold ask, chip, receipt). The seam is re-exported
// under its original name so the three surfaces keep converging on it; a
// second same-named implementation here is the drift vector that created
// the defect (the two-`generateGraphHash` class) and must never return.
export { describeHeldOperationsSubject, type HeldOpLike } from './describe-changeset.js';

/** True iff `subject` survives the render-safety filter verbatim
 *  (no em dash, no internal tokens — the same filter chips render with). */
function subjectIsSafe(subject: string): boolean {
  return sanitisePublicCopyOrFallback(subject, ' ') === subject.trim();
}

/**
 * The held consent ask, NAMED. Falls back to the generic swept
 * {@link GM_HELD_ASSISTANT_TEXT} when no safe subject is available.
 *
 * CHANGESET HONESTY (1.134): the subject now enumerates EVERY operation
 * in the held batch, so a multi-op hold states the changes plurally and
 * lists them after a colon; the single-op framing is unchanged.
 */
export function buildGmHeldAssistantText(
  subject: string | null,
  opCount: number = 1,
): string {
  if (subject === null || !subjectIsSafe(subject)) return GM_HELD_ASSISTANT_TEXT;
  if (opCount > 1) {
    return (
      `I'm holding these changes rather than applying them straight away: ${subject}. ` +
      'Nothing in the model moves until you confirm. Reply yes to continue, or tell ' +
      'me what to adjust instead.'
    );
  }
  return (
    `I'm holding the change to ${subject} rather than applying it straight away. ` +
    'Nothing in the model moves until you confirm. Reply yes to continue, or tell ' +
    'me what to adjust instead.'
  );
}

/**
 * ROADMAP 2.11 / P1-3 — needs-encoding disclosure ON THE HOLD. An
 * `add_node` option op whose payload requests NO interventions will, once
 * confirmed, persist an option with no effect values — and PLoT preflight
 * then 422-blocks the WHOLE analysis (`options_not_configured`). The
 * live-proven failure (2.11 diagnosis, scenario A A2→A4) is that the user
 * learns this only two turns later, from a recovery chip that used to loop.
 * The consent ask must say it AT ADD TIME.
 *
 * Detection derives from `optionIdsAddedWithInterventionIntent` — the SAME
 * intent classifier the edit pipeline's configure-or-don't-persist gate
 * uses (encode-option-interventions.ts) — so "requests interventions" can
 * never mean two different things (trap-12). Labels are render-safety
 * filtered; nothing safe to say → null (copy unchanged).
 */
/** Total object view of an op payload (hostile shapes → empty record). */
function opAsRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

export function buildNeedsEncodingAddNotice(
  operations: readonly HeldOpLike[],
  currentGraph: unknown,
): string | null {
  void currentGraph; // labels come from the ADD payloads, not the pre-add graph
  const withIntent = optionIdsAddedWithInterventionIntent(
    operations as ReadonlyArray<{ op?: unknown; value?: unknown }>,
  );
  const labels: string[] = [];
  for (const op of operations) {
    if (op.op !== 'add_node') continue;
    const value = opAsRecord(op.value);
    if (value.kind !== 'option') continue;
    const id = typeof value.id === 'string' ? value.id : undefined;
    if (id !== undefined && withIntent.has(id)) continue;
    const label = typeof value.label === 'string' ? value.label.trim() : '';
    if (label.length === 0 || !subjectIsSafe(label)) continue;
    labels.push(clampLabel(label));
  }
  if (labels.length === 0) return null;
  const first = `'${labels[0]}'`;
  const named =
    labels.length === 1
      ? first
      : `${first} and ${labels.length - 1} more option${labels.length - 1 === 1 ? '' : 's'}`;
  return (
    `Heads up: ${named} ${labels.length === 1 ? 'has' : 'have'} no effect values yet, ` +
    'so the analysis will stay blocked after this is applied until you set them. ' +
    `You can tell me what ${labels.length === 1 ? 'it' : 'each one'} changes once it is added.`
  );
}

/**
 * P0 held-proposal survival (2026-07-15, DGAI #340) requirement 4 — honest
 * supersession. A newer hold for the SAME target silently retires the older
 * one via the commit carry-forward's same-key rule (`gmHeldProposalRef` is
 * keyed on scenario + target), and a hold for a DIFFERENT target leaves TWO
 * consents live with no mention. Neither state may be silent: the hold-turn
 * copy must say what happened to the earlier hold.
 */
export const GM_HELD_REPLACES_PRIOR_NOTICE =
  'This replaces the change I was holding before for the same part of the model.';

/** Fallback when the earlier still-live hold has no safe printable label. */
export const GM_HELD_COEXISTS_PRIOR_NOTICE_GENERIC =
  'I am still holding an earlier change as well. Confirm them one at a time, or say all of them.';

/**
 * Deterministic one-sentence notice for a NEW hold minted while an earlier
 * consent hold is still live. Same-target (same deterministic `gmh_` handle,
 * which the commit carry-forward will retire) → the "replaces" sentence.
 * Different target (both stay live; a bare "yes" now lists them) → name the
 * earlier hold so neither consent is silent. Null when no live prior
 * consent hold exists — the common case, copy unchanged.
 */
export function buildHeldSupersessionNotice(
  newHold: PendingAction,
  priorPendings: readonly PendingAction[],
  nowMs: number,
): string | null {
  const livePriorHolds = priorPendings.filter(
    (pa) =>
      pa.action.kind === 'apply_proposed_change' && !isPendingActionExpired(pa, nowMs),
  );
  if (livePriorHolds.length === 0) return null;
  if (livePriorHolds.some((pa) => pa.chip_id === newHold.chip_id)) {
    return GM_HELD_REPLACES_PRIOR_NOTICE;
  }
  const other = livePriorHolds[0]!;
  const rawLabel =
    other.action.kind === 'apply_proposed_change' &&
    typeof other.action.public_label === 'string'
      ? other.action.public_label.trim()
      : '';
  if (rawLabel.length === 0 || !subjectIsSafe(rawLabel)) {
    return GM_HELD_COEXISTS_PRIOR_NOTICE_GENERIC;
  }
  return (
    `I am still holding the earlier change '${clampLabel(rawLabel)}' as well. ` +
    'Confirm them one at a time, or say all of them.'
  );
}

/**
 * Named chip / persisted public copy for a held pending. The label is the
 * capitalised subject; the message is an explicit confirmation naming the
 * subject, so a chip click (which replays the message as user text)
 * resolves via the exact-match pre-route to THIS hold — never ambiguously
 * via a bare "Yes" when several consents are live.
 */
export function buildGmHeldPublicCopy(subject: string | null): {
  label: string;
  message: string;
} {
  if (subject === null || !subjectIsSafe(subject)) {
    return { label: GM_HELD_CHIP_LABEL, message: GM_HELD_CHIP_MESSAGE };
  }
  const label = subject.charAt(0).toUpperCase() + subject.slice(1);
  return { label, message: `Yes, ${subject}.` };
}

// ---------------------------------------------------------------------------
// Internals.
// ---------------------------------------------------------------------------

/** Verdict → registered telemetry enum member (validate-event-names contract). */
const VERDICT_EVENT: Readonly<Record<MutationVerdict, string>> = {
  would_apply: TelemetryEvents.V5CandidateMutationWouldApply,
  held: TelemetryEvents.V5CandidateMutationHeld,
  stale: TelemetryEvents.V5CandidateMutationStale,
  rejected: TelemetryEvents.V5CandidateMutationRejected,
  clarify_required: TelemetryEvents.V5CandidateMutationClarifyRequired,
};

/** Severity precedence for the batch-governing verdict (conservative). */
function governingOf(verdicts: readonly RefereeVerdict[]): EditGmGoverningVerdict {
  const has = (v: MutationVerdict): boolean => verdicts.some((x) => x.verdict === v);
  if (has('rejected')) return 'rejected';
  if (has('stale')) return 'stale';
  if (has('held')) return 'held';
  if (has('clarify_required')) return 'clarify_required';
  return 'proceed';
}

function tally(
  verdicts: readonly RefereeVerdict[],
): Readonly<Partial<Record<MutationVerdict, number>>> {
  const counts: Partial<Record<MutationVerdict, number>> = {};
  for (const v of verdicts) counts[v.verdict] = (counts[v.verdict] ?? 0) + 1;
  return counts;
}

/** Redacted public-reason projection (T4.0 §5 — codes/enums/booleans only). */
function publicReasonOf(v: RefereeVerdict): Record<string, unknown> {
  return {
    source: 'graph_management',
    verdict: v.verdict,
    mutation_class: v.mutation_class,
    blocker_code: v.blocker?.code ?? null,
    blocker_readable: v.blocker?.readable ?? null,
    candidate_id: v.candidate_id,
    base_hash_match: v.base_hash_match,
  };
}

/**
 * Deterministic held-pending handle: `gmh_<sha256-12hex>` keyed on
 * (scenario, mutation target). A NEWER held offer for the SAME target gets
 * the SAME handle, so the commit carry-forward's same-key supersession rule
 * retires the older one — the §6.7 supersession contract realised through
 * the existing pending lifecycle (see graph-management/pending-projection.ts).
 */
export function gmHeldProposalRef(scenarioId: string, targetKey: string): string {
  const digest = createHash('sha256')
    .update(`${scenarioId}:${targetKey}`, 'utf8')
    .digest('hex')
    .slice(0, 12);
  return `gmh_${digest}`;
}

interface RefereedBatch {
  readonly verdicts: readonly RefereeVerdict[];
  /** Parsed envelopes parallel to `verdicts` (null where R1 rejected / batch-level). */
  readonly envelopes: readonly (CandidateMutationEnvelope | null)[];
}

function refereeBatch(input: EditGmEvaluationInput): RefereedBatch {
  const frame: MutationFrame = {
    currentGraphHash: input.currentGraphHash,
    graphReadable: input.currentGraphHash !== null,
    freshness: input.freshness,
  };
  const raw = editOperationsToCandidateEnvelopes(input.operations, {
    // An unresolvable base hash gets a non-empty placeholder so R1 accepts
    // the envelope and the FRAME gate classifies it: null currentGraphHash →
    // held CURRENT_GRAPH_UNREADABLE (mission 2d: unreadable → held, not a
    // schema reject); readable frame + unresolved base → stale
    // BASE_HASH_DIVERGED (we cannot prove the base matches → fail closed).
    base_graph_hash: input.baseGraphHash ?? 'unresolved',
    scenario_id: input.scenarioId,
    turn_id: input.turnId,
    makeCandidateId: randomUUID,
    ...(input.rationales !== undefined ? { rationales: input.rationales } : {}),
  });
  const verdicts = refereeMutationBatch(raw, input.currentGraph, frame);
  // Batch-level failures (cap / unreadable batch) return ONE verdict for the
  // whole batch — no per-envelope pairing exists.
  if (verdicts.length !== raw.length) {
    return { verdicts, envelopes: verdicts.map(() => null) };
  }
  const envelopes = raw.map((r) => {
    const parsed = parseEnvelope(r);
    return parsed.ok ? parsed.envelope : null;
  });
  return { verdicts, envelopes };
}

/** Result of a hold-thread structural assessment (HOLD-WIPE fix). */
export interface HeldBatchAssessment {
  /** True iff the governing verdict is one the held-execute resume accepts. */
  readonly valid: boolean;
  readonly governing: EditGmGoverningVerdict;
}

/**
 * HOLD-WIPE fix (task_2e1b8c87) — pure STRUCTURAL re-assessment of a held
 * operations batch against a NEW graph (the graph a mutating edit/draft
 * commit is about to persist). Used by `threadHoldsThroughMutatingCommit`
 * (handlers/hold-thread-through.ts) to decide whether a live consent hold
 * can thread through the mutation (valid → re-pin + carry forward) or must
 * lapse honestly (invalid → notice + telemetry, never a silent wipe).
 *
 * Deliberate divergences from `evaluateEditGraphMutations`:
 *  - NO telemetry, NO copy, NO pending construction — this is an
 *    assessment, not a dispatch verdict. The confirm-time resume
 *    (gm-held-execute.ts) re-referees WITH telemetry before any apply.
 *  - `baseGraphHash` = `currentGraphHash` BY CONSTRUCTION: the question is
 *    "is this batch still structurally coherent against the new graph?",
 *    not "was it generated against it?" — the emit-time base is stale by
 *    premise (the graph just moved underneath the hold).
 *  - freshness is NEUTRALISED to 'none' (frame-trustworthy): analysis
 *    currency is a property of the ANALYSIS, not of the hold's structure,
 *    and the confirm-time re-referee re-checks it with the resume turn's
 *    REAL freshness verdict. Judging staleness here would lapse holds the
 *    user could still legitimately confirm after a re-run.
 *
 * `valid` mirrors `executeGmHeldResume`'s acceptance set exactly
 * (governing 'held' | 'proceed' executes; anything else declines), so a
 * threaded hold is one the resume path could actually accept. Fail-closed:
 * any exception assesses as invalid ('rejected').
 */
export function assessHeldBatchAgainstGraph(input: {
  readonly operations: readonly EditPatchOperationLike[];
  readonly currentGraph: unknown;
  readonly currentGraphHash: string;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
}): HeldBatchAssessment {
  try {
    const { verdicts } = refereeBatch({
      // mode/requestId are type-required by EditGmEvaluationInput but unused
      // by refereeBatch (no telemetry, no routing on this pure path).
      mode: 'shadow',
      operations: input.operations,
      currentGraph: input.currentGraph,
      currentGraphHash: input.currentGraphHash,
      baseGraphHash: input.currentGraphHash,
      freshness: 'none',
      scenarioId: input.scenarioId,
      turnId: input.turnId,
      requestId: input.requestId,
    });
    const governing = governingOf(verdicts);
    return {
      valid: governing === 'held' || governing === 'proceed',
      governing,
    };
  } catch {
    return { valid: false, governing: 'rejected' };
  }
}

function buildHeldPending(
  input: EditGmEvaluationInput,
  heldVerdict: RefereeVerdict,
  heldEnvelope: CandidateMutationEnvelope | null,
): { pending: PendingAction; chip: EditGmChip; targetKey: string } | null {
  // parsePendingAction requires a non-empty preconditions.graph_hash — a
  // held verdict without a readable frame cannot carry a safe pending.
  if (input.currentGraphHash === null) return null;
  const targetKey =
    heldEnvelope !== null
      ? mutationTargetKey(heldEnvelope)
      : `candidate:${heldVerdict.candidate_id ?? 'unknown'}`;
  const proposalRef = gmHeldProposalRef(input.scenarioId, targetKey);
  const nowIso = new Date().toISOString();
  // Lane 34 — embed the executable payload: the canonical validated
  // PatchOperation batch handleEditGraph produced (the WHOLE batch — a
  // confirm applies exactly what the edit pipeline validated and would
  // have applied). Oversize payloads degrade to the lane-8 decline
  // posture (no operations key) rather than risking the commit write.
  const operationsPayload = ((): {
    readonly apply_wiring: string;
    readonly operations?: readonly EditPatchOperationLike[];
    readonly operations_count?: number;
  } => {
    try {
      const serialised = JSON.stringify(input.operations);
      if (
        typeof serialised === 'string' &&
        serialised.length > 0 &&
        serialised.length <= GM_HELD_OPERATIONS_MAX_JSON_CHARS
      ) {
        return {
          apply_wiring: GM_HELD_APPLY_WIRING_EXECUTE,
          operations: input.operations,
          operations_count: input.operations.length,
        };
      }
    } catch {
      // Unserialisable operations → decline posture (fail-closed).
    }
    return { apply_wiring: GM_HELD_APPLY_WIRING_DECLINE };
  })();
  // CONSENT-CLARITY AMENDMENT — name the held change in the persisted
  // public copy so (a) the ask states exactly what a yes applies, (b) the
  // multi-consent disambiguation list renders distinct labels, and (c) a
  // chip click resolves via exact-match to THIS hold. Falls back to the
  // generic swept copy when no safe subject is derivable.
  const heldSubject = describeHeldOperationsSubject(input.operations, input.currentGraph);
  const heldPublicCopy = buildGmHeldPublicCopy(heldSubject);
  const pending: PendingAction = {
    id: randomUUID(),
    scenario_id: input.scenarioId,
    chip_id: proposalRef,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: proposalRef,
      inline_patch: {
        // NOT in the synthesis ALLOWED_HANDLER_IDS: through the GENERIC
        // synthesis path a "yes" resolves to 'invalid' → the deterministic
        // decline-with-clarify recovery. The DEDICATED held-execute branch
        // (TurnExecutor → handlers/gm-held-execute.ts) recognises this id
        // and — in live mode only — executes the embedded operations after
        // re-refereeing them (lane 34). Never a dangling pending a "yes"
        // silently drops; never an un-reviewed apply.
        handler_id: GM_HELD_HANDLER_ID,
        ...operationsPayload,
        candidate_id: heldVerdict.candidate_id,
        candidate_kind: heldVerdict.kind,
        mutation_class: heldVerdict.mutation_class,
        blocker_code: heldVerdict.blocker?.code ?? null,
        base_hash_match: heldVerdict.base_hash_match,
        params: {},
        target_entity_ids: [],
      },
      public_label: heldPublicCopy.label,
      public_message: heldPublicCopy.message,
    },
    preconditions: { graph_hash: input.currentGraphHash },
    // F-HELD fix 2a: GM-hold-specific turn budget (4), NOT the chip default
    // (2) — see the GM_HELD_PENDING_TURN_TTL doc above.
    expires_at_turn_count: GM_HELD_PENDING_TURN_TTL,
    expires_at_iso: new Date(
      Date.parse(nowIso) + PENDING_ACTION_DEFAULT_WALL_TTL_MS,
    ).toISOString(),
    emitted_at_iso: nowIso,
  };
  const chip: EditGmChip = {
    id: proposalRef,
    label: heldPublicCopy.label,
    message: heldPublicCopy.message,
  };
  return { pending, chip, targetKey };
}

/** The rerun affordance for the stale template (existing executable chip shape). */
const GM_STALE_RERUN_CHIP: EditGmChip = {
  id: 'chip_action_rerun_analysis_gm_stale',
  label: 'Re-run analysis',
  message: 'Rerun the analysis.',
  action_type: 'run_analysis',
};

// ---------------------------------------------------------------------------
// The gate.
// ---------------------------------------------------------------------------

/**
 * Evaluate the edit_graph mutation batch under the given mode. NEVER throws:
 * shadow degrades to log-only; live degrades to a block-with-clarify
 * decision (fail-closed — an erroring referee must not silently apply).
 */
export function evaluateEditGraphMutations(input: EditGmEvaluationInput): EditGmDecision {
  try {
    const { verdicts, envelopes } = refereeBatch(input);
    const governing = governingOf(verdicts);
    const verdictCounts = tally(verdicts);

    // T4.0 §5 no-silent-outcome: exactly one redacted event per verdict,
    // routed through the REGISTERED enum names (validate-event-names).
    for (let i = 0; i < verdicts.length; i += 1) {
      const v = verdicts[i]!;
      const base = mutationTelemetryEvent(v, {
        source: 'edit_graph_llm',
        scenario_id: input.scenarioId,
        turn_id: input.turnId,
      });
      emit(VERDICT_EVENT[v.verdict], {
        ...base,
        mode: input.mode,
        dispatch_path: input.dispatchPath ?? 'edit_graph',
        request_id: input.requestId,
        governing_candidate: governing !== 'proceed' && i === firstIndexOf(verdicts, governing),
      });
    }

    if (input.mode === 'shadow' || governing === 'proceed') {
      return { ...PROCEED_DECISION, governing, verdictCounts };
    }

    // ── live mode, blocked verdicts ──────────────────────────────────────
    const gi = firstIndexOf(verdicts, governing);
    const gv = verdicts[gi]!;
    const publicReason = publicReasonOf(gv);

    if (governing === 'held') {
      const held = buildHeldPending(input, gv, envelopes[gi] ?? null);
      if (held === null) {
        return {
          governing,
          blockApply: true,
          assistantText: GM_HELD_NO_PENDING_ASSISTANT_TEXT,
          suggestedActions: [],
          pendingActions: null,
          publicReason,
          verdictCounts,
        };
      }
      // R8: build the typed held_proposal block on the INITIAL hold only —
      // gm_held_resume re-referees on confirm and must not mint a second
      // block. Builder is fail-closed (unmappable code / class → null).
      const heldProposalBlock: HeldProposalBlock | null =
        (input.dispatchPath ?? 'edit_graph') === 'edit_graph'
          ? buildHeldProposalBlock({
              proposalId: held.chip.id,
              confirmActionId: held.chip.id,
              mutationClass: gv.mutation_class,
              blockerCode: gv.blocker?.code ?? null,
              targetKey: held.targetKey,
              graph: input.currentGraph as HeldProposalBlockInput['graph'],
            })
          : null;
      // ROADMAP 2.11 / P1-3 — needs-encoding disclosure on the consent ask
      // (null when every added option carries interventions: copy
      // byte-identical to the pre-2.11 hold).
      const needsEncodingNotice = buildNeedsEncodingAddNotice(
        input.operations,
        input.currentGraph,
      );
      const heldAsk = buildGmHeldAssistantText(
        describeHeldOperationsSubject(input.operations, input.currentGraph),
        input.operations.length,
      );
      return {
        governing,
        blockApply: true,
        // CONSENT-CLARITY AMENDMENT — the ask names the held change
        // (falls back to the generic swept copy when no safe subject).
        assistantText:
          needsEncodingNotice === null ? heldAsk : `${heldAsk} ${needsEncodingNotice}`,
        suggestedActions: [held.chip],
        pendingActions: [held.pending],
        publicReason,
        verdictCounts,
        heldProposalBlock,
      };
    }

    if (governing === 'stale') {
      return {
        governing,
        blockApply: true,
        assistantText: GM_STALE_ASSISTANT_TEXT,
        suggestedActions: [GM_STALE_RERUN_CHIP],
        pendingActions: null,
        publicReason,
        verdictCounts,
      };
    }

    if (governing === 'rejected') {
      return {
        governing,
        blockApply: true,
        assistantText: GM_REJECTED_ASSISTANT_TEXT,
        suggestedActions: [],
        pendingActions: null,
        publicReason,
        verdictCounts,
      };
    }

    // clarify_required
    return {
      governing,
      blockApply: true,
      assistantText: GM_CLARIFY_ASSISTANT_TEXT,
      suggestedActions: [],
      pendingActions: null,
      publicReason,
      verdictCounts,
    };
  } catch (err) {
    log.warn(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        mode: input.mode,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'Graph Management — edit referee gate threw; shadow degrades to log-only, live fails closed to held/clarify',
    );
    if (input.mode === 'shadow') {
      return PROCEED_DECISION;
    }
    // Live fail-closed (mission 2d): never crash the turn, never silently
    // apply past a broken referee — block with the clarify-style held copy.
    return {
      governing: 'held',
      blockApply: true,
      assistantText: GM_HELD_NO_PENDING_ASSISTANT_TEXT,
      suggestedActions: [],
      pendingActions: null,
      publicReason: {
        source: 'graph_management',
        verdict: 'held',
        mutation_class: null,
        blocker_code: 'CLASSIFY_FAILED',
        blocker_readable: 'Refereeing failed unexpectedly; held fail-closed.',
        candidate_id: null,
        base_hash_match: false,
      },
      verdictCounts: {},
    };
  }
}

function firstIndexOf(verdicts: readonly RefereeVerdict[], verdict: MutationVerdict | EditGmGoverningVerdict): number {
  return verdicts.findIndex((v) => v.verdict === verdict);
}
