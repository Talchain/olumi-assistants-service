/**
 * V5 Group 1 Task C: type-level distinction between a handler outcome that
 * was produced by a successful execution vs one that never happened
 * (handlers throw on failure). Structurally identical to HandlerOutcome
 * from registry.ts; the brand is a nominal guard so Step 5 cannot be
 * called on a failed handler's (non-existent) outcome by accident.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

export interface SuccessfulHandlerOutcome {
  readonly assistant_text: string;
  readonly handler_facts: readonly HandlerFact[];
  readonly llm_calls_used: number;
}
