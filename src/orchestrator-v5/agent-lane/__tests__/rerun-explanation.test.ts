/**
 * ⭐ M2 RERUN-EXPLANATION — the rerun's explanation names the user's change from run_delta's TYPED rows and never claims
 * a movement the pair cannot show (RC contract `RERUN-EXPLANATION` @a00cb9c8 → 6c2c8d7a; DL assignment; lease #85
 * 5939005849). The check is RC's own `checkMethodTurn`, on the label-masked reply (#2478).
 *
 * Fixture: the FINAL investor seed `eeeff8b4` as served (R3 journey-2 `seed-readback.json`, guest 4e53dfa5): its two
 * placeholder links, which the journey's two Accepts turn into accepted estimates (52f8cd 5938955871: exactly two `sizing`
 * rows placeholder → olumi_accepted, coverage complete). The run_delta is shaped by @talchain/schemas 0.70.0
 * (`RunDeltaInputChangeObjectSchema`, `win_probabilities_unavailable`).
 */
import { describe, expect, it } from 'vitest';
import { checkMethodTurn } from '../guidance/index.js';
import { guardRerunExplanation, rerunExplanationPlan, RERUN_FALLBACK_LINES } from '../rerun-explanation.js';

const LABELS: Record<string, string> = {
  quarterly_revenue: 'Quarterly revenue',
  ai_reporting_module_sprint: 'AI Reporting Module Sprint',
  integration_bug_fix_sprint: 'Integration Bug Fix Sprint',
  split_sprint_capacity: 'Split Sprint Capacity',
  continue_current_plan: 'Continue Current Plan',
  sprint_capacity_for_ai_reporting: 'Sprint capacity for AI reporting',
  sprint_capacity_for_integration_fix: 'Sprint capacity for integration fix',
  ai_reporting_module_availability: 'AI reporting module availability',
  integration_step_bug_resolution: 'Integration-step bug resolution',
  qualified_leads: 'Qualified leads per month',
};
const labelOf = (id: string) => LABELS[id];
const OPTIONS = ['AI Reporting Module Sprint', 'Integration Bug Fix Sprint', 'Split Sprint Capacity', 'Continue Current Plan'];
const MODEL_LABELS = Object.values(LABELS);

const accept = (from: string, to: string) => ({
  entity_kind: 'link', entity_id: `${from}->${to}`, link: { from, to }, field: 'sizing',
  before: { raw: 'placeholder' }, after: { raw: 'olumi_accepted' }, change: 'changed',
});
const AI = accept('sprint_capacity_for_ai_reporting', 'ai_reporting_module_availability');
const FIX = accept('sprint_capacity_for_integration_fix', 'integration_step_bug_resolution');
const SAID_AI = "You accepted Olumi's estimate for how much Sprint capacity for AI reporting changes AI reporting module availability.";
const SAID_FIX = "You accepted Olumi's estimate for how much Sprint capacity for integration fix changes Integration-step bug resolution.";

/** The investor moment: the earlier Run held its figures back (prior_withheld), no win shares to pair. */
const UNWITHHELD = {
  attribution_case: 'C1_attributable', input_coverage: 'complete', input_changes: [AI, FIX],
  win_probabilities: [], win_probabilities_unavailable: 'prior_withheld',
  leader: { changed: true, noise_verdict: 'not_noise_qualified' },
};
const plan = (delta: unknown, licensed = false) => rerunExplanationPlan(delta, labelOf, OPTIONS, licensed, MODEL_LABELS);

