/**
 * ⭐ G4/G5 PHASE 2, CEE P2b (DL 0df0e1 rulings 1–6; design-g4g6 Q7) — the `GOAL_CHANCE_LICENSED` record carries, per
 * licensed option, its main driver or the typed reason it has none, the display step of its chance, and the superlative
 * gate reads the chances' precision. Fixtures are the RULED ISL shape (isl-4d §1–2 + R1–R4), hand-written: ISL and PLoT do
 * not emit it yet. The graph is the Run's own (`graphForAnalysis`): rt10b with a stated ceiling.
 *
 * RED rows (DL brief): resolved top → driver with its falling side and cut; below_resolution → no_driver; correlated top
 * with a resolved second row → no_driver `correlated` (mutant: falling back to row 2 goes RED); Olumi-prior existence →
 * olumi; user-stated link → user; rounding at half-width 2.4 vs 2.6; overlapping intervals → no superlative.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { goalChanceLicenceOf, withGoalChanceLicence, GOAL_CHANCE_LICENSED } from '../goal-chance-licence.js';
import { displayedPctAt, wilsonHalfWidthPoints } from '../goal-chance-driver.js';
import { analysisResultForAgent } from '../../agent-lane/decision-sensitivity.js';
import { keyDesignatesLeadingOption, textNamesLeadingOption, textAssertsLeadingOption } from '../../compose/leading-option-egress-guard.js';
import { keyDesignatesOrdinalPosition } from '../../compose/withheld-claim-projection.js';

type Json = Record<string, any>;
const RT10B = JSON.parse(readFileSync(new URL('../../tools/handlers/__tests__/fixtures/bprime-rt10b.json', import.meta.url), 'utf8')) as {
  graph_with_target: Json;
};
const GOAL = 'monthly_cancellations';
/** The Run's graph, with one link the user sized ("user_specified") and nothing else changed. */
const runGraph = (): Json => {
  const g = structuredClone(RT10B.graph_with_target);
  g.edges.push({ from: 'active_customers', to: 'late_delivery_cancellations', exists_probability: 0.8,
    strength: { mean: 0.3, std: 0.15 }, provenance: { source: 'user_specified' } });
  return g;
};
const G = runGraph();

// ── the ruled ISL shape ─────────────────────────────────────────────────────────────────────────────────────────────────
const precision = (p: number, lo: number, hi: number, n = 1000): Json => ({
  basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95,
  n_informative: n, n_met: Math.round(p * n), interval_lower: lo, interval_upper: hi,
});
const factorRow = (over: Json = {}): Json => ({
  quantity_id: 'active_customers', kind: 'factor_value', p_goal_if_low: 0.30, p_goal_if_high: 0.55, n_low: 333, n_high: 333,
  spread: 0.25, status: 'resolved', spread_noise_floor: 0.08, correlated: false,
  low_upper_value: 0.35, low_upper_value_display: 7000, high_lower_value: 0.45, high_lower_value_display: 9000, ...over,
});
const strengthRow = (from: string, to: string, over: Json = {}): Json => ({
  quantity_id: `${from}->${to}`, from, to, kind: 'link_strength', p_goal_if_low: 0.30, p_goal_if_high: 0.50, n_low: 300, n_high: 300,
  spread: 0.2, status: 'resolved', spread_noise_floor: 0.08, correlated: false, low_upper_value: 0.2, high_lower_value: 0.4, ...over,
});
const existenceRow = (from: string, to: string, over: Json = {}): Json => ({
  quantity_id: `${from}->${to}`, from, to, kind: 'link_existence', p_goal_if_absent: 0.20, p_goal_if_present: 0.50,
  n_absent: 200, n_present: 800, spread: 0.3, status: 'resolved', spread_noise_floor: 0.09, ...over,
});
const driversBlock = (rows: Json[]): Json => ({
  method: 'tercile_conditional_v1', min_group_n: 30, n_candidates: rows.length, n_compared: rows.length, n_dropped: 0,
  dropped_by_reason: {}, drivers: rows,
});
const opt = (id: string, p: number, extra: Json = {}): Json => ({ option_id: id, id, probability_of_goal: p, win_probability: 0.5, ...extra });
const env = (...rows: Json[]): Json => ({ option_comparison: rows, inference_warnings: [] });
const licence = (e: Json, graph: Json = G): Json => goalChanceLicenceOf(e, graph, GOAL) as unknown as Json;

