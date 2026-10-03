/** Existing served science, unit/contract currentness and cold-read controls. No provider or inference calls. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tippingPointOf } from '../decision-sensitivity.js';
import { checkMethodTurn, selectGuidance } from '../guidance/index.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { selectorSignalsOf } from '../method-turn/method-turn.js';
import { tippingPointCoachingFor, settleTippingPointCoaching, tippingPointDirective } from '../tipping-point-coaching.js';
import { runExplanationChip, type RunExplanationRead } from '../run-explanation.js';

type Rec = Record<string, unknown>;
const read = (path: string): Rec => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8')) as Rec;
const POSITIVE = read('../../../../tests/fixtures/cross-service/b5-per-limit/0e19bb82.served-turn.json');
const CONTROL = read('../../coaching/__tests__/fixtures/paul-run-17d1cd3a-next-move.json').analysis_result as Rec;
const SID = 'cee-sci-hero-contract';
const HASH = POSITIVE.graph_hash as string;
const AT = '2026-10-03T00:00:00.000Z';
const result = { type: 'analysis_result', computed_against_hash: HASH, enrichment: POSITIVE.enrichment };
const current: RunExplanationRead = { graphHash: HASH, analysisResult: result,
  analysisState: { run_state: { kind: 'complete_current', computed_at: AT } } };
const plan = tippingPointCoachingFor(SID, current);
if (plan.kind !== 'found') throw new Error('Served positive must produce the contract test plan');

describe('deterministic tipping-point coaching and checker/fallback', () => {
  it('uses the existing Run identity control and exact factor threshold, with no EVPPI prerequisite', () => {
    expect(plan.run_key).toBe(runExplanationChip(SID, current)!.id);
    expect(plan.fact).toEqual(tippingPointOf(POSITIVE.enrichment));
    expect(plan.reply).toBe('Pro plan price is a factor that could change this: the comparison could change if it rises above 55.76 GBP/month.');
    expect(settleTippingPointCoaching(plan, plan.reply)).toMatchObject({ reply: plan.reply, passed: true, failed: [] });
    expect(tippingPointDirective(plan)).toContain(JSON.stringify(plan.reply));
  });

  it('allows a grounded short elaboration without generating the factor or number', () => {
    const draft = `${plan.reply} Would you like to refine this figure?`;
    expect(settleTippingPointCoaching(plan, draft)).toMatchObject({ reply: draft, passed: true });
  });

  it.each([
    ['wrong factor', plan.reply.replace('Pro plan price', 'Churn estimate')],
    ['rounded threshold', plan.reply.replace('55.76', '56')],
    ['decimal-shift threshold', plan.reply.replace('55.76', '5.576')],
    ['wrong direction', plan.reply.replace('rises above', 'falls below')],
    ['wrong unit', plan.reply.replace('GBP/month', 'USD/month')],
    ['extra threshold', `${plan.reply} Actually the threshold is 56 GBP/month.`],
    ['contradictory factor', `${plan.reply} Churn crosses above the threshold.`],
    ['winner claim', `${plan.reply} Additional advertising wins.`],
    ['probability claim', `${plan.reply} The chance is 90%.`],
  ])('falls back on %s', (_name, draft) => {
    const out = settleTippingPointCoaching(plan, draft);
    expect(out.passed).toBe(false);
    expect(out.reply).toBe(plan.reply);
  });

  it('refuses a stale typed crossing in the checker', () => {
    expect(checkMethodTurn('RC-WHAT-CHANGES', plan.reply, { ...plan.check_inputs, 'run.kind': 'complete_stale' }))
      .toMatchObject({ pass: false, failed: expect.arrayContaining(['WC-TIPPING-FACT']) });
  });

  it.each(['complete_stale', 'never_run', 'running', 'unknown'])('uses existing currentness refusal for %s', kind => {
    expect(tippingPointCoachingFor(SID, { ...current,
      analysisState: { run_state: { kind, computed_at: AT } } })).toMatchObject({ kind: 'unavailable' });
  });

  it('refuses missing result/Run identity instead of quoting history', () => {
    expect(tippingPointCoachingFor(SID, { ...current, analysisResult: undefined }).kind).toBe('unavailable');
    expect(tippingPointCoachingFor(SID, { ...current, analysisState: { run_state: { kind: 'complete_current' } } }).kind)
      .toBe('unavailable');
  });

  it('keeps the served no-signal control silent about a crossing', () => {
    const noSignal = tippingPointCoachingFor(SID, { ...current,
      analysisResult: { ...CONTROL, type: 'analysis_result', computed_against_hash: HASH } });
    expect(noSignal).toMatchObject({ kind: 'no_signal', status: 'no_flip_in_range' });
    expect(noSignal.reply).not.toMatch(/could change if|55\.76|most important/iu);
  });

  it('reconstructs the same fact from a canonical cold read, with no transcript', () => {
    expect(tippingPointCoachingFor(SID, JSON.parse(JSON.stringify(current)))).toEqual(plan);
    const newer = tippingPointCoachingFor(SID, { ...current,
      analysisState: { run_state: { kind: 'complete_current', computed_at: '2026-10-03T00:01:00.000Z' } } });
    expect(newer.kind).toBe('found');
    if (newer.kind === 'found') expect(newer.run_key).not.toBe(plan.run_key);
  });

  it('licenses percentage units and numbers within supplied units without treating them as probabilities', () => {
    for (const unit of ['%', 'GBP over 6 months']) {
      const e = { flip_thresholds: [{ factor_id: 'conversion', factor_label: 'Conversion', current_value: 5,
        flip_value: 4.2, unit, value_scale: 'display', flip_reason: 'found' }] };
      const p = tippingPointCoachingFor(SID, { ...current, analysisResult: { ...result, enrichment: e } });
      expect(p.kind).toBe('found');
      if (p.kind === 'found') expect(settleTippingPointCoaching(p, p.reply).passed).toBe(true);
    }
  });
});

describe('existing RC selector consumes the same fact without reprioritisation', () => {
  const signals = assembleGuidanceSignals({ request: 'turn', offeredSpecific: [], graph: POSITIVE.graph,
    analysisState: current.analysisState, analysisResult: current.analysisResult, leaderLicensed: false });
  const state = selectorSignalsOf(signals, null, plan.run_key);

  it('retains the crossing when EVPPI is below resolution and winner naming is withheld', () => {
    expect(signals['run.tipping_point']).toEqual(plan.fact);
    expect(signals['run.decision_sensitivity']).toEqual({ status: 'none_measurable' });
    const out = selectGuidance({ ...state, 'user.explicit_request': 'RC-WHAT-CHANGES', 'turn.request': 'method' }, {});
    expect(out.runs_method).toBe('RC-WHAT-CHANGES');
    expect(out.mode).toBeUndefined();
  });

  it('keeps P2 and existing Widen priority: a P1 intervention may still precede it', () => {
    const noOther = { ...state, 'model.goal_present': false, 'model.goal_path_links': [], 'model.goal_path_factors': [],
      'model.placeholder_goal_links': [] };
    const out = selectGuidance(noOther, {});
    expect(out.slot1).toMatchObject({ policy_id: 'RC-WHAT-CHANGES', priority: 'P2', item: 'pro_plan_price',
      copy: { why: plan.reply } });
    expect(out.slot1!.copy.question).not.toMatch(/leader|best|most important/iu);
    const widened = selectGuidance({ ...state, 'model.non_sq_option_ids': [] }, {});
    expect(widened.slot1).toMatchObject({ policy_id: 'RC-WIDEN', priority: 'P1' });
  });

  it('does not offer the threshold after the Run becomes stale', () => {
    const out = selectGuidance({ ...state, 'run.kind': 'complete_stale' }, {});
    expect([out.slot1, out.slot2].some(row => row?.policy_id === 'RC-WHAT-CHANGES')).toBe(false);
  });
  it('does not offer a typed threshold without the existing bound Run key', () => {
    const out = selectGuidance({ ...state, 'run.run_key': undefined }, {});
    expect([out.slot1, out.slot2].some(row => row?.policy_id === 'RC-WHAT-CHANGES')).toBe(false);
  });
});
