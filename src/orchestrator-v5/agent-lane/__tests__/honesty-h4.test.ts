import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';
import { markIdentityPartials, naturalSizeReceipt } from '../identity-partial.js';
import { howStronglyWords, whoSized, IDENTITY_ONLY, IDENTITY_PART } from '../strength-authorship-words.js';
import { linkSizing, isPlaceholderLink, isSizedOnlyByOlumi, approvalSizes } from '../../../cee/magnitude/link-sizing.js';
import { EdgeProvenanceV3 } from '../../../schemas/cee-v3.js';
import { refitFramesForStatedEffects } from '../refit-frames.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { validatedDefinitionForGraph } from '../../goal-target/held-user-links.js';
import { olumiEstimatesFeedingResult } from '../olumi-estimates-feeding-result.js';
import { groupedGoalPathLinks } from '../../compose/grouped-link-sizing.js';
import { applyIdentityConfirmEdit, identityConfirmReadingToken, identityConfirmPostimageIsScoped } from '../../system-events/identity-confirm-edit.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { goalCoherenceAsk } from '../goal-coherence.js';

type Graph = { nodes: Record<string, any>[]; edges: Record<string, any>[] };
type Row = { id: string; brief: string; drafter_texts: string[] };
const row: Row = JSON.parse(fs.readFileSync(new URL('./fixtures/s7-2bb-redraw.json', import.meta.url), 'utf8')).find((r: Row) => r.id === '2bb/B2-d2');
// Captured at 7cfb8680 by a separate, in-memory replay before edits; tests only read it.
const base: Graph = JSON.parse(fs.readFileSync(new URL('./fixtures/s7-h4-base.json', import.meta.url), 'utf8'));
const idOf = (e: Record<string, any>): string => e.id ?? `${e.from}->${e.to}`;
const edge = (g: Graph, id: string) => { const matches = g.edges.filter(e => idOf(e) === id); expect(matches, id).toHaveLength(1); return matches[0]!; };
const node = (g: Graph, id: string) => g.nodes.find(n => n.id === id)!;
async function replay(brief = row.brief, edit?: (c: CandidateModel) => void): Promise<Graph> {
  let graph: Graph | undefined; let i = 0;
  const dispatch = async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = (body as { graph: Graph }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'x' } };
  };
  const draft = async () => {
    const c = JSON.parse(row.drafter_texts[Math.min(i++, row.drafter_texts.length - 1)]!) as CandidateModel;
    edit?.(c);
    return { text: JSON.stringify(c), status: 'completed' };
  };
  const result = await buildModelFromBrief('00000000-0000-4000-8000-000000000077', brief, dispatch as never, draft as never) as { ok: boolean };
  expect(result.ok, JSON.stringify(result)).toBe(true); expect(graph).toBeDefined();
  return graph!;
}
let graph: Graph;
beforeAll(async () => { graph = await replay(); });
const partials = [
  ['existing_customers->existing_plan_monthly_recurring_revenue', 'brief', ['existing_customers', 'existing_customer_monthly_price']],
  ['existing_customer_monthly_price->existing_plan_monthly_recurring_revenue', 'brief', ['existing_customers', 'existing_customer_monthly_price']],
  ['starter_monthly_price->starter_tier_monthly_recurring_revenue', 'olumi', ['starter_subscribers', 'starter_monthly_price']],
] as const;
const stated = [
  ['starter_subscribers->starter_tier_monthly_recurring_revenue', 49],
  ['starter_subscribers->starter_support_cost', 6],
] as const;

