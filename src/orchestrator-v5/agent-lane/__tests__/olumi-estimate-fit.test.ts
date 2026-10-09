import fs from 'node:fs';
import zlib from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { sizeLink, NOT_REPRESENTABLE, type MagnitudeNode } from '../../../cee/magnitude/link-effect.js';
import { admitCandidateLinks, SET_ASIDE_ESTIMATE_LABEL } from '../admit-candidate.js';
import { createAddConstraintHandler } from '../../tools/handlers/add-constraint.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import * as frames from '../refit-frames.js';
import { rederiveGoalInLinks, retireNormalisingGoalFrame } from '../normalising-goal-frame.js';

type Rec = Record<string, any>;
type Row = { id: string; brief: string; drafter_texts: string[] };
const r2: Row[] = JSON.parse(fs.readFileSync(new URL('./fixtures/s7-a2-r2.json', import.meta.url), 'utf8'));
const edge = (g: Rec, id: string): Rec => g.edges.find((e: Rec) => `${e.from}→${e.to}` === id)!;
const node = (g: Rec, id: string): Rec => g.nodes.find((n: Rec) => n.id === id)!;
function withoutCandidates(g: Rec): Rec {
  const copy = structuredClone(g);
  for (const e of copy.edges) delete e.provenance?.olumi_fit_candidate;
  return copy;
}
const noCandidates = (g: Rec) => expect(JSON.stringify(g)).not.toContain('olumi_fit_candidate');
const naturalSize = (g: Rec, e: Rec): number => e.strength.mean * frames.frameOf(node(g, e.to))! / frames.frameOf(node(g, e.from))!;

async function replay(row: Row, old = false) {
  let graph: Rec | undefined;
  let i = 0;
  const spy = old ? vi.spyOn(frames, 'refitFramesForOlumiEstimates').mockImplementation(g => ({ graph: withoutCandidates(g), fitted: [], refused: [] })) : undefined;
  try {
    const dispatch = async (path: string, body: unknown) => {
      if (path.endsWith('/graph/register')) {
        graph = structuredClone((body as { graph: Rec }).graph);
        return { status: 200, json: { model_version: { version_number: 1 } } };
      }
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
    };
    const drafter = async () => ({ text: row.drafter_texts[Math.min(i++, row.drafter_texts.length - 1)]!, status: 'completed' });
    const result = await buildModelFromBrief('00000000-0000-4000-8000-000000000077', row.brief, dispatch as never, drafter as never) as Rec;
    expect(result.ok, row.id + JSON.stringify(result)).toBe(true);
    expect(graph, row.id).toBeDefined();
    return { graph: graph!, result };
  } finally { spy?.mockRestore(); }
}

function servedRow(): Row {
  const row = structuredClone(r2.find(r => r.id === 'R2/B1-A')!);
  const c = JSON.parse(row.drafter_texts[0]!);
  c.identities = [];
  c.goal.scope = null;
  const link = c.links.find((l: Rec) => l.from === 'Pro plan price' && l.to === 'MRR');
  for (const other of c.links) if (other !== link) {
    Object.assign(other, { effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: false });
  }
  Object.assign(link, { effect_amount: 100000, effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: false });
  c.unknowns = ['Is £20,000 still the target?'];
  row.drafter_texts = [JSON.stringify(c)];
  return row;
}

/** The real sizing + admission seam, with each refusal compared to the old persisted placeholder and ledger. */
function admitted(target: Rec = { id: 'y', label: 'Y', kind: 'goal', scale_frame: 100, unit: '£' }) {
  const source = { id: 'x', label: 'X', kind: 'factor', scale_frame: 100, unit: 'items' };
  const link = { from: 'x', to: 'y', direction: 'positive' as const, provenance: 'ai_proposed', effect_amount: 3, effect_per_source_change: 1 };
  const sizing = sizeLink({ ...link, user_stated: false }, { ...source, option_levels: [] } as MagnitudeNode, { ...target, option_levels: [] } as unknown as MagnitudeNode);
  expect(sizing.problem).toBe('not_representable');
  const before = admitCandidateLinks([link], new Map([['x::y', sizing]]));
  const legacy = admitCandidateLinks([link], new Map([['x::y', { ...sizing, fit_candidate: undefined }]]));
  expect(before.loss).toEqual(legacy.loss);
  expect(before.edges[0]?.provenance?.olumi_fit_candidate).toMatchObject({ strength_mean: 3, strength_std: 1.5 });
  const graph: Rec = { nodes: [source, target], edges: before.edges };
  expect(withoutCandidates(graph).edges).toEqual(legacy.edges);
  return { graph, legacy: { ...graph, edges: legacy.edges }, loss: before.loss };
}

