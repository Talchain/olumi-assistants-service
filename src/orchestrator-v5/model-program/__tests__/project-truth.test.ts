/**
 * W3b (26 Oct): the canvas stops misstating the model. Audit of served board 5651fd74 against its saved model
 * (outbox/UI-MODEL-DESIGN-PROPOSAL-20261026.html, "Fix without a design call"). Each row binds an exact field the canvas
 * reads, on the real projection of two saved drafts from the served path (hiring-alpha3, capacity-s4) and of the club
 * witness with a multiplying risk added; each has a contrast where the old output was already right.
 *  1. Links: no strength on any link (a bare ±1 drew every link "Very strong"); a link's sign only where the model gives
 *     one; a risk that multiplies by less than 1 is drawn lowering what it moves.
 *  2. Risks: the chance on the card's own field (event_risk.v1), whose it is, over the model's horizon in months.
 *  3. Goals: what a change is measured from, the window it is read over, and who chose the measure.
 *  4. Review rows: each row's family, fixed structure said as structure, a figure still to be given said as asked.
 * Mutants (each reverts one item; RED on its rows): the old `strength: { mean: ±1 }`; the old risk sign rule; no
 * event_risk; no goal facts; no row flags. Expectations are written by hand from the fixtures.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CanonicalModel, withDeclaredTiming, type CanonicalModelT } from '../canonical.js';
import { compile } from '../compile.js';
import { project } from '../project.js';
import { readingOf } from '../../model-program-turn/postimage.js';
import { at, club, CLUB_BRIEF, q } from '../../model-program-turn/__tests__/bakery.fixture.js';

type Rec = Record<string, any>;
const saved = (file: string) => {
  const s = JSON.parse(readFileSync(new URL(`../../model-program-turn/__tests__/${file}`, import.meta.url), 'utf8')) as { brief: string; canonical: unknown };
  return { brief: s.brief, model: CanonicalModel.parse(withDeclaredTiming(s.canonical)) };
};
const projected = (m: CanonicalModelT, brief: string) => project(m, compile(m, { sourceText: brief }), { brief });
const draft = (file: string) => { const s = saved(file); return projected(s.model, s.brief); };
const edgesOf = (p: ReturnType<typeof project>) => p.graph.edges as Rec[];
const nodeOf = (p: ReturnType<typeof project>, id: string) => (p.graph.nodes as Rec[]).find((n) => n.id === id)!;

/** The club witness (monthly, a three-month window) with a rival opening: Olumi's 20–40 % chance, × 0.4–0.6 on joins. */
function rival(severity: Partial<Parameters<typeof q>[2]> = {}, mode: 'add' | 'multiply' = 'multiply'): CanonicalModelT {
  const m = club();
  m.quantities.push(
    q('rival_chance', '1', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.3, low: 0.2, high: 0.4, range_kind: 'plausible', basis: 'Rival clubs open in towns this size now and then.' }),
    q('rival_effect', mode === 'multiply' ? '1' : 'member/month', { kind: 'coefficient', status: 'estimated', author: 'olumi', value: 0.5, low: 0.4, high: 0.6, range_kind: 'plausible', basis: 'A rival takes some of the new joins.', ...severity }),
  );
  m.risks.push({ id: 'rival_opens', label: 'A rival club opens nearby', occurrence: 'rival_chance', severity: 'rival_effect', effect_on: 'joins', mode, starts_after_periods: 0, author: 'olumi', quote: null, ...at });
  return m;
}
const riskLink = (m: CanonicalModelT) => edgesOf(projected(m, CLUB_BRIEF)).find((e) => e.id === 'rival_opens__joins')!;

