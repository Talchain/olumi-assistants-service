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

const readRecent = vi.fn();
const readFactsFor = vi.fn();
const readFactsWithTurnFor = vi.fn();
const readScenarioRunAnalysisFactsFor = vi.fn();
const readAnalysisInvalidatedAt = vi.fn();
vi.mock('../../orchestrator-v5/session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../orchestrator-v5/session/index.js')>()),
  getSessionStore: () => ({ readRecent, readFactsFor, readFactsWithTurnFor, readScenarioRunAnalysisFactsFor, readAnalysisInvalidatedAt }),
}));
vi.mock('../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { readScenarioAnalysis } from '../scenario-graph-analysis-read.js';
import { buildAnalysisResultBlock } from '../../orchestrator-v5/compose.js';
import { computeAnalysisAffectingGraphHash } from '../../orchestrator-v5/context/graph-hash.js';
import { enforceLeaderLicenceAtFinalEgress } from '../../orchestrator-v5/agent-lane/leader-final-egress.js';
import { leaderLicenceFromState } from '../../orchestrator-v5/compose/leader-licence.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../orchestrator/tools/analysis-ready-helper.js';
import type { GraphStateIngress } from '../../orchestrator-v5/boundary/request-extensions.js';

type Rec = Record<string, any>;

const SCENARIO = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const GRAPH: GraphStateIngress = { nodes: [{ id: 'goal', kind: 'goal', label: 'Synthetic goal', goal_threshold: 0.7 }], edges: [] };
const HASH = computeAnalysisAffectingGraphHash(GRAPH)!;
const RUN_AT = '2026-10-02T10:00:00.000Z';

/** A REQUESTED Run whose constraint verdict permits; the leader (option-b) ranks first, so ranking ≠ id order. */
function runFact(opts: { separated: boolean }) {
  return RunAnalysisHandlerFactSchema.parse({
    fact_type: 'run_analysis', fact_version: 1, noop: false,
    result: {
      scenario_id: SCENARIO, computed_at: RUN_AT, graph_hash_at_run: HASH,
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

async function reload(fact: ReturnType<typeof runFact>, requestId: string): Promise<Rec> {
  readScenarioRunAnalysisFactsFor.mockResolvedValue({
    facts: [{ fact, fact_row_id: 'row-0', fact_created_at: fact.result.computed_at }], total_count: 1,
  });
  readRecent.mockResolvedValue([]);
  readFactsFor.mockResolvedValue([]);
  readFactsWithTurnFor.mockResolvedValue([]);
  return readScenarioAnalysis({ scenarioId: SCENARIO, graph: GRAPH, requestId }) as Promise<Rec>;
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
  readAnalysisInvalidatedAt.mockResolvedValue(null);
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
  });

  it('R2 CONTROL: a licensed Run reloads with the builder\'s block, unchanged', async () => {
    const fact = runFact({ separated: true });
    const read = await reload(fact, 'r2');
    expect(read.analysis_state?.leader_claim, 'premise: licensed').toMatchObject({ permitted: true, separation: 'separated' });
    expect(read.analysis_result).toEqual(buildAnalysisResultBlock(fact));
    expect(optionIds(read.analysis_result)).toEqual(['option-b', 'option-a']);
    expect(read.analysis_result.enrichment.decision_brief.headline).toBe('Option B currently leads.');
    expect(read.analysis_result.leading_option_id).toBe('option-b');
  });

  it('R3: the egress over the read\'s withheld block removes nothing (idempotent)', async () => {
    const read = await reload(runFact({ separated: false }), 'r3');
    const again = turnEgress(read.analysis_result, read.analysis_state);
    expect(again.removedPaths).toEqual([]);
    expect(again.response.blocks?.[0]).toEqual(read.analysis_result);
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
  });

  it('R4 RED: the current Run\'s separation was never evaluated → the pair still rides, with no leader id on either side', async () => {
    const read = await reloadPair(false);
    expect(read.analysis_state?.leader_claim, 'premise: withheld').toMatchObject({ permitted: false, withheld_reason: 'separation_unavailable' });
    const delta = read.current_read?.run_delta;
    expect(delta, 'premise: the pair rides').toBeDefined();
    expect(delta.leader).not.toHaveProperty('current_leading_option_id');
    expect(delta.leader).not.toHaveProperty('prior_leading_option_id');
  });
});
