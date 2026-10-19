/**
 * ⭐ ITEM 3 PROBE (TL 14:17Z ranges ruling; DL-3 14:21Z item 3; S2 cover 15:46Z banked probe). G3 #4 (a75de9cb) lost the user's
 * stated effect RANGE for an option's switch: the drafter's verified-shaped statement "…thinks it could add somewhere between
 * a and b <unit> points" was refused at construction (`figure_not_in_quote`: the joined-range reader was money-only), so no
 * statement record held it and the link stayed an Olumi placeholder above the range; then the answer door refused the user's
 * restatements (`unclear_figure`).
 *
 * This file records what the CURRENT build does with that shape, on SYNTHETIC briefs (never the unseen brief):
 *  · construction (#3297's joined range in any unit): the range is HELD as the user's statement on the link, with its whole
 *    attributed sentence, while the link stays UNSIZED (no point, midpoint or end is invented: Science C1, held-user-links.ts);
 *  · an explicitly written figure inside the range sizes the link as the user's, the range carried beside it;
 *  · the answer door's reading of a restated range: what it accepts today, and the KNOWN LOSSES (`it.fails`, step 2).
 */
import { describe, expect, it } from 'vitest';
// First: the real register/read world's module doubles (config, session store, identity) load before the build imports.
import { correctionWorld } from './corrections-stage2-world.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { userStatementFor } from '../../statement-door/statements.js';
import { centreRangeOfQuote, linkEffectTheUserStated } from '../stated-by-user.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, any>;

/** A drafter reply in the shape the sent schema requires, for one option that switches one factor on. */
function draftOf(p: {
  goal: { metric: string; baseline: number; target: number; levelQuote: string; targetQuote: string };
  option: string; factor: string; factorUnit: string; perSource: number | null; amount: number | null;
  effect: { quote: string; low: number; high: number; unit: string; value?: number | null; label?: string };
}): string {
  const effectStatement = {
    quote: p.effect.quote, subject: { kind: 'link', label: p.effect.label ?? p.factor, to_label: p.goal.metric, factor_label: null },
    field: 'effect', form: 'range', value: p.effect.value ?? null, low: p.effect.low, high: p.effect.high, unit: p.effect.unit,
    qualifier: null, conditions: null,
  };
  return JSON.stringify({
    goal: { kind: null, deliverable: null, metric: p.goal.metric, operator: '>=', target_stated: true, value: p.goal.target, unit: '%',
      horizon_months: null, provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: p.goal.baseline,
      baseline_provenance: 'explicit', scope: null, quantity_frame: 'level',
      basis: { reference: 'today', denominator: null, period_months: null, period_kind: 'at_end', effect_unit: 'percentage points',
        effects_at_period_end: false, also_required: null, open_question: null },
      source_quote: p.goal.targetQuote, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Keep current setup', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: p.option, provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: p.factor, value: 1, value_kind: 'absolute', unit: p.factorUnit, provenance: 'inferred' }] },
    ],
    factors: [{ label: p.factor, role: 'controllable', baseline_known: false, baseline_value: 0, unit: p.factorUnit, provenance: 'inferred', plausible_max: 1 }],
    risks: [], outcomes: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    links: [{ from: p.factor, to: p.goal.metric, direction: 'positive', provenance: 'explicit', effect_amount: p.amount,
      effect_per_source_change: p.perSource, effect_provenance: 'explicit', definitional: null, basis: null, source_quote: p.effect.quote }],
    statements: [
      { quote: p.goal.levelQuote, subject: { kind: 'goal', label: p.goal.metric, to_label: null, factor_label: null }, field: 'level',
        form: 'point', value: p.goal.baseline, low: null, high: null, unit: '%', qualifier: null, conditions: null },
      { quote: p.goal.targetQuote, subject: { kind: 'goal', label: p.goal.metric, to_label: null, factor_label: null }, field: 'target',
        form: 'lower_bound', value: p.goal.target, low: null, high: null, unit: '%', qualifier: null, conditions: null },
      effectStatement,
    ],
  });
}

