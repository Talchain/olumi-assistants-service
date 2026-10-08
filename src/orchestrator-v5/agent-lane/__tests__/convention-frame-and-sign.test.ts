/**
 * ⭐ SCIENCE §(s) + §(u) + §(v) (goals rulings, 8 Oct 2026; DL "B", Science accepted): OLUMI'S CONVENTION FRAME, RESCUE-
 * ONLY, AND THE SIGN OF AN OLUMI-DRAFTED SIZE.
 *
 * Measured (P44 mechanism arm, 8 Oct, 9 drafts at CEE 23349562): the drafter drew the price downside as a sized mechanism
 * (price → churn pp → subscribers), and admission set every new size aside. Two causes, neither the drafter's figure:
 *  · the FRAME: a price framed 0–£200 reads 0.15 pp churn per £1 as β = 2 against a 15 pp churn frame (`not_representable`);
 *    churn framed 0–100 pp reads −24 subscribers per pp as β = −1.2 against 2,000 subscribers;
 *  · the SIGN: the drafter wrote +3 / +2.5 / +10,368 on links it drew as negative (`sign_conflict`), 4 links in 4 drafts.
 *
 * RESCUE-ONLY: the convention's deterministic frame replaces the drafter's own guess ONLY where that makes a sized link
 * representable, and only if no link representable today stops being so. Every other draft is byte-identical.
 * Precedence: a USER ceiling > the convention > the drafter's plausible_max. Rows are Science's own where it gave them.
 */
import { describe, it, expect } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema } from '../runtime/build-model.js';
import { rescueConventionFrames } from '../convention-frame.js';

type Factor = { label: string; unit: string; level: number | null; max: number; known?: boolean; provenance?: string };
type Link = { from: string; to: string; direction: 'positive' | 'negative'; amount: number | null; per?: number | null; prov?: string | null };

const GOAL = { metric: 'Monthly recurring revenue', operator: '>=', value: 120000, unit: '£/month', horizon_months: 12, provenance: 'explicit' };

function candidate(factors: Factor[], links: Link[], options?: unknown[], constraints: unknown[] = []): CandidateModel {
  return {
    goal: GOAL,
    constraints, risks: [], outcomes: [], unknowns: [],
    options: options ?? [
      { label: 'Raise the price', provenance: 'explicit', interventions: [{ factor_label: factors[0]!.label, value: (factors[0]!.level ?? 1) * 1.2, unit: factors[0]!.unit, provenance: 'explicit' }] },
      { label: 'Keep as it is', provenance: 'explicit', interventions: [] },
    ],
    factors: factors.map((f) => ({
      label: f.label, role: 'controllable', baseline_known: f.known ?? f.level !== null, baseline_value: f.level,
      unit: f.unit, plausible_max: f.max, provenance: f.provenance ?? 'explicit',
    })),
    links: links.map((l) => ({
      from: l.from, to: l.to, direction: l.direction, provenance: 'ai_proposed',
      effect_amount: l.amount, effect_per_source_change: l.amount === null ? null : (l.per ?? 1),
      effect_provenance: l.amount === null ? null : (l.prov ?? 'ai_proposed'), definitional: null,
    })),
  } as unknown as CandidateModel;
}

const admit = (c: CandidateModel, brief = 'A pricing decision.') => admitCandidateModel(c, {}, brief);
type AnyNode = { id: string; label?: string; kind?: string; observed_state?: { cap?: number; raw_value?: number; value?: number }; scale_frame?: number };
type AnyEdge = { from: string; to: string; strength: { mean: number }; provenance?: { magnitude?: string; natural_effect?: { amount?: number } } };
const nodeOf = (a: ReturnType<typeof admit>, label: string) => (a.nodes as unknown as AnyNode[]).find((n) => n.label === label)!;
const frameOf = (a: ReturnType<typeof admit>, label: string) => { const n = nodeOf(a, label); return n.observed_state?.cap ?? n.scale_frame; };
const edgeOf = (a: ReturnType<typeof admit>, from: string, to: string) => {
  const f = nodeOf(a, from).id; const t = nodeOf(a, to).id;
  return (a.edges as unknown as AnyEdge[]).find((e) => e.from === f && e.to === t)!;
};
const lossText = (a: ReturnType<typeof admit>) => (a.loss as unknown as { field_path?: string; reason?: string }[]).map((l) => `${l.field_path} :: ${l.reason}`).join('\n');

