/**
 * V6 dual-model draft enrichment — orchestrator entry point.
 *
 * enrichDraftGraph is the single seam called from draft-graph-dispatch behind
 * the default-OFF CEE_V6_DUAL_DRAFT_ENABLED flag. Contract: it NEVER throws
 * and it NEVER downgrades analysis-readiness — every failure path returns the
 * M1 graph unchanged with a recorded reason (fail-open to M1, bake-off arm-C
 * degrade semantics: recorded, never silent).
 *
 * Stage order (each step's failure short-circuits to M1):
 *   1. ingress GraphV3 re-assertion (defence in depth);
 *   2. M2 review — fail-closed prompt sentinel (G17), headroom gate (G2),
 *      hard timeout, structured outputs (m2-review.ts);
 *   3. deterministic merge — per-proposal validation against the REAL
 *      NodeV3/EdgeV3 schemas + G5/G10/G11/G14 guards, exact-one-bucket
 *      accounting (merge.ts);
 *   4. post-merge safety net — full GraphV3 re-validation, option-surface
 *      invariance (G12i), structural-readiness no-downgrade (G12ii). Any trip
 *      discards ALL merges.
 *
 * Standing activation ruling (amendment #2): the structural guards here are
 * necessary but NOT sufficient. The flag must not be enabled beyond local/dev
 * until a merged graph has proven immediate run_analysis SUCCESS (single
 * persist, coherent freshness, success returned); on failure the system
 * degrades to M1-only. Coaching improves only indirectly via the better
 * graph — defer artifacts stay in telemetry until the harness/coaching lane
 * authorises surfacing (amendment #3).
 */
import { GraphV3 } from '../../schemas/cee-v3.js';
import type { EnrichmentInput, EnrichmentOutcome, EnrichmentReason } from './types.js';
import { reviewDraftGraph } from './m2-review.js';
import { mergeProposals } from './merge.js';
import { optionSurfaceUnchanged, checkReadinessNoDowngrade } from './guards.js';
import { emitM2Outcome, emitMergeReport, emitDegraded } from './telemetry.js';

export type { EnrichmentInput, EnrichmentOutcome, EnrichmentReason } from './types.js';

/**
 * Whether the M2 review actually made an LLM call for a given outcome reason.
 *
 * Drives `llm_calls_used` accounting in the dispatch: an M2 call (and its
 * token cost) happens whenever the review reached `adapter.chat` — which is
 * true even when the call timed out, errored, returned unparseable output, or
 * merged nothing. It is FALSE only for the reasons that short-circuit before
 * the call (prompt sentinel, headroom gate, model-resolution gate, invalid
 * ingress) and the never-fire backstop. Exhaustive over EnrichmentReason so a
 * new reason forces an explicit classification here rather than silently
 * mis-counting. Co-located with the reason taxonomy (not gated on whether a
 * merge landed) so the two cannot drift.
 */
export function m2LlmCallMade(reason: EnrichmentReason): boolean {
  switch (reason) {
    // Short-circuited before adapter.chat — no M2 call, no cost. `internal_error`
    // is the never-fire backstop: conservatively "no call" (a throw is plausible
    // only on the pre-call paths such as safeParse, and the honest-minimum
    // convention prefers under- to over-counting on a should-never-fire path).
    case 'not_implemented':
    case 'invalid_ingress_graph':
    case 'prompt_not_provisioned':
    case 'insufficient_headroom':
    case 'm2_model_not_resolved':
    case 'internal_error':
      return false;
    // adapter.chat was invoked — a call (and tokens) were spent regardless of
    // whether the response merged, timed out, errored, or failed to parse.
    case 'applied':
    case 'no_proposals_applied':
    case 'm2_timeout':
    case 'm2_llm_error':
    case 'm2_parse_failed':
    case 'post_merge_invalid':
    case 'option_surface_changed':
    case 'readiness_downgrade':
      return true;
    default: {
      const _exhaustive: never = reason;
      return _exhaustive;
    }
  }
}

