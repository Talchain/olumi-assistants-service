/**
 * ⭐ AX1 — the arithmetic answer when the analysis cannot rank a price × volume goal (DL #70 5850280205).
 *
 * FIXTURE: the served model DL's joined run `f-20260926T201724Z` ran on at 05-F8-run (graph_hash 783e01ff): MRR carries
 * the product identity Pro plan price × Pro paying subscribers (inferred, not stated in the brief), today's price is
 * £49 (the brief's), today's subscribers 300 (Olumi's figure, approved as an assumption), and the options set £59 (brief), £54 (Olumi's)
 * and £49 (brief). That Run's reply led with "No option can be put forward…" and gave no arithmetic at all.
 *
 * Expected figures, by hand: 49 × 300 = 14,700. 14,700 ÷ 59 = 249.2 → 250 must stay (a loss of at most 50);
 * 14,700 ÷ 54 = 272.2 → 273. The £20,000 target: ÷ 59 = 339.0 → 339; ÷ 54 = 370.4 → 371; ÷ 49 = 408.2 → 409.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { breakEvenFor, breakEvenLine, goalNotCheckedLine, withBreakEvenAnswer } from '../break-even.js';
import { deriveEmittedGoalDirection } from '../../goal-target/goal-direction.js';
import { nonlinearIdentityForAgent } from '../admit-model.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-f8-run-graph-d6b09c0.json', import.meta.url), 'utf8')) as { nodes: Record<string, unknown>[]; edges: unknown[] };
const graph = (change?: (nodes: Record<string, unknown>[]) => void) => {
  const g = structuredClone(served);
  change?.(g.nodes);
  return g;
};
const node = (nodes: Record<string, unknown>[], id: string) => nodes.find((n) => n.id === id)!;

describe('AX1: the price × volume arithmetic on the served F8 model', () => {
  it('RED (served F8): today, the break-even subscribers per price, and the subscribers the £20,000 target needs — each figure\'s owner named', () => {
    const be = breakEvenFor(graph());
    expect(be).toEqual({
      goal: 'MRR', goal_id: 'mrr',
      price_factor: 'Pro plan price', price_factor_id: 'pro_plan_price',
      volume_factor: 'Pro paying subscribers', volume_factor_id: 'pro_paying_subscribers',
      unit: 'GBP/month',
      identity_stated_in_brief: false,
      baseline_price: 49, baseline_price_by: 'user', baseline_volume: 300, baseline_volume_by: 'approved', baseline_goal: 14_700,
      options: [
        { option: 'Raise Pro to £59', option_id: 'raise_pro_to_59', price: 59, price_by: 'user', keep_at_least: 250 },
        { option: 'Hold £49 with AI release', option_id: 'hold_49_with_ai_release', price: 49, price_by: 'user' },
        { option: 'Raise Pro to £54', option_id: 'raise_pro_to_54', price: 54, price_by: 'olumi', keep_at_least: 273 },
      ],
      target: { value: 20_000, needs: [{ price: 59, volume: 339 }, { price: 54, volume: 371 }, { price: 49, volume: 409 }] },
    });
  });

  it('RED (served F8): the paragraph the user reads answers the question, with the figures and whose they are', () => {
    const said = breakEvenLine(breakEvenFor(graph())!);
    expect(said).toContain('If MRR is Pro plan price × Pro paying subscribers (Olumi’s reading of your goal)');
    expect(said).toContain('at £49/month and 300 Pro paying subscribers (an assumption you approved), MRR is £14,700/month today.');
    expect(said).toContain('At £59/month, MRR stays at least that while 250 or more of the 300 stay (a loss of at most 50).');
    expect(said).toContain('At £54/month (Olumi’s estimate), MRR stays at least that while 273 or more');
    expect(said).toContain('£20,000/month needs 339 at £59/month, 371 at £54/month or 409 at £49/month.');
    expect(said).toContain('not the analysis ranking the options');
  });

  it('RED (served 263dbd5, run 053159Z): a PER-SUBSCRIBER price writes totals per month, and the £20,000 line stays', () => {
    const be = breakEvenFor(graph((ns) => { (node(ns, 'pro_plan_price').observed_state as Record<string, unknown>).unit = 'GBP/subscriber/month'; }))!;
    expect(be.target, 'a "GBP/month" target meets a per-subscriber price').toBeDefined();
    const said = breakEvenLine(be);
    expect(said).toContain('at £49/subscriber/month and 300 Pro paying subscribers (an assumption you approved), MRR is £14,700/month today.');
    expect(said).toContain('At £59/subscriber/month, MRR stays at least that while 250 or more of the 300 stay');
    expect(said).toContain('£20,000/month needs 339 at £59/subscriber/month, 371 at £54/subscriber/month or 409 at £49/subscriber/month.');
    expect(said).not.toMatch(/£[\d,]+\/subscriber\/month (?:today|needs)/);
  });

  it('RED (the served graph itself, 053159Z/01): the break-even the wire carried, now with totals per month and the target line', () => {
    const wire = JSON.parse(readFileSync(new URL('./fixtures/served-per-subscriber-price-263dbd5.json', import.meta.url), 'utf8')) as { nodes: unknown[]; edges: unknown[] };
    const be = breakEvenFor(wire)!;
    // PRECONDITION: this is the served shape — the wire's `_agent.break_even` carried this unit and today's figure.
    expect(be).toMatchObject({ unit: 'GBP/subscriber/month', baseline_price: 49, baseline_volume: 200, baseline_goal: 9_800 });
    const said = breakEvenLine(be);
    expect(said).toContain('MRR is £9,800/month today.');
    expect(said).not.toContain('£9,800/subscriber/month');
    expect(said).toContain('£20,000/month needs 339 at £59/subscriber/month');
  });

  it('CONTRAST (the other served run, 053639Z/01, price GBP/month): the paragraph is byte-identical to what the wire carried', () => {
    const f = JSON.parse(readFileSync(new URL('./fixtures/served-per-month-price-263dbd5.json', import.meta.url), 'utf8')) as { served_paragraph: string; nodes: unknown[]; edges: unknown[] };
    expect(breakEvenLine(breakEvenFor(f)!)).toBe(f.served_paragraph);
  });

  it('RED (MG B1): a numbered period stays — "GBP per subscriber per 12 months" gives a readable total, not "GBP months"', () => {
    const said = breakEvenLine(breakEvenFor(graph((ns) => {
      (node(ns, 'pro_plan_price').observed_state as Record<string, unknown>).unit = 'GBP per subscriber per 12 months';
    }))!);
    expect(said).toContain('MRR is £14,700/12 months today.');
    expect(said).not.toContain('GBP months');
  });

  it('CONTRAST: "GBP per seat per month" drops only the seat; a price with no per-unit word is unchanged', () => {
    const perSeat = breakEvenLine(breakEvenFor(graph((ns) => {
      (node(ns, 'pro_plan_price').observed_state as Record<string, unknown>).unit = 'GBP per seat per month';
      node(ns, 'mrr').goal_threshold_unit = 'GBP per month';
    }))!);
    expect(perSeat).toContain('at £49/seat/month and 300');
    expect(perSeat).toContain('MRR is £14,700/month today.');
    expect(perSeat).toContain('£20,000/month needs 339');
    expect(breakEvenLine(breakEvenFor(graph())!)).toContain('at £49/month and 300 Pro paying subscribers (an assumption you approved), MRR is £14,700/month today.');
  });

  it('CONTRAST: no product identity on the goal → nothing (an additive goal is the analysis\'s to answer)', () => {
    expect(breakEvenFor(graph((ns) => { delete node(ns, 'mrr').nonlinear_identity; }))).toBeNull();
  });

  it('ROW B (C46 × R3-4, Canonical criterion 1): the engine EVALUATED the product on this run → no "adds those effects up" arithmetic', () => {
    // The leader is withheld for ANOTHER reason (a limit): the Agent-view reading is `reasonNamesIt: false`.
    const evaluated: ReadonlySet<string> = new Set(['mrr']);
    const today = breakEvenFor(graph());
    const todayFinding = nonlinearIdentityForAgent(graph(), false);
    expect(today, 'premise: today the arithmetic answers').not.toBeNull();
    expect(todayFinding, 'premise: today the product is said beside a limit').not.toBeNull();
    expect(breakEvenFor(graph(), evaluated)).toBeNull();
    expect(nonlinearIdentityForAgent(graph(), false, evaluated)).toBeNull();
    // CONTRAST: no set, or a set naming another node, is today's answer exactly.
    expect(breakEvenFor(graph(), undefined)).toEqual(today);
    expect(breakEvenFor(graph(), new Set(['pro_paying_subscribers']))).toEqual(today);
    expect(nonlinearIdentityForAgent(graph(), false, new Set(['pro_paying_subscribers']))).toEqual(todayFinding);
  });

  it('CONTRAST: a figure that is not exact or not anyone\'s → nothing, never an approximate answer', () => {
    expect(breakEvenFor(graph((ns) => { (node(ns, 'pro_paying_subscribers').observed_state as Record<string, unknown>).raw_value = undefined; }))).toBeNull();
    expect(breakEvenFor(graph((ns) => { (node(ns, 'pro_plan_price').observed_state as Record<string, unknown>).source = 'unknown_source'; }))).toBeNull();
  });

  it('CONTRAST: a target in another unit gives no target line (the break-even still stands)', () => {
    const be = breakEvenFor(graph((ns) => { node(ns, 'mrr').goal_threshold_unit = 'GBP/year'; }));
    expect(be?.target).toBeUndefined();
    expect(be?.options[0]).toMatchObject({ keep_at_least: 250 });
  });

  /**
   * MG's maths review (#2051 5850436075, Model Generation 71229dfd): three input shapes stated a false figure. Adopted
   * verbatim as RED rows (P1, P2, P4); P3 pins the exact-division boundary.
   */
  it('RED (MG P1): a DELTA-framed target ("grow MRR by £5,000/month") is not stated as an absolute £5,000 target', () => {
    const be = breakEvenFor(graph((ns) => { const g = node(ns, 'mrr'); g.goal_threshold_frame = 'delta'; g.goal_threshold_raw = 5000; }));
    expect(be).not.toBeNull();
    expect(be!.target === undefined || be!.target.value === 19_700).toBe(true);
  });

  it('RED (MG P1, fail-closed): a target with no stated frame is not assumed to be a level', () => {
    const be = breakEvenFor(graph((ns) => { delete node(ns, 'mrr').goal_threshold_frame; }));
    expect(be).not.toBeNull();
    expect(be!.target).toBeUndefined();
  });

  it('RED (MG P2): a goal to REDUCE gets no "stays at least that" / "needs" answer', () => {
    const g = graph((ns) => { node(ns, 'mrr').label = 'Reduce monthly hosting cost'; });
    expect(deriveEmittedGoalDirection(g, 'mrr')).toBe('minimise');
    expect(breakEvenFor(g)).toBeNull();
  });

  // MG #72 5870097103: the one direction authority reads the comparator the user stated before the label, so a goal
  // that HOLDS a ceiling is a goal to reduce here too — whatever its label says (the run minimises it).
  it('RED (held ceiling): a goal holding `<=` gets no "stays at least that" / "needs" answer, label unchanged', () => {
    const g = graph((ns) => { node(ns, 'mrr').goal_direction = '<='; });
    // RT-10 (Science 5 Oct (1)): a held ceiling on a target typed a level is SENT as minimise with no stated level, and
    // break-even stays silent on the held ceiling itself (its floor words would read backwards).
    expect(deriveEmittedGoalDirection(g, 'mrr')).toBe('minimise');
    expect(breakEvenFor(g)).toBeNull();
    // CONTROL: a held floor keeps the served answer.
    expect(breakEvenFor(graph((ns) => { node(ns, 'mrr').goal_direction = '>='; }))).not.toBeNull();
  });

  it('BOUNDARY (MG P3): exact division — 14,700 ÷ £60 = 245 exactly → keep 245, not 246', () => {
    const be = breakEvenFor(graph((ns) => { (node(ns, 'raise_pro_to_59').interventions as Record<string, unknown>).pro_plan_price = { value: 0.3, source: 'brief_extraction' }; }));
    expect(be!.options[0]).toMatchObject({ price: 60, keep_at_least: 245 });
  });

  it('RED (MG P4): a volume that is not a count (a % rate) is never multiplied by a price', () => {
    expect(breakEvenFor(graph((ns) => { (node(ns, 'pro_paying_subscribers').observed_state as Record<string, unknown>).unit = '%'; }))).toBeNull();
    expect(breakEvenFor(graph((ns) => { (node(ns, 'pro_paying_subscribers').observed_state as Record<string, unknown>).unit = ''; }))).toBeNull();
  });

  /** The served build-turn reply on `6ff7bc9` (#70 5851078813), verbatim up to the parked questions. */
  const SERVED_FIRST = 'Not yet\u2014the provisional first pass cannot establish which choice improves MRR.\n\n- I modelled your target as **\u00a320k Pro-plan MRR** and churn at **10% or less**; confirm if \u00a320k means all-plan MRR instead.\n\nI saved the model I drafted. The figures above are not recorded until you approve them. Questions this model does not answer yet: Which did you mean? Ask me for the other 11. The analysis can run now.';

  it('RED (served 6ff7bc9): the arithmetic follows the model\'s lead, before the bullets, the save line and the questions', () => {
    const para = breakEvenLine(breakEvenFor(graph())!);
    const said = withBreakEvenAnswer(SERVED_FIRST, breakEvenFor(graph())!);
    expect(said.startsWith(`Not yet\u2014the provisional first pass cannot establish which choice improves MRR.\n\n${para}\n\n- I modelled`)).toBe(true);
    expect(said.indexOf(para)).toBeLessThan(said.indexOf('Questions this model does not answer yet'));
  });

  it('CONTRAST: a one-paragraph reply gets the arithmetic at the end, and nothing is lost', () => {
    const para = breakEvenLine(breakEvenFor(graph())!);
    expect(withBreakEvenAnswer('No option can be put forward on MRR yet.', breakEvenFor(graph())!)).toBe(`No option can be put forward on MRR yet.\n\n${para}`);
  });

  /** F3 (DL #70 5851710093): the run brief's typed reason, as the served `013636Z/01` carried it. */
  const NOT_CONVERTIBLE = { type: 'analysis_result', enrichment: { decision_brief: {
    warning_codes: ['CONSTRAINT_NOT_CONVERTIBLE', 'GOAL_THRESHOLD_NOT_CONVERTIBLE'],
    warnings: [{ code: 'GOAL_THRESHOLD_NOT_CONVERTIBLE', field: 'nodes[mrr].observed_state.baseline' }] } } };

  it('RED (F3, served 013636Z): an unscored goal target is named, with why, from the typed reason and the stored target', () => {
    expect(goalNotCheckedLine(graph(), NOT_CONVERTIBLE))
      .toBe('Your MRR target of \u00a320,000/month is not checked yet: the model has no current MRR figure to measure it against.');
  });

  it('CONTRAST (F3, R&C B1): a goal that HAS a current figure is named with no cause — the code has seven reasons', () => {
    const said = goalNotCheckedLine(graph((ns) => { node(ns, 'mrr').observed_state = { baseline: 0.49, raw_value: 9800, unit: 'GBP/month' }; }), NOT_CONVERTIBLE);
    expect(said).toBe('Your MRR target of \u00a320,000/month was not checked in this analysis.');
    expect(said).not.toContain('no current');
  });

  it('RED (served 0592c43): a target stored as "GBP per month" reads as the reply\'s own money, not "20,000 GBP per month"', () => {
    expect(goalNotCheckedLine(graph((ns) => { node(ns, 'mrr').goal_threshold_unit = 'GBP per month'; }), NOT_CONVERTIBLE))
      .toBe('Your MRR target of \u00a320,000/month is not checked yet: the model has no current MRR figure to measure it against.');
  });

  it('CONTRAST: a unit that is not a known currency is written as stored, "per" and all', () => {
    expect(goalNotCheckedLine(graph((ns) => { node(ns, 'mrr').goal_threshold_unit = 'seats per month'; }), NOT_CONVERTIBLE))
      .toBe('Your MRR target of 20,000 seats per month is not checked yet: the model has no current MRR figure to measure it against.');
  });

  it('CONTRAST (F3): no typed reason, or no stated target, says nothing — never a guess', () => {
    expect(goalNotCheckedLine(graph(), { type: 'analysis_result', enrichment: { decision_brief: { warning_codes: ['EVPI_UNAVAILABLE'] } } })).toBeNull();
    expect(goalNotCheckedLine(graph((ns) => { delete node(ns, 'mrr').goal_threshold_raw; }), NOT_CONVERTIBLE)).toBeNull();
  });
});

