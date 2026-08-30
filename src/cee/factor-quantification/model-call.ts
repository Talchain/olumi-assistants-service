import { createHash } from 'node:crypto';
import { config } from '../../config/index.js';
import { getAdapterWithResolution } from '../../adapters/llm/router.js';
import { STRUCTURED_OUTPUTS_CAPABLE_MODELS } from '../../adapters/llm/anthropic-model-capabilities.js';
import { UpstreamTimeoutError } from '../../adapters/llm/errors.js';
import {
  buildFactorQuantificationPrompt,
  FACTOR_QUANTIFICATION_PROMPT_VERSION,
  FACTOR_QUANTIFICATION_SYSTEM_PROMPT,
} from './prompt.js';
import { FACTOR_ESTIMATES_JSON_SCHEMA, parseFactorEstimates } from './estimate-response.js';
import type { FactorEstimate, FactorQuantificationPromptInput } from './types.js';

const MAX_OUTPUT_TOKENS = 4096;
const MAX_RESPONSE_CHARACTERS = 100_000;
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export interface FactorQuantificationCallInput extends FactorQuantificationPromptInput {
  readonly requestId: string;
  /** Absolute Date.now() deadline, including the caller's reserved post-processing time. */
  readonly deadlineMs: number;
  readonly signal?: AbortSignal;
}

export interface FactorQuantificationCallMetadata {
  /** One adapter invocation, NOT a count of its internal provider retry attempts. */
  readonly call_made: boolean;
  readonly provider: string | null;
  readonly resolved_model: string | null;
  readonly model: string | null;
  readonly prompt_version: string;
  readonly prompt_hash: string;
  readonly request_hash: string | null;
  readonly schema_hash: string;
  /** The shared adapter does not expose whether API grammar fallback occurred. */
  readonly structured_output_requested: boolean;
  readonly structured_output_enforced: null;
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
  readonly cache_creation_input_tokens: number | null;
  readonly cache_read_input_tokens: number | null;
  readonly latency_ms: number;
  readonly provider_latency_ms: number | null;
  /** ChatResult reports tokens but no measured or estimated cost. Never invent a tariff. */
  readonly cost_usd: null;
}

export type FactorQuantificationCallResult = {
  readonly metadata: FactorQuantificationCallMetadata;
} & (
  | { readonly kind: 'ok'; readonly estimates: readonly FactorEstimate[] }
  | { readonly kind: 'skipped'; readonly reason: 'no_gaps' | 'invalid_deadline' | 'deadline_expired' | 'aborted' | 'structured_outputs_disabled' | 'unsupported_model_or_provider' }
  | { readonly kind: 'timeout'; readonly reason: 'deadline' | 'adapter_timeout' }
  | { readonly kind: 'parse_failed'; readonly reason: string }
  | { readonly kind: 'llm_error'; readonly reason: 'invalid_input' | 'model_resolution' | 'model_mismatch' | 'aborted' | 'provider_error' }
);