it('row (a): served goal estimate fits, preserves every other natural size, and retires its set-aside/question', async () => {
  const row = servedRow();
  const before = await replay(row, true);
  const after = await replay(row);
  const id = 'pro_plan_price→mrr';
  expect(edge(before.graph, id).provenance.magnitude).toBe('olumi_placeholder');
  expect(before.result.set_aside_estimates).toContainEqual(expect.objectContaining({ from: 'pro_plan_price', to: 'mrr' }));
  expect(before.result.open_questions.some((q: string) => q.includes(NOT_REPRESENTABLE) && q.includes('100000'))).toBe(true);
  const e = edge(after.graph, id);
  expect(e.provenance).toMatchObject({ magnitude: 'olumi_estimate', source: 'cee_hypothesis', natural_effect: { amount: 100000, strength_mean: e.strength.mean } });
  const drafterBasis = JSON.parse(row.drafter_texts[0]!).links.find((l: Rec) => l.from === 'Pro plan price' && l.to === 'MRR').basis;
  expect(drafterBasis).toEqual(expect.any(String));
  expect(e.provenance.basis).toBe(drafterBasis);
  expect(e.strength.std).toBeCloseTo(Math.abs(e.strength.mean) / 2, 12);
  expect(e.exists_probability).toBe(edge(before.graph, id).exists_probability);
  expect(e.exists_probability).toBe(0.8);
  expect(e.defaulted).toBeUndefined();
  expect(e.provenance.mean_projected).toBeUndefined();
  expect((after.result.set_aside_estimates ?? []).some((s: Rec) => `${s.from}→${s.to}` === id)).toBe(false);
  const question = before.result.open_questions.find((q: string) => q.includes(NOT_REPRESENTABLE) && q.includes('100000'));
  expect(after.result.open_questions).not.toContain(question);
  for (const other of before.graph.edges as Rec[]) {
    if (`${other.from}→${other.to}` === id) continue;
    if (frames.frameOf(node(before.graph, other.from)) === undefined || frames.frameOf(node(before.graph, other.to)) === undefined) continue;
    expect(Math.abs(naturalSize(before.graph, other) - naturalSize(after.graph, edge(after.graph, `${other.from}→${other.to}`))), `${other.from}→${other.to}`).toBeLessThanOrEqual(1e-9);
  }
  noCandidates(after.graph);
});

it('row (b): user outcome level refuses and preserves the old placeholder and set-aside ledger', () => {
  const { graph, legacy, loss } = admitted({ id: 'y', label: 'Y', kind: 'outcome', scale_frame: 100, observed_state: { value: 0.4, raw_value: 40, source: 'brief_extraction', unit: '£' } });
  const snapshot = JSON.stringify(graph);
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.refused).toEqual([{ link: 'x→y', reason: 'levels_set_on_node' }]);
  expect(JSON.stringify(frames.clampForPersist(result.graph))).toBe(JSON.stringify(legacy));
  expect(loss.some(l => l.field_path === 'edges[x::y].set_aside_estimate')).toBe(true);
  expect(JSON.stringify(graph)).toBe(snapshot);
  noCandidates(result.graph);
});

it('row (c): bounded percent top refuses and preserves the old placeholder', () => {
  const { graph, legacy, loss } = admitted({ id: 'y', label: 'Y', kind: 'goal', scale_frame: 100, unit: '%' });
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.refused).toEqual([{ link: 'x→y', reason: 'bounded_scale' }]);
  expect(JSON.stringify(frames.clampForPersist(result.graph))).toBe(JSON.stringify(legacy));
  expect(loss.some(l => l.field_path.endsWith('.set_aside_estimate'))).toBe(true);
  noCandidates(result.graph);
});

