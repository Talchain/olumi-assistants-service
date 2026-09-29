/**
 * ⭐ ROADMAP 2.1261 — honest copy for a unit the user never stated.
 *
 * Wire-witnessed (deployed #998 c5e2430, req b90d62e0): the routing model
 * re-proposed a `%` unit from conversation history on the unit-free message
 * "Set it to 0.12.", and the `unit_redeclares_scale` refusal told the user
 * they were "applying a value in %". Copy may only describe what the input
 * actually contained.
 *
 * The gate is honesty-narrow and byte-preserving everywhere else:
 *   - no `userMessage` in the ComposeContext (system-event paths, the pinned
 *     inspector wire contract) → the HISTORICAL bytes, unchanged;
 *   - the message EVIDENCES the unit (turn 2's "…12% of revenue…", or the
 *     same family in words, "12 percent") → the HISTORICAL bytes, unchanged;
 *   - the message does NOT evidence it → copy that attributes nothing to the
 *     user: it asks for a plain number and claims no unit was given.
 *
 * The evidence check is DERIVED from `value-unit-resolution.ts`'s family
 * vocabulary (trap 12) — asserted here by the percent-word case, which a
 * literal-containment mirror would fail.
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

/** The refusal the validator emits for the witnessed proposal, at the bytes. */
function unitRedeclaresError(): ValidationError {
  return {
    code: 'PARAMETER_INVALID',
    message:
      'This factor is recorded without a unit, so applying a value in % would change what it measures.',
    details: {
      parameter: 'value',
      rejection_reason: 'unit_redeclares_scale',
      issue:
        'This factor is recorded without a unit, so applying a value in % would change what it measures.',
      handler_id: 'set_factor_value',
      value: 0.12,
      operator: 'set',
      factor_id: 'fac_sub_cost',
      factor_label: 'Subcontractor cost as share of affected revenue',
      unit: '%',
    },
  };
}

/** The historical copy, byte-verbatim from the witnessed wire + the pinned
 *  system-event contract (route-v2-factor-value-edit-scale-redeclaration). */
const HISTORICAL_TEXT =
  'This factor is recorded without a unit, so applying a value in % would change ' +
  "what it measures. I haven't changed anything. Tell me what you'd like instead and I'll apply it.";

function ctxWith(userMessage?: string): ComposeContext {
  return { handlerRegistry: REGISTRY, ...(userMessage !== undefined ? { userMessage } : {}) };
}

describe('unit_redeclares_scale copy honesty (ROADMAP 2.1261)', () => {
  it('NO userMessage → historical bytes unchanged (system-event / legacy callers)', () => {
    const { response, template_id } = composeValidationFailure(
      unitRedeclaresError(),
      ctxWith(),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_issue');
    expect(response.assistant_text).toBe(HISTORICAL_TEXT);
    expect(response.suggested_actions[0]).toMatchObject({
      id: 'chip_prompt_param_retry',
      label: 'Try a different value',
      message: 'Use a different value for value.',
    });
  });

  it('message EVIDENCES the unit (the witnessed turn 2) → historical bytes unchanged', () => {
    const { response, template_id } = composeValidationFailure(
      unitRedeclaresError(),
      ctxWith('The subcontractor cost should be 12% of revenue on the affected routes.'),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_issue');
    expect(response.assistant_text).toBe(HISTORICAL_TEXT);
  });

  it('unit family in WORDS ("12 percent") also counts as evidence — derived, not literal', () => {
    const { template_id } = composeValidationFailure(
      unitRedeclaresError(),
      ctxWith('It should be 12 percent of revenue.'),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_issue');
  });

  it('the witnessed trapped message (unit-free) → copy that attributes NO unit to the user', () => {
    const { response, template_id } = composeValidationFailure(
      unitRedeclaresError(),
      ctxWith('Set it to 0.12.'),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_unit_unstated');
    // The mischaracterisation is dead…
    expect(response.assistant_text).not.toContain('%');
    expect(response.assistant_text).not.toMatch(/applying a value in/i);
    // …the truthful facts remain: the model state, the no-mutation claim,
    // and what is needed next.
    expect(response.assistant_text).toContain('recorded without a unit');
    expect(response.assistant_text).toMatch(/haven't changed anything/i);
    expect(response.assistant_text).toMatch(/plain number/i);
    // The recovery affordance is unchanged.
    expect(response.suggested_actions[0]).toMatchObject({
      id: 'chip_prompt_param_retry',
      label: 'Try a different value',
      message: 'Use a different value for value.',
    });
  });

  it('other rejection reasons are untouched by the gate (twin)', () => {
    const { template_id } = composeValidationFailure(
      {
        code: 'PARAMETER_INVALID',
        message: 'cap',
        details: {
          parameter: 'value',
          rejection_reason: 'cap_non_positive',
          issue: 'The cap must be positive.',
          handler_id: 'set_factor_value',
        },
      },
      ctxWith('Set it to 0.12.'),
      'frame',
    );
    expect(template_id).toBe('parameter_invalid_cap_non_positive');
  });

  it('an unreadable unit on the details keeps the historical branch (fail-open)', () => {
    const error = unitRedeclaresError();
    delete (error.details as Record<string, unknown>).unit;
    const { template_id } = composeValidationFailure(error, ctxWith('Set it to 0.12.'), 'frame');
    expect(template_id).toBe('parameter_invalid_issue');
  });
});