async function built(brief: string, rawText: string): Promise<Rec> {
  let graph: Rec | undefined;
  const result = await buildModelFromBrief('7a7a7a7a-7a7a-4a7a-8a7a-7a7a7a7a7a7a', brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { registered: true, model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: null } };
  }) as never, (async () => ({ text: rawText, status: 'completed' })) as never) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
  return graph!;
}
const nodeId = (g: Rec, label: string): string => (g.nodes as Rec[]).find((n) => n.label === label)!.id as string;
const linkOf = (g: Rec, from: string, to: string): Rec => (g.edges as Rec[]).find((e) => e.from === nodeId(g, from) && e.to === nodeId(g, to))!;
const effectRecord = (g: Rec, from: string, to: string) =>
  userStatementFor(g, { kind: 'link', id: nodeId(g, from), to_id: nodeId(g, to), field: 'effect' } as never);

// ── Brief A: a switch whose effect the user reports as a range in its own "points" unit (the served G3 #4 SHAPE, synthetic gym). ──
const A_EFFECT = 'Option one is a corporate wellness deal with two offices nearby, which would cost us around £6k a year in discounts — our membership manager thinks it could add somewhere between 4 and 7 attendance points.';
const A_LEVEL = 'We run a 300-member gym and weekday attendance is about 45% at the moment.';
const A_TARGET = 'We need weekday attendance to reach at least 55% by the end of March next year.';
const A_BRIEF = `${A_LEVEL} ${A_TARGET} ${A_EFFECT} Option two is a referral scheme for existing members.`;
const A = {
  goal: { metric: 'weekday attendance', baseline: 45, target: 55, levelQuote: A_LEVEL, targetQuote: A_TARGET },
  option: 'Corporate wellness deal', factor: 'Corporate deal active', factorUnit: '0/1', perSource: null, amount: null,
  effect: { quote: A_EFFECT, low: 4, high: 7, unit: 'attendance points' },
};

// ── Brief B: a per-one link whose effect the user gives as a range of a count (synthetic bookshop). ──
const B_EFFECT = 'Our events lead reckons each author evening would bring somewhere between 20 and 40 extra visitors that week.';
const B_LEVEL = 'Our bookshop converts about 12% of weekly visitors into buyers today.';
const B_TARGET = 'We want that to be at least 15% by the summer.';
const B_BRIEF = `${B_LEVEL} ${B_TARGET} We are thinking about running author evenings. ${B_EFFECT}`;

