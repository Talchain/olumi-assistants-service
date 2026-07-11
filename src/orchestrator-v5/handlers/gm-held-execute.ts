/**
 * Lane 34 — GM held-execute resume (propose → hold → confirm → apply).
 *
 * The confirm-side counterpart of the lane-8 held pending: when the user
 * confirms a `graph_management_held_v1` pending ("yes" / the confirm chip)
 * and CEE_GRAPH_MANAGEMENT_MODE is 'live' AT RESUME TIME, this module:
 *
 *   1. validates the embedded `inline_patch.operations` against the edit
 *      pipeline's own `PatchOperationsArraySchema` (the pending round-trips
 *      persisted JSONB — never trusted raw);
 *   2. re-referees the batch through the SAME gate that held it
 *      (`evaluateEditGraphMutations`, mode 'live', redacted telemetry with
 *      `dispatch_path: 'gm_held_resume'`). The confirm lifts ONLY the hold:
 *      governing `held` / `proceed` executes; `rejected` / `stale` /
 *      `clarify_required` declines — a "yes" can never override an
 *      integrity rejection;
 *   3. applies the batch through the EXISTING apply path —
 *      `applyPatchOperations` (the edit pipeline's applier) inside
 *      `applyAndValidateMutation` (GraphV3-validated clone, post-mutation
 *      re-parse, structural fields merged back onto the full persisted
 *      shape — no rich-field loss);
 *   4. builds the edit receipt fact (rich builder via `buildAppliedChanges`,
 *      generic fallback). If BOTH builders fail, the caller must NOT commit
 *      the graph (DL-7: never a receipt-less mutation) — this module then
 *      returns a decline.
 *
 * The module NEVER writes state: the TurnExecutor branch commits the
 * returned graph + fact through the single durable writer
 * (`commitTurn` → `commitDirectAnswer`). Fail-closed throughout: any
 * validation/apply/fact failure resolves to a decline decision, never a
 * partial apply, never a crash.
 *
 * Caller contract (turn-executor): the hash precondition
 * (`preconditions.graph_hash` vs a like-for-like recompute over the same
 * graph authority the hold hashed) is checked by the CALLER before
 * `executeGmHeldResume`, so 'superseded' recovery copy stays owned by the
 * existing proposed-change lifecycle.
 *
 * All user-facing wording in this file: provisional_doctrine_v0.
 */

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { applyPatchOperations } from '../../orchestrator/patch-applier.js';
import {
  PatchOperationsArraySchema,
  type ValidatedPatchOperation,
} from '../../orchestrator/patch-validation.js';
import type { PatchOperation } from '../../orchestrator/types.js';
import { buildAppliedChanges } from '../../orchestrator/tools/edit-graph.js';
import type { EditGraphResult } from '../../orchestrator/tools/edit-graph.js';
import {
  applyAndValidateMutation,
  type PersistedGraphV3T,
} from '../tools/handlers/d1-shared/apply-graph-mutation.js';
import {
  buildEditGraphHandlerFact,
  buildGenericEditGraphHandlerFact,
} from './edit-graph-fact-builder.js';
import {
  evaluateEditGraphMutations,
  GM_HELD_HANDLER_ID,
  type EditGmGoverningVerdict,
} from './edit-graph-referee-gate.js';
import type { FrameFreshness } from '../graph-management/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { log } from '../../utils/telemetry.js';

// ---------------------------------------------------------------------------
// Copy (provisional_doctrine_v0) — swept by gm-held-execute.test.ts.
// ---------------------------------------------------------------------------

/**
 * Honest applied receipt for a confirmed hold — the GENERIC fallback.
 * Ships ONLY after the commit succeeds (the caller composes-then-commits
 * atomically; a commit throw surfaces STATE_COMMIT_FAILED instead). No em
 * dash; no internal tokens.
 *
 * CONSENT-CLARITY AMENDMENT (Paul, 2026-07-11): the primary receipt is
 * {@link buildGmHeldAppliedReceipt}, which NAMES what was confirmed. This
 * constant remains only for the no-derivable-subject fallback.
 */
