import fs from 'node:fs';
import zlib from 'node:zlib';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { metricReadsAsPlainTotal, type CandidateModel, type AdmittedModel } from '../admit-model.js';
import { goalIdentityScopeIsMaterial, untypedScopeComponents } from '../goal-scope.js';

type Row = { id: string; brief: string; drafter_texts: string[] };
type Node = { id: string; kind: string; label: string; nonlinear_identity?: { operation: string; factor_ids: string[] } };
type Graph = { nodes: Node[]; edges: Record<string, unknown>[] };
const r2: Row[] = JSON.parse(fs.readFileSync(new URL('./fixtures/s7-a2-r2.json', import.meta.url), 'utf8'));
const QUESTION = 'Is the £20k MRR goal for the Pro plan only or for all plans together?';
const scopeQuestions: Record<string, string> = JSON.parse(fs.readFileSync(new URL('./fixtures/s7-a2-scope-questions.json', import.meta.url), 'utf8'));
const baseline = process.env.S7_A2_BASELINE === '1';
async function replay(row: Row) {
  let graph: Graph | undefined;
  let i = 0;
  let candidate: CandidateModel | undefined;
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) {
      graph = (body as { graph: Graph }).graph;
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const drafter = async () => {
    const text = row.drafter_texts[Math.min(i++, row.drafter_texts.length - 1)]!;
    candidate = JSON.parse(text) as CandidateModel;
    return { text, status: 'completed' };
  };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-000000000077', row.brief, dispatch as never, drafter as never) as Record<string, unknown>;
  expect(result.ok, row.id + JSON.stringify(result)).toBe(true);
  expect(graph, row.id).toBeDefined();
  return { graph: graph!, candidate: candidate!, result, questions: (result.open_questions ?? []) as string[] };
}
const rowFor = (id: string) => r2.find(r => r.id === id)!;
const synthetic = (modify: (c: CandidateModel) => void): Row => {
  const row = structuredClone(rowFor('R2/B1-B'));
  const c = JSON.parse(row.drafter_texts[0]!) as CandidateModel;
  modify(c);
  row.drafter_texts = [JSON.stringify(c)];
  return row;
};
it('row (1): B1-B keeps the exact drafter question once, on the admitted goal identity', async () => {
  const { graph, questions, result } = await replay(rowFor('R2/B1-B'));
  const goal = graph.nodes.find(n => n.id === 'mrr')!;
  expect(goal.nonlinear_identity).toMatchObject({ operation: 'product', factor_ids: ['pro_plan_monthly_price', 'pro_subscribers_at_month_12'] });
  expect(untypedScopeComponents(graph, goal.id)).toEqual([]);
  const actual = questions.filter(q => q === QUESTION);
  console.log('FIRSTDIFF', JSON.stringify({ id: goal.id, field: 'open_questions', before: [QUESTION], after: actual, first_differing_byte: JSON.stringify([QUESTION]) === JSON.stringify(actual) ? null : 1 }));
  expect(actual).toEqual([QUESTION]);
  expect(questions.filter(q => q.startsWith('I’ve read your goal'))).toEqual([]);
  expect(result.pending_action).toMatchObject({ action: { goal_id: 'mrr', question: QUESTION, expected: 'scope' } });
});
it('row (2): B1-A keeps pinned scope wording while fitted estimate questions retire', async () => {
  const { graph, questions } = await replay(rowFor('R2/B1-A'));
  // Fitted magnitude questions retire; their obsolete ledger entries no longer suppress drafter questions.
  for (const [from, to, amount] of [
    ['new_pro_subscribers_per_month', 'pro_subscribers_at_month_12', 8],
  ] as const) {
    expect(graph.edges.find(e => e.from === from && e.to === to)).toMatchObject({
      provenance: { magnitude: 'olumi_estimate', natural_effect: { amount } },
    });
  }
  // H4: the admitted product partial has no stored £49 coefficient to fit.
  const partial = graph.edges.find(e => e.from === 'pro_subscribers_at_month_12' && e.to === 'mrr')!;
  expect(partial).toMatchObject({ provenance: { identity_partial: { outcome: 'mrr', operand_ids: ['pro_plan_price', 'pro_subscribers_at_month_12'], authored_by: 'olumi' } } });
  expect((partial as { provenance?: { natural_effect?: unknown } }).provenance?.natural_effect).toBeUndefined();
  const before = JSON.parse(fs.readFileSync(new URL('./fixtures/s7-a2-b1-a-questions.json', import.meta.url), 'utf8')) as string[];
  const restored = 'What is current monthly Pro churn? The provisional model assumes 6%, below the stated 8% limit.';
  const c = JSON.parse(rowFor('R2/B1-A').drafter_texts[0]!) as { unknowns: string[] };
  expect(c.unknowns).toContain(restored);
  expect(questions.filter(q => q === restored)).toEqual([restored]);
  const expected = [...before];
  expected.splice(expected.indexOf('How many Pro subscribers are there today? The provisional model assumes 200.') + 1, 0, restored);
  expect(questions).toEqual(expected);
});
it('row (3): no goal identity retains d5 suppression', async () => {
  const row = synthetic(c => { Object.assign(c, { identities: [] }); });
  const { questions, result } = await replay(row);
  expect(questions).not.toContain(QUESTION);
  expect(questions.filter(q => q.startsWith('I’ve read your goal'))).toEqual([]);
  expect(result.pending_action).toBeUndefined();
});
it('typed declaration and identity membership survive adversarial shared quantity words', async () => {
  const row = synthetic(c => {
    const rename = new Map([['Pro plan monthly price', 'MRR monthly churn rate'], ['Pro subscribers at month 12', 'MRR monthly churn population']]);
    const text = JSON.stringify(c, (_k, v: unknown) => typeof v === 'string' && rename.has(v) ? rename.get(v) : v);
    Object.assign(c, JSON.parse(text));
  });
  const { graph, questions } = await replay(row);
  expect(graph.nodes.find(n => n.id === 'mrr')!.nonlinear_identity?.factor_ids).toEqual(['mrr_monthly_churn_rate', 'mrr_monthly_churn_population']);
  expect(questions.filter(q => q === QUESTION)).toEqual([QUESTION]);
});
it('material scope is said once even if the drafter repeats the same question', async () => {
  const row = synthetic(c => {
    const raw = c as CandidateModel & { unknowns: string[] };
    raw.unknowns.unshift(QUESTION);
  });
  const { questions } = await replay(row);
  expect(questions.filter(q => q === QUESTION)).toEqual([QUESTION]);
  expect(questions.filter(q => q.startsWith('I’ve read your goal'))).toEqual([]);
});
it('material identity keeps one question when the old disclosure would also fire', async () => {
  const row = synthetic(c => {
    const option = {
      label: 'Add subscribers', provenance: 'ai_proposed', is_status_quo: false, changes: [],
      interventions: [{ factor_label: 'Pro subscribers today', value: 100, value_kind: 'absolute', unit: 'subscribers', provenance: 'ai_proposed' }],
    };
    Object.assign(c, { options: c.options.filter(o => !o.is_status_quo).concat(option) });
    Object.assign(c.factors.find(f => f.label === 'Pro subscribers today')!, { baseline_value: 0 });
  });
  const { graph, questions } = await replay(row);
  expect(untypedScopeComponents(graph, 'mrr').length).toBeGreaterThan(0);
  expect(questions.filter(q => q === QUESTION)).toEqual([QUESTION]);
  expect(questions.filter(q => q.startsWith('I’ve read your goal'))).toEqual([]);
});
it('material scope with NO drafter restatement falls back to a question naming the modelled part (DL #2914 r3)', async () => {
  const row = synthetic(c => { (c as unknown as { unknowns: string[] }).unknowns = ((c as unknown as { unknowns: string[] }).unknowns ?? []).filter(q => q !== QUESTION); });
  const { questions, result } = await replay(row);
  expect(questions).not.toContain(QUESTION);
  const disclosure = 'I’ve modelled your goal, ‘MRR’, as ‘the Pro plan only’, not ‘all plans together’. Is your target for ‘the Pro plan only’ or for ‘all plans together’?';
  expect(questions.filter(q => q === disclosure)).toHaveLength(1);
  expect(questions.some(q => q.includes('total across every tier'))).toBe(false);
  expect((result.pending_action as { action: { question: string } }).action.question).toBe(disclosure);
});
it('typed materiality requires the declared scope and admitted operand ids', async () => {
  const { graph, candidate } = await replay(rowFor('R2/B1-B'));
  const admitted = graph as Pick<AdmittedModel, 'nodes'>;
  expect(goalIdentityScopeIsMaterial(true, candidate, admitted)).toBe(true);
  expect(goalIdentityScopeIsMaterial(false, candidate, admitted)).toBe(false);
  expect(goalIdentityScopeIsMaterial(true, { goal: { ...candidate.goal, scope: null } }, admitted)).toBe(false);
  const missing = { nodes: admitted.nodes.filter(n => n.id !== 'pro_subscribers_at_month_12') };
  expect(goalIdentityScopeIsMaterial(true, candidate, missing)).toBe(false);
  const unrelated = { nodes: admitted.nodes.map(n => n.id === 'mrr' ? { ...n, nonlinear_identity: undefined } : n) };
  expect(goalIdentityScopeIsMaterial(true, candidate, unrelated)).toBe(false);
});
it('served census: 116 corpus + all 8 R2 cells', async () => {
  const corpus: Row[] = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL('./fixtures/s7-construction-census/corpus.json.gz', import.meta.url))).toString('utf8'));
  expect(corpus).toHaveLength(116);
  expect(r2).toHaveLength(8);
  const rows = [];
  for (const row of [...corpus, ...r2]) {
    const { graph, candidate, questions } = await replay(row);
    const goal = graph.nodes.find(n => n.kind === 'goal')!;
    // Oracle reads the registered graph, never recomputes admission. The declaration applies to this model;
    // only identity membership on its admitted goal binds operands to that declared scope.
    const factors = goal.nonlinear_identity?.factor_ids ?? [];
    const material = metricReadsAsPlainTotal(candidate.goal.metric) && candidate.goal.scope?.stated_in_brief === false
      && candidate.goal.scope.modelled.trim() !== '' && factors.length >= 2
      && factors.every(id => graph.nodes.some(n => n.id === id && n.id !== goal.id && ['factor', 'outcome', 'goal'].includes(n.kind)));
    // Reviewed corpus pins: scope wording varies ("all plans" vs "all plans together"). Bind exact
    // drafter bytes per id, rather than introducing a second population-word classifier.
    const pinned = scopeQuestions[row.id];
    if (material) expect(pinned, row.id + ': missing reviewed scope question pin').toBeDefined();
    const reached = questions.some(q => q === pinned || q.startsWith('I’ve read your goal') || q.startsWith('I’ve modelled your goal'));
    rows.push({ id: row.id, material: Boolean(material), missing: Boolean(material && !reached), questions, goal, graph_sha256: createHash('sha256').update(JSON.stringify(graph)).digest('hex') });
  }
  const missing = rows.filter(r => r.missing).map(r => r.id);
  const totalClaimViolators = rows.filter(r => r.material && r.questions.some(q => q.includes('total across every tier'))).map(r => r.id);
  expect(totalClaimViolators).toEqual([]);
  console.log('S7 A2 CENSUS', JSON.stringify({ count: missing.length, missing }));
  if (!baseline) expect(missing).toEqual([]);
}, 120_000);
