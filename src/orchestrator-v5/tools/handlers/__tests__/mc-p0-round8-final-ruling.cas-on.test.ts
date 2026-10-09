import { withScenarioRevision } from '../../../../../tests/utils/revision-store-double.js';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { GraphV3Schema } from '@talchain/schemas';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';
const reads = vi.hoisted(() => ({ facts: [] as any[] }));
vi.mock('../../../session/index.js', async original => ({
  ...(await original<typeof import('../../../session/index.js')>()),
  getSessionStore: () => withScenarioRevision(({
    readMostRecentPendingActions: async () => [], readRecent: async () => [], readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [], readAnalysisInvalidatedAt: async () => null,
    readScenarioRunAnalysisFactsFor: async () => ({ facts: reads.facts.map((fact, i) => ({ fact,
      fact_row_id: `r8-${i}`, fact_created_at: fact.result.computed_at })), total_count: reads.facts.length }),
  })),
}));
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { SupabaseSessionStore } from '../../../session/supabase-store.js';
import { SessionLRUCache } from '../../../session/cache.js';
import { readScenarioAnalysis } from '../../../../routes/scenario-graph-analysis-read.js';
import { leaderLicenceShadow } from '../../../compose/leader-licence-shadow.js';
import { runP0Graph } from './mc-p0-run-helper.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';

type R = Record<string, any>;
const fa027Graph = JSON.parse(readFileSync(new URL('../../../handlers/__tests__/fixtures/sci-deep-fa027cf5-graph.json', import.meta.url), 'utf8')) as R;
// pre-ruling legacy class: a defaulted size that is not the door constant (Science 393023 LICENCE (a))
const fa027Legacy = structuredClone(fa027Graph);
for (const edge of fa027Legacy.edges) {
  if (edge.defaulted === true && Math.abs(edge.strength.mean) === 0.5 && edge.strength.std === 0.125
    && edge.provenance?.magnitude === undefined && edge.provenance?.natural_effect === undefined) edge.strength.std = 0.1;
}
const scenario = '714abc5c-4e82-4436-9454-eec6c8f68589';
const edge = (from: string, to: string, provenance: R = { source: 'cee_hypothesis', mean_projected: true }) => ({
  from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 0.8, effect_direction: 'positive', defaulted: true, provenance,
});
function graph(provenance: R = { source: 'cee_hypothesis', mean_projected: true }): R {
  return { nodes: [
    { id: 'g', kind: 'goal', label: 'Revenue' },
    { id: 'x', kind: 'factor', label: 'Capacity', observed_state: { value: 0.1, source: 'user_override' } },
    { id: 'a', kind: 'option', label: 'Expand', interventions: { x: { value: 0.8, source: 'brief_extraction' } } },
    { id: 'b', kind: 'option', label: 'Pilot', interventions: { x: { value: 0.4, source: 'brief_extraction' } } },
  { id: 'd', kind: 'decision', label: 'Compare capacity options' },
  ], edges: [edge('d', 'a', { source: 'brief_extraction' }), edge('d', 'b', { source: 'brief_extraction' }), edge('a', 'x', { source: 'brief_extraction' }), edge('b', 'x', { source: 'brief_extraction' }), edge('x', 'g', provenance)], goal_node_id: 'g' };
}
const link = (g: R) => g.edges.find((e: R) => e.from === 'x' && e.to === 'g');
// RE-PINNED (no-dead-end (A), MC 21 + Science d5, #2623): this fixture's goal has no frame, so the link into it cannot be
// sized yet; the statement asks today's level first (the served P5 question), and the existing card records it.
const withholdWords = 'This comparison turns on the link from ‘Capacity’ to ‘Revenue’, whose strength isn\'t sized in the model yet. To size it, I first need today’s level of ‘Revenue’. What is it?';

