/**
 * Draft-loss lifecycle retained across the v5 graph-append cutover.
 * First-write admission itself is pinned by turn-fence-atomic-append.test.ts
 * and the SQL migration guards; this suite keeps the orthogonal disclosure
 * mark/resolution behavior from the retired app-side exemption suite.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SupabaseClient } from '@supabase/supabase-js';

import { SessionLRUCache } from '../cache.js';
import { SupabaseSessionStore } from '../supabase-store.js';
import { setTestSink } from '../../../utils/telemetry.js';

const SCENARIO = 'f1000000-0000-4000-8000-000000000001';

interface LossRow {
  turnId: string;
  graphWriteFailedAt: string | null;
  graphWriteFailureReason: string | null;
  graphLossDisclosableAt: string | null;
  graphLossResolvedAt: string | null;
}

type Filter = { kind: 'eq' | 'is' | 'not'; column: string; value: unknown };

function makeClient(
  options: { readonly updateErrorCode?: string } = {},
) {
  const rows: LossRow[] = [];
  let currentGraph: unknown = null;
  const client = {
    from: vi.fn((table: string) => {
      const filters: Filter[] = [];
      let update: Record<string, unknown> | null = null;

      const rowValue = (row: LossRow, column: string): unknown => {
        if (column === 'scenario_id') return SCENARIO;
        if (column === 'turn_id') return row.turnId;
        if (column === 'graph_loss_disclosable_at') return row.graphLossDisclosableAt;
        if (column === 'graph_loss_resolved_at') return row.graphLossResolvedAt;
        if (column === 'graph_write_failed_at') return row.graphWriteFailedAt;
        return undefined;
      };
      const matches = (row: LossRow) =>
        filters.every((filter) => {
          const value = rowValue(row, filter.column);
          if (filter.kind === 'eq') return value === filter.value;
          if (filter.kind === 'is') return value === filter.value;
          return filter.value === null ? value !== null : value !== filter.value;
        });
      const execute = () => {
        if (table === 'scenarios') {
          const asksForGraph = filters.some(
            (filter) => filter.kind === 'not' && filter.column === 'graph',
          );
          return {
            data: asksForGraph && currentGraph !== null ? [{ id: SCENARIO }] : [],
            error: null,
          };
        }
        if (update !== null) {
          if (options.updateErrorCode !== undefined) {
            return {
              data: null,
              error: {
                code: options.updateErrorCode,
                message: 'injected update failure',
              },
            };
          }
          for (const row of rows.filter(matches)) {
            if ('graph_write_failed_at' in update) {
              row.graphWriteFailedAt = String(update.graph_write_failed_at);
            }
            if ('graph_write_failure_reason' in update) {
              row.graphWriteFailureReason = String(update.graph_write_failure_reason);
            }
            if ('graph_loss_disclosable_at' in update) {
              row.graphLossDisclosableAt = String(update.graph_loss_disclosable_at);
            }
            if ('graph_loss_resolved_at' in update) {
              row.graphLossResolvedAt = String(update.graph_loss_resolved_at);
            }
          }
          return { data: null, error: null };
        }
        return { data: rows.filter(matches).map((_row, index) => ({ generation: index + 1 })), error: null };
      };

      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.update = (values: Record<string, unknown>) => {
        update = values;
        return chain;
      };
      chain.eq = (column: string, value: unknown) => {
        filters.push({ kind: 'eq', column, value });
        return chain;
      };
      chain.is = (column: string, value: unknown) => {
        filters.push({ kind: 'is', column, value });
        return chain;
      };
      chain.not = (column: string, _operator: string, value: unknown) => {
        filters.push({ kind: 'not', column, value });
        return chain;
      };
      chain.limit = () => Promise.resolve(execute());
      chain.then = (
        resolve: (value: ReturnType<typeof execute>) => unknown,
        reject?: (error: unknown) => unknown,
      ) => Promise.resolve(execute()).then(resolve, reject);
      return chain as never;
    }),
    rpc: vi.fn(),
  } as unknown as SupabaseClient;

  return {
    client,
    rows,
    addTurn(turnId: string) {
      rows.push({
        turnId,
        graphWriteFailedAt: null,
        graphWriteFailureReason: null,
        graphLossDisclosableAt: null,
        graphLossResolvedAt: null,
      });
    },
    setGraph(graph: unknown) {
      currentGraph = graph;
    },
  };
}

function store(client: SupabaseClient) {
  return new SupabaseSessionStore(
    client,
    new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }),
    { defaultReadLimit: 20 },
  );
}

afterEach(() => setTestSink(null));

describe('draft-loss marks remain distinct from generic dead turns', () => {
  it('turn_dead_only never creates a user-disclosable loss', async () => {
    const db = makeClient();
    db.addTurn('turn-dead');
    const session = store(db.client);
    await session.markGraphWriteFailed(
      SCENARIO,
      'turn-dead',
      'pipeline_threw_before_graph',
      'turn_dead_only',
    );
    expect(await session.scenarioDraftLossStands(SCENARIO)).toBe(false);
  });

  it('draft_loss stands only while no graph exists and no later commit resolved it', async () => {
    const db = makeClient();
    db.addTurn('turn-lost');
    const session = store(db.client);
    await session.markGraphWriteFailed(SCENARIO, 'turn-lost', 'stopped', 'draft_loss');

    expect(await session.scenarioDraftLossStands(SCENARIO)).toBe(true);
    db.setGraph({ nodes: [], edges: [] });
    expect(await session.scenarioDraftLossStands(SCENARIO)).toBe(false);
    db.setGraph(null);
    expect(await session.scenarioDraftLossStands(SCENARIO)).toBe(true);

    await session.resolveScenarioDraftLoss(SCENARIO);
    expect(await session.scenarioDraftLossStands(SCENARIO)).toBe(false);
    expect(db.rows[0]!.graphLossResolvedAt).not.toBeNull();
  });

  it('failure telemetry remains content-free', async () => {
    const events: Array<{ event: string; payload: Record<string, unknown> }> = [];
    setTestSink((event, payload) => events.push({ event, payload }));
    const db = makeClient();
    db.addTurn('turn-lost');
    await store(db.client).markGraphWriteFailed(
      SCENARIO,
      'turn-lost',
      'superseded',
      'draft_loss',
    );
    const marked = events.find((event) => event.event === 'v5.turn_fence.graph_write_failure_marked');
    expect(marked?.payload).toEqual({
      scenario_id: SCENARIO,
      turn_id: 'turn-lost',
      reason: 'superseded',
      disclosure: 'draft_loss',
    });
  });

  it('a pre-migration missing mark column degrades without changing the refusal path', async () => {
    const db = makeClient({ updateErrorCode: '42703' });
    db.addTurn('turn-lost');
    await expect(
      store(db.client).markGraphWriteFailed(
        SCENARIO,
        'turn-lost',
        'stopped',
        'draft_loss',
      ),
    ).resolves.toBeUndefined();
    expect(db.rows[0]!.graphWriteFailedAt).toBeNull();
  });
});

interface LiveFenceRow {
  readonly scenarioId: string;
  readonly turnId: string;
  readonly generation: number;
  readonly stoppedAt: string | null;
  readonly failedAt: string | null;
}

function makeLiveTurnClient(
  rows: readonly LiveFenceRow[],
  options: { readonly failNewColumnOnce?: boolean } = {},
) {
  let failNewColumn = options.failNewColumnOnce === true;
  let readCount = 0;
  const client = {
    from: vi.fn(() => {
      const filters: Filter[] = [];
      const chain: Record<string, unknown> = {};
      chain.select = () => chain;
      chain.eq = (column: string, value: unknown) => {
        filters.push({ kind: 'eq', column, value });
        return chain;
      };
      chain.neq = (column: string, value: unknown) => {
        filters.push({ kind: 'not', column, value });
        return chain;
      };
      chain.is = (column: string, value: unknown) => {
        filters.push({ kind: 'is', column, value });
        return chain;
      };
      chain.limit = async () => {
        readCount += 1;
        if (
          failNewColumn &&
          filters.some((filter) => filter.column === 'graph_write_failed_at')
        ) {
          failNewColumn = false;
          return {
            data: null,
            error: { code: '42703', message: 'column does not exist' },
          };
        }
        const matches = rows.filter((row) =>
          filters.every((filter) => {
            const value =
              filter.column === 'scenario_id'
                ? row.scenarioId
                : filter.column === 'turn_id'
                  ? row.turnId
                  : filter.column === 'stopped_at'
                    ? row.stoppedAt
                    : filter.column === 'graph_write_failed_at'
                      ? row.failedAt
                      : undefined;
            if (filter.kind === 'eq') return value === filter.value;
            if (filter.kind === 'is') return value === filter.value;
            return value !== filter.value;
          }),
        );
        return {
          data: matches.slice(0, 1).map((row) => ({ generation: row.generation })),
          error: null,
        };
      };
      return chain as never;
    }),
    rpc: vi.fn(),
  } as unknown as SupabaseClient;
  return { client, getReadCount: () => readCount };
}

describe('continuation reads retain the live-turn contract after v5 cutover', () => {
  const live: LiveFenceRow = {
    scenarioId: SCENARIO,
    turnId: 'turn-live',
    generation: 1,
    stoppedAt: null,
    failedAt: null,
  };

  it('sees another admitted live turn, but never counts the asking turn itself', async () => {
    const db = makeLiveTurnClient([live]);
    const session = store(db.client);
    expect(await session.hasOtherAdmittedLiveTurn(SCENARIO, 'turn-asking')).toBe(true);
    expect(await session.hasOtherAdmittedLiveTurn(SCENARIO, 'turn-live')).toBe(false);
  });

  it('excludes stopped and failed turns', async () => {
    const db = makeLiveTurnClient([
      { ...live, turnId: 'turn-stopped', stoppedAt: '2026-08-16T00:00:00.000Z' },
      { ...live, turnId: 'turn-failed', failedAt: '2026-08-16T00:00:01.000Z' },
    ]);
    expect(
      await store(db.client).hasOtherAdmittedLiveTurn(SCENARIO, 'turn-asking'),
    ).toBe(false);
  });

  it('pre-column 42703 fallback still excludes stopped turns', async () => {
    const db = makeLiveTurnClient(
      [{ ...live, turnId: 'turn-stopped', stoppedAt: '2026-08-16T00:00:00.000Z' }],
      { failNewColumnOnce: true },
    );
    expect(
      await store(db.client).hasOtherAdmittedLiveTurn(SCENARIO, 'turn-asking'),
    ).toBe(false);
    expect(db.getReadCount()).toBe(2);
  });
});
