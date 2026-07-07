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
 *    REAL pending confirmation (apply_proposed_change) whose resume is
 *    structurally decline-with-clarify: `inline_patch.handler_id` is NOT in
 *    the synthesis allowlist, so a "yes" resumes into the deterministic
 *    `commitProposedChangeRecovery('invalid')` clarify — never a silent
 *    drop, never an un-reviewed apply (executing held mutations on confirm
 *    is a named follow-up). stale → refresh/rerun recovery. rejected /
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
import { mutationTelemetryEvent } from '../graph-management/telemetry.js';
import type {
  CandidateMutationEnvelope,
  FrameFreshness,
  MutationFrame,
  MutationVerdict,
  RefereeVerdict,
} from '../graph-management/types.js';
import {
  PENDING_ACTION_DEFAULT_TURN_TTL,
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
}

export type EditGmGoverningVerdict =
  | 'proceed'
  | 'held'
  | 'stale'
  | 'rejected'
  | 'clarify_required';

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

function buildHeldPending(
  input: EditGmEvaluationInput,
  heldVerdict: RefereeVerdict,
  heldEnvelope: CandidateMutationEnvelope | null,
): { pending: PendingAction; chip: EditGmChip } | null {
  // parsePendingAction requires a non-empty preconditions.graph_hash — a
  // held verdict without a readable frame cannot carry a safe pending.
  if (input.currentGraphHash === null) return null;
  const targetKey =
    heldEnvelope !== null
      ? mutationTargetKey(heldEnvelope)
      : `candidate:${heldVerdict.candidate_id ?? 'unknown'}`;
  const proposalRef = gmHeldProposalRef(input.scenarioId, targetKey);
  const nowIso = new Date().toISOString();
  const pending: PendingAction = {
    id: randomUUID(),
    scenario_id: input.scenarioId,
    chip_id: proposalRef,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: proposalRef,
      inline_patch: {
        // NOT in the synthesis ALLOWED_HANDLER_IDS: a "yes" resume resolves
        // to decideProposedChangeSynthesis → 'invalid' → the deterministic
        // decline-with-clarify recovery. Never a dangling pending a "yes"
        // silently drops; never an un-reviewed apply.
        handler_id: 'graph_management_held_v1',
        apply_wiring: 'decline_with_clarify_v0',
        candidate_id: heldVerdict.candidate_id,
        candidate_kind: heldVerdict.kind,
        mutation_class: heldVerdict.mutation_class,
        blocker_code: heldVerdict.blocker?.code ?? null,
        base_hash_match: heldVerdict.base_hash_match,
        params: {},
        target_entity_ids: [],
      },
      public_label: GM_HELD_CHIP_LABEL,
      public_message: GM_HELD_CHIP_MESSAGE,
    },
    preconditions: { graph_hash: input.currentGraphHash },
    expires_at_turn_count: PENDING_ACTION_DEFAULT_TURN_TTL,
    expires_at_iso: new Date(
      Date.parse(nowIso) + PENDING_ACTION_DEFAULT_WALL_TTL_MS,
    ).toISOString(),
    emitted_at_iso: nowIso,
  };
  const chip: EditGmChip = {
    id: proposalRef,
    label: GM_HELD_CHIP_LABEL,
    message: GM_HELD_CHIP_MESSAGE,
  };
  return { pending, chip };
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
        dispatch_path: 'edit_graph',
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
      return {
        governing,
        blockApply: true,
        assistantText: GM_HELD_ASSISTANT_TEXT,
        suggestedActions: [held.chip],
        pendingActions: [held.pending],
        publicReason,
        verdictCounts,
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