export const GM_HELD_APPLIED_ASSISTANT_TEXT =
  'Done. I have applied the change you confirmed. Run the analysis again ' +
  'when you are ready to see how it plays out.';

/**
 * CONSENT-CLARITY AMENDMENT — named applied receipt. Doctrine (a): the
 * receipt names EXACTLY what was confirmed ("Confirmed: update
 * 'Marketing'."), never a bare "Done". One sentence per applied subject
 * (an "all of them" resume can confirm several holds in one commit),
 * then the rerun guidance. Empty input (no safe subject derivable) falls
 * back to the generic swept copy — never blank text.
 */
export function buildGmHeldAppliedReceipt(subjects: readonly string[]): string {
  const named = subjects.map((s) => s.trim()).filter((s) => s.length > 0);
  if (named.length === 0) return GM_HELD_APPLIED_ASSISTANT_TEXT;
  const confirmations = named.map((s) => `Confirmed: ${s}.`).join(' ');
  return `${confirmations} Run the analysis again when you are ready to see how it plays out.`;
}

/** Rerun affordance offered when the post-apply graph is analysis-ready. */
export const GM_HELD_APPLIED_RERUN_CHIP = Object.freeze({
  id: 'chip_action_rerun_analysis_gm_held_applied',
  label: 'Re-run analysis',
  message: 'Rerun the analysis.',
  action_type: 'run_analysis' as const,
});

// ---------------------------------------------------------------------------
// Pending recognition + payload extraction.
// ---------------------------------------------------------------------------

export type GmHeldResumeRead =
  | { readonly kind: 'not_gm_held' }
  /** GM held pending recognised, but no executable payload (legacy lane-8
   *  pendings, oversize-degraded holds, or a malformed round-trip). */
  | { readonly kind: 'no_payload' }
  | { readonly kind: 'ok'; readonly operations: readonly ValidatedPatchOperation[] };

/**
 * Recognise a GM held pending and extract its executable payload.
 * Total — never throws on hostile persisted shapes.
 */
export function readGmHeldResume(pending: PendingAction): GmHeldResumeRead {
  if (pending.action.kind !== 'apply_proposed_change') return { kind: 'not_gm_held' };
  const ip = pending.action.inline_patch;
  if (ip === null || typeof ip !== 'object' || Array.isArray(ip)) {
    return { kind: 'not_gm_held' };
  }
  const patch = ip as Record<string, unknown>;
  if (patch.handler_id !== GM_HELD_HANDLER_ID) return { kind: 'not_gm_held' };
  const parsed = PatchOperationsArraySchema.safeParse(patch.operations);
  if (!parsed.success) return { kind: 'no_payload' };
  return { kind: 'ok', operations: parsed.data };
}

// ---------------------------------------------------------------------------
// Execution.
// ---------------------------------------------------------------------------

export interface GmHeldExecuteInput {
  readonly operations: readonly ValidatedPatchOperation[];
  /** The CURRENT graph (persisted authority; hash-verified by the caller). */
  readonly currentGraph: unknown;
  /** Like-for-like hash of `currentGraph` (already matched the pin). */
  readonly currentGraphHash: string;
  /** This turn's analysis-freshness verdict, narrowed to the frame enum. */
  readonly freshness: FrameFreshness;
  /** Whether a successful run_analysis fact exists (rerun_recommended input). */
  readonly hasExistingAnalysis: boolean;
  readonly scenarioId: string;
  readonly turnId: string;
  readonly requestId: string;
}

export type GmHeldExecuteOutcome =
  | {
      /** Re-referee blocked the batch — a "yes" never overrides integrity. */
      readonly status: 'referee_blocked';
      readonly governing: EditGmGoverningVerdict;
    }
  | {
      /** Apply/validate/fact construction failed — nothing to persist. */
      readonly status: 'apply_failed';
      readonly reason: 'apply_error' | 'fact_unavailable';
    }
  | {
      readonly status: 'executed';
      /** Full persisted-shape graph for the commit write (rich fields kept). */
      readonly mutatedGraph: PersistedGraphV3T;
      /** GraphV3 view of the mutated graph (readiness, labels, hashing). */
      readonly appliedGraph: GraphV3T;
      /** The edit receipt fact (DL-7: commits alongside the graph). */
      readonly fact: NonNullable<ReturnType<typeof buildGenericEditGraphHandlerFact>>;
    };