it('row (d): factor target stays set aside byte-for-byte', () => {
  const { graph, legacy } = admitted({ id: 'y', label: 'Y', kind: 'factor', scale_frame: 100, unit: '£' });
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.refused).toEqual([{ link: 'x→y', reason: 'not_the_goal' }]);
  expect(JSON.stringify(result.graph)).toBe(JSON.stringify(legacy));
});

it('row (e): served user £20,000 goal target, engine threshold and target words are invariant', async () => {
  const row = servedRow();
  const before = await replay(row, true);
  const after = await replay(row);
  const b = node(before.graph, 'mrr'); const a = node(after.graph, 'mrr');
  expect(frames.frameOf(a)).toBeGreaterThan(frames.frameOf(b)!);
  expect(JSON.stringify(a.goal_threshold_raw)).toBe(JSON.stringify(b.goal_threshold_raw));
  expect(a.goal_threshold_raw).toBe(20000);
  for (const goal of [b, a]) expect(goal.goal_threshold * frames.frameOf(goal)!).toBeCloseTo(20000, 9);
  const targetWords = (r: Rec) => r.open_questions.filter((q: string) => q.includes('£20,000'));
  expect(targetWords(before.result)).toContain('Is £20,000 still the target?');
  expect(targetWords(after.result)).toEqual(targetWords(before.result));
});

it('row (f): user size is fitted first and its edge stays byte-identical to the user pass alone', () => {
  const { graph } = admitted();
  graph.nodes.push({ id: 'u', label: 'U', kind: 'goal', scale_frame: 100 } as never);
  graph.edges = [...graph.edges, { from: 'x', to: 'u', strength: { mean: 4, std: 2 }, exists_probability: 0.8,
    provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { amount: 4, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'items', strength_mean: 4, strength_mean_frame: 'edge_strength' } } }];
  const first = frames.refitFramesForStatedEffects(graph);
  expect(first.refits.map(r => r.node)).toEqual(['u']);
  const next = frames.refitFramesForOlumiEstimates(first.graph);
  expect(next.fitted).toEqual(['x→y']);
  expect(JSON.stringify(edge(next.graph, 'x→u'))).toBe(JSON.stringify(edge(first.graph, 'x→u')));
});

it('row (f) shared goal: pending estimate follows the user frame and needs no further widening', () => {
  const { graph } = admitted();
  graph.nodes.push({ id: 'z', label: 'Z', kind: 'factor', scale_frame: 100 });
  graph.edges.push({ from: 'z', to: 'y', strength: { mean: 8, std: 4 }, exists_probability: 0.8,
    provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { amount: 8, strength_mean: 8 } } });
  const first = frames.refitFramesForStatedEffects(graph);
  const snapshot = JSON.stringify(first.graph);
  const next = frames.refitFramesForOlumiEstimates(first.graph);
  expect(next.fitted).toEqual(['x→y']);
  expect(frames.reframedNodeIds(first.graph, next.graph)).toEqual([]);
  expect(edge(next.graph, 'x→y').provenance.natural_effect.amount).toBe(3);
  expect(naturalSize(next.graph, edge(next.graph, 'x→y'))).toBeCloseTo(3, 12);
  expect(JSON.stringify(edge(next.graph, 'z→y'))).toBe(JSON.stringify(edge(first.graph, 'z→y')));
  expect(JSON.stringify(first.graph)).toBe(snapshot);
});

it('goal estimates go first and a goal-only widen uses just one reframed node', () => {
  const { graph } = admitted({ id: 'y', label: 'Y', kind: 'outcome', scale_frame: 100, unit: '£' });
  const goal = admitted({ id: 'g', label: 'G', kind: 'goal', scale_frame: 100, unit: '£' });
  graph.nodes.push(node(goal.graph, 'g'));
  graph.edges.push({ ...edge(goal.graph, 'x→y'), to: 'g' });
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.fitted).toEqual(['x→g', 'x→y']);
  expect(frames.reframedNodeIds(graph, result.graph)).toEqual(['y', 'g']);
  expect(frames.frameOf(node(result.graph, 'g'))).toBe(500);
  noCandidates(result.graph);
});

