/**
 * V6 dual-draft M2 review caller.
 *
 * Makes the single M2 LLM call: system prompt from the `m2_graph_review`
 * slot (fail-closed sentinel until Paul-authored copy lands via the PMS
 * lane), user content = brief + compact graph serialisation, structured
 * outputs (PROPOSALS_JSON_SCHEMA) with temperature 0 and a hard timeout.
 *
 * Every failure mode resolves to a typed non-ok outcome — this module never
 * throws to its caller:
 *   prompt_not_provisioned — sentinel present or loader failed (G17);
 *   insufficient_headroom  — pipeline already consumed too much of the draft
 *                            request budget (G2);
 *   timeout / llm_error    — adapter call aborted or failed;
 *   parse_failed           — output was not a {proposals: [...]} JSON object.
 *
 * Model resolution: `getAdapterWithResolution('m2_graph_review')` — the
 * CEE_MODEL_M2_REVIEW env override (config.cee.models.m2_review) wins via the
 * router's CEE tiered selection; activation requires setting it deliberately
 * (recommended per D3: claude-opus-4-8). No code-default model is passed as a
 * per-call override because those are validated against the CLIENT model
 * blocklist and could be silently rejected.
 */
import { config } from '../../config/index.js';
import { M2_REVIEW_TIMEOUT_MS, DRAFT_REQUEST_BUDGET_MS } from '../../config/timeouts.js';
import { getSystemPrompt } from '../../adapters/llm/prompt-loader.js';
import { getAdapterWithResolution } from '../../adapters/llm/router.js';
import { UpstreamTimeoutError } from '../../adapters/llm/errors.js';
import { log } from '../../utils/telemetry.js';
import { isM2PromptProvisioned } from './prompt-sentinel.js';
import { serialiseGraphForReview } from './serialise-graph-for-review.js';
import { PROPOSALS_JSON_SCHEMA } from './proposal-json-schema.js';
import type { EnrichmentInput } from './types.js';

/** Post-M2 work (merge + guards + commit) needs this much of the budget left. */
const POST_REVIEW_HEADROOM_MS = 10_000;

const DEFAULT_M2_MAX_TOKENS = 4096;

/**
 * Coded sub-cause for `model_not_resolved` — safe to emit on telemetry
 * (bounded enum, config values only, no user content) so activation
 * dashboards can distinguish the three operator-actionable conditions:
 *   model_unset          — CEE_MODEL_M2_REVIEW not set (ops forgot);
 *   provider_unsupported — resolved to a non-Anthropic model (wrong family);
 *   model_mismatch       — router resolved a different model (blocked /
 *                          failover / override intercepted the config value).
 */
export type M2ModelResolutionCause = 'model_unset' | 'provider_unsupported' | 'model_mismatch';

export type M2ReviewResult =
  | {
      readonly kind: 'ok';
      readonly proposals: readonly unknown[];
      readonly latencyMs: number;
      readonly model: string;
    }
  | { readonly kind: 'prompt_not_provisioned' }
  | { readonly kind: 'model_not_resolved'; readonly cause: M2ModelResolutionCause; readonly detail: string }
  | { readonly kind: 'insufficient_headroom' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'llm_error'; readonly message: string }
  | { readonly kind: 'parse_failed'; readonly message: string };

function isTimeoutShaped(err: unknown): boolean {
  // Primary: the adapters' typed timeout error (the anthropic chat path
  // converts AbortError into UpstreamTimeoutError before rethrowing, so this
  // is the branch that fires on the real path). `pre_aborted` means an
  // EXTERNAL abort (client disconnect / turn-budget cancellation), not an M2
  // timeout — classify that as llm_error so the m2_outcome split the
  // activation ruling depends on stays honest.
  if (err instanceof UpstreamTimeoutError) {
    return err.timeoutPhase !== 'pre_aborted';
  }
  if (err instanceof Error) {
    // Fallbacks for non-adapter wrappers. Deliberately NO bare /abort/i —
    // upstream messages like "request aborted by upstream: 529" are provider
    // failures, not timeouts.
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
    return /timed?\s*out/i.test(err.message);
  }
  return false;
}