/**
 * Re-referee + apply + receipt for a confirmed hold. Pure with respect to
 * storage; never throws.
 */
export function executeGmHeldResume(input: GmHeldExecuteInput): GmHeldExecuteOutcome {
  // ValidatedPatchOperation (Zod output) is structurally assignable to the
  // pipeline's PatchOperation — a plain widening copy, no unsafe cast.
  const operations: PatchOperation[] = [...input.operations];

  // ── 2. Re-referee (defence-in-depth; redacted telemetry re-emitted) ──
  const decision = evaluateEditGraphMutations({
    mode: 'live',
    operations,
    currentGraph: input.currentGraph,
    currentGraphHash: input.currentGraphHash,
    // The caller verified the pin === the current hash, so the batch is
    // judged against the SAME base it was held on (base_hash_match=true).
    baseGraphHash: input.currentGraphHash,
    freshness: input.freshness,
    scenarioId: input.scenarioId,
    turnId: input.turnId,
    requestId: input.requestId,
    dispatchPath: 'gm_held_resume',
  });
  if (decision.governing !== 'held' && decision.governing !== 'proceed') {
    return { status: 'referee_blocked', governing: decision.governing };
  }

  // ── 3. Apply through the existing apply path ──────────────────────────
  let mutatedGraph: PersistedGraphV3T;
  try {
    const applied = applyAndValidateMutation(input.currentGraph, (clone) => {
      const candidate = applyPatchOperations(clone, operations);
      clone.nodes = candidate.nodes;
      clone.edges = candidate.edges;
      return { before: null, after: null };
    });
    mutatedGraph = applied.mutatedGraph;
  } catch (err) {
    log.warn(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
      },
      'GM held-execute — confirmed batch failed to apply/validate; declining (nothing persisted)',
    );
    return { status: 'apply_failed', reason: 'apply_error' };
  }

  // GraphV3 views for the receipt + downstream honesty plumbing. Both
  // parses succeed by construction (applyAndValidateMutation validated the
  // ingress AND the post-mutation graph); fail closed regardless.
  const appliedParse = GraphV3.safeParse(mutatedGraph);
  const preParse = GraphV3.safeParse(input.currentGraph);
  if (!appliedParse.success) {
    return { status: 'apply_failed', reason: 'apply_error' };
  }
  const appliedGraph = appliedParse.data;
  const preEditGraph = preParse.success ? preParse.data : null;

  // ── 4. Receipt fact (rich → generic → refuse) ─────────────────────────
  const editResultForFact = {
    blocks: [],
    assistantText: null,
    latencyMs: 0,
    appliedGraph,
    wasRejected: false,
    operations,
  } as EditGraphResult;
  try {
    editResultForFact.appliedChanges = buildAppliedChanges(
      operations,
      appliedGraph,
      input.hasExistingAnalysis,
      preEditGraph,
    );
  } catch {
    // Rich receipt input unavailable — the generic fallback still applies.
  }
  const factInput = {
    editResult: editResultForFact,
    preEditGraph,
    hasExistingAnalysis: input.hasExistingAnalysis,
  };
  let fact: ReturnType<typeof buildGenericEditGraphHandlerFact> = null;
  try {
    fact = buildEditGraphHandlerFact(factInput);
  } catch {
    fact = null;
  }
  if (fact === null) {
    try {
      fact = buildGenericEditGraphHandlerFact(factInput);
    } catch {
      fact = null;
    }
  }
  if (fact === null) {
    // DL-7: an applied mutation MUST carry a receipt; without one we
    // refuse to execute rather than persist a downstream-invisible edit.
    log.error(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        operations_count: operations.length,
      },
      'GM held-execute — BOTH fact builders failed; refusing receipt-less mutation (declined)',
    );
    return { status: 'apply_failed', reason: 'fact_unavailable' };
  }

  return { status: 'executed', mutatedGraph, appliedGraph, fact };
}
