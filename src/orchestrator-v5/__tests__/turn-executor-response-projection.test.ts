/**
 * F3 (response projection, 1.16 run-3 diagnosis) — the routed D1 execute
 * path must project the APPLIED mutation onto the wire response.
 *
 * Defect under test (proven live, run-3 + DB probe): after a successful
 * commit on the routed D1 execute path, the turn-executor deliberately left
 * `analysisReadyForTurn` (the payload the response-finaliser stamps as
 * `analysis_ready`, carrying the option interventions) and
 * `effectiveTurnGraph` (the egress label graph + the diagnostic trace's
 * `correlation_ids.graph_hash` source) at their PRE-mutation values from the
 * per-turn parse — while wire freshness was re-derived from the POST-mutation
 * hash. The wire therefore paired a post-mutation `current_graph_hash` with
 * pre-mutation option interventions: the canvas showed the OLD absolutes
 * (live specimen: £320k/£80k) although scenarios.graph held the correct
 * renormalised values. The GM-held resume path already recomputed both
 * post-commit (`commitGmHeldResume`); the routed path did not.
 *
 * Fix under test: the STEP 7 post-commit block re-projects
 * `analysisReadyForTurn = computeStructuralReadiness(committed graph)` and
 * `effectiveTurnGraph = GraphV3(committed graph)` after (and only after) a
 * successful graph-bearing commit.
 *
 * Scenario: the consented cap-extension replay (same fixture family as
 * rescale-cap-chip-route-level.test.ts) — a `set_factor_value` WITH a cap
 * change on the routed/deterministic-resume path, because a cap change
 * renormalises every option's stored intervention and therefore makes the
 * pre- vs post-mutation readiness payloads observably different.
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

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
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

const { runTurnExecutor } = await import('../turn-executor.js');
const { computeAnalysisAffectingGraphHash } = await import('../context/graph-hash.js');
const { RESCALE_EXTEND_CAP_CHIP_ID } = await import('../compose/validation-failure-responses.js');

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

// GraphV3-valid fixture (same convention as rescale-cap-chip-route-level):
// fac_migration £150,000 stored normalised against cap £200,000; options
// carry interventions on it — opt_a normalised 1 (absolute £200,000),
// opt_b pair-consistent {value: 0.5, raw_value: 100000} (£100,000).
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

describe('F3 — routed D1 execute path projects the applied mutation onto the wire', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    mockedPendingActions = [rescalePending()];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('set_factor_value with cap change: analysis_ready interventions match the POST-mutation graph, and the correlation/egress graph is the committed graph (hash parity)', async () => {
    const result = await runTurnExecutor(
      payload('Extend the scale for Migration Cost and use the new value.'),
      'req-projection-f3',
      {
        routingAdapter: throwingRoutingAdapter(),
        graphState: MIGRATION_GRAPH as never,
      },
    );
    expect(result.telemetry.commit_performed).toBe(true);

    // The committed graph (what append_turn_atomic persisted).
    const graphWrite = appendCalls.find((w) => w.graph != null);
    expect(graphWrite).toBeDefined();
    const committed = graphWrite!.graph as {
      nodes: Array<{
        id: string;
        observed_state?: { cap?: number };
        interventions?: Record<string, { value: number; raw_value?: number }>;
      }>;
    };
    // Sanity: the mutation really renormalised the committed interventions.
    expect(
      committed.nodes.find((n) => n.id === 'opt_a')!.interventions!.fac_migration!.value,
    ).toBeCloseTo(200000 / 320000, 10);

    // THE FIX, part 1 — the readiness payload the finaliser stamps as
    // `analysis_ready` carries the POST-mutation interventions. Pre-fix it
    // was the STEP-0 parse of the request graph: opt_a 1 (≡ £320,000 under
    // the new cap — the live £320k specimen) and opt_b 0.5 (≡ £160,000).
    expect(result.analysisReady).toBeDefined();
    const optionsById = new Map(
      result.analysisReady!.options.map((o) => [o.option_id, o]),
    );
    expect(optionsById.get('opt_a')!.interventions.fac_migration).toBeCloseTo(
      200000 / 320000,
      10,
    );
    expect(optionsById.get('opt_b')!.interventions.fac_migration).toBeCloseTo(
      100000 / 320000,
      10,
    );

    // THE FIX, part 2 — `effectiveGraph` (route-v2's egress label graph AND
    // the diagnostic trace's `correlation_ids.graph_hash` source) is the
    // COMMITTED graph, not the pre-mutation request parse: its
    // analysis-affecting hash equals the committed graph's hash and has
    // moved off the pre-mutation anchor.
    expect(result.effectiveGraph).not.toBeNull();
    const effectiveHash = computeAnalysisAffectingGraphHash(
      result.effectiveGraph as never,
    );
    const committedHash = computeAnalysisAffectingGraphHash(committed as never);
    expect(committedHash).not.toBeNull();
    expect(effectiveHash).toBe(committedHash);
    expect(effectiveHash).not.toBe(PRE_MUTATION_HASH);
    const effectiveFactor = (
      result.effectiveGraph as {
        nodes: Array<{ id: string; observed_state?: { cap?: number } }>;
      }
    ).nodes.find((n) => n.id === 'fac_migration');
    expect(effectiveFactor?.observed_state?.cap).toBe(320000);

    // Wire-pairing honesty: the freshness derivation that stamps
    // `analysis_ready.current_graph_hash` agrees with the committed hash —
    // the exact pairing that was broken live (post-mutation hash alongside
    // pre-mutation interventions).
    expect(result.freshness?.current_graph_hash).toBe(committedHash);
  });

  it('non-mutating turn: the wire projection is untouched (no graph committed, readiness stays the request-graph view)', async () => {
    mockedPendingActions = [];
    const result = await runTurnExecutor(
      payload('Set Migration Cost to £250,000'),
      'req-projection-f3-recovery',
      {
        routingAdapter: throwingRoutingAdapter(),
        graphState: MIGRATION_GRAPH as never,
      },
    );
    // Turn 1 of the loop is the over-cap RECOVERY turn — nothing commits a
    // graph, so the pre-mutation projection remains the honest one.
    expect(appendCalls.find((w) => w.graph != null)).toBeUndefined();
    expect(
      computeAnalysisAffectingGraphHash(result.effectiveGraph as never),
    ).toBe(PRE_MUTATION_HASH);
    const optA = result.analysisReady?.options.find((o) => o.option_id === 'opt_a');
    expect(optA?.interventions.fac_migration).toBe(1);
  });
});
