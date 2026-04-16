import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TurnContextSchema } from '@talchain/schemas/orchestrator';
import { buildTurnContext } from '../build-turn-context.js';

const BASE = {
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'hello',
  turn_class: 'frame' as const,
  stage: 'frame' as const,
};

describe('buildTurnContext', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.TURN_BUDGET_MS;
    delete process.env.LLM_BUDGET_NARRATE_MS;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('produces a TurnContextSchema-valid context from a valid payload', () => {
    const ctx = buildTurnContext(BASE, 'req-1');
    const parsed = TurnContextSchema.parse(ctx);
    expect(parsed.stage).toBe('frame');
    expect(parsed.session_id).toBe(BASE.scenario_id);
    expect(parsed.request_id).toBe('req-1');
    expect(parsed.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('all capabilities are false in A1 (zero handlers invariant)', () => {
    const ctx = buildTurnContext(BASE, 'req-1');
    for (const value of Object.values(ctx.capabilities)) {
      expect(value).toBe(false);
    }
  });

  it('entity_registry is a skeleton (empty options, null goal)', () => {
    const ctx = buildTurnContext(BASE, 'req-1');
    expect(ctx.entity_registry).toEqual({ option_ids: [], goal_id: null });
  });

  it('uses default budgets when env vars are absent', () => {
    const ctx = buildTurnContext(BASE, 'req-1');
    expect(ctx.budgets.turn_ms).toBe(180_000);
    expect(ctx.budgets.llm_narrate_ms).toBe(60_000);
  });

  it('honours env overrides for budgets', () => {
    process.env.TURN_BUDGET_MS = '12345';
    process.env.LLM_BUDGET_NARRATE_MS = '6789';
    const ctx = buildTurnContext(BASE, 'req-1');
    expect(ctx.budgets.turn_ms).toBe(12345);
    expect(ctx.budgets.llm_narrate_ms).toBe(6789);
  });

  it('falls back to defaults if env values are invalid', () => {
    process.env.TURN_BUDGET_MS = 'not-a-number';
    process.env.LLM_BUDGET_NARRATE_MS = '-1';
    const ctx = buildTurnContext(BASE, 'req-1');
    expect(ctx.budgets.turn_ms).toBe(180_000);
    expect(ctx.budgets.llm_narrate_ms).toBe(60_000);
  });
});
