/**
 * V5 TurnExecutor dispatch (A1).
 *
 * Per Paul's constraint 1: dispatch returns `direct_answer` EXCLUSIVELY.
 * Any other turn class (including `clarify`, `propose`, `decide`, `review`)
 * is an internal invariant violation → UNHANDLED → P0 alert.
 *
 * The `TurnClass` enum in `@talchain/schemas/boundary` lists the other
 * classes as provisional placeholders. They become reachable in later slices
 * (clarification lands in A2; handlers in C+). Until then, this function is
 * the gate.
 */

import type { TurnContext } from '@talchain/schemas/orchestrator';
import type { TurnClassType } from '@talchain/schemas/boundary';

import { invokeNarrate, NarrateEmptyOutputError } from './llm-adapter.js';
import { getSystemPrompt } from '../adapters/llm/prompt-loader.js';
import { sanitiseNarrateOutput, type SanitiseResult } from './sanitise.js';
import type { A1TurnClass } from './types.js';

export interface DispatchResult {
  sanitised: SanitiseResult;
  llm_calls_used: number; // always 1 on success for A1 direct_answer
  raw_text_length: number;
}

export class UnhandledTurnClassError extends Error {
  readonly reason: 'unhandled_turn_class' = 'unhandled_turn_class';
  constructor(attempted: TurnClassType) {
    super(`Unhandled turn class for A1: "${attempted}". A1 implements direct_answer only.`);
    this.name = 'UnhandledTurnClassError';
  }
}

export interface DispatchOpts {
  signal?: AbortSignal;
}

/**
 * Dispatch to the turn-class handler. A1 only supports `direct_answer`.
 *
 * On any other class, throws UnhandledTurnClassError. TurnExecutor maps this
 * to UNHANDLED → INTERNAL_ERROR wire code + P0 telemetry.
 */
export async function dispatchDirectAnswer(
  turnClass: A1TurnClass,
  context: TurnContext,
  opts?: DispatchOpts,
): Promise<DispatchResult> {
  // A1 contract: this branch is the only one reachable.
  if (turnClass !== 'direct_answer') {
    throw new UnhandledTurnClassError(turnClass as unknown as TurnClassType);
  }

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
    // Sanitiser consumed everything — treat as empty output.
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
