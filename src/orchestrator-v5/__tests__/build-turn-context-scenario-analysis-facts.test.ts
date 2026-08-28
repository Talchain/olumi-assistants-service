import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { IdentifiedHandlerFact } from '../types/handler-fact.js';

import { buildTurnContext } from '../build-turn-context.js';
import { SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT } from '../context/reconcile-scenario-analysis-facts.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SessionReadError, type SessionStore } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const PAYLOAD = makeMessagePayload({
  scenario_id: SCENARIO,
  message: 'What does the current analysis imply?',
});

function analysisFact(
  label: string,
  computedAt = '2026-08-27T12:00:00.000Z',
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO,
      leading_option_id: `option-${label}`,
      summary: `Analysis ${label}`,
      computed_at: computedAt,
      enrichment: { analysis_status: 'computed' },
    },
  };
}

function priorTurn() {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    scenario_id: SCENARIO,
    user_id: '33333333-3333-4333-8333-333333333333',
    turn_id: '44444444-4444-4444-8444-444444444444',
    turn_class: 'handler' as const,
    handler_id: 'run_analysis' as const,
    request_hash: 'sha256:prior',
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 100,
    created_at: '2026-08-27T12:00:00.000Z',
  };
}

function identifiedAnalysisFact(
  fact: HandlerFact,
  index: number,
): IdentifiedHandlerFact {
  return {
    fact,
    fact_row_id: `scenario-analysis-row-${index}`,
    fact_created_at: new Date(
      Date.UTC(2026, 7, 27, 12, 0, 59 - index),
    ).toISOString(),
  };
}

describe('buildTurnContext — scenario analysis fact authority', () => {
  it('loads the exact lookahead and keeps scenario analysis facts distinct from ordinary prior_facts', async () => {
    const durable = analysisFact('outside-hot-window');
    const limits: number[] = [];
    let legacyNewestReadCalls = 0;
    const store = {
      ...createNoopSessionStore(),
      // The converged path must not issue this former second query even when a
      // legacy/direct store still happens to expose it.
      readNewestAnalysisFactFor: async () => {
        legacyNewestReadCalls += 1;
        return analysisFact('legacy-second-query-canary');
      },
      readScenarioRunAnalysisFactsFor: async (
        _scenarioId: string,
        limit: number,
      ) => {
        limits.push(limit);
        return { facts: [identifiedAnalysisFact(durable, 0)], total_count: 1 };
      },
    };

    const context = await buildTurnContext(PAYLOAD, 'request-complete', {
      sessionStore: store,
    });

    expect(limits).toEqual([SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT]);
    expect(legacyNewestReadCalls).toBe(0);
    expect(context.prior_facts).toEqual([]);
    expect(context.scenario_analysis_fact_set).toEqual({
      status: 'complete',
      source: 'scenario',
      facts: [durable],
      total_count: 1,
    });
    expect(context.newest_analysis_fact).toEqual(durable);
    expect(context.newest_analysis_fact_read_ok).toBe(true);
  });

  it('makes exact complete zero the only authoritative never-analysed state', async () => {
    const context = await buildTurnContext(PAYLOAD, 'request-zero', {
      sessionStore: createNoopSessionStore(),
    });

    expect(context.scenario_analysis_fact_set).toMatchObject({
      status: 'complete',
      facts: [],
      total_count: 0,
    });
    expect(context.newest_analysis_fact).toBeNull();
    expect(context.newest_analysis_fact_read_ok).toBe(true);
    expect(context.persisted_analysis_freshness).toMatchObject({
      freshness: 'none',
      reason: 'no_successful_run_analysis_fact',
    });
  });

  it('does not feed a capped durable prefix to analysis consumers', async () => {
    const facts = Array.from(
      { length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT },
      (_, index) =>
        analysisFact(
          String(index),
          new Date(Date.UTC(2026, 7, 27, 12, 0, index)).toISOString(),
        ),
    );
    const store = {
      ...createNoopSessionStore(),
      readScenarioRunAnalysisFactsFor: async () => ({
        facts: facts.map(identifiedAnalysisFact),
        total_count: 37,
      }),
    };

    const context = await buildTurnContext(PAYLOAD, 'request-capped', {
      sessionStore: store,
    });

    expect(context.scenario_analysis_fact_set).toEqual({
      status: 'capped',
      facts: [],
      total_count: 37,
    });
    expect(context.newest_analysis_fact).toEqual(facts[0]);
    expect(context.newest_analysis_fact_read_ok).toBe(true);
    expect(context.persisted_analysis_freshness).toMatchObject({
      freshness: 'unknown',
      reason: 'derivation_failed',
    });
  });

  it('fails weak when the scenario port is omitted instead of falling back to hot facts', async () => {
    const hot = analysisFact('hot-only');
    const store = createNoopSessionStore({
      priorTurns: [priorTurn()],
      facts: [hot],
    }) as SessionStore & {
      readScenarioRunAnalysisFactsFor?: SessionStore['readScenarioRunAnalysisFactsFor'];
    };
    delete store.readScenarioRunAnalysisFactsFor;
    store.readNewestAnalysisFactFor = async () => hot;

    const context = await buildTurnContext(PAYLOAD, 'request-omitted', {
      sessionStore: store,
    });

    expect(context.prior_facts).toEqual([hot]);
    expect(context.scenario_analysis_fact_set).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_unavailable',
    });
    expect(context.newest_analysis_fact).toBeNull();
    expect(context.newest_analysis_fact_read_ok).toBe(false);
    expect(context.persisted_analysis_freshness.freshness).toBe('unknown');
  });

  it('degrades a durable/hot split snapshot without merging either fact set', async () => {
    const hotNewer = analysisFact('hot-newer', '2026-08-27T13:00:00.000Z');
    const durableOlder = analysisFact('durable-older', '2026-08-27T12:00:00.000Z');
    const store = createNoopSessionStore({
      priorTurns: [priorTurn()],
      facts: [hotNewer],
      scenarioAnalysisFacts: [durableOlder],
    });

    const context = await buildTurnContext(PAYLOAD, 'request-conflict', {
      sessionStore: store,
    });

    expect(context.prior_facts).toEqual([hotNewer]);
    expect(context.scenario_analysis_fact_set).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'snapshot_conflict',
      total_count: 1,
    });
    expect(context.newest_analysis_fact).toBeNull();
    expect(context.newest_analysis_fact_read_ok).toBe(false);
    expect(context.persisted_analysis_freshness.freshness).toBe('unknown');
  });

  it('distinguishes unavailable from a malformed durable contract', async () => {
    for (const error of [
      new SessionReadError('database unavailable', {
        code: 'analysis_fact_query_failed',
      }),
      new SessionReadError('malformed row', { code: 'analysis_fact_corrupt' }),
    ]) {
      const store = createNoopSessionStore({
        throwOnScenarioAnalysisFactRead: error,
      });
      const context = await buildTurnContext(
        PAYLOAD,
        `request-${error.code}`,
        { sessionStore: store },
      );
      expect(context.scenario_analysis_fact_set).toMatchObject({
        status: 'degraded',
        facts: [],
        reason:
          error.code === 'analysis_fact_corrupt'
            ? 'durable_contract_invalid'
            : 'durable_unavailable',
      });
      expect(context.newest_analysis_fact).toBeNull();
      expect(context.newest_analysis_fact_read_ok).toBe(false);
      expect(context.persisted_analysis_freshness.freshness).toBe('unknown');
    }
  });
});