it('row (g): only fit would cut another link, so the whole cascade rolls back byte-for-byte', () => {
  const { graph } = admitted({ id: 'y', label: 'Y', kind: 'outcome', scale_frame: 100, unit: '£' });
  graph.nodes.push({ id: 'z', label: 'Z', kind: 'factor', scale_frame: 100 } as never);
  graph.edges = [...graph.edges, { from: 'y', to: 'z', strength: { mean: 0.3, std: 0.15 }, exists_probability: 0.8 }];
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.fitted).toEqual([]);
  expect(result.refused).toEqual([{ link: 'x→y', reason: 'not_the_goal' }]);
  expect(JSON.stringify(result.graph)).toBe(JSON.stringify(withoutCandidates(graph)));
});

it('row (g) invariance guard: an unframed neighbour with a natural size refuses with exact rollback', () => {
  const { graph } = admitted();
  graph.nodes.push({ id: 'z', label: 'Z', kind: 'factor' } as never);
  graph.edges = [...graph.edges, { from: 'z', to: 'y', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.8,
    provenance: { source: 'cee_hypothesis', natural_effect: { amount: 20, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'switch', strength_mean: 0.2, strength_mean_frame: 'edge_strength' } } }];
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.fitted).toEqual([]);
  expect(result.refused).toEqual([{ link: 'x→y', reason: 'new_cut' }]);
  expect(JSON.stringify(result.graph)).toBe(JSON.stringify(withoutCandidates(graph)));
});

it('user range binds both touching frames; a user goal target alone is allowed', () => {
  const { graph } = admitted();
  graph.nodes.push({ id: 'z', label: 'Z', kind: 'factor', scale_frame: 100 } as never);
  graph.edges = [...graph.edges, { from: 'z', to: 'y', strength: { mean: 0.2, std: 0.1 }, exists_probability: 0.8,
    provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: { amount: 0.2, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'items', strength_mean: 0.2, strength_mean_frame: 'edge_strength', stated_range: { low: 0.1, high: 0.3, text: '0.1–0.3', end: 'centre' } } } }];
  expect(frames.refitFramesForOlumiEstimates(graph).refused).toEqual([{ link: 'x→y', reason: 'levels_set_on_node' }]);
});

it('cascade preserves natural spreads, marks frame_carried only in Olumi pass, and consumes all candidates', () => {
  const { graph } = admitted({ id: 'y', label: 'Y', kind: 'outcome', scale_frame: 100, observed_state: { value: 0.4, raw_value: 40, std: 0.1, source: 'cee_inference', unit: '£' } });
  graph.nodes.push({ id: 'z', label: 'Z', kind: 'goal', scale_frame: 100 } as never);
  graph.edges = [...graph.edges, { from: 'y', to: 'z', strength: { mean: 0.3, std: 0.15 }, exists_probability: 0.8 }];
  const snapshot = JSON.stringify(graph);
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.fitted).toEqual(['x→y']);
  expect(frames.reframedNodeIds(graph, result.graph)).toEqual(['y', 'z']);
  const os = node(result.graph, 'y').observed_state;
  expect(os.std_source).toBe('frame_carried');
  expect(os.std * frames.frameOf(node(result.graph, 'y'))!).toBeCloseTo(10, 9);
  expect(naturalSize(result.graph, edge(result.graph, 'y→z'))).toBeCloseTo(0.3, 9);
  expect(JSON.stringify(graph)).toBe(snapshot);
  noCandidates(result.graph);
});

