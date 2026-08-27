import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  SCENARIO_ANALYSIS_FACT_CAP,
  SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
  reconcileScenarioAnalysisFacts,
  type DurableScenarioAnalysisFactRead,
} from '../reconcile-scenario-analysis-facts.js';
import {
  selectDegradedRunAnalysisFact,
  selectRunAnalysisFact,
} from '../freshness.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const FOREIGN_SCENARIO = '22222222-2222-4222-8222-222222222222';

function analysisFact(
  label: string,
  options: {
    readonly scenarioId?: string;
    readonly status?: string;
    readonly computedAt?: string | null;
    readonly noop?: boolean;
  } = {},
): HandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (options.status !== undefined) {
    enrichment.analysis_status = options.status;
  }
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: options.noop ?? false,
    result: {
      scenario_id: options.scenarioId ?? SCENARIO,
      leading_option_id: `option-${label}`,
      summary: `Analysis ${label}`,
      enrichment,
      ...(options.computedAt !== null
        ? {
            computed_at:
              options.computedAt ?? '2026-08-27T12:00:00.000Z',
          }
        : {}),
    },
  };
}

function nonAnalysisFact(): HandlerFact {
  return {
    fact_type: 'explain_results',
    fact_version: 1,
    noop: true,
    result: { precondition_unmet: false, option_count: 2 },
  };
}

function durable(
  facts: readonly unknown[],
  totalCount = facts.length,
  overrides: Partial<
    Extract<DurableScenarioAnalysisFactRead, { readonly status: 'ok' }>
  > = {},
): DurableScenarioAnalysisFactRead {
  return {
    status: 'ok',
    scenario_id: SCENARIO,
    query_limit: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
    total_count: totalCount,
    facts,
    ...overrides,
  };
}

function reconcile(
  overrides: Partial<Parameters<typeof reconcileScenarioAnalysisFacts>[0]> = {},
) {
  return reconcileScenarioAnalysisFacts({
    scenarioId: SCENARIO,
    hotWindowFacts: [],
    durableRead: durable([]),
    ...overrides,
  });
}

