/**
 * ONE RUN, ONE SERIALISATION ON RELOAD (F1b 52f8cd; DL ruling 5949485462 on the Compare audit, lease 5950467893).
 *
 * Served (D1 guest 4f211b13, CEE 091ed007): a Run whose leader claim was withheld (`separation_unavailable`) shipped two
 * different `analysis_result` blocks. The Run TURN passed the Agent lane's final egress under `leaderLicenceFromState`;
 * the stored `/graph` read had no egress, so it kept the builder's ranking-order `decision_brief` and its content hash
 * never matched the turn's (4/4 reads). The read now passes the SAME function under the licence read from its OWN state.
 *
 *   R1 RED:     withheld read block = the egress's projection of the builder's block (claim-free option order, no headline)
 *   R2 CONTROL: a licensed Run's block is the builder's block, unchanged
 *   R3:         the egress over the read's withheld block changes nothing (idempotent)
 *   R4 RED:     a withheld Run's `current_read.run_delta` carries no leader id; a licensed contrast keeps them
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { RunDeltaSchema } from '@talchain/schemas/boundary';

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
const readMostRecentPendingActions = vi.fn().mockResolvedValue([]);
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => ({ readRecent, readFactsFor, readFactsWithTurnFor, readScenarioRunAnalysisFactsFor, readAnalysisInvalidatedAt, readMostRecentPendingActions }),
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const canonicalViewInputs = vi.hoisted(() => [] as Rec[]);
vi.mock('../canonical-analysis-view.js', async original => {
  const actual = await original<typeof import('../canonical-analysis-view.js')>();
  return { ...actual, projectCanonicalAnalysisView: (input: Parameters<typeof actual.projectCanonicalAnalysisView>[0]) => {
    canonicalViewInputs.push(input);
    return actual.projectCanonicalAnalysisView(input);
  } };
});

import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { readBackState } from '../agent-v1-turn.js';
import { buildAnalysisResultBlock } from '../../orchestrator-v5/compose.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { enforceLeaderLicenceAtFinalEgress } from '../../orchestrator-v5/agent-lane/leader-final-egress.js';
import { leaderLicenceFromState } from '../../orchestrator-v5/compose/leader-licence.js';
import { WITHHELD_ANALYSIS_SUMMARY } from '../../orchestrator-v5/compose/withheld-claim-projection.js';
import { buildAnalysisResultHeadlineParts } from '../../orchestrator-v5/coaching/analysis-result-headline.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import { currentAnalysisCoaching } from '../../orchestrator-v5/agent-lane/analysis-coaching-pass-through.js';
import { reconciliationPending } from '../../orchestrator-v5/agent-lane/goal-scope.js';
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

type Rec = Record<string, any>;

const SCENARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
// P0 SHARED DATA (#85 5963281356): a model the product can RUN. The ONE leader licence reads the admission, and a
// goal-only graph is refused (`structurally_analysable: false`, matrix M5), so no leader could ever be named from it.
// Admitted here at `quantified_provisional` (matrix M2): a separated leader ships with its caveat.
const linkOf = (from: string, to: string, mean = 1) => ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
const GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'decision', kind: 'decision', label: 'Choose' },
    { id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 },
    { id: 'factor', kind: 'factor', label: 'Synthetic factor', observed_state: { value: 0, raw_value: 0, source: 'cee_inference', extractionType: 'inferred' } },
    { id: 'option-a', kind: 'option', label: 'Option A', interventions: { factor: 1 } },
    { id: 'option-b', kind: 'option', label: 'Option B', interventions: { factor: 0 } },
  ],
  edges: [linkOf('decision', 'option-a'), linkOf('decision', 'option-b'), linkOf('option-a', 'factor'), linkOf('option-b', 'factor', 0.01), linkOf('factor', 'goal')],
  goal_node_id: 'goal',
} as unknown as GraphStateIngress;
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const RUN_AT = '2026-10-02T10:00:00.000Z';

/** A REQUESTED Run whose constraint verdict permits; the leader (option-b) ranks first, so ranking ≠ id order. */
function runFact(opts: { separated: boolean }) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, run_id: 'requested-run', computed_at: RUN_AT, graph_hash_at_run: HASH,
      leading_option_id: 'option-b', summary: 'The analysis is complete.',
      win_probabilities: { 'option-a': 0.35, 'option-b': 0.65 },
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: {
        analysis_status: 'completed',
        // Absent robustness = separation never evaluated → `separation_unavailable` (WE DID NOT LOOK).
        ...(opts.separated ? { robustness: { level: 'strong', near_tie: { is_tie: false } } } : {}),
        decision_brief: {
          headline: 'Option B currently leads.',
          options: [{ option_id: 'option-b', label: 'Option B' }, { option_id: 'option-a', label: 'Option A' }],
        },
      },
    },
  });
}