const CHURN = (level: number | null, max = 100): Factor => ({ label: 'Monthly churn', unit: '%', level, max });
const SUBS = (level: number, max: number): Factor => ({ label: 'Pro paying subscribers', unit: 'subscribers', level, max });
const PRICE = (level: number, max = 200): Factor => ({ label: 'Pro plan price', unit: '£/month', level, max });
/** A churn → subscribers size that is NOT representable on churn 0–100 against 2,000 subscribers (β 1.2). */
const CHURN_TO_SUBS: Link = { from: 'Monthly churn', to: 'Pro paying subscribers', direction: 'negative', amount: -24 };
/** A price → churn size that is NOT representable on £0–200 against churn 0–15 (β 2). */
const PRICE_TO_CHURN: Link = { from: 'Pro plan price', to: 'Monthly churn', direction: 'positive', amount: 0.15 };

describe('§(s) a bounded RATE: min(100, max(2 × level, level + 10)) points — only where it rescues a sized link', () => {
  it('Science row: churn 3% → 0–13 pp, and −24 subscribers per pp is ADMITTED (was β −1.2, set aside); the rescue is logged by link id', () => {
    const a = admit(candidate([CHURN(3), SUBS(1300, 2000)], [CHURN_TO_SUBS]));
    expect(frameOf(a, 'Monthly churn')).toBe(13);
    expect(frameOf(a, 'Pro paying subscribers')).toBe(2000); // not needed for the rescue → untouched
    const e = edgeOf(a, 'Monthly churn', 'Pro paying subscribers');
    expect(e.provenance?.magnitude).toBe('olumi_estimate');
    expect(e.strength.mean).toBeCloseTo((-24 * 13) / 2000, 9);
    expect(e.provenance?.natural_effect?.amount).toBe(-24);
    expect(lossText(a)).toContain(`edges[${nodeOf(a, 'Monthly churn').id}::${nodeOf(a, 'Pro paying subscribers').id}].convention_frame_rescue`);
  });

  it('BYTE-IDENTICAL: the same churn with no link that needs it keeps the drafter\'s range, and nothing is said', () => {
    const a = admit(candidate([CHURN(3), SUBS(1300, 2000)], [{ ...CHURN_TO_SUBS, amount: -10 }]));
    expect(frameOf(a, 'Monthly churn')).toBe(100);
    expect(lossText(a)).not.toContain('Olumi treats');
  });

  it('Science row: NRR 110% is NOT a bounded rate → never framed by the convention', () => {
    const a = admit(candidate([{ label: 'Net revenue retention', unit: '%', level: 110, max: 200 }, SUBS(1300, 2000)],
      [{ from: 'Net revenue retention', to: 'Pro paying subscribers', direction: 'positive', amount: 24 }]));
    expect(frameOf(a, 'Net revenue retention')).toBe(200);
  });

  it('a signed rate (a price change %) is NOT framed by the convention', () => {
    const a = admit(candidate([{ label: 'Price change', unit: '%', level: 5, max: 100 }, SUBS(1300, 2000)],
      [{ from: 'Price change', to: 'Pro paying subscribers', direction: 'negative', amount: -24 }]));
    expect(frameOf(a, 'Price change')).toBe(100);
  });

  it('Science row: an option setting churn to 12% (≥ 80% of 13) WIDENS the rescue frame to 24', () => {
    const a = admit(candidate([CHURN(3), SUBS(1300, 2000)], [CHURN_TO_SUBS], [
      { label: 'Discount', provenance: 'explicit', interventions: [{ factor_label: 'Monthly churn', value: 12, unit: '%', provenance: 'explicit' }] },
      { label: 'Hold', provenance: 'explicit', interventions: [] },
    ]));
    expect(frameOf(a, 'Monthly churn')).toBe(24);
  });

  it('Science mutant row (NEVER CLIPS, on a rescued factor): an option above the formula\'s 13 is carried exactly, raw 15 at 15 ÷ 30', () => {
    const a = admit(candidate([CHURN(3), SUBS(1300, 2000)], [CHURN_TO_SUBS], [
      { label: 'Discount', provenance: 'explicit', interventions: [{ factor_label: 'Monthly churn', value: 15, unit: '%', provenance: 'explicit' }] },
      { label: 'Hold', provenance: 'explicit', interventions: [] },
    ]));
    expect(frameOf(a, 'Monthly churn')).toBe(30);
    const set = (nodeOf(a, 'Discount') as unknown as { interventions: Record<string, { raw_value?: number; value?: number }> }).interventions[nodeOf(a, 'Monthly churn').id];
    expect(set).toMatchObject({ raw_value: 15, value: 0.5 });
  });

  it('#2842 review P1-6: a rate the USER constrained keeps today\'s frame (its limit stays checkable on the percent rung)', () => {
    const a = admit(candidate([CHURN(3), SUBS(1300, 2000)], [CHURN_TO_SUBS], undefined,
      [{ metric: 'Monthly churn', operator: '<', value: 8, unit: '%', provenance: 'explicit' }]));
    expect(frameOf(a, 'Monthly churn')).toBe(100);
  });

  it('Science §(v)(1): an Olumi-ESTIMATED level is framed too — B1\'s churn 5.5% (Olumi\'s) → 15.5 pp; the level stays Olumi\'s', () => {
    const a = admit(candidate([{ label: 'Monthly churn', unit: '%', level: 5.5, max: 100, known: false, provenance: 'ai_proposed' }, SUBS(1300, 2000)], [CHURN_TO_SUBS]));
    expect(frameOf(a, 'Monthly churn')).toBe(15.5);
    expect(JSON.stringify(nodeOf(a, 'Monthly churn').observed_state)).toMatch(/"source":"cee_inference"/);
  });
});