const M2_DEGRADE_REASON = {
  prompt_not_provisioned: 'prompt_not_provisioned',
  insufficient_headroom: 'insufficient_headroom',
  timeout: 'm2_timeout',
  llm_error: 'm2_llm_error',
  // First-class, activation-critical reason (accepted additive contract
  // extension #2): distinct from m2_llm_error so config/failover conditions
  // do not read as adapter instability on the activation dashboards. The
  // precise sub-cause also rides on the m2_outcome + degraded `detail` field.
  model_not_resolved: 'm2_model_not_resolved',
  parse_failed: 'm2_parse_failed',
} as const satisfies Record<string, EnrichmentReason>;

export async function enrichDraftGraph(input: EnrichmentInput): Promise<EnrichmentOutcome> {
  const degrade = (reason: EnrichmentReason, detail?: string): EnrichmentOutcome => {
    emitDegraded(input, reason, detail);
    return { enriched: false, reason, graph: input.graph };
  };

  try {
    // 1. Ingress guard — re-assert the M1 graph is GraphV3-valid before any
    // merge logic clones it. Invalid → skip, never touch the graph, never
    // call the LLM. VALIDATION ONLY: the merge below operates on the RAW
    // input graph, not parsed.data — NodeV3/EdgeV3 are strip-mode schemas and
    // Zod rebuilds key order, so merging on the reparsed copy would (a) make
    // the option-surface byte-compare trip on canonicalisation differences
    // alone, silently neutralising every applied merge, and (b) commit a
    // field-stripped graph only on enriched turns (the repo's known
    // schema-skew hazard). Pinned by the raw-graph fidelity test.
    if (!GraphV3.safeParse(input.graph).success) {
      return degrade('invalid_ingress_graph');
    }

    // 2. M2 review (sentinel / headroom / timeout all resolve to typed
    // non-ok outcomes — reviewDraftGraph never throws by contract).
    const m2 = await reviewDraftGraph(input);
    emitM2Outcome(input, m2);
    if (m2.kind !== 'ok') {
      // Carry the most specific coded sub-cause as the degraded event `detail`.
      // For model_not_resolved this is the coded resolution cause (model_unset
      // / provider_unsupported / model_mismatch) so activation dashboards can
      // group by operator-actionable condition rather than collapsing all
      // three to one value; for other non-ok kinds it is the kind itself.
      const detail = m2.kind === 'model_not_resolved' ? m2.cause : m2.kind;
      return degrade(M2_DEGRADE_REASON[m2.kind], detail);
    }

    // 3. Deterministic merge — every proposal in exactly one bucket. Operates
    // on the RAW graph (see ingress note above); proposal payloads are still
    // validated against the real NodeV3/EdgeV3 schemas inside the merge.
    const outcome = mergeProposals(input.graph, m2.proposals);
    emitMergeReport(input, outcome.report);

    // 4. Post-merge safety net. Any trip discards ALL merges (stricter than
    // the bake-off, which records and returns — live must fail open to M1).
    if (!outcome.report.post_merge_valid) {
      return degrade('post_merge_invalid');
    }
    if (!optionSurfaceUnchanged(input.graph, outcome.merged)) {
      return degrade('option_surface_changed');
    }
    const readiness = checkReadinessNoDowngrade(input.graph, outcome.merged);
    if (!readiness.ok) {
      return degrade('readiness_downgrade');
    }

    if (outcome.report.applied === 0) {
      // Valid M2 pass with nothing merged (empty set, all rejected, or all
      // deferred). Honest degrade: the turn ships the M1 draft; artifacts are
      // visible in the merge_report telemetry.
      return degrade('no_proposals_applied');
    }

    return { enriched: true, reason: 'applied', graph: outcome.merged };
  } catch {
    // Belt-and-braces: the stage is contracted never to throw; if a bug does,
    // the draft turn must survive it untouched.
    return degrade('internal_error');
  }
}