async function reload(fact: ReturnType<typeof runFact>, requestId: string, onCurrentnessRead?: Parameters<typeof readScenarioAnalysis>[0]['onCurrentnessRead']): Promise<Rec> {
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [{ fact, fact_row_id: 'row-0', fact_created_at: fact.result.computed_at }], total_count: 1,
  });
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]);
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId, onCurrentnessRead }) as Promise<Rec>;
}

/** The Agent lane's final egress exactly as `agent-v1-turn.ts` calls it, over one block, under a given state. */
function turnEgress(block: unknown, analysisState: Rec | null, graph: unknown = GRAPH) {
  const analysisReady = buildCanonicalAnalysisReadyFromGraph(graph as GraphStateIngress);
  const claim = analysisState?.leader_claim;
  return enforceLeaderLicenceAtFinalEgress<{ blocks?: unknown[] }>({ blocks: [block] }, {
    requestId: 'turn', exitPath: 'agent_lane_v1_final',
    licence: leaderLicenceFromState(analysisState, analysisReady),
    mayNameLeadingOption: claim?.permitted === true,
    separationEstablished: claim?.separation === 'separated',
    ...(typeof claim?.withheld_reason === 'string' ? { leaderClaimWithheldReason: claim.withheld_reason } : {}),
    graph: graph as never, analysisReady,
  });
}

const optionIds = (block: Rec | null | undefined) =>
  (block?.enrichment?.decision_brief?.options as Rec[] | undefined)?.map((o) => o.option_id);

beforeEach(() => {
  vi.clearAllMocks();
  readMostRecentPendingActions.mockResolvedValue([]);
  readAnalysisInvalidatedAt.mockResolvedValue(null);
});

