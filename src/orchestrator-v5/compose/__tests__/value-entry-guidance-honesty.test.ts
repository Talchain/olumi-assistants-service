/**
 * ⭐ JOURNEY-WITNESSED, staging UI `88cb7e37` / CEE `4e88390`, on the
 * product's OWN recommended next step.
 *
 * A model was blocked for analysis on "Rep Adoption Quality", a UNITLESS 0-1
 * quality factor. "Best next step" told the user to set it. Verbatim:
 *
 *   USER : "Set Rep Adoption Quality to 0.7 for the full HubSpot switch
 *           and 0.6 for the phased migration."
 *   OLUMI: "This factor is recorded without a unit, so I need the value as a
 *           plain number. I haven't changed anything. Tell me the plain
 *           number you want and I'll apply it."
 *   USER : "70"
 *   OLUMI: "The system flagged this as a plain number, but two values still
 *           need setting... Which one is this 70 for?"
 *   USER : "The 70 is for the full HubSpot switch. Set the phased migration
 *           to 60."
 *   OLUMI: "I couldn't tell what value to use. Please tell me the number you
 *           want, for example £100,000."
 *
 * TWO DEFECTS, pinned separately below.
 *
 * D1 — THE STATED REASON IS NOT THE ACTUAL BLOCKER. `0.7` IS a plain number,
 *      and the same value succeeded when sent bare. The refusal is correct;
 *      the REASON is false. `unit_redeclares_scale` fires only when the
 *      PROPOSAL carried a unit and the factor has none
 *      (`evaluate-factor-value-proposal.ts` 2c), and this branch's own guard
 *      has already established the user's message did NOT state that unit.
 *      So the composer provably knows the number was never the blocker, and
 *      told the user it was. The user then retypes numbers that keep failing.
 *
 * D2 — THE EXAMPLE IS NONSENSE FOR THE FACTOR. `£100,000`, a CURRENCY, for a
 *      unitless factor the same sentence has just described as having no
 *      unit. Four branches spelled `£100,000` inline; the fix is one derived
 *      authority (`value-ask-guidance.ts`), not a fifth variant.
 *
 * ⚠ WHAT IS DELIBERATELY NOT CHANGED: the refusal itself. "I haven't changed
 * anything" is TRUE and fail-closed and is asserted below in both directions.
 * The defect is the reason given, never the refusal.
 *
 * BOTH-DIRECTION CONTROLS ARE THE POINT (trap 13e / 22b): a fix that strips
 * currency examples everywhere would "pass" a unitless-only corpus while
 * destroying the money copy. Every unitless assertion here has a money twin.
 */
import { describe, expect, it } from 'vitest';

import { composeValidationFailure } from '../validation-failure-responses.js';
import type { ComposeContext } from '../types.js';
import type { ValidationError, HandlerValidationRegistry } from '../../routing/validator.js';

const REGISTRY: HandlerValidationRegistry = {
  set_factor_value: {
    handler_id: 'set_factor_value',
    accepted_entity_kinds: ['node'],
    confirmation_template: 'ok',
  },
};

const CURRENCY_ANYWHERE = /[£$€]/;

function ctx(userMessage?: string): ComposeContext {
  return { handlerRegistry: REGISTRY, ...(userMessage !== undefined ? { userMessage } : {}) };
}

function compose(error: ValidationError, c: ComposeContext = ctx()) {
  return composeValidationFailure(error, c, 'frame');
}

// ── D1: the witnessed unitless refusal ──────────────────────────────────────

/**
 * The validator's refusal for the witnessed turn, at the bytes. `value` is
 * `parsed.numeric` (validator.ts) — the number in play, 0.7. `unit` is the
 * PROPOSAL's unit, which the user's message never contained.
 */
function repAdoptionQualityRefusal(): ValidationError {
  return {
    code: 'PARAMETER_INVALID',
    message: 'This factor is recorded without a unit, so applying a value in % would change what it measures.',
    details: {
      parameter: 'value',
      rejection_reason: 'unit_redeclares_scale',
      issue: 'This factor is recorded without a unit, so applying a value in % would change what it measures.',
      handler_id: 'set_factor_value',
      value: 0.7,
      operator: 'set',
      factor_id: 'fac_rep_adoption_quality',
      factor_label: 'Rep Adoption Quality',
      unit: '%',
    },
  };
}

