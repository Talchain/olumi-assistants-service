/**
 * `trace.pipeline.llm_metadata` — ONE projection, used by BOTH the success and
 * the failure surface.
 *
 * ⚠ WHY THIS FILE EXISTS (2026-07-25). The projection was a HAND-MAINTAINED
 * KEEP-LIST, written out twice:
 *   * `stages/package.ts` (success)        — 15 keys
 *   * `unified-pipeline/index.ts` (errors) —  6 keys
 * Neither listed `runaway_abort_count`, which the Anthropic adapter has emitted
 * on its result meta since 2026-07-23. So a field that exists, is populated, and
 * is the single cheapest diagnosis signal in the draft path was absent from all
 * 60 response bodies captured on 2026-07-24 — and the "two 30s runaway aborts"
 * account had to be reverse-engineered from `getAffordableDraftTokens(50_000)`
 * arithmetic instead of simply read. The failure list additionally dropped
 * `max_tokens`, so the cap on a truncation had to be inferred from
 * `completion_tokens`.
 *
 * A list a human must remember to sync with reality drifts silently, and the
 * drift always reads as green. Deriving both surfaces from this one function
 * means a field added to the adapter meta lands on BOTH, or on neither —
 * never on one.
 *
 * The projection is deliberately a keep-list rather than a spread of the whole
 * adapter meta: that meta carries `raw_llm_text` / `raw_llm_json`, which must
 * NOT go onto the wire wholesale. Additions here are a deliberate act; the point
 * is that they are a SINGLE deliberate act.
 */

/**
 * Shape is intentionally loose: `ctx.llmMeta` is `any` in the pipeline context
 * (it is the adapter's `meta` bag, whose shape varies by adapter), and typing it
 * strictly here would only add a cast at every call site.
 */
export type LlmMetaBag = any;

export interface LlmMetadataProjection {
  readonly [key: string]: unknown;
}

/**
 * Project the adapter's LLM meta onto the wire shape.
 *
 * @param llmMeta the adapter result meta (`ctx.llmMeta`), possibly undefined
 * @param fallbackModel model id to report when the meta is absent or carries none
 */
export function buildLlmMetadataProjection(
  llmMeta: LlmMetaBag | undefined,
  fallbackModel: string | undefined,
): LlmMetadataProjection {
  if (!llmMeta) return { model: fallbackModel };
  return {
    model: llmMeta.model ?? fallbackModel,
    prompt_version: llmMeta.prompt_version,
    prompt_text_version: llmMeta.prompt_text_version,
    prompt_hash: llmMeta.prompt_hash,
    duration_ms: llmMeta.provider_latency_ms,
    finish_reason: llmMeta.finish_reason,
    response_chars: llmMeta.raw_llm_text?.length,
    token_usage: llmMeta.token_usage,
    temperature: llmMeta.temperature,
    max_tokens: llmMeta.max_tokens,
    seed: llmMeta.seed,
    reasoning_effort: llmMeta.reasoning_effort,
    instance_id: llmMeta.instance_id,
    cache_age_ms: llmMeta.cache_age_ms,
    cache_status: llmMeta.cache_status,
    use_staging_mode: llmMeta.use_staging_mode,
    structured_outputs_used: llmMeta.structured_outputs_used,
    // ── Draft streaming / runaway diagnostics (2026-07-25) ──────────────────
    // `runaway_abort_count` is the count of doomed attempts the adapter aborted
    // before this result. It is what makes a starved `max_tokens` legible
    // WITHOUT server-log access; `time_to_edges_ms` says whether the runaway
    // detector's deadline is being tripped by genuinely slow drafts.
    streamed: llmMeta.streamed,
    runaway_abort_count: llmMeta.runaway_abort_count,
    // WHICH gates fired, oldest first — "string" (one JSON string value passed
    // the per-value ceiling), "chars" (total nodes-phase volume), "stall",
    // "time". Added 2026-07-25 with the per-string-value guard: a guard whose
    // firing is invisible on the wire is indistinguishable from one that never
    // fires, and the fast-abort detector spent weeks in exactly that state.
    runaway_abort_triggers: llmMeta.runaway_abort_triggers,
    time_to_edges_ms: llmMeta.time_to_edges_ms,
    salvaged_from_truncation: llmMeta.salvaged_from_truncation,
  };
}
