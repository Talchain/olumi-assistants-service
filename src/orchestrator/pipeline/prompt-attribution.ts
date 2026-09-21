/**
 * Served-prompt attribution collector — a carrier for LLM calls made DEEP
 * inside the draft pipeline, so the V5 diagnostic trace can attribute them.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * Every `recordPromptIdentity` call in this estate lives in the trace
 * BUILDER (`orchestrator-v5/diagnostics/v5-diagnostic-trace.ts`), never at
 * `getSystemPrompt()`. Attribution is therefore RECONSTRUCTED from telemetry
 * that someone remembered to thread, rather than SUBSCRIBED at the source —
 * so a call the builder was never told about is invisible by construction,
 * and silently so. Two such calls run on EVERY draft turn:
 *
 *   - the post-draft coaching pass (~19.8 s, ungated), whose prompt hash,
 *     version and model were already computed at the call site and thrown
 *     into a log line; and
 *   - `validate_graph`, a real o4-mini call behind
 *     `CEE_VALIDATION_PIPELINE_ENABLED`.
 *
 * Neither could reach the builder, because neither sits on the
 * `DraftGraphResult` → dispatcher → builder path that the existing
 * attribution rides.
 *
 * ── WHAT THIS IS, AND WHAT IT DELIBERATELY IS NOT ─────────────────────────
 * It is a plain mutable accumulator OWNED BY THE CALLER and threaded DOWN
 * through `UnifiedPipelineOpts`. It is not a registry, not an
 * AsyncLocalStorage context, and it does not hook `getSystemPrompt` — that
 * restructure is the durable fix and is rowed, not built here.
 *
 * Caller ownership is the load-bearing property, not a convenience: the
 * dispatcher holds the reference, so whatever was recorded before a pipeline
 * THREW is still readable in the catch block. Attribution on a failing turn
 * is exactly when "which prompt ran?" matters most, and a collector owned by
 * the pipeline would be lost with the stack that raised.
 *
 * ── HONESTY RULES, matching the four sibling sites in the trace builder ────
 * - `recordLLMCall` is UNCONDITIONAL: the model, provider, tokens and latency
 *   are real data about a call that demonstrably happened.
 * - `recordPromptIdentity` is HASH-GUARDED: `PromptIdentity.hash` is
 *   required, so the only honest options are a real hash or no record at all
 *   — never a placeholder digest. A call whose prompt could not be bound
 *   therefore appears in `llm_calls[]` and NOT in `prompt_identity[]`, which
 *   is a positive statement that the model is known and the prompt is not.
 * - `is_staging` is stamped by the BUILDER, not here, so this module stays
 *   free of `config` and the one expression the four sibling sites share
 *   cannot drift into a fifth spelling.
 */

import type { LLMCallTrace, PromptIdentity } from './diagnostic-trace.js';

/**
 * The prompt half of an attribution: `PromptIdentity` minus `is_staging`,
 * which the builder stamps at replay (see the module header).
 *
 * DERIVED with `Omit`, not hand-listed. A hand-listed twin is the estate's
 * dominant defect class — it drifts, and the drift reads as green. This way a
 * field added to `PromptIdentity` appears here too, and the builder's replay
 * (which names each field explicitly) fails to compile until it is carried
 * across, rather than silently dropping it.
 */
export type AttributedPromptIdentity = Omit<PromptIdentity, 'is_staging'>;

/** One recorded call. `hash` absent ⇒ the call is recorded, the prompt is not. */
export interface PromptAttributionInput {
  /** `prompt_identity[].task_id` — the CEE task, e.g. `validate_graph`. */
  readonly taskId: string;
  /** `llm_calls[].role` — how the call is labelled in the trace. */
  readonly role: string;
  readonly provider: string;
  /**
   * The resolved model. `undefined` ⇒ the adapter genuinely did not expose
   * one, recorded as the estate's honest `'unknown'` sentinel rather than a
   * fabricated id (same convention as the routing and edit_graph sites).
   */
  readonly model: string | undefined;
  readonly inputTokens: number | undefined;
  readonly outputTokens: number | undefined;
  readonly latencyMs: number;
  readonly stopReason: string | null;
  /** Absent ⇒ no `prompt_identity` record is made. Never defaulted. */
  readonly promptHash: string | undefined;
  readonly promptVersion: string | undefined;
  readonly promptId: string | undefined;
  readonly promptSource: string | undefined;
}

/** Immutable read-out, shaped for direct replay into the trace collector. */
export interface PromptAttributionSnapshot {
  readonly llm_calls: readonly LLMCallTrace[];
  readonly prompt_identity: readonly AttributedPromptIdentity[];
}

export class PromptAttributionCollector {
  private readonly calls: LLMCallTrace[] = [];
  private readonly identities: AttributedPromptIdentity[] = [];

  record(input: PromptAttributionInput): void {
    this.calls.push({
      role: input.role,
      provider: input.provider,
      model: input.model ?? 'unknown',
      input_tokens: input.inputTokens ?? 0,
      output_tokens: input.outputTokens ?? 0,
      // Not threaded by either recording site today. Recorded as `null`
      // ("not measured here") rather than `0` ("measured, and it was zero").
      cache_read_tokens: null,
      cache_creation_tokens: null,
      latency_ms: input.latencyMs,
      stop_reason: input.stopReason,
      thinking_enabled: false,
      error: null,
    });
    if (input.promptHash) {
      this.identities.push({
        task_id: input.taskId,
        prompt_id: input.promptId ?? input.promptVersion ?? 'unknown',
        version: input.promptVersion ?? 'unknown',
        hash: input.promptHash,
        source: input.promptSource ?? 'unknown',
      });
    }
  }

  /** True when nothing was recorded — lets callers omit the key entirely. */
  isEmpty(): boolean {
    return this.calls.length === 0 && this.identities.length === 0;
  }

  /** Fresh copies each call; the collector stays usable afterwards. */
  snapshot(): PromptAttributionSnapshot {
    return {
      llm_calls: [...this.calls],
      prompt_identity: [...this.identities],
    };
  }
}