describe('W3b 1 · links say what the model holds: no strength, a sign only where the model gives one', () => {
  it('capacity-s4: no link carries a strength; each keeps its stated sign; the specialist link keeps its size in tickets', () => {
    const p = draft('capacity-s4.saved.json');
    expect(edgesOf(p).filter((e) => 'strength' in e).map((e) => e.id)).toEqual([]);
    // Contrast (right before, unchanged): every link's direction, and none on the goal's measure.
    expect(edgesOf(p).map((e) => [e.id, e.effect_direction ?? null])).toEqual([
      ['weekly_support_capacity__support_capacity_goal', null],
      ['mp:decision__keep_current_staffing', 'positive'], ['keep_current_staffing__additional_specialists', 'positive'],
      ['mp:decision__add_one_specialist', 'positive'], ['add_one_specialist__additional_specialists', 'positive'],
      ['zero_additional_capacity__additional_capacity', 'positive'], ['additional_specialists__additional_capacity', 'positive'],
      ['existing_capacity__weekly_support_capacity', 'positive'], ['additional_capacity__weekly_support_capacity', 'positive'],
    ]);
    // The causal link's real size, in its own units and with the person's range; no β keyed to it.
    const { reasoning, ...size } = edgesOf(p).find((e) => e.id === 'additional_specialists__additional_capacity')!.provenance;
    expect(size).toEqual({ source: 'brief_extraction', magnitude: 'user_stated',
      natural_effect: { amount: 20, amount_unit: 'ticket/week', per_source_change: 1, per_source_change_unit: 'specialist', stated_range: { low: 10, high: 30, text: '10–30', end: 'centre' } } });
    expect(reasoning).toMatch(/^about 20, 10–30 ticket\/week\/specialist; /);
    // The goal's measure holds by definition: no size, no sign, said as a definition.
    expect(edgesOf(p)[0]).toEqual({ from: 'weekly_support_capacity', to: 'support_capacity_goal', exists_probability: 1, provenance: { source: 'brief_extraction', definitional: true },
      origin: 'model_program:calculation', id: 'weekly_support_capacity__support_capacity_goal' });
  });

  it('hiring-alpha3: a product\'s and a sum\'s parts carry no strength, only their sign and how they combine', () => {
    const p = draft('hiring-alpha3.saved.json');
    expect(edgesOf(p).filter((e) => 'strength' in e).map((e) => e.id)).toEqual([]);
    const parts = edgesOf(p).filter((e) => e.provenance?.definitional === true).map((e) => [e.id, e.effect_direction, e.provenance.reasoning]);
    expect(parts).toEqual([
      ['developers_hired__developer_spend', 'positive', 'multiplied'], ['developer_hiring_cost__developer_spend', 'positive', 'multiplied'],
      ['tech_leads_hired__tech_lead_spend', 'positive', 'multiplied'], ['tech_lead_hiring_cost__tech_lead_spend', 'positive', 'multiplied'],
      ['developer_spend__total_hiring_spend', 'positive', 'added'], ['tech_lead_spend__total_hiring_spend', 'positive', 'added'],
    ]);
  });

  it('a stock\'s outflow keeps its negative sign with no strength (contrast: right before)', () => {
    const e = edgesOf(projected(club(), CLUB_BRIEF)).find((x) => x.id === 'leavers__members')!;
    expect([e.effect_direction, 'strength' in e, e.provenance.reasoning]).toEqual(['negative', false, 'outflow per month']);
  });

  it('a risk that multiplies by less than 1 lowers what it moves; above 1 raises it; across 1 or with no figure, no sign', () => {
    expect([riskLink(rival()).effect_direction, 'strength' in riskLink(rival())]).toEqual(['negative', false]);
    expect(riskLink(rival({ value: 1.5, low: 1.2, high: 1.8 })).effect_direction).toBe('positive');
    expect(riskLink(rival({ value: null, low: 0.4, high: 0.6 })).effect_direction).toBe('negative');
    expect('effect_direction' in riskLink(rival({ value: null, low: 0.8, high: 1.2 }))).toBe(false);
    expect('effect_direction' in riskLink(rival({ status: 'unknown', value: null, low: null, high: null, range_kind: null }))).toBe(false);
    // A % severity is read in its own scale: × 50 % lowers.
    expect(riskLink(rival({ unit: '%', value: 50, low: 40, high: 60 })).effect_direction).toBe('negative');
    // Contrast (right before): an added risk below zero lowers, above zero raises.
    expect(riskLink(rival({ value: -3, low: -4, high: -2 }, 'add')).effect_direction).toBe('negative');
    expect(riskLink(rival({ value: 3, low: 2, high: 4 }, 'add')).effect_direction).toBe('positive');
  });
});