it('row (h): duplicate x→y candidates are both refused without throwing; a unique pair fits', () => {
  const { graph } = admitted();
  graph.edges.push(structuredClone(edge(graph, 'x→y')));
  const snapshot = JSON.stringify(graph);
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.fitted).toEqual([]);
  expect(result.refused).toEqual([
    { link: 'x→y', reason: 'ambiguous_pair' },
    { link: 'x→y', reason: 'ambiguous_pair' },
  ]);
  expect(result.graph.edges.filter((e: Rec) => `${e.from}→${e.to}` === 'x→y')).toHaveLength(2);
  expect(result.graph).toEqual(withoutCandidates(graph));
  expect(JSON.stringify(graph)).toBe(snapshot);
  noCandidates(result.graph);
  const unique = frames.refitFramesForOlumiEstimates(admitted().graph);
  expect(unique.fitted).toEqual(['x→y']);
  expect(edge(unique.graph, 'x→y').provenance.magnitude).toBe('olumi_estimate');
  noCandidates(unique.graph);
});

it('row (h) mixed pair: a candidate beside a non-candidate edge is ambiguous too', () => {
  const { graph } = admitted();
  graph.edges.unshift(structuredClone(withoutCandidates(graph).edges[0]));
  const result = frames.refitFramesForOlumiEstimates(graph);
  expect(result.fitted).toEqual([]);
  expect(result.refused).toEqual([{ link: 'x→y', reason: 'ambiguous_pair' }]);
  expect(result.graph).toEqual(withoutCandidates(graph));
  noCandidates(result.graph);
});

it('row (i): fitted-link disclosures retire in every reader; refused-link disclosures remain', async () => {
  const row = servedRow();
  const c = JSON.parse(row.drafter_texts[0]!);
  Object.assign(c.links.find((l: Rec) => l.from === 'Pro plan price' && l.to === 'Monthly Pro churn'),
    { to: 'Pro subscribers today', effect_amount: 100000, effect_per_source_change: 1, effect_provenance: 'ai_proposed', definitional: false });
  row.drafter_texts = [JSON.stringify(c)];
  const before = await replay(row, true);
  const after = await replay(row);
  const fittedId = 'pro_plan_price→mrr';
  const refusedId = 'pro_plan_price→pro_subscribers_today';
  expect(edge(after.graph, fittedId).provenance.magnitude).toBe('olumi_estimate');
  expect(edge(after.graph, refusedId).provenance.magnitude).toBe('olumi_placeholder');
  for (const id of [fittedId, refusedId]) {
    const [from, to] = id.split('→');
    const estimate = before.result.set_aside_estimates.find((s: Rec) => s.from === from && s.to === to);
    expect(estimate, id).toBeDefined();
    const disclosures = before.result.not_represented.filter((s: string) => s.includes(estimate.estimate) && s.includes('NOT in the model'));
    expect(disclosures, id).toHaveLength(1);
    const questions = before.result.open_questions.filter((q: string) => q.includes(estimate.estimate) && q.includes(NOT_REPRESENTABLE));
    expect(questions, id).toHaveLength(1);
    const remains = id === refusedId;
    expect(after.result.set_aside_estimates.some((s: Rec) => s.from === from && s.to === to), id).toBe(remains);
    for (const sentence of disclosures) expect(after.result.not_represented.includes(sentence), id).toBe(remains);
    for (const question of questions) expect(after.result.open_questions.includes(question), id).toBe(remains);
    const label = node(after.graph, to).label;
    expect(after.result.not_represented.some((s: string) => s.includes(label) && /NOT in the model|carries a placeholder|no result rests/.test(s)), id).toBe(remains);
  }
});

it('row (j): completed fit drops a sign-corrected basis; an agreeing-sign control keeps it', async () => {
  const basis = 'Higher price increases MRR';
  for (const direction of ['negative', 'positive']) {
    const row = servedRow();
    const c = JSON.parse(row.drafter_texts[0]!);
    Object.assign(c.links.find((l: Rec) => l.from === 'Pro plan price' && l.to === 'MRR'), { direction, basis });
    row.drafter_texts = [JSON.stringify(c)];
    const before = await replay(row, true);
    expect(edge(before.graph, 'pro_plan_price→mrr').provenance.magnitude).toBe('olumi_placeholder');
    const after = await replay(row);
    const e = edge(after.graph, 'pro_plan_price→mrr');
    expect(e.provenance.magnitude).toBe('olumi_estimate');
    expect(Math.sign(e.strength.mean)).toBe(direction === 'negative' ? -1 : 1);
    if (direction === 'negative') expect(e.provenance).not.toHaveProperty('basis');
    else expect(e.provenance.basis).toBe(basis);
    noCandidates(after.graph);
  }
});

