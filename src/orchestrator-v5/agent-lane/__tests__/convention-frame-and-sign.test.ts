/**
 * ⭐ SCIENCE §(s) + §(u) (goals rulings, 8 Oct 2026; DL GO): OLUMI'S CONVENTION FRAME FOR A BOUNDED RATE OR A
 * NON-NEGATIVE LEVEL, AND THE SIGN OF AN OLUMI-DRAFTED SIZE.
 *
 * Measured (P44 mechanism arm, 8 Oct, 9 drafts at CEE 23349562): the drafter drew the price downside as a sized mechanism
 * (price → churn pp → subscribers), and admission set every new size aside. Two causes, neither the drafter's figure:
 *  · the FRAME: a price framed 0–£200 reads 0.15 pp churn per £1 as β = 2 against a 15 pp churn frame (`not_representable`);
 *    churn framed 0–100 pp reads −24 subscribers per pp as β = −1.2 against 2,000 subscribers;
 *  · the SIGN: the drafter wrote +3 / +2.5 / +10,368 on links it drew as negative (`sign_conflict`), 4 links in 4 drafts.
 *
 * Precedence (DL, approving P44's reading): a USER range > this convention > the drafter's own plausible_max (Olumi's guess).
 * Rows are Science's own, from its file §(s) / §(u).
 */
import { describe, it, expect } from 'vitest';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { buildCandidateSchema } from '../runtime/build-model.js';

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

describe('§(s) a bounded RATE gets Olumi\'s convention frame: min(100, max(2 × level, level + 10)) points', () => {
  it('Science row: churn 3% → 0–13 pp, and −24 subscribers per pp is ADMITTED at β ≈ −0.12 (was −1.2, set aside)', () => {
    const a = admit(candidate([CHURN(3), SUBS(1300, 2000)], [{ from: 'Monthly churn', to: 'Pro paying subscribers', direction: 'negative', amount: -24 }],
      [{ label: 'Hold', provenance: 'explicit', interventions: [{ factor_label: 'Monthly churn', value: 3, unit: '%', provenance: 'explicit' }] },
        { label: 'Other', provenance: 'explicit', interventions: [] }]));
    expect(frameOf(a, 'Monthly churn')).toBe(13);
    expect(frameOf(a, 'Pro paying subscribers')).toBe(2600);
    const e = edgeOf(a, 'Monthly churn', 'Pro paying subscribers');
    expect(e.provenance?.magnitude).toBe('olumi_estimate');
    expect(e.strength.mean).toBeCloseTo(-0.12, 6);
    expect(e.provenance?.natural_effect?.amount).toBe(-24);
  });

  it('Science row: NRR 110% is NOT a bounded rate → unframed by the convention (the drafter\'s range stays)', () => {
    const a = admit(candidate([{ label: 'Net revenue retention', unit: '%', level: 110, max: 200 }], []));
    expect(frameOf(a, 'Net revenue retention')).toBe(200);
  });

  it('a signed rate (a price change %) is NOT framed by the convention', () => {
    const a = admit(candidate([{ label: 'Price change', unit: '%', level: 5, max: 100 }], []));
    expect(frameOf(a, 'Price change')).toBe(100);
  });

  it('Science row: an option setting churn to 12% (≥ 80% of 13) WIDENS the frame; the option\'s 12 is kept exactly', () => {
    const a = admit(candidate([CHURN(3)], [], [
      { label: 'Discount', provenance: 'explicit', interventions: [{ factor_label: 'Monthly churn', value: 12, unit: '%', provenance: 'explicit' }] },
      { label: 'Hold', provenance: 'explicit', interventions: [] },
    ]));
    expect(frameOf(a, 'Monthly churn')).toBe(24);
  });

  it('Science mutant row: a setting ABOVE the default ceiling is never clipped (raw kept, frame above it)', () => {
    const a = admit(candidate([CHURN(3)], [], [
      { label: 'Discount', provenance: 'explicit', interventions: [{ factor_label: 'Monthly churn', value: 15, unit: '%', provenance: 'explicit' }] },
      { label: 'Hold', provenance: 'explicit', interventions: [] },
    ]));
    const frame = frameOf(a, 'Monthly churn')!;
    expect(frame).toBe(30);
    // #2842 review P2-11: the option's OWN setting is carried exactly — raw 15, normalised 15 ÷ 30 — never clipped to 13.
    const set = (nodeOf(a, 'Discount') as unknown as { interventions: Record<string, { raw_value?: number; value?: number }> }).interventions[nodeOf(a, 'Monthly churn').id];
    expect(set).toMatchObject({ raw_value: 15, value: 0.5 });
  });

  it('#2842 review P1-6: a rate the USER constrained keeps today\'s frame (its limit stays checkable on the percent rung)', () => {
    const a = admit(candidate([CHURN(3)], [], undefined,
      [{ metric: 'Monthly churn', operator: '<', value: 8, unit: '%', provenance: 'explicit' }]));
    expect(frameOf(a, 'Monthly churn')).toBe(100);
  });

  it('Science §(v)(1): an Olumi-ESTIMATED level is framed too: B1\'s churn 5.5% (Olumi\'s) → 15.5 pp; the level stays Olumi\'s', () => {
    const a = admit(candidate([PRICE(49), { label: 'Monthly churn', unit: '%', level: 5.5, max: 20, known: false, provenance: 'ai_proposed' }], []));
    expect(frameOf(a, 'Monthly churn')).toBe(15.5);
    expect(JSON.stringify(nodeOf(a, 'Monthly churn').observed_state)).toMatch(/"source":"cee_inference"/);
  });

  it('#2842 review P1-2: D4 still checks a percentage level on a non-100 frame (a band below 0% is set aside, not admitted)', () => {
    const opts = [
      { label: 'Raise to £75', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 75, unit: '£/month', provenance: 'explicit' }] },
      { label: 'Hold £49', provenance: 'explicit', interventions: [{ factor_label: 'Pro plan price', value: 49, unit: '£/month', provenance: 'explicit' }] },
    ];
    const steep = admit(candidate([PRICE(49), CHURN(3)], [{ from: 'Pro plan price', to: 'Monthly churn', direction: 'negative', amount: -0.1 }], opts));
    expect(frameOf(steep, 'Monthly churn')).toBe(13);
    expect(edgeOf(steep, 'Pro plan price', 'Monthly churn').provenance?.magnitude).not.toBe('olumi_estimate');
    // CONTROL: a small effect inside the domain IS admitted on the same frame.
    const small = admit(candidate([PRICE(49), CHURN(3)], [{ from: 'Pro plan price', to: 'Monthly churn', direction: 'negative', amount: -0.01 }], opts));
    expect(edgeOf(small, 'Pro plan price', 'Monthly churn').provenance?.magnitude).toBe('olumi_estimate');
  });
});