async function saveAndReload(g: R, facts: R[] = []): Promise<{ graph: R; facts: R[] }> {
  let row: R = { graph: null, revision: 7 };
  const chain: R = { select: () => chain, eq: () => chain, limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: { graph: structuredClone(row.graph), brief_text: 'Compare these options.', revision: row.revision }, error: null }) };
  const client = { from: () => chain, rpc: async (_name: string, args: R) => {
    expect(_name).toBe('append_turn_atomic_v4r');
    expect(args.p_expected_revision).toBe(row.revision);
    row = JSON.parse(JSON.stringify({ graph: args.p_graph, facts: args.p_handler_facts, revision: Number(row.revision) + 1 }));
    return { data: { turn_row_id: 'saved-r8', revision: row.revision }, error: null };
  } };
  const store = new SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }), { defaultReadLimit: 20, graphCasMode: 'off' });
  const base = await store.loadGraphAndBriefText(scenario);
  await store.append({ expectedRevision: base.revision, scenario_id: scenario, turn_id: 'r8-save', turn_class: 'direct_answer', handler_id: null,
    request_hash: 'sha256:r8', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
    graph: projectGraphForPersistence(GraphV3.parse(GraphV3Schema.parse(GraphStateIngressSchema.parse(g)))), handler_facts: facts as never });
  const loaded = (await store.loadGraphAndBriefText(scenario)).graph as R;
  // The database serialisation wraps the fact in fact_payload. Real cold-store parsing is HandlerFactSchema.
  const savedFacts = row.facts.map((r: R) => HandlerFactSchema.parse({ ...r.payload, noop: r.noop }));
  return { graph: loaded, facts: savedFacts };
}




it.each([false, true])('R8 save → reload → Run → stored fact → cold read retains warnings.links; legacy=%s', async legacy => {
  const g = graph(legacy ? { source: 'cee_hypothesis' } : undefined);
  const saved = await saveAndReload(g);
  expect(link(saved.graph).provenance.mean_projected).toBe(legacy ? undefined : true);
  const r = await runP0Graph(saved.graph, 'Compare the options.');
  const code = legacy ? 'GOAL_FIGURES_OLUMI_SUPPLIED_LINK' : 'GOAL_FIGURES_PLACEHOLDER_PATH';
  const warning = r.enrichment.inference_warnings.find((w: R) => w.code === code);
  expect(warning.links).toEqual([{ from: 'x', to: 'g' }]);
  expect(warning.node_ids).toEqual(['x', 'g']);
  expect(warning.severity).toBe(legacy ? 'info' : 'warning');
  expect(warning.message).toBe(legacy ? 'Olumi supplied the figures for the link from ‘Capacity’ to ‘Revenue’. Set your own to see how much it matters.' : withholdWords);
  expect(r.leading_option_id).toBe(legacy ? 'a' : null);
  if (legacy) {
    const shadow = leaderLicenceShadow({ fact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: r } as never, graph: saved.graph, scenarioId: scenario, summaryNamesLeader: true });
    expect(shadow.verdict).toMatchObject({ verdict: 'permitted', leader_option_id: 'a', reason: null });
    expect(r.summary).toContain(warning.message);
    expect(isAllowedRunAnalysisAssistantText(r.summary)).toBe(true);
  }
  const persisted = await saveAndReload(saved.graph, [{ fact_type: 'run_analysis', fact_version: 1, noop: false, result: r }]);
  reads.facts = persisted.facts;
  const cold = await readScenarioAnalysis({ scenarioId: scenario, graph: persisted.graph as never, requestId: 'r8-cold' });
  if (cold.analysis_result?.type !== 'analysis_result') throw new Error('R8 cold read omitted analysis_result');
  expect(cold.analysis_result?.enrichment?.inference_warnings).toEqual(r.enrichment.inference_warnings);
  expect(cold.analysis_state?.leader_claim).toMatchObject(legacy ? { permitted: true } : { permitted: false, withheld_reason: 'goal_path_unsized' });
});
















