import { describe, expect, it } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { deriveAnalysisFreshness } from '../freshness.js';
import { composeToolCallResponse } from '../../compose.js';
import { composeAnalysisStateV1, projectAnalysisBlocksForRunBinding } from '../../compose/analysis-state-v1.js';
import { assembleContextPack } from '../context-pack-assembler.js';
import { PRESENT_PAIR } from './run-delta-fixtures.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { attachComputedAt } from '../../compose/analysis-ready-emit.js';
import { selectCanonicalAnalysisState } from '../canonical-analysis-state.js';

const HASH = 'e7d843f951477155';
const AT = '2026-09-30T11:02:22.019Z';
const graph = (unit: string | null | undefined = 'GBP/month') => ({
  goal_node_id: 'mrr',
  nodes: [{ id: 'mrr', kind: 'goal', label: 'Monthly revenue', goal_threshold_unit: unit }],
  edges: [],
});
// SC-24 schema #76 carrier (writer integration remains separate), exercised before its writer lands.
// No deployed fact is fabricated by these pure currentness tests.
const fact = (inputSnapshot: unknown = { goal: {
  node_id: 'mrr', label: 'Monthly revenue', target_raw: 85_000,
  unit: 'GBP/month',
} }): HandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', summary: 'Analysed.', leading_option_id: null,
    graph_hash_at_run: HASH, computed_at: AT, enrichment: { analysis_status: 'computed' },
    ...(inputSnapshot === undefined ? {} : { input_snapshot: inputSnapshot }),
  },
} as unknown as HandlerFact);
const derive = (currentGraph: unknown, selectedFact = fact()) =>
  deriveAnalysisFreshness([selectedFact], HASH, undefined, { currentGraph });

