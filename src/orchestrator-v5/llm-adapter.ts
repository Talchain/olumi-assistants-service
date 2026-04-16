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

import { getAdapter } from '../adapters/llm/router.js';
import { UpstreamTimeoutError } from '../adapters/llm/errors.js';

// Internal failure signals the wrapper raises. TurnExecutor maps each to a
// FailureType before egress.
export class NarrateTimeoutError extends Error {
  readonly kind = 'LLM_TIMEOUT';
  constructor(message: string) {
    super(message);
    this.name = 'NarrateTimeoutError';
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
  const adapter = getAdapter('direct_answer_narrate');
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
      throw new NarrateTimeoutError(`Upstream timeout during narrate: ${error.message}`);
    }
    if (isAbortLikeError(error)) {
      throw new NarrateTimeoutError('Narrate call aborted by caller signal');
    }
    throw error;
  }
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}