describe('P2b ruling 1–2 — the main driver is the TOP row only, quoted on the side where the chance falls', () => {
  it('RED: a resolved top factor row → its driver, the LOW side (0.30 < 0.55), the low cut in the user\'s units (*_display)', () => {
    const l = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([factorRow()]) }), opt('b', 0.41)));
    expect(l.driver_by_option.a).toMatchObject({ quantity_id: 'active_customers', kind: 'factor_value', factor_id: 'active_customers',
      side: 'low', cut_value: 7000 });
    // The falling side's own chance at that group's own step (n = 333 → Wilson half-width > 2.5 → nearest 5).
    expect(wilsonHalfWidthPoints(0.30, 333)).toBeGreaterThan(2.5);
    expect(l.driver_by_option.a).toMatchObject({ pct_if_side: 30, pct_if_side_rounding: 'nearest_5' });
    // Every licensed option is in exactly one map once the producer emits blocks: b has none to read.
    expect(l.no_driver_by_option).toEqual({ b: 'none' });
  });

  it('the HIGH side when the chance falls there (0.60 → 0.20), with the high cut; no *_display → the row\'s own value', () => {
    const row = factorRow({ p_goal_if_low: 0.60, p_goal_if_high: 0.20, high_lower_value_display: undefined, high_lower_value: 0.45 });
    const l = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([row]) }), opt('b', 0.41)));
    expect(l.driver_by_option.a).toMatchObject({ side: 'high', cut_value: 0.45 });
  });

  it('RED: a below_resolution top row → no_driver below_resolution, never the resolved row under it', () => {
    const rows = [factorRow({ status: 'below_resolution', spread: 0.07 }), strengthRow('active_customers', 'late_delivery_cancellations', { spread: 0.05 })];
    const l = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock(rows) }), opt('b', 0.41)));
    expect(l.no_driver_by_option).toMatchObject({ a: 'below_resolution' });
    expect(l).not.toHaveProperty('driver_by_option');
  });

  it('RED: a CORRELATED top row with a RESOLVED second row → no_driver correlated (never steps down to row 2)', () => {
    const rows = [factorRow({ correlated: true }), strengthRow('active_customers', 'late_delivery_cancellations', { spread: 0.2 })];
    const l = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock(rows) }), opt('b', 0.41)));
    expect(l.no_driver_by_option).toMatchObject({ a: 'correlated' });
    expect(l).not.toHaveProperty('driver_by_option');
  });

  it('the TOP row is the largest spread whatever the producer\'s order (ISL\'s own rank: spread, then kind, then id)', () => {
    const rows = [strengthRow('active_customers', 'late_delivery_cancellations', { spread: 0.1 }), factorRow({ correlated: true, spread: 0.25 })];
    expect(licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock(rows) }), opt('b', 0.41))).no_driver_by_option)
      .toMatchObject({ a: 'correlated' });
  });

  it('a resolved factor row with no cut on its falling side → no_cut_value', () => {
    const row = factorRow({ low_upper_value: undefined, low_upper_value_display: undefined });
    expect(licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([row]) }), opt('b', 0.41))).no_driver_by_option)
      .toMatchObject({ a: 'no_cut_value' });
  });

  it('S3: a top factor the option ITSELF sets (its own intervention) → no_driver set_by_option', () => {
    const row = factorRow({ quantity_id: 'loyalty_discount_rate' });
    const l = licence(env(opt('15_loyalty_discount', 0.62, { probability_of_goal_drivers: driversBlock([row]) }), opt('b', 0.41)));
    expect(l.no_driver_by_option).toMatchObject({ '15_loyalty_discount': 'set_by_option' });
  });

  it('a WITHHELD option never gets a driver claim (driver keys ⊆ licensed ids)', () => {
    const l = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([factorRow()]) }),
      { option_id: 'w', id: 'w', probability_of_goal_drivers: driversBlock([factorRow()]) }, opt('b', 0.41)));
    expect(l.withheld_option_ids).toEqual(['w']);
    expect(Object.keys({ ...l.driver_by_option, ...l.no_driver_by_option }).sort()).toEqual(['a', 'b']);
  });

  it('CONTROL (today\'s Runs): no record carries a driver or precision block → the record is exactly as before', () => {
    const l = licence(env(opt('a', 0.62), opt('b', 0.41)));
    for (const k of ['driver_by_option', 'no_driver_by_option', 'display_rounding_by_option']) expect(l).not.toHaveProperty(k);
    expect(l).toMatchObject({ form: 'highest', pct_by_option: { a: 62, b: 41 } });
  });
});