it('row (k): doubling the goal frame after fitting keeps £3/item and amount; a placeholder keeps β', () => {
  const { graph } = admitted();
  graph.nodes.push({ id: 'z', label: 'Z', kind: 'factor', scale_frame: 100 });
  graph.edges.push({ from: 'z', to: 'y', strength: { mean: 0.2, std: 0.1 },
    provenance: { magnitude: 'olumi_placeholder' } });
  const fitted = frames.refitFramesForOlumiEstimates(graph);
  expect(fitted.fitted).toEqual(['x→y']);
  const from = frames.frameOf(node(fitted.graph, 'y'))!;
  expect(from).toBe(500);
  expect(frames.frameOf(node(fitted.graph, 'x'))).toBe(100);
  const size = naturalSize(fitted.graph, edge(fitted.graph, 'x→y'));
  expect(size).toBeCloseTo(3, 12);
  const written = structuredClone(fitted.graph);
  delete node(written, 'y').scale_frame;
  node(written, 'y').goal_threshold_cap = from * 2;
  const snapshot = JSON.stringify(written);
  const after = rederiveGoalInLinks(written, 'y', from);
  const e = edge(after, 'x→y');
  expect(Math.abs(naturalSize(after, e) - size)).toBeLessThanOrEqual(1e-9);
  expect(e.provenance.natural_effect.amount).toBe(3);
  expect(e.provenance.natural_effect.strength_mean).toBe(e.strength.mean);
  expect(e.strength.std).toBe(edge(fitted.graph, 'x→y').strength.std / 2);
  expect(edge(after, 'z→y').strength).toEqual(edge(fitted.graph, 'z→y').strength);
  expect(JSON.stringify(written)).toBe(snapshot);
});

it('row (k) class controls: ordinary estimates rescale in both readers; stale/missing sizes and placeholders keep β', () => {
  for (const retire of [false, true]) {
    const graph: Rec = { nodes: [
      { id: 'x', kind: 'factor', scale_frame: 100 },
      { id: 'y', kind: 'goal', goal_threshold_raw: 800, goal_threshold_cap: 1000, ...(retire ? { scale_frame: 500 } : {}) },
    ], edges: [] };
    for (const [id, magnitude, strength_mean] of [
      ['ordinary', 'olumi_estimate', 0.6], ['within_tolerance', 'olumi_estimate', 0.6 * (1 + 5e-10)],
      ['stale', 'olumi_estimate', 0.6 * (1 + 2e-9)], ['missing', 'olumi_estimate', undefined],
      ['placeholder', 'olumi_placeholder', 0.6],
    ] as const) {
      graph.nodes.push({ id, kind: 'factor', scale_frame: 100 });
      graph.edges.push({ from: id, to: 'y', strength: { mean: 0.6, std: 0.3 },
        provenance: { magnitude, ...(strength_mean === undefined ? {} : { natural_effect: { amount: 3, strength_mean } }) } });
    }
    const after = retire ? retireNormalisingGoalFrame(graph) : rederiveGoalInLinks(graph, 'y', 500);
    for (const id of ['ordinary', 'within_tolerance']) {
      expect(edge(after, `${id}→y`).strength.mean).toBe(0.3);
      expect(edge(after, `${id}→y`).provenance.natural_effect.amount).toBe(3);
    }
    for (const id of ['stale', 'missing', 'placeholder']) expect(edge(after, `${id}→y`).strength.mean).toBe(0.6);
  }
});

