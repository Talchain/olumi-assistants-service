/**
 * DISCRIMINATING PAIRS — for every check, a crafted reply that MUST be flagged and a
 * minimal edit of it that MUST pass, on the same state. A check that passes both, or
 * flags both, is not measuring what it claims.
 */
import { describe, expect, it } from 'vitest';
import { HIRING, RUN_OK, score } from './helpers.js';

const APPROVE_CHIP = { label: 'Use as starting assumptions', id: 'agent-approve-proposal:prop_abc123' };
const RUN_CHIP = { label: 'Run analysis', id: 'agent-run-analysis', action_type: 'run_analysis' };

describe('CONTROL_REFERENCE', () => {
  const text = 'Press **Use as starting assumptions** to adopt them.';
  it('FAILS when the text names a chip the response did not show', () => {
    const r = score({ text, chips: [] }).checks.CONTROL_REFERENCE;
    expect(r.verdict).toBe('FAIL');
    expect(r.findings[0]?.excerpt).toBe('Use as starting assumptions');
  });
  it('PASSES (not vacuously) when that chip was shown', () => {
    const r = score({ text, chips: [APPROVE_CHIP] }).checks.CONTROL_REFERENCE;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', false]);
  });
  it('is NOT_DECIDABLE for the Run control with no Run chip (the dock may show it), PASS with one', () => {
    expect(score({ text: 'Then press **Run analysis**.' }).checks.CONTROL_REFERENCE.verdict).toBe('NOT_DECIDABLE');
    expect(score({ text: 'Then press **Run analysis**.', chips: [RUN_CHIP] }).checks.CONTROL_REFERENCE.verdict).toBe('PASS');
  });
  it('does not read prose about running as a control reference', () => {
    const r = score({ text: 'Approve these and I will run the comparison.' }).checks.CONTROL_REFERENCE;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', true]);
  });
});

