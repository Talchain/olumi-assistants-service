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
    const enumValues = OLUMI_ACTION_TOOL.input_schema.properties.intent_class as { enum: readonly string[] };
    expect(enumValues.enum).toEqual(['execute', 'clarify', 'converse', 'coach']);
  });

  it('validates Anthropic API requirement: every object has additionalProperties: false', () => {
    const violations: string[] = [];
    
    function validateObject(obj: unknown, path: string): void {
      if (!obj || typeof obj !== 'object') return;
      const schema = obj as Record<string, unknown>;
      
      if (schema.type === 'object') {
        if (schema.additionalProperties !== false) {
          violations.push(`${path}: type:"object" but additionalProperties is ${schema.additionalProperties}`);
        }
      }
      
      // Recursively check nested properties
      if (schema.properties && typeof schema.properties === 'object') {
        for (const [key, value] of Object.entries(schema.properties)) {
          validateObject(value, `${path}.properties.${key}`);
        }
      }
      
      // Check array items
      if (schema.items && typeof schema.items === 'object') {
        validateObject(schema.items, `${path}.items`);
      }
    }
    
    validateObject(OLUMI_ACTION_TOOL.input_schema, 'input_schema');
    
    if (violations.length > 0) {
      throw new Error(`Anthropic schema violations:\n${violations.join('\n')}`);
    }
  });

  // Simple empty-object guard: walks the whole input_schema and fails on
  // any `{}` node. Catches accidental regressions at source-object level.
  it('contains no empty object schema nodes that Anthropic rejects', () => {
    const emptyObjectPaths: string[] = [];

    function walk(node: unknown, path: string): void {
      if (!node || typeof node !== 'object' || Array.isArray(node)) return;
      const entries = Object.entries(node as Record<string, unknown>);
      if (entries.length === 0) {
        emptyObjectPaths.push(path);
        return;
      }
      for (const [key, value] of entries) {
        walk(value, `${path}.${key}`);
      }
    }

    walk(OLUMI_ACTION_TOOL.input_schema, 'input_schema');

    expect(emptyObjectPaths).toEqual([]);
  });

  // Regression guard for the 23 April 2026 staging incident: Anthropic's
  // strict custom-tool validator rejects any subschema that serialises to
  // `{}` with:
  //   tools.0.custom: Empty schema ({}) that accepts any JSON value is not
  //   supported.
  // A previous P1 fix added additionalProperties:false everywhere but left
  // `value: {}` inside parameters.items.properties unchanged. This test
  // walks the FINAL emitted JSON (after JSON.parse/JSON.stringify — the
  // exact transform the Anthropic SDK forwards) and fails if any subschema
  // position is `{}` or has only `description` with no type-ish keyword.
  // Stronger than the simple walker above: it understands schema positions
  // (oneOf/anyOf/allOf/items/properties children) and catches
  // description-only subschemas that Anthropic also treats as empty.
  it('emits no empty {} subschemas anywhere in the final tool JSON (Anthropic strict-tool guard)', () => {
    // Mirror what buildStrictAnthropicTools produces on the wire.
    const emitted = JSON.parse(
      JSON.stringify({
        name: OLUMI_ACTION_TOOL.name,
        description: OLUMI_ACTION_TOOL.description,
        strict: true,
        input_schema: { ...OLUMI_ACTION_TOOL.input_schema, additionalProperties: false },
      }),
    ) as { input_schema: Record<string, unknown> };

    const TYPE_KEYWORDS = new Set([
      'type',
      'enum',
      'const',
      'oneOf',
      'anyOf',
      'allOf',
      '$ref',
      'not',
    ]);

    const violations: string[] = [];

    function isObject(v: unknown): v is Record<string, unknown> {
      return !!v && typeof v === 'object' && !Array.isArray(v);
    }

    function checkSchemaPosition(node: unknown, path: string): void {
      if (!isObject(node)) return;
      const keys = Object.keys(node);
      if (keys.length === 0) {
        violations.push(`${path}: empty schema {}`);
        return;
      }
      // Guard against description-only subschemas which Anthropic treats as
      // equivalent to `{}`.
      const nonDescriptionKeys = keys.filter((k) => k !== 'description');
      if (
        nonDescriptionKeys.length > 0 &&
        !nonDescriptionKeys.some((k) => TYPE_KEYWORDS.has(k)) &&
        // properties-only / items-only containers are fine — they carry
        // structural info even without an explicit "type" keyword. Detect
        // those so we don't false-positive.
        !nonDescriptionKeys.some((k) => k === 'properties' || k === 'items' || k === 'required' || k === 'additionalProperties')
      ) {
        violations.push(
          `${path}: subschema has no type-ish keyword (keys=${JSON.stringify(keys)})`,
        );
      }
      if (isObject(node.properties)) {
        for (const [k, v] of Object.entries(node.properties)) {
          checkSchemaPosition(v, `${path}.properties.${k}`);
        }
      }
      if (node.items !== undefined) checkSchemaPosition(node.items, `${path}.items`);
      if (Array.isArray(node.oneOf)) {
        node.oneOf.forEach((s, i) => checkSchemaPosition(s, `${path}.oneOf[${i}]`));
      }
      if (Array.isArray(node.anyOf)) {
        node.anyOf.forEach((s, i) => checkSchemaPosition(s, `${path}.anyOf[${i}]`));
      }
      if (Array.isArray(node.allOf)) {
        node.allOf.forEach((s, i) => checkSchemaPosition(s, `${path}.allOf[${i}]`));
      }
    }

    checkSchemaPosition(emitted.input_schema, 'input_schema');

    if (violations.length > 0) {
      throw new Error(
        `Final emitted Anthropic tool JSON contains empty/type-less subschemas:\n${violations.join('\n')}`,
      );
    }
  });

  // V5 Task 1.3: handler_id is constrained to the registered-handler set
  // at the tool-schema layer (what Sonnet sees). The Zod parser remains
  // permissive on purpose — unknown handler_ids fall through to the
  // HANDLER_NOT_FOUND → graceful coaching fallback in the TurnExecutor,
  // which returns 200 instead of 500.
  it('handler_id is constrained to the registered-handler enum', () => {
    const action = OLUMI_ACTION_TOOL.input_schema.properties.action as {
      properties: { handler_id: { type: string; enum?: readonly string[] } };
    };
    expect(action.properties.handler_id.type).toBe('string');
    // V5 0.9.0: enum widened from ['run_analysis'] to four handlers so
    // Sonnet has correct routing options for analytical / explanatory
    // intents that previously misrouted as run_analysis proposals.
    expect(action.properties.handler_id.enum).toEqual([
      'run_analysis',
      'explain_from_structure',
      'explain_results',
      'what_would_flip',
    ]);
  });

  it('handler_id description guides Sonnet through each handler choice', () => {
    const action = OLUMI_ACTION_TOOL.input_schema.properties.action as {
      properties: { handler_id: { description: string } };
    };
    const desc = action.properties.handler_id.description;
    // Per-handler routing guidance — each must appear so Sonnet can
    // distinguish between them when picking a handler.
    expect(desc).toContain('run_analysis');
    expect(desc).toContain('explain_from_structure');
    expect(desc).toContain('explain_results');
    expect(desc).toContain('what_would_flip');
    // Key disambiguation cues that drive routing accuracy.
    expect(desc).toContain('pre-analysis');
    expect(desc).toContain('post-analysis');
    expect(desc).toContain('Requires a prior analysis run');
  });

  it('parser remains permissive on unknown handler_ids (validator handles it)', () => {
    // Sonnet could still emit a non-enum value despite the schema constraint;
    // the Zod parser must not reject it, because the TurnExecutor relies on
    // the validator path to return HANDLER_NOT_FOUND → 200 coaching.
    const unknownHandlerProposal = {
      intent_class: 'execute' as const,
      action: {
        handler_id: 'some_future_handler',
        entity: {
          id: 'scen-abc',
          kind: 'option' as const,
          resolution_status: 'resolved' as const,
          resolution_method: 'id_match' as const,
        },
        parameters: [],
        cited_context_fields: [],
      },
    };
    expect(() => parseToolCallResponse(unknownHandlerProposal)).not.toThrow();
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
