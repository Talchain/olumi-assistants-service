import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  RECENT_CHANGES_CAP,
  projectRecentChanges,
} from '../recent-changes.js';
import {
  RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
  bindRecentMutationHistoryToPriorFacts,
  readRecentMutationHistoryFromPriorFacts,
  reconcileRecentMutationFacts,
  type DurableRecentMutationFactRead,
} from '../reconcile-recent-mutation-facts.js';
import { tryStateQueryGuard } from '../../routing/state-query-guard.js';

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
  ids = facts.map((_, index) => `fact-${String(999 - index).padStart(3, '0')}`),
  timestamps = facts.map((_, index) =>
    new Date(Date.UTC(2026, 7, 27, 12, 0, -index)).toISOString(),
  ),
): DurableRecentMutationFactRead {
  return {
    status: 'ok',
    scenario_id: scenarioId,
    query_limit: queryLimit,
    facts: facts.map((fact, index) => ({
      fact: fact as HandlerFact,
      fact_row_id: ids[index]!,
      fact_created_at: timestamps[index]!,
    })),
  };
}

function identifiedHot(
  facts: readonly HandlerFact[],
  ids = facts.map((_, index) => `fact-${String(999 - index).padStart(3, '0')}`),
  timestamps = facts.map((_, index) =>
    new Date(Date.UTC(2026, 7, 27, 12, 0, -index)).toISOString(),
  ),
) {
  return facts.map((fact, index) => ({
    fact,
    fact_row_id: ids[index]!,
    fact_created_at: timestamps[index]!,
    turn_id: `turn-${index}`,
  }));
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

  it('degrades and preserves a hot receipt omitted by a non-empty durable snapshot', () => {
    const hot = constraint('committed-between-snapshots', 3);
    const durableOlder = constraint('durable-older', 2);

    expect(
      reconcile({
        hotWindowFacts: [hot],
        hotWindowFactsWithIdentity: identifiedHot(
          [hot],
          ['fact-hot-new'],
          ['2026-08-27T12:01:00.000Z'],
        ),
        loadedTurnCount: 2,
        priorTurnsTotal: 2,
        durableRead: durable([durableOlder]),
      }),
    ).toEqual({
      recent_mutation_facts: [hot, durableOlder],
      recent_changes_status: 'degraded',
    });
  });

  it('accepts a clean durable snapshot when it contains every known hot receipt', () => {
    const newest = constraint('newest', 3);
    const older = constraint('older', 2);

    expect(
      reconcile({
        hotWindowFacts: [newest],
        hotWindowFactsWithIdentity: identifiedHot([newest]),
        durableRead: durable([newest, older]),
      }),
    ).toEqual({
      recent_mutation_facts: [newest, older],
      recent_changes_status: 'complete',
    });
  });

  it('matches duplicate receipt payloads one-for-one rather than collapsing them', () => {
    const repeated = constraint('same-payload', 2);

    expect(
      reconcile({
        hotWindowFacts: [repeated, repeated],
        hotWindowFactsWithIdentity: identifiedHot(
          [repeated, repeated],
          ['fact-hot-new', 'fact-999'],
          ['2026-08-27T12:01:00.000Z', '2026-08-27T12:00:00.000Z'],
        ),
        durableRead: durable([repeated]),
      }),
    ).toEqual({
      recent_mutation_facts: [repeated, repeated],
      recent_changes_status: 'degraded',
    });
  });

  it('does not mistake a repeated new payload for the same historical receipt', () => {
    const repeated = constraint('same-cycle-payload', 2);
    const restore = constraint('restore-between-cycles', 1);

    expect(
      reconcile({
        hotWindowFacts: [repeated],
        hotWindowFactsWithIdentity: identifiedHot(
          [repeated],
          ['fact-new-cycle'],
          ['2026-08-27T12:01:00.000Z'],
        ),
        durableRead: durable([restore, repeated]),
      }),
    ).toEqual({
      recent_mutation_facts: [repeated, restore, repeated],
      recent_changes_status: 'degraded',
    });
  });

  it('fails weak rather than calling a capped page newest when it omits a hot receipt', () => {
    const hot = constraint('concurrent-hot', 9);
    const durablePage = Array.from(
      { length: RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT },
      (_, index) => constraint(`durable-${index}`, index),
    );

    expect(
      reconcile({
        hotWindowFacts: [hot],
        hotWindowFactsWithIdentity: identifiedHot(
          [hot],
          ['fact-hot-new'],
          ['2026-08-27T12:01:00.000Z'],
        ),
        durableRead: durable(durablePage),
      }),
    ).toEqual({
      recent_mutation_facts: [hot, ...durablePage.slice(0, 2)],
      recent_changes_status: 'degraded',
    });
  });

  it('keeps a valid capped durable head when the hot window has only an older tail', () => {
    const durablePage = Array.from(
      { length: RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT },
      (_, index) => constraint(`newest-${index}`, 10 - index),
    );
    const olderHotTail = constraint('older-hot-only', 1);
    const history = reconcile({
      hotWindowFacts: [...durablePage, olderHotTail],
      hotWindowFactsWithIdentity: identifiedHot(
        [...durablePage, olderHotTail],
        ['fact-999', 'fact-998', 'fact-997', 'fact-996', 'fact-old-tail'],
        [
          '2026-08-27T12:00:00.000Z',
          '2026-08-27T11:59:59.000Z',
          '2026-08-27T11:59:58.000Z',
          '2026-08-27T11:59:57.000Z',
          '2026-08-27T11:59:56.000Z',
        ],
      ),
      durableRead: durable(durablePage),
    });

    expect(history).toEqual({
      recent_mutation_facts: durablePage.slice(0, RECENT_CHANGES_CAP),
      recent_changes_status: 'capped',
    });

    const outcome = tryStateQueryGuard({
      message: 'What changed?',
      contextPack: {
        recent_changes: projectRecentChanges(history.recent_mutation_facts),
        recent_changes_status: history.recent_changes_status,
      },
    });
    expect(outcome).toMatchObject({ matched: true, dispatch: 'with_recent_change' });
    if (!outcome.matched) throw new Error('expected receipt-backed response');
    expect(outcome.assistant_text).toContain('newest-0');
    expect(outcome.assistant_text).not.toContain('older-hot-only');
    expect(outcome.assistant_text).toContain(
      'available history is limited to the latest three recorded edits',
    );
  });

  it('keeps a newer durable snapshot ahead of the older hot membership window', () => {
    const newer = constraint('durable-new', 20);
    const prior = Array.from({ length: 4 }, (_, index) =>
      constraint(`prior-${index}`, 10 - index),
    );
    const olderTail = constraint('older-tail', 1);
    const sharedIds = ['fact-998', 'fact-997', 'fact-996', 'fact-995'];
    const sharedTimes = [
      '2026-08-27T11:59:59.000Z',
      '2026-08-27T11:59:58.000Z',
      '2026-08-27T11:59:57.000Z',
      '2026-08-27T11:59:56.000Z',
    ];

    expect(
      reconcile({
        hotWindowFacts: [...prior, olderTail],
        hotWindowFactsWithIdentity: identifiedHot(
          [...prior, olderTail],
          [...sharedIds, 'fact-old-tail'],
          [...sharedTimes, '2026-08-27T11:59:55.000Z'],
        ),
        durableRead: durable(
          [newer, ...prior.slice(0, 3)],
          SCENARIO,
          RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
          ['fact-999', ...sharedIds.slice(0, 3)],
          ['2026-08-27T12:00:00.000Z', ...sharedTimes.slice(0, 3)],
        ),
      }),
    ).toEqual({
      recent_mutation_facts: [newer, ...prior.slice(0, 2)],
      recent_changes_status: 'capped',
    });
  });

  it('uses the persisted id tie-break when hot rows arrive in reverse tie order', () => {
    const newest = constraint('canonical-newest', 10);
    const second = constraint('same-time-second', 9);
    const third = constraint('third', 8);
    const fourth = constraint('fourth', 7);
    const olderTail = constraint('older-tail', 1);
    const tied = '2026-08-27T12:00:00.000Z';
    const durablePage = [newest, second, third, fourth];

    expect(
      reconcile({
        hotWindowFacts: [second, newest, third, fourth, olderTail],
        hotWindowFactsWithIdentity: identifiedHot(
          [second, newest, third, fourth, olderTail],
          ['fact-y', 'fact-z', 'fact-x', 'fact-w', 'fact-v'],
          [tied, tied, tied, tied, '2026-08-27T11:59:59.000Z'],
        ),
        durableRead: durable(
          durablePage,
          SCENARIO,
          RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
          ['fact-z', 'fact-y', 'fact-x', 'fact-w'],
          [tied, tied, tied, tied],
        ),
      }),
    ).toEqual({
      recent_mutation_facts: [newest, second, third],
      recent_changes_status: 'capped',
    });
  });

  it('orders sub-millisecond Postgres timestamps without losing precision', () => {
    const newer = constraint('newer-900us', 9);
    const older = constraint('older-100us', 1);

    expect(
      reconcile({
        hotWindowFacts: [newer],
        hotWindowFactsWithIdentity: identifiedHot(
          [newer],
          ['fact-a-low-id'],
          ['2026-08-27T19:40:00.000900Z'],
        ),
        durableRead: durable(
          [older],
          SCENARIO,
          RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
          ['fact-z-high-id'],
          ['2026-08-27T19:40:00.000100Z'],
        ),
      }),
    ).toEqual({
      recent_mutation_facts: [newer, older],
      recent_changes_status: 'degraded',
    });
  });

  it('rejects calendar-impossible timestamps instead of accepting Date.parse normalisation', () => {
    for (const impossible of [
      '2026-02-29T00:00:00Z',
      '2026-02-30T00:00:00Z',
      '2026-04-31T00:00:00Z',
    ]) {
      expect(
        reconcile({
          durableRead: durable(
            [constraint(impossible, 1)],
            SCENARIO,
            RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
            ['fact-impossible'],
            [impossible],
          ),
        }),
      ).toEqual({
        recent_mutation_facts: [],
        recent_changes_status: 'degraded',
      });
    }
  });

  it('treats equivalent offset spellings as the same persisted instant', () => {
    const receipt = constraint('same-instant', 3);

    expect(
      reconcile({
        hotWindowFacts: [receipt],
        hotWindowFactsWithIdentity: identifiedHot(
          [receipt],
          ['fact-same'],
          ['2026-08-27T14:00:00+02:00'],
        ),
        durableRead: durable(
          [receipt],
          SCENARIO,
          RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
          ['fact-same'],
          ['2026-08-27T12:00:00Z'],
        ),
      }),
    ).toEqual({
      recent_mutation_facts: [receipt],
      recent_changes_status: 'complete',
    });
  });

  it('fails unavailable when the same persisted fact identity contradicts itself', () => {
    const hot = constraint('hot-payload', 9);
    const contradictoryDurable = constraint('durable-payload', 8);

    const history = reconcile({
      hotWindowFacts: [hot],
      hotWindowFactsWithIdentity: identifiedHot(
        [hot],
        ['fact-shared'],
        ['2026-08-27T12:00:00.000Z'],
      ),
      durableRead: durable(
        [contradictoryDurable],
        SCENARIO,
        RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
        ['fact-shared'],
        ['2026-08-27T12:00:00.000Z'],
      ),
    });

    expect(history).toEqual({
      recent_mutation_facts: [],
      recent_changes_status: 'degraded',
    });
    expect(
      tryStateQueryGuard({
        message: 'What did that update do?',
        contextPack: {
          recent_changes: projectRecentChanges(history.recent_mutation_facts),
          recent_changes_status: history.recent_changes_status,
        },
      }),
    ).toMatchObject({ matched: true, dispatch: 'changes_unavailable' });
  });

  it('normalises a complete custom-store result to persisted timestamp and id order', () => {
    const newest = constraint('newest', 3);
    const tiedLowerId = constraint('tied-lower-id', 1);
    const tiedHigherId = constraint('tied-higher-id', 4);
    const tied = '2026-08-27T11:59:59.000Z';

    expect(
      reconcile({
        durableRead: durable(
          [tiedLowerId, newest, tiedHigherId],
          SCENARIO,
          RECENT_MUTATION_FACT_LOOKAHEAD_LIMIT,
          ['fact-a', 'fact-c', 'fact-z'],
          [tied, '2026-08-27T12:00:00.000Z', tied],
        ),
      }),
    ).toEqual({
      recent_mutation_facts: [newest, tiedHigherId, tiedLowerId],
      recent_changes_status: 'complete',
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