describe('§(u)(a) a NON-NEGATIVE level: 0 to 2 × its level — only where it rescues a sized link', () => {
  it('Science row: price £49 → £98; option £59 (60%) does not widen; 0.15 pp per £1 into churn 5% (0–15) → β 0.98, ADMITTED', () => {
    const a = admit(candidate([PRICE(49), CHURN(5, 15)], [PRICE_TO_CHURN], [
      { label: 'Raise to £59', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 59, unit: '£/month', provenance: 'explicit' }] },
      { label: 'Hold £49', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 49, unit: '£/month', provenance: 'explicit' }] },
    ]));
    expect(frameOf(a, 'Pro plan price')).toBe(98);
    expect(frameOf(a, 'Monthly churn')).toBe(15);
    const e = edgeOf(a, 'Pro plan price', 'Monthly churn');
    expect(e.provenance?.magnitude).toBe('olumi_estimate');
    expect(e.strength.mean).toBeCloseTo(0.98, 6);
  });

  it('a QUALIFIED money-per-unit ("£/Pro subscriber/month", as the drafter wrote it in 2 of 3 arm draws) is a price too', () => {
    const a = admit(candidate([{ label: 'Pro plan price', unit: '£/Pro subscriber/month', level: 49, max: 200 }, CHURN(5, 15)], [PRICE_TO_CHURN]));
    expect(frameOf(a, 'Pro plan price')).toBe(98);
    // CONTROL: a unit whose head is not money stays excluded (the drafter's range stays, the link stays set aside).
    const b = admit(candidate([{ label: 'Pro plan price', unit: 'points/Pro subscriber/month', level: 49, max: 200 }, CHURN(5, 15)], [PRICE_TO_CHURN]));
    expect(frameOf(b, 'Pro plan price')).toBe(200);
  });

  it('DISCLOSED as Olumi\'s frame, once per re-framed factor, in the construction ledger', () => {
    const a = admit(candidate([PRICE(49), CHURN(5, 15), { label: 'Trial conversion', unit: '%', level: 3, max: 100 }, SUBS(1300, 2000)],
      [PRICE_TO_CHURN, { from: 'Trial conversion', to: 'Pro paying subscribers', direction: 'positive', amount: 24 }]));
    const text = lossText(a);
    expect(text).toContain('Olumi treats ‘Pro plan price’ as between £0 and £98 a month');
    expect(text).toContain('Olumi treats ‘Trial conversion’ as between 0% and 13%');
    expect(text.match(/Olumi treats ‘Pro plan price’/g)?.length).toBe(1);
  });

  it('PRECEDENCE: a ceiling the USER wrote wins (the brief writes £150) — contrast: unwritten → the convention', () => {
    const user = admit(candidate([PRICE(49, 150), CHURN(5, 15)], [PRICE_TO_CHURN]), 'Our Pro plan is £49 a month and could go as high as £150.');
    expect(frameOf(user, 'Pro plan price')).toBe(150);
    const olumi = admit(candidate([PRICE(49, 150), CHURN(5, 15)], [PRICE_TO_CHURN]), 'Our Pro plan is £49 a month.');
    expect(frameOf(olumi, 'Pro plan price')).toBe(98);
  });

  it('#2842 review P1-8: a figure the brief writes as ANOTHER kind ("150 customers") is not a price ceiling', () => {
    const a = admit(candidate([PRICE(49, 150), CHURN(5, 15)], [PRICE_TO_CHURN]), 'Our Pro plan is £49 a month and we have 150 customers.');
    expect(frameOf(a, 'Pro plan price')).toBe(98);
  });

  it('a constraint the user set on a LEVEL widens the rescue frame (keep the price under £90 → 0–£180)', () => {
    const a = admit(candidate([PRICE(49), CHURN(5, 15)], [{ ...PRICE_TO_CHURN, amount: 0.08 }], undefined,
      [{ metric: 'Pro plan price', operator: '<', value: 90, unit: '£/month', provenance: 'explicit' }]));
    expect(frameOf(a, 'Pro plan price')).toBe(180);
  });

  it('#2842 review P1-4: money with no positive evidence it cannot go negative ("Operating income") is never framed', () => {
    const a = admit(candidate([{ label: 'Operating income', unit: '£/month', level: 10000, max: 1000000 }, CHURN(5, 15)],
      [{ from: 'Operating income', to: 'Monthly churn', direction: 'negative', amount: -0.0001 }]));
    expect(frameOf(a, 'Operating income')).toBe(1000000);
  });

  it('#2842 review P1-5: a ceiling of 1 or less (a £0.25 price) is not a frame the writers keep → excluded', () => {
    const a = admit(candidate([{ label: 'Wholesale price', unit: '£/item', level: 0.25, max: 5 }, CHURN(5, 15)],
      [{ from: 'Wholesale price', to: 'Monthly churn', direction: 'positive', amount: 4 }]));
    expect(frameOf(a, 'Wholesale price')).toBe(5);
  });

  it('EXCLUDED: a level of 0 and a signed level keep the drafter\'s range even where a link would need them', () => {
    const a = admit(candidate([
      PRICE(49),
      { label: 'Starter subscribers', unit: 'subscribers', level: 0, max: 5000 },
      { label: 'Net cash flow', unit: '£/month', level: 20000, max: 1000000 }, CHURN(5, 15),
    ], [{ from: 'Net cash flow', to: 'Monthly churn', direction: 'negative', amount: -0.0001 },
      { from: 'Starter subscribers', to: 'Monthly churn', direction: 'positive', amount: 0.01 }]));
    expect(frameOf(a, 'Starter subscribers')).toBe(5000);
    expect(frameOf(a, 'Net cash flow')).toBe(1000000);
  });

  it('Science §(v)(2): a FLOW ("New Pro subscribers per month") is never re-framed, so flow → stock stays unsized', () => {
    const a = admit(candidate([PRICE(49), { label: 'New Pro subscribers per month', unit: 'subscribers/month', level: 15, max: 200 }, SUBS(200, 2000)],
      [{ from: 'New Pro subscribers per month', to: 'Pro paying subscribers', direction: 'positive', amount: 12 }]));
    expect(frameOf(a, 'New Pro subscribers per month')).toBe(200);
    expect(edgeOf(a, 'New Pro subscribers per month', 'Pro paying subscribers').provenance?.magnitude).not.toBe('olumi_estimate');
    // CONTROL: the same count as a STOCK (no period) is re-framed where it rescues a link.
    const b = admit(candidate([PRICE(49), { label: 'Pro trial accounts', unit: 'accounts', level: 15, max: 200 }, SUBS(200, 2000)],
      [{ from: 'Pro trial accounts', to: 'Pro paying subscribers', direction: 'positive', amount: 12 }]));
    expect(frameOf(b, 'Pro trial accounts')).toBe(30);
  });

  it('EXCLUDED: the GOAL node is never re-framed by the convention', () => {
    const a = admit(candidate([PRICE(49), CHURN(5, 15)], [PRICE_TO_CHURN]));
    const goal = (a.nodes as unknown as AnyNode[]).find((n) => n.kind === 'goal')!;
    expect(JSON.stringify(goal)).not.toMatch(/"cap":98\b/);
    expect(lossText(a)).not.toContain('Olumi treats ‘Monthly recurring revenue’');
  });

  it('INVARIANCE (the CEE half, on a rescued factor): the natural-unit size is the same on the rescue frame and on a doubled user frame', () => {
    // churn drafted 0–29.5: β 1.017 on £0–200 (set aside); 0.498 on the rescue's £0–98; 0.997 on a doubled £0–196 — both admit.
    const rescued = admit(candidate([PRICE(49), CHURN(5, 29.5)], [PRICE_TO_CHURN]));
    const doubled = admit(candidate([PRICE(49, 196), CHURN(5, 29.5)], [PRICE_TO_CHURN]), 'Pro is £49 a month, at most £196.');
    const nat = (e: AnyEdge) => { const x = e.provenance?.natural_effect as Record<string, unknown> | undefined; return x && { amount: x.amount, amount_unit: x.amount_unit, per_source_change: x.per_source_change, per_source_change_unit: x.per_source_change_unit }; };
    const r = edgeOf(rescued, 'Pro plan price', 'Monthly churn'); const d = edgeOf(doubled, 'Pro plan price', 'Monthly churn');
    expect(frameOf(rescued, 'Pro plan price')).toBe(98);
    expect(nat(r)).toEqual(nat(d)); expect(nat(r)?.amount).toBe(0.15);
    expect(d.strength.mean / r.strength.mean).toBeCloseTo(2, 9);
  });
});

