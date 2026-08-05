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
  canonicaliseValueOps,
  stampUserEditProvenance,
  batchFullyLanded,
} from '../../orchestrator/canonicalise-value-ops.js';
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
import { buildConfigureOptionChip } from '../configure-option-chip-text.js';
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
export function buildGmHeldAppliedReceipt(
  subjects: readonly string[],
  unconfiguredOptionLabels: readonly string[] = [],
): string {
  const named = subjects.map((s) => s.trim()).filter((s) => s.length > 0);
  const base =
    named.length === 0
      ? GM_HELD_APPLIED_ASSISTANT_TEXT
      : `${named.map((s) => `Confirmed: ${s}.`).join(' ')} ` +
        'Run the analysis again when you are ready to see how it plays out.';
  // ROADMAP 2.11 / P1-3 — needs-encoding disclosure. Live-proven lie
  // (diagnosis brief add-option-2.11.md §2 A3→A4): the receipt told the
  // user to run the analysis again while the just-applied option had no
  // effect values, so PLoT preflight 422-blocked the WHOLE analysis on the
  // very next turn. When the applied graph leaves options unconfigured,
  // the receipt must say so AT APPLY TIME and point at the real writer.
  const disclosure = buildUnconfiguredOptionsNotice(unconfiguredOptionLabels);
  return disclosure === null ? base : `${base} ${disclosure}`;
}

/**
 * Honest notice for options that still lack effect values. Null when every
 * option is configured (copy byte-identical to the pre-2.11 receipt). The
 * advised phrasing MUST carry the deterministic configure-option gate's own
 * vocabulary ("configure … option") so a user who echoes it routes to the
 * edit lane without the LLM router — pinned by
 * configure-option-copy-detector-contract.test.ts.
 *
 * ⚠⚠ ROADMAP 2.117 — PREDICTION-FREE BY DESIGN. This notice states the fact
 * and names the deterministic remedy. It must NOT forecast what the analysis
 * will do with the option, in EITHER direction. Two generations were
 * falsified live, in opposite directions:
 *
 *   gen 1  "…so the analysis cannot run until they are set."  → FALSE
 *          post-#747 (JOURNEY-PROOF step 3 captured it): the option is
 *          scaffolded and the run proceeds.
 *   gen 2  "…so Olumi will include it using provisional placeholder values."
 *          (#748) → FALSE on the next live re-capture: the value-free option
 *          collapsed onto the baseline and the engine removed it,
 *          `IDENTICAL_OPTIONS_DEDUPED`. It was never scored.
 *
 * The outcome is draft-dependent, and dedup fires DOWNSTREAM of the scaffold
 * — so even `will_scaffold_options: true` does not license an inclusion
 * promise. Disclosing what actually happened is the analysis result's job.
 *
 * Two further facts, kept because they cost real time to establish and would
 * otherwise be re-derived: labels here come from `deriveUnconfiguredOptionLabels`
 * (status !== 'ready') with no intent filter, and option STATUS is not a proxy
 * for scaffoldability — an edge-less option is stamped `needs_user_mapping`
 * yet IS scaffolded via the sibling comparison basis. So this copy must not be
 * split on status either.
 */
export function buildUnconfiguredOptionsNotice(
  unconfiguredOptionLabels: readonly string[],
): string | null {
  const labels = unconfiguredOptionLabels.map((l) => l.trim()).filter((l) => l.length > 0);
  if (labels.length === 0) return null;
  const first = `'${labels[0]}'`;
  const named =
    labels.length === 1
      ? first
      : `${first} and ${labels.length - 1} more option${labels.length - 1 === 1 ? '' : 's'}`;
  return (
    `Note: ${named} ${labels.length === 1 ? 'does' : 'do'} not have effect values yet. ` +
    `Say 'configure the ${labels[0]} option' and tell me what ` +
    `${labels.length === 1 ? 'it' : 'each one'} changes, and I'll write in the real numbers.`
  );
}

