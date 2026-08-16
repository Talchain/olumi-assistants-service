/**
 * PR #414 adversarial-review fixups — the routed D1 execute path's commit
 * chokepoint (STEP 7), two non-blocking hardening nits:
 *
 * 1. Ordering parity (fixup 2). #414's F3 re-projects `effectiveTurnGraph`
 *    onto the committed graph AFTER `commitTurn` — but `commitTurn` snapshots
 *    `contentGraph = effectiveTurnGraph` for the durable-text scrub
 *    (turn-executor.ts commitTurn wrapper), so on a committed D1 turn the
 *    STORED assistant text resolved entity-id labels against the
 *    PRE-mutation graph while the WIRE used the committed graph. The GM-held
 *    resume path already holds the correct ordering (set `effectiveTurnGraph`
 *    BEFORE commit, revert in the catch — `commitGmHeldResume`). Pinned here:
 *    the `contentGraph` the commit receives IS the committed post-mutation
 *    graph (hash parity with the persisted graph write), and a FAILED commit
 *    reverts to the pre-mutation projection (never advertises unpersisted
 *    state).
 *
 * 2. Fail-open visibility (fixup 1). When the committed graph fails the
 *    GraphV3 re-projection parse ("should be unreachable" — D1 handlers
 *    GraphV3-validate the mutated graph and the persistence merge only
 *    restores top-level fields), the executor fails open to the pre-mutation
 *    wire projection. That fallback was warn-log-only; it must also emit the
 *    frozen-registry telemetry event
 *    `v5.turn_executor.committed_graph_reprojection_failed` (content-free:
 *    correlation ids + handler id + first zod issue path) so the merge-seam /
 *    schema-drift signal is dashboard-visible.
 *
 * Scenario: the consented cap-extension replay (same fixture family as
 * turn-executor-response-projection.test.ts) — a `set_factor_value` WITH a
 * cap change on the routed/deterministic-resume path, because the cap change
 * makes the pre- vs post-mutation graphs observably different by hash.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = randomUUID();

const appendCalls: Array<Record<string, unknown>> = [];
let mockedPendingActions: ReadonlyArray<PendingAction> = [];
let appendShouldThrow = false;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      if (appendShouldThrow) {
        throw new Error('injected append failure (commit-revert pin)');
      }
      appendCalls.push(write);
      return {
        id: `row-${appendCalls.length}`,
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => mockedPendingActions,
  }),
  resetSessionStoreForTests: () => undefined,
}));

// Delegating wrapper — captures the CommitMetadata the turn-executor's
// commitTurn wrapper hands to the durable writer (incl. the `contentGraph`
// snapshot under test), then runs the REAL commit unchanged.
const commitMetadataCaptures: Array<Record<string, unknown>> = [];
vi.mock('../commit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../commit.js')>();
  return {
    ...actual,
    commitDirectAnswer: (async (
      resp: Parameters<typeof actual.commitDirectAnswer>[0],
      meta: Parameters<typeof actual.commitDirectAnswer>[1],
      store?: Parameters<typeof actual.commitDirectAnswer>[2],
    ) => {
      commitMetadataCaptures.push(meta as unknown as Record<string, unknown>);
      return actual.commitDirectAnswer(resp, meta, store);
    }) as typeof actual.commitDirectAnswer,
  };
});

// Delegating wrapper — when the corruption flag is set, returns the real
// merge result with `edges` replaced by a non-array so the STEP 7 GraphV3
// re-projection parse fails deterministically (first issue path: 'edges')
// while `nodes` stays intact for the pre-commit receipt guards.
let corruptMergedGraphEdges = false;
vi.mock('../tools/handlers/d1-shared/apply-graph-mutation.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../tools/handlers/d1-shared/apply-graph-mutation.js')>();
  return {
    ...actual,
    mergeMutatedGraphForPersistence: ((args: Parameters<typeof actual.mergeMutatedGraphForPersistence>[0]) => {
      const merged = actual.mergeMutatedGraphForPersistence(args);
      if (!corruptMergedGraphEdges) return merged;
      return { ...(merged as Record<string, unknown>), edges: 'not-an-array' };
    }) as typeof actual.mergeMutatedGraphForPersistence,
  };
});

const { runTurnExecutor } = await import('../turn-executor.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
const { RESCALE_EXTEND_CAP_CHIP_ID } = await import('../compose/validation-failure-responses.js');
const { setTestSink } = await import('../../utils/telemetry.js');

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'clarify',
    stage: 'analyse',
  });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on the deterministic rescale loop');
      }),
  };
}

const TARGET_MATCH = { node_id: 'fac_migration', match_type: 'exact_id', confidence: 'high' };

// GraphV3-valid fixture (same convention as turn-executor-response-projection):
// fac_migration £150,000 stored normalised against cap £200,000; options
// carry interventions on it.
const MIGRATION_GRAPH = {
  nodes: [
    { id: 'goal_g', kind: 'goal', label: 'Goal' },
    { id: 'dec_d', kind: 'decision', label: 'Decision' },
    {
      id: 'opt_a',
      kind: 'option',
      label: 'Option A',
      interventions: {
        fac_migration: { value: 1, source: 'user_specified', target_match: TARGET_MATCH },
      },
    },
    {
      id: 'opt_b',
      kind: 'option',
      label: 'Option B',
      interventions: {
        fac_migration: {
          value: 0.5,
          raw_value: 100000,
          source: 'user_specified',
          target_match: TARGET_MATCH,
        },
      },
    },
    {
      id: 'fac_migration',
      kind: 'factor',
      label: 'Migration Cost',
      observed_state: { value: 0.75, raw_value: 150000, unit: '£', cap: 200000 },
    },
  ],
  edges: [
    {
      from: 'dec_d',
      to: 'opt_a',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_a',
      to: 'fac_migration',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'opt_b',
      to: 'fac_migration',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
    {
      from: 'fac_migration',
      to: 'goal_g',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive' as const,
    },
  ],
};

const PRE_MUTATION_HASH = computeAnalysisAffectingGraphHash(MIGRATION_GRAPH as never);

/** The consented cap-extension pending (as persisted by turn 1 of the loop). */
function rescalePending(): PendingAction {
  return {
    id: `pa-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    chip_id: RESCALE_EXTEND_CAP_CHIP_ID,
    action: {
      kind: 'set_factor_value',
      factor_id: 'fac_migration',
      value: 250000,
      unit: '£',
      operator: 'set',
      cap: 320000,
    },
    preconditions: {
      target_entity_ids: ['fac_migration'],
      ...(PRE_MUTATION_HASH != null ? { graph_hash: PRE_MUTATION_HASH } : {}),
    },
    expires_at_turn_count: 2,
    expires_at_iso: '2099-12-31T23:59:59.000Z',
    emitted_at_iso: '2026-07-10T00:00:00.000Z',
  };
}

function runRescaleTurn(requestId: string) {
  return runTurnExecutor(
    payload('Extend the scale for Migration Cost and use the new value.'),
    requestId,
    {
      routingAdapter: throwingRoutingAdapter(),
      graphState: MIGRATION_GRAPH as never,
    },
  );
}

describe('STEP 7 commit — contentGraph ordering parity + fail-open telemetry (PR #414 review fixups)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    commitMetadataCaptures.length = 0;
    mockedPendingActions = [rescalePending()];
    appendShouldThrow = false;
    corruptMergedGraphEdges = false;
  });
  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  it('fixup 2 (ordering parity) — the durable-text scrub graph (contentGraph) IS the committed post-mutation graph, same as the wire', async () => {
    const result = await runRescaleTurn('req-content-graph-parity');
    expect(result.telemetry.commit_performed).toBe(true);

    // The graph-bearing commit's metadata, as handed to the durable writer.
    const graphCommitMeta = commitMetadataCaptures.find((m) => m.graph != null);
    expect(graphCommitMeta).toBeDefined();

    const committedHash = computeAnalysisAffectingGraphHash(
      graphCommitMeta!.graph as never,
    );
    expect(committedHash).not.toBeNull();
    expect(committedHash).not.toBe(PRE_MUTATION_HASH);

    // THE FIX — commitTurn's contentGraph snapshot (the graph the durable
    // assistant-text scrub resolves labels against) is the COMMITTED
    // post-mutation graph, not the STEP-0 pre-mutation parse. Pre-fix this
    // was PRE_MUTATION_HASH: stored text scrubbed against the pre-mutation
    // graph while the wire egress used the committed graph.
    expect(graphCommitMeta!.contentGraph).toBeDefined();
    expect(
      computeAnalysisAffectingGraphHash(graphCommitMeta!.contentGraph as never),
    ).toBe(committedHash);
  });

  it('fixup 2 (revert guard) — a FAILED commit reverts the pre-commit projection: the turn never advertises unpersisted state', async () => {
    appendShouldThrow = true;
    const result = await runRescaleTurn('req-content-graph-revert');
    expect(result.telemetry.commit_performed).toBe(false);
    expect(result.telemetry.failure_type).not.toBeNull();
    // The egress/label graph is back at (or still on) the pre-mutation
    // projection — GM-held parity (commitGmHeldResume's catch revert).
    expect(
      computeAnalysisAffectingGraphHash(result.effectiveGraph as never),
    ).toBe(PRE_MUTATION_HASH);
  });

  it('canonical receipt barrier — a malformed committed graph emits no success receipt', async () => {
    corruptMergedGraphEdges = true;
    const telemetryEvents: Array<{ name: string; data: Record<string, unknown> }> = [];
    setTestSink((name, data) => telemetryEvents.push({ name, data }));

    const result = await runRescaleTurn('req-reprojection-fail-open');

    // Receipt/readiness authority now runs before the irreversible append:
    // malformed canonical bytes fail closed without writing a turn or graph.
    expect(result.telemetry.commit_performed).toBe(false);
    expect(appendCalls).toHaveLength(0);
    // The internal egress graph also reverts rather than attesting malformed
    // bytes that were never persisted.
    expect(result.telemetry.failure_type).toBe('INTERNAL_ERROR');
    expect(
      computeAnalysisAffectingGraphHash(result.effectiveGraph as never),
    ).toBe(PRE_MUTATION_HASH);
    const optA = result.analysisReady?.options.find((o) => o.option_id === 'opt_a');
    expect(optA?.interventions.fac_migration).toBe(1);

    expect(result.response.draft_graph).toBeUndefined();
    expect(result.response.graph_hash).toBeUndefined();
    expect(
      telemetryEvents.find(
        (e) => e.name === 'v5.turn_executor.committed_graph_reprojection_failed',
      ),
    ).toBeUndefined();
  });
});