describe('W3b 2 · a risk card reads the chance the model holds', () => {
  it('the rival risk: Olumi\'s 20–40 % chance over the model\'s three months, on the card\'s event_risk', () => {
    const risk = nodeOf(projected(rival(), CLUB_BRIEF), 'rival_opens');
    expect(risk.event_risk).toEqual({ version: 1, occurrence: { p_low: 0.2, p_high: 0.4, meaning: 'at_least_once_within_horizon', basis: 'olumi' }, horizon: { months: 3 } });
    // Contrast (right before, unchanged): the card's words for the chance and the effect.
    expect(risk.description).toMatch(/^Chance: about 0\.3, 0\.2–0\.4, Olumi's estimate; .*\. If it happens: multiplies by about 0\.5, 0\.4–0\.6, Olumi's estimate; .*, from the start\.$/);
  });

  it('the person\'s own 25 % is theirs, as a fraction; a yearly model\'s horizon is in months', () => {
    const m = rival();
    m.quantities = m.quantities.map((x) => (x.id === 'rival_chance' ? { ...x, unit: '%', status: 'known', author: 'person', value: 25, low: null, high: null, range_kind: null, quote: 'a 25% chance a rival opens', basis: null } : x));
    expect(nodeOf(projected(m, `${CLUB_BRIEF} There is a 25% chance a rival opens.`), 'rival_opens').event_risk)
      .toEqual({ version: 1, occurrence: { p_low: 0.25, p_high: 0.25, meaning: 'at_least_once_within_horizon', basis: 'user' }, horizon: { months: 3 } });
    // The same club counted in years (its flows per year, its window two years): the horizon is 24 months.
    const yearly = rival();
    yearly.period = 'year';
    const perYear: Record<string, Partial<Parameters<typeof q>[2]>> = { base_joins: { unit: 'member/year', value: 240 }, leavers: { unit: 'member/year', value: 120 },
      joins: { unit: 'member/year' }, promo_effect: { unit: 'member/year/promotion', value: 60, low: 36, high: 84 }, months: { unit: 'year', value: 2 } };
    yearly.quantities = yearly.quantities.map((x) => ({ ...x, ...perYear[x.id] }));
    expect(compile(yearly, { sourceText: CLUB_BRIEF }).errors).toEqual([]);
    expect(nodeOf(projected(yearly, CLUB_BRIEF), 'rival_opens').event_risk?.horizon).toEqual({ months: 24 });
  });

  it('no chance is said where the model cannot say it over months, or the figure is no one\'s or not in their words', () => {
    const weekly = rival();
    weekly.period = 'week';
    weekly.quantities = weekly.quantities.map((x) => (x.id === 'months' ? { ...x, unit: 'week', value: 12, quote: 'within twelve weeks' } : x));
    expect(nodeOf(projected(weekly, CLUB_BRIEF), 'rival_opens')).not.toHaveProperty('event_risk');
    const unverified = rival();
    unverified.quantities = unverified.quantities.map((x) => (x.id === 'rival_chance' ? { ...x, status: 'known', author: 'person', value: 0.25, low: null, high: null, range_kind: null, quote: 'words they never wrote', basis: null } : x));
    expect(nodeOf(projected(unverified, CLUB_BRIEF), 'rival_opens')).not.toHaveProperty('event_risk');
    const asked = rival();
    asked.quantities = asked.quantities.map((x) => (x.id === 'rival_chance' ? { ...x, status: 'asked', author: 'person', value: null, low: null, high: null, range_kind: null, question: 'How likely is a rival to open?', basis: null } : x));
    expect(nodeOf(projected(asked, CLUB_BRIEF), 'rival_opens')).not.toHaveProperty('event_risk');
  });
});

