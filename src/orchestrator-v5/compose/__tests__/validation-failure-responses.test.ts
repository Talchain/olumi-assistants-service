import { describe, it, expect } from 'vitest';

import { composeValidationFailure } from '../validation-failure-responses.js';
import type { ComposeContext } from '../types.js';
import type { GraphLookup, ValidationError } from '../../routing/validator.js';
import type { HandlerValidationRegistry } from '../../routing/validator.js';

const REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    accepted_entity_kinds: ['option'],
    confirmation_template: 'ok',
  },
};

const EMPTY_CTX: ComposeContext = { handlerRegistry: REGISTRY };

function graphWith(entities: Array<{ id: string; label: string; kind: string }>): GraphLookup {
  return {
    findEntityById(id) {
      const m = entities.find((e) => e.id === id);
      return m ? { id: m.id, kind: m.kind as never, label: m.label } : null;
    },
    listEntitiesByKind(kind) {
      return entities
        .filter((e) => e.kind === kind)
        .map((e) => ({ id: e.id, label: e.label }));
    },
  };
}

function composeFor(error: ValidationError, ctx: ComposeContext = EMPTY_CTX) {
  return composeValidationFailure(error, ctx, 'frame');
}

const FORBIDDEN_WORDS = /\b(recommended|recommendation|winner)\b/i;
const EM_DASH = /[—–]/;

function countSentences(text: string): number {
  const matches = text.match(/[.!?](?=\s|$)/g);
  return matches ? matches.length : 0;
}

function assertStyle(text: string): void {
  expect(text).not.toMatch(FORBIDDEN_WORDS);
  expect(text).not.toMatch(EM_DASH);
  expect(countSentences(text)).toBeLessThanOrEqual(3);
}