describe('§(u)(a) a NON-NEGATIVE level gets 0 to 2 × its level', () => {
  it('Science row: price £49 → £98; option £59 (60%) does not widen; 0.15 pp per £1 into churn 5% (0–15) → β = 0.98, ADMITTED', () => {
    const a = admit(candidate([PRICE(49), CHURN(5)], [{ from: 'Pro plan price', to: 'Monthly churn', direction: 'positive', amount: 0.15 }], [
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
    const a = admit(candidate([{ label: 'Pro plan price', unit: '£/Pro subscriber/month', level: 49, max: 200 }], []));
    expect(frameOf(a, 'Pro plan price')).toBe(98);
    // CONTROL: a unit whose head is not money stays excluded (the drafter's range stays).
    const b = admit(candidate([{ label: 'Pro plan price', unit: 'points/Pro subscriber/month', level: 49, max: 200 }], []));
    expect(frameOf(b, 'Pro plan price')).toBe(200);
  });

  it('DISCLOSED as Olumi\'s frame, once per factor, in the construction ledger', () => {
    const a = admit(candidate([PRICE(49), CHURN(3)], []));
    const text = lossText(a);
    expect(text).toContain("Olumi treats ‘Pro plan price’ as between £0 and £98 a month");
    expect(text).toContain("Olumi treats ‘Monthly churn’ as between 0% and 13%");
    expect(text.match(/Olumi treats ‘Pro plan price’/g)?.length).toBe(1);
  });

  it('PRECEDENCE: a ceiling the USER wrote wins (the brief writes £150) — contrast: unwritten → the convention', () => {
    const user = admit(candidate([PRICE(49, 150)], []), 'Our Pro plan is £49 a month and could go as high as £150.');
    expect(frameOf(user, 'Pro plan price')).toBe(150);
    const olumi = admit(candidate([PRICE(49, 150)], []), 'Our Pro plan is £49 a month.');
    expect(frameOf(olumi, 'Pro plan price')).toBe(98);
  });

  it('EXCLUDED: a level of 0 and a signed level keep the drafter\'s range (an ESTIMATED level is framed: Science §(v)(1))', () => {
    const a = admit(candidate([
      PRICE(49),
      { label: 'Starter subscribers', unit: 'subscribers', level: 0, max: 5000 },
      { label: 'Net cash flow', unit: '£/month', level: 20000, max: 100000 },
      { label: 'Support tickets', unit: 'tickets', level: 300, max: 5000, known: false },
    ], []));
    expect(frameOf(a, 'Starter subscribers')).toBe(5000);
    expect(frameOf(a, 'Net cash flow')).toBe(100000);
    expect(frameOf(a, 'Support tickets')).toBe(600);
  });

  it('#2842 review P1-4: money with no positive evidence it cannot go negative ("Operating income") keeps the drafter\'s range', () => {
    const a = admit(candidate([PRICE(49), { label: 'Operating income', unit: '£/month', level: 10000, max: 100000 }], []));
    expect(frameOf(a, 'Operating income')).toBe(100000);
    expect(frameOf(a, 'Pro plan price')).toBe(98);
  });

  it('#2842 review P1-5: a ceiling of 1 or less (a £0.25 price) is not a frame the writers keep → excluded', () => {
    const a = admit(candidate([{ label: 'Wholesale price', unit: '£/item', level: 0.25, max: 5 }], [], [
      { label: 'Raise', provenance: 'explicit', interventions: [{ factor_label: 'Wholesale price', value: 0.3, unit: '£/item', provenance: 'explicit' }] },
      { label: 'Hold', provenance: 'explicit', interventions: [] },
    ]));
    expect(frameOf(a, 'Wholesale price')).toBe(5);
  });

  it('#2842 review P1-8: a figure the brief writes as ANOTHER kind ("150 customers") is not a price ceiling', () => {
    const a = admit(candidate([PRICE(49, 150)], []), 'Our Pro plan is £49 a month and we have 150 customers.');
    expect(frameOf(a, 'Pro plan price')).toBe(98);
  });

  it('#2842 review P1-1/P1-9: a sized link whose reach EXCEEDS the ceiling (|β| > 1) widens it to (level + reach) ÷ 0.8, so the size stays admitted', () => {
    // The hiring draft (arm re-run B3 d3): £100,000 per senior engineer over 0–10 engineers into salary spend at £150,000.
    const a = admit(candidate([
      { label: 'Annual salary spend', unit: '£/year', level: 150000, max: 2000000 },
      { label: 'Senior engineers hired', unit: 'engineers', level: 0, max: 10 },
    ], [{ from: 'Senior engineers hired', to: 'Annual salary spend', direction: 'positive', amount: 100000 }]));
    expect(frameOf(a, 'Annual salary spend')).toBe(1437500);
    const e = edgeOf(a, 'Senior engineers hired', 'Annual salary spend');
    expect(e.provenance?.magnitude).toBe('olumi_estimate');
    expect(Math.abs(e.strength.mean)).toBeLessThanOrEqual(1);
    // CONTROL: a link whose reach stays within the ceiling leaves the convention's 2 × level alone.
    const b = admit(candidate([
      { label: 'Annual salary spend', unit: '£/year', level: 150000, max: 2000000 },
      { label: 'Senior engineers hired', unit: 'engineers', level: 0, max: 10 },
    ], [{ from: 'Senior engineers hired', to: 'Annual salary spend', direction: 'positive', amount: 5000 }]));
    expect(frameOf(b, 'Annual salary spend')).toBe(300000);
  });

  it('a constraint the user set on a LEVEL widens its frame (keep the price under £90 → 0–£180)', () => {
    const a = admit(candidate([PRICE(49)], [], undefined,
      [{ metric: 'Pro plan price', operator: '<', value: 90, unit: '£/month', provenance: 'explicit' }]));
    expect(frameOf(a, 'Pro plan price')).toBe(180);
  });

  it('EXCLUDED: the GOAL node is never re-framed by the convention', () => {
    const a = admit(candidate([PRICE(49)], []));
    const goal = (a.nodes as unknown as AnyNode[]).find((n) => n.kind === 'goal')!;
    expect(JSON.stringify(goal)).not.toMatch(/"cap":98\b/);
    expect(lossText(a)).not.toContain('Olumi treats ‘Monthly recurring revenue’');
  });

  it('INVARIANCE (the CEE half): the natural-unit size is the same on either frame; only β rescales, exactly', () => {
    const link: Link[] = [{ from: 'Pro plan price', to: 'Monthly churn', direction: 'positive', amount: 0.15 }];
    const narrow = admit(candidate([PRICE(49, 98), CHURN(5, 30)], link), 'Pro is £49 a month, at most £98. Churn could reach 30%.');
    const wide = admit(candidate([PRICE(49, 196), CHURN(5, 30)], link), 'Pro is £49 a month, at most £196. Churn could reach 30%.');
    const n = edgeOf(narrow, 'Pro plan price', 'Monthly churn'); const w = edgeOf(wide, 'Pro plan price', 'Monthly churn');
    const nat = (e: AnyEdge) => { const x = e.provenance?.natural_effect as Record<string, unknown> | undefined; return x && { amount: x.amount, amount_unit: x.amount_unit, per_source_change: x.per_source_change, per_source_change_unit: x.per_source_change_unit }; };
    expect(nat(n)).toEqual(nat(w)); expect(nat(n)?.amount).toBe(0.15);
    expect(w.strength.mean / n.strength.mean).toBeCloseTo(2, 9);
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
