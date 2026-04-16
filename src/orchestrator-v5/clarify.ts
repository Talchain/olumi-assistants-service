/**
 * V5 TurnExecutor — clarify turn-class handler (A2).
 *
 * One narrate-mode LLM call over the `clarify_narrate` prompt fragment, plus
 * the shared sanitiser pass. Parallel to the inline direct_answer handler in
 * `dispatch.ts`; separated into its own module so later slices can extend
 * clarify behaviour (e.g. MCQ output, follow-up state) without touching the
 * dispatcher.
 *
 * Reuses `invokeNarrate` — same failure mapping as direct_answer:
 *   - Upstream timeout / caller abort → NarrateTimeoutError → LLM_TIMEOUT
 *   - Empty output → NarrateEmptyOutputError → UNHANDLED
 */

import type { TurnContext } from '@talchain/schemas/orchestrator';

import { getSystemPrompt } from '../adapters/llm/prompt-loader.js';
import {
  invokeNarrate,
  NarrateEmptyOutputError,
} from './llm-adapter.js';
import { sanitiseNarrateOutput, type SanitiseResult } from './sanitise.js';

export interface ClarifyDispatchResult {
  sanitised: SanitiseResult;
  llm_calls_used: 1;
  raw_text_length: number;
}

export interface ClarifyDispatchOpts {
  signal?: AbortSignal;
}

/**
 * Dispatch a `clarify` turn. Returns sanitised narrate output on success.
 *
 * Callers (currently `dispatch.ts`) handle failure mapping; this function
 * only propagates the typed failure classes above.
 */
export async function dispatchClarify(
  context: TurnContext,
  opts?: ClarifyDispatchOpts,
): Promise<ClarifyDispatchResult> {
  const system = await getSystemPrompt('clarify_narrate');
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
