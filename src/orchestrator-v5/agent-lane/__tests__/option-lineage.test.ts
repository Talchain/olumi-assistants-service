/**
 * ⭐ AN OPTION THE BRIEF LISTS IS SAVED WITH THE BRIEF'S OWN WORDS FOR IT (MG #72 5887699714; DL 5887755959; AI Quality
 * 5887822471 rows). Row 1: Canvas's cloud-bill brief and its saved live draft (the #2281 fixture), through the real build
 * and the Run's own reconciliation reader. Rows 2–8: the binding rule, pure. A label is never evidence; every doubt
 * writes nothing, which leaves today's honest withhold.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { optionQuotes, quoteListedOptions } from '../option-lineage.js';
import { markOlumiOptions } from '../olumi-option-marker.js';
import { buildModelFromBrief, buildCandidateSchema, type CallStructuredModel } from '../runtime/build-model.js';
import { deriveIntakeOptionReconciliation, extractEnumeratedOptions } from '../../../orchestrator/context/intake-option-reconciliation.js';
import { Ajv } from 'ajv';
import { canonicalLabel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CandidateModel } from '../admit-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/cloud3-option-factor-same-name-20260929.json', import.meta.url), 'utf8')) as { brief: string; candidate: CandidateModel };
const WORDS: Record<string, string> = {
  'Reserved instances': 'move steady workloads to reserved instances',
  'Spot instances': 'shift batch jobs to spot instances',
  'Enterprise discount': 'renegotiate our enterprise discount with the provider',
};
const withWords = (c: CandidateModel, words: Record<string, string | null>): CandidateModel =>
  ({ ...c, options: c.options.map((o) => ({ ...o, brief_words: words[o.label] ?? null })) } as unknown as CandidateModel);

function build(candidate: unknown, brief: string) {
  let registered: Rec | null = null;
  const fn = vi.fn(async () => ({ text: JSON.stringify(candidate) })) as unknown as CallStructuredModel;
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { registered = (body as { graph: Rec }).graph; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  return buildModelFromBrief('99999999-9999-4999-8999-999999999999', brief, dispatch, fn).then((r) => ({ r: r as Rec, g: registered as unknown as Rec }));
}
const quotes = (g: Rec) => Object.fromEntries((g.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => [n.label, n.source_quote ?? null]));

describe('Canvas\'s cloud-bill brief, real build: each listed option is saved with its list item', () => {
  it('PRECONDITION: the strict schema asks for the words (required, nullable)', () => {
    const item = (buildCandidateSchema() as Rec).properties.options.items;
    expect(item.required).toContain('brief_words');
    expect(item.properties.brief_words.anyOf).toEqual([{ type: 'string' }, { type: 'null' }]);
  });
  it('1 — the three options carry the exact list items; the Run\'s reader then binds all three (status quo aside) and would say a real omission', async () => {
    const { r, g } = await build(withWords(FX.candidate, WORDS), FX.brief);
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    expect(quotes(g)).toMatchObject({
      'Reserved instances': 'move steady workloads to reserved instances',
      'Spot instances': 'shift batch jobs to spot instances',
      'Enterprise discount': 'renegotiate our enterprise discount with the provider',
    });
    // The quote survives the snapshot parse the Run reads (NodeV3 strips undeclared keys; `source_quote` is declared).
    const snap = (GraphV3.safeParse(g) as { success: true; data: Rec }).data;
    expect(quotes(snap)).toEqual(quotes(g));
    const userOnly = { ...g, nodes: (g.nodes as Rec[]).filter((n) => n.kind !== 'option' || n.source_quote !== undefined) };
    expect(deriveIntakeOptionReconciliation(FX.brief, userOnly, userOnly).state).toBe('reconciled');
    // A TRUE omission (AIQ 5887822471; DL 5888280088): Spot is a declared, quoted option on the registered graph (the third
    // argument, the Run's same-snapshot source) that the analysed set (second argument) left out, e.g. gated out.
    const twoOfThree = { ...userOnly, nodes: (userOnly.nodes as Rec[]).filter((n) => n.label !== 'Spot instances') };
    expect(deriveIntakeOptionReconciliation(FX.brief, twoOfThree, userOnly).state).toBe('options_missing');
  });
  it('1b — CONTROL: the same draft without words saves no quote (today\'s served shape, `identity_unverified`)', async () => {
    const { g } = await build(withWords(FX.candidate, {}), FX.brief);
    expect(Object.values(quotes(g)).every((q) => q === null)).toBe(true);
    expect(deriveIntakeOptionReconciliation(FX.brief, g, g).state).toBe('identity_unverified');
  });
});

describe('the binding rule (pure)', () => {
  const c = (words: Record<string, string | null>) => withWords(FX.candidate, words);
  it('2 — words inside one item bind to the WHOLE item; words holding one item bind too', () => {
    expect(optionQuotes(c({ 'Reserved instances': 'reserved instances' }), FX.brief).get('reserved instances')).toBe('move steady workloads to reserved instances');
    expect(optionQuotes(c({ 'Enterprise discount': 'or renegotiate our enterprise discount with the provider' }), FX.brief).get('enterprise discount'))
      .toBe('renegotiate our enterprise discount with the provider');
  });
  it('3 — a LABEL is never evidence: no words, no quote, even when the label is an item\'s exact text', () => {
    const named = { ...FX.candidate, options: [...FX.candidate.options, { label: 'shift batch jobs to spot instances', provenance: 'explicit', changes: [], interventions: [], is_status_quo: null, brief_words: null }] } as unknown as CandidateModel;
    expect(optionQuotes(named, FX.brief).size).toBe(0);
  });
  it('4 — words written twice in the brief, words not in the brief, and words straddling two items bind nothing', () => {
    const twice = `${FX.brief} We use spot instances already.`;
    expect(optionQuotes(c({ 'Spot instances': 'spot instances' }), twice).size).toBe(0);
    expect(optionQuotes(c({ 'Spot instances': 'move batch to spot' }), FX.brief).size).toBe(0);
    expect(optionQuotes(c({ 'Spot instances': 'reserved instances, shift batch jobs' }), FX.brief).size).toBe(0);
  });
  it('5 — two options claiming one item: neither binds (the other options still do)', () => {
    const q = optionQuotes(c({ ...WORDS, 'Spot instances': 'reserved instances' }), FX.brief);
    expect(q.has('reserved instances')).toBe(false);
    expect(q.has('spot instances')).toBe(false);
    expect(q.get('enterprise discount')).toBe('renegotiate our enterprise discount with the provider');
  });
  it('6 — a brief that lists fewer than two options: nothing is quoted and the same nodes come back', () => {
    const nodes = [{ id: 'o', kind: 'option', label: 'Reserved instances' }];
    expect(quoteListedOptions(nodes, c(WORDS), 'Should we move steady workloads to reserved instances?')).toBe(nodes);
  });
  it('7 — AIQ\'s fragment brief (support): only the real option inside an item binds; the fragments bind nothing, and the reader stays `identity_unverified`', () => {
    const brief = 'Our support headcount is 24 people and our support budget is £1.9m a year. We must not let support headcount fall below 18 under any circumstances. We are choosing between three cost programmes: (A) automate tier-1 triage, saving £320k a year and removing 5 support roles; (B) offshore 40% of tier-2, saving £510k and removing 9 roles; (C) reduce SLA from 4 hours to 8 hours, saving £180k and removing 2 roles. Our customer satisfaction is 4.2 out of 5 today and drops 0.3 for every hour added to SLA. Which should we do?';
    const cand = { options: [
      { label: 'Automate tier-1 triage', provenance: 'explicit', brief_words: 'automate tier-1 triage' },
      { label: 'Offshore tier-2', provenance: 'explicit', brief_words: 'offshore 40% of tier-2' },
      { label: 'Reduce SLA', provenance: 'explicit', brief_words: 'reduce SLA from 4 hours to 8 hours' },
    ] } as unknown as CandidateModel;
    const q = optionQuotes(cand, brief);
    expect([...q.keys()]).toEqual(['automate tier-1 triage']);
    const nodes = cand.options.map((o, i) => ({ id: `o${i}`, kind: 'option', label: o.label }));
    const g = { nodes: quoteListedOptions(nodes, cand, brief), edges: [] };
    expect(deriveIntakeOptionReconciliation(brief, g, g).state).toBe('identity_unverified');
  });
  it('8 — an option the drafter tagged ai_proposed but whose words bind a list item is the user\'s: it is never marked Olumi\'s', () => {
    // A label the brief does not contain, so only the copied words can tell it is the user's.
    const cand = c({ 'Spot instances': 'shift batch jobs to spot instances' }) as Rec;
    cand.options = cand.options.map((o: Rec) => (o.label === 'Spot instances' ? { ...o, label: 'Batch on spot', provenance: 'ai_proposed', interventions: [{ factor_label: 'Spot instance share', value: 30, value_kind: 'absolute', unit: '%', provenance: 'ai_proposed' }] } : o));
    const nodes = [{ id: 's', kind: 'option', label: 'Batch on spot' }];
    expect((markOlumiOptions(nodes, cand as CandidateModel, FX.brief)[0] as Rec).proposed_by).toBe('olumi');
    const quoted = quoteListedOptions(nodes, cand as CandidateModel, FX.brief);
    expect((quoted[0] as Rec).source_quote).toBe('shift batch jobs to spot instances');
    expect((markOlumiOptions(quoted, cand as CandidateModel, FX.brief)[0] as Rec).proposed_by).toBeUndefined();
  });
  it('9 — a node that already carries a quote keeps it', () => {
    const nodes = [{ id: 'r', kind: 'option', label: 'Reserved instances', source_quote: 'earlier words' }];
    expect(quoteListedOptions(nodes, c(WORDS), FX.brief)).toBe(nodes);
  });
});

// ⛔ PR Review CHANGES_REQUIRED on #2299 @ 9d85b017 (AIQ 5892228477: a quote proves the WORDS, not the figure). An Olumi
// option that SUBSTITUTES a different figure while copying a unique list item's words must not take the user's quote:
// it would lose `proposed_by: 'olumi'` and let the Run name it as the user's listed choice.
const SUB = 'Should we raise our Pro plan price? The options are raise Pro price to £59, or keep it at £49. '
  + 'We have 1,500 paying subscribers and £75k MRR, and we want MRR above £85k.';
function priceDraft(first: { label: string; provenance: string; value: number; words: string }): Rec {
  const iv = (value: number, provenance: string) => [{ factor_label: 'Pro plan price', value, value_kind: 'absolute', unit: 'GBP per month', provenance }];
  return {
    goal: { metric: 'MRR', operator: '>', target_stated: true, frame: 'level', value: 85000, unit: 'GBP per month', horizon_months: null, provenance: 'explicit',
      baseline_known: true, baseline_value: 75000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: first.label, provenance: first.provenance, is_status_quo: null, brief_words: first.words, changes: ['Pro plan price'], interventions: iv(first.value, first.provenance) },
      { label: 'Keep at £49', provenance: 'explicit', is_status_quo: true, brief_words: 'keep it at £49', changes: ['Pro plan price'], interventions: iv(49, 'explicit') },
    ],
    factors: [{ label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP per month', provenance: 'explicit', plausible_max: 200 }],
    risks: [], outcomes: [],
    links: [{ from: 'Pro plan price', to: 'MRR', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null }],
    identities: [], unknowns: [], decision_question: 'Should we raise our Pro plan price?',
  };
}
const optionNode = (g: Rec, label: string): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'option' && n.label === label)!;

describe('a copied quote never covers a different figure (PR Review CR on 9d85b017)', () => {
  it('PRECONDITION: the Run\'s own reader lists the two items; both drafts pass the strict schema', () => {
    expect(extractEnumeratedOptions(SUB).map((c) => c.text)).toEqual(['raise Pro price to £59', 'keep it at £49']);
    const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());
    expect(strict(priceDraft({ label: 'Raise to £54', provenance: 'ai_proposed', value: 54, words: 'raise Pro price to £59' })), JSON.stringify(strict.errors?.slice(0, 2))).toBe(true);
  });
  it('10 — RED (real build + the Run\'s reader): Olumi\'s £54 copying "raise Pro price to £59" gets no quote, and the Run withholds', async () => {
    const { r, g } = await build(priceDraft({ label: 'Raise to £54', provenance: 'ai_proposed', value: 54, words: 'raise Pro price to £59' }), SUB);
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    expect(optionNode(g, 'Raise to £54').source_quote).toBeUndefined();
    expect(optionNode(g, 'Raise to £54').proposed_by).toBe('olumi');
    expect(optionNode(g, 'Keep at £49').source_quote).toBe('keep it at £49');
    expect(deriveIntakeOptionReconciliation(SUB, g, g).state).not.toBe('reconciled');
  });
  it('10b — CONTROL (matching action): the user\'s £59 with those words is quoted and the Run reconciles', async () => {
    const { r, g } = await build(priceDraft({ label: 'Raise to £59', provenance: 'explicit', value: 59, words: 'raise Pro price to £59' }), SUB);
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    expect(optionNode(g, 'Raise to £59').source_quote).toBe('raise Pro price to £59');
    expect(optionNode(g, 'Raise to £59').proposed_by).toBeUndefined();
    expect(deriveIntakeOptionReconciliation(SUB, g, g).state).toBe('reconciled');
  });
  it('10c — the drafter\'s tag decides nothing: a £54 tagged explicit with the £59 words is not quoted either', () => {
    const cand = priceDraft({ label: 'Raise to £54', provenance: 'explicit', value: 54, words: 'raise Pro price to £59' }) as unknown as CandidateModel;
    expect([...optionQuotes(cand, SUB).keys()]).toEqual([canonicalLabel('Keep at £49')]);
  });
  // ⛔ PR Review CHANGES_REQUIRED on #2299 @ fcf35a8b: ONE listed item writing TWO money figures. "£54" in the item is
  // the setup credit, not the price, so Olumi's £54 price must not borrow the item's words through it.
  const TWO = 'Should we raise our Pro plan price? The options are raise Pro price to £59 with a £54 setup credit, or keep it at £49. '
    + 'We have 1,500 paying subscribers and £75k MRR, and we want MRR above £85k.';
  const TWO_WORDS = 'raise Pro price to £59 with a £54 setup credit';
  it('11 — PRECONDITION: the Run\'s own reader lists the two-money item as ONE option item', () => {
    expect(extractEnumeratedOptions(TWO).map((c) => c.text)).toEqual([TWO_WORDS, 'keep it at £49']);
  });
  it('11 — RED (real build + the Run\'s reader): Olumi\'s £54 price copying the two-money item gets no quote, and the Run withholds', async () => {
    const { r, g } = await build(priceDraft({ label: 'Raise to £54', provenance: 'ai_proposed', value: 54, words: TWO_WORDS }), TWO);
    expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
    expect(optionNode(g, 'Raise to £54').source_quote).toBeUndefined();
    expect(optionNode(g, 'Keep at £49').source_quote).toBe('keep it at £49');
    expect(deriveIntakeOptionReconciliation(TWO, g, g).state).not.toBe('reconciled');
  });
  it('11 — NAMED RESIDUAL (#2295\'s marker, not this quote): the £54 SETUP CREDIT reads as the user\'s Pro-price level to `olumiAddedOptionLabels`, so the £54 option is not marked Olumi\'s — no quote and no leader either way', async () => {
    const { g } = await build(priceDraft({ label: 'Raise to £54', provenance: 'ai_proposed', value: 54, words: TWO_WORDS }), TWO);
    expect(optionNode(g, 'Raise to £54').proposed_by).toBeUndefined();
  });
  it('11b — CONTROL (matching action on the two-money item): the user\'s £59, the figure after "to", is quoted and the Run reconciles', async () => {
    const { g } = await build(priceDraft({ label: 'Raise to £59', provenance: 'explicit', value: 59, words: TWO_WORDS }), TWO);
    expect(optionNode(g, 'Raise to £59').source_quote).toBe(TWO_WORDS);
    expect(deriveIntakeOptionReconciliation(TWO, g, g).state).toBe('reconciled');
  });
  // The phrase classes a two-money item takes (enumerated for the first review, PR Review CR on fcf35a8b).
  it.each<[string, string, number, boolean]>([
    ['"from £49 to £59": the new price', 'raise Pro price from £49 to £59', 59, true],
    ['"from £49 to £59": the OLD price is not the option\'s', 'raise Pro price from £49 to £59', 49, false],
    ['"to £59 with a £54 setup credit": the credit is not the price', TWO_WORDS, 54, false],
    ['no "to" figure ("a £59 price with a £54 credit")', 'a £59 Pro price with a £54 setup credit', 59, false],
    ['two "to" figures ("to £59 then to £64 next year")', 'raise Pro price to £59 then to £64 next year', 59, false],
    ['a delta the option types ("by £10 to £59", value 10): the named under-claim', 'raise Pro price by £10 to £59', 10, false],
  ])('figure binding on a two-money item: %s', (_why, item, value, quoted) => {
    const brief = `Should we raise our Pro plan price? The options are ${item}, or keep it at £49.`;
    expect(extractEnumeratedOptions(brief).map((c) => c.text), 'PRECONDITION: the Run\'s reader lists the item').toEqual([item, 'keep it at £49']);
    const cand = priceDraft({ label: `Raise to £${value}`, provenance: 'explicit', value, words: item }) as unknown as CandidateModel;
    expect([...optionQuotes(cand, brief).keys()].includes(canonicalLabel(`Raise to £${value}`))).toBe(quoted);
  });
  it('11c — CONTROL: the single-money item still quotes the user\'s £59 and the Run reconciles (row 10b is unchanged)', async () => {
    const { g } = await build(priceDraft({ label: 'Raise to £59', provenance: 'explicit', value: 59, words: 'raise Pro price to £59' }), SUB);
    expect(optionNode(g, 'Raise to £59').source_quote).toBe('raise Pro price to £59');
    expect(deriveIntakeOptionReconciliation(SUB, g, g).state).toBe('reconciled');
  });
});
