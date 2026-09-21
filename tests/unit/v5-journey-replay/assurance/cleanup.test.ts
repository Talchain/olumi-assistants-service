import { describe, it, expect } from 'vitest';

import {
  cleanupScenarios,
  verifyZeroResidual,
  cleanupAndVerify,
  CLEANUP_ORDER,
} from '../../../../tools/v5-journey-replay/assurance/cleanup.js';
import type { TableAccess, TableOpResult } from '../../../../tools/v5-journey-replay/assurance/supabase.js';

/**
 * In-memory mock of TableAccess. `store[table]` is the set of scenario_id
 * values present in that table; a table absent from `store` simulates a
 * missing relation. Records call order for ordering assertions.
 */
function makeMockAccess(store: Record<string, Set<string>>): {
  access: TableAccess;
  order: string[];
} {
  const order: string[] = [];
  const access: TableAccess = {
    async count(table, _col, ids): Promise<TableOpResult> {
      order.push(`count:${table}`);
      const set = store[table];
      if (set === undefined) return { count: 0, tableMissing: true };
      const count = ids.filter((id) => set.has(id)).length;
      return { count, tableMissing: false };
    },
    async remove(table, _col, ids): Promise<TableOpResult> {
      order.push(`remove:${table}`);
      const set = store[table];
      if (set === undefined) return { count: 0, tableMissing: true };
      let removed = 0;
      for (const id of ids) if (set.delete(id)) removed += 1;
      return { count: removed, tableMissing: false };
    },
  };
  return { access, order };
}

const ALL_TABLES = (): Record<string, Set<string>> => ({
  v5_handler_facts: new Set(['A', 'B']),
  turn_observations: new Set(['A']),
  v5_conversation_turns: new Set(['A', 'B']),
  conversation_turns: new Set<string>(),
  scenario_snapshots: new Set(['B']),
  shared_briefs: new Set<string>(),
  scenarios: new Set(['A', 'B']),
});

describe('assurance cleanup', () => {
  it('deletes child-first in the documented order, scenarios last', () => {
    const { access, order } = makeMockAccess(ALL_TABLES());
    return cleanupScenarios(access, ['A', 'B']).then(() => {
      const removeOrder = order.filter((o) => o.startsWith('remove:')).map((o) => o.slice('remove:'.length));
      expect(removeOrder).toEqual(CLEANUP_ORDER.map((t) => t.table));
      expect(removeOrder[0]).toBe('v5_handler_facts');
      expect(removeOrder[removeOrder.length - 1]).toBe('scenarios');
    });
  });

  it('only deletes the exact scenario IDs given (never touches others)', async () => {
    const store = ALL_TABLES();
    store.scenarios.add('OTHER');
    store.v5_handler_facts.add('OTHER');
    const { access } = makeMockAccess(store);

    await cleanupScenarios(access, ['A', 'B']);

    expect(store.scenarios.has('OTHER')).toBe(true);
    expect(store.v5_handler_facts.has('OTHER')).toBe(true);
    expect(store.scenarios.has('A')).toBe(false);
    expect(store.scenarios.has('B')).toBe(false);
  });

  it('verifies zero residual after cleanup', async () => {
    const store = ALL_TABLES();
    store.scenarios.add('OTHER'); // unrelated row stays
    const { access } = makeMockAccess(store);

    const cleanup = await cleanupScenarios(access, ['A', 'B']);
    expect(cleanup.totalDeleted).toBeGreaterThan(0);
    expect(cleanup.hadError).toBe(false);

    const residual = await verifyZeroResidual(access, ['A', 'B']);
    expect(residual.totalResidual).toBe(0);
    expect(residual.clean).toBe(true);
  });

  it('tolerates missing tables (records tableMissing, not an error)', async () => {
    const store = ALL_TABLES();
    delete store.turn_observations; // simulate a deploy without this table
    delete store.scenario_snapshots;
    const { access } = makeMockAccess(store);

    const { cleanup, residual } = await cleanupAndVerify(access, ['A', 'B']);
    expect(cleanup.hadError).toBe(false);
    expect(cleanup.results.find((r) => r.table === 'turn_observations')?.tableMissing).toBe(true);
    expect(residual.clean).toBe(true);
  });

  it('surfaces a non-missing-table error as hadError (and not clean)', async () => {
    const order: string[] = [];
    const access: TableAccess = {
      async count(table, _c, _ids) {
        order.push(`count:${table}`);
        if (table === 'scenarios') return { count: 1, tableMissing: false, error: 'permission denied' };
        return { count: 0, tableMissing: false };
      },
      async remove(table, _c, _ids) {
        order.push(`remove:${table}`);
        if (table === 'scenarios') return { count: 0, tableMissing: false, error: 'permission denied' };
        return { count: 0, tableMissing: false };
      },
    };
    const { cleanup, residual } = await cleanupAndVerify(access, ['A']);
    expect(cleanup.hadError).toBe(true);
    expect(residual.clean).toBe(false);
  });

  it('cleanup runs even after a simulated failed assertion (finally semantics)', async () => {
    const store = ALL_TABLES();
    const { access } = makeMockAccess(store);
    let cleaned = false;
    await expect(
      (async () => {
        try {
          throw new Error('assertion blew up mid-journey');
        } finally {
          await cleanupScenarios(access, ['A', 'B']);
          cleaned = true;
        }
      })(),
    ).rejects.toThrow('assertion blew up');
    expect(cleaned).toBe(true);
    expect(store.scenarios.has('A')).toBe(false);
    expect(store.scenarios.has('B')).toBe(false);
  });

  it('no-op on empty scenario list', async () => {
    const { access, order } = makeMockAccess(ALL_TABLES());
    const cleanup = await cleanupScenarios(access, []);
    expect(cleanup.totalDeleted).toBe(0);
    expect(order).toHaveLength(0);
  });
});
