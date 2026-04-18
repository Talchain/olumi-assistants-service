/**
 * V5 TurnExecutor — pre-narrate turn classifier (A2).
 *
 * One LLM call over the `turn_classifier` prompt fragment. The fragment
 * instructs the model to return a single JSON object:
 *   { "turn_class": "direct_answer" }  OR  { "turn_class": "clarify" }
 *
 * Uses `responseFormat: 'json_object'` on the adapter seam. We parse the
 * returned content, Zod-validate its structural shape, then check the
 * `turn_class` value against the A2TurnClass union. Three distinct failure
 * classes (Paul's correction 3):
 *
 *   - STRUCTURAL failure (invalid JSON, missing key, wrong type, extra keys)
 *     → `ClassifierSchemaViolationError` → LLM_SCHEMA_VIOLATION →
 *     LLM_UNAVAILABLE wire code. Recoverable LLM fault, user retries.
 *
 *   - UNSUPPORTED CLASS (well-formed JSON whose `turn_class` is not in the
 *     A2TurnClass union, e.g. `{"turn_class":"propose"}`) →
 *     `UnhandledTurnClassError` → UNHANDLED → INTERNAL_ERROR wire code.
 *     P0 invariant breach (contract says the LLM cannot return this).
 *
 *   - UPSTREAM TIMEOUT / caller abort → `NarrateTimeoutError` with
 *     `phase: 'classify'` — shared wire mapping with narrate (LLM_TIMEOUT →
 *     UPSTREAM_TIMEOUT), phase preserved for debug attribution in telemetry
 *     and failure-envelope `details`.
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
import { type A2TurnClass, isA2TurnClass, UnhandledTurnClassError } from './types.js';

export class ClassifierSchemaViolationError extends Error {
  readonly kind = 'LLM_SCHEMA_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'ClassifierSchemaViolationError';
  }
}

// Structural schema: accepts ANY non-empty string for turn_class. The
// A2TurnClass union check is applied separately after Zod so we can
// distinguish "malformed output" (LLM_SCHEMA_VIOLATION) from "well-formed
// output but unsupported class value" (UnhandledTurnClassError → P0).
const ClassifierOutputSchema = z
  .object({
    turn_class: z.string().min(1),
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
 *   - Upstream timeout / caller abort → NarrateTimeoutError (phase='classify')
 *   - Empty content, invalid JSON, missing key, wrong type, extra keys →
 *     ClassifierSchemaViolationError (recoverable LLM fault)
 *   - Well-formed JSON whose `turn_class` is not in A2TurnClass →
 *     UnhandledTurnClassError (P0 invariant breach; see types.ts)
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
      throw new NarrateTimeoutError(`Upstream timeout during classify: ${error.message}`, 'classify');
    }
    if (isAbortLikeError(error)) {
      throw new NarrateTimeoutError('Classify call aborted by caller signal', 'classify');
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
      `Classifier output failed structural validation: ${validated.error.message}`,
    );
  }

  // Structural OK — now check the value against the A2TurnClass union.
  // Paul's correction 3: an unsupported class from valid output is a P0
  // invariant breach (UNHANDLED), NOT a recoverable schema violation.
  // Slice C1 will widen this check to C1TurnClass in D4 (classify.ts
  // extension); D2 preserves A2 semantics for callers that haven't migrated.
  if (!isA2TurnClass(validated.data.turn_class)) {
    throw new UnhandledTurnClassError('unhandled_turn_class', validated.data.turn_class);
  }

  return { turn_class: validated.data.turn_class };
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}