describe('canonical saved-summary producer consumes the existing leader licence', () => {
  // Small synthetic envelopes, sweeping label length to exercise numbered and shed forms.
  const bands = [
    { probabilities: [0.62, 0.38], fragile: true },
    { probabilities: [0.62, 0.38], driver: true },
    { probabilities: [0.62, 0.38] },
    { probabilities: [0.62] },
    { probabilities: [0.34, 0.22], driver: true },
    { probabilities: [0.34, 0.22], fragile: true },
    { probabilities: [0.34, 0.22] },
    { probabilities: [0.45, 0.42] },
    { probabilities: [0.41, 0.40] },
    { probabilities: [0.62, 0.38], tied: true },
    { probabilities: [0.54, 0.55] },
  ];
  const forms = new Map<string, string>();
  bands.forEach((band, index) => {
    for (let length = 7; length <= 210; length++) {
      const result = buildAnalysisResultHeadlineParts({ leading_option_id: 'option-b', status_kind: 'ok', enrichment: {
        results: band.probabilities.map((win_probability, i) => ({ option_id: i === 0 ? 'option-b' : 'option-a',
          option_label: i === 0 ? 'Option ' + 'B'.repeat(length - 7) : 'Option A', win_probability })),
        ...(band.driver ? { factor_sensitivity: [{ label: 'Demand', influence_score: 0.6 }] } : {}),
        robustness: { level: 'moderate', ...(band.tied ? { near_tie: { is_tie: true } } : {}),
          ...(band.fragile ? { fragile_edges: [{ from_label: 'Demand', switch_probability: 0.5 }] } : {}) },
      } });
      if (result.text !== null) {
        const key = `${result.descriptor.case}/${result.text.includes('%') ? 'numbered' : 'shed'}/${index}`;
        if (!forms.has(key)) forms.set(key, result.text);
      }
    }
  });

  it('covers every emitted case, including numbered and length-shed forms', () => {
    expect([...new Set([...forms.keys()].map(key => key.split('/')[0]))].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'LT', 'NT', 'SC']);
    expect([...forms.keys()].some(key => key.startsWith('C/shed/'))).toBe(true);
    expect([...forms.keys()].some(key => key.startsWith('B/shed/'))).toBe(true);
    expect([...forms.keys()].some(key => key.startsWith('SC/shed/'))).toBe(true);
  });

  it.each([true, false])('numbered/shed forms follow the shared licence (permitted=%s)', (permitted) => {
    const ready = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
    const licence = leaderLicenceFromState({ leader_claim: { permitted, separation: 'separated' } }, ready);
    expect(licence).toBe(permitted ? 'permitted' : 'withheld');
    for (const [form, summary] of forms) {
      const fact = runFact({ separated: true });
      fact.result.summary = summary;
      const before = structuredClone(fact);
      const block = buildAnalysisResultBlock(fact, ready, licence);
      expect(block.summary, form).toBe(permitted ? summary : WITHHELD_ANALYSIS_SUMMARY);
      expect(block.leading_option_id).toBe(permitted ? 'option-b' : null);
      expect((block.enrichment?.decision_brief as Rec).headline).toBe(permitted ? 'Option B currently leads.' : undefined);
      expect(fact).toEqual(before);
    }
  });

  it.each([false, true])('actual saved reader preserves its own summary under licence and repeated read (separated=%s)', async (separated) => {
    const fact = runFact({ separated });
    fact.result.summary = 'Option B was supported by 65% of runs of this model.';
    const before = structuredClone(fact);
    const read = await reload(fact, 'saved-summary');
    const expected = separated ? fact.result.summary : WITHHELD_ANALYSIS_SUMMARY;
    expect(read.analysis_result.summary).toBe(expected);
    expect(read.current_read.result).toBe(read.analysis_result);
    const repeated = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'saved-summary-repeat' });
    expect(repeated.analysis_result).toEqual(read.analysis_result);
    expect(fact).toEqual(before);
  });

  it('no admission cannot borrow permission or words from another Run', async () => {
    const fact = runFact({ separated: true });
    fact.result.summary = 'Option B scored highest against your goal in 65% of runs of this model; Option A scored highest in 35%.';
    const licence = leaderLicenceFromState({ leader_claim: { permitted: true, separation: 'separated' } }, undefined);
    expect(licence).toBe('withheld');
    expect(buildAnalysisResultBlock(fact, undefined, licence).summary).toBe(WITHHELD_ANALYSIS_SUMMARY);
    const read = await reload(fact, 'scope-summary-seed');
    expect(read.analysis_result.summary).toBe(fact.result.summary);
    const withheld = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'scope-summary',
      goalScopeClaimInput: { status: 'unavailable', issues: [] } });
    expect(withheld.analysis_result?.type).toBe('analysis_result');
    expect((withheld.analysis_result as Rec).summary).toBe(WITHHELD_ANALYSIS_SUMMARY);
  });

  it.each(['stale', 'foreign'] as const)('does not attach a saved summary to a %s selected Run', async (kind) => {
    const fact = runFact({ separated: true });
    fact.result.summary = 'Option B was supported by 65% of runs of this model.';
    if (kind === 'foreign') fact.result.scenario_id = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
    const initial = await reload(fact, 'selected-summary');
    const read = kind === 'stale' ? await readScenarioAnalysis({ scenarioId: SCENARIO, requestId: 'stale-summary',
      graph: { ...GRAPH, nodes: GRAPH.nodes.map(node => node.id === 'factor'
        ? { ...node, observed_state: { value: 2 } } : node) } as GraphStateIngress }) : initial;
    expect(read.analysis_result).toBeNull();
    expect(read.current_read.result).toBeNull();
    expect(read.analysis_state?.leader_claim.permitted).toBe(false);
    expect(fact.result.summary).toBe('Option B was supported by 65% of runs of this model.');
  });
});