describe('NO HARM: a convention frame that would break a link representable today is never applied', () => {
  it('#2842 review P1-9 (the hiring draft): salary spend keeps 0–£2,000,000 because £100,000 per engineer fits it and would not fit 0–£300,000', () => {
    const a = admit(candidate([
      { label: 'Annual salary spend', unit: '£/year', level: 150000, max: 2000000 },
      { label: 'Senior engineers hired', unit: 'engineers', level: 2, max: 10 },
      CHURN(5, 15),
    ], [{ from: 'Senior engineers hired', to: 'Annual salary spend', direction: 'positive', amount: 100000 },
      // salary → churn is NOT representable today (β 0.00002 × 2,000,000 ÷ 15 = 2.67) and would be on salary's 0–£300,000
      // (0.4) — a rescue — but that frame would break engineers → salary (0.5 → 3.3), so harm decides: not applied.
      { from: 'Annual salary spend', to: 'Monthly churn', direction: 'positive', amount: 0.00002 }]));
    expect(frameOf(a, 'Annual salary spend')).toBe(2000000);
    expect(edgeOf(a, 'Senior engineers hired', 'Annual salary spend').provenance?.magnitude).toBe('olumi_estimate');
  });

  it('the pure rule: each end is today\'s frame or the formula\'s, never a third value; harm removes, it never adds', () => {
    const today = (x: string) => ({ a: 200, b: 15, c: 2000 } as Record<string, number>)[x];
    // a → b needs a's 98 (β 2 → 0.98); b → c is fine today (β 0.18) and with b unchanged stays fine.
    const r1 = rescueConventionFrames([{ from: 'a', to: 'b', amount: 0.15, per: 1 }, { from: 'b', to: 'c', amount: 24, per: 1 }], today, new Map([['a', 98]]));
    expect(r1.applied).toEqual(['a']);
    expect(r1.rescued).toEqual([{ from: 'a', to: 'b', reframed: ['a'], frames: { from: 98 } }]);
    // b's formula 150 would rescue nothing and harm b → c (24 × 150 ÷ 2000 = 1.8): never applied.
    const r2 = rescueConventionFrames([{ from: 'b', to: 'c', amount: 24, per: 1 }], today, new Map([['b', 150]]));
    expect(r2.applied).toEqual([]);
    // an unknown far end (the goal): a source may only NARROW.
    const r3 = rescueConventionFrames([{ from: 'a', to: 'b', amount: 0.15, per: 1 }, { from: 'a', to: 'goal', amount: 1, per: 1 }], today, new Map([['a', 98]]));
    expect(r3.applied).toEqual(['a']);
    const r4 = rescueConventionFrames([{ from: 'b', to: 'c', amount: 200, per: 1 }, { from: 'b', to: 'goal', amount: 1, per: 1 }], today, new Map([['b', 30]]));
    expect(r4.applied).toEqual([]);
  });
});

