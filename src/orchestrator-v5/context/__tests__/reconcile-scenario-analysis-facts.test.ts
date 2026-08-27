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
      newest_fact: null,
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
      newest_fact: current,
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

    expect(result).toEqual({
      status: 'capped',
      facts: [],
      total_count: 37,
      newest_fact: facts[0],
    });
    expect(selectRunAnalysisFact(result.facts)).toBeNull();
    expect(selectDegradedRunAnalysisFact(result.facts)).toBeNull();
  });

  it('degrades when any eligible hot fact is absent from the capped page', () => {
    const prefix = Array.from(
      { length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT },
      (_, index) => analysisFact(`fact-${index}`),
    );
    const belowPrefix = analysisFact('fact-21');
    expect(
      reconcile({
        hotWindowFacts: [belowPrefix],
        durableRead: durable(prefix, 22),
      }),
    ).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'snapshot_conflict',
      total_count: 22,
    });
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

  it.each(['bigint', 'cycle', 'undefined', 'function'])('fails weak on non-JSON %s evidence', (kind) => {
    const fact = analysisFact(`non-json-${kind}`) as HandlerFact & {
      result: Record<string, unknown>;
    };
    const impossible: Record<string, unknown> = {};
    if (kind === 'bigint') impossible.value = BigInt(1);
    else if (kind === 'cycle') impossible.self = impossible;
    else if (kind === 'undefined') impossible.value = undefined;
    else impossible.value = () => 'not-json';
    fact.result.enrichment = impossible;

    expect(reconcile({ durableRead: durable([fact]) })).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
  });

  it('treats nested array order as meaningful in snapshot reconciliation', () => {
    const durableFact = analysisFact('array-order') as HandlerFact & {
      result: Record<string, unknown>;
    };
    const hotFact = analysisFact('array-order') as HandlerFact & {
      result: Record<string, unknown>;
    };
    durableFact.result.enrichment = {
      analysis_status: 'computed',
      evidence: ['first', 'second'],
    };
    hotFact.result.enrichment = {
      analysis_status: 'computed',
      evidence: ['second', 'first'],
    };

    expect(
      reconcile({
        hotWindowFacts: [hotFact],
        durableRead: durable([durableFact]),
      }),
    ).toMatchObject({ status: 'degraded', reason: 'snapshot_conflict' });
  });

  it('rejects a sparse array whose custom key disguises the missing index', () => {
    const fact = analysisFact('sparse-array') as HandlerFact & {
      result: Record<string, unknown>;
    };
    const disguised = new Array<unknown>(2);
    disguised[0] = 'present';
    (disguised as unknown as Record<string, unknown>).custom = null;
    fact.result.enrichment = {
      analysis_status: 'computed',
      evidence: disguised,
    };

    expect(reconcile({ durableRead: durable([fact]) })).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
  });

  it.each(['fact getter', 'nested getter', 'toJSON', 'proxy']) (
    'degrades hostile %s evidence without throwing',
    (kind) => {
      let candidate: unknown = analysisFact(`hostile-${kind}`);
      if (kind === 'fact getter') {
        Object.defineProperty(candidate, 'fact_type', {
          enumerable: true,
          get: () => {
            throw new Error('fact_type trap');
          },
        });
      } else if (kind === 'nested getter') {
        const fact = candidate as HandlerFact & { result: Record<string, unknown> };
        Object.defineProperty(fact.result, 'scenario_id', {
          enumerable: true,
          get: () => {
            throw new Error('scenario trap');
          },
        });
      } else if (kind === 'toJSON') {
        (candidate as HandlerFact & { toJSON?: unknown }).toJSON = () => ({ forged: true });
      } else {
        candidate = new Proxy(candidate as object, {
          ownKeys: () => {
            throw new Error('proxy trap');
          },
        });
      }

      expect(() => reconcile({ durableRead: durable([candidate]) })).not.toThrow();
      expect(reconcile({ durableRead: durable([candidate]) })).toEqual({
        status: 'degraded',
        facts: [],
        reason: 'durable_contract_invalid',
      });
      expect(() =>
        reconcile({ hotWindowFacts: [candidate], durableRead: durable([]) }),
      ).not.toThrow();
      expect(
        reconcile({ hotWindowFacts: [candidate], durableRead: durable([]) }),
      ).toMatchObject({
        status: 'degraded',
        reason: 'hot_window_contract_invalid',
      });
    },
  );

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

  it('fails weak when a hot row claims malformed or foreign analysis', () => {
    for (const candidate of [
      { fact_type: 'run_analysis', noop: false },
      analysisFact('foreign', { scenarioId: FOREIGN_SCENARIO }),
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

  it('ignores a valid hot noop because it carries no analysis claim', () => {
    expect(
      reconcile({
        hotWindowFacts: [analysisFact('noop', { noop: true })],
        durableRead: durable([]),
      }),
    ).toEqual({
      status: 'complete',
      source: 'scenario',
      facts: [],
      total_count: 0,
      newest_fact: null,
    });
  });

  it.each([
    ['unparseable computed_at', { computed_at: 'not-a-date' }],
    ['blank graph hash', { graph_hash_at_run: '  ' }],
    ['blank analysis status', { enrichment: { analysis_status: '  ' } }],
  ])('fails weak when a present producer selector field is %s', (_name, patch) => {
    const fact = analysisFact('malformed-selector') as HandlerFact & {
      result: Record<string, unknown>;
    };
    Object.assign(fact.result, patch);
    expect(reconcile({ durableRead: durable([fact]) })).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
  });

  it('accepts legacy absence of every producer selector field', () => {
    const legacy = analysisFact('legacy', { computedAt: null }) as HandlerFact & {
      result: Record<string, unknown>;
    };
    delete legacy.result.enrichment;
    expect(reconcile({ durableRead: durable([legacy]) })).toMatchObject({
      status: 'complete',
      newest_fact: legacy,
    });
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
      newest_fact: fact,
    });
  });

  it.each(['bigint', 'function', 'nested accessor'])(
    'ignores unrelated hot %s payloads without broadening analysis policy',
    (kind) => {
      const unrelated: Record<string, unknown> = {
        fact_type: 'future_non_analysis_fact',
      };
      if (kind === 'bigint') unrelated.payload = { value: BigInt(1) };
      else if (kind === 'function') unrelated.payload = { value: () => 'not-json' };
      else {
        const payload: Record<string, unknown> = {};
        Object.defineProperty(payload, 'value', {
          enumerable: true,
          get: () => {
            throw new Error('unrelated nested accessor');
          },
        });
        unrelated.payload = payload;
      }
      const fact = analysisFact(`known-${kind}`);

      expect(
        reconcile({
          hotWindowFacts: [unrelated, fact],
          durableRead: durable([fact]),
        }),
      ).toMatchObject({ status: 'complete', source: 'scenario' });
    },
  );

  it('fails weak when a hot proxy cannot disclose its fact_type descriptor', () => {
    const candidate = new Proxy(
      { fact_type: 'future_non_analysis_fact' },
      {
        getOwnPropertyDescriptor: () => {
          throw new Error('fact_type descriptor trap');
        },
      },
    );

    expect(() =>
      reconcile({ hotWindowFacts: [candidate], durableRead: durable([]) }),
    ).not.toThrow();
    expect(
      reconcile({ hotWindowFacts: [candidate], durableRead: durable([]) }),
    ).toMatchObject({
      status: 'degraded',
      reason: 'hot_window_contract_invalid',
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
