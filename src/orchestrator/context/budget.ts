/**
 * Token Budget Calculator
 *
 * Budget allocation:
 * - System prompt + tools: ~20%
 * - Graph: ~25%
 * - Analysis: ~15%
 * - Conversation: ~30%
 * - Buffer: ~10%
 *
 * Heuristic: 4 chars per token (sufficient for PoC).
 */

import type { TokenBudget } from "./types.js";

// ============================================================================
// Constants
// ============================================================================

/** Default context window for Claude models */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Characters per token heuristic */
const CHARS_PER_TOKEN = 4;

/** Budget allocation percentages */
const BUDGET_ALLOCATION = {
  system_prompt: 0.10,
  tools: 0.10,
  graph: 0.25,
  analysis: 0.15,
  conversation: 0.30,
  buffer: 0.10,
} as const;

// ============================================================================
// Budget Calculation
// ============================================================================

/**
 * Calculate token budget allocation.
 *
 * @param contextWindowTokens - Total context window in tokens (default: 200K)
 * @returns Token budget with allocations for each section
 */
export function calculateTokenBudget(
  contextWindowTokens: number = DEFAULT_CONTEXT_WINDOW,
): TokenBudget {
  return {
    total: contextWindowTokens,
    system_prompt: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.system_prompt),
    tools: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.tools),
    graph: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.graph),
    analysis: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.analysis),
    conversation: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.conversation),
    buffer: Math.floor(contextWindowTokens * BUDGET_ALLOCATION.buffer),
  };
}

/**
 * Estimate token count from a string using character heuristic.
 * ~4 characters per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Check if a string fits within a token budget.
 */
export function fitsInBudget(text: string, budgetTokens: number): boolean {
  return estimateTokens(text) <= budgetTokens;
}