describe('R4 selected historical result carrier', () => {
  it.each(['Revenue', 'Delivery capacity'].flatMap(label => ['run', 'current', 'both'].map(missing => ({ label, missing }))))(
    '$label / missing $missing hash: selected historical block only; current claims stay closed', async ({ label, missing }) => {
    const fact = runFact({ separated: true });
    if (missing !== 'current') delete fact.result.graph_hash_at_run;
    fact.result.summary = `${label} recorded on the earlier Run.`;
    fact.result.enrichment = { ...fact.result.enrichment,
      option_comparison: [{ option_id: 'option-a', probability_of_goal: 0.99 }, { option_id: 'option-b', probability_of_goal: 0.01 }],
      inference_warnings: [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info', form: 'each',
        option_ids: ['option-a', 'option-b'], pct_by_option: { 'option-a': 47, 'option-b': 52 },
        option_labels_by_option: { 'option-a': `${label}: earlier A`, 'option-b': `${label}: earlier B` } }],
    };
    const before = structuredClone(fact);
    await reload(fact, 'r4-unknown');
    const read = await readScenarioAnalysis({ scenarioId: SCENARIO, requestId: 'r4-other-label',
      graph: { ...GRAPH, nodes: GRAPH.nodes.map(n => n.id === 'goal' ? { ...n, label: 'Unrelated current £2m' }
        : n.id === 'factor' && missing !== 'run' ? { ...n, label: undefined } : n) } as GraphStateIngress });
    const carrier = canonicalViewInputs.at(-1)!;
    expect(carrier.derivation.freshness).toBe('unknown');
    expect(carrier.currentResult).toBeNull();
    expect(carrier.historicalResult).toEqual(buildAnalysisResultBlock(fact));
    expect(carrier.historicalResult.summary).toBe(`${label} recorded on the earlier Run.`);
    expect(read.analysis_result).toBeNull();
    expect(read.current_read.result).toBeNull();
    expect(read.current_read.figures).toEqual([]);
    expect(read.canonical_analysis_view.options).toEqual([]);
    expect(read.canonical_analysis_view.historical_figures?.options).toEqual([
      { option_id: 'option-a', option_label: `${label}: earlier A`, display: 'about 47%' },
      { option_id: 'option-b', option_label: `${label}: earlier B`, display: 'about 52%' },
    ]);
    expect(read.canonical_analysis_view.staleness.stale).toBeNull();
    expect(read.canonical_analysis_view.face_when_stale).toBe('This earlier Run may be out of date. Run the analysis again.');
    expect(read.canonical_analysis_view.leader_licence).toBe('withheld');
    expect(read.canonical_analysis_view.leader.option_id).toBeNull();
    expect(read.canonical_analysis_view).not.toHaveProperty('goal_chance');
    expect(fact).toEqual(before);
    // The carrier must not be added to a known-current read.
    await reload(runFact({ separated: true }), 'r4-current');
    expect(canonicalViewInputs.at(-1)!.historicalResult).toBeNull();
  });
});