it.each(stated)('%s is the stated pair, with its brief quote', (id, amount) => {
  const e = edge(graph, id);
  expect(e.provenance.magnitude).toBe('user_stated');
  expect(e.provenance.natural_effect.amount).toBe(amount);
  expect(e.provenance.source_quote).toBeTruthy();
  expect(row.brief).toContain(e.provenance.source_quote);
  expect(whoSized(e)).toBe('yours');
});
it('a drafter attribution cannot disown the £49 written for this pair (1a)', async () => {
  const inferred = await replay(row.brief, c => {
    const l = c.links.find(l => l.from === 'Starter subscribers' && l.to === 'Starter-tier monthly recurring revenue')!;
    Object.assign(l, { provenance: 'inferred', effect_provenance: 'inferred' });
  });
  const e = edge(inferred, stated[0][0]);
  expect(e.provenance.magnitude).toBe('user_stated');
  expect(e.provenance.source_quote).toContain('£49');
  expect(e.provenance.identity_partial).toBeUndefined();
});
it.each(partials)('%s is a typed partial authored by %s', (id, authored_by, operands) => {
  const e = edge(graph, id);
  expect(e.provenance.identity_partial).toEqual({ outcome: e.to, operand_ids: operands, authored_by });
  expect(e.provenance.magnitude).toBeUndefined();
  expect(e.provenance.natural_effect).toBeUndefined();
  expect(e.provenance.olumi_fit_candidate).toBeUndefined();
  expect(e.provenance.definitional).toBeUndefined();
  expect(whoSized(e)).toBe('identity');
  expect(linkSizing(e)).toBe('unmarked');
  expect(isPlaceholderLink(e)).toBe(false);
  expect(isSizedOnlyByOlumi(e)).toBe(false);
  expect(approvalSizes(e)).toBe(false);
  process.stdout.write(`H4 ROW ${JSON.stringify({ id, identity_partial: e.provenance.identity_partial, words: howStronglyWords([e], graph) })}\n`);
});
it('support cost partial follows the admitted-carrier rule; derived £3 stays Olumi’s', () => {
  const id = 'support_cost_per_starter_subscriber->starter_support_cost';
  expect(node(graph, 'starter_support_cost').nonlinear_identity).toBeUndefined();
  expect(edge(graph, id)).toEqual(edge(base, id));
  expect(edge(graph, id).provenance.magnitude).toBe('olumi_estimate');
  expect(edge(graph, 'price_rise->existing_customer_monthly_price')).toEqual(edge(base, 'price_rise->existing_customer_monthly_price'));
  process.stdout.write(`H4 ROW ${id}: olumi_estimate; product not admitted\n`);
});
it('NO other admitted change: diff every edge and node against 7cfb8680', () => {
  expect(graph.nodes).toEqual(base.nodes);
  expect(graph.edges.map(idOf)).toEqual(base.edges.map(idOf));
  const changed = new Set<string>([...partials.map(p => p[0]), ...stated.map(p => p[0])]);
  for (const e of graph.edges) {
    const old = edge(base, idOf(e));
    if (!changed.has(idOf(e))) expect(e, idOf(e)).toEqual(old);
    else {
      const { provenance: _p, ...kept } = e, { provenance: _old, ...oldKept } = old;
      expect(kept, idOf(e)).toEqual(oldKept);
      if (stated.some(s => s[0] === idOf(e))) {
        const { magnitude: _m, source_quote: _q, ...p } = e.provenance;
        const { magnitude: _om, source_quote: _oq, ...op } = old.provenance;
        expect(p, idOf(e)).toEqual(op);
      }
    }
  }
});
it('£300→£320 reads today’s operand, never a stored amount', () => {
  const edited = structuredClone(graph);
  const price = node(edited, 'existing_customer_monthly_price');
  price.observed_state.raw_value = 320; price.observed_state.value = 320 / price.observed_state.cap;
  const e = edge(edited, partials[0][0]);
  expect(howStronglyWords([e], edited)).toContain('£320');
  expect(howStronglyWords([e], edited)).not.toContain('£300');
  expect(e.provenance.natural_effect).toBeUndefined();
});
// All CEE figure surfaces, including the production product/coherence arithmetic;
// this is not a simulated ISL Run. Engine execution is outside this repository.
function figures(g: Graph): string {
  const product = node(g, 'existing_plan_monthly_recurring_revenue');
  const reading = { nodes: [
    { ...product, kind: 'goal', operator: '>=', goal_threshold_raw: 1000, goal_threshold_unit: '£/month', goal_threshold_frame: 'level' },
    ...g.nodes.filter(n => product.nonlinear_identity.factor_ids.includes(n.id)),
  ], edges: g.edges.filter(e => e.to === product.id) };
  const coherence = goalCoherenceAsk(reading, { nodeId: 'existing_customer_monthly_price', previousRaw: 290 });
  expect(coherence).not.toBeNull();
  return JSON.stringify({ nodes: g.nodes, natural_figures: g.edges.map(e => e.provenance?.natural_effect ?? null),
    words: g.edges.map(e => howStronglyWords([e], g)), coherence });
}
it('partial weight mutation leaves EVERY CEE figure byte-identical', () => {
  const changed = structuredClone(graph);
  edge(changed, partials[0][0]).strength = { mean: 0.99, std: 0.48 };
  expect(figures(changed)).toBe(figures(graph));
});
it('partial is excluded from RC4 counts and placeholder/licence checks even beside contradictory older fields', () => {
  const changed = structuredClone(graph);
  for (const [id] of partials) {
    const e = edge(changed, id); Object.assign(e.provenance, { magnitude: 'olumi_placeholder', mean_projected: true }); e.defaulted = true;
    expect(linkSizing(e)).toBe('unmarked'); expect(isPlaceholderLink(e)).toBe(false); expect(approvalSizes(e)).toBe(false);
  }
  const grouped = groupedGoalPathLinks(changed);
  for (const [id] of partials) expect(grouped.some(l => `${l.from}->${l.to}` === id)).toBe(false);
  const signals = assembleGuidanceSignals({ graph: changed, request: 'other', offeredSpecific: [], analysisState: null, analysisResult: null } as never);
  const links = signals['model.goal_path_links'];
  for (const [id] of partials) expect(links.find(l => l.link_id === id)?.link_sizing).toBe('unmarked');
  const counts = olumiEstimatesFeedingResult({ goalPathLinks: links, goalPathFactors: signals['model.goal_path_factors'], validatedDefinitionForLink: validatedDefinitionForGraph(changed) });
  const before = olumiEstimatesFeedingResult({ goalPathLinks: assembleGuidanceSignals({ graph, request: 'other', offeredSpecific: [], analysisState: null, analysisResult: null } as never)['model.goal_path_links'], goalPathFactors: signals['model.goal_path_factors'], validatedDefinitionForLink: validatedDefinitionForGraph(graph) });
  expect(counts).toEqual(before);
  const baseSignals = assembleGuidanceSignals({ graph: base, request: 'other', offeredSpecific: [], analysisState: null, analysisResult: null } as never);
  const baseCounts = olumiEstimatesFeedingResult({ goalPathLinks: baseSignals['model.goal_path_links'], goalPathFactors: baseSignals['model.goal_path_factors'], validatedDefinitionForLink: validatedDefinitionForGraph(base) });
  process.stdout.write(`H4 RC4 ${JSON.stringify({ before: baseCounts, after: counts })}\n`);
  for (const [id] of partials) expect(counts.links.some(l => l.id === id)).toBe(false);
});
it('sizedExactly skips partials, even if a legacy definitional mark remains', () => {
  const g = { nodes: [{ id: 'a', kind: 'factor', scale_frame: 10 }, { id: 'b', kind: 'outcome', scale_frame: 10 }, { id: 'c', kind: 'factor', scale_frame: 10 }],
    edges: [{ from: 'a', to: 'b', strength: { mean: 2, std: 0.1 }, provenance: { source: 'cee_hypothesis', definitional: true,
      identity_partial: { outcome: 'b', operand_ids: ['a', 'c'], authored_by: 'olumi' } } }] };
  const result = refitFramesForStatedEffects(g);
  expect(result.refits).toEqual([]); expect(result.graph).toEqual(g);
});
it('entity A’s number cannot credit entity B’s pair (naive substring RED control)', () => {
  const text = 'Each enterprise subscriber adds £49 a month to enterprise revenue. Starter revenue is not sized.';
  expect(text.includes('49')).toBe(true);
  expect(naturalSizeReceipt(49, '£/month', text, 'Starter subscribers', 'Starter revenue', ['Starter subscribers', 'Starter revenue', 'Enterprise subscribers', 'Enterprise revenue'])).toBeNull();
});
it('uncredited other operand stays Olumi’s despite the same number on A', () => {
  const g = structuredClone(graph);
  const text = '400 enterprise customers paying £300 a month. Existing customers have no price stated.';
  expect(text.includes('300')).toBe(true);
  const marked = markIdentityPartials(g.nodes as never, g.edges as never, text, new Set());
  expect(marked.find(e => e.from === 'existing_customers' && e.to === 'existing_plan_monthly_recurring_revenue')!.provenance!.identity_partial!.authored_by).toBe('olumi');
});
it('valid paying paraphrase still credits the relation without the draft’s literal labels', async () => {
  const text = row.brief.replace('from 400 customers paying £300 a month', 'from 400 customers paying £300 each month');
  const g = await replay(text);
  expect(edge(g, partials[0][0]).provenance.identity_partial.authored_by).toBe('brief');
  expect(text.includes('Existing customer monthly price')).toBe(false);
  // A literal-label substring shortcut would reject this valid paraphrase.
  expect(text.includes(node(g, 'existing_customer_monthly_price').label)).toBe(false);
});
it('schema retains exact typed bytes and drops malformed markers', () => {
  const p = edge(graph, partials[0][0]).provenance;
  expect(EdgeProvenanceV3.parse(p).identity_partial).toEqual(p.identity_partial);
  expect(EdgeProvenanceV3.parse({ ...p, identity_partial: { ...p.identity_partial, operand_ids: ['one'] } }).identity_partial).toBeUndefined();
});
it('prints SHA256 for every literal UTF-8 user-visible template', () => {
  for (const [kind, templates] of [['ONLY', IDENTITY_ONLY], ['PART', IDENTITY_PART]] as const) {
    for (const [who, template] of Object.entries(templates)) process.stdout.write(`H4 TEMPLATE ${kind}.${who} ${createHash('sha256').update(template, 'utf8').digest('hex')} ${template}\n`);
  }
});

