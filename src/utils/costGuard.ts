import { calculateCost } from "./telemetry.js";

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Check if estimated cost is within allowed budget.
 * Uses provider-specific pricing from telemetry.ts.
 *
 * @param tokensIn Estimated input tokens
 * @param tokensOut Estimated output tokens
 * @param model Model ID (e.g., "claude-3-5-sonnet-20241022", "gpt-4o-mini")
 * @returns true if cost is within budget, false otherwise
 */
export function allowedCostUSD(tokensIn: number, tokensOut: number, model: string): boolean {
  const cost = calculateCost(model, tokensIn, tokensOut);
  const cap = Number(process.env.COST_MAX_USD || "1.0");
  return Number.isFinite(cost) && cost <= cap;
}
