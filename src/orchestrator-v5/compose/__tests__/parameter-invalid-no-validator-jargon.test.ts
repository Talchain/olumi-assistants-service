/**
 * ROADMAP 2.380 (FIX 3) — the `parameter_invalid` template must never show the
 * user an INTERNAL PARAMETER NAME or a BARE NUMERIC DOMAIN.
 *
 * Live capture (L52 diagnosis, walk `w3`, 2026-08-04), verbatim to the user:
 *
 *     'strength' needs to be a number between -1 and 1.
 *
 * `strength` is a field name in our Zod schema; the product's word is "the
 * strength of the link". "a number between -1 and 1" is `describeSchema`
 * reading `_def.checks` — the validator's own vocabulary, not a scale the user
 * has ever been shown. The chip that came with it said "Use a different value
 * for strength."
 *
 * The repo ALREADY knew this was a defect: `configure-option-clarify-response.ts:50`
 * quotes this exact string as "a real validator-jargon leak" that new copy must
 * not repeat. The copy elsewhere was fixed; THIS emission site never was. That
 * is the shape of the failure being pinned here — a known defect, documented in
 * a neighbouring file, left live at its source.
 *
 * Two guards, per CLAUDE.md trap 12d:
 *  - DERIVED over `HANDLER_VALIDATION_REGISTRY`: EVERY declared parameter of
 *    EVERY handler must render clean copy, and must have a product phrasing.
 *    A handler that adds a parameter turns this RED rather than shipping a new
 *    leak. (The registry is the source of truth; nothing here is hand-listed.)
 *  - EXACT-STRING pins for the live `strength` case, so a future refactor that
 *    keeps the prohibitions but loses the meaning is still caught.
 */
import { describe, it, expect } from 'vitest';

import { composeValidationFailure } from '../validation-failure-responses.js';
import { PARAMETER_USER_PHRASING } from '../parameter-user-phrasing.js';
import { describeSchema } from '../helpers.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { ComposeContext } from '../types.js';
import type { HandlerValidationRegistry, ValidationError } from '../../routing/validator.js';

const REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
};
const CTX: ComposeContext = { handlerRegistry: REGISTRY };

function composeFor(error: ValidationError) {
  return composeValidationFailure(error, CTX, 'frame');
}

/** Every (handler_id, parameter, schema) the registry actually declares —
 *  DERIVED, so a new handler parameter cannot escape these guards. */
function declaredParameters(): { handler: string; parameter: string; constraint: string }[] {
  const out: { handler: string; parameter: string; constraint: string }[] = [];
  for (const [handler, decl] of Object.entries(HANDLER_VALIDATION_REGISTRY)) {
    for (const [parameter, schema] of Object.entries(decl.parameter_schemas ?? {})) {
      out.push({ handler, parameter, constraint: describeSchema(schema) });
    }
  }
  return out;
}

const DECLARED = declaredParameters();

describe('ROADMAP 2.380 FIX 3 — derived guards over the whole handler registry', () => {
  it('the registry actually declares parameters (a vacuous [] would make every guard below pass by testing nothing)', () => {
    // Trap 13: an absence assertion must first prove it can see a presence.
    expect(DECLARED.length).toBeGreaterThan(0);
    expect(DECLARED.map((d) => d.parameter)).toContain('strength');
  });

  it('every declared parameter has a product phrasing (fails LOUD when a handler adds one)', () => {
    const missing = DECLARED.filter((d) => !(d.parameter in PARAMETER_USER_PHRASING)).map(
      (d) => `${d.handler}.${d.parameter}`,
    );
    expect(missing, 'add these to PARAMETER_USER_PHRASING').toEqual([]);
  });

  it.each(DECLARED)(
    'never renders the quoted internal name or the raw constraint: $handler.$parameter',
    ({ parameter, constraint }) => {
      const { response } = composeFor({
        code: 'PARAMETER_INVALID',
        message: 'bad param',
        details: {
          parameter,
          issue: 'Number must be less than or equal to 1',
          actual_value: 42,
          constraint_description: constraint,
        },
      });

      const text = response.assistant_text;
      // The internal identifier, quoted, is the exact leak that shipped.
      expect(text).not.toContain(`'${parameter}'`);
      // The validator's raw constraint description must not be dumped.
      expect(text).not.toContain(constraint);
      // ...and neither may the chip's message, which becomes a user turn.
      for (const action of response.suggested_actions) {
        expect(action.message ?? '').not.toContain(`'${parameter}'`);
        expect(action.message ?? '').not.toContain(constraint);
      }
      // Still actionable: the reply must not be empty and must offer a chip.
      expect(text.length).toBeGreaterThan(0);
      expect(response.suggested_actions.length).toBeGreaterThan(0);
    },
  );

  it('the raw constraint for strength really is the leaky string (control for the guard above)', () => {
    // If `describeSchema` stopped producing this, the guards above would be
    // asserting the absence of a string that no longer exists — vacuous.
    const strength = DECLARED.find((d) => d.parameter === 'strength');
    expect(strength?.constraint).toBe('a number between -1 and 1');
  });
});

describe('ROADMAP 2.380 FIX 3 — exact rendered copy for the live `strength` failure', () => {
  const LIVE_FAILURE: ValidationError = {
    code: 'PARAMETER_INVALID',
    message: 'Parameter "strength" failed schema: Number must be less than or equal to 1',
    details: {
      parameter: 'strength',
      issue: 'Number must be less than or equal to 1',
      actual_value: 30,
      constraint_description: 'a number between -1 and 1',
    },
  };

  it('renders the pinned plain-language copy, not the validator sentence', () => {
    const { response, template_id } = composeFor(LIVE_FAILURE);
    expect(template_id).toBe('parameter_invalid');
    // EXACT pin. The live string was:
    //   'strength' needs to be a number between -1 and 1. You gave 30.
    expect(response.assistant_text).toBe(
      "I couldn't use that as the strength of that link. Strength runs from minus one to plus one, " +
        'where the sign sets the direction and the size sets how much it matters. ' +
        "Try 'strong', 'moderate' or 'weak', or a number in that range.",
    );
  });

  it('the chip no longer names the internal parameter', () => {
    const { response } = composeFor(LIVE_FAILURE);
    expect(response.suggested_actions[0]?.label).toBe('Try a different value');
    expect(response.suggested_actions[0]?.message).toBe(
      'Use a different strength for that link.',
    );
    // The live chip said exactly this. It must be gone.
    expect(response.suggested_actions[0]?.message).not.toBe('Use a different value for strength.');
  });

  it('does NOT echo the raw actual value back (30 was a scale the user was never shown)', () => {
    const { response } = composeFor(LIVE_FAILURE);
    expect(response.assistant_text).not.toContain('30');
    expect(response.assistant_text).not.toContain('You gave');
  });

  it('an UNDECLARED parameter still renders clean, generic copy (no leak through the fallback)', () => {
    const { response } = composeFor({
      code: 'PARAMETER_INVALID',
      message: 'bad',
      details: {
        parameter: 'internal_widget_id',
        actual_value: 7,
        constraint_description: 'a number between 0 and 3',
      },
    });
    expect(response.assistant_text).not.toContain('internal_widget_id');
    expect(response.assistant_text).not.toContain('a number between 0 and 3');
    expect(response.suggested_actions[0]?.message).not.toContain('internal_widget_id');
    expect(response.assistant_text.length).toBeGreaterThan(0);
  });
});
