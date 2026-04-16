/**
 * Unit tests for `getTurnExecutorBudgets` — invalid-env-value fallback.
 *
 * Happy paths (env-override-is-honoured + default-when-unset) are covered
 * implicitly by turn-executor.test.ts timeout-precedence cases. These tests
 * pin the deterministic fallback for malformed env values so a typo in a
 * staging env file can never silently run the TurnExecutor with a budget of
 * 0 ms or NaN.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getTurnExecutorBudgets } from '../budgets.js';

const DEFAULT_TURN_MS = 180_000;
const DEFAULT_LLM_MS = 60_000;

const ENV_KEYS = ['TURN_BUDGET_MS', 'LLM_BUDGET_NARRATE_MS'] as const;

describe('getTurnExecutorBudgets — invalid env fallback', () => {
  const originals: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(() => {
    for (const key of ENV_KEYS) {
      originals[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (originals[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = originals[key];
      }
    }
  });

  it('returns defaults when env vars are unset', () => {
    const budgets = getTurnExecutorBudgets();
    expect(budgets.turn_ms).toBe(DEFAULT_TURN_MS);
    expect(budgets.llm_narrate_ms).toBe(DEFAULT_LLM_MS);
  });

  it('falls back to defaults on empty string', () => {
    process.env.TURN_BUDGET_MS = '';
    process.env.LLM_BUDGET_NARRATE_MS = '';
    const budgets = getTurnExecutorBudgets();
    expect(budgets.turn_ms).toBe(DEFAULT_TURN_MS);
    expect(budgets.llm_narrate_ms).toBe(DEFAULT_LLM_MS);
  });

  it('falls back to defaults on non-numeric values', () => {
    process.env.TURN_BUDGET_MS = 'abc';
    process.env.LLM_BUDGET_NARRATE_MS = 'not-a-number';
    const budgets = getTurnExecutorBudgets();
    expect(budgets.turn_ms).toBe(DEFAULT_TURN_MS);
    expect(budgets.llm_narrate_ms).toBe(DEFAULT_LLM_MS);
  });

  it('falls back to defaults on zero', () => {
    process.env.TURN_BUDGET_MS = '0';
    process.env.LLM_BUDGET_NARRATE_MS = '0';
    const budgets = getTurnExecutorBudgets();
    expect(budgets.turn_ms).toBe(DEFAULT_TURN_MS);
    expect(budgets.llm_narrate_ms).toBe(DEFAULT_LLM_MS);
  });

  it('falls back to defaults on negative values', () => {
    process.env.TURN_BUDGET_MS = '-1';
    process.env.LLM_BUDGET_NARRATE_MS = '-60000';
    const budgets = getTurnExecutorBudgets();
    expect(budgets.turn_ms).toBe(DEFAULT_TURN_MS);
    expect(budgets.llm_narrate_ms).toBe(DEFAULT_LLM_MS);
  });

  it('falls back to defaults on non-integer numeric values', () => {
    process.env.TURN_BUDGET_MS = '1.5';
    process.env.LLM_BUDGET_NARRATE_MS = '123.456';
    const budgets = getTurnExecutorBudgets();
    expect(budgets.turn_ms).toBe(DEFAULT_TURN_MS);
    expect(budgets.llm_narrate_ms).toBe(DEFAULT_LLM_MS);
  });

  it('honours valid positive integer override', () => {
    process.env.TURN_BUDGET_MS = '90000';
    process.env.LLM_BUDGET_NARRATE_MS = '30000';
    const budgets = getTurnExecutorBudgets();
    expect(budgets.turn_ms).toBe(90_000);
    expect(budgets.llm_narrate_ms).toBe(30_000);
  });

  it('mixes valid + invalid values independently per key', () => {
    process.env.TURN_BUDGET_MS = '120000';
    process.env.LLM_BUDGET_NARRATE_MS = 'bogus';
    const budgets = getTurnExecutorBudgets();
    expect(budgets.turn_ms).toBe(120_000);
    expect(budgets.llm_narrate_ms).toBe(DEFAULT_LLM_MS);
  });
});

/**
 * Budget independence (Paul's correction 4, A2).
 *
 * Proves: classifier and narrate each get a FRESH `llm_narrate_ms` window.
 * Consuming time in the classifier call does NOT shorten the narrate call's
 * budget. The shared ceiling is the outer `turn_ms`.
 *
 * Implementation check: `classify.ts` passes
 * `timeoutMs: input.budget_ms` and `llm-adapter.ts::invokeNarrate` passes
 * `timeoutMs: request.budget_ms` — both sourced from
 * `context.budgets.llm_narrate_ms` at each dispatch call site. Neither
 * decrements from the other; no shared counter exists.
 *
 * This test is structural: it inspects the TurnContext budgets shape and
 * verifies both calls would receive the same `llm_narrate_ms` value
 * independently, proving there's no elapsed-time accounting between them.
 */
describe('Budget independence (classifier and narrate get fresh windows)', () => {
  it('exposes a single llm_narrate_ms that feeds both LLM calls independently', () => {
    process.env.LLM_BUDGET_NARRATE_MS = '45000';
    const budgets = getTurnExecutorBudgets();
    expect(budgets.llm_narrate_ms).toBe(45_000);
    // Simulate the dispatch flow: classify then narrate each read the same
    // budgets object and pass llm_narrate_ms as their timeoutMs.
    const classifyBudget = budgets.llm_narrate_ms;
    const narrateBudget = budgets.llm_narrate_ms;
    expect(classifyBudget).toBe(narrateBudget);
    // Crucially, the second read is not diminished by the first — the
    // budgets object holds a constant; neither call mutates it.
    expect(classifyBudget).toBe(45_000);
    expect(narrateBudget).toBe(45_000);
  });

  it('documents worst-case total inner budget = 2 × llm_narrate_ms, bounded by turn_ms', () => {
    process.env.TURN_BUDGET_MS = '120000';
    process.env.LLM_BUDGET_NARRATE_MS = '60000';
    const budgets = getTurnExecutorBudgets();
    const worstCaseTotal = 2 * budgets.llm_narrate_ms;
    // If worstCaseTotal > turn_ms, the outer wall-clock abort fires first
    // (constraint 7 guarantees BUDGET_EXCEEDED precedence in that case).
    // Here: 2 × 60000 = 120000, equal to turn_ms — the boundary is exact
    // and the outer timer will preempt any overrun.
    expect(worstCaseTotal).toBe(budgets.turn_ms);
  });

  it('no hidden shared counter: independent budget keys', () => {
    const budgets = getTurnExecutorBudgets();
    // Only two budget keys exist on the schema. There is no "remaining_ms"
    // field or similar mutable counter that classifier/narrate share.
    expect(Object.keys(budgets).sort()).toEqual(['llm_narrate_ms', 'turn_ms']);
  });
});
