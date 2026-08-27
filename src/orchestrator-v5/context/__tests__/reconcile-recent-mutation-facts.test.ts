import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { RECENT_CHANGES_CAP } from '../recent-changes.js';
import {
  RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
  bindRecentMutationHistoryToPriorFacts,
  readRecentMutationHistoryFromPriorFacts,
  reconcileRecentMutationFacts,
  type DurableRecentMutationFactRead,
} from '../reconcile-recent-mutation-facts.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';

function constraint(label: string, value: number, noop = false): HandlerFact {
  return {
    fact_type: 'add_constraint',
    fact_version: 1,
    noop,
    result: {
      target_id: `constraint-${label}`,
      status: noop ? 'noop' : 'applied',
      before: null,
      after: {
        constraint_id: `constraint-${label}`,
        node_id: `node-${label}`,
        operator: '<=',
        value,
        label,
      },
    },
  };
}

function durable(
  facts: readonly unknown[],
  scenarioId = SCENARIO,
  queryLimit = RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
): DurableRecentMutationFactRead {
  return { status: 'ok', scenario_id: scenarioId, query_limit: queryLimit, facts };
}

function reconcile(
  overrides: Partial<Parameters<typeof reconcileRecentMutationFacts>[0]> = {},
) {
  return reconcileRecentMutationFacts({
    scenarioId: SCENARIO,
    hotWindowFacts: [],
    hotWindowReadOk: true,
    loadedTurnCount: 20,
    priorTurnsTotal: 41,
    durableRead: durable([]),
    ...overrides,
  });
}