describe('one Run, one serialisation — the reload ships the block the Run turn shipped', () => {
  it('R1 RED: a withheld (separation_unavailable) Run reloads with the licensed block, not the builder\'s ranking', async () => {
    const fact = runFact({ separated: false });
    const read = await reload(fact, 'r1');
    expect(read.analysis_state?.run_state.kind, 'premise: current').toBe('complete_current');
    expect(read.analysis_state?.leader_claim, 'premise: withheld for separation').toMatchObject({ permitted: false, withheld_reason: 'separation_unavailable' });
    expect(optionIds(buildAnalysisResultBlock(fact) as Rec), 'premise: the builder ships ranking order').toEqual(['option-b', 'option-a']);

    expect(optionIds(read.analysis_result), 'claim-free order').toEqual(['option-a', 'option-b']);
    expect(read.analysis_result.enrichment.decision_brief).not.toHaveProperty('headline');
    expect(read.analysis_result.leading_option_id).toBeNull();
    // ONE function of ONE licence: the read's block is the turn egress's output over the builder's block.
    expect(read.analysis_result).toEqual(turnEgress(buildAnalysisResultBlock(fact), read.analysis_state).response.blocks?.[0]);
    expect(read.current_read.result).toBe(read.analysis_result);
  });

  it('R2 CONTROL: a licensed Run reloads with the builder\'s block, unchanged', async () => {
    const fact = runFact({ separated: true });
    const read = await reload(fact, 'r2');
    expect(read.analysis_state?.leader_claim, 'premise: licensed').toMatchObject({ permitted: true, separation: 'separated' });
    expect(read.analysis_result).toEqual(buildAnalysisResultBlock(fact));
    expect(optionIds(read.analysis_result)).toEqual(['option-b', 'option-a']);
    expect(read.analysis_result.enrichment.decision_brief.headline).toBe('Option B currently leads.');
    expect(read.analysis_result.leading_option_id).toBe('option-b');
    expect(read.current_read.result).toBe(read.analysis_result);
    expect(turnEgress(read.analysis_result, read.analysis_state).response.blocks?.[0]).toBe(read.analysis_result);
  });

  it('R3: the egress over the read\'s withheld block removes nothing (idempotent)', async () => {
    const read = await reload(runFact({ separated: false }), 'r3');
    const again = turnEgress(read.analysis_result, read.analysis_state);
    expect(again.removedPaths).toEqual([]);
    expect(again.response.blocks?.[0]).toEqual(read.analysis_result);
  });

  it.each([false, true])('Agent readBackState, repeated and cold reads preserve one projected Run (separated=%s)', async (separated) => {
    const fact = runFact({ separated });
    const persistedBytes = JSON.stringify(fact);
    const graphBytes = JSON.stringify(GRAPH);
    const read = await reload(fact, 'agent-readback');
    const liveResult = turnEgress(buildAnalysisResultBlock(fact), read.analysis_state).response.blocks?.[0];
    const card = {
      type: 'coaching', coaching_kind: 'assumption_check', block_id: '00000000-0000-4000-8000-000000000001',
      signal_id: 'same-run', created_at: RUN_AT, source_handler: 'run_analysis', graph_hash_at_generation: HASH,
      freshness: 'fresh', title: 'Check the assumption', body: 'Which evidence supports this assumption?',
      source: 'deterministic_signal', target_refs: [], priority_rank: 15,
    };
    const capture = { scenario_id: SCENARIO, status: 200, analysis_state: read.analysis_state, blocks: [liveResult, card] };
    // Only dispatch I/O is replaced: the analysis response and exported Agent reader are the production code.
    const dispatch = vi.fn(async (path: string) => {
      expect(path).toBe(`/assist/v1/scenarios/${SCENARIO}/graph`);
      return { status: 200, json: { graph: GRAPH, graph_hash: HASH, ...await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'dispatch-read' }) } };
    });
    const readback = await readBackState(dispatch, SCENARIO);
    expect(dispatch).toHaveBeenCalledTimes(1);
    expect(readback.analysisState).toEqual(read.analysis_state);
    expect(readback.analysisResult).toEqual(liveResult);
    const fromLive = currentAnalysisCoaching(capture, { scenarioId: SCENARIO, graphHash: HASH, analysisState: read.analysis_state, analysisResult: liveResult });
    expect(fromLive).toEqual([card]);
    expect(currentAnalysisCoaching(capture, { scenarioId: SCENARIO, ...readback })).toEqual(fromLive);
    expect(turnEgress(readback.analysisResult, readback.analysisState as Rec, readback.graph).response.blocks?.[0]).toEqual(liveResult);

    const repeated = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'repeat-read' });
    // Discard the module cache: the cold reader reconstructs the same persisted fact, not a held result.
    vi.resetModules();
    const { readScenarioAnalysis: coldRead } = await import('../scenario-graph-analysis-read.js');
    const cold = await coldRead({ scenarioId: SCENARIO, graph: JSON.parse(graphBytes), requestId: 'cold-read' });
    for (const result of [read, repeated, cold]) {
      expect(result.analysis_result).toEqual(liveResult);
      expect(result.current_read.result).toBe(result.analysis_result);
    }
    expect(JSON.stringify(fact)).toBe(persistedBytes);
    expect(JSON.stringify(GRAPH)).toBe(graphBytes);
    expect(fact.result.leading_option_id).toBe('option-b');
    expect(fact.result.enrichment?.decision_brief).toHaveProperty('headline', 'Option B currently leads.');
  });
});

