/**
 * ⛔ THE SCENARIO-WIDE ANALYSIS-FACT READ IS BOUNDED (served 14 Oct 14:19Z, scenario b7b77ba2, Run request 8da77ad2).
 *
 * Render + Supabase edge logs: the Run's `buildTurnContext` sent `readScenarioRunAnalysisFactsFor` at ~14:19:17.4Z; it
 * never reached the database (no edge-log entry until 14:21:08Z, while the same query for other scenarios answered in
 * ~150 ms) and failed 109.8 s later, inside a Run that took 139 s. Paul's 16:18Z draft hung on the same read. On a v2 Run
 * nothing bounded it. Now a read that does not settle is cut at the read budget and takes the existing degraded path:
 * the analysis history is UNAVAILABLE, never "this scenario was never analysed".
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCENARIO_FACT_READ_BOUND_MS, buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const PAYLOAD = makeMessagePayload({ scenario_id: SCENARIO, message: 'Run the analysis.' });

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }); });
afterEach(() => { vi.useRealTimers(); });

describe('buildTurnContext: a stalled scenario analysis-fact read', () => {
  it('⭐ RED→GREEN: is cut within the read budget and reads as unavailable, never as "never analysed"', async () => {
    const store = {
      ...createNoopSessionStore(),
      // The served stall: the request never settles on its own.
      readScenarioRunAnalysisFactsFor: () => new Promise<never>(() => {}),
    };
    let context: Awaited<ReturnType<typeof buildTurnContext>> | undefined;
    const built = buildTurnContext(PAYLOAD, 'request-stalled', { sessionStore: store }).then((c) => { context = c; });
    await vi.advanceTimersByTimeAsync(SCENARIO_FACT_READ_BOUND_MS);
    await built;
    expect(context).toBeDefined();
    expect(context!.scenario_analysis_fact_set).toMatchObject({ status: 'degraded' });
    expect(context!.newest_analysis_fact_read_ok).toBe(false);
    expect(context!.persisted_analysis_freshness).not.toMatchObject({ reason: 'no_successful_run_analysis_fact' });
  });

  it('CONTRAST: a read that answers keeps the complete, authoritative set (no deadline effect)', async () => {
    const context = await buildTurnContext(PAYLOAD, 'request-fast', { sessionStore: createNoopSessionStore() });
    expect(context.scenario_analysis_fact_set).toMatchObject({ status: 'complete', facts: [], total_count: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });
});
