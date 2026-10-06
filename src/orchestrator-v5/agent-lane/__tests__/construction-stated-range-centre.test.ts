/**
 * ⭐ THE RANGE THE USER WROTE AROUND THEIR FIGURE IS CARRIED WITH IT (Science d5 #87 6009282279; a8's shape ruling).
 *
 * Served T1b carried no `stated_range` on any edge: "between 1 and 4" sat only in a quote, and the 150 link had none, so
 * a8's Run-input hold (#2643: existence 1.0, sd from the user's own range) changed nothing on T1b. The bound sentence's
 * "about A, between L and H" is now carried as `{ low, high, text, end: 'centre' }`, the amount kept as the user's point.
 * Bound by edge endpoints, through the real construction door (`/graph/register`) and the stored edge's reload (`EdgeV3`).
 */
import { describe, it, expect } from 'vitest';
import { Ajv } from 'ajv';
import { buildCandidateSchema, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { EdgeV3 } from '../../../schemas/cee-v3.js';
import { sizeLink, type MagnitudeNode } from '../../../cee/magnitude/link-effect.js';
import { centreRangeAt } from '../stated-size-binding.js';
import { deriveNotModelledManifest } from '../../../cee/context-integrity/not-modelled-manifest.js';

const LOSES = 'Each 1% price rise loses about 2 customers, between 1 and 4.';
const WIN = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
const T1B = 'We are a B2B software company with £120,000 monthly recurring revenue from 400 customers paying £300 a month. '
  + 'Decision: raise prices by 10%, launch a starter tier at £49 a month, or keep pricing as it is. Goal: reach at least '
  + '£126,000 monthly recurring revenue within 9 months. Facts: each 1% price rise adds £1,200 a month to monthly recurring '
  + `revenue before churn. ${LOSES} Each lost customer removes £300 a `
  + `month of monthly recurring revenue. ${WIN} Each `
  + 'starter subscriber adds £49 a month to monthly recurring revenue. Each starter subscriber costs about £6 a month in '
  + 'support. Keeping pricing as it is adds nothing.';
const strict = new Ajv({ strict: false }).compile(buildCandidateSchema());

type Dir = 'positive' | 'negative';
const sized = (from: string, to: string, direction: Dir, amount: number | null, per: number | null, provenance = 'explicit') =>
  ({ from, to, direction, provenance, effect_amount: amount, effect_per_source_change: per, effect_provenance: amount === null ? null : provenance });
const set = (factor_label: string, value: number, unit: string, provenance = 'explicit') => ({ factor_label, value, value_kind: 'absolute', unit, provenance });

/** The R17-style T1b draft: a per-unit link and a switch link, each sized from a sentence that writes a range around it. */
function t1b(over: { lost?: number } = {}): Record<string, unknown> {
  return {
    goal: { metric: 'monthly recurring revenue', operator: '>=', target_stated: true, frame: 'level', value: 126000, unit: 'GBP per month', horizon_months: 9,
      provenance: 'explicit', baseline_known: true, baseline_value: 120000, baseline_provenance: 'explicit', scope: null },
    constraints: [],
    options: [
      { label: 'Raise prices by 10%', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Price rise', 10, '%')] },
      { label: 'Launch starter tier', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('Starter tier launched', 1, '', 'ai_proposed')] },
      { label: 'Keep pricing as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
    ],
    factors: [
      { label: 'Price rise', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
      { label: 'Starter tier launched', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '', provenance: 'ai_proposed', plausible_max: 1 },
    ],
    risks: [],
    outcomes: [
      { label: 'Customers lost from price rise', provenance: 'inferred', unit: 'customers', plausible_max: 1000 },
      { label: 'Starter subscribers', provenance: 'inferred', unit: 'subscribers', plausible_max: 1000 },
    ],
    links: [
      sized('Price rise', 'monthly recurring revenue', 'positive', 1200, 1),
      sized('Price rise', 'Customers lost from price rise', 'positive', over.lost ?? 2, 1),
      sized('Customers lost from price rise', 'monthly recurring revenue', 'negative', -300, 1),
      sized('Starter tier launched', 'Starter subscribers', 'positive', 150, 1),
      sized('Starter subscribers', 'monthly recurring revenue', 'positive', 49, 1),
    ],
    identities: [],
    unknowns: [],
    decision_question: null,
  };
}

type Rec = Record<string, any>;
async function build(wire: Record<string, unknown>, brief = T1B): Promise<{ edge: (from: string, to: string) => Rec; said: string[]; graph: Rec }> {
  expect(strict(wire), JSON.stringify(strict.errors)).toBe(true);
  let registered: { nodes: Rec[]; edges: Rec[] } | null = null;
  const call = (async () => ({ text: JSON.stringify(wire) })) as unknown as CallStructuredModel;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: { nodes: Rec[]; edges: Rec[] } }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('b63d8672-0000-4000-8000-0000000b63d8', brief, dispatch, call) as Rec;
  expect(out.ok, JSON.stringify(out)).toBe(true);
  const g = registered!;
  const idOf = (l: string) => g.nodes.find((n) => n.label === l)!.id;
  // The stored edge, as a reload reads it back (`EdgeV3`: a malformed range is `.catch`-dropped there).
  const edge = (from: string, to: string): Rec => EdgeV3.parse(g.edges.find((e) => e.from === idOf(from) && e.to === idOf(to))!) as Rec;
  return { edge, said: [...(out.not_represented ?? []), ...(out.open_questions ?? [])], graph: g as unknown as Rec };
}

describe('the range the user wrote around their figure is carried with it', () => {
  it('RED (R17-style T1b, d5 row): BOTH ranged links carry their range as a centre, the amount kept as the user\'s point', async () => {
    const { edge } = await build(t1b());
    const lost = edge('Price rise', 'Customers lost from price rise').provenance;
    expect(lost).toMatchObject({ magnitude: 'user_stated', source_quote: LOSES });
    expect(lost.natural_effect).toMatchObject({ amount: 2, stated_range: { low: 1, high: 4, text: 'between 1 and 4', end: 'centre' } });
    const won = edge('Starter tier launched', 'Starter subscribers').provenance;
    expect(won).toMatchObject({ magnitude: 'user_stated', source_quote: WIN });
    expect(won.natural_effect).toMatchObject({ amount: 150, stated_range: { low: 80, high: 250, text: 'between 80 and 250', end: 'centre' } });
  });

  it('RED (what a8\'s hold reads): low < amount < high, both one side of zero, beside the β the size was written for', async () => {
    const { edge } = await build(t1b());
    for (const [from, to] of [['Price rise', 'Customers lost from price rise'], ['Starter tier launched', 'Starter subscribers']] as const) {
      const ne = edge(from, to).provenance.natural_effect;
      expect(ne.stated_range.low).toBeLessThan(ne.amount);
      expect(ne.amount).toBeLessThan(ne.stated_range.high);
      expect(ne.stated_range.low).toBeGreaterThan(0);
      expect(Number.isFinite(ne.strength_mean) && ne.strength_mean !== 0).toBe(true);
    }
  });

  it('CONTROL (Science mutant: default spread): a sentence that writes NO range carries none — never a ±k around the point', async () => {
    const { edge } = await build(t1b(), T1B.replace(LOSES, 'Each 1% price rise loses about 2 customers.'));
    const lost = edge('Price rise', 'Customers lost from price rise').provenance;
    expect(lost).toMatchObject({ magnitude: 'user_stated', source_quote: 'Each 1% price rise loses about 2 customers.' });
    expect(lost.natural_effect.stated_range).toBeUndefined();
  });

  it('CONTROL: a range that does not hold the figure ("about 5, between 1 and 4") is not carried as its centre', async () => {
    const said = 'Each 1% price rise loses about 5 customers, between 1 and 4.';
    const { edge } = await build(t1b({ lost: 5 }), T1B.replace(LOSES, said));
    expect(edge('Price rise', 'Customers lost from price rise').provenance.natural_effect?.stated_range).toBeUndefined();
  });

  it('CONTROL (Codex r1 F3): a TIME interval after the figure ("between 1 and 4 months after launch") is never the size\'s range', async () => {
    const said = 'Each 1% price rise loses about 2 customers, between 1 and 4 months after launch.';
    const { edge } = await build(t1b(), T1B.replace(LOSES, said));
    const lost = edge('Price rise', 'Customers lost from price rise').provenance;
    expect(lost).toMatchObject({ magnitude: 'user_stated', source_quote: said });
    expect(lost.natural_effect.stated_range).toBeUndefined();
  });

  it('CONTROL (Codex r2 F3): "between 1 and 4 CALENDAR months after launch" is a time too — never the size\'s range', async () => {
    const said = 'Each 1% price rise loses about 2 customers, between 1 and 4 calendar months after launch.';
    const { edge } = await build(t1b(), T1B.replace(LOSES, said));
    const lost = edge('Price rise', 'Customers lost from price rise').provenance;
    expect(lost).toMatchObject({ magnitude: 'user_stated', source_quote: said });
    expect(lost.natural_effect.stated_range).toBeUndefined();
  });

  it('RED (Codex r1 F7): the not-modelled manifest credits a switch\'s quoted figure ("The AI release reduces Support cost by £150 a month")', async () => {
    const SAID_150 = 'The AI release reduces Support cost by £150 a month.';
    const brief = 'We are deciding whether to release an AI assistant for customer support. Support cost is £5,000 a month today. '
      + `${SAID_150} Goal: get Support cost below £4,900 a month within 6 months.`;
    const wire = {
      goal: { metric: 'Support cost', operator: '<', target_stated: true, frame: 'level', value: 4900, unit: 'GBP per month', horizon_months: 6,
        provenance: 'explicit', baseline_known: true, baseline_value: 5000, baseline_provenance: 'explicit', scope: null },
      constraints: [],
      options: [
        { label: 'Release the AI assistant', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [set('AI release', 1, '', 'ai_proposed')] },
        { label: 'Keep support as it is', provenance: 'explicit', is_status_quo: true, changes: [], interventions: [] },
      ],
      factors: [{ label: 'AI release', role: 'controllable', baseline_known: true, baseline_value: 0, unit: '', provenance: 'ai_proposed', plausible_max: 1 }],
      risks: [], outcomes: [],
      links: [sized('AI release', 'Support cost', 'negative', -150, 1)],
      identities: [], unknowns: [], decision_question: null,
    };
    const { edge, graph } = await build(wire, brief);
    expect(edge('AI release', 'Support cost').provenance).toMatchObject({ magnitude: 'user_stated', source_quote: SAID_150 });
    const at = brief.indexOf('£150');
    const item = (deriveNotModelledManifest(brief, graph).quantities?.items ?? []).find((i) => i.char_offset === at);
    expect(item?.literal).toBe('£150');
    expect(item?.verdict).toBe('in_model');
  });

  it('CONTROL: a centre is no bound — no "end of your range" sentence is said for it (A4\'s floor/ceiling words are ends only)', async () => {
    const { said } = await build(t1b());
    expect(said.filter((s) => /end of your/u.test(s))).toEqual([]);
  });
});

describe('centreRangeAt reads only the range written after the figure, around it', () => {
  const at = (s: string, figure: string) => ({ end: s.indexOf(figure) + figure.length });
  it('RED: "about 150 new subscribers, between 80 and 250"', () => {
    expect(centreRangeAt(WIN, at(WIN, '150'), 150, 'subscribers')).toEqual({ low: 80, high: 250, text: 'between 80 and 250', end: 'centre' });
  });
  it('CONTROL: another figure between the size and the range', () => {
    const s = 'Each 1% price rise loses about 2 of our 400 customers, between 1 and 4.';
    expect(centreRangeAt(s, at(s, '2'), 2, 'customers')).toBeUndefined();
  });
  it('CONTROL: a range written BEFORE the figure', () => {
    const s = 'Between 1 and 4 customers go: each 1% price rise loses about 2.';
    expect(centreRangeAt(s, at(s, 'about 2'), 2, 'customers')).toBeUndefined();
  });
  it('CONTROL: an end is A4\'s, never a centre ("about 1, between 1 and 4")', () => {
    const s = 'Each 1% price rise loses about 1 customer, between 1 and 4.';
    expect(centreRangeAt(s, at(s, 'about 1'), 1, 'customers')).toBeUndefined();
  });
  it('CONTROL: pounds around a figure that is not money', () => {
    const s = 'Each 1% price rise loses about 2 customers, between £1 and £4.';
    expect(centreRangeAt(s, at(s, '2'), 2, 'customers')).toBeUndefined();
  });
});

describe('a8\'s wording for a centre (link-effect A4 `who`)', () => {
  const node = (label: string, over: Partial<MagnitudeNode> = {}): MagnitudeNode =>
    ({ label, kind: 'factor', scale_frame: undefined, observed_state: undefined, goal_threshold_cap: undefined, goal_threshold_unit: undefined, unit: null, option_levels: [], ...over }) as MagnitudeNode;
  it('RED: a size the frames cannot hold is asked about as "You said about 150 (80 to 250): …"', () => {
    const source = node('Starter tier launched', { scale_frame: 1, unit: '', option_levels: [0, 1] });
    const target = node('Starter subscribers', { kind: 'outcome', scale_frame: 100, unit: 'subscribers' });
    const sizedLink = sizeLink({ direction: 'positive', effect_amount: 150, effect_per_source_change: 1, user_stated: true,
      stated_range: { low: 80, high: 250, text: 'between 80 and 250', end: 'centre' } }, source, target);
    expect(sizedLink.question).toMatch(/^You said about 150 \(80 to 250\): /u);
    expect(sizedLink.range_words).toBeUndefined();
    expect(sizedLink.natural_effect?.stated_range).toEqual({ low: 80, high: 250, text: 'between 80 and 250', end: 'centre' });
  });
});