it('RD-1/RD-2 fa027 stored shape: licence permitted, all legacy names immediately after leader sentence, reply allowlist + cold read', async () => {
  const g = structuredClone(fa027Legacy);
  const saved = await saveAndReload(g);
  // The stored shape has an unvalued Split Sprint arm the real loader excludes; the synthetic engine must score only the sent arms.
  const body = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8'));
  const compared = ['ai_reporting_module_sprint', 'integration_bug_fix_sprint', 'continue_current_plan'];
  body.option_comparison = compared.map((id, i) => ({ option_id: id, option_label: g.nodes.find((n: R) => n.id === id).label, win_probability: i === 0 ? 0.8 : 0.1, probability_of_goal: null, status: 'computed', outcome: { mean: 0.8 - i * 0.2, std: 0.05, p10: 0.5, p50: 0.6, p90: 0.9, n_samples: 10000, n_valid_samples: 10000, validity_ratio: 1, percentiles_source: 'samples' } }));
  body.results = structuredClone(body.option_comparison);
  body.identity_evaluations = []; body.inference_warnings = []; body.fact_objects = []; body.review_cards = [];
  body.decision_brief = { options: structuredClone(body.option_comparison), analysis_summary: { leading_option: compared[0], win_probability: 0.8 } };
  const r = await runP0Graph(saved.graph, 'Compare the sprint options.', body);
  const w = r.enrichment.inference_warnings.find((w: R) => w.code === 'GOAL_FIGURES_OLUMI_SUPPLIED_LINK');
  const words = 'Olumi supplied the figures for the links from ‘Enterprise prospect signing likelihood’ to ‘Quarterly revenue’, from ‘Revenue lost to trial abandonment’ to ‘Quarterly revenue’ and from ‘Trial profile abandonment rate’ to ‘Revenue lost to trial abandonment’. Set your own to see how much they matter.';
  expect(w.message).toBe(words);
  expect(w.links).toEqual([
    { from: 'enterprise_prospect_signing_likelihood', to: 'quarterly_revenue' },
    { from: 'revenue_lost_to_trial_abandonment', to: 'quarterly_revenue' },
    { from: 'trial_profile_abandonment_rate', to: 'revenue_lost_to_trial_abandonment' },
  ]);
  expect(r.leading_option_id).toBe('ai_reporting_module_sprint');
  const shadow = leaderLicenceShadow({ fact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: r } as never, graph: saved.graph, scenarioId: scenario, summaryNamesLeader: true });
  expect(shadow.verdict).toMatchObject({ verdict: 'permitted', leader_option_id: 'ai_reporting_module_sprint', reason: null });
  // The lead ladder's rung 1 (Science d5 #87 6008589328): this goal has a unit, so the lead names its quantity.
  expect(r.summary.startsWith(`AI Reporting Module Sprint gave the highest quarterly revenue in 80% of runs of this model because Price is the strongest driver. ${words}`)).toBe(true);
  expect(isAllowedRunAnalysisAssistantText(r.summary)).toBe(true);
  const persisted = await saveAndReload(saved.graph, [{ fact_type: 'run_analysis', fact_version: 1, noop: false, result: r }]);
  reads.facts = persisted.facts;
  const cold = await readScenarioAnalysis({ scenarioId: scenario, graph: persisted.graph as never, requestId: 'r8-fa027-cold' });
  if (cold.analysis_result?.type !== 'analysis_result') throw new Error('R8 fa027 cold read omitted analysis_result');
  expect(cold.analysis_state?.leader_claim).toMatchObject({ permitted: true });
  expect(cold.analysis_result?.leading_option_id).toBe(r.leading_option_id);
  expect(cold.analysis_result?.enrichment?.inference_warnings).toEqual(r.enrichment.inference_warnings);
});