// ── R4: the pair's leader ids. Shapes as `build-run-delta.test.ts`: results carry id + label + win; the stamp entitles. ──
function pairFact(opts: { at: string; hash: string; seed: string; wins: readonly [number, number]; separated: boolean }) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: opts.at, graph_hash_at_run: opts.hash,
      leading_option_id: opts.wins[0] > opts.wins[1] ? 'option-a' : 'option-b', summary: 'The analysis is complete.',
      constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
      enrichment: {
        analysis_status: 'completed',
        results: [
          { option_id: 'option-a', option_label: 'Option A', win_probability: opts.wins[0] },
          { option_id: 'option-b', option_label: 'Option B', win_probability: opts.wins[1] },
        ],
        meta: { seed_used: opts.seed, n_samples: 10_000 },
        ...(opts.separated ? { robustness: { level: 'strong', near_tie: { is_tie: false } } } : {}),
      },
    },
  });
}

async function reloadPair(currentSeparated: boolean): Promise<Rec> {
  const prior = pairFact({ at: '2026-10-02T09:00:00.000Z', hash: 'hash-prior', seed: '111', wins: [0.62, 0.38], separated: true });
  const current = pairFact({ at: RUN_AT, hash: HASH, seed: '222', wins: [0.45, 0.55], separated: currentSeparated });
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [current, prior].map((fact, i) => ({ fact, fact_row_id: `row-${i}`, fact_created_at: fact.result.computed_at })), total_count: 2,
  });
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]);
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'pair' }) as Promise<Rec>;
}

describe('one Run, one serialisation — the reload\'s run_delta names no leader the Run withheld', () => {
  it('R4 CONTRAST: a licensed pair keeps its leader ids on the reload', async () => {
    const read = await reloadPair(true);
    expect(read.analysis_state?.leader_claim, 'premise: licensed').toMatchObject({ permitted: true, separation: 'separated' });
    expect(read.current_read?.run_delta?.leader).toMatchObject({ prior_leading_option_id: 'option-a', current_leading_option_id: 'option-b' });
    expect(RunDeltaSchema.safeParse(read.current_read.run_delta).success).toBe(true);
  });

  it('R4 RED: the current Run\'s separation was never evaluated → the pair still rides, with no leader id on either side', async () => {
    const read = await reloadPair(false);
    expect(read.analysis_state?.leader_claim, 'premise: withheld').toMatchObject({ permitted: false, withheld_reason: 'separation_unavailable' });
    const delta = read.current_read?.run_delta;
    expect(delta, 'premise: the pair rides').toBeDefined();
    expect(delta.leader).not.toHaveProperty('current_leading_option_id');
    expect(delta.leader).not.toHaveProperty('prior_leading_option_id');
    expect(RunDeltaSchema.safeParse(delta).success).toBe(true);
  });
});