describe('construction: a stated effect RANGE is held as the user’s statement on the link, which stays unsized', () => {
  it('⭐ (#3297 coverage, G3 #4 shape) a switch’s range in its own points unit is recorded whole, with its speaker and cost clause', async () => {
    const g = await built(A_BRIEF, draftOf(A));
    const rec = effectRecord(g, 'Corporate deal active', 'weekday attendance');
    expect(rec, 'the range must be held on the link').toBeDefined();
    expect(rec!.statements).toHaveLength(1);
    expect(rec!.statements[0]).toMatchObject({ form: 'range', low: 4, high: 7, unit: 'attendance points', quote: A_EFFECT });
  });
  it('NEGATIVE: with no figure written inside the range, nothing is invented: the link is not the user’s size, and no end or midpoint is stored as theirs', async () => {
    const g = await built(A_BRIEF, draftOf(A));
    const link = linkOf(g, 'Corporate deal active', 'weekday attendance');
    expect(link.provenance?.magnitude).not.toBe('user_stated');
    expect(link.provenance?.source).not.toBe('user_specified');
    const amount = link.provenance?.natural_effect?.amount;
    if (amount !== undefined) expect([4, 5.5, 7]).not.toContain(amount);
  });
  it('CONTRAST: a figure the user wrote inside the range ("about 5 …, between 4 and 7") sizes the link as theirs, the range carried beside it', async () => {
    const quote = 'Option one is a corporate wellness deal with two offices nearby — our membership manager thinks it would add about 5 attendance points, between 4 and 7.';
    const brief = `${A_LEVEL} ${A_TARGET} ${quote} Option two is a referral scheme for existing members.`;
    const g = await built(brief, draftOf({ ...A, amount: 5, perSource: 1, effect: { quote, low: 4, high: 7, unit: 'attendance points', value: 5 } }));
    const link = linkOf(g, 'Corporate deal active', 'weekday attendance');
    expect(link.provenance).toMatchObject({ magnitude: 'user_stated' });
    expect(link.provenance.natural_effect).toMatchObject({ amount: 5 });
    expect(effectRecord(g, 'Corporate deal active', 'weekday attendance')?.statements[0]).toMatchObject({ form: 'range', low: 4, high: 7, quote });
  });
  // KNOWN LOSS (cause UNVERIFIED): the sized link does not carry the range around the user's figure (`natural_effect.stated_range`,
  // `end: 'centre'`, d5 6009282279), though the statement record holds it; seen only with a "points" unit so far.
  it.fails('KNOWN LOSS: the range around the user\u2019s figure is carried on the sized link', async () => {
    const quote = 'Option one is a corporate wellness deal with two offices nearby — our membership manager thinks it would add about 5 attendance points, between 4 and 7.';
    const brief = `${A_LEVEL} ${A_TARGET} ${quote} Option two is a referral scheme for existing members.`;
    const g = await built(brief, draftOf({ ...A, amount: 5, perSource: 1, effect: { quote, low: 4, high: 7, unit: 'attendance points', value: 5 } }));
    expect(linkOf(g, 'Corporate deal active', 'weekday attendance').provenance.natural_effect.stated_range).toMatchObject({ low: 4, high: 7, end: 'centre' });
  });
  // ⛔ CHANGED EXPECTATION (DL-3 exit on BUDDY-A #3356 R7): "extra visitors" is not the AI's "visitors" by complete-unit equality, so
  // the range is held whole on its link, UNCONVERTED (no unit); a noun with other words can be another population ("non-paying").
  it('⭐ per-one count: "each author evening … somewhere between 20 and 40 extra visitors" is held whole on its link, unconverted', async () => {
    const g = await built(B_BRIEF, draftOf({
      goal: { metric: 'weekly visitor conversion', baseline: 12, target: 15, levelQuote: B_LEVEL, targetQuote: B_TARGET },
      option: 'Run author evenings', factor: 'Author evenings held', factorUnit: 'evenings', perSource: null, amount: null,
      effect: { quote: B_EFFECT, low: 20, high: 40, unit: 'visitors' },
    }));
    expect(effectRecord(g, 'Author evenings held', 'weekly visitor conversion')?.statements[0])
      .toMatchObject({ form: 'range', low: 20, high: 40, unit: '', quote: B_EFFECT });
  });
  it('NEGATIVE: a range whose sign the sentence does not write (−7 to −4 for "add") is never held as the user’s', async () => {
    const g = await built(A_BRIEF, draftOf({ ...A, effect: { ...A.effect, low: -7, high: -4 } }));
    expect(effectRecord(g, 'Corporate deal active', 'weekday attendance')).toBeUndefined();
  });
  it('NEGATIVE: a range filed on a link the model does not have (wrong source) is held on no link', async () => {
    const g = await built(A_BRIEF, draftOf({ ...A, effect: { ...A.effect, label: 'Referral scheme active' } }));
    expect(effectRecord(g, 'Corporate deal active', 'weekday attendance')).toBeUndefined();
  });
});

