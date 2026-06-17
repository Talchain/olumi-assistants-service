/**
 * V5 alpha hardening Phase 2.2 — recoverable-validator composer tests.
 *
 * Two coverage goals:
 *
 *  1. `VALIDATION_COMPOSERS` map is exhaustive over `ValidationErrorCode`
 *     and produces a valid clean-body OlumiResponse for every code.
 *
 *  2. No composer leaks internal developer terminology or raw ID prefixes
 *     into user-facing text (correction 9). Scan every composed
 *     assistant_text against a forbidden-term regex.
 *
 * The composer layer is pure — no LLM, no IO. These are unit tests.
 */

import { describe, expect, it } from 'vitest';

import { composeRecoverableValidationResponse } from '../recoverable-validation-response.js';
import type { ValidationError, ValidationErrorCode } from '../../routing/validator.js';
import { VALIDATION_COMPOSERS } from '../validation-failure-responses.js';
import type { ComposeContext } from '../types.js';

const STAGE = 'analyse';

const REGISTRY = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option', 'goal'] as const,
    confirmation_template: 'ok',
  },
};

const CTX: ComposeContext = {
  handlerRegistry: REGISTRY,
};

// Forbidden substrings — correction 9. Raw ID prefixes mirror the real
// staging PLoT capture in the resilience contract (opt_1, fac_churn_rate_2,
// goal_1, risk_1 all appear in that response envelope).
const FORBIDDEN_TERMS: readonly string[] = [
  'ContextPack',
  'state_commit',
  'kind_mismatch',
  'opt_',
  'fac_',
  'goal_',
  'risk_',
];

function sampleError(code: ValidationErrorCode): ValidationError {
  switch (code) {
    case 'HANDLER_NOT_FOUND':
      return {
        code,
        message: 'Unknown handler',
        details: { handler_id: 'mystery_handler', registered: ['run_analysis'] },
      };
    case 'ENTITY_KIND_MISMATCH':
      return {
        code,
        message: 'Kind mismatch',
        details: {
          handler_id: 'run_analysis',
          proposed_kind: 'option',
          resolved_kind: 'decision',
          accepted_kinds: ['option', 'goal'],
          proposed_label: 'Hire contractor',
        },
      };
    case 'ENTITY_NOT_FOUND':
      return {
        code,
        message: 'Entity missing',
        details: {
          entity_id: 'opt_missing',
          entity_kind: 'option',
          entity_label: 'A fresh option',
        },
      };
    case 'ENTITY_RESOLUTION_AMBIGUOUS':
      return {
        code,
        message: 'Which one',
        details: {
          entity_id: 'opt_1',
          entity_kind: 'option',
          resolution_status: 'ambiguous',
          candidates: [{ label: 'Hire contractor' }, { label: 'Hire in-house' }],
        },
      };
    case 'ENTITY_RESOLUTION_SUSPICIOUS':
      return {
        code,
        message: 'Suspicious label match',
        details: {
          entity_id: 'opt_1',
          entity_kind: 'option',
          chosen: { id: 'opt_1', label: 'Hire contractor', dice: 0.4 },
          closer_candidate: { id: 'opt_2', label: 'Hire contractor NOW', dice: 0.7 },
          delta: 0.3,
        },
      };
    case 'PARAMETER_INVALID':
      return {
        code,
        message: 'Bad param',
        details: {
          parameter: 'seed',
          issue: 'Expected number',
          actual_value: 'not-a-number',
          constraint_description: 'a positive number',
        },
      };
    case 'OPTION_INTERVENTION_MISROUTE':
      return {
        code,
        message: 'Option intervention implied',
        details: { handler_id: 'set_factor_value', factor_label: 'Annual Support Cost' },
      };
    case 'PRECONDITION_UNMET':
      return {
        code,
        message: 'Precondition failed',
        details: { handler_id: 'run_analysis', reason: 'no_options_defined' },
      };
  }
}

const ALL_CODES: readonly ValidationErrorCode[] = [
  'HANDLER_NOT_FOUND',
  'ENTITY_KIND_MISMATCH',
  'ENTITY_NOT_FOUND',
  'ENTITY_RESOLUTION_AMBIGUOUS',
  'ENTITY_RESOLUTION_SUSPICIOUS',
  'PARAMETER_INVALID',
  'OPTION_INTERVENTION_MISROUTE',
  'PRECONDITION_UNMET',
];

describe('recoverable-validation-response', () => {
  it('VALIDATION_COMPOSERS covers every ValidationErrorCode', () => {
    const keys = Object.keys(VALIDATION_COMPOSERS).sort();
    expect(keys).toEqual([...ALL_CODES].sort());
  });

  it.each(ALL_CODES)(
    '%s produces a clean-body OlumiResponse (no error block)',
    (code) => {
      const result = composeRecoverableValidationResponse(
        sampleError(code),
        CTX,
        STAGE,
      );
      expect(result.response.response_version).toBe(2);
      expect(result.response.blocks).toEqual([]);
      expect(result.response.suggested_actions.length).toBeGreaterThan(0);
      expect(result.response.assistant_text.length).toBeGreaterThan(0);
      expect(result.response.stage_indicator).toBe(STAGE);
      expect(result.template_id).not.toBe('unknown_validation_code');
    },
  );

  it.each(ALL_CODES)(
    '%s assistant_text does not leak internal terminology or raw ID prefixes',
    (code) => {
      const { response } = composeRecoverableValidationResponse(
        sampleError(code),
        CTX,
        STAGE,
      );
      const text = response.assistant_text;
      for (const term of FORBIDDEN_TERMS) {
        expect(text).not.toContain(term);
      }
      // Also assert no raw ID fragment of the form `prefix_1` with a
      // trailing digit (e.g. `opt_1`, `goal_1`) — belt and braces.
      expect(text).not.toMatch(/\b(opt|fac|goal|risk|out)_\d+/);
    },
  );

  it.each(ALL_CODES)(
    '%s chip messages do not leak internal terminology',
    (code) => {
      const { response } = composeRecoverableValidationResponse(
        sampleError(code),
        CTX,
        STAGE,
      );
      for (const chip of response.suggested_actions) {
        for (const term of FORBIDDEN_TERMS) {
          expect(chip.label).not.toContain(term);
          expect(chip.message).not.toContain(term);
        }
      }
    },
  );
});
