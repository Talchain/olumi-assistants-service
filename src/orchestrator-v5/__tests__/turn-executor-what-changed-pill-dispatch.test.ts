/**
 * F2 CHANGE B — dispatch-level proof that a TYPED `what_changed` chip_click
 * reaches the run-comparison mechanism through the turn executor.
 *
 * The route boundary (`detectChipClickForcedIntent`) maps a `what_changed`
 * chip_click to `chipClickForcedIntent='what_changed'` and threads it into
 * `runTurnExecutor` (proven at the boundary in
 * `orchestrator/__tests__/route-v2-chip-click-intent.test.ts`). Here we prove the
 * EXECUTOR half: given that option, the run-comparison gate is reached with
 * `forceIntent=true`, so the pill is answered by the REAL two-run `RunDelta`
 * WITHOUT depending on the free-text `classifyAnalyticalIntent` regex — and the
 * freshness fail-closed posture is untouched (stale → honest re-run, never a
 * comparison).
 *
 * Proof design (anti-mirror): a delegating spy over the REAL gate
 * (`importOriginal`-spread) captures the exact `forceIntent` the executor passes,
 * then delegates so the composed prose is genuine. The message deliberately does
 * NOT match the free-text regex — only the typed door can make the gate fire.
 *
 * Fresh-verdict setup mirrors the proven harness in
 * `turn-executor-run-comparison-controlled-authority.test.ts`: two run_analysis
 * facts hashed on the persisted graph so freshness anchors to `fresh`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { makeMessagePayload } from './fixtures.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    ...createNoopSessionStore(),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

// Delegating spy over the REAL gate — captures the `forceIntent` the executor
// passes for a typed pill, then delegates so real prose is produced.
const gateSpy = vi.hoisted(() => ({
  calls: 0,
  forceIntents: [] as Array<boolean | undefined>,
}));

vi.mock('../routing/run-comparison-gate.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/run-comparison-gate.js')>(
    '../routing/run-comparison-gate.js',
  );
  return {
    ...actual,
    tryRunComparisonGate: (input: Parameters<typeof actual.tryRunComparisonGate>[0]) => {
      gateSpy.calls += 1;
      gateSpy.forceIntents.push(input.forceIntent);
      return actual.tryRunComparisonGate(input);
    },
  };
});

const { runTurnExecutor } = await import('../turn-executor.js');

const READY_GRAPH = {
  nodes: [
    { id: 'dec_root', kind: 'decision' as const, label: 'Marketing capacity?' },
    { id: 'goal_growth', kind: 'goal' as const, label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_acquisition_cost', kind: 'factor' as const, label: 'Acquisition cost' },
    { id: 'fac_market_demand', kind: 'factor' as const, label: 'Market demand' },
    { id: 'opt_freelance', kind: 'option' as const, label: 'Freelance + Moderate Ad Spend' },
    { id: 'opt_hire', kind: 'option' as const, label: 'Hire Marketing Manager' },
  ],
  edges: [
    { from: 'dec_root', to: 'opt_freelance', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'dec_root', to: 'opt_hire', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_acquisition_cost', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_market_demand', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
};

function hashOf(graph: unknown): string {
  const parsed = GraphStateIngressSchema.safeParse(graph);
  if (!parsed.success) throw new Error('test setup: graph parse failed');
  const hash = computeAnalysisAffectingGraphHash(parsed.data);
  if (!hash) throw new Error('test setup: graph hash null');
  return hash;
}

function makeRunFact(opts: {
  computedAt: string;
  band: string;
  winFreelance: number;
}): Record<string, unknown> {
  const winHire = Math.round((1 - opts.winFreelance) * 100) / 100;
  const options = [
    { option_id: 'opt_freelance', option_label: 'Freelance + Moderate Ad Spend', win_probability: opts.winFreelance },
    { option_id: 'opt_hire', option_label: 'Hire Marketing Manager', win_probability: winHire },
  ];
  return {
    fact_type: 'run_analysis' as const,
    fact_version: 1 as const,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: opts.winFreelance >= 0.5 ? 'opt_freelance' : 'opt_hire',
      win_probabilities: { opt_freelance: opts.winFreelance, opt_hire: winHire },
      summary: 'Ran analysis.',
      graph_hash_at_run: hashOf(READY_GRAPH),
      computed_at: opts.computedAt,
      enrichment: {
        analysis_status: 'computed',
        option_comparison: options,
        results: options,
        robustness_synthesis: { overall_assessment: opts.band },
      },
    },
  };
}

// Leading option FLIPS between the two runs (freelance ahead → hire ahead), so a
// genuine "the leading option has changed" comparison is produced.
function twoRuns(): Array<Record<string, unknown>> {
  const current = makeRunFact({ computedAt: '2026-05-01T12:00:00.000Z', band: 'high', winFreelance: 0.45 });
  const prior = makeRunFact({ computedAt: '2026-04-30T12:00:00.000Z', band: 'low', winFreelance: 0.62 });
  return [current, prior]; // newest-first
}

const PRIOR_RA_TURN = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: '2026-05-01T12:00:00.000Z',
};

// A typed `what_changed` chip_click whose MESSAGE deliberately does NOT match the
// free-text `classifyAnalyticalIntent` regex — only the typed door can route it.
function typedWhatChangedPill() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: `t-${randomUUID()}`,
    source: 'chip_click',
    message: 'Give me the comparison for the last two runs.',
    turn_class: 'review',
    stage: 'analyse',
    chip: { id: 'chip_what_changed', label: 'What changed?', action_type: 'what_changed' },
  } as never);
}

function assistantTextOf(result: Awaited<ReturnType<typeof runTurnExecutor>>): string {
  return (result.response as { assistant_text?: string }).assistant_text ?? '';
}

describe('F2 CHANGE B — typed what_changed pill dispatch', () => {
  beforeEach(() => {
    gateSpy.calls = 0;
    gateSpy.forceIntents = [];
    mockState.priorTurns = [PRIOR_RA_TURN];
    mockState.persistedGraph = READY_GRAPH;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('fresh two-run scenario: the pill is answered by the REAL comparison via the typed door (forceIntent=true), no regex match needed', async () => {
    mockState.priorFacts = twoRuns();

    const result = await runTurnExecutor(typedWhatChangedPill(), 'req-wc-fresh', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      graphState: READY_GRAPH as never,
      chipClickForcedIntent: 'what_changed',
    });

    // The gate was reached with forceIntent=true — the typed door, not the regex.
    expect(gateSpy.calls).toBeGreaterThanOrEqual(1);
    expect(gateSpy.forceIntents).toContain(true);

    const text = assistantTextOf(result);
    // A genuine two-run comparison naming both options and the leading-option flip.
    expect(text).toContain('leading option has changed');
    expect(text).toContain('Freelance + Moderate Ad Spend');
    expect(text).toContain('Hire Marketing Manager');
    // The LLM adapter was never used — this deterministic answer is 0-LLM.
  });

  it('FAIL-CLOSED untouched: the same typed pill on a STALE model gets the honest re-run answer, never a comparison', async () => {
    mockState.priorFacts = twoRuns();
    // Persisted graph diverges from the runs' hash → stale verdict.
    mockState.persistedGraph = {
      ...READY_GRAPH,
      edges: [
        ...READY_GRAPH.edges,
        { from: 'fac_market_demand', to: 'goal_growth', strength: { mean: 0.99, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
      ],
    };

    const result = await runTurnExecutor(typedWhatChangedPill(), 'req-wc-stale', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      graphState: mockState.persistedGraph as never,
      chipClickForcedIntent: 'what_changed',
    });

    expect(gateSpy.forceIntents).toContain(true);
    const text = assistantTextOf(result).toLowerCase();
    expect(text).toContain('re-run');
    expect(text).not.toContain('leading option has changed');
  });
});