/**
 * ⛔ A RANGE IS THE USER'S ONLY WHEN BOTH ITS ENDS ARE (Codex #3438 R8 P1). The verifier's figure list read joined ranges raw, so a
 * tolerance end made a range: "20 ± 5 to 10" persisted as the user's 5–10. Both ends now pass the one eligibility (`amountComplete`).
 * Real path: construction → the real register route → cold read → `GraphV3.parse`. SYNTHETIC wording.
 */
describe('a range is the user’s only when both its ends are complete amounts, through registration and cold read', () => {
  const LEVEL = 'Attendance is 45% today.';
  const TARGET = 'Attendance must reach at least 55%.';
  async function registeredCold(quote: string, effect: { low: number; high: number }): Promise<Rec> {
    const brief = `${LEVEL} ${TARGET} ${quote}`;
    const w = await correctionWorld({ nodes: [], edges: [] }, brief, { brief });
    const draft = draftOf({ goal: { metric: 'Attendance', baseline: 45, target: 55, levelQuote: LEVEL, targetQuote: TARGET },
      option: 'Corporate deal', factor: 'Corporate deal active', factorUnit: '0/1', perSource: null, amount: null,
      effect: { quote, ...effect, unit: 'attendance points' } });
    const result = await buildModelFromBrief(w.ctx.scenario_id, brief, w.dispatch as never, (async () => ({ text: draft, status: 'completed' })) as never) as Rec;
    expect(result.ok, JSON.stringify(result).slice(0, 1500)).toBe(true);
    expect(w.writes).toHaveLength(1);
    const cold = await w.cold();
    expect(cold.status, JSON.stringify(cold.body).slice(0, 800)).toBe(200);
    return GraphV3.parse(JSON.parse(JSON.stringify(cold.body.graph))) as unknown as Rec;
  }
  it.each(['20 ± 5 to 10', '20 plus or minus 5 to 10'])('NEGATIVE: a tolerance end never makes the user’s range: "%s"', async (expr) => {
    const g = await registeredCold(`The corporate deal would add ${expr} attendance points.`, { low: 5, high: 10 });
    const rec = effectRecord(g, 'Corporate deal active', 'Attendance');
    expect((rec?.statements ?? []).filter((s) => s.speaker === 'user' && s.form === 'range' && s.low === 5 && s.high === 10), JSON.stringify(rec)).toEqual([]);
  }, 60_000);
  it('CONTROL: a whole range ("between 5 and 10") is held as the user’s through registration and cold read', async () => {
    const g = await registeredCold('The corporate deal would add between 5 and 10 attendance points.', { low: 5, high: 10 });
    expect(effectRecord(g, 'Corporate deal active', 'Attendance')?.statements[0]).toMatchObject({ speaker: 'user', form: 'range', low: 5, high: 10 });
  }, 60_000);
});