const WITNESSED_MESSAGE = 'Set Rep Adoption Quality to 0.7 for the full HubSpot switch option.';

describe('D1 — the stated reason must be the actual blocker (unit_redeclares_scale)', () => {
  it('does NOT tell the user their plain number was the wrong format', () => {
    const { response, template_id } = compose(repAdoptionQualityRefusal(), ctx(WITNESSED_MESSAGE));
    expect(template_id).toBe('parameter_invalid_unit_unstated');
    // THE WITNESSED SENTENCE, dead. It asked for a plain number the user had
    // already given, so the user could only loop.
    expect(response.assistant_text).not.toContain('so I need the value as a plain number');
    expect(response.assistant_text).not.toContain("Tell me the plain number you want and I'll apply it");
  });

  it('names the UNIT as the blocker and clears the number', () => {
    const { response } = compose(repAdoptionQualityRefusal(), ctx(WITNESSED_MESSAGE));
    expect(response.assistant_text).toMatch(/the number isn't the problem/i);
    expect(response.assistant_text).toMatch(/the unit is/i);
  });

  it('hands back a COMPLETE, sendable restatement carrying the factor and the value in play', () => {
    const { response } = compose(repAdoptionQualityRefusal(), ctx(WITNESSED_MESSAGE));
    // The escape hatch the witness eventually found by hand, offered up front.
    expect(response.assistant_text).toContain('Set Rep Adoption Quality to 0.7');
  });

  it('the FAIL-CLOSED refusal is untouched: nothing was changed, and it still says so', () => {
    const { response } = compose(repAdoptionQualityRefusal(), ctx(WITNESSED_MESSAGE));
    expect(response.assistant_text).toMatch(/haven't changed anything/i);
    expect(response.assistant_text).toContain('recorded without a unit');
  });

  it('still attributes NO unit to the user (ROADMAP 2.1261 must not regress)', () => {
    const { response } = compose(repAdoptionQualityRefusal(), ctx(WITNESSED_MESSAGE));
    expect(response.assistant_text).not.toContain('%');
    expect(response.assistant_text).not.toMatch(/applying a value in/i);
  });

  it('offers NO currency for a factor it has just called unitless', () => {
    const { response } = compose(repAdoptionQualityRefusal(), ctx(WITNESSED_MESSAGE));
    expect(response.assistant_text).not.toMatch(CURRENCY_ANYWHERE);
  });

  it('a NON-SET operator gets no restatement: the value is a delta, not the target', () => {
    const error = repAdoptionQualityRefusal();
    (error.details as Record<string, unknown>).operator = 'increase';
    const { response } = compose(error, ctx('Increase Rep Adoption Quality by 0.7.'));
    expect(response.assistant_text).not.toContain('Set Rep Adoption Quality to 0.7');
    // The honest half still ships.
    expect(response.assistant_text).toMatch(/the number isn't the problem/i);
  });

  it('a float carrying computed-arithmetic noise is never echoed back', () => {
    const error = repAdoptionQualityRefusal();
    (error.details as Record<string, unknown>).value = 1.2999999999999998;
    const { response } = compose(error, ctx(WITNESSED_MESSAGE));
    expect(response.assistant_text).not.toContain('1.2999999999999998');
  });
});

// ── D2: the example must come from the factor's own scale ───────────────────

describe('D2 — no currency example for a factor that has no currency', () => {
  it('missing_value (the witnessed final reply) drops the fabricated £100,000', () => {
    const { response, template_id } = compose({
      code: 'PARAMETER_INVALID',
      message: 'set_factor_value requires a "value" parameter.',
      details: {
        parameter: 'value',
        rejection_reason: 'missing_value',
        issue: 'value parameter is missing',
        handler_id: 'set_factor_value',
        actual_value: null,
      },
    });
    expect(template_id).toBe('parameter_invalid_missing_value');
    // This path threads NO unit at all, so ANY unit example is fabricated.
    expect(response.assistant_text).not.toContain('£100,000');
    expect(response.assistant_text).not.toMatch(CURRENCY_ANYWHERE);
    expect(response.assistant_text).toMatch(/same scale the factor already uses/i);
  });

  it('CONTROL (money must survive): bare_number_outside_cap on a £ factor keeps its money example', () => {
    const { response, template_id } = compose({
      code: 'PARAMETER_INVALID',
      message: 'outside range',
      details: {
        parameter: 'value',
        rejection_reason: 'bare_number_outside_cap',
        issue: "Value 250000 is outside the factor's expected range [0, 200000] and no unit was given.",
        handler_id: 'set_factor_value',
        unit: '£',
      },
    });
    expect(template_id).toBe('parameter_invalid_bare_number_outside_cap');
    expect(response.assistant_text).toContain('for example £100,000');
  });

  it('TWIN: bare_number_outside_cap on a UNITLESS factor gets the scale, not a currency', () => {
    const { response } = compose({
      code: 'PARAMETER_INVALID',
      message: 'outside range',
      details: {
        parameter: 'value',
        rejection_reason: 'bare_number_outside_cap',
        issue: "Value 250000 is outside the factor's expected range [0, 1] and no unit was given.",
        handler_id: 'set_factor_value',
      },
    });
    expect(response.assistant_text).not.toMatch(CURRENCY_ANYWHERE);
    expect(response.assistant_text).toMatch(/same scale the factor already uses/i);
  });

  it('CONTROL (money must survive): delta_no_existing_value on a £ factor keeps its money example', () => {
    const { response } = compose({
      code: 'PARAMETER_INVALID',
      message: 'no existing value',
      details: {
        parameter: 'value',
        rejection_reason: 'delta_no_existing_value',
        issue: 'This factor has no recorded current value to adjust from.',
        handler_id: 'set_factor_value',
        factor_label: 'Hiring and Salary Cost',
        unit: '£',
      },
    });
    expect(response.assistant_text).toContain('for example £100,000');
    expect(response.assistant_text).toContain('Hiring and Salary Cost');
  });

  it('TWIN: delta_no_existing_value on a UNITLESS factor gets the scale, not a currency', () => {
    const { response } = compose({
      code: 'PARAMETER_INVALID',
      message: 'no existing value',
      details: {
        parameter: 'value',
        rejection_reason: 'delta_no_existing_value',
        issue: 'This factor has no recorded current value to adjust from.',
        handler_id: 'set_factor_value',
        factor_label: 'Rep Adoption Quality',
      },
    });
    expect(response.assistant_text).not.toMatch(CURRENCY_ANYWHERE);
    expect(response.assistant_text).toContain('Rep Adoption Quality');
  });

  it('a PERCENT factor gets a percent example, never a currency', () => {
    const { response } = compose({
      code: 'PARAMETER_INVALID',
      message: 'no existing value',
      details: {
        parameter: 'value',
        rejection_reason: 'delta_no_existing_value',
        issue: 'This factor has no recorded current value to adjust from.',
        handler_id: 'set_factor_value',
        factor_label: 'Churn Rate',
        unit: '%',
      },
    });
    expect(response.assistant_text).toContain('for example 25%');
    expect(response.assistant_text).not.toMatch(CURRENCY_ANYWHERE);
  });

  it('VALUE_UNIT_UNRESOLVED follows the same authority: currency family keeps £, count family does not', () => {
    const money = compose({
      code: 'VALUE_UNIT_UNRESOLVED',
      message: 'refused',
      details: { handler_id: 'set_factor_value', factor_label: 'Marketing budget', factor_unit_family: 'currency' },
    });
    expect(money.response.assistant_text).toContain('for example £100,000');

    const counted = compose({
      code: 'VALUE_UNIT_UNRESOLVED',
      message: 'refused',
      details: { handler_id: 'set_factor_value', factor_label: 'Team Size', factor_unit_family: 'count' },
    });
    expect(counted.response.assistant_text).not.toMatch(CURRENCY_ANYWHERE);
    expect(counted.response.assistant_text).toContain('Team Size');
  });
});
