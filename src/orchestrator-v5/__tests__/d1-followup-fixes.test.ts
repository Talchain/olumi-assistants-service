/**
 * V5 D1 follow-up bug fixes (P0-2 / P1-3 / P1-5 / P1-6).
 *
 * Each fix has a focused test that pins the regression so a future change
 * can't silently revert the contract:
 *
 *   - P0-2: loadScenarioSnapshotForRunAnalysis must surface
 *     graph.goal_constraints on the snapshot so PLoT receives them.
 *   - P1-3: post-handler freshness uses the mutated_graph hash, so a
 *     value mutation correctly marks any prior analysis stale on the
 *     same response.
 *   - P1-5: capped factors reject rawInput > cap when a unit is supplied.
 *   - P1-6: AdjustEdgeStrengthStdSchema rejects std === 0.
 */

import { describe,expect,it,vi } from 'vitest';

import type { GraphV3T } from '../../schemas/cee-v3.js';
import { AdjustEdgeStrengthStdSchema } from '../tools/handlers/adjust-edge-strength.js';
import { buildD1Fixture } from '../tools/handlers/d1-shared/__tests__/fixtures.js';
import { D1HandlerError } from '../tools/handlers/d1-shared/errors.js';
import { normaliseFactorValue } from '../tools/handlers/d1-shared/normalise-factor-value.js';
import { SET_FACTOR_VALUE_USER_GUIDANCE } from '../tools/handlers/d1-shared/user-guidance.js';
import { makeMessagePayload } from './fixtures.js';

// -------------------------------------------------------------------------
// P1-5: capped factor rejects rawInput > cap when unit supplied
// -------------------------------------------------------------------------

describe('P1-5 — normaliseFactorValue rejects over-cap when unit supplied', () => {
  it('rejects 150% on a 100% cap', () => {
    expect(() =>
      normaliseFactorValue({
        rawInput: 150,
        unit: '%',
        proposalCap: 100,
        inputHasUnit: true,
      }),
    ).toThrow(D1HandlerError);
  });

  it('error message names both the value and the cap (percentage formatting)', () => {
    let caught: D1HandlerError | null = null;
    try {
      normaliseFactorValue({
        rawInput: 150,
        unit: '%',
        proposalCap: 100,
        inputHasUnit: true,
      });
    } catch (err) {
      caught = err as D1HandlerError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.code).toBe('PARAMETER_INVALID');
    // Percentage formatting: "150%" / "100%", no stray spaces.
    expect(caught?.message).toContain('150%');
    expect(caught?.message).toContain('100%');
    expect(caught?.message).not.toMatch(/\d\s+%/);
    expect(caught?.message).toContain('exceeds');
    // P1.1 follow-up (P1.2, commit 8f0dc939): `userGuidance` is the
    // handler's canonical War-Room-locked recovery phrase — the detailed
    // value/cap wording lives on `message` (the predicate's
    // `specific_issue`), which the recoverable composer surfaces when
    // present. See d1-shared/user-guidance.ts.
    expect(caught?.userGuidance).toBe(SET_FACTOR_VALUE_USER_GUIDANCE);
  });

  it('formats currency caps with prefix unit and thousands separators', () => {
    // Reuses formatValueWithUnit so currency reads as "£150,000" /
    // "£100,000", not "150000£" suffix. Exercises the polish noted in
    // the post-D1 review.
    let caught: D1HandlerError | null = null;
    try {
      normaliseFactorValue({
        rawInput: 150000,
        unit: '£',
        proposalCap: 100000,
        inputHasUnit: true,
      });
    } catch (err) {
      caught = err as D1HandlerError;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toContain('£150,000');
    expect(caught?.message).toContain('£100,000');
    // P1.1 follow-up (P1.2, commit 8f0dc939): the formatted values live on
    // `message` / `specific_issue`; `userGuidance` is the canonical
    // War-Room-locked phrase and must NOT leak parameter detail.
    expect(caught?.userGuidance).toBe(SET_FACTOR_VALUE_USER_GUIDANCE);
  });

  it('rejects negative raw_value when unit supplied', () => {
    expect(() =>
      normaliseFactorValue({
        rawInput: -5,
        unit: '%',
        proposalCap: 100,
        inputHasUnit: true,
      }),
    ).toThrow(D1HandlerError);
  });

  it('still accepts in-range with unit', () => {
    const result = normaliseFactorValue({
      rawInput: 50,
      unit: '%',
      proposalCap: 100,
      inputHasUnit: true,
    });
    expect(result).toEqual({ raw_value: 50, value: 0.5 });
  });

  it('boundary case: rawInput exactly equal to cap is accepted', () => {
    const result = normaliseFactorValue({
      rawInput: 100,
      unit: '%',
      proposalCap: 100,
      inputHasUnit: true,
    });
    expect(result).toEqual({ raw_value: 100, value: 1 });
  });
});

// -------------------------------------------------------------------------
// P1-6: AdjustEdgeStrengthStdSchema rejects std === 0
// -------------------------------------------------------------------------

describe('P1-6 — adjust_edge_strength std must be > 0', () => {
  it('rejects 0', () => {
    const result = AdjustEdgeStrengthStdSchema.safeParse(0);
    expect(result.success).toBe(false);
  });

  it('rejects negative', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(-0.1).success).toBe(false);
  });

  it('accepts a small positive', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(0.0001).success).toBe(true);
  });

  it('accepts the upper bound 0.5', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(0.5).success).toBe(true);
  });

  it('rejects above 0.5', () => {
    expect(AdjustEdgeStrengthStdSchema.safeParse(0.51).success).toBe(false);
  });
});