describe('reconcileScenarioAnalysisFacts', () => {
  it('makes complete + empty the only authoritative never-analysed state', () => {
    expect(reconcile()).toEqual({
      status: 'complete',
      source: 'scenario',
      facts: [],
      total_count: 0,
    });
  });

  it('uses the complete durable scenario set and does not merge hot overlap', () => {
    const current = analysisFact('current');
    const prior = analysisFact('prior', {
      computedAt: '2026-08-26T12:00:00.000Z',
    });

    const result = reconcile({
      hotWindowFacts: [current],
      durableRead: durable([current, prior]),
    });

    expect(result).toEqual({
      status: 'complete',
      source: 'scenario',
      facts: [current, prior],
      total_count: 2,
    });
  });

  it('retains genuinely distinct byte-identical durable facts', () => {
    const fact = analysisFact('same');
    const result = reconcile({ durableRead: durable([fact, fact]) });

    expect(result.status).toBe('complete');
    expect(result.facts).toEqual([fact, fact]);
    expect(result.facts).toHaveLength(2);
  });

  it('keeps exactly 20 durable facts complete', () => {
    const facts = Array.from({ length: SCENARIO_ANALYSIS_FACT_CAP }, (_, index) =>
      analysisFact(`fact-${index}`),
    );

    expect(reconcile({ durableRead: durable(facts) })).toMatchObject({
      status: 'complete',
      source: 'scenario',
      facts,
      total_count: SCENARIO_ANALYSIS_FACT_CAP,
    });
  });

  it('calls a validated 21-row lookahead capped and exposes no selectable prefix', () => {
    const facts = Array.from(
      { length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT },
      (_, index) => analysisFact(`fact-${index}`),
    );
    const result = reconcile({ durableRead: durable(facts, 37) });

    expect(result).toEqual({ status: 'capped', facts: [], total_count: 37 });
    expect(selectRunAnalysisFact(result.facts)).toBeNull();
    expect(selectDegradedRunAnalysisFact(result.facts)).toBeNull();
  });

  it.each([
    {
      name: 'underfilled complete page',
      read: durable([analysisFact('one')], 2),
    },
    {
      name: 'underfilled capped page',
      read: durable(
        Array.from({ length: SCENARIO_ANALYSIS_FACT_CAP }, (_, index) =>
          analysisFact(`fact-${index}`),
        ),
        21,
      ),
    },
    {
      name: 'overfilled page',
      read: durable(
        Array.from(
          { length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT + 1 },
          (_, index) => analysisFact(`fact-${index}`),
        ),
        22,
      ),
    },
    {
      name: 'wrong query limit',
      read: durable([], 0, { query_limit: SCENARIO_ANALYSIS_FACT_CAP }),
    },
    {
      name: 'wrong scenario',
      read: durable([], 0, { scenario_id: FOREIGN_SCENARIO }),
    },
    {
      name: 'invalid exact count',
      read: durable([], Number.NaN),
    },
  ])('degrades a $name instead of inferring completeness', ({ read }) => {
    expect(reconcile({ durableRead: read })).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
  });

  it.each([
    ['malformed strict payload', { fact_type: 'run_analysis', noop: false }],
    ['foreign result scenario', analysisFact('foreign', { scenarioId: FOREIGN_SCENARIO })],
    ['noop analysis', analysisFact('noop', { noop: true })],
    ['wrong fact type', nonAnalysisFact()],
  ])('fails weak for a durable %s', (_name, candidate) => {
    expect(reconcile({ durableRead: durable([candidate]) })).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
  });

  it('degrades a clean durable zero that contradicts a known hot analysis fact', () => {
    expect(
      reconcile({
        hotWindowFacts: [analysisFact('known-hot')],
        durableRead: durable([]),
      }),
    ).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'snapshot_conflict',
      total_count: 0,
    });
  });

  it('degrades when a newer hot fact is absent from a nonempty durable snapshot', () => {
    const durableOlder = analysisFact('durable-older', {
      computedAt: '2026-08-26T12:00:00.000Z',
    });
    const hotNewer = analysisFact('hot-newer', {
      computedAt: '2026-08-27T12:00:00.000Z',
    });

    expect(
      reconcile({
        hotWindowFacts: [hotNewer, durableOlder],
        durableRead: durable([durableOlder]),
      }),
    ).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'snapshot_conflict',
      total_count: 1,
    });
  });

  it('uses multiset inclusion without deduplicating distinct identical durable facts', () => {
    const identical = analysisFact('identical');
    const result = reconcile({
      hotWindowFacts: [identical, identical],
      durableRead: durable([identical, identical]),
    });
    expect(result.status).toBe('complete');
    expect(result.facts).toHaveLength(2);

    expect(
      reconcile({
        hotWindowFacts: [identical, identical],
        durableRead: durable([identical]),
      }),
    ).toMatchObject({
      status: 'degraded',
      reason: 'snapshot_conflict',
    });
  });

  it('matches logically identical nested JSON regardless of object key order', () => {
    const durableFact = analysisFact('ordered') as HandlerFact & {
      result: Record<string, unknown>;
    };
    const hotFact = analysisFact('ordered') as HandlerFact & {
      result: Record<string, unknown>;
    };
    durableFact.result.enrichment = {
      analysis_status: 'computed',
      nested: { alpha: 1, beta: 2 },
    };
    hotFact.result.enrichment = {
      nested: { beta: 2, alpha: 1 },
      analysis_status: 'computed',
    };

    expect(
      reconcile({
        hotWindowFacts: [hotFact],
        durableRead: durable([durableFact]),
      }),
    ).toMatchObject({ status: 'complete', source: 'scenario' });
  });

  it.each(['bigint', 'cycle'])('fails weak on non-JSON %s evidence', (kind) => {
    const fact = analysisFact(`non-json-${kind}`) as HandlerFact & {
      result: Record<string, unknown>;
    };
    const impossible: Record<string, unknown> = {};
    if (kind === 'bigint') impossible.value = BigInt(1);
    else impossible.self = impossible;
    fact.result.enrichment = impossible;

    expect(reconcile({ durableRead: durable([fact]) })).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
  });

  it('never promotes a hot window when the durable read is unavailable', () => {
    expect(
      reconcile({
        hotWindowFacts: [analysisFact('known')],
        durableRead: { status: 'degraded', reason: 'unavailable' },
      }),
    ).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_unavailable',
    });
  });

  it('does not recover a contract-invalid durable read from a complete hot window', () => {
    expect(
      reconcile({
        hotWindowFacts: [analysisFact('known')],
        durableRead: { status: 'degraded', reason: 'contract_invalid' },
      }),
    ).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
  });

  it('fails weak when a hot row claims malformed, foreign, or noop analysis', () => {
    for (const candidate of [
      { fact_type: 'run_analysis', noop: false },
      analysisFact('foreign', { scenarioId: FOREIGN_SCENARIO }),
      analysisFact('noop', { noop: true }),
    ]) {
      expect(
        reconcile({
          hotWindowFacts: [candidate],
          durableRead: durable([]),
        }),
      ).toEqual({
        status: 'degraded',
        facts: [],
        reason: 'hot_window_contract_invalid',
        total_count: 0,
      });
    }
  });

  it('does not make an unrelated malformed hot row part of analysis policy', () => {
    const fact = analysisFact('known');
    expect(
      reconcile({
        hotWindowFacts: [{ fact_type: 'future_non_analysis_fact' }, fact],
        durableRead: durable([fact]),
      }),
    ).toEqual({
      status: 'complete',
      source: 'scenario',
      facts: [fact],
      total_count: 1,
    });
  });

  it('preserves the existing selector chronology instead of sorting by database position', () => {
    const databaseFirstButOlderComputed = analysisFact('older-computed', {
      status: 'computed',
      computedAt: '2026-08-26T12:00:00.000Z',
    });
    const databaseSecondButNewerComputed = analysisFact('newer-computed', {
      status: 'completed',
      computedAt: '2026-08-27T12:00:00.000Z',
    });
    const degradedNewest = analysisFact('newest-failed', {
      status: 'failed',
      computedAt: '2026-08-28T12:00:00.000Z',
    });
    const facts = [
      databaseFirstButOlderComputed,
      databaseSecondButNewerComputed,
      degradedNewest,
    ];
    const result = reconcile({ durableRead: durable(facts) });

    expect(result.status).toBe('complete');
    expect(selectRunAnalysisFact(result.facts)?.fact).toEqual(
      databaseSecondButNewerComputed,
    );
    expect(selectDegradedRunAnalysisFact(result.facts)?.fact).toEqual(
      degradedNewest,
    );
  });

  it('preserves durable insertion order for equal or absent computed timestamps', () => {
    const firstEqual = analysisFact('first-equal', { status: 'computed' });
    const secondEqual = analysisFact('second-equal', { status: 'completed' });
    const absentTimestamp = analysisFact('absent', {
      status: 'computed',
      computedAt: null,
    });
    const result = reconcile({
      durableRead: durable([firstEqual, secondEqual, absentTimestamp]),
    });

    expect(selectRunAnalysisFact(result.facts)?.fact).toEqual(firstEqual);
  });
});
