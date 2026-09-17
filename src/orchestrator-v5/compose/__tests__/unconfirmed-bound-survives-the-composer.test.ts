/**
 * ⭐ THE QUESTION THIS SPEC PINS: *"does the sentence the predicate authored
 * actually reach the user?"*
 *
 * The sibling spec (`d1-shared/__tests__/evaluate-factor-value-proposal-
 * unconfirmed-bound.test.ts`) asserts on `specific_issue` at the PREDICATE
 * boundary. Nothing crossed the composer — and the composer is where the
 * sentence was being destroyed.
 *
 * ── THE MEASURED DEFECT (independent review of #1333) ──────────────────────
 * `compose/validation-failure-responses.ts` renders `specific_issue` through
 * `sanitiseForUser`, which truncates at `MAX_USER_STRING = 100` with a
 * trailing "...". The first version of the unconfirmed-bound sentence had a
 * **146-character skeleton before any number was interpolated**, so it was cut
 * mid-word for EVERY value and EVERY unit. On the founder's own case the user
 * read:
 *
 *   > "£100,000 is above the upper limit of £100 recorded for this factor,
 *   >  and nothing on record confirm..."
 *
 * The entire remedy — that the LIMIT is the more likely thing to be wrong —
 * was never reachable. The outcome was WORSE than pristine: a complete-but-
 * wrong sentence became a fragment.
 *
 * ── WHY THIS SPEC IS DERIVED, NOT A COPY ──────────────────────────────────
 * It asserts nothing about the WORDS. It takes whatever the predicate emits
 * and requires that exact string to survive to `assistant_text` intact. So a
 * future copy edit that re-crosses the budget REDs here instead of truncating
 * silently — the failure mode a hardcoded expected-string spec would miss,
 * because such a spec would simply be updated to the truncated text
 * (CLAUDE.md trap 12: a hand-maintained mirror drifts, and the drift reads
 * as green).
 */

import { describe, expect, it } from 'vitest';

import { composeValidationFailure } from '../validation-failure-responses.js';
import type { ComposeContext } from '../types.js';
import type { ValidationError, HandlerValidationRegistry } from '../../routing/validator.js';
import { evaluateFactorValueProposal } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

/** The composer's budget, restated here ONLY to name it in failure output. */
const MAX_USER_STRING = 100;

const REGISTRY: HandlerValidationRegistry = {
  set_factor_value: {
    handler_id: 'set_factor_value',
    accepted_entity_kinds: ['node'],
    confirmation_template: 'ok',
  },
};

/** The founder's factor, as the bundle recorded it before his correction. */
const FOUNDER_FACTOR = {
  factorCap: 100,
  factorUnit: '£',
  factorObservedValue: 0.8,
  factorObservedRawValue: 80,
} as const;

/** His correction: the true figure, with the scale stated. */
const FOUNDER_CORRECTION = {
  rawInput: 100_000,
  operator: 'set',
  unit: '£',
  inputHasUnit: true,
} as const;

function ctx(): ComposeContext {
  return { handlerRegistry: REGISTRY, userMessage: 'Set it to £100,000.' };
}

/** Wrap a predicate-authored issue in the error the validator really emits. */
function errorFor(issue: string): ValidationError {
  return {
    code: 'PARAMETER_INVALID',
    message: issue,
    details: {
      parameter: 'value',
      rejection_reason: 'value_exceeds_cap',
      issue,
      handler_id: 'set_factor_value',
      value: 100_000,
      operator: 'set',
      factor_id: 'fac_first_hire',
      factor_label: 'First hire cost',
      unit: '£',
    },
  };
}

/** Drive the REAL predicate — never a hand-written string. A fixture you
 *  wrote yourself is not evidence about the wire (CLAUDE.md trap 16). */
function predicateIssue(overrides: Record<string, unknown> = {}): string {
  const r = evaluateFactorValueProposal({
    ...FOUNDER_CORRECTION,
    ...FOUNDER_FACTOR,
    ...overrides,
  });
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error('fixture no longer rejects — this spec is void');
  return r.specific_issue;
}

describe('the unconfirmed-bound refusal survives the composer intact', () => {
  it('the inherited-ceiling sentence fits the composer budget', () => {
    const issue = predicateIssue();
    expect(issue.length).toBeLessThanOrEqual(MAX_USER_STRING);
  });

  it('⭐ the predicate sentence reaches assistant_text WHOLE, not truncated', () => {
    const issue = predicateIssue();
    const { response } = composeValidationFailure(errorFor(issue), ctx(), 'frame');

    // The load-bearing assertion: the exact string the predicate authored is
    // present in full. Derived — no copy is spelled here.
    expect(response.assistant_text).toContain(issue);
    expect(response.assistant_text).not.toContain('...');
  });

  it('the remedy clause specifically is reachable, not cut off', () => {
    // The whole point of the sentence: the LIMIT is what is in doubt. This is
    // the clause the 146-char version always lost.
    const issue = predicateIssue();
    const { response } = composeValidationFailure(errorFor(issue), ctx(), 'frame');
    expect(response.assistant_text).toMatch(/limit may be what is wrong/i);
  });

  it('TWIN — the proposal-stated arm also survives whole', () => {
    // Opposite direction (trap 22b): this arm keeps the historic copy and must
    // not be broken by a change made for the inherited arm.
    const issue = predicateIssue({ proposalCap: 100 });
    const { response } = composeValidationFailure(errorFor(issue), ctx(), 'frame');
    expect(issue.length).toBeLessThanOrEqual(MAX_USER_STRING);
    expect(response.assistant_text).toContain(issue);
    expect(response.assistant_text).not.toContain('...');
  });

  it('holds for large numerals on both sides, not just the founder case', () => {
    // The budget must survive the worst realistic interpolation, or it is a
    // pass that depends on the fixture's digits.
    const issue = predicateIssue({
      rawInput: 1_000_000_000,
      factorCap: 1_000_000_000 / 1000,
      factorObservedRawValue: 1_000_000,
    });
    expect(issue.length).toBeLessThanOrEqual(MAX_USER_STRING);
    const { response } = composeValidationFailure(errorFor(issue), ctx(), 'frame');
    expect(response.assistant_text).toContain(issue);
  });
});
