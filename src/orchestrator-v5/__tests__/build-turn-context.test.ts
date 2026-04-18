import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TurnContextSchema, type SessionTurn } from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../utils/telemetry.js';
import { buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SessionReadError } from '../session/store.js';

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

// ---------------------------------------------------------------------------
// Slice B additions — prior_turns + graceful degradation
// ---------------------------------------------------------------------------

function makeSessionTurn(turnId: string, createdAt: string): SessionTurn {
  return {
    id: `row-${turnId}`,
    scenario_id: BASE.scenario_id,
    user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_id: turnId,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:${turnId}`,
    response_emitted: true,
    llm_calls_used: 2,
    duration_ms: 123,
    created_at: createdAt,
  };
}

describe('buildTurnContext slice B — prior_turns population', () => {
  const prevEnv = { ...process.env };
  beforeEach(() => {
    process.env.VITEST = 'true';
  });
  afterEach(() => {
    process.env = { ...prevEnv };
    setTestSink(null);
  });

  it('populates prior_turns from sessionStore.readRecent', async () => {
    const priorTurns = [
      makeSessionTurn('t2', '2026-04-17T11:00:00.000+00:00'),
      makeSessionTurn('t1', '2026-04-17T10:00:00.000+00:00'),
    ];
    const store = createNoopSessionStore({ priorTurns });
    const ctx = await buildTurnContext(BASE, 'req-1', { sessionStore: store });
    expect(ctx.prior_turns).toHaveLength(2);
    expect(ctx.prior_turns[0].turn_id).toBe('t2');
  });

  it('returns empty prior_turns when readRecent throws (graceful degradation)', async () => {
    const boom = new SessionReadError('DB offline', { code: '57P03' });
    const store = createNoopSessionStore({ throwOnRead: boom });
    const ctx = await buildTurnContext(BASE, 'req-1', { sessionStore: store });
    expect(ctx.prior_turns).toEqual([]);
  });

  it('emits session.read_degraded telemetry with error_code + severity=warning on read failure', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      throwOnRead: new SessionReadError('RPC down', { code: '53300' }),
    });
    await buildTurnContext(BASE, 'req-1', { sessionStore: store });
    const event = events.find((e) => e.name === 'session.read_degraded');
    expect(event).toBeDefined();
    expect(event!.data).toMatchObject({
      request_id: 'req-1',
      scenario_id: BASE.scenario_id,
      error_code: '53300',
      severity: 'warning',
    });
  });

  it('emits read_degraded with error_code=unknown when the error has no code', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));
    const store = createNoopSessionStore({
      throwOnRead: new Error('something plain'),
    });
    await buildTurnContext(BASE, 'req-1', { sessionStore: store });
    const event = events.find((e) => e.name === 'session.read_degraded');
    expect(event!.data.error_code).toBe('unknown');
  });
});