describe('W3b 3 · a goal card carries what its change is measured from, its window and who chose the measure', () => {
  /** The club, measured as Olumi suggests: members at least 5 % above carrying on as now, at some point in months 1 to 3. */
  const growth = (): CanonicalModelT => {
    const m = club();
    m.quantities.push(q('growth_target', '%', { value: 5, quote: 'at least 5% more members' }));
    m.goals = [{ ...m.goals[0]!, id: 'grow', label: 'Grow the club', quote: 'at least 5% more members',
      measure: { ...m.goals[0]!.measure!, target: 'growth_target', frame: 'change_rel', reference: { kind: 'option', option: 'carry_on', quantity: null }, aggregation: 'max', measure_by: 'olumi' } }];
    return m;
  };
  it('a change from "Carry on as now", at its highest in months 1 to 3, on a measure Olumi chose', () => {
    const goal = nodeOf(projected(growth(), `${CLUB_BRIEF} We want at least 5% more members.`), 'grow');
    expect([goal.goal_reference, goal.goal_window, goal.goal_measure_by]).toEqual([
      { kind: 'option', option_id: 'carry_on', label: 'Carry on as now' },
      { aggregation: 'max', start: 0, periods: 3, period_unit: 'month', origin_event: null },
      'olumi',
    ]);
    // Contrast (right before, unchanged): the target's figure in the contract's frame, 5 % as 0.05.
    expect([goal.goal_threshold_frame, goal.goal_threshold_raw, goal.goal_threshold_unit]).toEqual(['change_rel', 0.05, 'member']);
  });

  it('a change from today says so; a window still asked has no periods; a level goal has no reference', () => {
    const today = growth();
    today.goals = today.goals.map((g) => ({ ...g, measure: { ...g.measure!, reference: { kind: 'now', option: null, quantity: null } } }));
    expect(nodeOf(projected(today, CLUB_BRIEF), 'grow').goal_reference).toEqual({ kind: 'now' });
    const asked = club();
    asked.quantities = asked.quantities.map((x) => (x.id === 'months' ? { ...x, status: 'asked', value: null, quote: null, question: 'By when?' } : x));
    expect(nodeOf(projected(asked, CLUB_BRIEF), 'reach_340').goal_window).toEqual({ aggregation: 'end', start: 0, periods: null, period_unit: 'month', origin_event: null });
    const cap = nodeOf(draft('capacity-s4.saved.json'), 'support_capacity_goal');
    expect([cap.goal_measure_by, 'goal_reference' in cap, 'goal_window' in cap]).toEqual(['person', false, false]);
  });
});

describe('W3b 4 · each review row says its family, structure as structure, and a figure still to be given as asked', () => {
  const rows = (m: CanonicalModelT, brief: string) => {
    const r = readingOf(m, { words: [brief], approver: null });
    if (!r.ok) throw new Error(r.reason);
    return new Map(r.changes.map((c) => [c.id, c] as const));
  };

  it('hiring-alpha3: the limit, the assumptions and the left-out notes by family; the two switches as structure; the two costs as asked', () => {
    const s = saved('hiring-alpha3.saved.json');
    const r = rows(s.model, s.brief);
    expect([...r.values()].filter((c) => c.family === undefined).map((c) => c.id)).toEqual([]);
    expect(['stay_within_budget', 'budget_cost_scope', 'leadership_gap', 'prefer_lower_spend', 'code_quality_not_calculated', 'define_total_hiring_spend'].map((id) => [id, r.get(id)!.kind, r.get(id)!.family]))
      .toEqual([['stay_within_budget', 'record', 'limit'], ['budget_cost_scope', 'record', 'assumptions'], ['leadership_gap', 'record', 'claims'],
        ['prefer_lower_spend', 'record', 'preference'], ['code_quality_not_calculated', 'left_out', 'left_out'], ['define_total_hiring_spend', 'relation', 'relation']]);
    expect([...r.values()].filter((c) => c.structure === true).map((c) => [c.id, c.author])).toEqual([['developers_hired', 'olumi'], ['tech_leads_hired', 'olumi']]);
    expect([...r.values()].filter((c) => c.asked === true).map((c) => [c.id, c.group])).toEqual([['developer_hiring_cost', 'other'], ['tech_lead_hiring_cost', 'other']]);
    // Contrast (right before, unchanged): the person's own figure is theirs, with neither mark.
    expect(r.get('current_developers')).toMatchObject({ author: 'person', group: 'used', family: 'quantity' });
    expect(r.get('current_developers')).not.toHaveProperty('structure');
    expect(r.get('current_developers')).not.toHaveProperty('asked');
  });

  it('capacity-s4\'s zero is structure; a disagreement is a disagreement, not only its holder\'s name', () => {
    const s = saved('capacity-s4.saved.json');
    expect(rows(s.model, s.brief).get('zero_additional_capacity')).toMatchObject({ family: 'quantity', structure: true });
    const m = club();
    m.dissent.push({ id: 'partner_doubts', holder: 'my business partner', position: 'The promotion will not bring anyone in.', concerns: ['promo_effect'], author: 'person', quote: 'my business partner thinks the promotion will not work', ...at });
    const d = rows(m, `${CLUB_BRIEF} But my business partner thinks the promotion will not work.`).get('partner_doubts')!;
    expect([d.kind, d.family, d.label]).toEqual(['record', 'dissent', 'my business partner']);
  });
});
