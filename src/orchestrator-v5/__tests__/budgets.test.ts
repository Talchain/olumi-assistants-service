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