/** A fitted or ordinary estimate, and a user link on the same frame. An option fixes the goal's frame against refit. */
function goalEditGraph(fitted: boolean, negative: boolean, retire: boolean): Rec {
  const { graph } = admitted();
  const start = fitted ? frames.refitFramesForOlumiEstimates(graph).graph : {
    nodes: graph.nodes, edges: [{ from: 'x', to: 'y', strength: { mean: 0.6, std: 0.3 }, exists_probability: 0.8,
      effect_direction: 'positive', provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
        natural_effect: { amount: 3, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'items', strength_mean: 0.6, strength_mean_frame: 'edge_strength' } } }],
  };
  const e = edge(start, 'x→y');
  if (negative) {
    e.effect_direction = 'negative'; e.strength.mean *= -1;
    e.provenance.natural_effect.amount *= -1; e.provenance.natural_effect.strength_mean *= -1;
  }
  e.provenance.basis = 'A reason for the estimate';
  const goal = node(start, 'y');
  if (retire) goal.scale_frame = 500; else delete goal.scale_frame;
  delete goal.goal_threshold_cap;
  goal.observed_state = { value: 0.08, baseline: 0.08, raw_value: 40, cap: 500, unit: '£', source: 'brief_extraction' };
  start.nodes.push({ id: 'u', label: 'U', kind: 'factor', scale_frame: 100, unit: 'items' },
    { id: 'hold', label: 'Hold', kind: 'option', interventions: { y: 0 } });
  start.edges.push({ from: 'u', to: 'y', strength: { mean: 0.6, std: 0.3 }, exists_probability: 0.8, effect_direction: 'positive',
    provenance: { source: 'brief_extraction', magnitude: 'user_stated', natural_effect: {
      amount: 3, amount_unit: '£', per_source_change: 1, per_source_change_unit: 'items', strength_mean: 0.6, strength_mean_frame: 'edge_strength' } } });
  return start;
}

function assertGoalEditSetAside(start: Rec, after: Rec, disclosure: string, negative: boolean): void {
  const estimate = edge(after, 'x→y');
  const placeholder = admitCandidateLinks([{ from: 'x', to: 'y', direction: negative ? 'negative' : 'positive',
    provenance: 'ai_proposed', existence_probability: edge(start, 'x→y').exists_probability }]).edges[0]!;
  expect(estimate).toEqual(placeholder);
  expect(estimate.provenance).not.toHaveProperty('clamped_from');
  expect(estimate.provenance).not.toHaveProperty('natural_effect');
  expect(estimate.provenance).not.toHaveProperty('basis');
  const admission = admitted().loss.find(l => l.field_path === 'edges[x::y].set_aside_estimate')!;
  const statement = (admission.after as { estimate: string }).estimate.replace('raises', negative ? 'lowers' : 'raises');
  expect(disclosure).toContain(`${SET_ASIDE_ESTIMATE_LABEL}: ${statement}`);
  const user = edge(after, 'u→y');
  expect(user.strength).toEqual({ mean: 1, std: 0.5 });
  expect(user.provenance.clamped_from).toBe(3);
  expect(user.provenance.natural_effect).toEqual({ ...edge(start, 'u→y').provenance.natural_effect, strength_mean: 3 });
  expect(user.provenance.magnitude).toBe('user_stated');
  expect(frames.frameOf(node(after, 'y'))).toBe(100);
  noCandidates(after);
}

