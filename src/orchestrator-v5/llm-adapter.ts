/**
 * Narrate-mode LLM adapter for V5 TurnExecutor (A1).
 *
 * Thin wrapper over `getAdapter(...).chat(...)` in the established LLM seam.
 * Only narrate mode lives here in A1. Interpret and artefact modes are
 * unreachable invariants — invoking them throws, which TurnExecutor maps
 * to UNHANDLED → P0 alert. No user-facing NOT_IMPLEMENTED path.
 */

import type {
  LLMAdapterRequest,
  LLMAdapterResponse,
} from '@talchain/schemas/orchestrator';

import { getAdapterWithResolution } from '../adapters/llm/router.js';
import { UpstreamTimeoutError } from '../adapters/llm/errors.js';
import { recordModelResolution } from './debug/turn-debug-store.js';

// Internal failure signals the wrapper raises. TurnExecutor maps each to a
// FailureType before egress.
//
// `phase` distinguishes classifier-side timeouts from narrate-side timeouts
// for telemetry + debug attribution (A2 correction). Wire-level mapping is
// identical for both (LLM_TIMEOUT → UPSTREAM_TIMEOUT); only the failure
// envelope's `details.phase` differs, which propagates to observability.
export type LlmPhase = 'classify' | 'narrate';

export class NarrateTimeoutError extends Error {
  readonly kind = 'LLM_TIMEOUT';
  readonly phase: LlmPhase;
  constructor(message: string, phase: LlmPhase = 'narrate') {
    super(message);
    this.name = 'NarrateTimeoutError';
    this.phase = phase;
  }
}

export class NarrateEmptyOutputError extends Error {
  readonly kind = 'LLM_EMPTY_OUTPUT';
  constructor() {
    super('Narrate-mode LLM returned empty output');
    this.name = 'NarrateEmptyOutputError';
  }
}

export interface InvokeNarrateOpts {
  /** External AbortSignal — TurnExecutor passes its wall-clock budget signal. */
  signal?: AbortSignal;
  /** Optional — enables per-call model_resolution recording to turn-debug.
   *  The LLMAdapterRequest schema is pinned, so we can't stuff session_id
   *  into the request payload; options is the seam. Unreachable in Phase 1
   *  (TurnExecutor uses routeWithToolUse, not invokeNarrate). */
  session_id?: string;
}

/**
 * Invoke narrate mode. Returns clean non-empty text on success.
 *
 * A1 invokes `getAdapter('direct_answer_narrate').chat(...)` with the A1
 * request payload. Failure modes:
 *  - Upstream timeout or abort → NarrateTimeoutError
 *  - Empty content → NarrateEmptyOutputError
 *
 * Any other thrown error propagates — TurnExecutor catches at the stage
 * boundary and maps to UNHANDLED.
 */
export async function invokeNarrate(
  request: LLMAdapterRequest,
  opts?: InvokeNarrateOpts,
): Promise<LLMAdapterResponse> {
  // Group 3 Task C: route through getAdapterWithResolution. Prior to the fix
  // this site called `getAdapter('direct_answer_narrate')`, which is NOT a
  // CeeTask member and therefore short-circuited to llm_model_fallback.
  // `explainer` is the nearest fit for single-turn narrate prose (fast tier).
  // Paul should confirm this mapping if invokeNarrate is ever wired back
  // into the live path; for now the site remains unreachable from V5 Phase 1
  // (routeWithToolUse replaced it), so this correction is a forward-fix.
  const { adapter, resolution } = getAdapterWithResolution('explainer');
  if (opts?.session_id) {
    recordModelResolution(request.request_id, opts.session_id, resolution);
  }
  try {
    const result = await adapter.chat(
      {
        system: request.system,
        userMessage: request.user_message,
        temperature: request.temperature,
        maxTokens: request.max_tokens,
      },
      {
        requestId: request.request_id,
        timeoutMs: request.budget_ms,
        signal: opts?.signal,
      },
    );

    const text = (result.content ?? '').trim();
    if (text.length === 0) {
      throw new NarrateEmptyOutputError();
    }

    const totalTokens = result.usage
      ? (result.usage.input_tokens ?? 0) + (result.usage.output_tokens ?? 0)
      : undefined;
    return {
      text,
      tokens_used: totalTokens,
    };
  } catch (error) {
    // Map provider-side timeouts + externally triggered aborts to the A1 class.
    if (error instanceof UpstreamTimeoutError) {
      throw new NarrateTimeoutError(`Upstream timeout during narrate: ${error.message}`, 'narrate');
    }
    if (isAbortLikeError(error)) {
      throw new NarrateTimeoutError('Narrate call aborted by caller signal', 'narrate');
    }
    throw error;
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}
