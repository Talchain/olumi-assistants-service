/**
 * 1.16 item A2 — route-level test for the consented cap-extension loop.
 *
 * Turn 1 (recovery): "Set Migration Cost to £250,000" against a
 * cap-£200,000 factor. The deterministic pre-route auto-dispatches, the
 * shared predicate rejects `value_exceeds_cap`, and the recoverable
 * validator path must compose the HONEST message (the real cap conflict,
 * not "'value' needs to be a valid value.") plus the user-consented
 * "extend the scale" chip — persisting the structured {value, unit, cap}
 * pending action alongside.
 *
 * Turn 2 (replay): the chip's message ("Extend the scale for Migration
 * Cost and use the new value.") is claimed by tryClarificationResume —
 * no LLM call — which synthesises the proposal WITH the explicit cap.
 * The handler applies the value, extends the cap, and renormalises every
 * option's intervention on the factor so absolute option configurations
 * are preserved.
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

// GraphV3-valid fixture. fac_migration: £150,000 stored on the normalised
// convention against cap £200,000. Options carry interventions on it:
//   opt_a — normalised value 1 (absolute £200,000; the "intervention 1 =
//           old cap" case);
//   opt_b — pair-consistent {value: 0.5, raw_value: 100000} (£100,000).
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

const MIGRATION_GRAPH_HASH = computeAnalysisAffectingGraphHash(MIGRATION_GRAPH as never);

describe('1.16 A2 — consented cap-extension loop (route level)', () => {
  beforeEach(() => {
    appendCalls.length = 0;
    mockedPendingActions = [];
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('turn 1: over-cap set → honest recovery copy + rescale chip + persisted {value, unit, cap} pending', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload('Set Migration Cost to £250,000'), 'req-rescale-1', {
      routingAdapter: adapter,
      graphState: MIGRATION_GRAPH as never,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.commit_performed).toBe(true);

    // Honest copy: the actual cap conflict, never the generic fallback.
    expect(result.response.assistant_text).toContain('£250,000');
    expect(result.response.assistant_text).toContain('£200,000');
    expect(result.response.assistant_text).not.toContain('needs to be a valid value');

    // The consented rescale chip.
    const chip = (result.response.suggested_actions ?? []).find(
      (a) => a.id === RESCALE_EXTEND_CAP_CHIP_ID,
    );
    expect(chip).toBeDefined();
    expect(chip?.label).toBe('Set to £250,000 and extend the scale');
    expect(chip?.message).toBe('Extend the scale for Migration Cost and use the new value.');

    // The structured pending action rides the commit.
    expect(appendCalls.length).toBeGreaterThan(0);
    const write = appendCalls[0]! as {
      pending_actions?: ReadonlyArray<{
        chip_id: string;
        action: Record<string, unknown>;
        preconditions?: { graph_hash?: string };
      }>;
    };
    const pendings = write.pending_actions ?? [];
    expect(pendings).toHaveLength(1);
    expect(pendings[0]!.chip_id).toBe(RESCALE_EXTEND_CAP_CHIP_ID);
    expect(pendings[0]!.action).toMatchObject({
      kind: 'set_factor_value',
      factor_id: 'fac_migration',
      value: 250000,
      unit: '£',
      operator: 'set',
      cap: 320000, // suggestExtendedCap(250000)
    });
    expect(typeof pendings[0]!.preconditions?.graph_hash).toBe('string');
  });

  it('turn 2: chip replay resumes deterministically — value applied, cap extended, interventions preserved in absolute terms', async () => {
    mockedPendingActions = [
      {
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
          ...(MIGRATION_GRAPH_HASH != null ? { graph_hash: MIGRATION_GRAPH_HASH } : {}),
        },
        expires_at_turn_count: 2,
        expires_at_iso: '2099-12-31T23:59:59.000Z',
        emitted_at_iso: '2026-07-10T00:00:00.000Z',
      },
    ];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      payload('Extend the scale for Migration Cost and use the new value.'),
      'req-rescale-2',
      {
        routingAdapter: adapter,
        graphState: MIGRATION_GRAPH as never,
      },
    );
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.llm_calls_used).toBe(0);
    expect(result.telemetry.commit_performed).toBe(true);

    // Honest receipt: change + extended scale.
    expect(result.response.assistant_text).toContain('£250,000');
    expect(result.response.assistant_text).toContain('£320,000');

    // The committed graph carries the applied value, the extended cap,
    // and RENORMALISED option interventions (absolutes preserved).
    const graphWrite = appendCalls.find((w) => w.graph != null);
    expect(graphWrite).toBeDefined();
    const graph = graphWrite!.graph as {
      nodes: Array<{
        id: string;
        observed_state?: { value?: number; raw_value?: number; cap?: number };
        interventions?: Record<string, { value: number; raw_value?: number }>;
      }>;
    };
    const factor = graph.nodes.find((n) => n.id === 'fac_migration')!;
    expect(factor.observed_state?.raw_value).toBe(250000);
    expect(factor.observed_state?.cap).toBe(320000);
    expect(factor.observed_state?.value).toBeCloseTo(250000 / 320000, 10);

    // opt_a: value 1 meant £200,000 under the old cap → 200000/320000.
    const optA = graph.nodes.find((n) => n.id === 'opt_a')!;
    expect(optA.interventions?.fac_migration?.value).toBeCloseTo(200000 / 320000, 10);

    // opt_b: raw_value stays £100,000; value recomputed against new cap.
    const optB = graph.nodes.find((n) => n.id === 'opt_b')!;
    expect(optB.interventions?.fac_migration?.raw_value).toBe(100000);
    expect(optB.interventions?.fac_migration?.value).toBeCloseTo(100000 / 320000, 10);
  });
});
