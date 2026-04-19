/**
 * Tool-use schema + parser — unit tests.
 *
 * Floor per brief §4 D3: 12 tests.
 */

import { describe, expect, it } from 'vitest';

import {
  OLUMI_ACTION_TOOL,
  OLUMI_ACTION_TOOL_NAME,
  ToolCallParseError,
  parseToolCallResponse,
} from '../tool-schema.js';

const VALID_EXECUTE_INPUT = {
  intent_class: 'execute' as const,
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'scen-abc',
      kind: 'option' as const,
      resolution_status: 'resolved' as const,
      resolution_method: 'id_match' as const,
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

const VALID_CLARIFY_INPUT = {
  intent_class: 'clarify' as const,
  clarification: {
    ambiguity_type: 'entity' as const,
    question: 'Which factor did you mean?',
    candidates: [
      { id: 'f-1', label: 'Customer Churn' },
      { id: 'f-2', label: 'Customer Acquisition Cost' },
    ],
  },
};

const VALID_CONVERSE_INPUT = { intent_class: 'converse' as const };

const VALID_COACH_INPUT = {
  intent_class: 'coach' as const,
  coaching_mode: 'challenge' as const,
};

describe('OLUMI_ACTION_TOOL definition', () => {
  it('exposes the tool name and input schema in Anthropic SDK format', () => {
    expect(OLUMI_ACTION_TOOL.name).toBe(OLUMI_ACTION_TOOL_NAME);
    expect(OLUMI_ACTION_TOOL.name).toBe('olumi_action');
    expect(OLUMI_ACTION_TOOL.input_schema.type).toBe('object');
    expect(OLUMI_ACTION_TOOL.input_schema.required).toContain('intent_class');
  });

  it('lists all four intent_class enum values', () => {
    const enumValues = (OLUMI_ACTION_TOOL.input_schema.properties.intent_class as { enum: string[] }).enum;
    expect(enumValues).toEqual(['execute', 'clarify', 'converse', 'coach']);
  });
});

describe('parseToolCallResponse', () => {
  it('parses a valid execute proposal', () => {
    const result = parseToolCallResponse(VALID_EXECUTE_INPUT);
    expect(result.intent_class).toBe('execute');
    if (result.intent_class === 'execute') {
      expect(result.action.handler_id).toBe('run_analysis');
      expect(result.action.entity.kind).toBe('option');
      expect(result.action.entity.resolution_status).toBe('resolved');
    }
  });

  it('parses a valid clarify proposal', () => {
    const result = parseToolCallResponse(VALID_CLARIFY_INPUT);
    expect(result.intent_class).toBe('clarify');
    if (result.intent_class === 'clarify') {
      expect(result.clarification.ambiguity_type).toBe('entity');
      expect(result.clarification.candidates?.length).toBe(2);
    }
  });

  it('parses a converse response', () => {
    const result = parseToolCallResponse(VALID_CONVERSE_INPUT);
    expect(result.intent_class).toBe('converse');
  });

  it('parses a coach response with coaching_mode preserved', () => {
    const result = parseToolCallResponse(VALID_COACH_INPUT);
    expect(result.intent_class).toBe('coach');
    if (result.intent_class === 'coach') {
      expect(result.coaching_mode).toBe('challenge');
    }
  });

  it('parses a coach response without coaching_mode', () => {
    const result = parseToolCallResponse({ intent_class: 'coach' });
    expect(result.intent_class).toBe('coach');
  });

  it('rejects execute without action field', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'execute' }),
    ).toThrow(ToolCallParseError);
  });

  it('rejects execute carrying a clarification field', () => {
    expect(() =>
      parseToolCallResponse({
        ...VALID_EXECUTE_INPUT,
        clarification: { ambiguity_type: 'entity', question: 'which?' },
      }),
    ).toThrow(/clarification is forbidden/);
  });

  it('rejects clarify without clarification field', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'clarify' }),
    ).toThrow(ToolCallParseError);
  });

  it('rejects clarify carrying an action field', () => {
    expect(() =>
      parseToolCallResponse({
        ...VALID_CLARIFY_INPUT,
        action: VALID_EXECUTE_INPUT.action,
      }),
    ).toThrow(/action is forbidden/);
  });

  it('rejects converse carrying coaching_mode (coach-only field)', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'converse', coaching_mode: 'deepen' }),
    ).toThrow(/coaching_mode is forbidden/);
  });

  it('rejects unknown top-level keys (strict mode)', () => {
    expect(() =>
      parseToolCallResponse({ ...VALID_CONVERSE_INPUT, bogus: 'field' }),
    ).toThrow(ToolCallParseError);
  });

  it('rejects invalid enum values in intent_class', () => {
    expect(() =>
      parseToolCallResponse({ intent_class: 'frame' }),
    ).toThrow(ToolCallParseError);
  });

  it('ACCEPTS execute with resolution_status === "ambiguous" (validator flags downstream)', () => {
    const input = {
      ...VALID_EXECUTE_INPUT,
      action: {
        ...VALID_EXECUTE_INPUT.action,
        entity: {
          ...VALID_EXECUTE_INPUT.action.entity,
          resolution_status: 'ambiguous' as const,
          candidates: [{ id: 'c-1', label: 'Option A' }],
        },
      },
    };
    const result = parseToolCallResponse(input);
    expect(result.intent_class).toBe('execute');
    if (result.intent_class === 'execute') {
      expect(result.action.entity.resolution_status).toBe('ambiguous');
    }
  });

  it('rejects invalid entity.kind values', () => {
    const input = {
      ...VALID_EXECUTE_INPUT,
      action: {
        ...VALID_EXECUTE_INPUT.action,
        entity: { ...VALID_EXECUTE_INPUT.action.entity, kind: 'factor' },
      },
    };
    expect(() => parseToolCallResponse(input)).toThrow(ToolCallParseError);
  });

  it('preserves every enum value for resolution_method', () => {
    const methods = ['id_match', 'label_match', 'kind_inference', 'context_inference'] as const;
    for (const method of methods) {
      const result = parseToolCallResponse({
        ...VALID_EXECUTE_INPUT,
        action: {
          ...VALID_EXECUTE_INPUT.action,
          entity: { ...VALID_EXECUTE_INPUT.action.entity, resolution_method: method },
        },
      });
      expect(result.intent_class).toBe('execute');
      if (result.intent_class === 'execute') {
        expect(result.action.entity.resolution_method).toBe(method);
      }
    }
  });

  it('preserves ambiguity_type enum values across clarify parses', () => {
    const types = ['entity', 'parameter', 'intent', 'scope', 'missing_context'] as const;
    for (const t of types) {
      const result = parseToolCallResponse({
        intent_class: 'clarify',
        clarification: { ambiguity_type: t, question: 'Q?' },
      });
      expect(result.intent_class).toBe('clarify');
      if (result.intent_class === 'clarify') {
        expect(result.clarification.ambiguity_type).toBe(t);
      }
    }
  });
});