/**
 * Structural view of one option row from the readiness payload
 * (`computeStructuralReadiness` → `AnalysisReadyPayload['options']`). The
 * real payload carries `option_id` alongside `label`/`status`; the shape is
 * declared here (rather than `{label, status}` only) so callers passing the
 * genuine payload — including test fixtures shaped like it — satisfy the
 * type without excess-property errors. `option_id` is deliberately unread:
 * ids must never leak into user copy.
 */
export interface GmReadinessOption {
  readonly option_id?: string;
  readonly label?: string;
  readonly status?: string;
}

/**
 * ROADMAP 2.11 / P1-3 — option labels that block analysis, derived from the
 * SAME readiness computation the commit path already runs
 * (`computeStructuralReadiness`): any option not `ready` (needs_encoding /
 * needs_user_mapping) fails PLoT's per-option intervention preflight.
 * Labels are graph labels (render-safe at source); id-shaped or empty
 * labels are dropped rather than leaked.
 */
export function deriveUnconfiguredOptionLabels(
  readiness:
    | {
        /** Top-level readiness status; unread here but part of the real payload. */
        readonly status?: string;
        readonly options: ReadonlyArray<GmReadinessOption>;
      }
    | undefined,
): string[] {
  if (!readiness) return [];
  return readiness.options
    .filter((o) => o.status !== 'ready')
    .map((o) => (typeof o.label === 'string' ? o.label.trim() : ''))
    .filter((l) => l.length > 0 && !/^(?:opt|fac|out|risk|goal|dec)_[a-z0-9_]+$/i.test(l));
}

/** Rerun affordance offered when the post-apply graph is analysis-ready. */
export const GM_HELD_APPLIED_RERUN_CHIP = Object.freeze({
  id: 'chip_action_rerun_analysis_gm_held_applied',
  label: 'Re-run analysis',
  message: 'Rerun the analysis.',
  action_type: 'run_analysis' as const,
});

/**
 * ROADMAP 2.11 / P1-3 — chips for the applied receipt: rerun when ready;
 * the SHARED configure chip (same builder + deterministic route as the
 * options_not_configured recovery) when options still need effects. The
 * old behaviour offered NOTHING on a non-ready apply, stranding the user.
 */
export function buildGmHeldAppliedChips(
  readiness:
    | {
        readonly status?: string;
        readonly options: ReadonlyArray<GmReadinessOption>;
      }
    | undefined,
): Array<{ id: string; label: string; message: string; action_type?: 'run_analysis' }> {
  if (readiness?.status === 'ready') return [{ ...GM_HELD_APPLIED_RERUN_CHIP }];
  const unconfigured = deriveUnconfiguredOptionLabels(readiness);
  if (unconfigured.length > 0) return [buildConfigureOptionChip(unconfigured[0]!)];
  return [];
}

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
      /**
       * `incomplete_apply` (P1b): the batch applied without throwing, but at
       * least one confirmed op did NOT land on the canonical persisted graph
       * (a value write in a canonicalisation-stripped field spelling). The
       * batch is refused WHOLE rather than persisting a partial under a
       * "Confirmed" receipt.
       */
      readonly reason: 'apply_error' | 'fact_unavailable' | 'incomplete_apply';
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