describe('#2842 review round 2: the rescue reads what admission reads', () => {
  it('#1: a stated RANGE on an option setting counts by its ends (50–500 customers → the rescue frame covers 500)', () => {
    const cust: Factor = { label: 'Existing customers', unit: 'customers', level: 100, max: 1000 };
    const a = admit(candidate([cust, { label: 'Support load', unit: 'tickets', level: 10, max: 20 }],
      [{ from: 'Existing customers', to: 'Support load', direction: 'positive', amount: 0.04 }], [
        { label: 'Expand', provenance: 'explicit', interventions: [{ factor_label: 'Existing customers', value: 150, value_kind: 'absolute', unit: 'customers', provenance: 'explicit',
          range: { low: 50, high: 500, meaning: 'likely_range', source: 'brief_extraction', source_quote: 'between 50 and 500' } }] },
        { label: 'Hold', provenance: 'explicit', interventions: [] },
      ]));
    expect(frameOf(a, 'Existing customers')).toBeGreaterThanOrEqual(500 / 0.8);
  });

  it('#3: a constraint written on an ALIAS of the rate ("Monthly  churn", folded by assignIds) still keeps today\'s frame', () => {
    const a = admit(candidate([CHURN(3), SUBS(1300, 2000)], [CHURN_TO_SUBS], undefined,
      [{ metric: 'Monthly  churn', operator: '<', value: 8, unit: '%', provenance: 'explicit' }]));
    expect(frameOf(a, 'Monthly churn')).toBe(100);
  });

  it('#6: a factor whose label FOLDS onto another entity (an outcome alias) is never re-framed', () => {
    const c = candidate([CHURN(3), SUBS(1300, 2000)], [CHURN_TO_SUBS]) as unknown as { outcomes: unknown[] };
    c.outcomes = [{ label: 'monthly churn', provenance: 'ai_proposed', unit: '%', plausible_max: 100 }];
    const a = admit(c as unknown as CandidateModel);
    expect(frameOf(a, 'Monthly churn')).toBe(100);
  });

  it('#7 (Science §(v)(2)): flow → stock is never rescued, even by widening the STOCK; "customers per hour" is a flow too', () => {
    const a = admit(candidate([PRICE(49), { label: 'New Pro subscribers per month', unit: 'subscribers/month', level: 15, max: 200 }, SUBS(1500, 2000)],
      [{ from: 'New Pro subscribers per month', to: 'Pro paying subscribers', direction: 'positive', amount: 12 }]));
    expect(frameOf(a, 'Pro paying subscribers')).toBe(2000);
    expect(edgeOf(a, 'New Pro subscribers per month', 'Pro paying subscribers').provenance?.magnitude).not.toBe('olumi_estimate');
    const b = admit(candidate([PRICE(49), { label: 'Walk-in customers', unit: 'customers per hour', level: 15, max: 200 }, SUBS(1500, 2000)],
      [{ from: 'Walk-in customers', to: 'Pro paying subscribers', direction: 'positive', amount: 12 }]));
    expect(frameOf(b, 'Walk-in customers')).toBe(200);
    expect(frameOf(b, 'Pro paying subscribers')).toBe(2000);
  });

  it('#8: at β = 1 exactly the rescue and admission agree — a logged rescue is ALWAYS an admitted estimate', () => {
    const a = admit(candidate([PRICE(49), { label: 'Premium seats', unit: 'seats', level: 1.5, max: 1.96 }],
      [{ from: 'Pro plan price', to: 'Premium seats', direction: 'positive', amount: 0.02 }]));
    const logged = lossText(a).includes('convention_frame_rescue');
    const e = edgeOf(a, 'Pro plan price', 'Premium seats');
    expect(logged ? e.provenance?.magnitude : 'not rescued').toBe(logged ? 'olumi_estimate' : 'not rescued');
  });
});