describe('Semantic spine: unresolved scope uses the existing claim licence', () => {
  it('withholds an unavailable pending read instead of treating it as an empty row', async () => {
    const fact = runFact({ separated: true });
    const ordinary = await reload(fact, 'scope-read-premise');
    expect(ordinary.analysis_state.leader_claim.permitted).toBe(true);
    readMostRecentPendingActions.mockRejectedValueOnce(new Error('pending read unavailable'));
    const unavailable = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'scope-unavailable' });
    expect(unavailable.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: 'goal_scope_unresolved' });
    expect(fact.result.leading_option_id).toBe('option-b');
  });
  it('withholds the formerly licensed conclusion while keeping the Run current and exploratory result available', async () => {
    const fact = runFact({ separated: true });
    const ordinary = await reload(fact, 'scope-premise');
    expect(ordinary.analysis_state.leader_claim.permitted).toBe(true);
    readMostRecentPendingActions.mockResolvedValue([reconciliationPending(SCENARIO, {
      kind: 'reconcile_goal_scope', goal_id: 'goal', goal_label: 'Synthetic goal',
      /* #2613-successor (Science d5 6006584860): an UNTYPED question no longer blocks; this fixture's open issue is a typed one. */ scope: { modelled: 'all revenue', alternative: 'one stream', extent: 'total', stated_in_brief: true, source: { quote: 'all revenue' } }, expected: 'billing_basis', question: 'Confirm this goal scope', operands: [], derivations: [],
    })]);
    const gated = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'scope-open' });
    expect(gated.analysis_state?.run_state).toEqual(ordinary.analysis_state.run_state);
    expect(gated.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: 'goal_scope_unresolved' });
    expect(gated.analysis_result).not.toBeNull();
    if (gated.analysis_result?.type !== 'analysis_result') throw new Error('Expected the retained exploratory analysis result');
    expect(gated.analysis_result.leading_option_id).toBeNull();
    expect((gated.analysis_result.enrichment?.decision_brief as Rec)).not.toHaveProperty('headline');
    expect(gated.current_read.current_analysis_hash).toBe(ordinary.current_read.current_analysis_hash);
    expect(fact.result.leading_option_id).toBe('option-b');
  });
});


describe('identity-bound final presentation receipt: full canonical permission, same Run', () => {
  it.each([false, true])('reads the selected Run and its full licence together (separated=%s)', async (separated) => {
    const fact = runFact({ separated });
    const receipt = vi.fn();
    const read = await reload(fact, 'presentation-receipt', receipt);
    expect(receipt).toHaveBeenCalledTimes(1);
    const current = receipt.mock.calls[0][0];
    expect(current).toMatchObject({ readOk: true, fact: { result: {
      scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at: RUN_AT,
    } }, permissions: { leader_may_be_named: separated, permitted_analysis_mode: 'quantified_provisional' } });
    expect(current.permissions.provisional).toBe(separated ? true : undefined);
    expect(read.analysis_state.run_state.kind).toBe('complete_current');
    expect(read).not.toHaveProperty('permissions');
  });
  it.each(['unresolved', 'unavailable'] as const)('scope %s carries a withhold or an unavailable permission, never a plain licence', async (status) => {
    const fact = runFact({ separated: true });
    await reload(fact, 'seed-receipt');
    const receipt = vi.fn();
    const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId: 'scope-receipt',
      goalScopeClaimInput: { status, issues: [] }, onCurrentnessRead: receipt });
    const current = receipt.mock.calls[0][0];
    expect(current).toMatchObject({ readOk: true, fact: { result: { scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at: RUN_AT } } });
    expect(read.analysis_state?.leader_claim.permitted).toBe(false);
    if (status === 'unavailable') expect(current.permissions).toBeUndefined();
    else expect(current.permissions).toMatchObject({ leader_may_be_named: false, total_goal_claims_allowed: false });
  });
});
