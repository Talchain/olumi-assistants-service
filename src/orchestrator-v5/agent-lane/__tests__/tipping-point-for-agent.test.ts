/**
 * ⭐ SCI-HERO (DL 4563ad, #85 5962995335 items 2–3): the Agent reads a run's tipping point as a TYPED fact, in the
 * user's own unit, never more precise than the method states it, and names the option that would then lead only under
 * the ONE leader licence (`claim_permissions.leader_may_be_named`, derived from `leaderLicenceFromState`).
 *
 * Corpus: SERVED blocks, not the author's: Paul's export of graph 0e19bb826dd6fde4 (the analysis_result enrichment as
 * served to the UI; two `found` flips in display units) and Paul's run 17d1cd3a (every flip row `structurally_invariant`,
 * every `factor_evppi` row `below_resolution`): the positive case and the no-signal control. 0 LLM.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analysisResultForAgent, tippingPointOf, type TippingPoint } from '../decision-sensitivity.js';
import { modelFacingToolResult } from '../licensed-run-view.js';
import { HOST_TOOL_CONTRACT } from '../coach-route-v0_2.js';

type Rec = Record<string, unknown>;
const read = (path: string): Rec => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Rec;
const POSITIVE = read('../../../../tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json');
const POSITIVE_ENRICHMENT = POSITIVE.enrichment as Rec;
const CONTROL = read('../../coaching/__tests__/fixtures/paul-run-17d1cd3a-next-move.json').analysis_result as Rec;
const CONTROL_ENRICHMENT = CONTROL.enrichment as Rec;
const rows = (e: Rec): Rec[] => e.flip_thresholds as Rec[];
const withRows = (e: Rec, next: Rec[]): Rec => ({ ...e, flip_thresholds: next });
const block = (enrichment: Rec): Rec => ({ type: 'analysis_result', summary: 'S.', leading_option_id: 'features_pro_price_rise', enrichment });

describe('PRECONDITIONS: the served corpus is what this suite says it is', () => {
  it('positive 0e19bb82: first row is a display-unit flip on Pro plan price, 49 → 55.76 GBP/month, attested winner named', () => {
    const first = rows(POSITIVE_ENRICHMENT)[0]!;
    expect(POSITIVE.graph_hash).toBe('0e19bb826dd6fde4');
    expect(first).toMatchObject({ factor_id: 'pro_plan_price', factor_label: 'Pro plan price', current_value: 49, flip_value: 55.76,
      unit: 'GBP/month', value_scale: 'display', flip_reason: 'found', alternative_winner_id: 'additional_advertising',
      alternative_winner_label: 'Additional advertising' });
  });
  it('control 17d1cd3a: every flip row attested no-flip, every factor_evppi row below resolution', () => {
    expect(rows(CONTROL_ENRICHMENT).length).toBeGreaterThan(0);
    expect(rows(CONTROL_ENRICHMENT).every((r) => r.flip_value === null && r.flip_reason === 'structurally_invariant')).toBe(true);
    expect((CONTROL_ENRICHMENT.factor_evppi as Rec[]).every((r) => r.status === 'below_resolution')).toBe(true);
  });
});

describe('item 2: the typed tipping point (identity-bound to the producer row)', () => {
  it('RED positive: found, bound to factor id + label, threshold in the user’s unit at 2 significant figures', () => {
    const tp = tippingPointOf(POSITIVE_ENRICHMENT) as Extract<TippingPoint, { status: 'found' }>;
    expect(tp).toEqual({
      status: 'found',
      factor_id: 'pro_plan_price',
      label: 'Pro plan price',
      direction: 'increase',
      unit: 'GBP/month',
      current_about: '49 GBP/month',
      threshold_about: '56 GBP/month',
      new_leading_option_id: 'additional_advertising',
      new_leading_option_label: 'Additional advertising',
      other_tipping_points: 1,
      say: 'The comparison could change if Pro plan price crosses about 56 GBP/month (it is 49 GBP/month in this model).',
    });
  });

  it('RED identity: the fact follows the PRODUCER’s first flip row, not a value predicate (swap the order → the other factor)', () => {
    const [a, b, c] = rows(POSITIVE_ENRICHMENT);
    const tp = tippingPointOf(withRows(POSITIVE_ENRICHMENT, [b!, a!, c!])) as Extract<TippingPoint, { status: 'found' }>;
    expect(tp.factor_id).toBe('feature_development_spend');
    expect(tp.threshold_about).toBe('17,000 GBP over 6 months');
    expect(tp.label).toBe('Feature development spend');
  });

  it('RED control: an all-attested no-flip run is `no_flip_in_range`, with NO sentence to repeat', () => {
    expect(tippingPointOf(CONTROL_ENRICHMENT)).toEqual({ status: 'no_flip_in_range' });
    expect(JSON.stringify(analysisResultForAgent(CONTROL))).not.toMatch(/could change if/iu);
  });

  it('RED unit licence: a flip whose value is not attested in display units is below_resolution, never quoted', () => {
    const [a, b, c] = rows(POSITIVE_ENRICHMENT);
    const model = [{ ...a!, value_scale: 'model' }, { ...b!, value_scale: undefined }, c!];
    const tp = tippingPointOf(withRows(POSITIVE_ENRICHMENT, model));
    expect(tp).toEqual({ status: 'below_resolution', factor_id: 'pro_plan_price', label: 'Pro plan price',
      say: 'Pro plan price could change which option leads, but this run cannot say at what value in your units.' });
    expect(JSON.stringify(tp)).not.toMatch(/55\.76|56|17,?330|17,000/u);
  });

  it('RED resolution: a crossing indistinguishable from today’s value at the stated precision is below_resolution', () => {
    const [a] = rows(POSITIVE_ENRICHMENT);
    const tp = tippingPointOf(withRows(POSITIVE_ENRICHMENT, [{ ...a!, current_value: 100.2, flip_value: 100.4 }]));
    expect(tp.status).toBe('below_resolution');
  });

  it('unresolved: rows that neither flip nor attest no-flip (e.g. a search cap) are not "no flip"', () => {
    const [a] = rows(POSITIVE_ENRICHMENT);
    expect(tippingPointOf(withRows(POSITIVE_ENRICHMENT, [{ ...a!, flip_value: null, flip_reason: 'candidate_cap_exceeded' }])))
      .toEqual({ status: 'unresolved' });
  });

  it('not_evaluated: no rows (PLoT ships [] when withheld or unavailable), or no enrichment', () => {
    expect(tippingPointOf(withRows(POSITIVE_ENRICHMENT, []))).toEqual({ status: 'not_evaluated' });
    const { flip_thresholds: _gone, ...rest } = POSITIVE_ENRICHMENT;
    expect(tippingPointOf(rest)).toEqual({ status: 'not_evaluated' });
    expect(tippingPointOf(undefined)).toEqual({ status: 'not_evaluated' });
  });

  it('an echoed label (label === id) is never printed; the identity still rides', () => {
    const [a, b, c] = rows(POSITIVE_ENRICHMENT);
    const tp = tippingPointOf(withRows(POSITIVE_ENRICHMENT, [{ ...a!, alternative_winner_label: 'additional_advertising' }, b!, c!])) as Rec;
    expect(tp.new_leading_option_id).toBe('additional_advertising');
    expect(tp.new_leading_option_label).toBeNull();
  });

  it('analysisResultForAgent carries it beside decision_sensitivity and never mutates its input', () => {
    const before = JSON.stringify(POSITIVE_ENRICHMENT);
    const out = analysisResultForAgent(block(POSITIVE_ENRICHMENT)) as Rec;
    expect((out.tipping_point as Rec).status).toBe('found');
    expect(out.decision_sensitivity).toEqual({ status: 'none_measurable' });
    expect(JSON.stringify(POSITIVE_ENRICHMENT)).toBe(before);
  });
});

describe('item 2: the option that would then lead is named ONLY under the one leader licence', () => {
  const run = (leader_may_be_named: boolean) => modelFacingToolResult('run_analysis', {
    result: analysisResultForAgent(block(POSITIVE_ENRICHMENT)), claim_permissions: { leader_may_be_named },
  }) as { result: { tipping_point: Rec } };

  it('RED withheld: the model-facing view nulls the would-lead identity; the tipping point itself survives', () => {
    const tp = run(false).result.tipping_point;
    expect(tp.new_leading_option_id).toBeNull();
    expect(tp.new_leading_option_label).toBeNull();
    expect(tp.status).toBe('found');
    expect(tp.threshold_about).toBe('56 GBP/month');
    expect(JSON.stringify(tp)).not.toContain('Additional advertising');
  });

  it('CONTROL licensed: the same view keeps it', () => {
    const tp = run(true).result.tipping_point;
    expect(tp.new_leading_option_label).toBe('Additional advertising');
    expect(tp.new_leading_option_id).toBe('additional_advertising');
  });

  it('the say sentence never names an option (it reaches the model on a withheld turn too)', () => {
    const tp = tippingPointOf(POSITIVE_ENRICHMENT) as Rec;
    for (const label of ['Additional advertising', 'Features + Pro price rise', 'Pro price rise only', 'Carry on as now']) {
      expect(String(tp.say)).not.toContain(label);
    }
  });
});

describe('item 3: the say-rule the Agent is given (RC-WHAT-CHANGES wording; ranking-only EVPPI)', () => {
  const contract: string = HOST_TOOL_CONTRACT;
  it('RED: a tipping point comes only from `tipping_point`, as its rounded `say`, with no added precision or probability', () => {
    expect(contract).toContain('Name a tipping point ONLY from the result’s `tipping_point`');
    expect(contract).toContain('never state the value more precisely than its `say`');
    expect(contract).toContain('name the option that would then lead only from a non-null `new_leading_option_label`');
    expect(contract).toContain('when it is `no_flip_in_range`, `unresolved` or `not_evaluated`, make no tipping-point claim');
  });
  it('RED: a measured decision_sensitivity is said as a ranking only — never an amount', () => {
    expect(contract).toContain('as the figure most worth resolving next (a ranking only: never an amount, a money figure or a value of information)');
  });
  it('CONTROL: the RC none_measurable clause and the measured branch are unchanged', () => {
    expect(contract).toContain('when its status is `measured`, name `most_sensitive`');
    expect(contract).toContain('otherwise (none_measurable or not measured) make no claim about which assumption matters most, and never that nothing would change the answer.');
    expect(contract).not.toMatch(/no single assumption measurably/iu);
  });
});