describe('the selected Run goal unit is part of currentness', () => {
  it('keeps an unchanged snapshot current and a label-only edit current', () => {
    expect(derive(graph())).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match' });
    const renamed = graph();
    renamed.nodes[0]!.label = 'Revenue to support our strategy';
    expect(derive(renamed)).toMatchObject({ freshness: 'fresh', computed_at: AT });
  });

  it('stales a unit-only edit despite equal hashes, retaining the exact Run identity', () => {
    const changed = derive(graph('USD/month'));
    expect(changed).toMatchObject({ freshness: 'stale', reason: 'goal_unit_changed',
      graph_hash_at_run: HASH, current_graph_hash: HASH, computed_at: AT, selected_fact_index: 0 });
    expect(selectCanonicalAnalysisState({ priorFacts: [fact()], currentGraphHash: HASH,
      currentGraph: graph('USD/month') })).toMatchObject({ freshness: 'stale', freshness_reason: 'goal_unit_changed' });
  });

  it('the same-hash rerun with the new authored unit becomes current', () => {
    const rerun = fact({ goal: { node_id: 'mrr', unit: 'USD/month', label: 'Monthly revenue' } });
    expect(derive(graph('USD/month'), rerun).freshness).toBe('fresh');
  });

  it.each([undefined, null, { nodes: [] }, { nodes: [graph().nodes[0], graph().nodes[0]] },
    { goal_node_id: 'other', nodes: graph().nodes },
    { ...graph(), nodes: [{ ...graph().nodes[0], goal_threshold_unit: 42 }] }])(
    'fails closed when the current selected goal cannot be uniquely verified: %j', (currentGraph) => {
      expect(derive(currentGraph)).toMatchObject({ freshness: 'stale', reason: 'goal_snapshot_unverified' });
    });

  it.each([42, '', null])('does not fall back from an explicit invalid selected id: %j', (goal_node_id) => {
    expect(derive({ ...graph(), goal_node_id })).toMatchObject({ freshness: 'stale', reason: 'goal_snapshot_unverified' });
  });

  it('does not attach a snapshot for a different goal to a current Run', () => {
    expect(derive(graph(), fact({ goal: { node_id: 'other', unit: 'GBP/month' } })))
      .toMatchObject({ freshness: 'stale', reason: 'goal_snapshot_unverified' });
  });

  it('allows only a unique goal fallback when no explicit selected id was recorded', () => {
    const single = { nodes: graph().nodes, edges: [] };
    expect(derive(single).freshness).toBe('fresh');
    expect(derive({ ...single, nodes: [...single.nodes, { id: 'growth', kind: 'goal' }] }).freshness).toBe('stale');
  });

  it('missing unit stays absent, while adding or removing a unit stales the Run', () => {
    const noUnit = { nodes: [{ id: 'mrr', kind: 'goal' }], goal_node_id: 'mrr' };
    expect(derive(noUnit, fact({ goal: { node_id: 'mrr' } })).freshness).toBe('fresh');
    expect(derive(graph(), fact({ goal: { node_id: 'mrr' } }))).toMatchObject({ reason: 'goal_unit_changed' });
    expect(derive(noUnit)).toMatchObject({ reason: 'goal_unit_changed' });
  });

  it.each([null, '', 'x'.repeat(65)])('an omitted outbound unit becomes current after rerun from persisted %j', (unit) => {
    const rerun = fact({ goal: { node_id: 'mrr', label: 'Monthly revenue', target_raw: 85_000 } });
    expect(derive(graph(unit), rerun)).toMatchObject({ freshness: 'fresh', reason: 'graph_hash_match',
      graph_hash_at_run: HASH, current_graph_hash: HASH, computed_at: AT, selected_fact_index: 0 });
    expect(derive(graph(unit))).toMatchObject({ freshness: 'stale', reason: 'goal_unit_changed' });
  });

  it.each(['x'.repeat(64), ' GBP/month ', ' '])('keeps valid sent unit bytes exactly: %j', (unit) => {
    expect(derive(graph(unit), fact({ goal: { node_id: 'mrr', unit } })).freshness).toBe('fresh');
    expect(derive(graph(unit), fact({ goal: { node_id: 'mrr' } })).reason).toBe('goal_unit_changed');
  });

  it('does not equate padded sent units with trimmed units', () => {
    expect(derive(graph(' GBP/month '))).toMatchObject({ freshness: 'stale', reason: 'goal_unit_changed' });
  });

  it.each([null, { goal: [] }, { goal: {} }, { goal: { node_id: 'mrr', unit: 0 } },
    { goal: { node_id: 'mrr', unit: null } }, { goal: { node_id: 'mrr', unit: '' } },
    { goal: { node_id: 'mrr', unit: 'x'.repeat(65) } }])(
    'fails closed on a malformed present snapshot: %j', (snapshot) => {
      expect(derive(graph(), fact(snapshot))).toMatchObject({ freshness: 'stale', reason: 'goal_snapshot_unverified' });
    });

  it('preserves legacy and goal-free hash currentness without manufacturing a unit', () => {
    const legacy = fact();
    delete (legacy as unknown as { result: { input_snapshot?: unknown } }).result.input_snapshot;
    expect(derive(graph('USD/month'), legacy).freshness).toBe('fresh');
    expect(derive(null, fact({})).freshness).toBe('fresh');
    expect(derive(null, fact({ goal: null })).freshness).toBe('fresh');
    expect(deriveAnalysisFreshness([legacy], 'different').freshness).toBe('stale');
  });

  it('restore chronology still wins; unit metadata cannot resurrect an invalidated Run', () => {
    expect(deriveAnalysisFreshness([fact()], HASH, undefined, { currentGraph: graph(),
      analysisInvalidatedAt: '2026-09-30T11:03:22.019Z' }))
      .toMatchObject({ freshness: 'stale', reason: 'model_restored_after_analysis' });
  });
});


