/**
 * V5 TurnExecutor dispatch (A2).
 *
 * A1 dispatched `direct_answer` exclusively. A2 adds `clarify`: every turn is
 * first classified by an LLM call against the `turn_classifier` prompt, then
 * branched into the matching handler. `UnhandledTurnClassError` still fires
 * for any turn class outside the `A2TurnClass` union — this is a P0 alert,
 * not a user-visible failure (addendum §2.1.5).
 *
 * Order of operations (A2):
 *   1. Extract latest user message from TurnContext.
 *   2. classifyTurn(...) → A2TurnClass
 *   3. Branch:
 *        direct_answer → inline handler (narrate against direct_answer_narrate)
 *        clarify       → delegated to `dispatchClarify` in ./clarify.js
 *   4. Sanitise narrate output (shared).
 *   5. Return { turn_class, sanitised, llm_calls_used, raw_text_length }.
 *
 * `llm_calls_used` = 2 on success (classifier + narrate). See budgets.ts for
 * the budget-independence semantics — each LLM call gets a fresh
 * LLM_BUDGET_NARRATE_MS window, bounded by the outer TURN_BUDGET_MS.
 */

import type { TurnContext } from '@talchain/schemas/orchestrator';
import type { TurnClassType } from '@talchain/schemas/boundary';

import {
  invokeNarrate,
  NarrateEmptyOutputError,
} from './llm-adapter.js';
import { getSystemPrompt } from '../adapters/llm/prompt-loader.js';
import { sanitiseNarrateOutput, type SanitiseResult } from './sanitise.js';
import { classifyTurn } from './classify.js';
import { dispatchClarify } from './clarify.js';
import type { A2TurnClass } from './types.js';

export interface DispatchResult {
  turn_class: A2TurnClass;
  sanitised: SanitiseResult;
  llm_calls_used: number; // 2 on success (classify + narrate)
  raw_text_length: number;
}

export class UnhandledTurnClassError extends Error {
  readonly reason: 'unhandled_turn_class' = 'unhandled_turn_class';
  constructor(attempted: string) {
    super(`Unhandled turn class for A2: "${attempted}". A2 implements direct_answer + clarify only.`);
    this.name = 'UnhandledTurnClassError';
  }
}

export interface DispatchOpts {
  signal?: AbortSignal;
}

/**
 * Classify the turn, then dispatch to the matching handler. Returns a single
 * uniform DispatchResult regardless of branch taken. Throws:
 *   - NarrateTimeoutError          (upstream timeout on classify OR narrate)
 *   - ClassifierSchemaViolationError (classifier returned unparseable output)
 *   - NarrateEmptyOutputError      (narrate returned nothing)
 *   - UnhandledTurnClassError      (classifier returned an out-of-union class)
 *   - any other Error              → TurnExecutor maps to UNHANDLED
 *
 * Preserves the classified turn_class on post-classify errors via the
 * `onClassified` callback so TurnExecutor telemetry can report the resolved
 * class even when the narrate handler throws.
 */
export async function dispatch(
  context: TurnContext,
  opts?: DispatchOpts & { onClassified?: (turnClass: A2TurnClass) => void },
): Promise<DispatchResult> {
  const userMessage = findLatestUserMessage(context);

  const { turn_class } = await classifyTurn(
    {
      user_message: userMessage,
      request_id: context.request_id,
      budget_ms: context.budgets.llm_narrate_ms,
    },
    { signal: opts?.signal },
  );
  opts?.onClassified?.(turn_class);

  if (turn_class === 'direct_answer') {
    const answered = await dispatchDirectAnswer(context, opts);
    return {
      turn_class: 'direct_answer',
      sanitised: answered.sanitised,
      llm_calls_used: 1 + answered.llm_calls_used, // classifier + narrate
      raw_text_length: answered.raw_text_length,
    };
  }
  if (turn_class === 'clarify') {
    const clarified = await dispatchClarify(context, opts);
    return {
      turn_class: 'clarify',
      sanitised: clarified.sanitised,
      llm_calls_used: 1 + clarified.llm_calls_used, // classifier + narrate
      raw_text_length: clarified.raw_text_length,
    };
  }

  // Defensive: classifier schema narrows to the A2TurnClass union, so this
  // branch is type-unreachable. Kept as a runtime tripwire in case the schema
  // is ever widened without updating this switch.
  throw new UnhandledTurnClassError(turn_class as unknown as TurnClassType);
}

interface HandlerResult {
  sanitised: SanitiseResult;
  llm_calls_used: 1; // handler-internal: just the narrate call
  raw_text_length: number;
}

/**
 * A2 direct_answer handler. Kept inline in dispatch.ts so the A1 implementation
 * shape is preserved; clarify lives in its own module (see ./clarify.js) since
 * later slices will extend it with MCQ / follow-up state independently.
 *
 * Reports its own narrate count only (1). The dispatcher adds +1 for the
 * pre-narrate classifier call.
 */
async function dispatchDirectAnswer(
  context: TurnContext,
  opts?: DispatchOpts,
): Promise<HandlerResult> {
  const system = await getSystemPrompt('direct_answer_narrate');
  const userMessage = findLatestUserMessage(context);

  const response = await invokeNarrate(
    {
      system,
      user_message: userMessage,
      request_id: context.request_id,
      budget_ms: context.budgets.llm_narrate_ms,
      temperature: 0,
    },
    { signal: opts?.signal },
  );

  const sanitised = sanitiseNarrateOutput(response.text);
  if (sanitised.output.length === 0) {
    throw new NarrateEmptyOutputError();
  }

  return {
    sanitised,
    llm_calls_used: 1,
    raw_text_length: response.text.length,
  };
}

function findLatestUserMessage(context: TurnContext): string {
  for (let i = context.messages.length - 1; i >= 0; i--) {
    const msg = context.messages[i];
    if (msg && msg.role === 'user') return msg.content;
  }
  throw new Error('TurnContext has no user message — invariant violation');
}
