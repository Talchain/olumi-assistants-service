/**
 * R-003 regression: getSessionStore() factory failure must emit
 * `session.read_degraded`, not silently disable prior_turns/facts.
 *
 * Lives in a separate file because mocking `../session/index.js` at module
 * level would affect every other build-turn-context test. Here we replace
 * `getSessionStore` with a factory that throws, then call buildTurnContext
 * WITHOUT passing options.sessionStore so the production resolution path is
 * exercised.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../session/index.js', () => ({
  getSessionStore: vi.fn(() => {
    throw new Error('SUPABASE_URL is not set');
  }),
}));

import { buildTurnContext } from '../build-turn-context.js';
import { setTestSink } from '../../utils/telemetry.js';

const BASE = {
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'hello',
  turn_class: 'frame' as const,
  stage: 'frame' as const,
};

describe('buildTurnContext — getSessionStore() factory failure (R-003)', () => {
  const prevEnv = { ...process.env };
  beforeEach(() => {
    process.env.VITEST = 'true';
  });
  afterEach(() => {
    process.env = { ...prevEnv };
    setTestSink(null);
  });

  it('emits session.read_degraded when the store factory throws', async () => {
    const events: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => events.push({ name, data }));

    // No options.sessionStore → buildTurnContext invokes the (mocked) factory,
    // which throws. The fix catches the throw, emits telemetry, and returns
    // undefined so the turn proceeds with empty history.
    const ctx = await buildTurnContext(BASE, 'req-factory-throw');

    expect(ctx.prior_turns).toEqual([]);
    expect(ctx.prior_facts).toEqual([]);

    const event = events.find((e) => e.name === 'session.read_degraded');
    expect(event).toBeDefined();
    expect(event!.data).toMatchObject({
      request_id: 'req-factory-throw',
      scenario_id: BASE.scenario_id,
      error_code: 'Error',
      severity: 'warning',
    });
  });

  it('does not throw on factory failure (graceful degradation preserved)', async () => {
    await expect(buildTurnContext(BASE, 'req-no-throw')).resolves.toBeDefined();
  });
});