describe('composeValidationFailure — HANDLER_NOT_FOUND', () => {
  it('offers curated handler chips when registry has user-facing handlers', () => {
    const { response, template_id } = composeFor({
      code: 'HANDLER_NOT_FOUND',
      message: 'Unknown handler',
      details: { handler_id: 'mystery_handler', registered: ['run_analysis'] },
    });
    expect(template_id).toBe('handler_not_found');
    expect(response.assistant_text).toMatch(/don't recognise/i);
    expect(response.suggested_actions.length).toBeGreaterThan(0);
    expect(response.suggested_actions[0]?.action_type).toBe('run_analysis');
    expect(response.assistant_text).not.toContain('mystery_handler');
    assertStyle(response.assistant_text);
  });

  it('falls back to a text-prompt chip when registry has no user-facing handlers', () => {
    const { response } = composeFor(
      {
        code: 'HANDLER_NOT_FOUND',
        message: 'Unknown handler',
        details: { handler_id: 'x' },
      },
      { handlerRegistry: {} },
    );
    expect(response.suggested_actions.length).toBe(1);
    expect(response.suggested_actions[0]?.action_type).toBeUndefined();
  });
});

describe('composeValidationFailure — ENTITY_RESOLUTION_AMBIGUOUS', () => {
  it('emits one chip per candidate when candidates present', () => {
    const { response, template_id } = composeFor({
      code: 'ENTITY_RESOLUTION_AMBIGUOUS',
      message: 'ambiguous',
      details: {
        entity_kind: 'option',
        candidates: [
          { id: 'a', label: 'Option A' },
          { id: 'b', label: 'Option B' },
        ],
      },
    });
    expect(template_id).toBe('ambiguous_with_candidates');
    expect(response.suggested_actions.length).toBe(2);
    expect(response.suggested_actions[0]?.label).toBe('Option A');
    expect(response.suggested_actions[0]?.message).toMatch(/I meant Option A/);
    assertStyle(response.assistant_text);
  });

  it('falls back when candidates absent', () => {
    const { response, template_id } = composeFor({
      code: 'ENTITY_RESOLUTION_AMBIGUOUS',
      message: 'ambiguous',
      details: { entity_kind: 'option' },
    });
    expect(template_id).toBe('ambiguous_no_candidates');
    expect(response.suggested_actions.length).toBe(1);
    assertStyle(response.assistant_text);
  });
});

describe('composeValidationFailure — ENTITY_KIND_MISMATCH', () => {
  const KIND_MISMATCH_PATTERN =
    /^I wasn't sure what you meant by .+\. Try asking about a specific option, or describe what you'd like to change\.$/;
  const INTERNAL_KIND_LABELS = ['node', 'edge', 'goal', 'constraint'] as const;

  it('uses proposed_label when present and uses the fixed template', () => {
    const { response, template_id } = composeFor({
      code: 'ENTITY_KIND_MISMATCH',
      message: 'kind mismatch',
      details: {
        handler_id: 'run_analysis',
        proposed_kind: 'node',
        accepted_kinds: ['option'],
        proposed_label: 'Churn Risk',
      },
    });
    expect(template_id).toBe('kind_mismatch');
    expect(response.assistant_text).toMatch(KIND_MISMATCH_PATTERN);
    expect(response.assistant_text).toContain('Churn Risk');
    expect(response.suggested_actions.length).toBe(1);
    assertStyle(response.assistant_text);
  });

  it('does not leak internal kind labels — graph-resolved mismatch', () => {
    const { response, template_id } = composeFor({
      code: 'ENTITY_KIND_MISMATCH',
      message: 'mismatch',
      details: {
        entity_id: 'fac_churn',
        proposed_kind: 'option',
        resolved_kind: 'node',
        proposed_label: 'Churn Risk',
      },
    });
    expect(template_id).toBe('kind_mismatch');
    expect(response.assistant_text).toMatch(KIND_MISMATCH_PATTERN);
    expect(response.assistant_text).toContain('Churn Risk');
    expect(response.assistant_text).not.toContain('fac_churn');
    for (const label of INTERNAL_KIND_LABELS) {
      expect(response.assistant_text).not.toMatch(new RegExp(`\\b${label}\\b`, 'i'));
    }
    assertStyle(response.assistant_text);
  });

  it('renders cleanly across every EntityKind enum value with no jargon leak', () => {
    const KINDS = ['node', 'edge', 'option', 'goal', 'constraint'] as const;
    for (const proposed of KINDS) {
      for (const resolved of [...KINDS, undefined]) {
        const { response, template_id } = composeFor({
          code: 'ENTITY_KIND_MISMATCH',
          message: 'mismatch',
          details: {
            proposed_kind: proposed,
            ...(resolved ? { resolved_kind: resolved } : { accepted_kinds: ['option'] }),
            proposed_label: 'Some Entity',
          },
        });
        expect(template_id).toBe('kind_mismatch');
        expect(response.assistant_text).toMatch(KIND_MISMATCH_PATTERN);
        for (const label of INTERNAL_KIND_LABELS) {
          expect(response.assistant_text).not.toMatch(new RegExp(`\\b${label}\\b`, 'i'));
        }
        expect(response.assistant_text).not.toMatch(/\bkind\b/i);
        assertStyle(response.assistant_text);
      }
    }
  });

  it('handles a missing proposed_label via safeLabel fallback', () => {
    const { response, template_id } = composeFor({
      code: 'ENTITY_KIND_MISMATCH',
      message: 'mismatch',
      details: {
        proposed_kind: 'node',
        accepted_kinds: ['option'],
      },
    });
    expect(template_id).toBe('kind_mismatch');
    expect(response.assistant_text).toMatch(KIND_MISMATCH_PATTERN);
    expect(response.suggested_actions.length).toBe(1);
    assertStyle(response.assistant_text);
  });
});

describe('composeValidationFailure — ENTITY_NOT_FOUND', () => {
  it('offers sibling chips when graph is present', () => {
    const graph = graphWith([
      { id: 'opt_a', label: 'Option A', kind: 'option' },
      { id: 'opt_b', label: 'Option B', kind: 'option' },
    ]);
    const { response, template_id } = composeFor(
      {
        code: 'ENTITY_NOT_FOUND',
        message: 'missing',
        details: {
          entity_id: 'opt_missing',
          entity_kind: 'option',
          entity_label: 'Missing Option',
        },
      },
      { handlerRegistry: REGISTRY, graph },
    );
    expect(template_id).toBe('entity_not_found_with_siblings');
    expect(response.assistant_text).toContain('Missing Option');
    expect(response.suggested_actions.length).toBe(2);
    expect(response.assistant_text).not.toContain('opt_missing');
    assertStyle(response.assistant_text);
  });

  it('falls back to text-prompt chip when graph absent', () => {
    const { response, template_id } = composeFor({
      code: 'ENTITY_NOT_FOUND',
      message: 'missing',
      details: { entity_id: 'opt_x', entity_kind: 'option' },
    });
    expect(template_id).toBe('entity_not_found_no_siblings');
    expect(response.assistant_text).not.toContain('opt_x');
    expect(response.suggested_actions.length).toBe(1);
    assertStyle(response.assistant_text);
  });

  it('never leaks the raw ID when label absent', () => {
    const { response } = composeFor({
      code: 'ENTITY_NOT_FOUND',
      message: 'missing',
      details: { entity_id: 'fac_churn_x7', entity_kind: 'node' },
    });
    expect(response.assistant_text).not.toContain('fac_churn_x7');
    expect(response.assistant_text).toContain('that node');
  });
});

describe('composeValidationFailure — ENTITY_RESOLUTION_SUSPICIOUS', () => {
  it('shows both candidate labels and emits a chip for each', () => {
    const { response, template_id } = composeFor({
      code: 'ENTITY_RESOLUTION_SUSPICIOUS',
      message: 'suspicious',
      details: {
        entity_id: 'opt_a',
        chosen: { id: 'opt_a', label: 'Option A', dice: 0.2 },
        closer_candidate: { id: 'opt_b', label: 'Option B', dice: 0.8 },
        delta: 0.6,
      },
    });
    expect(template_id).toBe('resolution_suspicious');
    expect(response.assistant_text).toContain('Option A');
    expect(response.assistant_text).toContain('Option B');
    expect(response.suggested_actions.length).toBe(2);
    assertStyle(response.assistant_text);
  });
});

describe('composeValidationFailure — PRECONDITION_UNMET', () => {
  it('emits a specific template for run_analysis + no_options_defined', () => {
    const { response, template_id } = composeFor({
      code: 'PRECONDITION_UNMET',
      message: 'no options',
      details: { handler_id: 'run_analysis', reason: 'no_options_defined' },
    });
    expect(template_id).toBe('precondition_no_options');
    expect(response.assistant_text).toMatch(/option to compare/);
    expect(response.suggested_actions[0]?.label).toBe('Add an option');
    assertStyle(response.assistant_text);
  });

  it('emits a generic template for unknown preconditions', () => {
    const { response, template_id } = composeFor({
      code: 'PRECONDITION_UNMET',
      message: 'strange',
      details: { handler_id: 'something_else', reason: 'unknown' },
    });
    expect(template_id).toBe('precondition_generic');
    expect(response.suggested_actions.length).toBe(1);
    assertStyle(response.assistant_text);
  });
});

describe('composeValidationFailure — PARAMETER_INVALID', () => {
  it('substitutes parameter, constraint and sanitised actual value', () => {
    const { response, template_id } = composeFor({
      code: 'PARAMETER_INVALID',
      message: 'bad param',
      details: {
        parameter: 'value',
        issue: 'Number must be less than or equal to 1',
        actual_value: 1.5,
        constraint_description: 'a number between 0 and 1',
      },
    });
    expect(template_id).toBe('parameter_invalid');
    expect(response.assistant_text).toContain('value');
    expect(response.assistant_text).toContain('a number between 0 and 1');
    expect(response.assistant_text).toContain('1.5');
    expect(response.suggested_actions[0]?.label).toBe('Try a different value');
    assertStyle(response.assistant_text);
  });

  it('copes when constraint_description or actual_value are missing', () => {
    const { response } = composeFor({
      code: 'PARAMETER_INVALID',
      message: 'bad',
      details: { parameter: 'value' },
    });
    expect(response.assistant_text).toContain('value');
    expect(response.suggested_actions.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Fix B — missing-value copy hardening (CEE V5 Golden Journey row 7
// workstream). The validator's `missing_value` branch must produce a
// helpful, user-readable message — never the "unknown" sentinel that
// previously leaked from `sanitiseForUser(undefined)`.
// ---------------------------------------------------------------------------

describe('composeValidationFailure — PARAMETER_INVALID missing_value (Fix B)', () => {
  it('rejection_reason=missing_value with no actual_value → helpful copy, no "unknown" leak', () => {
    const { response, template_id } = composeFor({
      code: 'PARAMETER_INVALID',
      message: 'value parameter is missing',
      details: {
        parameter: 'value',
        rejection_reason: 'missing_value',
        handler_id: 'set_factor_value',
      },
    });
    expect(template_id).toBe('parameter_invalid_missing_value');
    expect(response.assistant_text).not.toContain('unknown');
    expect(response.assistant_text).not.toContain('You gave');
    // Must guide the user toward supplying a value.
    expect(response.assistant_text.toLowerCase()).toContain("couldn't tell what value");
    expect(response.suggested_actions.length).toBeGreaterThan(0);
    assertStyle(response.assistant_text);
  });

  it('rejection_reason=missing_value with actual_value=null → helpful copy, no "unknown" leak', () => {
    const { response, template_id } = composeFor({
      code: 'PARAMETER_INVALID',
      message: 'value parameter is missing',
      details: {
        parameter: 'value',
        rejection_reason: 'missing_value',
        actual_value: null,
        handler_id: 'set_factor_value',
      },
    });
    expect(template_id).toBe('parameter_invalid_missing_value');
    expect(response.assistant_text).not.toContain('unknown');
    expect(response.assistant_text.toLowerCase()).toContain("couldn't tell what value");
    assertStyle(response.assistant_text);
  });

  it('real invalid scalar value (1.5 with constraint 0–1) keeps the existing "You gave" copy unchanged', () => {
    const { response, template_id } = composeFor({
      code: 'PARAMETER_INVALID',
      message: 'bad param',
      details: {
        parameter: 'value',
        issue: 'Number must be less than or equal to 1',
        actual_value: 1.5,
        constraint_description: 'a number between 0 and 1',
      },
    });
    expect(template_id).toBe('parameter_invalid');
    expect(response.assistant_text).toContain('1.5');
    expect(response.assistant_text).toContain('You gave');
    assertStyle(response.assistant_text);
  });
});

// ---------------------------------------------------------------------------
// task_99f83f0d — "You gave unknown." leak must die for ANY PARAMETER_INVALID
// path that omits actual_value (invalid_operator, graph predicates), not only
// the missing_value branch. The clause drops; the constraint guidance stays.
// ---------------------------------------------------------------------------

describe('composeValidationFailure — PARAMETER_INVALID undefined actual (task_99f83f0d)', () => {
  it('actual_value omitted (no missing_value reason) → no "You gave unknown." leak', () => {
    const { response, template_id } = composeFor({
      code: 'PARAMETER_INVALID',
      message: 'invalid operator',
      details: { parameter: 'value', constraint_description: 'a valid value' },
    });
    expect(template_id).toBe('parameter_invalid');
    expect(response.assistant_text).not.toContain('You gave');
    expect(response.assistant_text).not.toContain('unknown');
    // Constraint guidance is preserved.
    expect(response.assistant_text).toContain('needs to be a valid value');
    assertStyle(response.assistant_text);
  });

  it('genuine scalar still renders "You gave X" (no regression)', () => {
    const { response } = composeFor({
      code: 'PARAMETER_INVALID',
      message: 'bad',
      details: { parameter: 'value', actual_value: 1.5, constraint_description: 'a number between 0 and 1' },
    });
    expect(response.assistant_text).toContain('You gave 1.5');
  });
});

// ---------------------------------------------------------------------------
// task_99f83f0d — option-intervention misroute containment. When a
// set_factor_value is refused because the user implied an option-specific
// intervention edit, the composer must clarify (graph already unchanged) and
// must NOT attach an auto-routing chip that could loop back into the misroute.
// ---------------------------------------------------------------------------

describe('composeValidationFailure — OPTION_INTERVENTION_MISROUTE', () => {
  it('clarifies option-vs-factor, names the factor, and offers a text prompt only', () => {
    const { response, template_id, chip_type } = composeFor({
      code: 'OPTION_INTERVENTION_MISROUTE',
      message: 'set_factor_value refused — option-intervention edit implied',
      details: { handler_id: 'set_factor_value', factor_label: 'Annual Support Cost' },
    });
    expect(template_id).toBe('option_intervention_misroute');
    expect(chip_type).toBe('text_prompt');
    expect(response.assistant_text).toContain("option's intervention");
    expect(response.assistant_text).toContain('Annual Support Cost');
    // Reassures the user nothing was mutated.
    expect(response.assistant_text.toLowerCase()).toContain("haven't changed anything");
    // No value/handler-id leak.
    expect(response.assistant_text).not.toContain('set_factor_value');
    // Exactly one chip, and it must NOT carry an action_type (no re-route).
    expect(response.suggested_actions.length).toBe(1);
    expect(response.suggested_actions[0]?.action_type).toBeUndefined();
    assertStyle(response.assistant_text);
  });

  it('reads cleanly when no factor_label is supplied', () => {
    const { response, template_id } = composeFor({
      code: 'OPTION_INTERVENTION_MISROUTE',
      message: 'refused',
      details: { handler_id: 'set_factor_value' },
    });
    expect(template_id).toBe('option_intervention_misroute');
    expect(response.assistant_text).toContain("the factor's own value");
    expect(response.assistant_text).not.toContain('that item');
    assertStyle(response.assistant_text);
  });
});

describe('composeValidationFailure — response shape', () => {
  // v5-exclusive-cee P0 follow-up: HANDLER_NOT_FOUND is now the ONE
  // validation-error branch that surfaces with a different wire code —
  // FEATURE_NOT_ENABLED (via UNSUPPORTED_ACTION) — because the semantic
  // is "the action is declared in the contract but no handler is
  // registered in this deployment." All other validator codes keep
  // the INTERNAL_ERROR wire code.
  it('HANDLER_NOT_FOUND returns FEATURE_NOT_ENABLED with reason + handler_id + retryable:false', () => {
    const { response } = composeFor({
      code: 'HANDLER_NOT_FOUND',
      message: 'unknown',
      details: { handler_id: 'x' },
    });
    const block = response.blocks[0];
    expect(block?.type).toBe('error');
    if (block?.type === 'error') {
      expect(block.error_code).toBe('FEATURE_NOT_ENABLED');
      expect(block.details?.failure_origin).toBe('validator');
      expect(block.details?.error_code).toBe('HANDLER_NOT_FOUND');
      expect(block.details?.reason).toBe('handler_not_registered');
      expect(block.details?.handler_id).toBe('x');
      expect(block.details?.retryable).toBe(false);
    }
  });

  it('other validator codes still return INTERNAL_ERROR with failure_origin=validator', () => {
    const { response } = composeFor({
      code: 'ENTITY_NOT_FOUND',
      message: 'no such entity',
      details: { entity_id: 'opt-a', entity_kind: 'option' },
    });
    const block = response.blocks[0];
    expect(block?.type).toBe('error');
    if (block?.type === 'error') {
      expect(block.error_code).toBe('INTERNAL_ERROR');
      expect(block.details?.failure_origin).toBe('validator');
      expect(block.details?.error_code).toBe('ENTITY_NOT_FOUND');
    }
  });

  // v5-exclusive-cee P1 follow-up: retryability is false by default for
  // validator failures. All 7 current validator codes are deterministic
  // input faults — retrying the same turn with the same inputs will
  // always fail. A client that sees retryable:true would enter a
  // pointless retry loop. The previous implementation had the default
  // inverted (retryable:true unless HANDLER_NOT_FOUND); this test locks
  // in the corrected semantics per validator code.
  describe('retryability per validator code', () => {
    const allValidatorCodes: Array<{
      code: ValidationError['code'];
      details?: Record<string, unknown>;
    }> = [
      { code: 'HANDLER_NOT_FOUND', details: { handler_id: 'set_factor_value' } },
      { code: 'ENTITY_NOT_FOUND', details: { entity_id: 'opt-x', entity_kind: 'option' } },
      { code: 'ENTITY_KIND_MISMATCH', details: { entity_kind: 'node' } },
      { code: 'ENTITY_RESOLUTION_AMBIGUOUS', details: { entity_kind: 'option' } },
      { code: 'ENTITY_RESOLUTION_SUSPICIOUS', details: { entity_kind: 'option' } },
      { code: 'PARAMETER_INVALID', details: { parameter_name: 'value' } },
      { code: 'OPTION_INTERVENTION_MISROUTE', details: { factor_label: 'Annual Support Cost' } },
      { code: 'PRECONDITION_UNMET', details: { reason: 'no_options_defined' } },
    ];

    it.each(allValidatorCodes)(
      '$code → retryable=false (deterministic input fault)',
      ({ code, details }) => {
        const { response } = composeFor({ code, message: `test ${code}`, details: details ?? {} });
        const block = response.blocks[0];
        expect(block?.type).toBe('error');
        if (block?.type === 'error') {
          expect(block.details?.retryable).toBe(false);
        }
      },
    );
  });

  it('every reachable code returns at least one chip and a typed chip_type', () => {
    const codes: ValidationError['code'][] = [
      'HANDLER_NOT_FOUND',
      'ENTITY_KIND_MISMATCH',
      'ENTITY_NOT_FOUND',
      'ENTITY_RESOLUTION_AMBIGUOUS',
      'ENTITY_RESOLUTION_SUSPICIOUS',
      'PARAMETER_INVALID',
      'OPTION_INTERVENTION_MISROUTE',
      'PRECONDITION_UNMET',
    ];
    for (const code of codes) {
      const { response, chip_type } = composeFor({ code, message: '', details: {} });
      expect(response.suggested_actions.length).toBeGreaterThan(0);
      expect(chip_type).not.toBeNull();
      expect(['action', 'text_prompt', 'entity_suggestion']).toContain(chip_type);
    }
  });
});

describe('composeValidationFailure — chip_type classification', () => {
  it('HANDLER_NOT_FOUND with curated handlers → action chip', () => {
    const { chip_type } = composeFor({
      code: 'HANDLER_NOT_FOUND',
      message: '',
      details: { handler_id: 'x' },
    });
    expect(chip_type).toBe('action');
  });

  it('ENTITY_RESOLUTION_AMBIGUOUS with candidates → entity_suggestion', () => {
    const { chip_type } = composeFor({
      code: 'ENTITY_RESOLUTION_AMBIGUOUS',
      message: '',
      details: {
        entity_kind: 'option',
        candidates: [{ id: 'a', label: 'A' }],
      },
    });
    expect(chip_type).toBe('entity_suggestion');
  });

  it('ENTITY_RESOLUTION_SUSPICIOUS → entity_suggestion', () => {
    const { chip_type } = composeFor({
      code: 'ENTITY_RESOLUTION_SUSPICIOUS',
      message: '',
      details: {
        chosen: { label: 'A' },
        closer_candidate: { label: 'B' },
      },
    });
    expect(chip_type).toBe('entity_suggestion');
  });

  it('ENTITY_NOT_FOUND with graph siblings → entity_suggestion', () => {
    const graph = graphWith([
      { id: 'opt_a', label: 'Option A', kind: 'option' },
    ]);
    const { chip_type } = composeFor(
      {
        code: 'ENTITY_NOT_FOUND',
        message: '',
        details: { entity_id: 'x', entity_kind: 'option' },
      },
      { handlerRegistry: REGISTRY, graph },
    );
    expect(chip_type).toBe('entity_suggestion');
  });

  it('PARAMETER_INVALID → text_prompt', () => {
    const { chip_type } = composeFor({
      code: 'PARAMETER_INVALID',
      message: '',
      details: { parameter: 'value' },
    });
    expect(chip_type).toBe('text_prompt');
  });
});

describe('composeValidationFailure — chip emit invariant (P0)', () => {
  it('never emits explain_result or other non-functional actions even when registry contains them', () => {
    // Registry deliberately includes non-functional handlers to test that
    // curatedHandlerChips's USER_FACING_HANDLERS gate blocks them at emit time.
    const fullRegistry: HandlerValidationRegistry = {
      run_analysis: { handler_id: 'run_analysis', accepted_entity_kinds: ['option'], confirmation_template: 'ok' },
      explain_result: { handler_id: 'explain_result', accepted_entity_kinds: [], confirmation_template: 'nope' },
      compare_options: { handler_id: 'compare_options', accepted_entity_kinds: [], confirmation_template: 'nope' },
      what_would_flip: { handler_id: 'what_would_flip', accepted_entity_kinds: [], confirmation_template: 'nope' },
    };
    const { response } = composeFor(
      { code: 'HANDLER_NOT_FOUND', message: 'test', details: { handler_id: 'explain_result' } },
      { handlerRegistry: fullRegistry },
    );
    const emittedActionTypes = response.suggested_actions
      .map((c) => c.action_type)
      .filter(Boolean);
    expect(emittedActionTypes).not.toContain('explain_result');
    expect(emittedActionTypes).not.toContain('compare_options');
    expect(emittedActionTypes).not.toContain('what_would_flip');
    // run_analysis is the only functional action and must be present
    expect(emittedActionTypes).toContain('run_analysis');
  });
});

describe('composeValidationFailure — ENTITY_NOT_FOUND cap', () => {
  it('caps sibling chips at 4', () => {
    const graph = graphWith([
      { id: 'o1', label: 'One', kind: 'option' },
      { id: 'o2', label: 'Two', kind: 'option' },
      { id: 'o3', label: 'Three', kind: 'option' },
      { id: 'o4', label: 'Four', kind: 'option' },
      { id: 'o5', label: 'Five', kind: 'option' },
      { id: 'o6', label: 'Six', kind: 'option' },
    ]);
    const { response } = composeFor(
      {
        code: 'ENTITY_NOT_FOUND',
        message: '',
        details: { entity_id: 'x', entity_kind: 'option' },
      },
      { handlerRegistry: REGISTRY, graph },
    );
    expect(response.suggested_actions.length).toBe(4);
  });
});

// I2: regression guard — unlabeled graph nodes must NEVER surface id-shaped
// tokens in chip labels, chip messages, or assistant_text. The adapter
// historically substituted id into label; this test proves the belt-and-
// braces safeLabel rejection keeps us safe even if a regression resurfaces.
describe('composeValidationFailure — no id-like tokens leak', () => {
  it('ENTITY_NOT_FOUND: unlabeled siblings do not leak ids into chips or text', () => {
    // Simulate a regressed adapter that substitutes id into label (the old
    // bug). safeLabel's id-shape rejection MUST fall back to "that option".
    const graph: GraphLookup = {
      findEntityById: () => null,
      listEntitiesByKind: () => [
        { id: 'opt_abc', label: 'opt_abc' },
        { id: 'opt_xyz', label: null },
        { id: 'fac_churn_x7', label: 'fac_churn_x7' },
      ],
    };
    const { response } = composeFor(
      {
        code: 'ENTITY_NOT_FOUND',
        message: '',
        details: { entity_id: 'opt_missing', entity_kind: 'option' },
      },
      { handlerRegistry: REGISTRY, graph },
    );

    const allText = [
      response.assistant_text,
      ...response.suggested_actions.map((c) => `${c.label} ${c.message}`),
    ].join(' ');

    // None of the raw ids or id-shaped fallbacks should appear anywhere.
    expect(allText).not.toContain('opt_abc');
    expect(allText).not.toContain('opt_xyz');
    expect(allText).not.toContain('opt_missing');
    expect(allText).not.toContain('fac_churn_x7');

    // Chip labels must all be the kind-based fallback — never an id.
    for (const chip of response.suggested_actions) {
      expect(chip.label).toMatch(/^that option$/);
    }
  });

  it('ENTITY_RESOLUTION_SUSPICIOUS: id-shaped chosen/closer labels degrade to kind fallback', () => {
    const { response } = composeFor({
      code: 'ENTITY_RESOLUTION_SUSPICIOUS',
      message: '',
      details: {
        chosen: { id: 'opt_a', label: 'opt_a' },
        closer_candidate: { id: 'opt_b', label: 'opt_b' },
      },
    });
    expect(response.assistant_text).not.toContain('opt_a');
    expect(response.assistant_text).not.toContain('opt_b');
  });

  it('ENTITY_RESOLUTION_SUSPICIOUS with entity_kind uses "that {kind}" fallback not "that item"', () => {
    const { response } = composeFor({
      code: 'ENTITY_RESOLUTION_SUSPICIOUS',
      message: '',
      details: {
        entity_kind: 'option',
        chosen: { id: 'opt_a', label: 'opt_a' },
        closer_candidate: { id: 'opt_b', label: 'opt_b' },
      },
    });
    expect(response.assistant_text).toContain('that option');
    expect(response.assistant_text).not.toContain('that item');
    for (const chip of response.suggested_actions) {
      expect(chip.label).toBe('that option');
    }
  });
});