describe('reconcileRecentMutationFacts', () => {
  it('makes complete + empty the authoritative no-changes state', () => {
    expect(reconcile()).toEqual({
      recent_mutation_facts: [],
      recent_changes_status: 'complete',
    });
  });

  it('uses the durable scenario-wide order and the fourth row only as capped proof', () => {
    const newestById = constraint('same-time-id-z', 4);
    const nextById = constraint('same-time-id-y', 3);
    const third = constraint('older', 2);
    const capProof = constraint('oldest', 1);

    const result = reconcile({
      durableRead: durable([newestById, nextById, third, capProof]),
    });

    expect(result.recent_changes_status).toBe('capped');
    expect(result.recent_mutation_facts).toEqual([newestById, nextById, third]);
    expect(result.recent_mutation_facts).toHaveLength(RECENT_CHANGES_CAP);
    expect(RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT).toBe(4);
  });

  it('degrades an under-bounded 3-of-4 read instead of falsely calling it complete', () => {
    const hot = constraint('known-hot', 9);
    const firstThree = Array.from({ length: RECENT_CHANGES_CAP }, (_, i) =>
      constraint(`durable-${i}`, i),
    );

    expect(
      reconcile({
        hotWindowFacts: [hot],
        durableRead: durable(firstThree, SCENARIO, RECENT_CHANGES_CAP),
      }),
    ).toEqual({
      recent_mutation_facts: [hot],
      recent_changes_status: 'degraded',
    });
  });

  it('fails weak when a purported durable result exceeds the cap+1 query contract', () => {
    const hot = constraint('known-hot', 9);
    const overBound = Array.from({ length: RECENT_CHANGES_CAP + 2 }, (_, i) =>
      constraint(`durable-${i}`, i),
    );

    expect(
      reconcile({
        hotWindowFacts: [hot],
        hotWindowReadOk: true,
        durableRead: durable(overBound),
      }),
    ).toEqual({
      recent_mutation_facts: [hot],
      recent_changes_status: 'degraded',
    });
  });

  it('rejects a durable result bound to another scenario and preserves local hot receipts', () => {
    const local = constraint('local', 8);
    const foreign = constraint('foreign', 7);

    expect(
      reconcile({
        hotWindowFacts: [local],
        durableRead: durable([foreign], '22222222-2222-4222-8222-222222222222'),
      }),
    ).toEqual({
      recent_mutation_facts: [local],
      recent_changes_status: 'degraded',
    });
  });

  it('does not let foreign, refused/noop, or malformed facts author a receipt', () => {
    const applied = constraint('applied', 6);
    const noop = constraint('noop', 5, true);
    const refusedRun = {
      fact_type: 'run_analysis',
      fact_version: 1,
      noop: false,
      result: {
        scenario_id: SCENARIO,
        leading_option_id: null,
        summary: 'Analysis attempt was refused before computation.',
        enrichment: { analysis_status: 'refused' },
        computed_at: '2026-08-27T10:00:00.000Z',
      },
    } satisfies HandlerFact;
    const foreignReadFact = {
      fact_type: 'what_would_flip',
      fact_version: 1,
      noop: false,
      result: { precondition_unmet: true, option_count: 0 },
    } satisfies HandlerFact;
    const malformed = { fact_type: 'add_constraint', result: { status: 'applied' } };

    expect(
      reconcile({
        hotWindowFacts: [applied, foreignReadFact, refusedRun, noop, malformed],
        hotWindowReadOk: true,
        durableRead: { status: 'degraded' },
      }),
    ).toEqual({
      recent_mutation_facts: [applied],
      recent_changes_status: 'degraded',
    });
  });

  it('treats an ineligible or malformed fact on the durable-only arm as degraded', () => {
    const hot = constraint('known', 5);
    const noop = constraint('not-applied', 4, true);

    expect(
      reconcile({ hotWindowFacts: [hot], durableRead: durable([noop]) }),
    ).toEqual({
      recent_mutation_facts: [hot],
      recent_changes_status: 'degraded',
    });
    expect(
      reconcile({
        hotWindowFacts: [hot],
        durableRead: durable([{ fact_type: 'edit_graph', noop: false }]),
      }),
    ).toEqual({
      recent_mutation_facts: [hot],
      recent_changes_status: 'degraded',
    });
  });

  it('preserves loaded hot receipts when the durable read fails', () => {
    const known = constraint('known', 3);
    expect(
      reconcile({
        hotWindowFacts: [known],
        hotWindowReadOk: false,
        durableRead: { status: 'degraded' },
      }),
    ).toEqual({
      recent_mutation_facts: [known],
      recent_changes_status: 'degraded',
    });
  });

  it('does not turn durable failure plus empty truncated history into no changes', () => {
    expect(
      reconcile({ durableRead: { status: 'degraded' } }),
    ).toEqual({
      recent_mutation_facts: [],
      recent_changes_status: 'degraded',
    });
  });

  it('recovers complete history from a healthy hot window that covers every turn', () => {
    const only = constraint('turn-16', 16);
    expect(
      reconcile({
        hotWindowFacts: [only],
        loadedTurnCount: 20,
        priorTurnsTotal: 20,
        durableRead: { status: 'degraded' },
      }),
    ).toEqual({
      recent_mutation_facts: [only],
      recent_changes_status: 'complete',
    });
  });

  it('reports capped when a complete hot window proves a fourth eligible receipt', () => {
    const facts = Array.from({ length: RECENT_CHANGES_CAP + 1 }, (_, i) =>
      constraint(`hot-${i}`, i),
    );
    expect(
      reconcile({
        hotWindowFacts: facts,
        loadedTurnCount: 20,
        priorTurnsTotal: 19,
        durableRead: { status: 'degraded' },
      }),
    ).toEqual({
      recent_mutation_facts: facts.slice(0, RECENT_CHANGES_CAP),
      recent_changes_status: 'capped',
    });
  });

  it('degrades and preserves the hot receipt when a clean durable zero contradicts it', () => {
    const known = constraint('known-window-receipt', 2);
    expect(
      reconcile({
        hotWindowFacts: [known],
        loadedTurnCount: 1,
        priorTurnsTotal: 1,
        durableRead: durable([]),
      }),
    ).toEqual({
      recent_mutation_facts: [known],
      recent_changes_status: 'degraded',
    });
  });

  it('never lets rolling-summary prose author a mutation receipt', () => {
    expect(
      reconcile({
        hotWindowFacts: [{ summary: 'Renamed the option last month.' }],
        loadedTurnCount: 1,
        priorTurnsTotal: 1,
        durableRead: { status: 'degraded' },
      }),
    ).toEqual({
      recent_mutation_facts: [],
      recent_changes_status: 'degraded',
    });
  });

  it('does not upgrade unknown or malformed turn coverage into complete history', () => {
    const known = constraint('known', 1);
    for (const coverage of [
      { priorTurnsTotal: null, loadedTurnCount: 20 },
      { priorTurnsTotal: 21, loadedTurnCount: 20 },
      { priorTurnsTotal: -1, loadedTurnCount: 20 },
      { priorTurnsTotal: 20, loadedTurnCount: Number.NaN },
    ] as const) {
      expect(
        reconcile({
          hotWindowFacts: [known],
          durableRead: { status: 'degraded' },
          ...coverage,
        }).recent_changes_status,
      ).toBe('degraded');
    }
  });

  it('freezes the result and cannot be used as a write-through mutation surface', () => {
    const result = reconcile({ durableRead: durable([constraint('immutable', 1)]) });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.recent_mutation_facts)).toBe(true);
  });

  it('binds durable history without changing ordinary fact iteration or JSON bytes', () => {
    const hot = constraint('hot', 7);
    const durableReceipt = constraint('durable', 6);
    const history = reconcile({ durableRead: durable([durableReceipt]) });
    const bound = bindRecentMutationHistoryToPriorFacts([hot], history);

    expect([...bound]).toEqual([hot]);
    expect(JSON.stringify(bound)).toBe(JSON.stringify([hot]));
    expect(Object.keys(bound)).toEqual(['0']);
    expect(readRecentMutationHistoryFromPriorFacts(bound)).toEqual(history);
    expect(Object.isFrozen(bound)).toBe(true);
  });

  it('treats a plain legacy fact array as lacking scenario-wide authority', () => {
    expect(
      readRecentMutationHistoryFromPriorFacts([constraint('legacy-window', 5)]),
    ).toBeNull();
  });
});