describe('LEADER_HONESTY', () => {
  const withheld = { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' };
  it('FAILS when an option is named as leading while the claim is withheld', () => {
    const r = score({ text: 'Hire Two Developers leads in 65% of model runs.', options: HIRING, leader: withheld }).checks.LEADER_HONESTY;
    expect(r.verdict).toBe('FAIL');
  });
  it('FAILS on a short-form, hedged claim ("two developers are marginally more likely to lead")', () => {
    const r = score({ text: 'Two developers are marginally more likely to lead, but it is a near tie.', options: HIRING, leader: withheld }).checks.LEADER_HONESTY;
    expect(r.verdict).toBe('FAIL');
    expect(r.findings).toHaveLength(1);
  });
  it('PASSES when the same state is described without naming a leader', () => {
    const r = score({
      text: 'The model does not separate Hire a Tech Lead from Hire Two Developers; neither can be put forward yet.',
      options: HIRING,
      leader: withheld,
    }).checks.LEADER_HONESTY;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', false]);
  });
  it('PASSES vacuously for the leading sentence when the claim is permitted', () => {
    const r = score({ text: 'Hire Two Developers leads in 65% of model runs.', options: HIRING, leader: { permitted: true, separation: 'separated' } }).checks
      .LEADER_HONESTY;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', true]);
  });
  it('does not read the role noun "Tech Lead" or "lead times" as a ranking', () => {
    const r = score({ text: 'A Tech Lead would own architecture decisions. What are the hiring lead times for a Tech Lead?', options: HIRING, leader: withheld })
      .checks.LEADER_HONESTY;
    expect(r.verdict).toBe('PASS');
  });
  it('is NOT_DECIDABLE with no leader_claim on the response', () => {
    expect(score({ text: 'Hire Two Developers leads.', options: HIRING, leader: null }).checks.LEADER_HONESTY.verdict).toBe('NOT_DECIDABLE');
  });
  // Review probe (adversarial): a negation or modal AFTER the ranking cue does not un-assert it,
  // and past-tense / idiomatic ranking forms are rankings too.
  it.each([
    'Hire Two Developers leads in 58% of runs, which could change if salaries rise.',
    'Hire Two Developers leads with no close rival.',
    'Hire Two Developers came out on top in the simulations.',
    'Hire Two Developers is in the lead.',
    'Hire Two Developers is the stronger option in the model.',
    'Hire Two Developers edges out Hire a Tech Lead in the model.',
    'Hiring two developers performs best in the analysis.',
  ])('FAILS a leader leak the first lexicon missed: %s', (text) => {
    expect(score({ text, options: HIRING, leader: withheld }).checks.LEADER_HONESTY.verdict).toBe('FAIL');
  });
  it.each([
    'Hire Two Developers does not lead on this evidence.',
    'It is too early to say whether Hire a Tech Lead leads.',
    'Neither Hire Two Developers nor Hire a Tech Lead comes out ahead.',
    'Hire Two Developers would only lead if salaries fell.',
    'No option can be put forward yet; Hire Two Developers and Hire a Tech Lead are too close to call.',
  ])('still PASSES a negation or condition that precedes the cue: %s', (text) => {
    expect(score({ text, options: HIRING, leader: withheld }).checks.LEADER_HONESTY.verdict).toBe('PASS');
  });
});

describe('ACTION_TRUTH', () => {
  it('FAILS a save claim with no write this turn; PASSES it when authorise_change mutated', () => {
    const text = 'I have saved your assumptions as version 3.';
    expect(score({ text }).checks.ACTION_TRUTH.findings.map((f) => f.kind)).toEqual(['save_claim_without_write']);
    expect(score({ text, tools: [{ name: 'authorise_change', mutated: true }] }).checks.ACTION_TRUTH.verdict).toBe('PASS');
  });
  it('FAILS a run claim with no run this turn; PASSES it with a run and a result', () => {
    const text = 'Re-run complete: the ordering is unchanged.';
    expect(score({ text }).checks.ACTION_TRUTH.findings.map((f) => f.kind)).toEqual(['run_claim_without_run']);
    expect(score({ text, tools: RUN_OK, result: true }).checks.ACTION_TRUTH.verdict).toBe('PASS');
  });
  it('treats a blocked run (tool ok, no result) as NOT having run', () => {
    expect(score({ text: 'Re-run complete.', tools: RUN_OK, result: false }).checks.ACTION_TRUTH.verdict).toBe('FAIL');
  });
  it('FAILS "approve this" with nothing offered; PASSES it with an approve chip', () => {
    const text = 'Approve these assumptions if they look right.';
    expect(score({ text }).checks.ACTION_TRUTH.findings.map((f) => f.kind)).toEqual(['proposal_claim_without_proposal']);
    expect(score({ text, chips: [APPROVE_CHIP] }).checks.ACTION_TRUTH.verdict).toBe('PASS');
  });
  it('judges "approve and I will run it" by the next captured approval: ran nothing → FAIL, ran → PASS, none → NOT_DECIDABLE', () => {
    const o = { text: 'If you approve these assumptions, I’ll save them and run the comparison.', chips: [APPROVE_CHIP] };
    expect(score(o, { nextApprovalRan: false }).checks.ACTION_TRUTH.findings.map((f) => f.kind)).toEqual(['promises_run_after_approval']);
    expect(score(o, { nextApprovalRan: true }).checks.ACTION_TRUTH.verdict).toBe('PASS');
    expect(score(o, { nextApprovalRan: null }).checks.ACTION_TRUTH.verdict).toBe('NOT_DECIDABLE');
  });
  // Review probe (adversarial): passive completion forms and an approval promise without "I'll".
  it('FAILS passive save / run claims with no write or run; PASSES them when the turn did it', () => {
    const save = 'Done — the change is saved.';
    expect(score({ text: save }).checks.ACTION_TRUTH.findings.map((f) => f.kind)).toEqual(['save_claim_without_write']);
    expect(score({ text: save, tools: [{ name: 'authorise_change', mutated: true }] }).checks.ACTION_TRUTH.verdict).toBe('PASS');
    const run = 'The comparison has been run.';
    expect(score({ text: run }).checks.ACTION_TRUTH.findings.map((f) => f.kind)).toEqual(['run_claim_without_run']);
    expect(score({ text: run, tools: RUN_OK, result: true }).checks.ACTION_TRUTH.verdict).toBe('PASS');
  });
  it('judges "once approved, the comparison will run" like "approve and I will run it"', () => {
    const o = { text: 'Once approved, the comparison will run automatically.', chips: [APPROVE_CHIP] };
    expect(score(o, { nextApprovalRan: false }).checks.ACTION_TRUTH.findings.map((f) => f.kind)).toEqual(['promises_run_after_approval']);
    expect(score(o, { nextApprovalRan: true }).checks.ACTION_TRUTH.verdict).toBe('PASS');
  });
  it('does not read a conditional save as a completed one ("once you approve, they are saved")', () => {
    const r = score({ text: 'Once you approve, they are saved as one set.', chips: [APPROVE_CHIP] }).checks.ACTION_TRUTH;
    expect(r.findings.map((f) => f.kind)).not.toContain('save_claim_without_write');
  });
  it('does not count a negated save ("No model values have been changed.")', () => {
    const r = score({ text: 'No model values have been changed.' }).checks.ACTION_TRUTH;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', true]);
  });
});

describe('OPTION_NAME_FIDELITY', () => {
  const options = ['Maintain £49 with release', '£59 with feature release'];
  it('FAILS a quoted option under a paraphrased name', () => {
    const r = score({ text: 'Compare **Keep £49 with the release** against the rise.', options }).checks.OPTION_NAME_FIDELITY;
    expect(r.verdict).toBe('FAIL');
    expect(r.findings[0]?.excerpt).toContain('Maintain £49 with release');
  });
  it('PASSES the exact label (case-insensitive)', () => {
    const r = score({ text: 'Compare **maintain £49 with release** against the rise.', options }).checks.OPTION_NAME_FIDELITY;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', false]);
  });
  it('allows an inflected leading verb and the short form, but not a figure phrase', () => {
    const r = score({ text: 'Towards **hiring a Tech Lead**; **two developers**; **1 full-time Tech Lead**.', options: HIRING }).checks.OPTION_NAME_FIDELITY;
    expect(r.verdict).toBe('PASS');
  });
});

describe('UNITS', () => {
  const factors = [{ label: 'Developer capacity', unit: 'full-time developers', raw: 4, value: 0.2 }];
  it('FAILS a factor figure quoted without its unit', () => {
    expect(score({ text: 'Developer capacity is set to **4**.', factors }).checks.UNITS.findings.map((f) => f.kind)).toEqual(['figure_without_unit']);
  });
  it('PASSES the same figure with its unit', () => {
    const r = score({ text: 'Developer capacity is **4 full-time developers**.', factors }).checks.UNITS;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', false]);
  });
  it('FAILS the normalised value quoted as if it were the figure', () => {
    expect(score({ text: 'Developer capacity is 0.2.', factors }).checks.UNITS.findings.map((f) => f.kind)).toEqual(['normalised_value_quoted']);
  });
  it('does not bind a figure to a factor it is not next to, or a £70k to a 70', () => {
    const r = score({
      text: 'Coverage is 80% of today and 100/100 workload intensity; cost is £70k.',
      factors: [
        { label: 'Workload intensity', unit: 'index out of 100', raw: 80 },
        { label: 'Cost', unit: '%', raw: 70 },
      ],
    }).checks.UNITS;
    expect(r.verdict).toBe('PASS');
  });
  it('is NOT_DECIDABLE with no unit-bearing value on the response', () => {
    expect(score({ text: 'Developer capacity is 4.' }).checks.UNITS.verdict).toBe('NOT_DECIDABLE');
  });
});

describe('PROVENANCE_WORDING', () => {
  const brief = [{ label: 'Pro plan price', unit: 'GBP per month', raw: 49, value: 0.245, source: 'brief_extraction', provenance: 'from_brief' }];
  it('FAILS a brief-stated figure called Olumi’s assumption', () => {
    expect(score({ text: 'My assumption for Pro plan price is £49 per month.', factors: brief }).checks.PROVENANCE_WORDING.findings.map((f) => f.kind)).toEqual([
      'user_figure_called_ai',
    ]);
  });
  it('FAILS it under a list header that labels the list as Olumi’s assumptions', () => {
    expect(score({ text: 'My starting assumptions, not measurements:\n- Pro plan price: £49 per month', factors: brief }).checks.PROVENANCE_WORDING.verdict).toBe('FAIL');
  });
  it('PASSES the same figure attributed to the brief', () => {
    const r = score({ text: 'Pro plan price is £49 per month, as your brief states.', factors: brief }).checks.PROVENANCE_WORDING;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', false]);
  });
  it('FAILS an unattributed machine figure called the user’s; PASSES it called Olumi’s', () => {
    const ai = [{ label: 'Churn', unit: '%', raw: 3, provenance: 'ai_inferred', source: null }];
    expect(score({ text: 'Churn is 3%, the figure you gave.', factors: ai }).checks.PROVENANCE_WORDING.findings.map((f) => f.kind)).toEqual([
      'ai_figure_called_users',
    ]);
    expect(score({ text: 'Churn is 3%, an Olumi starting estimate.', factors: ai }).checks.PROVENANCE_WORDING.verdict).toBe('PASS');
  });
  it('is NOT_DECIDABLE when every quoted figure is user_override (user entry OR adopted proposal)', () => {
    const r = score({ text: 'Developer capacity is 4 full-time developers.', factors: [{ label: 'Developer capacity', unit: 'full-time developers', raw: 4 }] }).checks
      .PROVENANCE_WORDING;
    expect(r.verdict).toBe('NOT_DECIDABLE');
    expect(r.reason).toContain('user_override');
  });
});

describe('CAVEAT', () => {
  const fragile = { options: HIRING, tools: RUN_OK, result: true, robustness: 'very_low', nearTie: true, leader: { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' } };
  it('FAILS a fragile, near-tie result reported with no caveat', () => {
    const r = score({ ...fragile, text: 'The analysis compared both hiring options on velocity.' }, { userAction: 'run' }).checks.CAVEAT;
    expect(r.verdict).toBe('FAIL');
  });
  it('PASSES the same result with the uncertainty stated', () => {
    const r = score({ ...fragile, text: 'The result is fragile: small changes could flip the ordering.' }, { userAction: 'run' }).checks.CAVEAT;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', false]);
  });
  it('FAILS a blocked run that does not say it did not run; PASSES one that does', () => {
    const blocked = { options: HIRING, tools: RUN_OK, result: false };
    expect(score({ ...blocked, text: 'Here is where the comparison stands.' }, { userAction: 'run' }).checks.CAVEAT.verdict).toBe('FAIL');
    expect(score({ ...blocked, text: 'The analysis did not run: one option has no level.' }, { userAction: 'run' }).checks.CAVEAT.verdict).toBe('PASS');
  });
  it('owes nothing on a turn that reports no analysis', () => {
    const r = score({ text: 'Saved.' }, { userAction: 'approve_chip' }).checks.CAVEAT;
    expect([r.verdict, r.vacuous]).toEqual(['PASS', true]);
  });
});

describe('server/model split and counts (harness PQ1/PQ2 adapter)', () => {
  it('a typed-chip approval is all server text: model words 0', () => {
    const t = score({ text: 'Saved 4 of 4 starting values.', fastPath: 'approve', providerCalls: 0 }, { userAction: 'approve_chip' });
    expect([t.metrics.finalWords, t.metrics.modelWordsEstimate, t.metrics.splitBasis]).toEqual([6, 0, 'fast_path_approve']);
  });
  it('peels the server status paragraph off the end and counts its questions separately', () => {
    const t = score({ text: 'Two options are modelled.\n\nThe model was saved as version 1. Questions this model does not answer yet: What is team size? Over what horizon?' });
    expect(t.metrics.serverStatusPresent).toBe(true);
    expect([t.metrics.finalQuestions, t.metrics.modelQuestionsEstimate, t.metrics.modelWordsEstimate]).toEqual([2, 0, 4]);
  });
  it('does not count markdown markers as words', () => {
    expect(score({ text: '- **Hire a Tech Lead**\n- **Hire Two Developers**' }).metrics.finalWords).toBe(7);
  });
});
