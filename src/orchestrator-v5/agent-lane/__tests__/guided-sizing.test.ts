/** Science §(i) 4: one warning, one count, identity-bound presses, stored-graph progress. */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { goalChanceWithheldForAgent } from '../goal-chance-withheld.js';
import { guidedSizingReplyText } from '../guided-sizing.js';
import { targetTestabilityOf } from '../../admission/target-testability.js';
import { placeholderGoalPaths, placeholderGoalWarning } from '../goal-certainty.js';
import { GOAL_FIGURES_CHANCE_AS_GOAL, GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_PRODUCT_NOT_READ,
  GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../orchestrator/context/option-result-source.js';
import type { SuggestedAction } from '../../compose/types.js';

type Json = Record<string, any>;
type SizingAction = Omit<SuggestedAction, 'action_type'> & { action_type?: string; parameters?: Record<string, unknown> };
type Link = { id?: string; from: string; to: string; from_label: string; to_label: string; order: number };
type Hook = Omit<Sizing, 'links'> & { graph_hash: string; run_key: string; remaining?: number; progress_line?: string; links: (Link & { press: { id: string; parameters: Record<string, unknown> } })[] };
type Sizing = { v: 1; total: number; links: Link[] };
type History = string | { request_hash?: string | null; assistant_message?: string | null };
interface GuidedApi {
  guidedSizingForRun?: (result: unknown, graph: unknown) => Sizing | undefined;
  guidedSizingActions?: (sizing: Sizing | undefined, graph: unknown, recentReplies?: readonly History[]) => SizingAction[];
  guidedSizingProgress?: (graph: unknown) => { draft: Sizing; remaining: number; progress_line: string } | undefined;
  guidedSizingProgressLine?: (graph: unknown) => string | null;
  bindGuidedSizing?: (sizing: Sizing | undefined, actions: SizingAction[], run: { graph_hash: string; run_key: string }, progress?: unknown) => Hook | undefined;
  parseGuidedSizingPress?: (id: unknown) => { from: string; to: string; edge_id?: string } | null;
}
// The base SHA has no module yet: rows fail on their assertions, never on a missing-module import.
const modulePath = '../guided-sizing.js';
const api = await import(modulePath).catch(() => ({})) as GuidedApi;
const sizing = (run: unknown, graph: unknown): Sizing | undefined => api.guidedSizingForRun?.(run, graph);
const actions = (value: Sizing | undefined, graph: unknown, recentReplies: readonly History[] = []): SizingAction[] =>
  api.guidedSizingActions?.(value, graph, recentReplies) ?? [];
const recordedPress = (action: SizingAction, assistant_message = action.label): History => ({ assistant_message,
  request_hash: `completed#chip:${createHash('sha256').update(`chip:${JSON.stringify([action.id, null])}`).digest('hex').slice(0, 32)}` });
const progress = (graph: unknown): string | null | undefined => api.guidedSizingProgressLine?.(graph);

const captured = JSON.parse(readFileSync(new URL('./fixtures/guided-sizing-draw2.json', import.meta.url), 'utf8')) as Json;
const CODE = GOAL_FIGURES_PLACEHOLDER_PATH;
const OPTION = 'raise_pro_price_to_59';
const EVALUATED = [{ node_id: 'mrr', evaluated: true }];
const LEVEL_ASK = "What's today's level of MRR?";
const LEVEL_WITHHOLD = `This run doesn’t show how often each option reaches the goal’s target. ${LEVEL_ASK}`;
const WORDS_2 = "Not shown yet: 2 links on the way to your goal have no size, so any figure would come from Olumi's stand-ins, not your model. Size them to see the chance.";
const WORDS_3 = "Not shown yet: 3 links on the way to your goal have no size, so any figure would come from Olumi's stand-ins, not your model. Size them to see the chance.";
const THREE = [
  { from: 'monthly_churn', to: 'paying_pro_subscribers' },
  { from: 'pro_plan_price', to: 'mrr_lost_to_price_sensitivity' },
  { from: 'pro_plan_price', to: 'monthly_churn' },
] as const;
// Equal-hop ties follow the producer's acceptable list, which differs from its historical links list.
const LINK_ORDER = [THREE[1], THREE[0], THREE[2]] as const;

/** Explicit three-placeholder variant: the original capture already sizes price → churn as Olumi's estimate. */
function draw2(): { graph: Json; run: Json } {
  const graph = structuredClone(captured.graph);
  const third = graph.edges.find((e: Json) => e.from === 'pro_plan_price' && e.to === 'monthly_churn');
  third.provenance = { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true };
  third.defaulted = true;
  const warning = placeholderGoalWarning(graph, placeholderGoalPaths(graph, [OPTION], EVALUATED), CODE);
  const target = structuredClone(captured.run.enrichment.inference_warnings.find((w: Json) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE));
  return { graph, run: { enrichment: { inference_warnings: [warning, target] } } };
}
function warningOf(run: Json): Json {
  return run.enrichment.inference_warnings.find((w: Json) => w.code === CODE);
}
function onlyPlaceholder(run: Json): Json {
  return { enrichment: { inference_warnings: [structuredClone(warningOf(run))] } };
}
function expectedLinks(graph: Json): Link[] {
  const label = (id: string): string => graph.nodes.find((n: Json) => n.id === id).label;
  return LINK_ORDER.map((l, order) => {
    const edge = graph.edges.find((e: Json) => e.from === l.from && e.to === l.to);
    return { ...(typeof edge?.id === 'string' ? { id: edge.id } : {}), ...l, from_label: label(l.from), to_label: label(l.to), order };
  });
}
// A committed user size: the progress reader receives the stored graph, never yesterday's warning.
function storedSize(graph: Json, from: string, to: string): void {
  const edge = graph.edges.find((e: Json) => e.from === from && e.to === to);
  edge.provenance = { ...edge.provenance, source: 'user_specified', magnitude: 'user_stated',
    natural_effect: { amount: 1, amount_unit: 'subscribers', per_source_change: 1, per_source_change_unit: 'percentage points', strength_mean: edge.strength.mean } };
  delete edge.provenance.mean_projected;
  delete edge.defaulted;
}

describe('GUIDED PATH: multi-link withhold', () => {
  it('capture remains unchanged evidence: the served warning has 2 links; the target names 3', () => {
    const warning = warningOf(captured.run);
    expect(warning.links).toEqual(THREE.slice(0, 2));
    const estimate = captured.graph.edges.find((e: Json) => e.from === THREE[2].from && e.to === THREE[2].to);
    expect(estimate.provenance.magnitude).toBe('olumi_estimate');
    expect(estimate.provenance.natural_effect).toEqual(expect.objectContaining({ amount: 0.03, amount_unit: 'percentage points' }));
    expect(captured.run.enrichment.inference_warnings.find((w: Json) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE).say)
      .toContain('from Pro plan price to Monthly churn');
  });

  it('DRAW-2 three-placeholder variant: another level cause keeps its ask without a sizing promise', () => {
    const { graph, run } = draw2();
    expect(warningOf(run).links).toEqual(THREE);
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(LEVEL_WITHHOLD);
    expect(goalChanceWithheldForAgent(run, graph)?.say).not.toContain('a size for the links');
    expect(goalChanceWithheldForAgent(run, graph)?.say).not.toContain('Size them to see the chance.');
  });

  it("captured DRAW-2: another level cause keeps its ask while the two sizing presses remain", () => {
    const value = sizing(captured.run, captured.graph);
    expect(warningOf(captured.run).acceptable_links).toEqual(THREE.slice(0, 2));
    expect(value?.total).toBe(2);
    expect(value?.links.map(l => ({ from: l.from, to: l.to }))).toEqual(THREE.slice(0, 2));
    expect(goalChanceWithheldForAgent(captured.run, captured.graph)?.say).toBe(LEVEL_WITHHOLD);
    expect(goalChanceWithheldForAgent(captured.run, captured.graph)?.say).not.toContain('a size for the links');
    expect(goalChanceWithheldForAgent(captured.run, captured.graph)?.say).not.toContain('Size them to see the chance.');
    expect(actions(value, captured.graph)).toHaveLength(2);
  });

  it('a derived level removes TARGET_NOT_TESTABLE: only guided words and presses remain', () => {
    const { graph, run } = draw2();
    const derivedLevelRun = onlyPlaceholder(run);
    expect(derivedLevelRun.enrichment.inference_warnings.map((w: Json) => w.code)).toEqual([CODE]);
    expect(goalChanceWithheldForAgent(derivedLevelRun, graph)?.say).toBe(WORDS_3);
    expect(goalChanceWithheldForAgent(derivedLevelRun, graph)?.say).not.toContain("What's today's level");
    expect(actions(sizing(derivedLevelRun, graph), graph)).toHaveLength(3);
  });

  it('DRAW-2 all-placeholder branch uses the same exact goal-chance sentence', () => {
    const { graph, run } = draw2();
    expect(goalChanceWithheldForAgent(onlyPlaceholder(run), graph)?.say).toBe(WORDS_3);
  });

  it('DRAW-2: typed hook total 3, one link per edge identity in directness order', () => {
    const { graph, run } = draw2();
    const value = sizing(run, graph);
    expect(value).toEqual({ v: 1, total: 3, scored_goal_id: 'mrr', target_verdict: targetTestabilityOf(graph), links: expectedLinks(graph) });
  });

  it('DRAW-2: 3 exact press labels in the same directness order', () => {
    const { graph, run } = draw2();
    const presses = actions(sizing(run, graph), graph);
    expect(presses.map(p => p.label)).toEqual([
      'How strongly does ‘Pro plan price’ affect ‘MRR lost to price sensitivity’?',
      'How strongly does ‘Monthly churn’ affect ‘Paying Pro subscribers’?',
      'How strongly does ‘Pro plan price’ affect ‘Monthly churn’?',
    ]);
    expect(new Set(presses.map(p => p.id)).size).toBe(3);
    expect(presses.map(p => p.id)).toEqual(LINK_ORDER.map(l =>
      `agent-size-link:${encodeURIComponent(l.from)}:${encodeURIComponent(l.to)}`));
    expect(presses.map(p => api.parseGuidedSizingPress?.(p.id))).toEqual(LINK_ORDER);
    expect(presses.every(p => p.action_type === undefined)).toBe(true);
    expect(presses.map(p => p.parameters)).toEqual(LINK_ORDER.map(l => ({ ...l })));
    expect(warningOf(run).acceptable_links).toEqual([THREE[2], THREE[1], THREE[0]]);
  });

  it('edge ids bind hook links and inspector press parameters, even when labels collide', () => {
    const { graph, run } = draw2();
    for (const [i, l] of THREE.entries()) {
      graph.edges.find((e: Json) => e.from === l.from && e.to === l.to).id = `edge-${i}`;
      graph.nodes.find((n: Json) => n.id === l.from).label = 'Same label';
      graph.nodes.find((n: Json) => n.id === l.to).label = 'Same label';
    }
    const value = sizing(run, graph);
    const presses = actions(value, graph);
    const record = { graph_hash: 'stored-graph-hash', run_key: 'stored-run-key' };
    const hook = api.bindGuidedSizing?.(value, presses, record);
    expect(value?.links.map(l => l.id)).toEqual(['edge-1', 'edge-0', 'edge-2']);
    expect(presses.map(p => p.parameters)).toEqual(LINK_ORDER.map(l => ({ ...l, edge_id: `edge-${THREE.indexOf(l)}` })));
    expect(hook).toEqual({ v: value?.v, total: value?.total, ...record, links: value?.links.map((l, i) => ({ ...l,
      press: { id: presses[i]!.id, parameters: presses[i]!.parameters } })) });
    expect(hook?.links.map(l => l.press)).toEqual(presses.map(p => ({ id: p.id, parameters: p.parameters })));
  });

  it('hook binds by edge id despite a conflicting from/to action, never by matching labels', () => {
    const { graph, run } = draw2();
    for (const [i, l] of THREE.entries()) graph.edges.find((e: Json) => e.from === l.from && e.to === l.to).id = `edge-${i}`;
    const value = sizing(run, graph);
    const presses = actions(value, graph);
    // A same-endpoints mutant appears first but points at the WRONG edge id. The identity-valid action still binds.
    const wrong = { ...presses[0]!, id: 'wrong-edge-id', parameters: { from: LINK_ORDER[0].from, to: LINK_ORDER[0].to, edge_id: 'other-edge' } };
    const hook = api.bindGuidedSizing?.(value, [wrong, ...presses], { graph_hash: 'hash', run_key: 'key' });
    expect(hook?.links[0]?.press).toEqual({ id: presses[0]!.id, parameters: presses[0]!.parameters });
  });

  it('hook without graph edge ids binds by endpoints when reply actions are reversed', () => {
    const { graph, run } = draw2();
    const value = sizing(run, graph);
    const presses = actions(value, graph);
    const hook = api.bindGuidedSizing?.(value, [...presses].reverse(), { graph_hash: 'hash', run_key: 'key' });
    expect(hook?.links.map(l => l.press)).toEqual(presses.map(p => ({ id: p.id, parameters: p.parameters })));
  });

  it('warning order breaks equal-hop ties, independently of graph edge order', () => {
    const { graph, run } = draw2();
    warningOf(run).acceptable_links = [...THREE];
    expect(sizing(run, graph)?.links.map(l => [l.from, l.to])).toEqual([
      [THREE[0].from, THREE[0].to], [THREE[1].from, THREE[1].to], [THREE[2].from, THREE[2].to],
    ]);
  });

  it('N is the warning count, not graph count: 4-link row kills hard-coded 3', () => {
    const { graph, run } = draw2();
    graph.nodes.push({ id: 'expansion', kind: 'factor', label: 'Expansion', observed_state: { raw_value: 1, value: 0.1, unit: 'subscribers' } });
    graph.edges.push({ from: 'expansion', to: 'mrr', strength: { mean: 0.5, std: 0.125 },
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder', mean_projected: true } });
    warningOf(run).acceptable_links.push({ from: 'expansion', to: 'mrr' });
    // The recorded N remains four, but the fourth pair is outside this option's actual cause set.
    expect(goalChanceWithheldForAgent(onlyPlaceholder(run), graph)?.say).not.toContain('Size them to see the chance.');
    expect(sizing(run, graph)?.total).toBe(4);
    expect(sizing(run, graph)?.links[0]).toEqual(expect.objectContaining({ from: 'expansion', to: 'mrr', order: 0 }));
  });

  it('extra placeholder graph edges cannot inflate N beyond the one typed warning', () => {
    const { graph, run } = draw2();
    graph.nodes.push({ id: 'unrun', kind: 'factor', label: 'An unrun change' });
    graph.edges.push({ from: 'unrun', to: 'mrr', provenance: { magnitude: 'olumi_placeholder' }, strength: { mean: 0.5, std: 0.125 } });
    expect(sizing(run, graph)?.total).toBe(3);
    expect(goalChanceWithheldForAgent(onlyPlaceholder(run), graph)?.say).toBe(WORDS_3);
  });

  it('duplicate labels remain distinct edge identities: presses must never key by label', () => {
    const { graph, run } = draw2();
    for (const n of graph.nodes) if (THREE.some(l => l.from === n.id || l.to === n.id)) n.label = 'Same label';
    const value = sizing(run, graph);
    expect(value?.links.map(l => [l.from, l.to])).toEqual(LINK_ORDER.map(l => [l.from, l.to]));
    const presses = actions(value, graph);
    expect(presses).toHaveLength(3);
    expect(new Set(presses.map(p => p.id)).size).toBe(3);
    expect(presses.map(p => api.parseGuidedSizingPress?.(p.id))).toEqual(LINK_ORDER);
    expect(presses.map(p => p.label)).toEqual(Array(3).fill('How strongly does ‘Same label’ affect ‘Same label’?'));
  });

  it('sized links and never-reask closed presses are absent even beside an old warning', () => {
    const { graph, run } = draw2();
    const before = actions(sizing(run, graph), graph);
    expect(before).toHaveLength(3);
    storedSize(graph, THREE[0].from, THREE[0].to);
    const after = actions(sizing(run, graph), graph, [recordedPress(before[0]!)]);
    expect(after.map(p => p.id)).toEqual([before[2]!.id]);
  });

  it('legacy label-only question cannot establish historical endpoints even for currently unique labels', () => {
    const { graph, run } = draw2();
    const before = actions(sizing(run, graph), graph);
    expect(before).toHaveLength(3);
    const after = actions(sizing(run, graph), graph,
      ['How much does ‘Pro plan price’ change ‘MRR lost to price sensitivity’?']);
    expect(after).toEqual(before);
  });

  it('FU-1 receipt suppresses only its recorded chip endpoints without pretending the edge was sized', () => {
    const { graph, run } = draw2();
    const before = actions(sizing(run, graph), graph);
    expect(before).toHaveLength(3);
    const receipt = 'Nothing is recorded: the link from “Pro plan price” to “MRR lost to price sensitivity” stays as it is.';
    expect(warningOf(run).links).toHaveLength(3);
    expect(actions(sizing(run, graph), graph, [receipt])).toEqual(before);
    expect(actions(sizing(run, graph), graph, [recordedPress(before[0]!, receipt)]).map(p => p.id)).toEqual([before[1]!.id, before[2]!.id]);
    expect(actions(sizing(run, graph), graph,
      ['Nothing is recorded: the link from “Another price” to “MRR lost to price sensitivity” stays as it is.']))
      .toEqual(before);
  });

  it('press parser round-trips colons, slashes, percent signs and Unicode as endpoint identity', () => {
    const endpoints = { from: 'price: £/month%α', to: 'churn:ø/€%20' };
    const id = `agent-size-link:${encodeURIComponent(endpoints.from)}:${encodeURIComponent(endpoints.to)}`;
    expect(api.parseGuidedSizingPress?.(id)).toEqual(endpoints);
    expect(api.parseGuidedSizingPress?.({ id })).toEqual(endpoints);
    expect(api.parseGuidedSizingPress?.({ id, parameters: { ...endpoints, edge_id: 'edge-identity' } }))
      .toEqual({ ...endpoints, edge_id: 'edge-identity' });
    expect(api.parseGuidedSizingPress?.({ id, parameters: { from: 'wrong-node', to: endpoints.to, edge_id: 'edge-identity' } })).toBeNull();
    expect(api.parseGuidedSizingPress?.('agent-size-link:bad%:target')).toBeNull();
    expect(api.parseGuidedSizingPress?.('agent-size-link:source:target:extra')).toBeNull();
  });

  it('ONE LIST: N and presses use acceptable_links, never the distinct links list', () => {
    const { graph, run } = draw2();
    warningOf(run).option_ids = ['raise_pro_price_to_59'];
    warningOf(run).links = [THREE[0]];
    warningOf(run).acceptable_links = [...THREE];
    warningOf(run).first_ask = { kind: 'link', ...THREE[0] };
    expect(sizing(run, graph)?.total).toBe(3);
    expect(sizing(run, graph)?.links).toHaveLength(3);
    expect(actions(sizing(run, graph), graph)).toHaveLength(3);
    expect(goalChanceWithheldForAgent(onlyPlaceholder(run), graph)?.say).toBe(WORDS_3);
  });

  it('acceptable membership is authoritative: an unaskable second graph/link list cannot create a guided path', () => {
    const { graph, run } = draw2();
    warningOf(run).acceptable_links = [THREE[0]];
    expect(warningOf(run).links).toHaveLength(3);
    expect(sizing(run, graph)).toBeUndefined();
    expect(actions(sizing(run, graph), graph)).toEqual([]);
  });

  it('CONTROL all sized / no PLACEHOLDER_PATH: no words, presses or hook', () => {
    const { graph } = draw2();
    for (const link of THREE) storedSize(graph, link.from, link.to);
    const run = { enrichment: { inference_warnings: [] } };
    expect(goalChanceWithheldForAgent(run, graph)).toBeUndefined();
    expect(sizing(run, graph)).toBeUndefined();
    expect(actions(sizing(run, graph), graph)).toEqual([]);
  });

  it('CONTROL PRODUCT_NOT_READ dominates PLACEHOLDER_PATH: existing words, no hook or presses', () => {
    const { graph, run } = draw2();
    const existing = 'Olumi has not read ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’ (£49 × 1,500 = £73,500, close to your £75,000), so this run can’t say how likely any option is to reach the goal, what it would reach, or which option does best.';
    run.enrichment.inference_warnings.push({ code: GOAL_FIGURES_PRODUCT_NOT_READ, severity: 'warning',
      message: `Not shown. ${existing}`, node_ids: ['mrr', 'pro_plan_price', 'paying_pro_subscribers'],
      option_ids: ['raise_pro_price_to_59', 'keep_current_pro_price'] });
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(existing);
    expect(sizing(run, graph)).toBeUndefined();
    expect(actions(sizing(run, graph), graph)).toEqual([]);
  });

  it('CONTROL CHANCE_AS_GOAL dominates PLACEHOLDER_PATH: existing words, no hook or presses', () => {
    const { graph, run } = draw2();
    const existing = 'Olumi works out the chance of meeting your deadline; it needs the date and what must be done by then.';
    run.enrichment.inference_warnings.push({ code: GOAL_FIGURES_CHANCE_AS_GOAL, severity: 'warning',
      message: existing, node_ids: ['mrr'], option_ids: ['raise_pro_price_to_59', 'keep_current_pro_price'] });
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe(existing);
    expect(sizing(run, graph)).toBeUndefined();
    expect(actions(sizing(run, graph), graph)).toEqual([]);
  });

  it('CONTROL prose cannot replace the typed warning code', () => {
    const { graph, run } = draw2();
    const control = onlyPlaceholder(run);
    warningOf(control).code = 'SOME_OTHER_WARNING';
    expect(goalChanceWithheldForAgent(control, graph)).toBeUndefined();
    expect(sizing(control, graph)).toBeUndefined();
  });

  it('CONTROL exactly 1 unsized link: the base sentence is byte-identical; no multi-link hook or presses', () => {
    const { graph, run } = draw2();
    storedSize(graph, THREE[0].from, THREE[0].to);
    storedSize(graph, THREE[1].from, THREE[1].to);
    const control = onlyPlaceholder(run);
    const warning = warningOf(control);
    warning.links = [THREE[2]];
    warning.acceptable_links = [THREE[2]];
    warning.message = 'Not shown. This comparison turns on the link from ‘Pro plan price’ to ‘Monthly churn’, whose strength isn’t sized in the model yet. Set it to see how much it matters.';
    const today = 'This comparison turns on the link from ‘Pro plan price’ to ‘Monthly churn’, whose strength isn’t sized in the model yet. Set it to see how much it matters.';
    expect(goalChanceWithheldForAgent(control, graph)?.say).toBe(today);
    expect(sizing(control, graph)).toBeUndefined();
    expect(actions(sizing(control, graph), graph)).toEqual([]);
  });

  it('CONTROL exactly 1, mixed branch: the served target sentence is byte-identical', () => {
    const { graph, run } = draw2();
    storedSize(graph, THREE[0].from, THREE[0].to);
    storedSize(graph, THREE[1].from, THREE[1].to);
    warningOf(run).links = [THREE[2]];
    warningOf(run).acceptable_links = [THREE[2]];
    expect(goalChanceWithheldForAgent(run, graph)?.say).toBe('This run doesn’t show how often each option reaches the goal’s target. '
      + "I can't yet say how likely any option is to keep MRR at or above £20,000 / month: I need today's level, and a size for the links from Monthly churn to Paying Pro subscribers, from Pro plan price to MRR lost to price sensitivity and from Pro plan price to Monthly churn. What's today's level of MRR?");
    expect(sizing(run, graph)).toBeUndefined();
  });

  it('exact placeholder word class: stand-ins cannot be mutated to estimates', () => {
    const { graph, run } = draw2();
    expect(goalChanceWithheldForAgent(onlyPlaceholder(run), graph)?.say).toBe(WORDS_3);
    expect(goalChanceWithheldForAgent(onlyPlaceholder(run), graph)?.say).not.toContain('estimates');
  });
});

describe('GUIDED PATH: progress from the stored graph after sizing', () => {
  it('r12: one reply-text export preserves the exact guided and progress words, including recovery', () => {
    const { graph, run } = draw2();
    const draft = api.guidedSizingForRun?.(run, graph);
    expect(draft).toBeDefined();
    expect(guidedSizingReplyText(draft)).toEqual({ guided: WORDS_3, progress: null });
    storedSize(graph, THREE[0].from, THREE[0].to);
    const fresh = api.guidedSizingProgress?.(graph);
    expect(fresh).toBeDefined();
    expect(guidedSizingReplyText({ ...fresh!.draft, recovery_line: 'Existing recovery.' }, fresh))
      .toEqual({ guided: `${WORDS_2} Existing recovery.`, progress: '2 more to go.' });
    expect(guidedSizingReplyText(undefined, fresh)).toEqual({ guided: null, progress: fresh!.progress_line });
    expect(guidedSizingReplyText(undefined)).toEqual({ guided: null, progress: null });
    expect(guidedSizingReplyText({ v: 1, total: 1, links: [] })).toEqual({ guided: null, progress: null });
  });

  it('AFTER ONE SIZING: 2 more to go', () => {
    const { graph } = draw2();
    storedSize(graph, THREE[0].from, THREE[0].to);
    expect(progress(graph)).toBe('2 more to go.');
  });
  it('fresh progress draft and hook share M and the same exact progress words after a size', () => {
    const { graph } = draw2();
    storedSize(graph, THREE[0].from, THREE[0].to);
    const fresh = api.guidedSizingProgress?.(graph);
    expect(fresh?.remaining).toBe(2);
    expect(fresh?.progress_line).toBe('2 more to go.');
    expect(fresh?.draft.total).toBe(2);
    expect(fresh?.draft.links.map(l => ({ from: l.from, to: l.to }))).toEqual(THREE.slice(1));
    const presses = actions(fresh?.draft, graph);
    const hook = api.bindGuidedSizing?.(fresh?.draft, presses, { graph_hash: 'fresh-stored-graph-hash', run_key: 'run-key' }, fresh);
    expect(hook).not.toHaveProperty('draft');
    expect(hook?.remaining).toBe(fresh?.remaining);
    expect(hook?.progress_line).toBe(progress(graph));
    expect(hook?.links.map(l => l.press)).toEqual(presses.map(p => ({ id: p.id, parameters: p.parameters })));
  });
  it('AFTER TWO: M=1 never offers a progress line', () => {
    const { graph } = draw2();
    storedSize(graph, THREE[0].from, THREE[0].to);
    storedSize(graph, THREE[1].from, THREE[1].to);
    expect(progress(graph)).toBeNull();
    expect(api.guidedSizingProgress?.(graph)).toBeUndefined();
  });
  it('AFTER THREE: M=0 has no progress line', () => {
    const { graph } = draw2();
    for (const link of THREE) storedSize(graph, link.from, link.to);
    expect(progress(graph)).toBeNull();
    expect(api.guidedSizingProgress?.(graph)).toBeUndefined();
  });
});
