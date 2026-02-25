/**
 * Context Fabric — Token Estimator
 *
 * Single implementation of token estimation for context assembly.
 * Same heuristic as ../context/budget.ts:estimateTokens (4 chars ≈ 1 token)
 * but self-contained to avoid coupling context-fabric to the old budget model.
 */

import type { TokenBudget } from "./types.js";

/** Characters per token heuristic — sufficient for English text with Claude/GPT models. */
const CHARS_PER_TOKEN = 4;

/**
 * Estimate token count from a string using a character heuristic.
 * ~4 characters per token for English text.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Check whether an estimated token count fits within a zone-based budget.
 *
 * Returns within_budget, overage (positive when over, 0 when within),
 * and per-zone percentage of the effective total.
 */
export function checkBudget(
  estimated: number,
  budget: TokenBudget,
): {
  within_budget: boolean;
  overage: number;
  zone1_pct: number;
  zone2_pct: number;
  zone3_pct: number;
} {
  const within_budget = estimated <= budget.effective_total;
  const overage = within_budget ? 0 : estimated - budget.effective_total;

  const total = budget.effective_total || 1; // avoid division by zero
  const zone1_pct = (budget.zone1 / total) * 100;
  const zone2_pct = (budget.zone2 / total) * 100;
  const zone3_pct = (budget.zone3 / total) * 100;

  return { within_budget, overage, zone1_pct, zone2_pct, zone3_pct };
}
