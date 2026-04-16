/**
 * V5 TurnExecutor — pre-narrate turn classifier (A2).
 *
 * One LLM call over the `turn_classifier` prompt fragment. The fragment
 * instructs the model to return a single JSON object:
 *   { "turn_class": "direct_answer" }  OR  { "turn_class": "clarify" }
 *
 * Uses `responseFormat: 'json_object'` on the adapter seam. We parse the
 * returned content and Zod-validate against a narrow schema. A failed parse
 * or an out-of-union `turn_class` value is treated distinctly:
 *
 *   - Invalid JSON or invalid union value → `ClassifierSchemaViolationError`
 *     → TurnExecutor maps to LLM_SCHEMA_VIOLATION → LLM_UNAVAILABLE wire code.
 *     Per Paul's correction 3: classifier failing to produce valid structured
 *     output is a recoverable LLM fault (mirrors narrate-mode failures), not
 *     an internal invariant breach.
 *
 *   - Upstream timeout or caller-abort → `NarrateTimeoutError` (same class
 *     narrate uses, by design — they share the mapping LLM_TIMEOUT →
 *     UPSTREAM_TIMEOUT).
 *
 * Budget semantics (Paul's correction 4): classifier and narrate each get a
 * fresh `LLM_BUDGET_NARRATE_MS` window. Outer `TURN_BUDGET_MS` is the shared
 * wall-clock ceiling. Worst-case LLM time = 2 × LLM_BUDGET_NARRATE_MS, bounded
 * by TURN_BUDGET_MS. See `budgets.ts` for the documentation.
 */

import { z } from 'zod';

import { getAdapter } from '../adapters/llm/router.js';
import { UpstreamTimeoutError } from '../adapters/llm/errors.js';
import { getSystemPrompt } from '../adapters/llm/prompt-loader.js';
import { NarrateTimeoutError } from './llm-adapter.js';
import type { A2TurnClass } from './types.js';

export class ClassifierSchemaViolationError extends Error {
  readonly kind = 'LLM_SCHEMA_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'ClassifierSchemaViolationError';
  }
}

const ClassifierOutputSchema = z
  .object({
    turn_class: z.enum(['direct_answer', 'clarify']),
  })
  .strict();

export interface ClassifyTurnInput {
  /** Latest user message (already extracted from TurnContext.messages). */
  user_message: string;
  request_id: string;
  /** Inner narrate-mode budget in ms. Classifier shares this window
   *  independently of the downstream narrate call. */
  budget_ms: number;
}

export interface ClassifyTurnOpts {
  /** External AbortSignal — TurnExecutor passes its wall-clock budget signal. */
  signal?: AbortSignal;
}

export interface ClassifyTurnResult {
  turn_class: A2TurnClass;
}

/**
 * Classify a user turn into `direct_answer` or `clarify`.
 *
 * Failure modes:
 *   - Upstream timeout / caller abort → NarrateTimeoutError
 *   - Empty content or invalid JSON → ClassifierSchemaViolationError
 *   - JSON parses but `turn_class` not in union → ClassifierSchemaViolationError
 *
 * Any other thrown error propagates — TurnExecutor catches at the dispatch
 * boundary and maps to UNHANDLED.
 */
export async function classifyTurn(
  input: ClassifyTurnInput,
  opts?: ClassifyTurnOpts,
): Promise<ClassifyTurnResult> {
  const system = await getSystemPrompt('turn_classifier');
  const adapter = getAdapter('turn_classifier');

  let content: string;
  try {
    const result = await adapter.chat(
      {
        system,
        userMessage: input.user_message,
        temperature: 0,
        responseFormat: 'json_object',
      },
      {
        requestId: input.request_id,
        timeoutMs: input.budget_ms,
        signal: opts?.signal,
      },
    );
    content = (result.content ?? '').trim();
  } catch (error) {
    if (error instanceof UpstreamTimeoutError) {
      throw new NarrateTimeoutError(`Upstream timeout during classify: ${error.message}`);
    }
    if (isAbortLikeError(error)) {
      throw new NarrateTimeoutError('Classify call aborted by caller signal');
    }
    throw error;
  }

  if (content.length === 0) {
    throw new ClassifierSchemaViolationError('Classifier returned empty output');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new ClassifierSchemaViolationError(
      `Classifier returned non-JSON output: ${(err as Error).message}`,
    );
  }

  const validated = ClassifierOutputSchema.safeParse(parsed);
  if (!validated.success) {
    throw new ClassifierSchemaViolationError(
      `Classifier output failed schema validation: ${validated.error.message}`,
    );
  }

  return { turn_class: validated.data.turn_class };
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}
