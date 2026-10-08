import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { bindGuidedSizing, guidedSizingActions, guidedSizingForRun, guidedSizingProgress, type GuidedSizingDraft } from '../guided-sizing.js';
import { placeholderGoalWarning, unsizedLeaderGoalPaths } from '../goal-certainty.js';

type Json = Record<string, any>;
const captured = JSON.parse(readFileSync(new URL('./fixtures/guided-sizing-draw2.json', import.meta.url), 'utf8')) as Json;
const option = 'raise_pro_price_to_59';
const pairs = [
  ['monthly_churn', 'paying_pro_subscribers'],
  ['pro_plan_price', 'mrr_lost_to_price_sensitivity'],
  ['pro_plan_price', 'monthly_churn'],
] as const;
function draw3(): { graph: Json; run: Json } {
  const graph = structuredClone(captured.graph);
  for (const [from, to] of pairs) {
    const e = graph.edges.find((e: Json) => e.from === from && e.to === to);
    e.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true };
    e.defaulted = true;
  }
  const warning = placeholderGoalWarning(graph, unsizedLeaderGoalPaths(graph, [option]), 'GOAL_FIGURES_PLACEHOLDER_PATH');
  return { graph, run: { enrichment: { option_comparison: [{ option_id: option, status: 'computed' }], inference_warnings: [warning] } } };
}
function storedSize(graph: Json): void {
  const edge = graph.edges.find((e: Json) => e.from === pairs[0][0] && e.to === pairs[0][1]);
  edge.provenance = { source: 'user_specified', magnitude: 'user_stated' };
  delete edge.defaulted;
}
describe('GUIDED PATH round 7 reviewed identity and Run scope', () => {
  it('r8 legacy Run without a recorded option scope keeps stored-graph inspector progress', () => {
    const { graph } = draw3();
    storedSize(graph);
    const legacyRun = { enrichment: { analysis_status: 'computed' } };
    expect(guidedSizingProgress(graph, legacyRun)?.remaining).toBe(2);
    expect(guidedSizingProgress(graph, legacyRun)?.progress_line).toBe('2 more to go.');
  });
  it('r8 contrast: an explicitly empty recorded Run scope never falls back to stored options', () => {
    const { graph } = draw3();
    storedSize(graph);
    const run = { enrichment: { inference_warnings: [{ code: 'GOAL_FIGURES_PLACEHOLDER_PATH', option_ids: [] }] } };
    expect(guidedSizingProgress(graph, run)).toBeUndefined();
  });
  it('P1 M preserves scored option scope when excluded options have two other unsized links', () => {
    const { graph, run } = draw3();
    graph.nodes.push({ id: 'excluded', kind: 'option', label: 'Excluded option', interventions: { extra: { value: 2 } } },
      { id: 'extra', kind: 'factor', label: 'Excluded factor', observed_state: { value: 1 } },
      { id: 'extra2', kind: 'factor', label: 'Excluded factor 2', observed_state: { value: 1 } });
    graph.edges.push({ from: 'excluded', to: 'extra', strength: { mean: 1, std: 0.01 } },
      { from: 'extra', to: 'extra2', strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_placeholder' } },
      { from: 'extra2', to: 'mrr', strength: { mean: 0.5, std: 0.125 }, provenance: { magnitude: 'olumi_placeholder' } });
    expect(guidedSizingForRun(run, graph)?.total).toBe(3);
    storedSize(graph);
    expect(guidedSizingProgress(graph, run)?.remaining).toBe(2);
    expect(guidedSizingProgress(graph, run)?.progress_line).toBe('2 more to go.');
    expect(guidedSizingProgress(graph, run)?.draft.links.some(l => l.from.startsWith('extra'))).toBe(false);
  });
  it('P1 M cannot add a non-converting estimate from an excluded option to its guided list', () => {
    const { graph, run } = draw3();
    graph.nodes.push({ id: 'excluded', kind: 'option', label: 'Excluded option', interventions: { extra: { value: 2 } } },
      { id: 'extra', kind: 'factor', label: 'Excluded factor', observed_state: { value: 1, unit: '£/month' } },
      { id: 'extra2', kind: 'factor', label: 'Excluded factor 2', observed_state: { value: 1, unit: '£/month' } });
    graph.edges.push({ from: 'excluded', to: 'extra', strength: { mean: 1, std: 0.01 } },
      { from: 'extra', to: 'extra2', strength: { mean: 0.5, std: 0.125 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } },
      { from: 'extra2', to: 'mrr', strength: { mean: 0.5, std: 0.125 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' } });
    storedSize(graph);
    expect(guidedSizingForRun(run, graph)?.links.some(l => l.from.startsWith('extra'))).toBe(false);
    const progress = guidedSizingProgress(graph, run);
    expect(progress?.remaining).toBe(2);
    expect(progress?.draft.links.some(l => l.from.startsWith('extra'))).toBe(false);
    const actions = guidedSizingActions(progress?.draft, graph);
    expect(actions.some(a => a.parameters.from.startsWith('extra'))).toBe(false);
    const hook = bindGuidedSizing(progress?.draft, actions, { graph_hash: '0123456789abcdef', run_key: 'selected-run' }, progress);
    expect(hook?.remaining).toBe(2);
    expect(hook?.links.some(l => l.from.startsWith('extra'))).toBe(false);
  });
  it('P1 M preserves the selected Run identity evaluations so evaluated arithmetic operands are not counted', () => {
    const { graph, run } = draw3();
    // A product evaluated on THIS Run licenses the operand links as arithmetic.
    const mrr = graph.nodes.find((n: Json) => n.id === 'mrr');
    mrr.nonlinear_identity = { operation: 'product', stated_in_brief: false, factor_ids: ['pro_plan_price', 'paying_pro_subscribers'] };
    const edge = graph.edges.find((e: Json) => e.from === 'paying_pro_subscribers' && e.to === 'mrr');
    edge.provenance = { magnitude: 'olumi_placeholder' };
    run.enrichment.identity_evaluations = [{ node_id: 'mrr', evaluated: true }];
    storedSize(graph);
    expect(guidedSizingProgress(graph, run)?.remaining).toBe(2);
    expect(guidedSizingProgress(graph, run)?.draft.links).not.toContainEqual(expect.objectContaining({ from: 'paying_pro_subscribers', to: 'mrr' }));
  });
  it('P1 ambiguous legacy questions and FU-1 receipts cannot close three distinct same-labelled edges', () => {
    const { graph, run } = draw3();
    for (const n of graph.nodes) if (pairs.some(([f, t]) => f === n.id || t === n.id)) n.label = 'Same label';
    const draft = guidedSizingForRun(run, graph);
    const before = guidedSizingActions(draft, graph);
    expect(before).toHaveLength(3);
    expect(guidedSizingActions(draft, graph, [before[0]!.label])).toEqual(before);
    expect(guidedSizingActions(draft, graph, ['Nothing is recorded: the link from “Same label” to “Same label” stays as it is.'])).toEqual(before);
  });
  it('P1 recorded chip identity closes only its edge even if every display label matches', () => {
    const { graph, run } = draw3();
    for (const n of graph.nodes) if (pairs.some(([f, t]) => f === n.id || t === n.id)) n.label = 'Same label';
    const draft = guidedSizingForRun(run, graph);
    const before = guidedSizingActions(draft, graph);
    const digest = createHash('sha256').update(`chip:${JSON.stringify([before[0]!.id, null])}`).digest('hex').slice(0, 32);
    const history = [{ request_hash: `answer-hash#chip:${digest}`, assistant_message: before[0]!.label }];
    expect(guidedSizingActions(draft, graph, history).map(a => a.id)).toEqual(before.slice(1).map(a => a.id));
    history[0]!.assistant_message = 'Nothing is recorded: the link from “Same label” to “Same label” stays as it is.';
    expect(guidedSizingActions(draft, graph, history).map(a => a.id)).toEqual(before.slice(1).map(a => a.id));
  });
  it('r9 historical endpoints survive rename while label-only records close no newly labelled edge', () => {
    const graph = { nodes: [
      { id: 'a', label: 'Renamed A' }, { id: 'b', label: 'Renamed B' },
      { id: 'c', label: 'Former A' }, { id: 'd', label: 'Former B' },
    ], edges: [
      { from: 'a', to: 'b', provenance: { magnitude: 'olumi_placeholder' } },
      { from: 'c', to: 'd', provenance: { magnitude: 'olumi_placeholder' } },
    ] };
    const draft: GuidedSizingDraft = { v: 1, total: 2, links: [
      { from: 'a', to: 'b', from_label: 'Renamed A', to_label: 'Renamed B', order: 0 },
      { from: 'c', to: 'd', from_label: 'Former A', to_label: 'Former B', order: 1 },
    ] };
    const before = guidedSizingActions(draft, graph);
    const formerQuestion = 'How strongly does ‘Former A’ affect ‘Former B’?';
    const formerReceipt = 'Nothing is recorded: the link from “Former A” to “Former B” stays as it is.';
    expect(guidedSizingActions(draft, graph, [formerQuestion, formerReceipt])).toEqual(before);
    expect(guidedSizingActions(draft, graph, [{ assistant_message: formerQuestion }])).toEqual(before);
    const digest = createHash('sha256').update(`chip:${JSON.stringify([before[0]!.id, null])}`).digest('hex').slice(0, 32);
    expect(guidedSizingActions(draft, graph, [{ request_hash: `historical#chip:${digest}`, assistant_message: formerQuestion }])
      .map(a => a.id)).toEqual([before[1]!.id]);
  });
});