it('RD-1/RD-2 LICENCE (a): as-served fa027 door constants withhold, exact names survive reply + cold read', async () => {
  const g = structuredClone(fa027Graph);
  const saved = await saveAndReload(g);
  // The stored shape has an unvalued Split Sprint arm the real loader excludes; the synthetic engine must score only the sent arms.
  const body = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8'));
  const compared = ['ai_reporting_module_sprint', 'integration_bug_fix_sprint', 'continue_current_plan'];
  body.option_comparison = compared.map((id, i) => ({ option_id: id, option_label: g.nodes.find((n: R) => n.id === id).label, win_probability: i === 0 ? 0.8 : 0.1, probability_of_goal: null, status: 'computed', outcome: { mean: 0.8 - i * 0.2, std: 0.05, p10: 0.5, p50: 0.6, p90: 0.9, n_samples: 10000, n_valid_samples: 10000, validity_ratio: 1, percentiles_source: 'samples' } }));
  body.results = structuredClone(body.option_comparison);
  body.identity_evaluations = []; body.inference_warnings = []; body.fact_objects = []; body.review_cards = [];
  body.decision_brief = { options: structuredClone(body.option_comparison), analysis_summary: { leading_option: compared[0], win_probability: 0.8 } };
  const r = await runP0Graph(saved.graph, 'Compare the sprint options.', body);
  // Science 393023 LICENCE (a)/(b), 7 Oct: fa027 door defaults now withhold as placeholder paths.
  const w = r.enrichment.inference_warnings.find((w: R) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH');
  expect(r.enrichment.inference_warnings.map((w: R) => w.code)).not.toContain('GOAL_FIGURES_OLUMI_SUPPLIED_LINK');
  const words = "This comparison turns on the links from ‘Enterprise prospect signing likelihood’ to ‘Quarterly revenue’, from ‘Revenue lost to trial abandonment’ to ‘Quarterly revenue’ and from ‘Trial profile abandonment rate’ to ‘Revenue lost to trial abandonment’, whose strengths aren't sized in the model yet. To size them, I first need today’s level of ‘Quarterly revenue’. What is it, in currency/quarter?";
  expect(w.message).toBe(words);
  expect(w.links).toEqual([
    { from: 'enterprise_prospect_signing_likelihood', to: 'quarterly_revenue' },
    { from: 'revenue_lost_to_trial_abandonment', to: 'quarterly_revenue' },
    { from: 'trial_profile_abandonment_rate', to: 'revenue_lost_to_trial_abandonment' },
  ]);
  // Science 393023 LICENCE (a)/(b), 7 Oct: the unsized path withholds the leader.
  expect(r.leading_option_id).toBeNull();
  const shadow = leaderLicenceShadow({ fact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: r } as never, graph: saved.graph, scenarioId: scenario, summaryNamesLeader: true });
  // Science 393023 LICENCE (a)/(b), 7 Oct: the shadow records the placeholder-path withhold.
  expect(shadow.verdict).toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: 'goal_figures_withheld' });
  // Science 393023 LICENCE (a)/(b), 7 Oct: the summary keeps the existing no-leader fallback and disclosure tails.
  expect(r.summary).toBe("Ran analysis on your current scenario. 'Continue Current Plan' was analysed as no change — the factors it compares against were held at the values your model records today. I supplied 17 of the values behind this, because your brief did not state them. They are mine rather than yours. Changing any of them changes what this model implies.");
  expect(isAllowedRunAnalysisAssistantText(r.summary)).toBe(true);
  const persisted = await saveAndReload(saved.graph, [{ fact_type: 'run_analysis', fact_version: 1, noop: false, result: r }]);
  reads.facts = persisted.facts;
  const cold = await readScenarioAnalysis({ scenarioId: scenario, graph: persisted.graph as never, requestId: 'r8-fa027-cold' });
  if (cold.analysis_result?.type !== 'analysis_result') throw new Error('R8 fa027 cold read omitted analysis_result');
  // Science 393023 LICENCE (a)/(b), 7 Oct: cold read keeps the same placeholder-path withhold.
  expect(cold.analysis_state?.leader_claim).toMatchObject({ permitted: false, withheld_reason: 'goal_path_unsized' });
  expect(cold.analysis_result?.leading_option_id).toBe(r.leading_option_id);
  expect(cold.analysis_result?.enrichment?.inference_warnings).toEqual(r.enrichment.inference_warnings);
});








