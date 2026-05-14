/**
 * Heuristic threshold for `plot_slow_likely` (Fix 4).
 *
 * Hot PLoT calls on the Render staging deploy complete in ~3-6 s; slow
 * calls (cold-start rehydration, large graphs, queueing) often run
 * 12-20 s. The 8 s line is a conservative midpoint that distinguishes
 * "fast hot path" from "anything else"; it is NOT a definitive cold-
 * start diagnosis (hence the field rename from `plot_cold_likely`).
 * False positives are harmless — the field is `boolean | null` so
 * consumers know when it has been computed, and is paired with the
 * raw `plot_request_ms` for downstream dashboards to apply their own
 * thresholds.
 *
 * Lives in this shared module so both the run_analysis handler (success
 * path) and the turn-executor (error-path reconstruction from
 * `HandlerInvocationFailedError.details`) apply the same threshold
 * without the executor having to import from the handler — the
 * registry-isolation pre-push hook forbids that direction.
 */
export const PLOT_SLOW_LIKELY_MS = 8000;

/**
 * V5 latency observability — shared timing types (Fix 4).
 *
 * Surface contract:
 *   - Both the response-envelope `_timings` block AND the telemetry
 *     events (v5.turn_executor.stage_timings,
 *     cee.unified_pipeline.stage_timings, v5.run_analysis.timings) are
 *     gated on `config.cee.timingDebugEnabled`. Production default OFF
 *     ⇒ zero `Date.now()` calls, zero allocations, zero log events,
 *     unchanged response shape. Staging sets `V5_TIMING_DEBUG=true` so
 *     the replay harness can read per-stage durations without scraping
 *     server logs.
 *   - The route-v2 egress wrapper (`sendFinalised200`) strips any
 *     `_timings` field unconditionally before validating against the
 *     strict OlumiResponseSchema, then re-attaches only when the flag
 *     is on. This is defense-in-depth — any upstream attach with the
 *     flag off is silently dropped at the wire seam.
 *
 * Future-compatibility note (concurrent draft candidates):
 *   `DraftGraphTimings.candidates` is an optional array reserved for a future
 *   capability in which two concurrent LLM draft calls produce candidate
 *   decision models in parallel and a deterministic reconciliation step
 *   compares/merges them. The current pipeline produces exactly one
 *   candidate; the field stays absent until that capability lands. See
 *   `Docs/latency/v5-concurrent-draft-design-note.md` (Fix 4 PR) for the
 *   design sketch.
 *
 * All fields are optional so partial captures (early-returns, validation
 * failures) emit the timings they have without populating unreached stages.
 */

/**
 * V5 turn-executor stage timings (one Sonnet routing call per turn fused
 * with handler dispatch — see Docs/v5/v5-llm-call-site-inventory.md).
 */
export interface V5TurnTimings {
  /** Wall clock from runTurnExecutor entry to response composition. */
  total_ms?: number;
  /** Time loading prior_turns/prior_facts/scenarios.* from Supabase. */
  build_turn_context_ms?: number;
  /** Time projecting EnrichedTurnContext → ContextPack (pure transforms). */
  context_pack_assembly_ms?: number;
  /** Byte length of the assembled ContextPack JSON (already in obsPayload; mirrored here). */
  context_pack_chars?: number;
  /** Wall clock for the Sonnet `chatWithTools` round-trip (Step 1 ORIENT). */
  routing_llm_ms?: number;
  /**
   * Anthropic prompt-cache result for this turn's routing call. `unknown`
   * when the routing layer cannot attribute cache state (test injectors,
   * disabled adapters, recovery short-circuits).
   */
  routing_cache?: 'hit' | 'miss' | 'disabled' | 'unsupported' | 'unknown';
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  total_input_tokens?: number;
  /** Stable handler identifier for the executed handler (null on no-handler turns). */
  handler_id?: string | null;
  /** Wall clock for the handler EXECUTE step. */
  handler_execute_ms?: number;
  /** Wall clock for the COMPOSE step (response composition). */
  compose_ms?: number;
  /** Wall clock for the COMMIT step (append_turn_atomic, awaited). */
  commit_ms?: number;
  /** Number of LLM calls attributed to this turn (echoes telemetry.llm_calls_used). */
  llm_calls_used?: number;
}

/**
 * Per-candidate draft_graph timings — placeholder for the future
 * concurrent-draft capability (see file header). Single-candidate runs
 * never populate this field today.
 */
export interface DraftGraphCandidateTimings {
  candidate_run_id: string;
  provider: string;
  model?: string;
  parse_ms?: number;
  repair_ms?: number;
  graph_quality_score?: number | null;
  option_factor_coverage?: { options: number; factors: number };
  divergence_score?: number | null;
  provenance?: 'single' | 'merged' | 'selected';
}

/**
 * CEE unified-pipeline (draft_graph) stage timings.
 *
 * `repair_*` fields express the split inside Stage 4 — deterministic sweep
 * + LLM repair pass time + whether the LLM pass actually fired + outcome.
 * This is the key signal for "is the 51 s draft_graph mean driven by an
 * LLM repair round?".
 */
export interface DraftGraphTimings {
  total_ms?: number;
  parse_ms?: number;
  /** LLM-call subset of parse_ms (from llmMeta.provider_latency_ms). */
  parse_llm_ms?: number;
  normalise_ms?: number;
  enrich_ms?: number;
  repair_ms?: number;
  repair_llm_ms?: number;
  repair_deterministic_ms?: number;
  /** Whether the LLM repair pass fired (Stage 4 substep 2 PLoT validation + repair). */
  repair_fired?: boolean;
  /** Number of LLM repair attempts (1 when fired, 0 otherwise). */
  repair_attempts?: number;
  /** Reason the LLM repair fallback engaged, or null when repair did not fire / accepted. */
  repair_reason?: string | null;
  validation_pipeline_ms?: number;
  threshold_sweep_ms?: number;
  package_ms?: number;
  boundary_ms?: number;
  /**
   * Reserved for the concurrent-draft capability. Always absent today; do
   * not populate from a single-candidate run.
   */
  candidates?: readonly DraftGraphCandidateTimings[];
}

/**
 * run_analysis (PLoT) handler timings.
 *
 * Splits the handler-total time from the PLoT outbound round-trip to
 * answer "is the 4–20 s variance Sonnet, PLoT compute, or our code?".
 * The slow-heuristic is a lightweight hint, not a definitive cold-start
 * diagnosis — see `PLOT_SLOW_LIKELY_MS` in `run-analysis.ts`.
 */
export interface RunAnalysisTimings {
  /** Wall clock from handler entry to outcome return. */
  handler_total_ms?: number;
  /** Wall clock for `plotClient.run(...)` only. */
  plot_request_ms?: number;
  /** PLoT-reported analysis_status when present. Null on failure paths
   *  where no response was parsed. */
  plot_status?: string | null;
  /** Heuristic flag: `plot_request_ms` exceeded the slow-call threshold.
   *  Hints at cold start / queueing / large-graph compute. Not a fact —
   *  paired with the raw `plot_request_ms` so consumers apply their own
   *  thresholds. `null` when timing not captured. */
  plot_slow_likely?: boolean | null;
}

/**
 * Top-level `_timings` block. Each sub-block is independently optional —
 * a V5 turn populates `turn` and at most one of {`draft_graph`,
 * `run_analysis`} depending on the executed handler.
 */
export interface TurnTimingsBlock {
  turn?: V5TurnTimings;
  draft_graph?: DraftGraphTimings;
  run_analysis?: RunAnalysisTimings;
}
