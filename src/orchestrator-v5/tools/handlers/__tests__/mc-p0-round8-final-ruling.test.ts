import { applyPatchOperations } from '../../../../orchestrator/patch-applier.js';
import { buildUpdateEdgeFieldCandidate } from '../../../graph-management/candidate-graph.js';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { GraphV3Schema } from '@talchain/schemas';
import { HandlerFactSchema } from '@talchain/schemas/orchestrator';
const reads = vi.hoisted(() => ({ facts: [] as any[] }));
vi.mock('../../../session/index.js', async original => ({
  ...(await original<typeof import('../../../session/index.js')>()),
  getSessionStore: () => ({
    readMostRecentPendingActions: async () => [], readRecent: async () => [], readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [], readAnalysisInvalidatedAt: async () => null,
    readScenarioRunAnalysisFactsFor: async () => ({ facts: reads.facts.map((fact, i) => ({ fact,
      fact_row_id: `r8-${i}`, fact_created_at: fact.result.computed_at })), total_count: reads.facts.length }),
  }),
}));
import { admitCandidateLinks } from '../../../agent-lane/admit-candidate.js';
import { admitCandidateModel } from '../../../agent-lane/admit-model.js';
import { unsizedLeaderGoalPaths, legacyLeaderGoalLinks, placeholderGoalWarning } from '../../../agent-lane/goal-certainty.js';
import { readUnsizedPathLeaderCause, unsizedLinkSentence } from '../../../agent-lane/unsized-path-cause.js';
import { GraphV3, EdgeProvenanceV3 } from '../../../../schemas/cee-v3.js';
import { GraphStateIngressSchema } from '../../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../../persisted-graph-projection.js';
import { SupabaseSessionStore } from '../../../session/supabase-store.js';
import { SessionLRUCache } from '../../../session/cache.js';
import { readScenarioAnalysis } from '../../../../routes/scenario-graph-analysis-read.js';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { keepMeanProjectionWhenSizeUnchanged, sizedByApproval } from '../../../../cee/magnitude/link-sizing.js';
import { frameDefaultedLinks } from '../../../../cee/magnitude/frame-defaulted-links.js';
import { applyLinkEffectEdit, linkEffectEdgeToken, linkEffectReadingToken } from '../../../system-events/link-effect-edit.js';
import { targetTestabilityOf, notTargetTestableSentence } from '../../../admission/target-testability.js';
import { enforceAgentLaneLeaderClaimsAtWire } from '../../../agent-lane/withheld-leader-fail-closed.js';
import { leaderLicenceShadow } from '../../../compose/leader-licence-shadow.js';
import { runP0Graph } from './mc-p0-run-helper.js';
import { appendLegacyFiguresAfterLeaderSentence, isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';

type R = Record<string, any>;
const fa027Graph = JSON.parse(readFileSync(new URL('../../../handlers/__tests__/fixtures/sci-deep-fa027cf5-graph.json', import.meta.url), 'utf8')) as R;
// pre-ruling legacy class: a defaulted size that is not the door constant (Science 393023 LICENCE (a))
const fa027Legacy = structuredClone(fa027Graph);
for (const edge of fa027Legacy.edges) {
  if (edge.defaulted === true && Math.abs(edge.strength.mean) === 0.5 && edge.strength.std === 0.125
    && edge.provenance?.magnitude === undefined && edge.provenance?.natural_effect === undefined) edge.strength.std = 0.1;
}
const ids = ['a', 'b'];
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
const hash = (g: R) => computeAnalysisAffectingGraphHash(g as never);
const link = (g: R) => g.edges.find((e: R) => e.from === 'x' && e.to === 'g');
// RE-PINNED (no-dead-end (A), MC 21 + Science d5, #2623): this fixture's goal has no frame, so the link into it cannot be
// sized yet; the statement asks today's level first (the served P5 question), and the existing card records it.
const withholdWords = 'This comparison turns on the link from ‘Capacity’ to ‘Revenue’, whose strength isn\'t sized in the model yet. To size it, I first need today’s level of ‘Revenue’. What is it?';

async function saveAndReload(g: R, facts: R[] = []): Promise<{ graph: R; facts: R[] }> {
  let row: R = {};
  const chain: R = { select: () => chain, eq: () => chain, limit: async () => ({ data: [], error: null }),
    maybeSingle: async () => ({ data: { graph: structuredClone(row.graph), brief_text: 'Compare these options.' }, error: null }) };
  const client = { from: () => chain, rpc: async (_name: string, args: R) => {
    row = JSON.parse(JSON.stringify({ graph: args.p_graph, facts: args.p_handler_facts }));
    return { data: 'saved-r8', error: null };
  } };
  const store = new SupabaseSessionStore(client as never, new SessionLRUCache({ maxScenarios: 5, maxTurnsPerScenario: 10 }), { defaultReadLimit: 20, graphCasMode: 'off' });
  await store.append({ scenario_id: scenario, turn_id: 'r8-save', turn_class: 'direct_answer', handler_id: null,
    request_hash: 'sha256:r8', response_emitted: true, llm_calls_used: 0, duration_ms: 1,
    graph: projectGraphForPersistence(GraphV3.parse(GraphV3Schema.parse(GraphStateIngressSchema.parse(g)))), handler_facts: facts as never });
  const loaded = (await store.loadGraphAndBriefText(scenario)).graph as R;
  // The database serialisation wraps the fact in fact_payload. Real cold-store parsing is HandlerFactSchema.
  const savedFacts = row.facts.map((r: R) => HandlerFactSchema.parse({ ...r.payload, noop: r.noop }));
  return { graph: loaded, facts: savedFacts };
}

it('R8-2: carrier is literal true or absent, malformed drops; CEE + pinned 0.77 + ingress preserve true', () => {
  expect(EdgeProvenanceV3.parse({ source: 'cee_hypothesis', mean_projected: false }).mean_projected).toBeUndefined();
  const parsed = GraphV3.parse(GraphV3Schema.parse(GraphStateIngressSchema.parse(graph())));
  expect(link(parsed).provenance.mean_projected).toBe(true);
});

it('R8-7: re-admission of a captured drafter with no strength_mean records projected mean and withholds', async () => {
  const candidate = JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/faithful.json', import.meta.url), 'utf8'));
  expect(candidate.links.every((l: R) => l.strength_mean === undefined)).toBe(true);
  // Captured drafter links, with an explicit comparison twin: the capture predates recorded interventions.
  candidate.options.forEach((o: R, i: number) => { o.interventions = [{ factor_label: 'Pro feature release', value: i === 0 ? 0.8 : 0.4, unit: null, provenance: 'explicit' }]; });
  candidate.risks = []; candidate.outcomes = []; // unconnected capture annotations are outside this Run comparison twin.
  candidate.factors.forEach((f: R) => { if (!f.baseline_known) Object.assign(f, { baseline_known: true, baseline_value: 0.1 }); });
  const admitted = admitCandidateModel(candidate);
  const g: R = { nodes: admitted.nodes, edges: admitted.edges };
  const projected = g.edges.filter((e: R) => e.provenance?.mean_projected === true);
  expect(projected.length).toBeGreaterThan(0);
  const compared = g.nodes.filter((n: R) => n.kind === 'option').map((n: R) => n.id);
  const paths = unsizedLeaderGoalPaths(g, compared);
  expect(paths.length).toBeGreaterThan(0);
  const r = await runP0Graph(g, 'Compare the Pro plans.');
  expect(r.leading_option_id).toBeNull();
  expect(readUnsizedPathLeaderCause(r)?.links?.length).toBeGreaterThan(0);
  expect(r.enrichment.inference_warnings.find((w: R) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH').message).toMatch(/^This comparison turns on the links? from /);
});

it('R8-7: new authored mean plus projected spread retains leader without withhold or legacy disclosure', async () => {
  const admitted = admitCandidateLinks([{ from: 'x', to: 'g', direction: 'positive', provenance: 'explicit', strength_mean: 0.83 }]);
  expect(admitted.edges[0].defaulted).toBe(true);
  expect(admitted.edges[0].provenance?.mean_projected).toBeUndefined();
  // An authored mean must retain a magnitude mark so it cannot masquerade as legacy unrecorded.
  expect(admitted.edges[0].provenance?.magnitude).toBe('olumi_estimate');
  const g = graph(); g.edges[g.edges.indexOf(link(g))] = admitted.edges[0];
  const r = await runP0Graph(g, 'Compare the options.');
  expect(r.leading_option_id).toBe('a');
  expect(r.enrichment.inference_warnings.map((w: R) => w.code)).not.toContain('GOAL_FIGURES_PLACEHOLDER_PATH');
  expect(r.enrichment.inference_warnings.map((w: R) => w.code)).not.toContain('GOAL_FIGURES_OLUMI_SUPPLIED_LINK');
});

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

it('R8-6: three withholding links on two actual-move paths, duplicate endpoint, nearest goal first in cause and warning', async () => {
  const g = graph();
  g.nodes.push({ id: 'y', kind: 'factor', label: 'Quality', observed_state: { value: 0.1, source: 'user_override' } });
  g.nodes.find((n: R) => n.id === 'b').interventions = { x: { value: 0.1, source: 'brief_extraction' }, y: { value: 0.4, source: 'brief_extraction' } };
  g.edges = [...g.edges.filter((e: R) => e.from === 'd' || e.from === 'a' || e.from === 'b'), edge('x', 'y'), edge('y', 'g'), edge('x', 'g'), edge('x', 'y')];
  const r = await runP0Graph(g, 'Compare the options.');
  const expected = [{ from: 'y', to: 'g' }, { from: 'x', to: 'g' }, { from: 'x', to: 'y' }];
  const w = r.enrichment.inference_warnings.find((w: R) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH');
  expect(w.links).toEqual(expected);
  expect(w.node_ids).toEqual(['x', 'y', 'g']); // unchanged raw walk order, back-compat
  // RE-PINNED (no-dead-end (A), MC 21 + Science d5, #2623): this fixture's goal has no frame, so no link into it can be
  // sized yet; the statement now asks today's level first (the served P5 question), and the existing card records it.
  expect(w.message).toBe('This comparison turns on the links from ‘Quality’ to ‘Revenue’, from ‘Capacity’ to ‘Revenue’ and from ‘Capacity’ to ‘Quality’, whose strengths aren\'t sized in the model yet. To size them, I first need today’s level of ‘Revenue’. What is it?');
  const cause = readUnsizedPathLeaderCause(r)!;
  expect(cause.links).toEqual(expected.map(l => ({ ...l,
    from_label: g.nodes.find((n: R) => n.id === l.from).label, to_label: g.nodes.find((n: R) => n.id === l.to).label })));
  const wire = enforceAgentLaneLeaderClaimsAtWire({ assistant_text: 'Expand is the best option.',
    blocks: [{ type: 'analysis_result', enrichment: r.enrichment }],
    analysis_state: { leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } } } as never,
    { requestId: 'r8-wire', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: 'goal_path_unsized', graph: g } as never);
  expect(wire.response.assistant_text).toBe(w.message);
});

it('R8-6c: P5 all three failing links are named and counted, predicate includes estimates unchanged', () => {
  const g = graph(); Object.assign(g.nodes[0], { goal_threshold: 0.8, goal_threshold_raw: 100, goal_threshold_unit: 'GBP/month', goal_comparator: '>=', goal_threshold_frame: 'level', observed_state: { baseline: 10, unit: 'GBP/month' } });
  g.nodes.push({ id: 'y', kind: 'factor', label: 'Quality', observed_state: { value: 0.1, source: 'user_override' } });
  g.edges.push(edge('x', 'y', { source: 'cee_hypothesis', magnitude: 'olumi_estimate' }), edge('y', 'g'));
  const v = targetTestabilityOf(g);
  expect(v.kind).toBe('not_testable');
  if (v.kind !== 'not_testable') return;
  const failure = v.failures.find(f => f.precondition === 'P5')!;
  expect(failure.lever).toBe('Capacity');
  expect(failure.links).toEqual([{ from: 'x', to: 'g' }, { from: 'y', to: 'g' }, { from: 'x', to: 'y' }]);
  expect(notTargetTestableSentence(g, v)).toContain('the links from Capacity to Revenue, from Quality to Revenue and from Capacity to Quality');
});

it('R8 multiple legacy links: first nearest goal, grammatical plural invitation, complete typed list', async () => {
  const g = graph({ source: 'cee_hypothesis' }); g.nodes.push({ id: 'y', kind: 'factor', label: 'Quality', observed_state: { value: 0.1, source: 'user_override' } });
  g.edges.push(edge('x', 'y', { source: 'cee_hypothesis' }), edge('y', 'g', { source: 'cee_hypothesis' }));
  const r = await runP0Graph(g, 'Compare the options.');
  const w = r.enrichment.inference_warnings.find((w: R) => w.code === 'GOAL_FIGURES_OLUMI_SUPPLIED_LINK');
  expect(w.links).toEqual([{ from: 'x', to: 'g' }, { from: 'y', to: 'g' }, { from: 'x', to: 'y' }]);
  expect(w.message).toBe('Olumi supplied the figures for the links from ‘Capacity’ to ‘Revenue’, from ‘Quality’ to ‘Revenue’ and from ‘Capacity’ to ‘Quality’. Set your own to see how much they matter.');
  expect(r.summary).toContain(w.message);
});

it('R8-1: identity exactInto, user sizing and estimates never withhold, legacy dead paths never disclose', () => {
  const g = graph(); g.nodes[0].nonlinear_identity = { operation: 'product', factor_ids: ['x'], stated_in_brief: true };
  expect(unsizedLeaderGoalPaths(g, ids)).toEqual([]);
  delete g.nodes[0].nonlinear_identity;
  for (const provenance of [{ source: 'cee_hypothesis', magnitude: 'user_stated', mean_projected: true }, { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: { amount: 1 } }]) {
    link(g).provenance = provenance; expect(unsizedLeaderGoalPaths(g, ids)).toEqual([]);
  }
  // Science 393023 LICENCE ruling 1 (7 Oct 20:48Z), re-derived: `user_specified` + `mean_projected` = the user drew the
  // link and gave no number, so it is unsized and withholds (was: read as the user's size).
  link(g).provenance = { source: 'user_specified', mean_projected: true };
  const withheld = unsizedLeaderGoalPaths(g, ids);
  expect(withheld.map(p => p.option_id).sort()).toEqual([...ids].sort());
  for (const p of withheld) expect(p.links).toContainEqual({ from: link(g).from, to: link(g).to });
  g.nodes.push({ id: 'dead', kind: 'factor', label: 'Unused' }); g.edges.push(edge('x', 'dead', { source: 'cee_hypothesis' }));
  expect(legacyLeaderGoalLinks(g, ids)).toEqual([]);
});

async function adjust(g: R, strength: number): Promise<R> {
  const r = await createAdjustEdgeStrengthHandler()({ context: { session_id: scenario, stage: 'frame', request_id: 'r8-edit', prior_turns: [], prior_facts: [] },
    payload: { kind: 'message', scenario_id: scenario, turn_id: 'r8', stage: 'frame', message: 'Record this strength.' },
    requestId: 'r8-edit', signal: new AbortController().signal, orientationText: '', graphForTurn: g,
    proposal: { handler_id: 'adjust_edge_strength', entity: { id: 'x→g', kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [{ name: 'strength', value: strength, operator: 'set', source: 'user_explicit' }], cited_context_fields: [] } } as never);
  expect(r.mutated_graph).toBeDefined(); return r.mutated_graph as R;
}

it.each(['placeholder', 'unmarked', 'estimate'] as const)('R8-3 approval writer %s: changes magnitude and clears, or confirm-only keeps carrier and hash', async kind => {
  const provenance = { source: 'cee_hypothesis', mean_projected: true, ...(kind === 'unmarked' ? {} : { magnitude: kind === 'placeholder' ? 'olumi_placeholder' : 'olumi_estimate' }) };
  const g = graph(provenance), after = await adjust(g, 0.5);
  expect(link(after).strength.mean).toBe(0.5);
  if (kind === 'estimate') {
    expect(link(after).provenance.mean_projected).toBe(true); expect(hash(after)).toBe(hash(g));
  } else {
    expect(link(after).provenance.mean_projected).toBeUndefined(); expect(link(after).provenance.magnitude).toBe('olumi_estimate'); expect(hash(after)).not.toBe(hash(g));
  }
});

it('R8-3 user set changes mean, clears projected carrier and moves hash', async () => {
  const g = graph(), after = await adjust(g, 0.75);
  expect(link(after).strength.mean).toBe(0.75); expect(link(after).provenance.mean_projected).toBeUndefined(); expect(hash(after)).not.toBe(hash(g));
});

it('R8-3 link-effect user size at the same mean changes magnitude, clears projected carrier and moves hash', () => {
  const g = graph(); g.nodes[0].observed_state = { value: 0.1, raw_value: 10, cap: 100, unit: 'GBP/month', source: 'user_override' };
  g.nodes[1].observed_state = { value: 0.1, raw_value: 10, cap: 100, unit: 'customers', source: 'user_override' };
  const p = { persistedGraph: g, from: 'x', to: 'g', effect: { amount: 0.5, amount_unit: 'GBP/month', per_source_change: 1, per_source_change_unit: 'customers' },
    expected: { graph_hash: hash(g)!, edge_token: linkEffectEdgeToken(g, 'x', 'g')! }, quote: 'Each customer adds GBP 0.5 per month.' };
  const r = applyLinkEffectEdit({ ...p, reading_token: linkEffectReadingToken(p) });
  expect(r.kind, JSON.stringify(r)).toBe('mutated'); if (r.kind !== 'mutated') return;
  const after = r.mutatedGraph as R;
  expect(link(after).strength.mean).toBe(0.5); expect(link(after).provenance.mean_projected).toBeUndefined(); expect(link(after).provenance.magnitude).toBe('user_stated'); expect(hash(after)).not.toBe(hash(g));
});

it('R8-3 approval cannot clear projected mean alone (same mean and magnitude)', () => {
  const p = { source: 'cee_hypothesis', magnitude: 'olumi_estimate', mean_projected: true };
  const g = graph(p), after = graph(sizedByApproval(p, link(g)));
  expect(link(after).provenance.mean_projected).toBe(true); expect(hash(after)).toBe(hash(g));
});

it('R8-3 frame fallback writes projected mean together with a magnitude change', () => {
  const g = graph({ source: 'cee_hypothesis', magnitude: 'olumi_placeholder' });
  const after = frameDefaultedLinks(g, 'x').graph;
  expect(link(after).provenance.mean_projected).toBe(true); expect(link(after).provenance.magnitude).toBeUndefined(); expect(hash(after)).not.toBe(hash(g));
});

it('R8-2 AST: only link-sizing reads mean_projected in production; writers and schema only declare/destructure', () => {
  const found: string[] = [];
  function scan(dir: string): void {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      if (item.name === '__tests__' || item.name === 'fixtures') continue;
      const path = join(dir, item.name); if (item.isDirectory()) { scan(path); continue; }
      if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue;
      const text = readFileSync(path, 'utf8');
      if (!text.includes('mean_projected')) continue;
      const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
      function visit(node: ts.Node): void {
        if ((ts.isPropertyAccessExpression(node) && node.name.text === 'mean_projected')
          || (ts.isElementAccessExpression(node) && ts.isStringLiteral(node.argumentExpression) && node.argumentExpression.text === 'mean_projected')) found.push(path);
        ts.forEachChild(node, visit);
      }
      visit(source);
    }
  }
  // DL 7 Oct (L1, Science 393023 ruling (b)): the absent-mediator-unit reader reads the flag ONLY to EXCLUDE a projected
  // mean from unit authority (fail-closed: an estimate never establishes a unit). The licence stays the one 'unsized' reader.
  // Science 393023 LICENCE (b) ONE predicate: link-sizing owns the placeholder reading.
  scan('src'); expect([...new Set(found)].sort()).toEqual(['src/cee/magnitude/link-sizing.ts', 'src/orchestrator/context/placeholder-parts.ts'].sort());
});

it('R8 wording budget keeps exact singular/plural grammar and truncates only endpoint labels', () => {
  const links = Array.from({ length: 3 }, (_, i) => ({ from: `x${i}`, to: 'g', from_label: 'Capacity '.repeat(100), to_label: 'Revenue '.repeat(100) }));
  expect(unsizedLinkSentence(links).length).toBeLessThanOrEqual(400);
  expect(unsizedLinkSentence(links)).toContain('and 2 more, whose strengths aren\'t sized in the model yet. Set them to see how much they matter.');
});


it.each([true, false])('R8-3 register writer cannot set/clear projection alone; prior=%s', prior => {
  const before = edge('x', 'g', { source: 'cee_hypothesis', ...(prior ? { mean_projected: true } : {}) });
  const proposed = edge('x', 'g', { source: 'cee_hypothesis', ...(!prior ? { mean_projected: true } : {}) });
  const after = keepMeanProjectionWhenSizeUnchanged(before, proposed);
  expect(after.provenance.mean_projected).toBe(prior ? true : undefined);
  expect(hash(graph(after.provenance))).toBe(hash(graph(before.provenance)));
  proposed.provenance.magnitude = 'user_stated';
  expect(keepMeanProjectionWhenSizeUnchanged(before, proposed)).toBe(proposed);
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

it('R8 plural list caps at three names, then N more; 400-char fallback uses fewer names and keeps complete count', () => {
  const links = Array.from({ length: 5 }, (_, i) => ({ from: `x${i}`, to: 'g', from_label: `Capacity ${i}`, to_label: 'Revenue' }));
  expect(unsizedLinkSentence(links)).toBe('This comparison turns on the links from ‘Capacity 0’ to ‘Revenue’, from ‘Capacity 1’ to ‘Revenue’ and from ‘Capacity 2’ to ‘Revenue’ and 2 more, whose strengths aren\'t sized in the model yet. Set them to see how much they matter.');
  const long = links.map(l => ({ ...l, from_label: l.from_label.repeat(12), to_label: l.to_label.repeat(12) }));
  const said = unsizedLinkSentence(long);
  expect(said.length).toBeLessThanOrEqual(400);
  expect(said).toContain(' and 4 more, whose strengths aren\'t sized in the model yet.');
});


it('R8 actual-move negative control: both compared options hold Capacity; option set-edges cannot withhold or disclose', () => {
  const g = graph();
  for (const n of g.nodes.filter((n: R) => n.kind === 'option')) n.interventions.x.value = 0.1;
  expect(unsizedLeaderGoalPaths(g, ids)).toEqual([]);
  link(g).provenance = { source: 'cee_hypothesis' };
  expect(legacyLeaderGoalLinks(g, ids)).toEqual([]);
});

it('RD-2 summary insertion precedes existing caution tails and survives reply grammar', () => {
  const disclosure = ' Olumi supplied the figures for the link from ‘Capacity’ to ‘Revenue’. Set your own to see how much it matters.';
  const simple = 'Expand was supported by 80% of runs of this model.';
  expect(appendLegacyFiguresAfterLeaderSentence(simple, disclosure)).toBe(simple + disclosure);
  const withFollowup = simple + ' Run the follow-up checks before treating this as final.';
  expect(appendLegacyFiguresAfterLeaderSentence(withFollowup, disclosure)).toBe(simple + disclosure + ' Run the follow-up checks before treating this as final.');
  expect(isAllowedRunAnalysisAssistantText(appendLegacyFiguresAfterLeaderSentence(withFollowup, disclosure))).toBe(true);
});


it('R7-3 (#2613 CR b, DL 0df0e1 + e8): unread whole-product gate AND projected-mean path → the product cause first, no link to size', async () => {
  const f = JSON.parse(readFileSync(new URL('./fixtures/served-gate5-mrr-m0-and-cut-costs-15f48f0b.json', import.meta.url), 'utf8')).mrr_m0;
  const g = structuredClone(f.graph);
  // §(ad) S4: horizon removed — this row's claim is not about time (a held month without a carrier withholds the chance).
  for (const goal of g.nodes.filter((n: R) => n.kind === 'goal')) {
    delete goal.goal_horizon_months;
    delete goal.goal_deadline_as_stated;
  }
  for (const n of g.nodes.filter((n: R) => n.kind === 'goal')) delete n.goal_threshold_raw;
  g.goal_constraints = (g.goal_constraints ?? []).filter((c: R) => !g.nodes.some((n: R) => n.kind === 'goal' && n.id === c.node_id));
  const projected = g.edges.find((e: R) => e.from === 'pro_plan_price' && e.to === 'mrr');
  expect(projected).toBeDefined();
  projected.provenance = { ...projected.provenance, source: 'cee_hypothesis', mean_projected: true };
  const r = await runP0Graph(g, f._provenance.brief_text, f.plot_body);
  const codes = r.enrichment.inference_warnings.map((w: R) => w.code);
  // Precondition: both gates fire on this Run, and the projected link is on a compared path.
  expect(codes).toContain('GOAL_FIGURES_PRODUCT_NOT_READ');
  expect(codes).toContain('GOAL_FIGURES_PLACEHOLDER_PATH');
  const placeholder = r.enrichment.inference_warnings.find((w: R) => w.code === 'GOAL_FIGURES_PLACEHOLDER_PATH');
  expect(placeholder.links).toContainEqual(expect.objectContaining({ from: 'pro_plan_price', to: 'mrr' }));
  expect(r.leading_option_id).toBeNull();
  // Gate 5 withholds every option, so sizing the link could not lift it: no unsized-path cause is stated for this Run.
  expect(readUnsizedPathLeaderCause(r)).toBeUndefined();
  // Buddy r4 P1: the Run's own warning keeps its code and links (the licence guard reads them) but asks and offers nothing.
  expect(placeholder.message).toContain('sized in the model yet.');
  expect(placeholder.message).not.toMatch(/to see how much|Set (?:it|them|your own)/);
  expect(placeholder).not.toHaveProperty('acceptable_links');
  expect(codes).not.toContain('GOAL_FIGURES_OLUMI_SUPPLIED_LINK');
  // Contrast on the same graph without Gate 5: the same paths DO ask and offer, so the three rows above are not vacuous.
  const optionIds = g.nodes.filter((n: R) => n.kind === 'option').map((n: R) => n.id);
  const contrast = placeholderGoalWarning(g, unsizedLeaderGoalPaths(g, optionIds), 'GOAL_FIGURES_PLACEHOLDER_PATH');
  expect(contrast.message).toMatch(/Set (?:it|them) to see how much/);
  expect(contrast.acceptable_links).toContainEqual({ from: 'pro_plan_price', to: 'mrr' });
  // Science 393023 LICENCE (a)/(b), 7 Oct: the untagged door constant is a placeholder, never legacy.
  expect(legacyLeaderGoalLinks(g, optionIds)).toEqual([]);
  for (const reason of [undefined, 'goal_path_unsized'] as const) {
    const wire = enforceAgentLaneLeaderClaimsAtWire({ assistant_text: 'An option currently leads.',
      blocks: [{ type: 'analysis_result', ...r }] } as never,
      { requestId: 'r8-both-gates', exitPath: 'agent_lane_v1', mayNameLeadingOption: false, leaderClaimWithheldReason: reason, graph: g } as never);
    expect(wire.response.assistant_text, String(reason)).toContain('Olumi has not read your goal as the product of your own figures');
    expect(wire.response.assistant_text, String(reason)).not.toMatch(/(?:isn't|aren't) sized in the model yet|Set (?:it|them) to see/);
  }
});


it('R8-3 generic edge patch and candidate field writer preserve projection unless mean/magnitude changes', () => {
  const g = graph();
  const p = { source: 'cee_hypothesis' };
  const patched = applyPatchOperations(g as never, [{ op: 'update_edge', path: 'x::g', value: { provenance: p } }] as never) as R;
  expect(link(patched).provenance.mean_projected).toBe(true);
  expect(hash(patched)).toBe(hash({ nodes: g.nodes, edges: g.edges }));
  const candidate = buildUpdateEdgeFieldCandidate(g, { from_node: 'x', to_node: 'g', field: 'provenance', to: p });
  expect(candidate.error).toBeUndefined();
  expect(link(candidate.candidate!).provenance.mean_projected).toBe(true);
  expect(hash(candidate.candidate!)).toBe(hash(g));
});