export async function reviewDraftGraph(input: EnrichmentInput): Promise<M2ReviewResult> {
  // G2 — headroom gate. The draft dispatch is bound by the in-pipeline draft
  // request budget (120s default) plus proxy/route timeouts above it; skip M2
  // entirely when a slow M1 has already eaten the review window.
  if (input.pipelineElapsedMs + M2_REVIEW_TIMEOUT_MS + POST_REVIEW_HEADROOM_MS > DRAFT_REQUEST_BUDGET_MS) {
    return { kind: 'insufficient_headroom' };
  }

  // G17 — fail-closed prompt slot.
  let system: string;
  try {
    system = await getSystemPrompt('m2_graph_review');
  } catch {
    return { kind: 'prompt_not_provisioned' };
  }
  if (!isM2PromptProvisioned(system)) {
    return { kind: 'prompt_not_provisioned' };
  }

  // Model-resolution gate (activation ruling): the M2 model must be
  // EXPLICITLY configured via CEE_MODEL_M2_REVIEW and the router must resolve
  // to exactly that model. Unset, blocked, or unexpectedly-resolved models
  // leave the stage inert — loudly (warn log + m2_outcome telemetry carries
  // 'model_not_resolved') — rather than making a live call with whatever the
  // provider default happens to be, and rather than silently appearing active.
  const configuredModel = config.cee.models.m2_review;
  if (!configuredModel) {
    log.warn(
      { request_id: input.requestId, scenario_id: input.scenarioId },
      'V6 dual-draft M2 model not configured — set CEE_MODEL_M2_REVIEW explicitly; stage inert',
    );
    return { kind: 'model_not_resolved', cause: 'model_unset', detail: 'CEE_MODEL_M2_REVIEW unset' };
  }

  const { adapter, resolution } = getAdapterWithResolution('m2_graph_review');
  if (resolution.provider !== 'anthropic' && resolution.provider !== 'fixtures') {
    // MVP is structured-outputs-only (D2): only the Anthropic adapter
    // implements ChatArgs.outputSchema — other providers ignore it silently,
    // which would mean recurring live-call cost with unconstrained text
    // output and parse-failure churn. Inert + loud instead.
    log.warn(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        configured_model: configuredModel,
        provider: resolution.provider,
      },
      'V6 dual-draft M2 model resolves to a non-Anthropic provider — structured outputs unsupported; stage inert',
    );
    return {
      kind: 'model_not_resolved',
      cause: 'provider_unsupported',
      detail: `provider "${resolution.provider}" does not support structured outputs`,
    };
  }
  if (resolution.resolved_model !== configuredModel) {
    log.warn(
      {
        request_id: input.requestId,
        scenario_id: input.scenarioId,
        configured_model: configuredModel,
        resolved_model: resolution.resolved_model,
        resolution_source: resolution.resolution_source,
      },
      'V6 dual-draft M2 model resolution mismatch (blocked/failover/override?) — stage inert',
    );
    return {
      kind: 'model_not_resolved',
      cause: 'model_mismatch',
      detail: `resolved "${resolution.resolved_model}" != configured "${configuredModel}"`,
    };
  }

  const userMessage = [
    'Decision brief:',
    input.brief,
    '',
    'Draft graph (compact):',
    serialiseGraphForReview(input.graph),
  ].join('\n');

  let content: string;
  let latencyMs: number;
  let model: string;
  try {
    const result = await adapter.chat(
      {
        system,
        userMessage,
        temperature: 0,
        maxTokens: config.cee.maxTokens.m2_review ?? DEFAULT_M2_MAX_TOKENS,
        outputSchema: PROPOSALS_JSON_SCHEMA,
        // Explicit, not omitted: Sonnet 5 runs ADAPTIVE thinking when the
        // request has no `thinking` field. Measured offline (2026-07-14,
        // v1.0 candidate prompt, structured outputs): ~59-62s wall clock
        // with adaptive thinking — more than double M2_REVIEW_TIMEOUT_MS,
        // i.e. every live M2 call would degrade m2_timeout. M2 is a
        // deterministic structured-outputs review; thinking is disabled by
        // design.
        thinking: { type: 'disabled' },
      },
      {
        requestId: input.requestId,
        timeoutMs: M2_REVIEW_TIMEOUT_MS,
      },
    );
    content = result.content;
    latencyMs = result.latencyMs;
    model = result.model;
  } catch (err) {
    if (isTimeoutShaped(err)) return { kind: 'timeout' };
    return { kind: 'llm_error', message: err instanceof Error ? err.message : String(err) };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { kind: 'parse_failed', message: err instanceof Error ? err.message : 'invalid JSON' };
  }
  const proposals = (parsed as { proposals?: unknown })?.proposals;
  if (!Array.isArray(proposals)) {
    return { kind: 'parse_failed', message: 'output has no proposals array' };
  }

  return { kind: 'ok', proposals, latencyMs, model };
}