/** One bounded attempt. Failures never masquerade as a model-authored unknown. */
export async function callFactorQuantification(input: FactorQuantificationCallInput): Promise<FactorQuantificationCallResult> {
  const start = Date.now();
  let metadata: FactorQuantificationCallMetadata = {
    call_made: false,
    provider: null,
    resolved_model: null,
    model: null,
    prompt_version: FACTOR_QUANTIFICATION_PROMPT_VERSION,
    prompt_hash: sha256(FACTOR_QUANTIFICATION_SYSTEM_PROMPT),
    request_hash: null,
    schema_hash: sha256(JSON.stringify(FACTOR_ESTIMATES_JSON_SCHEMA)),
    structured_output_requested: false,
    structured_output_enforced: null,
    input_tokens: null,
    output_tokens: null,
    cache_creation_input_tokens: null,
    cache_read_input_tokens: null,
    latency_ms: 0,
    provider_latency_ms: null,
    cost_usd: null,
  };
  const measured = (): FactorQuantificationCallMetadata => ({ ...metadata, latency_ms: Date.now() - start });
  if (input.gaps.length === 0) return { kind: 'skipped', reason: 'no_gaps', metadata: measured() };
  if (!Number.isFinite(input.deadlineMs)) return { kind: 'skipped', reason: 'invalid_deadline', metadata: measured() };
  if (input.signal?.aborted) return { kind: 'skipped', reason: 'aborted', metadata: measured() };
  if (input.deadlineMs <= Date.now()) return { kind: 'skipped', reason: 'deadline_expired', metadata: measured() };

  let userMessage: string;
  try {
    userMessage = buildFactorQuantificationPrompt(input);
  } catch {
    return { kind: 'llm_error', reason: 'invalid_input', metadata: measured() };
  }
  metadata = { ...metadata, request_hash: sha256(`${FACTOR_QUANTIFICATION_SYSTEM_PROMPT}\n${userMessage}`) };

  let assignment: ReturnType<typeof getAdapterWithResolution>;
  try {
    assignment = getAdapterWithResolution('factor_quantification');
  } catch {
    return { kind: 'llm_error', reason: 'model_resolution', metadata: measured() };
  }
  const { adapter, resolution } = assignment;
  metadata = { ...metadata, provider: resolution.provider ?? null, resolved_model: resolution.resolved_model };
  // outputSchema is ignored by other providers. Refuse before spending a call.
  if (resolution.provider !== 'fixtures') {
    if (resolution.provider !== 'anthropic' || !STRUCTURED_OUTPUTS_CAPABLE_MODELS.has(resolution.resolved_model)) {
      return { kind: 'skipped', reason: 'unsupported_model_or_provider', metadata: measured() };
    }
    if (!config.cee.anthropicStructuredOutputs) {
      return { kind: 'skipped', reason: 'structured_outputs_disabled', metadata: measured() };
    }
  }
  const remainingMs = input.deadlineMs - Date.now();
  if (remainingMs <= 0) return { kind: 'skipped', reason: 'deadline_expired', metadata: measured() };
  if (input.signal?.aborted) return { kind: 'skipped', reason: 'aborted', metadata: measured() };

  const controller = new AbortController();
  let deadlineExpired = false;
  let externallyAborted = false;
  const onExternalAbort = (): void => { externallyAborted = true; controller.abort(); };
  input.signal?.addEventListener('abort', onExternalAbort, { once: true });
  let onAbort: () => void = () => undefined;
  // Race as well as abort: a provider wrapper that ignores cancellation must not
  // hold the caller past its deadline or adopt a late response after cancellation.
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new Error('factor_quantification_cancelled'));
    controller.signal.addEventListener('abort', onAbort, { once: true });
  });
  const timer = setTimeout(() => { deadlineExpired = true; controller.abort(); }, remainingMs);
  try {
    metadata = { ...metadata, call_made: true, structured_output_requested: true };
    const result = await Promise.race([
      adapter.chat({
        system: FACTOR_QUANTIFICATION_SYSTEM_PROMPT,
        userMessage,
        temperature: 0,
        maxTokens: config.cee.maxTokens.factor_quantification ?? MAX_OUTPUT_TOKENS,
        thinking: { type: 'disabled' },
        outputSchema: FACTOR_ESTIMATES_JSON_SCHEMA,
      }, { requestId: input.requestId, timeoutMs: remainingMs, signal: controller.signal }),
      cancelled,
    ]);
    metadata = {
      ...metadata,
      model: result.model,
      input_tokens: result.usage.input_tokens,
      output_tokens: result.usage.output_tokens,
      cache_creation_input_tokens: result.usage.cache_creation_input_tokens ?? null,
      cache_read_input_tokens: result.usage.cache_read_input_tokens ?? null,
      provider_latency_ms: result.latencyMs,
    };
    if (input.signal?.aborted || externallyAborted) return { kind: 'llm_error', reason: 'aborted', metadata: measured() };
    if (deadlineExpired || Date.now() >= input.deadlineMs) return { kind: 'timeout', reason: 'deadline', metadata: measured() };
    if (result.model !== resolution.resolved_model) return { kind: 'llm_error', reason: 'model_mismatch', metadata: measured() };
    if (result.content.length > MAX_RESPONSE_CHARACTERS) return { kind: 'parse_failed', reason: 'response_too_large', metadata: measured() };
    let raw: unknown;
    try { raw = JSON.parse(result.content); }
    catch { return { kind: 'parse_failed', reason: 'invalid_json', metadata: measured() }; }
    const parsed = parseFactorEstimates(raw, input.gaps.map((gap) => gap.factor_id));
    if (!parsed.ok) return { kind: 'parse_failed', reason: parsed.error, metadata: measured() };
    return { kind: 'ok', estimates: parsed.estimates, metadata: measured() };
  } catch (error) {
    if (externallyAborted || input.signal?.aborted) return { kind: 'llm_error', reason: 'aborted', metadata: measured() };
    if (deadlineExpired || Date.now() >= input.deadlineMs) return { kind: 'timeout', reason: 'deadline', metadata: measured() };
    if (error instanceof UpstreamTimeoutError && error.timeoutPhase !== 'pre_aborted') {
      return { kind: 'timeout', reason: 'adapter_timeout', metadata: measured() };
    }
    return { kind: 'llm_error', reason: 'provider_error', metadata: measured() };
  } finally {
    clearTimeout(timer);
    input.signal?.removeEventListener('abort', onExternalAbort);
    controller.signal.removeEventListener('abort', onAbort);
  }
}
