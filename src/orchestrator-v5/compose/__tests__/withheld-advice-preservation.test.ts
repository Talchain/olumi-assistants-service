import { describe, expect, it } from 'vitest';
import { projectExplanationAnswerForWithheldClaim } from '../withheld-explanation-answer.js';

// Controlled contrasts derived from the bookshop advice investigation, not a
// verbatim capture of the pre-projection answer. No new live draws.
const OPTIONS = ['Keep Current Schedule', 'Extend Friday Hours'];
const ADVICE = 'Count Friday evening footfall before estimating the uplift; the brief supplies no observed increase.';
const CONSTRAINTS = [{ constraint_id: 'staff-cost', label: 'Extra staff spending at most £300' }];

function project(text: string, options: readonly string[] | undefined = OPTIONS) {
  return projectExplanationAnswerForWithheldClaim(
    text, 'unevaluated', CONSTRAINTS, true, true, undefined, options,
  );
}

describe('withheld analysis does not withhold unrelated input-value coaching', () => {
  it('keeps the existing conservative fallback when no designation can be resolved', () => {
    // Known remaining false positive, outside this selective-preservation fix.
    // Null from the roster-aware reader cannot license unknown option aliases.
    const advice = 'I recommend checking measured Friday footfall before setting Evening Footfall Uplift; the brief supplies no measured uplift.';
    const result = project(advice);
    expect(result.text).not.toContain(advice);
    expect(result.text).toContain('£300');
  });

  it('does not permit an unknown or abbreviated option just because a roster exists', () => {
    for (const name of ['the late-opening plan', 'Unknown Choice']) {
      const result = project(`I recommend ${name}. ${ADVICE}`);
      expect(result.text).not.toContain(name);
      expect(result.text).not.toContain(ADVICE);
    }
  });

  it('retains useful advice beside a self-contained unsupported leader claim', () => {
    const result = project(`Keep Current Schedule leads in 83% of simulations. ${ADVICE}`);
    expect(result.text).toContain(ADVICE);
    expect(result.text).not.toContain('Keep Current Schedule');
    expect(result.text).not.toContain('83%');
    expect(result.text).toContain('£300');
    expect(result.reason).toBe('leader_claim_replaced');
  });

  it('removes both halves of a distributed designation, not the independent advice', () => {
    const result = project(`Keep Current Schedule is strong. It leads in 83% of simulations against Extend Friday Hours. ${ADVICE}`);
    expect(result.text).toContain(ADVICE);
    expect(result.text).not.toContain('Keep Current Schedule');
    expect(result.text).not.toContain('Extend Friday Hours');
    expect(result.text).not.toContain('83%');
  });

  it('still withholds an answer consisting only of an unsupported option recommendation', () => {
    const result = project('I recommend Keep Current Schedule as the best option.');
    expect(result.text).not.toContain('Keep Current Schedule');
    expect(result.text).not.toContain('best option');
    expect(result.text).toContain('£300');
  });

  it('does not invent currency or name current constraints when the analysis is stale', () => {
    const result = projectExplanationAnswerForWithheldClaim(
      `Keep Current Schedule leads in 83% of simulations. ${ADVICE}`,
      'unevaluated', CONSTRAINTS, false, true, undefined, OPTIONS,
    );
    expect(result.text).toContain(ADVICE);
    expect(result.text).not.toContain('still current');
    expect(result.text).not.toContain('£300');
    expect(result.text).not.toContain('83%');
  });

  it('preserves the conservative existing behaviour without a usable roster', () => {
    for (const options of [undefined, []]) {
      const result = projectExplanationAnswerForWithheldClaim(
        `An unknown option leads. ${ADVICE}`, 'unevaluated', CONSTRAINTS,
        true, true, undefined, options,
      );
      expect(result.text).not.toContain('An unknown option leads');
      expect(result.text).not.toContain(ADVICE);
    }
  });

  it('is idempotent and does not multiply the constraint disclosure', () => {
    const once = project(`Keep Current Schedule leads in 83% of simulations. ${ADVICE}`);
    expect(once.text).toContain(ADVICE);
    expect(project(once.text).text).toBe(once.text);
  });
});