describe('§(u)(b) an OLUMI-drafted size takes its sign from the drawn direction', () => {
  it('Science row: P44\'s +3 on a negative link → admitted at −3, logged by link id', () => {
    const a = admit(candidate([CHURN(5), SUBS(1300, 2000)], [{ from: 'Monthly churn', to: 'Pro paying subscribers', direction: 'negative', amount: 3 }]));
    const e = edgeOf(a, 'Monthly churn', 'Pro paying subscribers');
    expect(e.provenance?.magnitude).toBe('olumi_estimate');
    expect(e.provenance?.natural_effect?.amount).toBe(-3);
    expect(e.strength.mean).toBeLessThan(0);
    const from = nodeOf(a, 'Monthly churn').id; const to = nodeOf(a, 'Pro paying subscribers').id;
    expect(lossText(a)).toContain(`edges[${from}::${to}].effect_amount`);
  });

  it('a NEGATIVE per-change carries the sign too: +3 per −1 on a positive link → +3 per +1', () => {
    const a = admit(candidate([CHURN(5), SUBS(1300, 2000)], [{ from: 'Monthly churn', to: 'Pro paying subscribers', direction: 'positive', amount: 3, per: -1 }]));
    expect(edgeOf(a, 'Monthly churn', 'Pro paying subscribers').strength.mean).toBeGreaterThan(0);
  });

  it('CONTROL: a size already agreeing with its direction is untouched and nothing is logged', () => {
    const a = admit(candidate([CHURN(5), SUBS(1300, 2000)], [{ from: 'Monthly churn', to: 'Pro paying subscribers', direction: 'negative', amount: -3 }]));
    expect(edgeOf(a, 'Monthly churn', 'Pro paying subscribers').provenance?.natural_effect?.amount).toBe(-3);
    expect(lossText(a)).not.toMatch(/effect_amount :: .*direction/);
  });

  it('Science row: a USER-stated +3 against an authored negative is NOT flipped (the user\'s sign wins; asked as today)', () => {
    const brief = 'Each 1% Monthly churn adds 3 Pro paying subscribers.';
    const user = admit(candidate([CHURN(5), SUBS(1300, 2000)], [{ from: 'Monthly churn', to: 'Pro paying subscribers', direction: 'negative', amount: 3, prov: 'explicit' }]), brief);
    const e = edgeOf(user, 'Monthly churn', 'Pro paying subscribers');
    expect(e.provenance?.natural_effect?.amount).not.toBe(-3);
    // #2842 review P2-11: not flipped AND not adopted as Olumi's: it stays a placeholder, and no sign resolution is logged.
    expect(e.provenance?.magnitude).toBe('olumi_placeholder');
    expect(lossText(user)).not.toMatch(/effect_amount :: Olumi's drafted size/);
    // CONTROL (the door is real): the same user sentence with an agreeing direction IS the user's size.
    const agree = admit(candidate([CHURN(5), SUBS(1300, 2000)], [{ from: 'Monthly churn', to: 'Pro paying subscribers', direction: 'positive', amount: 3, prov: 'explicit' }]), brief);
    expect(edgeOf(agree, 'Monthly churn', 'Pro paying subscribers').provenance?.magnitude).toBe('user_stated');
  });

  it('TRIPWIRE for Science\'s basis guard: the drafter link has NO basis text today; when one is added, the guard must be too', () => {
    const schema = buildCandidateSchema() as { properties: { links: { items: { properties: Record<string, unknown> } } } };
    const fields = Object.keys(schema.properties.links.items.properties);
    expect(fields.filter((k) => /basis|reason|why|rationale|justif/i.test(k)),
      'a basis field now exists: add §(u)(b)\'s guard (a basis stating the opposite direction is set aside, never resolved)').toEqual([]);
  });
});

describe('#2842 review P1-2: D4 keeps checking a percentage level on a non-100 frame', () => {
  it('a band below 0% on a drafted 0–13 churn is set aside, not admitted; CONTROL: a small effect is admitted', () => {
    const opts = [
      { label: 'Raise to £75', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 75, unit: '£/month', provenance: 'explicit' }] },
      { label: 'Hold £49', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 49, unit: '£/month', provenance: 'explicit' }] },
    ];
    const steep = admit(candidate([PRICE(49, 98), CHURN(3, 13)], [{ from: 'Pro plan price', to: 'Monthly churn', direction: 'negative', amount: -0.1 }], opts), 'Pro is £49, at most £98. Churn could reach 13%.');
    expect(frameOf(steep, 'Monthly churn')).toBe(13);
    expect(edgeOf(steep, 'Pro plan price', 'Monthly churn').provenance?.magnitude).not.toBe('olumi_estimate');
    const small = admit(candidate([PRICE(49, 98), CHURN(3, 13)], [{ from: 'Pro plan price', to: 'Monthly churn', direction: 'negative', amount: -0.01 }], opts), 'Pro is £49, at most £98. Churn could reach 13%.');
    expect(edgeOf(small, 'Pro plan price', 'Monthly churn').provenance?.magnitude).toBe('olumi_estimate');
  });
});
