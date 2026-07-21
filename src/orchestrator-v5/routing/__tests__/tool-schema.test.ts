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
import { deriveAnswerTextFromShape } from '../answer-shape.js';

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

// answer_shape is REQUIRED on coach/converse (ROADMAP 1.132, F2 —
// unconditional since the F1 flag deletion). answer_text is DERIVED from the
// shape at parse (single source of truth). The full shape contract lives in
// tool-schema-answer-shape-enforced.test.ts; these fixtures carry a valid
// shape so the shared coach/converse parse tests exercise the real contract.
const VALID_SHAPE = {
  headline: 'A complete answer in one sentence.',
  bullets: ['A supporting point.'],
  detail: 'The full supporting explanation carrying the rest of the answer.',
};

const VALID_CONVERSE_INPUT = {
  intent_class: 'converse' as const,
  answer_shape: VALID_SHAPE,
};

const VALID_COACH_INPUT = {
  intent_class: 'coach' as const,
  coaching_mode: 'challenge' as const,
  answer_shape: VALID_SHAPE,
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
      // V5 D1 deterministic mutation handlers.
      'set_factor_value',
      'add_constraint',
      'adjust_edge_strength',
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

  // ROADMAP 1.52 — goal-fit sign inversion. "reduce/decrease X by N%"
  // states a CHANGE, not a level; the naive positive "at_least +N%"
  // reading structurally inverts the claim whenever the constrained
  // node's own distribution is the signed delta (6B capture: displayed
  // ~0%, honest ~97-99%). This guidance must survive future edits.
  it('add_constraint guidance covers REDUCTION-FRAMED targets with the flipped encoding + clarify-on-ambiguity', () => {
    const action = OLUMI_ACTION_TOOL.input_schema.properties.action as {
      properties: { handler_id: { description: string } };
    };
    const desc = action.properties.handler_id.description;

    expect(desc).toContain('REDUCTION-FRAMED');
    // The worked example must use the real field shapes the handler
    // actually accepts (constraint_type: at_most, negative value) — not
    // an invented parameter name.
    expect(desc).toContain('"at_most"');
    expect(desc).toContain('value: -15');
    // Explicitly rules out the buggy reading.
    expect(desc).toMatch(/do not emit `at_least` with a positive value/i);
    // Ambiguous cases must route to clarify, never a silent guess.
    expect(desc).toMatch(/do not guess/i);
    expect(desc).toContain('"clarify"');
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
    const result = parseToolCallResponse({
      intent_class: 'coach',
      answer_shape: VALID_SHAPE,
    });
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
      parseToolCallResponse({
        intent_class: 'converse',
        answer_shape: VALID_SHAPE,
        coaching_mode: 'deepen',
      }),
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

// Answer-carrying explanation field — schema-level coverage. Side-band
// validator behaviour (answer_text quality, mutation-language detection,
// fallback) is tested in routing/__tests__/validator-explanation.test.ts.
describe('OLUMI_ACTION_TOOL.action.explanation field', () => {
  it('declares an optional explanation object on action with answer_text required', () => {
    const action = OLUMI_ACTION_TOOL.input_schema.properties.action as {
      properties: { explanation?: { type: string; required?: readonly string[]; properties?: Record<string, unknown> } };
      required: readonly string[];
    };
    expect(action.properties.explanation).toBeDefined();
    expect(action.properties.explanation?.type).toBe('object');
    expect(action.properties.explanation?.required).toEqual(['answer_text']);
    expect(action.properties.explanation?.properties).toHaveProperty('answer_text');
    expect(action.properties.explanation?.properties).toHaveProperty('evidence_used');
    expect(action.properties.explanation?.properties).toHaveProperty('cited_fields');
    // explanation is intentionally NOT in action.required: it is optional on
    // the wire so Sonnet can omit it (bare tool_use). The side-band validator
    // enforces presence per-handler; absent → deterministic fallback.
    expect(action.required).not.toContain('explanation');
  });

  it('parser accepts an execute proposal carrying an explanation payload', () => {
    const input = {
      ...VALID_EXECUTE_INPUT,
      action: {
        ...VALID_EXECUTE_INPUT.action,
        handler_id: 'explain_results',
        explanation: {
          answer_text: 'Engineering Capacity is the leading driver because it has the strongest causal footprint across your goal.',
          evidence_used: ['analysis.leading_option', 'analysis.top_drivers'],
          cited_fields: ['Engineering Capacity', 'Q3 Delivery Throughput'],
        },
      },
    };
    const result = parseToolCallResponse(input);
    expect(result.intent_class).toBe('execute');
    if (result.intent_class === 'execute') {
      expect(result.action.explanation?.answer_text).toContain('Engineering Capacity');
      expect(result.action.explanation?.evidence_used).toHaveLength(2);
      expect(result.action.explanation?.cited_fields).toHaveLength(2);
    }
  });

  it('parser accepts an execute proposal with NO explanation field (bare tool_use)', () => {
    // Reproduces the v40 staging failure shape: handler_id explanation
    // handler with no explanation payload. Parsing must succeed; the
    // side-band validator handles the missing-field case.
    const input = {
      ...VALID_EXECUTE_INPUT,
      action: { ...VALID_EXECUTE_INPUT.action, handler_id: 'explain_results' },
    };
    const result = parseToolCallResponse(input);
    expect(result.intent_class).toBe('execute');
    if (result.intent_class === 'execute') {
      expect(result.action.explanation).toBeUndefined();
    }
  });
});

// Top-level answer_text field — ROADMAP 1.38 coach-answer-body fix. The
// coach and converse tool-call variants previously had no body field at
// all, so compose could only ship Sonnet's brief pre-tool-call
// `orientationText` — the fuller authored answer was silently dropped
// (TRUNCATION-BUG-HANDOVER.md). This adds an OPTIONAL top-level
// `answer_text`, mirroring the existing `explanation.answer_text` pattern
// on the execute side. turn-executor.ts prefers it when present and falls
// back to orientationText when absent (see phase1-behavioural.test.ts for
// the end-to-end compose-level coverage).
describe('OLUMI_ACTION_TOOL top-level answer_text field (coach/converse)', () => {
  it('declares an optional top-level answer_text string on the JSON schema', () => {
    const props = OLUMI_ACTION_TOOL.input_schema.properties as {
      answer_text?: { type: string; description?: string };
    };
    expect(props.answer_text).toBeDefined();
    expect(props.answer_text?.type).toBe('string');
    // Not in the top-level `required` array — optional by construction so
    // old-shaped responses (answer in leading text) remain valid.
    expect(OLUMI_ACTION_TOOL.input_schema.required).not.toContain('answer_text');
  });

  it('parses a coach response: answer_text is DERIVED from the required shape (ROADMAP 1.132)', () => {
    const result = parseToolCallResponse({
      intent_class: 'coach',
      coaching_mode: 'deepen',
      answer_shape: VALID_SHAPE,
      // A model-authored answer_text is OVERRIDDEN by the shape derivation.
      answer_text: 'A rambling wall of prose that should not ship.',
    });
    expect(result.intent_class).toBe('coach');
    if (result.intent_class === 'coach') {
      expect(result.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
      expect(result.coaching_mode).toBe('deepen');
    }
  });

  it('rejects a coach response with NO answer_shape (shape required, unconditional — ROADMAP 1.132)', () => {
    const { answer_shape: _omitted, ...coachWithout } = VALID_COACH_INPUT;
    expect(() =>
      parseToolCallResponse({ ...coachWithout, answer_text: 'prose only' }),
    ).toThrow(/answer_shape is required/);
  });

  it('parses a converse response: answer_text is DERIVED from the required shape', () => {
    const result = parseToolCallResponse({
      intent_class: 'converse',
      answer_shape: VALID_SHAPE,
    });
    expect(result.intent_class).toBe('converse');
    if (result.intent_class === 'converse') {
      expect(result.answer_text).toBe(deriveAnswerTextFromShape(VALID_SHAPE));
    }
  });

  it('rejects a converse response with NO answer_shape (shape required, unconditional)', () => {
    const { answer_shape: _omitted, ...converseWithout } = VALID_CONVERSE_INPUT;
    expect(() =>
      parseToolCallResponse({ ...converseWithout, answer_text: 'prose only' }),
    ).toThrow(/answer_shape is required/);
  });

  it('rejects execute carrying answer_text (execute uses action.explanation.answer_text)', () => {
    expect(() =>
      parseToolCallResponse({ ...VALID_EXECUTE_INPUT, answer_text: 'stray body' }),
    ).toThrow(/answer_text is forbidden/);
  });

  it('rejects clarify carrying answer_text (clarify uses clarification.question)', () => {
    expect(() =>
      parseToolCallResponse({ ...VALID_CLARIFY_INPUT, answer_text: 'stray body' }),
    ).toThrow(/answer_text is forbidden/);
  });
});