describe('goal-unit stale current-turn and shared wire egress', () => {
  const compose = (freshness: ReturnType<typeof derive>, withLifecycle = true) => composeToolCallResponse({
    orientation: 'Analysis received.', confirmation: 'Run saved.', coaching: null,
    stage: 'analyse', answerKind: 'functional', handlerFacts: [fact()],
    persistedGraph: graph('USD/month'), persistedGraphHash: HASH,
    ...(withLifecycle ? { lifecycle: { freshness, priorFacts: [fact()], requestId: 'unit-test', scenarioId: 'scenario' } }
      : { freshness }),
  });

  it.each(['goal_unit_changed', 'goal_snapshot_unverified'] as const)(
    'withholds live result, Phase 3 cards and focus for %s; offers rerun coaching', (reason) => {
      const freshness = { ...derive(graph('USD/month')), reason };
      const out = compose(freshness);
      expect(out.blocks.map((b) => b.type)).toEqual(['coaching']);
      expect(compose(freshness, false).blocks.map((b) => b.type)).toEqual(['coaching']);
      expect(out.blocks[0]).toMatchObject({ freshness: 'stale', action_intent: 'rerun_analysis' });
      expect(JSON.stringify(out.blocks)).toContain(reason === 'goal_unit_changed'
        ? 'your goal’s unit changed' : 'the saved goal’s unit could not be confirmed');
      const canonical = selectCanonicalAnalysisState({ priorFacts: [fact()], currentGraphHash: HASH,
        currentGraph: graph('USD/month') });
      const state = composeAnalysisStateV1({ canonical, freshness, mayNameLeadingOption: false, rawRobustness: null })!;
      const currentResult = compose(derive(graph())).blocks;
      expect(currentResult.some((b) => b.type === 'analysis_result')).toBe(true);
      expect(projectAnalysisBlocksForRunBinding(currentResult, state, reason)
        .some((b) => b.type === 'analysis_result')).toBe(false);
      expect(projectAnalysisBlocksForRunBinding(currentResult, state, 'graph_hash_diverged'))
        .toEqual(currentResult);
    });

  it('does not rebuild populated Phase 3 cards on a chip path without lifecycle metadata', () => {
    const populated = fact() as unknown as { result: Record<string, unknown> };
    populated.result.constraint_verdict = { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' };
    populated.result.leading_option_id = 'opt_a';
    populated.result.enrichment = {
      analysis_status: 'computed',
      graph: { nodes: [{ id: 'fac_delivery_risk', label: 'Delivery risk', kind: 'factor' }] },
      factor_sensitivity: [{ factor_id: 'fac_delivery_risk', confidence: 0.2 }],
      decision_review: {
        narrative_summary: 'Plan A leads with a comfortable margin.', story_headlines: {},
        robustness_explanation: { summary: 'Stable.', primary_risk: null }, readiness_rationale: 'Ready.',
        evidence_enhancements: { fac_delivery_risk: { specific_action: 'check the last two releases',
          rationale: 'delivery rate is the highest variance driver', evidence_type: 'internal_data', decision_hygiene: 'estimate first' } },
        scenario_contexts: {}, flip_thresholds: [], bias_findings: [],
        key_assumptions: ['Market conditions persist for the next two quarters.'], decision_quality_prompts: [],
      },
    };
    const build = (freshness: ReturnType<typeof derive>) => composeToolCallResponse({
      orientation: '', confirmation: 'Run saved.', coaching: null, stage: 'analyse', answerKind: 'functional',
      handlerFacts: [populated as unknown as HandlerFact], freshness,
    });
    expect(build(derive(graph())).blocks.some((b) => b.type === 'review_card' || b.type === 'evidence')).toBe(true);
    expect(build(derive(graph('USD/month'))).blocks.map((b) => b.type)).toEqual(['coaching']);
  });

  it('maps the human unit reason onto the existing freshness text carrier without restamping the Run', () => {
    expect(attachComputedAt({ options: [], goal_node_id: 'mrr', status: 'ready' }, derive(graph('USD/month'))))
      .toMatchObject({ freshness: 'stale', freshness_reason: 'your goal’s unit changed', computed_at: AT,
        graph_hash_at_run: HASH, current_graph_hash: HASH });
  });

  it('preserves ordinary graph-stale current-turn result behaviour', () => {
    expect(compose({ ...derive(graph('USD/month')), reason: 'graph_hash_diverged' })
      .blocks.some((b) => b.type === 'analysis_result')).toBe(true);
  });
});


describe('goal-unit stale comparisons cannot return through AI prompt context', () => {
  it('withholds the same comparison in the pack, with a legacy ordinary-stale control', () => {
    const canonical = selectCanonicalAnalysisState({ priorFacts: [fact()], currentGraphHash: HASH,
      currentGraph: graph('USD/month') });
    const pack = (freshness_reason: typeof canonical.freshness_reason) => assembleContextPack({
      payload: makeMessagePayload({ scenario_id: 'unit-stale-pack', message: 'What changed?' }),
      priorTurns: [], priorFacts: PRESENT_PAIR, priorFactsReadOk: true,
      graphContext: { status: 'canonical' }, mayNameLeadingOption: true,
      canonicalState: { ...canonical, freshness_reason },
    });
    expect(pack('goal_unit_changed').run_delta).toBeUndefined();
    expect(pack('goal_snapshot_unverified').run_delta).toBeUndefined();
    expect(pack('graph_hash_diverged').run_delta).toBeDefined();
  });
});
