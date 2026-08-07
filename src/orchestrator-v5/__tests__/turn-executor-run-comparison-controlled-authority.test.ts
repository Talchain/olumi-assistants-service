/**
 * Data Authority & Claim Safety — run-comparison controlled-factor authority.
 *
 * The run-comparison gate ("what changed?") diffs the two newest run_analysis
 * facts and can say "<factor> now has more/less influence on the outcome than
 * before." An option-controlled lever (a factor an option intervenes on) must
 * NEVER be reported that way — it is pinned by the option, not independently
 * tunable. The turn-executor threads the option-controlled-factor set into the
 * gate; the set is derived from a graph authority.
 *
 * Under client lag the request graph (`options.graphState`) can be stale and not
 * yet echo the intervention, while the persisted graph (`context.persistedGraph`)
 * is canonical. Freshness for the same turn already anchors the current-graph
 * hash to `context.persistedGraph` ("NOT the request-supplied graphStateForTurn",
 * turn-executor.ts ~957-987), so the controlled-ID authority must anchor there
 * too. The sibling ContextPack top-driver and routed what_would_flip surfaces
 * were already made persisted-first by #314/#309; this gate was deferred and
 * (before this fix) read the request graph FIRST.
 *
 *   RED  (request-first): a stale request graph with NO interventions yields an
 *        EMPTY controlled set, so the pinned lever `fac_acquisition_cost` is not
 *        suppressed and the prose names it.
 *   GREEN (persisted-first): the controlled set is read from the canonical
 *        persisted graph, the lever is suppressed, and a genuine non-pinned
 *        factor (`fac_market_demand`) becomes the named mover instead.
 *
 * Proof design:
 *   - Seam-spy (authoritative): a delegating mock of `tryRunComparisonGate`
 *     captures the EXACT `interventionControlledFactorIds` the turn-executor
 *     computes from the graph-authority expression, then delegates to the real
 *     gate so real prose is still produced. Cannot be affected by comments/prose.
 *   - Full-composer (corroborating): asserts on the real assistant text.
 *   - No-controlled / common-path: persisted === request === interventionless →
 *     the controlled set is empty under BOTH authorities → the swap is inert.
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

// Spread the shared, interface-conformant noop store (so a future required
// `SessionStore` member cannot silently vanish from this mock) and override only
// the reads this test drives dynamically off `mockState`.
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

/**
 * Seam-spy: delegating mock of the run-comparison gate. Captures the exact
 * `interventionControlledFactorIds` the turn-executor passes (i.e. the value the
 * graph-authority expression produces) and delegates to the REAL implementation
 * so the composed prose is genuine. `vi.hoisted` so the capture holder is
 * available inside the hoisted `vi.mock` factory.
 */
const gateSpy = vi.hoisted(() => ({
  calls: 0,
  controlledIds: [] as Array<ReadonlySet<string> | undefined>,
}));

vi.mock('../routing/run-comparison-gate.js', async () => {
  const actual = await vi.importActual<typeof import('../routing/run-comparison-gate.js')>(
    '../routing/run-comparison-gate.js',
  );
  return {
    ...actual,
    tryRunComparisonGate: (input: Parameters<typeof actual.tryRunComparisonGate>[0]) => {
      gateSpy.calls += 1;
      gateSpy.controlledIds.push(input.interventionControlledFactorIds);
      return actual.tryRunComparisonGate(input);
    },
  };
});

const { runTurnExecutor } = await import('../turn-executor.js');

/**
 * Canonical (persisted) graph: BOTH options intervene on `fac_acquisition_cost`,
 * so it is an option-pinned lever (`collectInterventionControlledFactorIds`
 * returns `{fac_acquisition_cost}`). `fac_market_demand`, `fac_seasonality`, and
 * `fac_brand_awareness` are genuine external/tunable factors (no option
 * intervenes on them).
 */
