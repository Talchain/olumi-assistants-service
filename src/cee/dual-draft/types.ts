/**
 * V6 dual-model draft-enrichment — shared types.
 *
 * The dual-draft stage sits between the M1 producer (today: the V4 unified
 * pipeline via handleDraftGraph) and the atomic turn commit. It takes any
 * valid GraphV3 draft and either returns an enriched GraphV3 or the untouched
 * M1 graph with a recorded reason — it never throws and never downgrades
 * analysis-readiness. See
 * ~/.claude/plans/lane-v6-dual-model-graph-generation-cheeky-pizza.md.
 *
 * Phase 0/1 scope: the input/outcome contract + a no-op enricher. The M2
 * review types (M2Outcome), the deterministic-merge types (MergeReport,
 * MergeFailure, DeferArtifact) and the ProposalEnvelope land alongside this
 * file in later phases behind the same default-OFF flag.
 *
 * Dependency discipline: this module imports only the GraphV3 contract from
 * src/schemas. It must not import from src/orchestrator-v5 — that would invert
 * the cee → orchestrator layering and risk a circular import.
 */
import type { GraphV3T } from '../../schemas/cee-v3.js';

/**
 * Input to the enrichment stage. Built in draft-graph-dispatch from the M1
 * DraftGraphResult. A future V6-native M1 must satisfy the same contract: a
 * GraphV3-valid post-repair graph plus the brief.
 */
export interface EnrichmentInput {
  /** Post-repair, GraphV3.safeParse-valid draft. Re-asserted at ingress. */
  readonly graph: GraphV3T;
  /** The user's decision brief (payload.message). */
  readonly brief: string;
  /**
   * The M1 pipeline's rich analysis-ready payload. CURRENTLY UNREAD inside
   * the dual-draft stage: the no-downgrade guard deliberately recomputes
   * structural readiness for BOTH sides via computeStructuralReadiness so the
   * comparison is apples-to-apples (the rich pipeline payload is derived
   * differently and would skew the rank compare). Kept on the contract as
   * M2-context/reserved input; typed `unknown` to keep this module decoupled
   * from orchestrator-v5's AnalysisReadyPayload (avoids an upward import).
   */
  readonly analysisReady: unknown;
  readonly requestId: string;
  readonly scenarioId: string;
  readonly turnId: string;
  /** Pipeline elapsed ms (draftResult.latencyMs) — feeds the Phase-2 headroom gate. */
  readonly pipelineElapsedMs: number;
}

/**
 * Outcome reason.
 *
 * CONTRACT NOTE (freeze ruling): this union is the one part of the frozen
 * Phase 0/1 contract the M2/merge phases were pre-declared to extend (see the
 * original Phase 0/1 comment and plan §7/§8). All extensions are purely
 * ADDITIVE — no member removed, no field or semantic change to
 * EnrichmentInput/EnrichmentOutcome. The freeze functions as a change-log
 * gate, not an absolute prohibition; any further contract change must still be
 * stopped-and-reported before editing.
 *
 * CHANGE LOG (accepted additive extensions in this lane):
 *   1. Phase 2/3 — added the degrade/outcome reasons below (M2 + merge).
 *   2. Code-review follow-up (Paul-approved) — added the first-class
 *      'm2_model_not_resolved' member: model resolution is activation-critical
 *      and must not be hidden under 'm2_llm_error' (which reads as adapter/LLM
 *      instability on the activation dashboards).
 */
export type EnrichmentReason =
  // Phase 0/1 members (unchanged)
  | 'not_implemented' // retained for compatibility; unused once the M2 path landed
  | 'invalid_ingress_graph' // ingress GraphV3 re-assertion failed → M1 untouched
  // Success
  | 'applied' // ≥1 proposal merged; graph is the merged GraphV3
  // M2 review degrade reasons (Phase 2)
  | 'prompt_not_provisioned' // fail-closed sentinel prompt slot (G17)
  | 'insufficient_headroom' // pipeline consumed too much of the draft budget (G2)
  | 'm2_model_not_resolved' // CEE_MODEL_M2_REVIEW unset / blocked / failover / non-Anthropic → stage inert
  | 'm2_timeout' // M2 call hit the hard timeout
  | 'm2_llm_error' // M2 call failed (non-timeout)
  | 'm2_parse_failed' // M2 output was not a {proposals: [...]} object
  // Merge/guard degrade reasons (Phase 3)
  | 'no_proposals_applied' // valid M2 pass, but nothing merged (all rejected/deferred/empty)
  | 'post_merge_invalid' // merged graph failed GraphV3 re-validation → all merges discarded
  | 'option_surface_changed' // G12(i) invariant tripped → all merges discarded
  | 'readiness_downgrade' // G12(ii) structural readiness got worse → all merges discarded
  // Backstop
  | 'internal_error'; // unexpected throw inside the stage → M1 untouched

/**
 * Result of the enrichment stage. `enriched === false` means the caller must
 * keep the M1 graph exactly as produced (the byte-identity guarantee). When
 * `enriched === true`, `graph` is the merged GraphV3 to commit in place of M1.
 */
export interface EnrichmentOutcome {
  readonly enriched: boolean;
  readonly reason: EnrichmentReason;
  /** Final graph: the merged graph when enriched, else the untouched M1 graph. */
  readonly graph: GraphV3T;
}