it('a sum definition never writes a partial; a rejected product stays unchanged', () => {
  const g = structuredClone(graph);
  const outcome = node(g, 'existing_plan_monthly_recurring_revenue');
  outcome.nonlinear_identity = { ...outcome.nonlinear_identity, operation: 'sum' };
  const edges = structuredClone(base.edges);
  edge({ ...g, edges }, partials[0][0]).provenance.definitional = true;
  const marked = markIdentityPartials(g.nodes as never, edges as never, row.brief, new Set());
  expect(edge({ ...g, edges: marked }, partials[0][0])).toEqual(edge({ ...g, edges }, partials[0][0]));
  delete outcome.nonlinear_identity;
  const rejected = markIdentityPartials(g.nodes as never, edges as never, row.brief, new Set());
  expect(edge({ ...g, edges: rejected }, partials[0][0])).toEqual(edge({ ...g, edges }, partials[0][0]));
});
it('confirmed identity words use the same exact template and current operand', () => {
  const e = structuredClone(edge(graph, partials[0][0]));
  e.provenance.identity_partial.authored_by = 'user_confirmed';
  expect(howStronglyWords([e], graph)).toBe(howStronglyWords([edge(graph, partials[0][0])], graph));
});

it('an approval card records user_confirmed only on its existing partials', () => {
  const reading = { outcome_id: 'existing_plan_monthly_recurring_revenue', factor_ids: ['existing_customers', 'existing_customer_monthly_price'], words: 'Existing-plan revenue is customers times monthly price.' };
  const result = applyIdentityConfirmEdit({ ...reading, persistedGraph: graph,
    expected_graph_hash: computeAnalysisAffectingGraphHash(graph as never) ?? '', reading_token: identityConfirmReadingToken(reading) });
  expect(result.kind, JSON.stringify(result)).toBe('mutated');
  if (result.kind !== 'mutated') return;
  const confirmed = result.mutatedGraph as Graph;
  for (const [id] of partials.slice(0, 2)) expect(edge(confirmed, id).provenance.identity_partial.authored_by).toBe('user_confirmed');
  expect(identityConfirmPostimageIsScoped(graph, confirmed, reading.outcome_id)).toBe(true);
  expect(edge(confirmed, partials[2][0])).toEqual(edge(graph, partials[2][0]));
  const tampered = structuredClone(confirmed);
  edge(tampered, partials[0][0]).strength.mean = 0.999;
  expect(identityConfirmPostimageIsScoped(graph, tampered, reading.outcome_id)).toBe(false);
});

