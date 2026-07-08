/**
 * Equal-compute matching — currency is USD, never token counts.
 *
 * C's two full passes and D's advisor sub-inference are different cost
 * shapes, so B is matched PER COMPARISON and PER BRIEF: run C and D first,
 * measure realized per-(brief,seed) USD spend, then run B@C and B@D with a
 * token budget derived from that USD target at B's own output price.
 *
 * PRE-DECLARED TOLERANCE: ±20% USD per comparison (COMPUTE_TOLERANCE).
 * Achieved spend is logged for every run; out-of-tolerance comparisons are
 * FLAGGED in the report — never silently accepted, never discarded.
 */
import { usdToOutputTokens } from "../llm/pricing.ts";

export const COMPUTE_TOLERANCE = 0.2;

export type BVariant = "unmatched" | "match_c" | "match_d";

export interface ComputeMatchEntry {
  comparison: "B_vs_C" | "B_vs_D";
  brief_id: string;
  seed: number;
  target_usd: number;
  achieved_usd: number;
  ratio: number | null;
  within_tolerance: boolean;
}

export function budgetTokensForTarget(targetUsd: number, bModel: string): number {
  return usdToOutputTokens(targetUsd, bModel);
}

export function assessComputeMatch(
  comparison: "B_vs_C" | "B_vs_D",
  briefId: string,
  seed: number,
  targetUsd: number,
  achievedUsd: number,
  tolerance: number = COMPUTE_TOLERANCE
): ComputeMatchEntry {
  const ratio = targetUsd > 0 ? achievedUsd / targetUsd : null;
  const within = ratio !== null && ratio >= 1 - tolerance && ratio <= 1 + tolerance;
  return {
    comparison,
    brief_id: briefId,
    seed,
    target_usd: round6(targetUsd),
    achieved_usd: round6(achievedUsd),
    ratio: ratio === null ? null : round6(ratio),
    within_tolerance: within,
  };
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;
