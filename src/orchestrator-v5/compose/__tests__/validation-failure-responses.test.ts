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
  it('structural mismatch uses proposed_label when present', () => {
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
    expect(template_id).toBe('kind_mismatch_structural');
    expect(response.assistant_text).toContain('Churn Risk');
    expect(response.assistant_text).toContain('node');
    expect(response.assistant_text).toContain('option');
    expect(response.suggested_actions.length).toBe(1);
    assertStyle(response.assistant_text);
  });

  it('graph-resolved mismatch shows resolved_kind', () => {
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
    expect(template_id).toBe('kind_mismatch_graph');
    expect(response.assistant_text).toContain('node');
    expect(response.assistant_text).toContain('option');
    expect(response.assistant_text).not.toContain('fac_churn');
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

describe('composeValidationFailure — response shape', () => {
  it('always returns an INTERNAL_ERROR block with failure_origin=validator + error_code', () => {
    const { response } = composeFor({
      code: 'HANDLER_NOT_FOUND',
      message: 'unknown',
      details: { handler_id: 'x' },
    });
    const block = response.blocks[0];
    expect(block?.type).toBe('error');
    if (block?.type === 'error') {
      expect(block.error_code).toBe('INTERNAL_ERROR');
      expect(block.details?.failure_origin).toBe('validator');
      expect(block.details?.error_code).toBe('HANDLER_NOT_FOUND');
    }
  });

  it('every reachable code returns at least one chip and a typed chip_type', () => {
    const codes: ValidationError['code'][] = [
      'HANDLER_NOT_FOUND',
      'ENTITY_KIND_MISMATCH',
      'ENTITY_NOT_FOUND',
      'ENTITY_RESOLUTION_AMBIGUOUS',
      'ENTITY_RESOLUTION_SUSPICIOUS',
      'PARAMETER_INVALID',
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