/**
 * A5 · result refs by label (CEE half), DL #70 5855437928. `_agent.break_even` named every option, the goal and both
 * factors by LABEL only; labels collide and get renamed, so each now carries its graph ID beside the label. The
 * labels are unchanged. FIXTURE: served staging bundle paul-08bf9a1f (CEE 263dbd5): its draft_graph and the
 * `_agent.break_even` the wire carried (see `_source`).
 */
describe('A5: `_agent.break_even` carries graph ids beside its labels', () => {
  const wire = JSON.parse(readFileSync(new URL('./fixtures/served-break-even-08bf9a1f.json', import.meta.url), 'utf8')) as {
    nodes: { id: string; kind: string; label?: string }[]; edges: unknown[]; served_break_even: Record<string, unknown>;
  };
  const be = () => breakEvenFor({ nodes: wire.nodes, edges: wire.edges })!;
  const nodeById = (id: string) => wire.nodes.find((n) => n.id === id);
  const ID_KEYS = new Set(['goal_id', 'price_factor_id', 'volume_factor_id', 'option_id']);
  /** The wire bytes with the four id keys dropped, every other key in its own place. */
  const labelBytes = (b: unknown) => JSON.stringify(b, (k, v: unknown) => (ID_KEYS.has(k) ? undefined : v));

  it('PIN (served 263dbd5): with the ids set aside, the break-even is byte-identical to what the wire carried', () => {
    expect(labelBytes(be())).toBe(JSON.stringify(wire.served_break_even));
  });

  it('RED (served 263dbd5): each option row carries the id of the graph option it was computed from', () => {
    const rows = be().options;
    expect(rows.map((r) => r.option_id)).toEqual(['features_pro_price_rise', 'pro_price_rise_only']);
    for (const r of rows) {
      const n = nodeById(r.option_id);
      expect(n?.kind, r.option_id).toBe('option');
      expect(n?.label).toBe(r.option);
    }
  });

  it('RED (served 263dbd5): the goal and both factors carry their graph ids, each bound to its own label', () => {
    const b = be();
    expect([b.goal_id, b.price_factor_id, b.volume_factor_id]).toEqual(['mrr', 'pro_plan_price', 'pro_paying_subscribers']);
    expect(nodeById(b.goal_id)).toMatchObject({ kind: 'goal', label: b.goal });
    expect(nodeById(b.price_factor_id)).toMatchObject({ kind: 'factor', label: b.price_factor });
    expect(nodeById(b.volume_factor_id)).toMatchObject({ kind: 'factor', label: b.volume_factor });
  });
});
