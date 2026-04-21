/**
 * V5 TurnExecutor — pre-narrate turn classifier (A2 + C1).
 *
 * One LLM call over the `turn_classifier` prompt fragment. The fragment
 * instructs the model to return a single JSON object:
 *   { "turn_class": "direct_answer" }
 *   { "turn_class": "clarify" }
 *   { "turn_class": "handler", "handler_id": "run_analysis" }   (C1+)
 *
 * Uses `responseFormat: 'json_object'` on the adapter seam. We parse the
 * returned content, Zod-validate its structural shape + biconditional
 * refinement (handler_id present iff turn_class === 'handler'), then check
 * `turn_class` against the C1TurnClass union and `handler_id` against
 * V5ActionType's 7 literals. Four distinct failure classes:
 *
 *   - STRUCTURAL failure (invalid JSON, missing key, wrong type, extra keys,
 *     or biconditional violation such as `handler_id` on a non-handler turn)
 *     → `ClassifierSchemaViolationError` → LLM_SCHEMA_VIOLATION →
 *     LLM_UNAVAILABLE wire code. Recoverable LLM fault, user retries.
 *
 *   - UNSUPPORTED CLASS (well-formed JSON whose `turn_class` is not in the
 *     C1TurnClass union, e.g. `{"turn_class":"propose"}`) →
 *     `UnhandledTurnClassError(reason='unhandled_turn_class')` → UNHANDLED →
 *     INTERNAL_ERROR wire code. P0 invariant breach.
 *
 *   - INVALID HANDLER ID (`turn_class === 'handler'` but `handler_id` is
 *     outside the 7 V5ActionType literals, e.g. `"make_coffee"`) →
 *     `UnhandledTurnClassError(reason='missing_handler_id')` → UNHANDLED →
 *     INTERNAL_ERROR. Distinct from the biconditional violation: the shape
 *     is correct (both fields present) but the semantic value is invalid.
 *
 *   - UPSTREAM TIMEOUT / caller abort → `NarrateTimeoutError` with
 *     `phase: 'classify'` — shared wire mapping with narrate (LLM_TIMEOUT →
 *     UPSTREAM_TIMEOUT), phase preserved for debug attribution.
 *
 * Budget semantics (Paul's correction 4): classifier and narrate each get a
 * fresh `LLM_BUDGET_NARRATE_MS` window. Outer `TURN_BUDGET_MS` is the shared
 * wall-clock ceiling. Handler invocations get their own fresh
 * `LLM_BUDGET_HANDLER_MS` (see budgets.ts / tools/registry.ts).
 */

import { z } from 'zod';

import {
  V5ActionTypeSchema,
  type V5ActionType,
} from '@talchain/schemas/orchestrator';

import { getAdapterWithResolution } from '../adapters/llm/router.js';
import { UpstreamTimeoutError } from '../adapters/llm/errors.js';
import { getSystemPrompt } from '../adapters/llm/prompt-loader.js';
import { recordModelResolution } from './debug/turn-debug-store.js';
import { NarrateTimeoutError } from './llm-adapter.js';
import {
  type C1TurnClass,
  isC1TurnClass,
  UnhandledTurnClassError,
} from './types.js';

export class ClassifierSchemaViolationError extends Error {
  readonly kind = 'LLM_SCHEMA_VIOLATION';
  constructor(message: string) {
    super(message);
    this.name = 'ClassifierSchemaViolationError';
  }
}

// Structural schema: accepts ANY non-empty string for turn_class. Value-level
// checks are applied post-Zod so we can distinguish "malformed output"
// (LLM_SCHEMA_VIOLATION) from "well-formed output but unsupported semantic
// value" (UnhandledTurnClassError → P0). `z.string()` — NOT `z.enum` — per
// plan R3: enum collisions between structural and semantic parse levels.
//
// Biconditional refinement (Paul 2026-04-18 refinement #6): `handler_id` is
// present iff `turn_class === 'handler'`. Mirrors the SessionTurnSchema
// biconditional landed in Phase 0 audit §4.5. Violations fire inside Zod,
// so they surface as ClassifierSchemaViolationError — distinct from the
// post-parse UnhandledTurnClassError path.
const ClassifierOutputSchema = z
  .object({
    turn_class: z.string().min(1),
    handler_id: z.string().min(1).optional(),
  })
  .strict()
  .refine(
    (obj) => (obj.turn_class === 'handler') === (obj.handler_id !== undefined),
    {
      message: "handler_id must be present iff turn_class === 'handler'",
      path: ['handler_id'],
    },
  );

export interface ClassifyTurnInput {
  /** Latest user message (already extracted from TurnContext.messages). */
  user_message: string;
  /** Optional — when present, the classify call records its model_resolution
   *  to turn-debug. Plumbed-but-unreachable in Phase 1 (TurnExecutor uses
   *  routeWithToolUse instead), so the field is optional until Phase 2 wires
   *  it through. */
  session_id?: string;
  request_id: string;
  /** Inner narrate-mode budget in ms. Classifier shares this window
   *  independently of the downstream narrate call. */
  budget_ms: number;
}

export interface ClassifyTurnOpts {
  /** External AbortSignal — TurnExecutor passes its wall-clock budget signal. */
  signal?: AbortSignal;
}

export type ClassifyTurnResult =
  | { turn_class: Exclude<C1TurnClass, 'handler'>; handler_id?: never }
  | { turn_class: 'handler'; handler_id: V5ActionType };

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
  // Group 3 Task C: route through the full precedence chain. Prior to the
  // fix this site called `getAdapter('turn_classifier')`, which is NOT a
  // valid CeeTask member and therefore short-circuited to llm_model_fallback.
  // We now use `clarification` — the fast-tier CeeTask task (gpt-4.1) — as
  // the nearest fit for JSON-mode classification. Paul should confirm this
  // mapping if classify is ever wired back into the live path; for now the
  // site remains unreachable from V5 Phase 1 (routeWithToolUse replaced it),
  // so this correction is a forward-fix.
  const { adapter, resolution } = getAdapterWithResolution('clarification');
  if (input.session_id) {
    recordModelResolution(input.request_id, input.session_id, resolution);
  }

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

  // Structural OK (including biconditional). Semantic checks:
  // 1. turn_class is in C1TurnClass. Unsupported → UNHANDLED P0.
  if (!isC1TurnClass(validated.data.turn_class)) {
    throw new UnhandledTurnClassError('unhandled_turn_class', validated.data.turn_class);
  }

  // 2. If handler class, handler_id is a valid V5ActionType. The biconditional
  //    refinement guarantees handler_id is present when we reach here; validate
  //    its value against the canonical schema (keeps this in sync with any
  //    future additions to V5ActionType in @talchain/schemas).
  if (validated.data.turn_class === 'handler') {
    const handlerIdResult = V5ActionTypeSchema.safeParse(validated.data.handler_id);
    if (!handlerIdResult.success) {
      throw new UnhandledTurnClassError(
        'missing_handler_id',
        validated.data.handler_id ?? '<unset>',
      );
    }
    return { turn_class: 'handler', handler_id: handlerIdResult.data };
  }

  // 3. Non-handler class (direct_answer / clarify): no handler_id carried.
  return { turn_class: validated.data.turn_class };
}

function isAbortLikeError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const e = error as { name?: string; code?: string };
  return e.name === 'AbortError' || e.code === 'ABORT_ERR';
}
