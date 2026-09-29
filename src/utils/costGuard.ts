import { calculateCost } from "./telemetry.js";
import { config } from "../config/index.js";

export function estimateTokens(chars: number): number {
  return Math.ceil(chars / 4);
}

/**
 * Get cost cap from centralized config (deferred for testability)
 */
function getCostCap(): number {
  return config.graph.costMaxUsd;
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
  const cap = getCostCap();
  return Number.isFinite(cost) && cost <= cap;
}