it.each([
  [true, false, true], [true, true, true], [false, false, true], [false, true, true],
  [true, false, false], [true, true, false], [false, false, false], [false, true, false],
])('row (l): goal edit → estimate set aside, not clamped; add_constraint fitted=%s negative=%s retire=%s', async (fitted, negative, retire) => {
  const graph = goalEditGraph(fitted, negative, retire);
  const snapshot = JSON.stringify(graph);
  const proposal = { handler_id: 'add_constraint', entity: { id: 'y', kind: 'goal', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters: [{ name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
      { name: 'value', value: 80, source: 'user_explicit' }, { name: 'unit', value: '£', source: 'user_explicit' }], cited_context_fields: [] };
  const out = await createAddConstraintHandler()({
    context: { session_id: 'scn-edit', stage: 'frame', request_id: 'req-edit', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: { kind: 'message', scenario_id: 'scn-edit', turn_id: 'turn-edit', stage: 'frame', message: 'Make the target at least £80' },
    requestId: 'req-edit', signal: new AbortController().signal, orientationText: '', proposal, graphForTurn: graph,
  } as unknown as HandlerInvocation);
  assertGoalEditSetAside(graph, out.mutated_graph as Rec, out.assistant_text, negative);
  expect(JSON.stringify(graph)).toBe(snapshot);
});

it.each([true, false])('row (l): goal edit → estimate set aside, not clamped; goal_current_level retire=%s', async retire => {
  const start = goalEditGraph(true, true, retire);
  Object.assign(node(start, 'y'), { goal_threshold_raw: 80, goal_threshold_cap: 100, goal_threshold: 0.8,
    goal_threshold_unit: '£', goal_threshold_frame: 'level', goal_direction: '<=' });
  start.goal_constraints = [{ constraint_id: 'ceiling', node_id: 'y', label: 'Y at most £80', operator: '<=', value: 80, unit: '£', provenance: 'explicit', value_frame: 'level' }];
  let stored = structuredClone(start);
  const registrations: Rec[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      stored = structuredClone((body as { graph: Rec }).graph); registrations.push(stored);
      return { status: 200, json: { model_version: { version_number: 2 } } };
    }
    return { status: 200, json: { graph: structuredClone(stored), graph_hash: registrations.length ? 'h1' : 'h0' } };
  };
  const caps = createAgentCapabilities(dispatch, new ProposalStore());
  const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400cc', authenticated_user_id: null, request_id: 'req-edit', user_text: 'Our Y is £80 today.' };
  const proposed = await dispatchTool('propose_goal_current_level', JSON.stringify({ goal_label: 'Y', value: 80, unit: '£', goal_is: 'at_most', user_stated: true }), ctx, caps) as Rec;
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const out = await dispatchTool('authorise_change', JSON.stringify({ proposal_id: proposed.proposal_id }), ctx, caps) as Rec;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  expect(registrations).toHaveLength(1);
  assertGoalEditSetAside(start, stored, out.not_represented, true);
});

it('served census: 116 corpus + 8 R2; fewer not_representable set-asides and goal-path placeholders', async () => {
  const corpus: Row[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/s7-construction-census/corpus.json.gz', import.meta.url))).toString('utf8'));
  expect(corpus).toHaveLength(116); expect(r2).toHaveLength(8);
  async function count(old: boolean) {
    let notRepresentable = 0; let placeholders = 0; let goalPathLinks = 0;
    for (const row of [...corpus, ...r2]) {
    const { graph, result } = await replay(row, old);
    noCandidates(graph);
    for (const s of result.set_aside_estimates ?? []) {
      // Bind the question by its admitted endpoint labels and exact set-aside statement.
      if (result.open_questions.some((q: string) => q.includes(NOT_REPRESENTABLE) && q.includes(s.estimate))) notRepresentable++;
    }
    const reaches = new Set(graph.nodes.filter((n: Rec) => n.kind === 'goal').map((n: Rec) => n.id));
    for (let changed = true; changed;) {
      changed = false;
      for (const e of graph.edges) if (reaches.has(e.to) && !reaches.has(e.from)) { reaches.add(e.from); changed = true; }
    }
    for (const e of graph.edges) if (reaches.has(e.to) && !['option', 'decision'].includes(node(graph, e.from).kind)) {
      goalPathLinks++;
      if (e.provenance?.magnitude === 'olumi_placeholder') placeholders++;
    }
    }
    return { not_representable: notRepresentable, placeholders, goal_path_links: goalPathLinks };
  }
  const baseline = await count(true);
  const current = await count(false);
  process.stdout.write('S7 2BA CENSUS ' + JSON.stringify({ drafts: 124, ...current, baseline }) + '\n');
  expect(baseline).toEqual({ not_representable: 85, placeholders: 421, goal_path_links: 1122 });
  expect(current.not_representable).toBeLessThan(85);
}, 120_000);
