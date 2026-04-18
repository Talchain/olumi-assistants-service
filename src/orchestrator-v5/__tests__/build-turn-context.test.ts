import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TurnContextSchema } from '@talchain/schemas/orchestrator';
import { buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';

const BASE = {
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'hello',
  turn_class: 'frame' as const,
  stage: 'frame' as const,
};

// Slice B: buildTurnContext is async + reads from SessionStore. These legacy
// tests focus on the shape of the base TurnContext — inject a noop store so
// they don't touch real Supabase. The prior_turns field is covered by
// Slice-B-specific tests elsewhere.
const OPTS = { sessionStore: createNoopSessionStore() };

describe('buildTurnContext', () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    delete process.env.TURN_BUDGET_MS;
    delete process.env.LLM_BUDGET_NARRATE_MS;
  });
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('produces a TurnContextSchema-valid context from a valid payload', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    // EnrichedTurnContext is a superset; strip the Slice-B extension before
    // asserting schema parse (TurnContextSchema is strict).
    const { prior_turns: _pt, ...base } = ctx;
    const parsed = TurnContextSchema.parse(base);
    expect(parsed.stage).toBe('frame');
    expect(parsed.session_id).toBe(BASE.scenario_id);
    expect(parsed.request_id).toBe('req-1');
    expect(parsed.messages).toEqual([{ role: 'user', content: 'hello' }]);
  });

  it('all capabilities are false in A1 (zero handlers invariant)', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    for (const value of Object.values(ctx.capabilities)) {
      expect(value).toBe(false);
    }
  });

  it('entity_registry is a skeleton (empty options, null goal)', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    expect(ctx.entity_registry).toEqual({ option_ids: [], goal_id: null });
  });

  it('uses default budgets when env vars are absent', async () => {
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    expect(ctx.budgets.turn_ms).toBe(180_000);
    expect(ctx.budgets.llm_narrate_ms).toBe(60_000);
  });

  it('honours env overrides for budgets', async () => {
    process.env.TURN_BUDGET_MS = '12345';
    process.env.LLM_BUDGET_NARRATE_MS = '6789';
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    expect(ctx.budgets.turn_ms).toBe(12345);
    expect(ctx.budgets.llm_narrate_ms).toBe(6789);
  });

  it('falls back to defaults if env values are invalid', async () => {
    process.env.TURN_BUDGET_MS = 'not-a-number';
    process.env.LLM_BUDGET_NARRATE_MS = '-1';
    const ctx = await buildTurnContext(BASE, 'req-1', OPTS);
    expect(ctx.budgets.turn_ms).toBe(180_000);
    expect(ctx.budgets.llm_narrate_ms).toBe(60_000);
  });
});