// -------------------------------------------------------------------------
// P0-2: scenario snapshot includes goal_constraints
// -------------------------------------------------------------------------

/**
 * Snapshot admission now uses the canonical whole-model gate. The shared D1
 * handler fixture intentionally has one option and an orphan factor, so extend
 * it here with the minimum real decision/option/factor paths needed by these
 * loader tests instead of weakening admission or asserting against a fake
 * "ready" model.
 */
function buildReadyD1SnapshotGraph(): GraphV3T {
  const base = buildD1Fixture();
  return {
    ...base,
    nodes: [
      ...base.nodes
        .filter((node) => node.id !== 'f-uncapped' && node.id !== 'f-quality')
        .map((node) =>
          node.id === 'o-launch'
            ? { ...node, interventions: { 'f-budget': 1, 'f-churn': 0.04 } }
            : node,
        ),
      { id: 'd-launch', kind: 'decision', label: 'Launch timing' },
      {
        id: 'o-defer',
        kind: 'option',
        label: 'Defer launch',
        interventions: { 'f-budget': 0, 'f-churn': 0.05 },
      },
    ],
    edges: [
      ...base.edges.filter(
        (edge) => edge.from !== 'f-quality' && edge.to !== 'f-quality',
      ),
      {
        from: 'd-launch',
        to: 'o-launch',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      {
        from: 'd-launch',
        to: 'o-defer',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      {
        from: 'o-launch',
        to: 'f-budget',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      {
        from: 'o-defer',
        to: 'f-budget',
        strength: { mean: 0.01, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
      },
      {
        from: 'o-launch',
        to: 'f-churn',
        strength: { mean: -0.4, std: 0.05 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
      {
        from: 'o-defer',
        to: 'f-churn',
        strength: { mean: -0.2, std: 0.05 },
        exists_probability: 0.9,
        effect_direction: 'negative',
      },
    ],
  };
}

describe('P0-2 — loadScenarioSnapshotForRunAnalysis surfaces goal_constraints', () => {
  it('forwards graph.goal_constraints to snapshot.goal_constraints', async () => {
    const graphWithConstraints: GraphV3T = {
      ...buildReadyD1SnapshotGraph(),
      goal_constraints: [
        {
          constraint_id: 'gc-test-1',
          node_id: 'f-churn',
          operator: '<=',
          value: 5,
          unit: '%',
          label: 'Churn cap',
          provenance: 'explicit',
        },
      ],
    };

    const fakeStore = {
      readMostRecentPendingActions: async () => [],
      append: async () => ({ id: 'mock-row-id' }),
      readRecent: async () => [],
      readFactsFor: async () => [],
      invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' as const }),
      invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' as const }),
      loadGraph: async () => graphWithConstraints as unknown,
      loadGraphAndBriefText: async () => ({
        graph: graphWithConstraints as unknown,
        briefText: null,
      }),
      ensureScenarioExists: async () => ({ user_id: null }),
    };

    const { loadScenarioSnapshotForRunAnalysis } = await import('../build-turn-context.js');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(
      'scn-test',
      'req-test',
      // Cast satisfies the SessionStore interface for this scoped test.
      fakeStore as unknown as Parameters<typeof loadScenarioSnapshotForRunAnalysis>[2],
    );
    expect(snapshot.goal_constraints).toBeDefined();
    expect(Array.isArray(snapshot.goal_constraints)).toBe(true);
    expect((snapshot.goal_constraints as Array<{ constraint_id: string }>)[0].constraint_id).toBe(
      'gc-test-1',
    );
  });

  it('omits goal_constraints when the graph has none', async () => {
    const graphWithoutConstraints = buildReadyD1SnapshotGraph();
    const fakeStore = {
      readMostRecentPendingActions: async () => [],
      append: async () => ({ id: 'mock-row-id' }),
      readRecent: async () => [],
      readFactsFor: async () => [],
      invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' as const }),
      invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' as const }),
      loadGraph: async () => graphWithoutConstraints as unknown,
      loadGraphAndBriefText: async () => ({
        graph: graphWithoutConstraints as unknown,
        briefText: null,
      }),
      ensureScenarioExists: async () => ({ user_id: null }),
    };

    const { loadScenarioSnapshotForRunAnalysis } = await import('../build-turn-context.js');
    const snapshot = await loadScenarioSnapshotForRunAnalysis(
      'scn-test',
      'req-test',
      fakeStore as unknown as Parameters<typeof loadScenarioSnapshotForRunAnalysis>[2],
    );
    expect(snapshot.goal_constraints).toBeUndefined();
  });

  it('snapshot.goal_constraints reaches the PLoT run payload via the run_analysis handler', async () => {
    // End-to-end coverage: the snapshot field is meaningless unless the
    // handler actually forwards it. Mock the PLoT client's `run` to
    // capture the payload, then assert the forwarded `goal_constraints`
    // matches what the snapshot carried.
    const { createRunAnalysisHandler } = await import(
      '../tools/handlers/run-analysis.js'
    );
    const goalConstraints = [
      {
        constraint_id: 'gc-test-2',
        node_id: 'f-churn',
        operator: '<=' as const,
        value: 5,
        unit: '%',
        label: 'Churn cap',
        provenance: 'explicit' as const,
      },
    ];

    let capturedPayload: Record<string, unknown> | null = null;
    const fakePlotClient = {
      run: async (payload: Record<string, unknown>) => {
        capturedPayload = payload;
        return {
          analysis_status: 'completed',
          results: [{ option_id: 'o-launch', win_probability: 0.6 }],
        } as unknown as Awaited<
          ReturnType<
            Awaited<ReturnType<typeof createRunAnalysisHandler>>
          > extends infer _R ? unknown : never
        >;
      },
      validatePatch: async () => {
        throw new Error('not used in this test');
      },
    } as unknown as Parameters<typeof createRunAnalysisHandler>[0]['plotClient'];

    // The baseline gate (row 2.1085, PR #926 round 3) refuses a CAPLESS factor
    // whose observed baseline sits outside [0,1] — the shared fixture's
    // `f-uncapped` ({value: 12, raw_value: 12}) is exactly that class, and this
    // test's question is goal_constraints FORWARDING, not scale. Localised:
    // carry the same magnitude as a framed pair (level 0.12, raw 12).
    const scaleCoherentFixture = () => {
      const g = buildD1Fixture();
      return {
        ...g,
        nodes: g.nodes.map((n) =>
          n.id === 'f-uncapped'
            ? { ...n, observed_state: { ...n.observed_state, value: 0.12, raw_value: 12 } }
            : n,
        ),
      };
    };
    const handler = createRunAnalysisHandler({
      plotClient: fakePlotClient,
      scenarioReader: async () => ({
        graph: scaleCoherentFixture() as unknown as never,
        options: [
          { id: 'o-launch', option_id: 'o-launch', label: 'Launch now', interventions: { 'f-churn': 1 } },
          // R2: a distinct setting preserves this constraint-forwarding witness at the client seam.
          { id: 'o-defer', option_id: 'o-defer', label: 'Defer launch', interventions: { 'f-churn': 0 } },
        ],
        goal_node_id: 'g-revenue',
        goal_constraints: goalConstraints,
        rawPersistedGraph: scaleCoherentFixture(),
      }),
    });

    const SCN_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const TURN_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    await handler({
      context: {
        session_id: SCN_UUID,
        stage: 'analyse',
        request_id: 'req-rg',
        prior_turns: [],
        prior_facts: [],
        scenarioBriefText: null,
        persistedGraph: null,
      } as never,
      payload: makeMessagePayload({
        scenario_id: SCN_UUID,
        turn_id: TURN_UUID,
        stage: 'analyse',
        turn_class: 'decide',
        message: 'run the analysis',
      }) as never,
      requestId: 'req-rg',
      signal: new AbortController().signal,
      orientationText: '',
    });

    expect(capturedPayload).not.toBeNull();
    expect((capturedPayload as Record<string, unknown>).goal_constraints).toEqual(
      goalConstraints,
    );
  });
});

// -------------------------------------------------------------------------
// P1-3: post-handler freshness uses mutated graph hash
// -------------------------------------------------------------------------

const appendCalls: Array<{
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
}> = [];

// Module-state-driven mock so tests can inject prior turns/facts before
// each invocation. The turn-executor pulls prior_facts via
// build-turn-context's session-store reads, so injecting at this seam
// surfaces them on context.prior_facts at execute time.
const mockState: {
  priorTurns: ReadonlyArray<Record<string, unknown>>;
  priorFacts: ReadonlyArray<Record<string, unknown>>;
} = {
  priorTurns: [],
  priorFacts: [],
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    readMostRecentPendingActions: async () => [],
    append: async (write: { graph?: unknown; handler_id?: unknown; handler_facts?: unknown }) => {
      appendCalls.push(write);
      return { id: 'mock-row-id' };
    },
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    // Production parity: `SupabaseSessionStore.readFactsFor` delegates to
    // `readFactsWithTurnFor` (single source of truth). The mockState in
    // this file already carries paired `priorTurns` / `priorFacts` arrays
    // — bind each fact to its corresponding turn by index, matching the
    // way each test setup populates them in lockstep. Falls through to
    // empty `turn_id` / current timestamp if the arrays are misaligned
    // (no test currently sets that up, but the guard keeps the helper
    // defensive).
    readFactsWithTurnFor: async () =>
      mockState.priorFacts.map((fact, idx) => {
        const turn = mockState.priorTurns[idx] as
          | { id?: string; created_at?: string }
          | undefined;
        return {
          fact,
          turn_id: turn?.id ?? '',
          fact_created_at: turn?.created_at ?? new Date().toISOString(),
        };
      }),
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));