describe('the answer door’s reading of a restated range (pure; the proposer reads it the same way)', () => {
  const ends = { source: 'Corporate deal active', target: 'weekday attendance' };
  const scope = { quantities: [], link_selected: true, source_unitless: true };
  const fx = (amount: number) => ({ amount, amount_unit: 'percentage points', per_source_change: 1, per_source_change_unit: 'switch' });
  const said = (tail: string) => `The corporate deal active would add ${tail}`;

  it('GREEN today: a figure written BEFORE its range is the user’s, the range carried', () => {
    const q = said('about 5 percentage points to weekday attendance, between 4 and 7.');
    expect(linkEffectTheUserStated(q, fx(5), ends, scope)).toBeNull();
    expect(centreRangeOfQuote(q, fx(5))).toMatchObject({ low: 4, high: 7, end: 'centre' });
  });
  it('GREEN today: a money range in the NEXT sentence leaves the figure and its range the user’s', () => {
    const q = `${said('about 5 percentage points to weekday attendance, between 4 and 7.')} It costs £5k to £7k a year.`;
    expect(linkEffectTheUserStated(q, fx(5), ends, scope)).toBeNull();
  });
  it('KEPT NEGATIVE: a second range of the same quantity in the sentence ("or 6-9 in a good year") is still asked', () => {
    const q = said('about 5 percentage points to weekday attendance, between 4 and 7, or 6-9 in a good year.');
    expect(linkEffectTheUserStated(q, fx(5), ends, scope)).toBe('unclear_figure');
  });
  it('KEPT NEGATIVE (category is step 2, TL/Science): a bare range sizes nothing; no end or midpoint is read as the user’s figure', () => {
    const q = said('between 4 and 7 percentage points to weekday attendance.');
    for (const a of [4, 5.5, 7]) expect(linkEffectTheUserStated(q, fx(a), ends, scope)).toBe('unclear_figure');
  });
  // ── R3 (BUDDY-A #3311 B1 ×2; TL 17:18Z): a range written BEFORE the figure is never bound by a host reading; it is asked
  // (Olumi's card proposes a reading once the AIE accepts its basis). Still a known loss, not a protection. ──
  it.fails('KNOWN LOSS (until the card): the range written FIRST, the figure after ("between 4 and 7 …, probably about 5")', () => {
    const q = said('between 4 and 7 percentage points to weekday attendance, probably about 5.');
    expect(linkEffectTheUserStated(q, fx(5), ends, scope)).toBeNull();
  });
  it.fails('KNOWN LOSS (until the card): "somewhere between 4 and 7 …, call it 5"', () => {
    const q = said('somewhere between 4 and 7 percentage points to weekday attendance, call it 5.');
    expect(linkEffectTheUserStated(q, fx(5), ends, scope)).toBeNull();
  });
  it('⭐ a money range in the SAME sentence is a separate claim ("…, between 4 and 7, and it costs £5k to £7k a year")', () => {
    const q = said('about 5 percentage points to weekday attendance, between 4 and 7, and it costs £5k to £7k a year.');
    expect(linkEffectTheUserStated(q, fx(5), ends, scope)).toBeNull();
    expect(centreRangeOfQuote(q, fx(5))).toMatchObject({ low: 4, high: 7, end: 'centre' });
  });
  it('NEGATIVE: a range before the figure in ANOTHER clause is not its range ("Last year it was between 2 and 4, and … about 3")', () => {
    // No unit word after the range, so only the clause rule tells it apart (a unitless range in the figure's clause is its own).
    const q = 'Last year it was between 2 and 4, and the corporate deal active would add about 3 percentage points to weekday attendance.';
    expect(centreRangeOfQuote(q, fx(3))).toBeUndefined();
    expect(linkEffectTheUserStated(q, fx(3), ends, scope)).toBe('unclear_figure');
  });
  it('NEGATIVE (BUDDY-A #3311 B1): a range written first for ANOTHER claim is never this link\'s, whatever joins them', () => {
    for (const join of [' —', ' but', ',']) {
      const q = `Earlier campaigns won between 4 and 7 percentage points${join} the corporate deal active would add about 5 percentage points to weekday attendance.`;
      expect(centreRangeOfQuote(q, fx(5)), join).toBeUndefined();
      expect(linkEffectTheUserStated(q, fx(5), ends, scope), join).toBe('unclear_figure');
    }
  });
  it('NEGATIVE: a figure that IS an end of the range written first is never a centre ("between 4 and 7 …, about 4")', () => {
    const q = said('between 4 and 7 percentage points to weekday attendance, about 4.');
    expect(centreRangeOfQuote(q, fx(4))).toBeUndefined();
  });
  it('NEGATIVE: a range in another unit written first ("Between 1 and 4 months …") gives no centre, and a lone time range is still asked', () => {
    const q = 'Between 1 and 4 months after launch, the corporate deal active would add about 5 percentage points to weekday attendance.';
    expect(centreRangeOfQuote(q, fx(5))).toBeUndefined();
    expect(linkEffectTheUserStated(q, fx(5), ends, scope)).toBe('unclear_figure');
  });
});