// ---------------------------------------------------------------------------
// P1b atomicity guard (real-user run 2026-07-17, scenario c510030e).
//
// The guard itself now lives in `../../orchestrator/canonicalise-value-ops.js`
// as `batchFullyLanded`, alongside the canonicaliser it backstops — B5
// reproduced the SAME strip on the normal edit path, and two copies of this
// check is precisely the hand-maintained-twin defect this codebase keeps
// paying for. Called here WITHOUT the optional `preEdit` argument, which is
// the strict #509 semantics byte-for-byte: every field the applier wrote must
// survive canonicalisation on the persisted entity, or the WHOLE confirmed
// batch is refused.
// ---------------------------------------------------------------------------

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

  // ── 2b. Canonicalise value-op field spellings (R1 residual) ────────────
  // The confirm re-applies LOCALLY (no PLoT round-trip), so a tunable value op
  // in the edit pipeline's non-canonical field spelling (`{ data: { value } }`,
  // slash-keyed `data/value`, dotted `observed_state.value`) is Object.assign-
  // written verbatim and then STRIPPED by the GraphV3 re-parse — the value
  // silently no-ops while structural siblings land, which #509 refuses WHOLE.
  // Translating those spellings to the one GraphV3 preserves (a merge onto
  // observed_state) makes the value actually apply. Runs AFTER the re-referee
  // (verdict + telemetry byte-identical) and BEFORE the apply. The atomicity
  // guard below still backstops any op left untranslated.
  //
  // UNCONDITIONAL since 2026-07-25 (was `CEE_GM_HELD_VALUE_CANONICALISATION`,
  // default OFF). This lane's POSTCONDITION (`batchFullyLanded`, below) has
  // always been ungated, so the gate left the held lane running the refusal
  // WITHOUT the repair — it declined confirmed batches it could have applied.
  // Replayed over all 43 real held batches (`pending_actions` where
  // `handler_id = graph_management_held_v1`): rewriter OFF = 21 land / 2
  // refuse; rewriter ON = 23 land / 0 refuse; batches that flipped from
  // landing to refusing = ZERO. One of the two repairs is a real user who
  // confirmed "Yes, go ahead" on 2026-07-18, was declined, retried five times,
  // and whose factor value is unchanged in the database to this day.
  //
  // Rollback is a code revert, not an env flip (no dark launches).
  //
  // 2.396(b): a held batch the user explicitly CONFIRMED is the strongest
  // consent signal in the product — its value writes earn the USER stamp
  // (observed_state.source + node provenance) exactly like the normal seam.
  // Same single stamp function; see canonicalise-value-ops.ts.
  const opsToApply: PatchOperation[] = stampUserEditProvenance(
    canonicaliseValueOps(operations, input.currentGraph).operations,
  );

  // ── 3. Apply through the existing apply path ──────────────────────────
  let mutatedGraph: PersistedGraphV3T;
  // P1b — the applier's RAW candidate (before the GraphV3 re-parse strips
  // undeclared field spellings). Captured so the atomicity guard below can
  // tell an op that landed from one whose write canonicalisation dropped.
  let rawAppliedGraph: GraphV3T | null = null;
  try {
    const applied = applyAndValidateMutation(input.currentGraph, (clone) => {
      const candidate = applyPatchOperations(clone, opsToApply);
      rawAppliedGraph = candidate;
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

  // ── 3b. Atomicity + honesty guard (P1b) ───────────────────────────────
  // Every confirmed op must have landed on the CANONICAL persisted graph.
  // A tunable value op whose field spelling GraphV3 strips applied without
  // throwing yet left the value unchanged — refuse the WHOLE batch rather
  // than persist a partial the "Confirmed" receipt would misrepresent.
  // The guard checks the ops as APPLIED (canonicalised, if the flag translated
  // any) — its per-op field survival must be measured against the spelling that
  // actually went onto the node, not the pre-canonicalisation one.
  if (
    rawAppliedGraph === null ||
    !batchFullyLanded(opsToApply, rawAppliedGraph, appliedGraph)
  ) {
    log.warn(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        operations_count: operations.length,
      },
      'GM held-execute — a confirmed op did not survive canonicalisation onto the persisted graph; refusing the WHOLE batch (no partial apply)',
    );
    return { status: 'apply_failed', reason: 'incomplete_apply' };
  }

  // ── 4. Receipt fact (rich → generic → refuse) ─────────────────────────
  // Built from the ops as APPLIED (`opsToApply`): the receipt describes what
  // actually landed on the graph. Flag-off, `opsToApply === operations`, so
  // this is byte-identical to #509.
  const editResultForFact = {
    blocks: [],
    assistantText: null,
    latencyMs: 0,
    appliedGraph,
    wasRejected: false,
    operations: opsToApply,
  } as EditGraphResult;
  try {
    editResultForFact.appliedChanges = buildAppliedChanges(
      opsToApply,
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