const READY_GRAPH = {
  nodes: [
    { id: 'dec_root', kind: 'decision' as const, label: 'Marketing capacity?' },
    { id: 'goal_growth', kind: 'goal' as const, label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_acquisition_cost', kind: 'factor' as const, label: 'Acquisition cost' },
    { id: 'fac_market_demand', kind: 'factor' as const, label: 'Market demand' },
    { id: 'fac_seasonality', kind: 'factor' as const, label: 'Seasonality' },
    { id: 'fac_brand_awareness', kind: 'factor' as const, label: 'Brand awareness' },
    { id: 'opt_freelance', kind: 'option' as const, label: 'Freelance + Moderate Ad Spend', interventions: { fac_acquisition_cost: 0.55 } },
    { id: 'opt_hire', kind: 'option' as const, label: 'Hire Marketing Manager', interventions: { fac_acquisition_cost: 0.7 } },
  ],
  edges: [
    { from: 'dec_root', to: 'opt_freelance', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'dec_root', to: 'opt_hire', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'opt_freelance', to: 'fac_acquisition_cost', strength: { mean: 0.55, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
    { from: 'opt_hire', to: 'fac_acquisition_cost', strength: { mean: 0.7, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' as const },
    { from: 'fac_acquisition_cost', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_market_demand', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_seasonality', to: 'goal_growth', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_brand_awareness', to: 'goal_growth', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
};

/**
 * Stale request graph: SAME node/option identities, but NO interventions →
 * `collectInterventionControlledFactorIds` returns the EMPTY set. Also reused as
 * the interventionless graph for the inert common-path test.
 */
const STALE_REQUEST_GRAPH = {
  nodes: [
    { id: 'dec_root', kind: 'decision' as const, label: 'Marketing capacity?' },
    { id: 'goal_growth', kind: 'goal' as const, label: 'Customer growth', goal_threshold: 0.8 },
    { id: 'fac_acquisition_cost', kind: 'factor' as const, label: 'Acquisition cost' },
    { id: 'fac_market_demand', kind: 'factor' as const, label: 'Market demand' },
    { id: 'fac_seasonality', kind: 'factor' as const, label: 'Seasonality' },
    { id: 'fac_brand_awareness', kind: 'factor' as const, label: 'Brand awareness' },
    { id: 'opt_freelance', kind: 'option' as const, label: 'Freelance + Moderate Ad Spend' },
    { id: 'opt_hire', kind: 'option' as const, label: 'Hire Marketing Manager' },
  ],
  edges: [
    { from: 'dec_root', to: 'opt_freelance', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'dec_root', to: 'opt_hire', strength: { mean: 1, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_acquisition_cost', to: 'goal_growth', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_market_demand', to: 'goal_growth', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_seasonality', to: 'goal_growth', strength: { mean: 0.4, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
    { from: 'fac_brand_awareness', to: 'goal_growth', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const },
  ],
};

function hashOf(graph: unknown): string {
  const parsed = GraphStateIngressSchema.safeParse(graph);
  if (!parsed.success) throw new Error('test setup: graph parse failed');
  const hash = computeAnalysisAffectingGraphHash(parsed.data);
  if (!hash) throw new Error('test setup: graph hash null');
  return hash;
}

const AC = { id: 'fac_acquisition_cost', label: 'Acquisition cost' };
const MD = { id: 'fac_market_demand', label: 'Market demand' };
const SN = { id: 'fac_seasonality', label: 'Seasonality' };
const BR = { id: 'fac_brand_awareness', label: 'Brand awareness' };

interface Driver {
  readonly id: string;
  readonly label: string;
  readonly sensitivity: number;
}

/**
 * Build a successful run_analysis fact. `option_comparison` (used by the
 * option-identity freshness guard) and `results` (projected into top_drivers)
 * are derived from ONE option source so the two never drift; drivers hang off
 * the leading option only. Hashed on `hashGraph` so freshness anchors correctly.
 */
function makeRunFact(opts: {
  hashGraph: unknown;
  computedAt: string;
  band: string;
  winFreelance: number;
  drivers: readonly Driver[];
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
      leading_option_id: 'opt_freelance',
      win_probabilities: { opt_freelance: opts.winFreelance, opt_hire: winHire },
      summary: 'Ran analysis.',
      graph_hash_at_run: hashOf(opts.hashGraph),
      computed_at: opts.computedAt,
      enrichment: {
        analysis_status: 'computed',
        option_comparison: options,
        results: [
          {
            ...options[0],
            factor_sensitivity: opts.drivers.map((d) => ({
              node_id: d.id,
              label: d.label,
              sensitivity: d.sensitivity,
              // DGAI #341: driver ranking reads influence_score only.
              influence_score: Math.abs(d.sensitivity),
              direction: 'increases',
            })),
          },
          options[1],
        ],
        robustness_synthesis: { overall_assessment: opts.band },
      },
    },
  };
}

/**
 * Two runs whose top_drivers move so that, WITHOUT suppression, Acquisition cost
 * is the STRICT largest rank-mover and, AFTER suppressing it, Market demand is
 * the STRICT largest surviving mover — so the named mover is decided by rank
 * magnitude, never by the alphabetical label tiebreak.
 *
 *   prior ranks   (by |sensitivity|):  Seasonality 1, Brand 2, Market demand 3, Acquisition cost 4
 *   current ranks (by |sensitivity|):  Acquisition cost 1, Market demand 2, Seasonality 3, Brand 4
 *
 *   unguarded movers: Acquisition cost 4→1 (|Δ|=3)  >  Seasonality/Brand (|Δ|=2)  >  Market demand (|Δ|=1)
 *   guarded  movers (Acquisition cost dropped): Market demand 3→1 (|Δ|=2)  >  Seasonality/Brand (|Δ|=1)
 *
 * Returned newest-first, per the loader convention `compare-runs` relies on.
 */
function twoRuns(hashGraph: unknown): Array<Record<string, unknown>> {
  const current = makeRunFact({
    hashGraph,
    computedAt: '2026-05-01T12:00:00.000Z',
    band: 'high', // stable
    winFreelance: 0.6, // margin 20pp
    drivers: [
      { ...AC, sensitivity: 0.9 },
      { ...MD, sensitivity: 0.7 },
      { ...SN, sensitivity: 0.5 },
      { ...BR, sensitivity: 0.3 },
    ],
  });
  const prior = makeRunFact({
    hashGraph,
    computedAt: '2026-04-30T12:00:00.000Z',
    band: 'low', // fragile
    winFreelance: 0.62, // margin 24pp → narrowed
    drivers: [
      { ...SN, sensitivity: 0.9 },
      { ...BR, sensitivity: 0.7 },
      { ...MD, sensitivity: 0.5 },
      { ...AC, sensitivity: 0.3 },
    ],
  });
  return [current, prior];
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

function whatChangedPayload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: `t-${randomUUID()}`,
    message: 'What changed?',
    turn_class: 'decide',
    stage: 'analyse',
  });
}

function assistantTextOf(result: Awaited<ReturnType<typeof runTurnExecutor>>): string {
  return (result.response as { assistant_text?: string }).assistant_text ?? '';
}

describe('run-comparison controlled-factor authority (persisted-first)', () => {
  beforeEach(() => {
    gateSpy.calls = 0;
    gateSpy.controlledIds = [];
    mockState.priorTurns = [PRIOR_RA_TURN];
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('seam-spy: the controlled set passed to the gate is read from the PERSISTED graph, not the stale request graph', async () => {
    // Client-lag divergence: persisted graph pins `fac_acquisition_cost` (both
    // options intervene), request graph is stale and pins nothing. Facts are
    // hashed on the persisted graph so freshness stays fresh (the current-graph
    // hash anchors to `context.persistedGraph`), and the gate is reached.
    mockState.priorFacts = twoRuns(READY_GRAPH);
    mockState.persistedGraph = READY_GRAPH; // canonical: lever pinned

    await runTurnExecutor(whatChangedPayload(), 'req-rc-seam', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      graphState: STALE_REQUEST_GRAPH as never, // stale request graph: no interventions
    });

    // Gate reached exactly once on this turn.
    expect(gateSpy.calls).toBe(1);
    const captured = gateSpy.controlledIds[0];
    expect(captured).toBeInstanceOf(Set);
    // AUTHORITATIVE: the option-pinned lever must be in the set the gate receives.
    // Pristine (request-first) reads the empty set from the stale request graph
    // → RED; persisted-first reads the canonical set → GREEN.
    expect([...(captured ?? [])]).toContain('fac_acquisition_cost');
  });

  it('full composer: the run-comparison prose names the surviving external mover, never the pinned lever', async () => {
    mockState.priorFacts = twoRuns(READY_GRAPH);
    mockState.persistedGraph = READY_GRAPH; // canonical: lever pinned

    const result = await runTurnExecutor(whatChangedPayload(), 'req-rc-prose', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      graphState: STALE_REQUEST_GRAPH as never, // stale request graph: no interventions
    });

    const text = assistantTextOf(result);
    expect(text.length).toBeGreaterThan(0);
    // The option-pinned lever must not be named as gaining/losing influence.
    // Pristine names "Acquisition cost" (unsuppressed largest mover) → RED.
    expect(text).not.toContain('Acquisition cost');
    // The genuine external factor becomes the named mover after suppression.
    expect(text).toContain('Market demand');
  });

  it('common path (no controlled factors): the controlled set is empty under either authority and the swap is inert', async () => {
    // persisted === request === interventionless → `collect…` is empty whichever
    // operand wins the `??`, so the authority swap cannot change this path. The
    // largest rank-mover (Acquisition cost, legitimately tunable here) is named
    // exactly as it would be before the fix.
    mockState.priorFacts = twoRuns(STALE_REQUEST_GRAPH); // hashed on the interventionless graph → fresh
    mockState.persistedGraph = STALE_REQUEST_GRAPH; // interventionless

    const result = await runTurnExecutor(whatChangedPayload(), 'req-rc-common', {
      routingAdapter: { chatWithTools: vi.fn() } as never,
      graphState: STALE_REQUEST_GRAPH as never,
    });

    expect(gateSpy.calls).toBe(1);
    // Empty controlled set: the `??` operand order is never consulted, so this
    // path is provably inert to the authority swap (byte-identical before/after).
    expect(gateSpy.controlledIds[0]?.size).toBe(0);

    // The governed mover sentence is unchanged: the unsuppressed largest mover is
    // named exactly as before. Assert only that sentence, not the whole prose, so
    // unrelated gate-copy edits do not couple to this authority test.
    const text = assistantTextOf(result);
    expect(text).toContain('Acquisition cost now has more influence on the outcome than before.');
  });
});