describe('the plan: change sentences from the typed rows, the check inputs, the fallback', () => {
  it('RED (the investor moment): two Accepts → two of RC\'s sentences with the graph\'s labels; prior_withheld is typed', () => {
    const p = plan(UNWITHHELD)!;
    expect(p.changes).toEqual([SAID_AI, SAID_FIX]);
    expect(p.inputs).toMatchObject({ change_labels: [SAID_AI, SAID_FIX], prior_withheld: true, no_matched_figures: false,
      attribution_case: 'C1_attributable', leader_licensed: false, model_labels: MODEL_LABELS });
    expect(p.instruction).toContain(SAID_AI);
    expect(p.instruction).toContain(RERUN_FALLBACK_LINES.unwithheld);
    expect(p.fallback).toBe(`${SAID_AI} ${SAID_FIX} ${RERUN_FALLBACK_LINES.unwithheld}`);
  });

  it.each([
    ['no run_delta (a first Run)', undefined],
    ['a pre-0.70 Accept pair: no change rows', { attribution_case: 'C1_attributable', input_coverage: 'complete', input_changes: [], win_probabilities: [] }],
    ['rows whose link ends the graph does not hold', { attribution_case: 'C1_attributable', input_changes: [accept('gone_a', 'gone_b')], win_probabilities: [] }],
  ])('INERT: %s → no plan (the explanation path is exactly as before)', (_n, delta) => {
    expect(plan(delta)).toBeNull();
  });

  it('prior_withheld is never inferred from an empty array: empty win shares WITHOUT the typed reason → no_matched_figures, not UNWITHHELD', () => {
    const p = plan({ ...UNWITHHELD, win_probabilities_unavailable: undefined })!;
    expect(p.inputs).toMatchObject({ prior_withheld: false, no_matched_figures: true });
    expect(p.fallback).toBe(`${SAID_AI} ${SAID_FIX} ${RERUN_FALLBACK_LINES.C1}`);
  });

  it('one sentence per link: a sizing (→ user) and a strength row on ONE link are one change', () => {
    const own = { ...AI, after: { raw: 'user' } };
    const band = { ...AI, field: 'strength', before: { raw: 'moderate' }, after: { raw: 'strong' } };
    expect(plan({ ...UNWITHHELD, input_changes: [own, band] })!.changes).toEqual([
      'You gave your own estimate for how much Sprint capacity for AI reporting changes AI reporting module availability: moderate → strong.',
    ]);
  });

  it('a non-link row says its own label, before → after, with units; at most three changes', () => {
    const price = { entity_kind: 'factor', entity_id: 'f', field: 'value', label_after: 'Pro plan price', before: { raw: 49, unit: '£' }, after: { raw: 59, unit: '£' }, change: 'changed' };
    const p = plan({ ...UNWITHHELD, input_changes: [price, AI, FIX, accept('qualified_leads', 'quarterly_revenue')] })!;
    expect(p.changes).toHaveLength(3);
    expect(p.changes[0]).toBe('You changed Pro plan price: 49 £ → 59 £.');
  });

  it.each([
    ['C0_identical', RERUN_FALLBACK_LINES.C0],
    ['C2_unpaired', RERUN_FALLBACK_LINES.C2],
    ['C3_engine_drift', RERUN_FALLBACK_LINES.other],
    ['C5_unattributed', RERUN_FALLBACK_LINES.other],
  ])('the case line for %s (C3–C5 are checked as C2 and never say "a new draw")', (c, line) => {
    const p = plan({ ...UNWITHHELD, attribution_case: c, win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] })!;
    expect(p.fallback.endsWith(line)).toBe(true);
    expect(p.inputs.attribution_case).toBe(c === 'C0_identical' ? 'C0_identical' : 'C2_unpaired');
  });

  it.each([
    ['UNWITHHELD', UNWITHHELD],
    ['C0', { ...UNWITHHELD, attribution_case: 'C0_identical', win_probabilities_unavailable: undefined }],
    ['C2', { ...UNWITHHELD, attribution_case: 'C2_unpaired', win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] }],
    ['C3', { ...UNWITHHELD, attribution_case: 'C3_engine_drift', win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] }],
  ])('the FALLBACK itself passes RC\'s check (%s)', (_n, delta) => {
    const p = plan(delta)!;
    expect(checkMethodTurn('RERUN-EXPLANATION', p.fallback, p.inputs)).toMatchObject({ pass: true, failed: [] });
  });
});