it('the stated 2-customer price-rise pair remains exactly user_stated', () => {
  const id = 'price_rise->customers_lost_to_price_rise';
  const e = edge(graph, id);
  expect(e).toEqual(edge(base, id));
  expect(e.provenance.magnitude).toBe('user_stated');
  expect(e.provenance.natural_effect.amount).toBe(2);
  expect(e.provenance.source_quote).toBe('Each 1% price rise loses about 2 customers, between 1 and 4.');
});

// A source count beside a cost must never become the cost's per-one effect.
it('near miss: 150 starter subscribers beside support costs £6 each is not a £150 effect', () => {
  expect(naturalSizeReceipt(150, 'GBP/month',
    'We expect 150 starter subscribers and support costs £6 each.',
    'Starter subscribers', 'Starter support cost', ['Starter subscribers', 'Starter support cost'])).toBeNull();
});
it('the recorded f440be4a subscriber count cannot credit its support-cost edge', async () => {
  const { manifest, fixture, prepare, admitted } = await import('./fixtures/r5-verified-cases.js');
  const record = manifest.find(r => r.sc === 'f440be4a')!;
  const brief = fixture(`r5-census/${record.brief_sha256}.txt`);
  const candidate = JSON.parse(fixture('r5-census/f440be4a.json')) as CandidateModel;
  const result = admitted(prepare(candidate, brief).candidate, brief);
  const e = result.edges.find(e => e.from === 'support_cost_per_starter_subscriber' && e.to === 'starter_tier_monthly_support_cost')!;
  expect(e).toBeDefined();
  expect(e.provenance?.magnitude).not.toBe('user_stated');
  expect(e.provenance?.identity_partial !== undefined || e.provenance?.magnitude === 'olumi_estimate').toBe(true);
});

it('a stated per-one amount cannot credit a per-100 link', () => {
  expect(naturalSizeReceipt(6, 'GBP/month', 'Each starter subscriber costs about £6 a month in support.',
    'Starter subscribers', 'Starter support cost', ['Starter subscribers', 'Starter support cost'], 'subscribers', 100)).toBeNull();
});
it('a money-rate source cannot borrow its subscribers’ per-one amount', () => {
  expect(naturalSizeReceipt(6, 'GBP/month', 'Each starter subscriber costs about £6 a month in support.',
    'Support cost per starter subscriber', 'Starter support cost', ['Support cost per starter subscriber', 'Starter support cost'], 'GBP/subscriber/month')).toBeNull();
});

it('the reverted at-payment widening conservatively leaves the product Olumi’s', async () => {
  const g = await replay(row.brief.replace('from 400 customers paying £300 a month', 'from 400 customers at £300 a month'));
  expect(edge(g, partials[0][0]).provenance.identity_partial.authored_by).toBe('olumi');
});
