/**
 * Budget resolution for V5 TurnExecutor.
 *
 * Defaults come from Implementation Plan v2.2. Observed-latency values
 * (~7–22 s for direct_answer narrate turns) inform test fixture bounds, not
 * production defaults. Per Paul's constraint 5.
 *
 * Reads `process.env` on every call so env overrides at runtime (e.g. in
 * integration tests) are honoured. Binding at module load would freeze the
 * reference before tests can mutate the process env.
 *
 * Budget semantics (Paul's correction 4, A2):
 *
 *   Two LLM calls happen per turn on the happy path:
 *     1. Pre-narrate classifier (turn_classifier) → A2TurnClass
 *     2. Narrate fragment (direct_answer_narrate | clarify_narrate)
 *
 *   Each LLM call gets a FRESH `LLM_BUDGET_NARRATE_MS` window (INDEPENDENT
 *   inner budgets). The outer `TURN_BUDGET_MS` is the SHARED wall-clock
 *   ceiling that bounds the entire turn.
 *
 *   Worst-case total LLM wall-clock time = 2 × LLM_BUDGET_NARRATE_MS,
 *   hard-bounded by TURN_BUDGET_MS. If the outer budget trips mid-call, Paul's
 *   constraint 7 ensures the response classifies as TURN_BUDGET_EXCEEDED
 *   (not UPSTREAM_TIMEOUT), matching the A1 precedence behaviour.
 *
 *   Unit test `__tests__/budgets.test.ts` proves budget independence: running
 *   the classifier does not consume any of the narrate call's budget window.
 */

import type { Budgets } from '@talchain/schemas/orchestrator';

const DEFAULT_TURN_BUDGET_MS = 180_000; // 3 minutes — outer bound
const DEFAULT_LLM_NARRATE_BUDGET_MS = 60_000; // 1 minute — per-LLM-call inner bound
const DEFAULT_LLM_HANDLER_BUDGET_MS = 45_000; // 45 seconds — per-handler inner bound (C1+)

function parseMs(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return fallback;
  return n;
}

export function getTurnExecutorBudgets(): Budgets {
  return {
    turn_ms: parseMs(process.env.TURN_BUDGET_MS, DEFAULT_TURN_BUDGET_MS),
    llm_narrate_ms: parseMs(process.env.LLM_BUDGET_NARRATE_MS, DEFAULT_LLM_NARRATE_BUDGET_MS),
  };
}

/**
 * Per-handler inner budget window. Each handler invocation gets a fresh
 * `LLM_BUDGET_HANDLER_MS` (independent of classifier / narrate budgets).
 * Read at call time — overrides from integration tests / Render env rotation
 * are honoured without a restart.
 *
 * Slice C1 exposes this function for registry consumers but registers zero
 * handlers; Slice C2's `run_analysis` is the first caller. The outer
 * `turn_ms` wall-clock bound continues to dominate per Paul's constraint 7
 * (BUDGET_EXCEEDED wins over LLM_TIMEOUT when both apply).
 */
export function getHandlerBudgetMs(): number {
  return parseMs(process.env.LLM_BUDGET_HANDLER_MS, DEFAULT_LLM_HANDLER_BUDGET_MS);
}