describe('P2b rulings 3–4 — link drivers carry no number; authorship from the Run\'s own graph', () => {
  it('RED: an existence driver on an Olumi-prior link (0.8, unheld, Olumi\'s relationship) → authored_by olumi, the ABSENT side', () => {
    const row = existenceRow('loyalty_discount_rate', GOAL);
    const l = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([row]) }), opt('b', 0.41)));
    expect(l.driver_by_option.a).toMatchObject({ kind: 'link_existence', from: 'loyalty_discount_rate', to: GOAL, side: 'absent',
      authored_by: 'olumi', user_stated_link: false });
  });

  it('RED: a strength driver on the USER\'s sized link → authored_by user; weaker (low side of a positive link); NO number', () => {
    const row = strengthRow('active_customers', 'late_delivery_cancellations');
    const d = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([row]) }), opt('b', 0.41))).driver_by_option.a;
    expect(d).toMatchObject({ kind: 'link_strength', side: 'low', strength: 'weaker', authored_by: 'user', user_stated_link: true });
    expect(Object.entries(d).filter(([, v]) => typeof v === 'number')).toEqual([]);
  });

  it('a strength driver on Olumi\'s estimated NEGATIVE link: the low draws are STRONGER (more negative) → stronger, olumi', () => {
    const row = strengthRow('courier_on_time_delivery_rate', 'late_delivery_cancellations');
    const d = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([row]) }), opt('b', 0.41))).driver_by_option.a;
    expect(d).toMatchObject({ side: 'low', strength: 'stronger', authored_by: 'olumi' });
  });

  it('W3 / case E: the USER\'s link with Olumi\'s existence doubt → the doubt is olumi\'s, the link the user\'s', () => {
    const row = existenceRow('active_customers', 'late_delivery_cancellations');
    const d = licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([row]) }), opt('b', 0.41))).driver_by_option.a;
    expect(d).toMatchObject({ authored_by: 'olumi', user_stated_link: true });
  });

  it('a factor driver: an INFERRED value is olumi; the user\'s range (spread_source user, the Run\'s factor_evppi) is user; unknown is unattributed', () => {
    const at = (factor: string, evppi: Json[] | undefined): string => licence({
      ...env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([factorRow({ quantity_id: factor })]) }), opt('b', 0.41)),
      ...(evppi !== undefined ? { factor_evppi: evppi } : {}),
    }).driver_by_option.a.authored_by;
    expect(at('annual_incremental_courier_cost', undefined)).toBe('olumi'); // observed_state.source cee_inference
    expect(at('active_customers', [{ factor_id: 'active_customers', spread_source: 'user' }])).toBe('user');
    expect(at('active_customers', [{ factor_id: 'active_customers', spread_source: 'template' }])).toBe('olumi');
    expect(at('active_customers', undefined)).toBe('unattributed'); // never claimed as Olumi's
  });

  it('a link the Run\'s own graph does not carry → no_driver none (no attribution is guessed)', () => {
    const row = existenceRow('nowhere', GOAL);
    expect(licence(env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([row]) }), opt('b', 0.41))).no_driver_by_option)
      .toMatchObject({ a: 'none' });
  });
});

describe('P2b ruling 5 — the display step follows the chance\'s own precision', () => {
  it.each([
    ['half-width 2.4 points → whole', 0.406, 0.454, 'whole', 43],
    ['half-width 2.6 points → nearest 5', 0.404, 0.456, 'nearest_5', 45],
  ] as const)('RED: %s', (_n, lo, hi, step, shown) => {
    const l = licence(env(opt('a', 0.43, { probability_of_goal_precision: precision(0.43, lo, hi) }),
      opt('b', 0.20, { probability_of_goal_precision: precision(0.20, 0.19, 0.21) })));
    expect(l.display_rounding_by_option).toEqual({ a: step, b: 'whole' });
    expect(l.pct_by_option).toEqual({ a: shown, b: 20 });
  });

  it('a nearest-5 step never shows 0 or 100 for a chance strictly between them', () => {
    expect([displayedPctAt(0.02, 'nearest_5'), displayedPctAt(0.98, 'nearest_5'), displayedPctAt(0, 'nearest_5'), displayedPctAt(1, 'nearest_5')])
      .toEqual([5, 95, 0, 100]);
  });

  it('a malformed precision block (interval not containing the figure) is not read: displayed whole, no step recorded', () => {
    const l = licence(env(opt('a', 0.43, { probability_of_goal_precision: precision(0.43, 0.30, 0.40) }), opt('b', 0.20)));
    expect(l.pct_by_option.a).toBe(43);
    expect(l).not.toHaveProperty('display_rounding_by_option');
  });
});

