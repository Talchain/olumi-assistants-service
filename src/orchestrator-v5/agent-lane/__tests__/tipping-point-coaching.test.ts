/** Existing served science, unit/contract currentness and cold-read controls. No provider or inference calls. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { tippingPointOf } from '../decision-sensitivity.js';
import { checkMethodTurn, selectGuidance } from '../guidance/index.js';
import { assembleGuidanceSignals } from '../turn-context/guidance-signals.js';
import { selectorSignalsOf } from '../method-turn/method-turn.js';
import { NOTHING_TO_FLIP_OPENER, tippingPointCoachingFor, settleTippingPointCoaching, tippingPointDirective } from '../tipping-point-coaching.js';
import { leaderLicenceFromState } from '../../compose/leader-licence.js';
import { findLeaderClaims } from '../../compose/leading-option-egress-guard.js';
import { AGENT_NO_LEADER_SENTENCES, dropRankingSentences, sentenceRanksOptions } from '../withheld-leader-fail-closed.js';
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

/**
 * ⭐ NO LEADER, NOTHING TO FLIP (DL 0df0e1, 5 Oct; spine v2 step 5). Acceptance's beat-3 press on a58 (#87 5986279838)
 * served "no grounded factor threshold" on a near-tie WITHHELD Run, which reads as broken. The claim and admission below
 * are that served turn's, verbatim (programme-docs wip/harness-restart-20261004 @ec78d1c8, resume-acceptance/20-CHANGE-TURN.json).
 */
describe('a withheld leader says there is nothing to flip; a licensed one keeps its "no threshold" words', () => {
  const ADMISSION = { analysis_admission: { structurally_analysable: true, semantic_quality_sufficient: true, permitted_analysis_mode: 'comparative_leader' } };
  const NEAR_TIE = { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' };
  const LICENSED = { permitted: true, separation: 'separated' };
  const at = (leader_claim: Rec, enrichment: unknown) => ({ graphHash: HASH, analysisReady: ADMISSION,
    analysisResult: { ...result, enrichment },
    analysisState: { run_state: { kind: 'complete_current', computed_at: AT }, leader_claim } });
  const NO_ROW = {};
  const NO_FLIP_IN_RANGE = CONTROL.enrichment;

  it('PRECONDITION: the served claim is withheld and the contrast claim is licensed, by the one licence', () => {
    expect(leaderLicenceFromState(at(NEAR_TIE, NO_ROW).analysisState, ADMISSION)).toBe('withheld');
    expect(leaderLicenceFromState(at(LICENSED, NO_ROW).analysisState, ADMISSION)).toBe('permitted');
    expect(tippingPointOf(NO_FLIP_IN_RANGE)).toMatchObject({ status: 'no_flip_in_range' });
    expect(tippingPointOf(NO_ROW).status).not.toMatch(/^(found|no_flip_in_range)$/);
  });

  /** The served near-tie answer, verbatim: the direct answer, then the canonical near-tie no-leader sentence. */
  const NEAR_TIE_REPLY = "There's nothing yet for a change to flip. No single option can be put forward yet, because the options came out too close together on this run to tell apart; tell me what matters most to you between them.";

  it.each([['no grounded row', NO_ROW], ['no flip in range', NO_FLIP_IN_RANGE]])(
    'RED: served near-tie, %s → nothing to flip + the canonical near-tie reason, same Run key', (_name, enrichment) => {
      const read = at(NEAR_TIE, enrichment);
      const out = tippingPointCoachingFor(SID, read);
      expect(out).toMatchObject({ kind: 'no_signal', run_key: runExplanationChip(SID, read)!.id });
      expect(out.reply).toBe(NEAR_TIE_REPLY);
    });

  it('RED: a leader withheld for another reason gives that reason\'s canonical sentence, never "too close"', () => {
    const out = tippingPointCoachingFor(SID, at({ permitted: false, withheld_reason: 'goal_scope_unresolved' }, NO_ROW));
    expect(out.reply.startsWith(`${NOTHING_TO_FLIP_OPENER} `)).toBe(true);
    expect(AGENT_NO_LEADER_SENTENCES).toContain(out.reply.slice(NOTHING_TO_FLIP_OPENER.length + 1));
    expect(out.reply).not.toMatch(/too close/u);
  });

  it('CONTROL: a licensed leader keeps both "no threshold" sentences exactly', () => {
    expect(tippingPointCoachingFor(SID, at(LICENSED, NO_ROW)).reply).toBe('This analysis has no grounded factor threshold available to quote.');
    expect(tippingPointCoachingFor(SID, at(LICENSED, NO_FLIP_IN_RANGE)).reply)
      .toBe('This analysis has no factor threshold to quote within the ranges it checked.');
  });

  it('CONTROL: a FOUND crossing keeps its exact sentence on a withheld Run (only the "no threshold" words change)', () => {
    expect(tippingPointCoachingFor(SID, at(NEAR_TIE, POSITIVE.enrichment))).toMatchObject({ kind: 'found', reply: plan.reply });
  });

  it('both final-egress rails keep the new reply byte-identical; the leader/recommend wordings would have been removed', () => {
    expect(findLeaderClaims({ assistant_text: NEAR_TIE_REPLY, blocks: [] } as never)).toEqual([]);
    expect(sentenceRanksOptions(NOTHING_TO_FLIP_OPENER)).toBe(false);
    expect(dropRankingSentences(NEAR_TIE_REPLY)).toEqual({ text: NEAR_TIE_REPLY, droppedSentences: 0 });
    // Contrast (the probes see the class): the first drafts of this copy.
    expect(findLeaderClaims({ assistant_text: "There's no recommendation for a change to flip.", blocks: [] } as never).length).toBeGreaterThan(0);
    expect(sentenceRanksOptions('The options are too close for this analysis to name a leader.')).toBe(true);
  });
});
