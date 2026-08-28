import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type {
  HandlerFactWithTurn,
  IdentifiedHandlerFact,
} from '../../types/handler-fact.js';

import {
  SCENARIO_ANALYSIS_FACT_CAP,
  SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT,
  isReconciledScenarioAnalysisFactSet,
  readScenarioAnalysisClaimSafetyFact,
  reconcileScenarioAnalysisFacts,
  type DurableScenarioAnalysisFactRead,
} from '../reconcile-scenario-analysis-facts.js';
import { readMayNameLeadingOptionVerdict } from '../claim-safety-read.js';
import { buildAnalysisFromPriorFacts } from '../analysis-fallback.js';
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

function persistedTimestamp(index: number): string {
  return `2026-08-27T12:00:${String(59 - index).padStart(2, '0')}.000Z`;
}

function identified(
  fact: unknown,
  index: number,
  overrides: Partial<IdentifiedHandlerFact> = {},
): IdentifiedHandlerFact {
  return {
    fact: fact as HandlerFact,
    fact_row_id: `analysis-row-${index}`,
    fact_created_at: persistedTimestamp(index),
    ...overrides,
  };
}

function hotIdentified(
  fact: HandlerFact,
  index: number,
  overrides: Partial<HandlerFactWithTurn> = {},
): HandlerFactWithTurn {
  return {
    ...identified(fact, index),
    turn_id: `turn-${index}`,
    ...overrides,
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
    facts: facts.map((candidate, index) =>
      candidate !== null &&
      typeof candidate === 'object' &&
      !Array.isArray(candidate) &&
      'fact' in candidate
        ? (candidate as IdentifiedHandlerFact)
        : identified(candidate, index),
    ),
    ...overrides,
  };
}

function reconcile(
  overrides: Partial<Parameters<typeof reconcileScenarioAnalysisFacts>[0]> = {},
) {
  return reconcileScenarioAnalysisFacts({
    scenarioId: SCENARIO,
    hotWindowFacts: [],
    hotWindowFactsWithIdentity: [],
    durableRead: durable([]),
    ...overrides,
  });
}