describe('P2b ruling 6 — the superlative also needs the Wilson intervals NOT to overlap', () => {
  const narrow = (p: number): Json => precision(p, p - 0.02, p + 0.02, 2000);
  it('CONTROL: 62 vs 45, distinct intervals → highest', () => {
    const l = licence(env(opt('a', 0.62, { probability_of_goal_precision: narrow(0.62) }), opt('b', 0.45, { probability_of_goal_precision: narrow(0.45) })));
    expect(l).toMatchObject({ form: 'highest', leader_option_id: 'a' });
  });

  it('RED: 60 vs 45 (≥ 10 points) but OVERLAPPING intervals → no superlative: similar, both named, nobody ranked', () => {
    const l = licence(env(opt('a', 0.62, { probability_of_goal_precision: precision(0.62, 0.50, 0.74, 60) }),
      opt('b', 0.45, { probability_of_goal_precision: precision(0.45, 0.33, 0.57, 60) })));
    expect(l.pct_by_option.a - l.pct_by_option.b).toBeGreaterThanOrEqual(10);
    expect(l).toMatchObject({ form: 'similar', similar_option_ids: ['a', 'b'] });
    expect(l).not.toHaveProperty('leader_option_id');
  });

  it('the leader must be distinct from EVERY other option, not only the next (a wide third interval reaching the top)', () => {
    const l = licence(env(opt('a', 0.62, { probability_of_goal_precision: narrow(0.62) }), opt('b', 0.50, { probability_of_goal_precision: narrow(0.50) }),
      opt('c', 0.40, { probability_of_goal_precision: precision(0.40, 0.20, 0.61, 30) })));
    expect(l.form).not.toBe('highest');
    expect(l).not.toHaveProperty('leader_option_id');
  });

  it('one record carries precision and another does not → no superlative (fail closed)', () => {
    const l = licence(env(opt('a', 0.62, { probability_of_goal_precision: narrow(0.62) }), opt('b', 0.41)));
    expect(l.form).not.toBe('highest');
  });
});

describe('P2b — every new word passes the leader guards; the Agent never reads a driver claim', () => {
  const full = (): Json => licence({
    ...env(opt('a', 0.62, { probability_of_goal_precision: precision(0.62, 0.50, 0.74, 60),
      probability_of_goal_drivers: driversBlock([strengthRow('active_customers', 'late_delivery_cancellations')]) }),
    opt('b', 0.45, { probability_of_goal_precision: precision(0.45, 0.33, 0.57, 60),
      probability_of_goal_drivers: driversBlock([factorRow({ status: 'below_resolution' })]) })),
  });

  it('no new key designates a leader or an ordinal, and no new value names one', () => {
    const l = full();
    const keys = new Set<string>(['display_rounding_by_option', 'driver_by_option', 'no_driver_by_option']);
    const values = new Set<string>(['whole', 'nearest_5', 'below_resolution', 'correlated', 'set_by_option', 'no_cut_value', 'none',
      'user', 'olumi', 'unattributed', 'low', 'high', 'absent', 'present', 'weaker', 'stronger', 'factor_value', 'link_strength', 'link_existence']);
    for (const d of Object.values(l.driver_by_option as Json)) for (const [k, v] of Object.entries(d as Json)) {
      keys.add(k);
      if (typeof v === 'string') values.add(v);
    }
    for (const k of keys) {
      expect(keyDesignatesLeadingOption(k), k).toBe(false);
      expect(keyDesignatesOrdinalPosition(k), k).toBe(false);
    }
    for (const v of values) {
      expect(textNamesLeadingOption(v), v).toBe(false);
      expect(textAssertsLeadingOption(v), v).toBe(false);
    }
    expect(l.message).toBe('Each option’s chance of meeting your goal is licensed on this Run.'); // no new words
  });

  it('the Agent\'s view drops driver_by_option / no_driver_by_option from the licence in BOTH carriers; the rest stays', () => {
    const l = full();
    expect(l).toHaveProperty('driver_by_option');
    const block = { type: 'analysis_result', inference_warnings: [l], enrichment: { option_comparison: [], inference_warnings: [l] } };
    const out = analysisResultForAgent(block) as Json;
    for (const carried of [out.inference_warnings[0], out.enrichment.inference_warnings[0]]) {
      expect(carried).not.toHaveProperty('driver_by_option');
      expect(carried).not.toHaveProperty('no_driver_by_option');
      expect(carried).toMatchObject({ code: GOAL_CHANCE_LICENSED, form: l.form, pct_by_option: l.pct_by_option });
    }
    expect(block.inference_warnings[0]).toHaveProperty('driver_by_option'); // the user-facing record is untouched
  });

  it('withGoalChanceLicence stores the claims with the Run (the record the turn and the reload both read)', () => {
    const e = env(opt('a', 0.62, { probability_of_goal_drivers: driversBlock([factorRow()]) }), opt('b', 0.41));
    const stored = (withGoalChanceLicence(e, G, GOAL) as Json).inference_warnings.find((w: Json) => w.code === GOAL_CHANCE_LICENSED);
    expect(stored.driver_by_option.a).toMatchObject({ side: 'low', cut_value: 7000 });
  });
});