describe('the guard: RC\'s check before send, RC\'s fallback on a fail', () => {
  const p = plan(UNWITHHELD)!;
  const GOOD = `${SAID_AI}\n${SAID_FIX}\n${RERUN_FALLBACK_LINES.unwithheld} The model now shows a provisional comparison of the four options.`;

  it('CONTROL: a reply naming both changes with the UNWITHHELD line and no movement → sent as written', () => {
    expect(guardRerunExplanation(GOOD, p)).toEqual({ text: GOOD, passed: true, failed: [] });
  });

  it('RED (RX-NO-MOVEMENT-WITHOUT-PRIOR): "rose" with no prior figures → RC\'s fallback, never the claim', () => {
    const r = guardRerunExplanation(`${GOOD} AI Reporting Module Sprint's chance rose to 57%.`, p);
    expect(r).toMatchObject({ passed: false, text: p.fallback });
    expect(r.failed).toContain('RX-NO-MOVEMENT-WITHOUT-PRIOR');
  });

  it('RED (RX-NAMES-CHANGES): a reply that leaves out one Accept → fallback', () => {
    const r = guardRerunExplanation(`${SAID_AI}\n${RERUN_FALLBACK_LINES.unwithheld}`, p);
    expect(r.failed).toContain('RX-NAMES-CHANGES');
    expect(r.text).toBe(p.fallback);
  });

  it('RED (RX-NO-LEADER-UNLICENSED): an unlicensed option said to lead → fallback', () => {
    const r = guardRerunExplanation(`${GOOD} AI Reporting Module Sprint leads the comparison.`, p);
    expect(r.failed).toContain('RX-NO-LEADER-UNLICENSED');
  });

  it('CONTROL (RC MT-RERUN-MODEL-LABEL-GOOD): a MODEL label containing "leads", beside an option, is masked — not a leader claim', () => {
    // Without the mask this sentence holds an option label AND "leads", so RX-NO-LEADER-UNLICENSED would fire.
    const reply = `${GOOD} Continue Current Plan keeps Qualified leads per month where it was.`;
    expect(guardRerunExplanation(reply, p)).toMatchObject({ passed: true, text: reply });
    const unmasked = rerunExplanationPlan(UNWITHHELD, labelOf, OPTIONS, false, []);
    expect(guardRerunExplanation(reply, unmasked!).failed, 'the contrast: without model_labels it reads as a leader claim').toContain('RX-NO-LEADER-UNLICENSED');
  });

  // ⛔ CODEX CEE BUDDY draft CR 5939351197 P1: model-reply bypasses RC's text bans did not reject.
  it.each([
    ['a partial Accept delta + "The same input values were used."', { ...UNWITHHELD, input_coverage: 'partial', win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] }, 'The same input values were used.'],
    ['a complete Accept + "Nothing in your model changed."', UNWITHHELD, `${RERUN_FALLBACK_LINES.unwithheld} Nothing in your model changed.`],
  ])('RED (RX-NO-CONTRARY-SAME): %s → fallback', (_n, delta, extra) => {
    const p3 = plan(delta)!;
    const r = guardRerunExplanation(`${SAID_AI}\n${SAID_FIX}\n${extra}`, p3);
    expect(r.failed).toContain('RX-NO-CONTRARY-SAME');
    expect(r.text).toBe(p3.fallback);
  });

  it('CONTROL: RC\'s own C0 line "Nothing else changed." is not a contrary claim', () => {
    const c0 = plan({ ...UNWITHHELD, attribution_case: 'C0_identical', win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] })!;
    expect(guardRerunExplanation(c0.fallback, c0)).toMatchObject({ passed: true });
  });

  it('RED (RX-UNWITHHELD-LINE): with prior_withheld, the change sentences alone are not enough → fallback', () => {
    const r = guardRerunExplanation(`${SAID_AI}\n${SAID_FIX}`, p);
    expect(r.failed).toEqual(['RX-UNWITHHELD-LINE']);
    expect(r.text).toBe(p.fallback);
  });

  it('the Accept is never folded away: sizing → olumi_accepted + a band move on ONE link keeps "You accepted"', () => {
    const band = { ...AI, field: 'strength', before: { raw: 'moderate' }, after: { raw: 'strong' } };
    expect(plan({ ...UNWITHHELD, input_changes: [AI, band] })!.changes).toEqual([
      "You accepted Olumi's estimate for how much Sprint capacity for AI reporting changes AI reporting module availability: moderate → strong.",
    ]);
  });

  it('CONTROL (buddy preflight 5939219187): a PAIRED, licensed C1 rerun with win shares on both sides MAY say what moved', () => {
    const paired = plan({ ...UNWITHHELD, win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'ai_reporting_module_sprint' }] }, true)!;
    expect(paired.inputs).toMatchObject({ prior_withheld: false, no_matched_figures: false, leader_licensed: true });
    const moved = `${SAID_AI}\n${SAID_FIX}\nAI Reporting Module Sprint's chance rose to 57% and it leads the comparison.`;
    expect(guardRerunExplanation(moved, paired)).toMatchObject({ passed: true, text: moved });
  });

  it.each(['partial', 'not_recorded', undefined])('coverage %s never licenses "same inputs" or a cause: checked as unpaired, said as "other things also differed"', (coverage) => {
    const p2 = plan({ ...UNWITHHELD, attribution_case: 'C0_identical', input_coverage: coverage, win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] })!;
    expect(p2.inputs.attribution_case).toBe('C2_unpaired');
    expect(p2.fallback.endsWith(RERUN_FALLBACK_LINES.other)).toBe(true);
    expect(p2.fallback).not.toContain(RERUN_FALLBACK_LINES.C0);
  });

  it('a C2 pair: a causal word is refused (RX-NO-CAUSE-UNPAIRED); a C1 pair may state the cause', () => {
    const c2 = plan({ ...UNWITHHELD, attribution_case: 'C2_unpaired', win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] })!;
    const causal = `${SAID_AI}\n${SAID_FIX}\nThe shift happened because of your change.`;
    expect(guardRerunExplanation(causal, c2).failed).toContain('RX-NO-CAUSE-UNPAIRED');
    const c1 = plan({ ...UNWITHHELD, win_probabilities_unavailable: undefined, win_probabilities: [{ option_id: 'x' }] })!;
    expect(guardRerunExplanation(causal, c1).failed).not.toContain('RX-NO-CAUSE-UNPAIRED');
  });
});