describe('reconcileScenarioAnalysisFacts', () => {
  it('nominally attests only the exact scenario-bound carrier it returns', () => {
    const fact = analysisFact('attested');
    const result = reconcile({ durableRead: durable([fact]) });
    const forged = {
      status: 'complete' as const,
      source: 'scenario' as const,
      facts: [fact],
      total_count: 1,
    };

    expect(isReconciledScenarioAnalysisFactSet(result, SCENARIO)).toBe(true);
    expect(isReconciledScenarioAnalysisFactSet(result, FOREIGN_SCENARIO)).toBe(false);
    expect(isReconciledScenarioAnalysisFactSet(forged, SCENARIO)).toBe(false);
    expect(readScenarioAnalysisClaimSafetyFact(forged, SCENARIO)).toEqual({
      fact: null,
      readOk: false,
    });
  });

  it('deep-freezes cloned output without freezing caller-owned fact bytes', () => {
    const fact = analysisFact('immutable');
    const result = reconcile({ durableRead: durable([fact]) });

    expect(result.status).toBe('complete');
    if (result.status !== 'complete') return;
    expect(result.facts[0]).not.toBe(fact);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.facts)).toBe(true);
    expect(Object.isFrozen(result.facts[0])).toBe(true);
    expect(Object.isFrozen(result.facts[0]?.result)).toBe(true);
    expect(Object.isFrozen(fact)).toBe(false);
    expect(Object.isFrozen(fact.result)).toBe(false);
  });

  it('makes complete + empty the only authoritative never-analysed state', () => {
    const result = reconcile();
    expect(result).toEqual({
      status: 'complete',
      source: 'scenario',
      facts: [],
      total_count: 0,
    });
    expect(readScenarioAnalysisClaimSafetyFact(result, SCENARIO)).toEqual({
      fact: null,
      readOk: true,
    });
  });

  it('uses the complete durable scenario set and does not merge hot overlap', () => {
    const current = analysisFact('current');
    const prior = analysisFact('prior', {
      computedAt: '2026-08-26T12:00:00.000Z',
    });

    const result = reconcile({
      hotWindowFacts: [current],
      hotWindowFactsWithIdentity: [hotIdentified(current, 0)],
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

  it('calls a validated 21-row lookahead capped and retains the newest bounded window', () => {
    const facts = Array.from(
      { length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT },
      (_, index) => analysisFact(`fact-${index}`),
    );
    const result = reconcile({ durableRead: durable(facts, 37) });

    // The cap is a WALL on how much history may be reasoned over, not an
    // instruction to forget. A capped set carries the newest CAP facts and
    // discloses the wall through `status`; it never claims completeness.
    expect(result).toEqual({
      status: 'capped',
      facts: facts.slice(0, SCENARIO_ANALYSIS_FACT_CAP),
      total_count: 37,
    });
    expect(result.facts).toHaveLength(SCENARIO_ANALYSIS_FACT_CAP);
    expect(selectRunAnalysisFact(result.facts)?.fact).toEqual(facts[0]);
    // These fixtures carry NO analysis_status, which is the legacy-SUCCESS
    // case, so the degraded selector is correctly silent — and silent for that
    // reason, not because the window is empty. POSITIVE CONTROL below proves
    // the selector can see a presence in the retained window (trap 13).
    expect(selectDegradedRunAnalysisFact(result.facts)).toBeNull();
    const degradedPage = [
      analysisFact('newest-degraded', { status: 'failed' }),
      ...facts.slice(1),
    ];
    const degradedResult = reconcile({ durableRead: durable(degradedPage, 37) });
    expect(degradedResult.status).toBe('capped');
    expect(selectDegradedRunAnalysisFact(degradedResult.facts)?.fact).toEqual(
      degradedPage[0],
    );
    expect(readScenarioAnalysisClaimSafetyFact(result, SCENARIO)).toEqual({
      fact: facts[0],
      readOk: true,
    });
  });

  it('keeps the durable analysis chain readable on the 21st lifetime run', () => {
    // THE REGRESSION THIS PINS (PR #1170, 2026-08-28). `freezeCapped` returned
    // `facts: []`, so the 21st analysis on a scenario converted the model-facing
    // fact set to EMPTY — and because facts are never pruned, `total_count` only
    // grows and the state never heals. Every later turn on that scenario saw no
    // analysis, forever, while the wire freshness badge (derived from the hot
    // turn window) still read `fresh`.
    const newest = analysisFact('run-21', {
      computedAt: '2026-08-27T12:00:20.000Z',
    });
    const older = Array.from({ length: SCENARIO_ANALYSIS_FACT_CAP }, (_, index) =>
      analysisFact(`run-${SCENARIO_ANALYSIS_FACT_CAP - index}`, {
        computedAt: `2026-08-27T12:00:${String(19 - index).padStart(2, '0')}.000Z`,
      }),
    );
    const page = [newest, ...older];
    expect(page).toHaveLength(SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT);

    const result = reconcile({
      durableRead: durable(page, SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT),
    });

    expect(result.status).toBe('capped');
    // A usable suffix reaches the reasoning consumers, and the newest fact is
    // the one they select — the same property `complete` already guarantees.
    expect(result.facts).toHaveLength(SCENARIO_ANALYSIS_FACT_CAP);
    expect(selectRunAnalysisFact(result.facts)?.fact).toEqual(newest);
    expect(buildAnalysisFromPriorFacts(result.facts, [])).not.toBeNull();
    // The 21st row is the one the wall removes, and it is the OLDEST — the
    // model loses the tail of its history, never its current analysis.
    expect(result.facts).not.toContainEqual(older[older.length - 1]);
  });

  it.each(['partial', 'failed'])(
    'preserves the existing claim-safety selector behaviour for a newest %s analysis',
    (status) => {
      const fact = analysisFact(status, { status });
      const result = reconcile({ durableRead: durable([fact]) });
      const converged = readScenarioAnalysisClaimSafetyFact(result, SCENARIO);

      expect(converged).toEqual({ fact, readOk: true });
      expect(
        readMayNameLeadingOptionVerdict([], {
          newestAnalysisFact: converged.fact,
          readOk: converged.readOk,
          windowTruncated: true,
        }),
      ).toEqual(
        readMayNameLeadingOptionVerdict([], {
          newestAnalysisFact: fact,
          readOk: true,
          windowTruncated: true,
        }),
      );
    },
  );

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
    const result = reconcile({ durableRead: read });
    expect(result).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
    expect(readScenarioAnalysisClaimSafetyFact(result, SCENARIO)).toEqual({
      fact: null,
      readOk: false,
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

  it('never mints no-analysis permission when a valid newest withheld fact has an older corrupt sibling', () => {
    const validNewestWithheld = analysisFact('newest-withheld');
    expect(
      readMayNameLeadingOptionVerdict([], {
        newestAnalysisFact: validNewestWithheld,
        readOk: true,
        windowTruncated: false,
      }),
    ).toEqual({
      may_name_leading_option: false,
      constraint_verdict_state: null,
      provenance: 'scenario_fact',
    });

    const olderCorrupt = { fact_type: 'run_analysis', noop: false };
    const result = reconcile({
      durableRead: durable([validNewestWithheld, olderCorrupt]),
    });
    const claimSafetyRead = readScenarioAnalysisClaimSafetyFact(
      result,
      SCENARIO,
    );

    expect(result).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_contract_invalid',
    });
    expect(claimSafetyRead).toEqual({ fact: null, readOk: false });
    expect(
      readMayNameLeadingOptionVerdict([], {
        newestAnalysisFact: claimSafetyRead.fact,
        readOk: claimSafetyRead.readOk,
        // The scenario is short. That is not evidence that the unread fact
        // population is empty.
        windowTruncated: false,
      }),
    ).toEqual({
      may_name_leading_option: false,
      constraint_verdict_state: null,
      provenance: 'fail_closed_unavailable',
    });
  });

  it('degrades a clean durable zero that contradicts a known hot analysis fact', () => {
    const knownHot = analysisFact('known-hot');
    const result = reconcile({
      hotWindowFacts: [knownHot],
      hotWindowFactsWithIdentity: [
        hotIdentified(knownHot, 0, {
          fact_row_id: 'hot-only-row',
        }),
      ],
      durableRead: durable([]),
    });
    expect(result).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'snapshot_conflict',
      total_count: 0,
    });
    expect(readScenarioAnalysisClaimSafetyFact(result, SCENARIO)).toEqual({
      fact: null,
      readOk: false,
    });
  });

  it('lets a hot contradiction degrade a capped page instead of minting entitlement', () => {
    const cappedFacts = Array.from(
      { length: SCENARIO_ANALYSIS_FACT_LOOKAHEAD_LIMIT },
      (_, index) => analysisFact(`capped-${index}`),
    );
    const hotOnly = analysisFact('hot-only');
    const result = reconcile({
      hotWindowFacts: [hotOnly],
      hotWindowFactsWithIdentity: [
        hotIdentified(hotOnly, 0, { fact_row_id: 'hot-only-row' }),
      ],
      durableRead: durable(cappedFacts, 37),
    });

    expect(result).toMatchObject({
      status: 'degraded',
      reason: 'snapshot_conflict',
      total_count: 37,
    });
    expect(readScenarioAnalysisClaimSafetyFact(result, SCENARIO)).toEqual({
      fact: null,
      readOk: false,
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
        hotWindowFactsWithIdentity: [
          hotIdentified(hotNewer, 0, { fact_row_id: 'hot-newer-row' }),
          hotIdentified(durableOlder, 0),
        ],
        durableRead: durable([durableOlder]),
      }),
    ).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'snapshot_conflict',
      total_count: 1,
    });
  });

  it('uses persisted identity without deduplicating distinct identical durable facts', () => {
    const identicalFirst = analysisFact('identical');
    const identicalSecond = analysisFact('identical');
    const result = reconcile({
      hotWindowFacts: [identicalFirst, identicalSecond],
      hotWindowFactsWithIdentity: [
        hotIdentified(identicalFirst, 0),
        hotIdentified(identicalSecond, 1),
      ],
      durableRead: durable([identicalFirst, identicalSecond]),
    });
    expect(result.status).toBe('complete');
    expect(result.facts).toHaveLength(2);

    expect(
      reconcile({
        hotWindowFacts: [identicalFirst, identicalSecond],
        hotWindowFactsWithIdentity: [
          hotIdentified(identicalFirst, 0),
          hotIdentified(identicalSecond, 1),
        ],
        durableRead: durable([identicalFirst]),
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
        hotWindowFactsWithIdentity: [hotIdentified(hotFact, 0)],
        durableRead: durable([durableFact]),
      }),
    ).toMatchObject({ status: 'complete', source: 'scenario' });
  });

  it('does not let a byte-identical payload mint missing persisted identity', () => {
    const durableFact = analysisFact('same-payload');
    const hotFact = analysisFact('same-payload');

    expect(
      reconcile({
        hotWindowFacts: [hotFact],
        hotWindowFactsWithIdentity: [hotIdentified(hotFact, 0, {
          fact_row_id: 'newer-distinct-row',
        })],
        durableRead: durable([durableFact]),
      }),
    ).toMatchObject({ status: 'degraded', reason: 'snapshot_conflict' });
  });

  it('fails weak when a hot analysis payload has no persisted identity', () => {
    const hotFact = analysisFact('missing-identity');
    expect(
      reconcile({
        hotWindowFacts: [hotFact],
        hotWindowFactsWithIdentity: [],
        durableRead: durable([hotFact]),
      }),
    ).toMatchObject({
      status: 'degraded',
      reason: 'hot_window_contract_invalid',
    });
  });

  it('fails weak when a direct caller offers an unattested payload clone', () => {
    const rawFact = analysisFact('clone');
    const clone = analysisFact('clone');
    expect(
      reconcile({
        hotWindowFacts: [rawFact],
        hotWindowFactsWithIdentity: [hotIdentified(clone, 0)],
        durableRead: durable([rawFact]),
      }),
    ).toMatchObject({
      status: 'degraded',
      reason: 'hot_window_contract_invalid',
    });
  });

  it('degrades empty when one persisted id has contradictory payload or time', () => {
    const durableFact = analysisFact('durable');
    const hotPayloadConflict = analysisFact('hot-conflict');
    expect(
      reconcile({
        hotWindowFacts: [hotPayloadConflict],
        hotWindowFactsWithIdentity: [hotIdentified(hotPayloadConflict, 0)],
        durableRead: durable([durableFact]),
      }),
    ).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'snapshot_conflict',
      total_count: 1,
    });

    expect(
      reconcile({
        hotWindowFacts: [durableFact],
        hotWindowFactsWithIdentity: [
          hotIdentified(durableFact, 0, {
            fact_created_at: '2026-08-27T12:00:58.000Z',
          }),
        ],
        durableRead: durable([durableFact]),
      }),
    ).toMatchObject({ status: 'degraded', reason: 'snapshot_conflict' });
  });

  it('treats equivalent timestamp offsets as the same persisted instant', () => {
    const fact = analysisFact('offset-equivalent');
    const result = reconcile({
      hotWindowFacts: [fact],
      hotWindowFactsWithIdentity: [
        hotIdentified(fact, 0, {
          fact_created_at: '2026-08-27T13:00:59.000+01:00',
        }),
      ],
      durableRead: durable([fact]),
    });
    expect(result).toMatchObject({ status: 'complete', total_count: 1 });
  });

  it('rejects duplicate ids and impossible persisted timestamps', () => {
    const first = analysisFact('first');
    const second = analysisFact('second');
    expect(
      reconcile({
        durableRead: durable([
          identified(first, 0, { fact_row_id: 'duplicate' }),
          identified(second, 1, { fact_row_id: 'duplicate' }),
        ]),
      }),
    ).toMatchObject({
      status: 'degraded',
      reason: 'durable_contract_invalid',
    });
    expect(
      reconcile({
        durableRead: durable([
          identified(first, 0, {
            fact_created_at: '2026-02-30T12:00:00.000Z',
          }),
        ]),
      }),
    ).toMatchObject({
      status: 'degraded',
      reason: 'durable_contract_invalid',
    });
  });

  it('normalises complete pages to exact timestamp then id database order', () => {
    const oldest = analysisFact('oldest');
    const tieLowerId = analysisFact('tie-lower-id');
    const tieHigherId = analysisFact('tie-higher-id');
    const result = reconcile({
      durableRead: durable([
        identified(oldest, 0, {
          fact_row_id: 'row-a',
          fact_created_at: '2026-08-27T12:00:00.000000100Z',
        }),
        identified(tieLowerId, 1, {
          fact_row_id: 'row-b',
          fact_created_at: '2026-08-27T12:00:00.000000200Z',
        }),
        identified(tieHigherId, 2, {
          fact_row_id: 'row-z',
          fact_created_at: '2026-08-27T12:00:00.000000200Z',
        }),
      ]),
    });
    expect(result.facts).toEqual([tieHigherId, tieLowerId, oldest]);
    expect(readScenarioAnalysisClaimSafetyFact(result, SCENARIO)).toEqual({
      fact: tieHigherId,
      readOk: true,
    });
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
    const result = reconcile({
      hotWindowFacts: [analysisFact('known')],
      durableRead: { status: 'degraded', reason: 'unavailable' },
    });
    expect(result).toEqual({
      status: 'degraded',
      facts: [],
      reason: 'durable_unavailable',
    });
    expect(readScenarioAnalysisClaimSafetyFact(result, SCENARIO)).toEqual({
      fact: null,
      readOk: false,
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
        hotWindowFactsWithIdentity: [hotIdentified(fact, 0)],
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
