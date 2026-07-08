import type { ResolvedArmModels } from "./types.ts";

/**
 * Pinned model IDs. Exact strings; the pre-flight gate records the SERVED
 * model IDs from real responses — a mismatch or failed probe blocks the arm,
 * never substitutes silently.
 */
export const DEFAULT_MODELS: ResolvedArmModels = {
  // Arm A mirrors the served draft. v0.4.x target: Claude Sonnet 5 for M1
  // (no-thinking mirror = explicit thinking:{type:"disabled"}; Sonnet 5 rejects
  // non-default temperature with a 400, so the arms send no temperature).
  A: { model: "claude-sonnet-5" },
  // Arm B: equal-compute stronger single model at high reasoning effort.
  B: { model: "claude-opus-4-8", effort: "high" },
  // Arm C: v0.4.x targets Sonnet 5 for BOTH M1 and M2 (M2 at bounded effort).
  C: { m1: "claude-sonnet-5", m2: "claude-sonnet-5" },
  // Arm D pinned per lane brief.
  D: { executor: "claude-sonnet-4-6", advisor: "claude-opus-4-8" },
};

export const DEFAULT_SEEDS = [17];
export const DEFAULT_RUN_SEED = 20260702;
