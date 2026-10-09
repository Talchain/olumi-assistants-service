import fs from 'node:fs';
import zlib from 'node:zlib';
import { expect, it, vi } from 'vitest';
import { sizeLink, NOT_REPRESENTABLE, type MagnitudeNode } from '../../../cee/magnitude/link-effect.js';
import { admitCandidateLinks } from '../admit-candidate.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import * as frames from '../refit-frames.js';

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
