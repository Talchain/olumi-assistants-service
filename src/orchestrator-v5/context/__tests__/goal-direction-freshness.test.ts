/**
 * RT-10 (red-team #87 5996221302): a saved Run whose recorded goal direction is not the direction the model now sends
 * is NOT current. Pre-fix Runs on "monthly churn below 2%" sent nothing (PLoT maximised) and, after #2585, the same
 * persisted graph sends `minimise`; both scenarios still read `complete_current`, so the upside-down order was shown
 * as "Analysis reflects the current model".
 *
 * Why the hash did not catch it: the persisted graph has no top-level `goal_node_id` (GraphV3 strips it), and
 * `graph-hash.ts` derives `run_semantics` only from that key, so the derived direction hashes as null on both sides.
 * Re-keying the hash would stale every goal Run at once; the Run's own SC-24 snapshot already records the direction it
 * SENT (`input_snapshot.goal.direction`, #2378), so the currentness gate compares that with `resolveGoalDirection` now.
 *
 * Rows bind by identity: the reason, the hashes, the Run's computed_at, and the resolver's own answer on each graph.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { stampRunAnalysisProjection } from '../analysis-projection-policy.js';
import { compareRunGoalUnitSnapshot, deriveAnalysisFreshness, goalSnapshotStaleMessage } from '../freshness.js';
import { resolveGoalDirection } from '../../goal-target/goal-direction.js';
import { guardAnalysisParticipation } from '../../tools/handlers/run-analysis-participation-guard.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { composeToolCallResponse } from '../../compose.js';
import { composeAnalysisStateV1, projectAnalysisBlocksForRunBinding } from '../../compose/analysis-state-v1.js';
import { attachComputedAt } from '../../compose/analysis-ready-emit.js';
import { selectCanonicalAnalysisState } from '../canonical-analysis-state.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { PRESENT_PAIR } from './run-delta-fixtures.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

type Rec = Record<string, any>;
// The verbatim GRAPH_READY graph of the red team's pre-fix B2 build (staging 91656b1b) — no top-level goal_node_id,
// exactly as persisted. Its goal holds `<` beside a typed LEVEL target of 2 %.
const served = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-rt10-churn-below-2pct.json',
  import.meta.url), 'utf8')) as { captures: Record<string, { graph: Rec }> };
const churnGraph = (): Rec => structuredClone(served.captures.staging_91656b1b!.graph);
const GOAL = 'monthly_churn';
const goalOf = (graph: Rec): Rec => graph.nodes.find((n: Rec) => n.id === GOAL);

const HASH = '34bd4986cdbe95a1';
const AT = '2026-10-05T10:41:07.000Z';
// The snapshot `buildRunInputSnapshot` writes for this goal: `direction` only when the Run SENT one.
const snapshotGoal = (direction?: unknown): Rec => ({
  node_id: GOAL, label: 'monthly churn', target_raw: 2, unit: '%', operator: '<', frame: 'level',
  ...(direction === undefined ? {} : { direction }),
});
const fact = (inputSnapshot: unknown): HandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: 'e8c3f36f-0000-4000-8000-000000000000', summary: 'Analysed.', leading_option_id: null,
    graph_hash_at_run: HASH, computed_at: AT, enrichment: stampRunAnalysisProjection({ analysis_status: 'computed' }),
    ...(inputSnapshot === undefined ? {} : { input_snapshot: inputSnapshot }),
  },
} as unknown as HandlerFact);
const derive = (currentGraph: unknown, selected: HandlerFact) =>
  deriveAnalysisFreshness([selected], HASH, undefined, { currentGraph });

describe('RT-10 — the direction a Run sent is part of its currentness', () => {
  it('precondition: on the served pre-fix graph the model now sends minimise (stated comparator)', () => {
    expect(churnGraph()).not.toHaveProperty('goal_node_id');
    expect(resolveGoalDirection(churnGraph(), GOAL)).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
  });

  it('R1: a Run that sent NO direction reads stale (goal_direction_changed) on an unchanged graph and hash', () => {
    const verdict = derive(churnGraph(), fact({ goal: snapshotGoal() }));
    expect(verdict).toEqual({ selected_fact_row_id: null, run_revision: { value: null, source: 'legacy_unknown' },
      basis: 'analysis_graph_hash_interim', freshness: 'stale', reason: 'goal_direction_changed', selected_fact_index: 0,
      graph_hash_at_run: HASH, current_graph_hash: HASH, computed_at: AT });
    expect(compareRunGoalUnitSnapshot(fact({ goal: snapshotGoal() }), churnGraph())).toBe('direction_changed');
  });

  it('R2: the rerun that SENT minimise is current on the same graph (binds to the resolved direction)', () => {
    expect(derive(churnGraph(), fact({ goal: snapshotGoal('minimise') })))
      .toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match', computed_at: AT });
  });

  it('R3: `maximise` on the wire is byte-identical to nothing, so a recorded maximise reads like R1', () => {
    expect(derive(churnGraph(), fact({ goal: snapshotGoal('maximise') })))
      .toMatchObject({ freshness: 'stale', reason: 'goal_direction_changed' });
  });

  it('R4 CONTRAST: a held FLOOR sends nothing then and now — current', () => {
    const floor = churnGraph();
    goalOf(floor).goal_direction = '>=';
    expect(resolveGoalDirection(floor, GOAL)).toBeUndefined();
    expect(derive(floor, fact({ goal: { ...snapshotGoal(), operator: '>=' } })))
      .toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
  });

  it('R5 CONTRAST: a label-classified minimise that the Run sent stays current; a rename that flips it does not', () => {
    const labelled = churnGraph();
    delete goalOf(labelled).goal_direction;
    goalOf(labelled).label = 'Reduce monthly churn';
    expect(resolveGoalDirection(labelled, GOAL)).toEqual({ direction: 'minimise', provenance: 'derived_from_goal_label' });
    const sentMinimise = fact({ goal: { ...snapshotGoal('minimise'), operator: undefined } });
    expect(derive(labelled, sentMinimise)).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
    goalOf(labelled).label = 'Grow monthly churn';
    expect(resolveGoalDirection(labelled, GOAL)).toBeUndefined();
    expect(derive(labelled, sentMinimise)).toMatchObject({ freshness: 'stale', reason: 'goal_direction_changed' });
  });

  it('R6: a Run that sent minimise reads stale once the model stops sending it (the user replaced < with >=)', () => {
    const floor = churnGraph();
    goalOf(floor).goal_direction = '>=';
    expect(derive(floor, fact({ goal: snapshotGoal('minimise') })))
      .toMatchObject({ freshness: 'stale', reason: 'goal_direction_changed' });
  });

  it.each([42, '', 'down', null])('R7: a malformed recorded direction fails closed (unverified): %j', (direction) => {
    expect(derive(churnGraph(), fact({ goal: snapshotGoal(direction) })))
      .toMatchObject({ freshness: 'stale', reason: 'goal_snapshot_unverified' });
  });

  it('R8: a unit change is still named as a unit change when the direction also moved', () => {
    const graph = churnGraph();
    goalOf(graph).goal_threshold_unit = 'pp';
    expect(derive(graph, fact({ goal: snapshotGoal() })))
      .toMatchObject({ freshness: 'stale', reason: 'goal_unit_changed' });
  });

  it('R9 RESIDUAL (DL spec 1): a Run with no snapshot (pre-#2378) gains no staleness from this reason', () => {
    expect(derive(churnGraph(), fact(undefined))).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
    expect(derive(churnGraph(), fact({ goal: null }))).toMatchObject({ freshness: 'fresh' });
  });

  it('R10: the snapshot names another goal than the current one → unverified, never a direction verdict', () => {
    expect(derive(churnGraph(), fact({ goal: { ...snapshotGoal(), node_id: 'other_goal' } })))
      .toMatchObject({ freshness: 'stale', reason: 'goal_snapshot_unverified' });
  });

  // Science (#2596 PASS, row 1): `maximise` and absent give the same verdict against a minimise AND a non-minimise current.
  it.each([
    ['a held ceiling (sends minimise now)', '<', 'stale'],
    ['a held floor (sends nothing now)', '>=', 'fresh'],
  ] as const)('R12: recorded maximise ≡ recorded nothing on %s', (_name, held, verdict) => {
    const graph = churnGraph();
    goalOf(graph).goal_direction = held;
    const absent = derive(graph, fact({ goal: { ...snapshotGoal(), operator: held } }));
    const maximise = derive(graph, fact({ goal: { ...snapshotGoal('maximise'), operator: held } }));
    expect(maximise).toEqual(absent);
    expect(absent.freshness).toBe(verdict);
  });

  // Science (#2596 PASS, row 2, REQUIRED): the run resolves on the PARTICIPATION graph, the read on the RAW stored graph.
  // A node the user kept out of the calculation that carries its own `<=` (on the node and as a limit row) must not
  // make the two disagree: the sense is the goal's alone.
  it.each([['<', 'minimise'], ['>=', undefined]] as const)(
    'R13: a retained-excluded node with its own <= does not move the goal sense (goal holds %s)', (held, sends) => {
      const raw = churnGraph();
      goalOf(raw).goal_direction = held;
      raw.nodes.push({ id: 'agent_cost', kind: 'factor', label: 'Agent cost', goal_direction: '<=',
        analysis_participation: 'retained_excluded' });
      raw.goal_constraints = [{ id: 'gc-agent-cost', node_id: 'agent_cost', operator: '<=', value: 5, label: 'Agent cost' }];
      const participation = guardAnalysisParticipation(raw, { goalNodeId: GOAL });
      expect(participation.excludedNodeIds, 'precondition: the real guard withholds the node').toEqual(['agent_cost']);
      expect((participation.graph as Rec).nodes.some((n: Rec) => n.id === 'agent_cost')).toBe(false);
      expect(resolveGoalDirection(raw, GOAL)?.direction).toBe(sends);
      expect(resolveGoalDirection(participation.graph, GOAL)).toEqual(resolveGoalDirection(raw, GOAL));
      const sentByTheRun = resolveGoalDirection(participation.graph, GOAL)?.direction;
      expect(derive(raw, fact({ goal: { ...snapshotGoal(sentByTheRun), operator: held } })))
        .toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
    });

  // Codex r1 (#2596): the Run resolves on the goal node AS ITS LOADER VALIDATES IT (GraphV3 → NodeV3, field-level
  // `.catch(undefined)`). A malformed Olumi reading the stored graph still holds is absence to the Run, so it must be
  // absence to the read — or an unchanged, correctly-run Run reads falsely stale.
  const cloudCosts = (words?: string): Rec => {
    const graph = churnGraph();
    const goal = goalOf(graph);
    delete goal.goal_direction;
    Object.assign(goal, { label: 'Cloud costs', goal_threshold_frame: 'change_rel', goal_threshold_raw: -0.2,
      goal_threshold: -0.2, goal_sense_reading: { sense: 'minimise', basis: 'typed_change_sign', threshold: -0.2,
        threshold_frame: 'change_rel', ...(words === undefined ? {} : { words }) } });
    delete goal.goal_threshold_unit;
    return graph;
  };
  const changeSnapshot = (direction?: 'minimise') => fact({ goal: { node_id: GOAL, label: 'Cloud costs',
    target_raw: -0.2, frame: 'change_rel', ...(direction === undefined ? {} : { direction }) } });
  it('R14 NEGATIVE: a MALFORMED Olumi reading (no words) is absence to the Run, so a Run that sent nothing stays current', () => {
    expect(derive(cloudCosts(), changeSnapshot())).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
  });
  it('R14 CONTROL: a VALID reading sends minimise — that Run is current, and a Run that sent nothing is stale', () => {
    const valid = cloudCosts('Olumi reads “cut by 20%” as lower is better.');
    expect(resolveGoalDirection(valid, GOAL)).toEqual({ direction: 'minimise', provenance: 'typed_change_sign' });
    expect(derive(valid, changeSnapshot('minimise'))).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
    expect(derive(valid, changeSnapshot())).toMatchObject({ freshness: 'stale', reason: 'goal_direction_changed' });
  });

  it('R15: a graph the Run loader would REFUSE (GraphV3) cannot be run, so no direction verdict is drawn', () => {
    const graph = churnGraph();
    goalOf(graph).label = 42;
    expect(GraphV3.safeParse(graph).success, 'precondition: GraphV3 refuses this graph').toBe(false);
    expect(derive(graph, fact({ goal: snapshotGoal() }))).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
  });

  // RT-10 B′ × #2596: the approved goal ceiling card holds `<=` and keeps its own limit row on the goal; the run reads
  // the ROW (GraphV3 keeps `goal_constraints`), so the read must too, or every rerun after an approved card reads stale.
  const cardCeiling = (): Rec => {
    const graph = churnGraph();
    const goal = goalOf(graph);
    for (const k of ['goal_threshold', 'goal_threshold_raw', 'goal_threshold_frame', 'goal_threshold_unit', 'goal_threshold_cap',
      'goal_threshold_cap_provenance']) delete goal[k];
    goal.goal_direction = '<=';
    graph.goal_constraints = [{ constraint_id: 'gc-card-1', node_id: GOAL, operator: '<=', value: 2, unit: '%',
      label: 'Monthly churn', provenance: 'explicit' }];
    return graph;
  };
  it('R16 B′: a Run that SENT minimise through an approved card ceiling (no target figure) stays current', () => {
    expect(resolveGoalDirection(cardCeiling(), GOAL)).toEqual({ direction: 'minimise', provenance: 'stated_comparator' });
    const sent = fact({ goal: { node_id: GOAL, label: 'monthly churn', operator: '<=', direction: 'minimise' } });
    expect(derive(cardCeiling(), sent)).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
  });
  it('R16 B′ CONTRAST: the same graph with a Run that sent nothing reads stale', () => {
    const none = fact({ goal: { node_id: GOAL, label: 'monthly churn', operator: '<=' } });
    expect(derive(cardCeiling(), none)).toMatchObject({ freshness: 'stale', reason: 'goal_direction_changed' });
  });

  it('R11: model-restore chronology still outranks the direction reason', () => {
    expect(deriveAnalysisFreshness([fact({ goal: snapshotGoal() })], HASH, undefined, {
      currentGraph: churnGraph(), analysisInvalidatedAt: '2026-10-05T10:42:00.000Z',
    })).toMatchObject({ freshness: 'stale', reason: 'model_restored_after_analysis' });
  });
});

describe('RT-10 — every goal-snapshot reader treats goal_direction_changed as the unit reasons are treated', () => {
  const stale = () => derive(churnGraph(), fact({ goal: snapshotGoal() }));
  const WORDS = 'which way counts as better for your goal changed';

  it('the freshness text carrier says why, without restamping the Run', () => {
    expect(goalSnapshotStaleMessage('goal_direction_changed')).toBe(WORDS);
    expect(attachComputedAt({ options: [], goal_node_id: GOAL, status: 'ready' }, stale()))
      .toMatchObject({ freshness: 'stale', freshness_reason: WORDS, computed_at: AT,
        graph_hash_at_run: HASH, current_graph_hash: HASH });
  });

  it('the turn withholds the live result and offers a rerun under that title', () => {
    const out = composeToolCallResponse({
      orientation: 'Analysis received.', confirmation: 'Run saved.', coaching: null,
      stage: 'analyse', answerKind: 'functional', handlerFacts: [fact({ goal: snapshotGoal() })],
      persistedGraph: churnGraph(), persistedGraphHash: HASH,
      lifecycle: { freshness: stale(), priorFacts: [fact({ goal: snapshotGoal() })], requestId: 'rt10', scenarioId: 's' },
    });
    expect(out.blocks.map((b) => b.type)).toEqual(['coaching']);
    expect(out.blocks[0]).toMatchObject({ freshness: 'stale', action_intent: 'rerun_analysis', title: WORDS });
  });

  it('the run-binding projection drops the analysis block (ordinary graph-stale control keeps it)', () => {
    const current = composeToolCallResponse({
      orientation: 'Analysis received.', confirmation: 'Run saved.', coaching: null,
      stage: 'analyse', answerKind: 'functional', handlerFacts: [fact({ goal: snapshotGoal('minimise') })],
      persistedGraph: churnGraph(), persistedGraphHash: HASH,
      lifecycle: { freshness: derive(churnGraph(), fact({ goal: snapshotGoal('minimise') })),
        priorFacts: [fact({ goal: snapshotGoal('minimise') })], requestId: 'rt10', scenarioId: 's' },
    }).blocks;
    expect(current.some((b) => b.type === 'analysis_result')).toBe(true);
    const canonical = selectCanonicalAnalysisState({ priorFacts: [fact({ goal: snapshotGoal() })],
      currentGraphHash: HASH, currentGraph: churnGraph() });
    expect(canonical).toMatchObject({ freshness: 'stale', freshness_reason: 'goal_direction_changed' });
    const state = composeAnalysisStateV1({ canonical, freshness: stale(), mayNameLeadingOption: false, rawRobustness: null })!;
    expect(projectAnalysisBlocksForRunBinding(current, state, 'goal_direction_changed')
      .some((b) => b.type === 'analysis_result')).toBe(false);
    expect(projectAnalysisBlocksForRunBinding(current, state, 'graph_hash_diverged')).toEqual(current);
  });

  it('the AI prompt context carries no run comparison for it (graph-stale control does)', () => {
    const canonical = selectCanonicalAnalysisState({ priorFacts: [fact({ goal: snapshotGoal() })],
      currentGraphHash: HASH, currentGraph: churnGraph() });
    const pack = (freshness_reason: typeof canonical.freshness_reason) => assembleContextPack({
      payload: makeMessagePayload({ scenario_id: 'rt10-direction-pack', message: 'What changed?' }),
      priorTurns: [], priorFacts: PRESENT_PAIR, priorFactsReadOk: true,
      graphContext: { status: 'canonical' }, mayNameLeadingOption: true,
      canonicalState: { ...canonical, freshness_reason },
    });
    expect(pack('goal_direction_changed').run_delta).toBeUndefined();
    expect(pack('graph_hash_diverged').run_delta).toBeDefined();
  });
});
