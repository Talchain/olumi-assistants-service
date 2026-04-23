/**
 * V5 Phase 1 — Tool-Use Schema.
 *
 * Declares the `olumi_action` tool that Sonnet may call. A tool call is a
 * routing proposal (intent_class + optional action OR clarification). A
 * text-only response is inferred as intent_class === 'converse'.
 *
 * The tool input schema is handed to the Anthropic SDK verbatim; the JSONSchema
 * there is descriptive, not enforcing. Authoritative validation happens in
 * parseToolCallResponse() via Zod, with conditional rules expressed as
 * refinements (execute requires action / forbids clarification, etc.).
 *
 * This module only defines the schema + parser. It does NOT call the LLM —
 * that is route-with-tool-use.ts (D5).
 */

import { z } from 'zod';

import {
  IntentClassSchema,
  CoachingModeSchema,
  ProposalActionSchema,
  ProposalClarificationSchema,
  type IntentClass,
  type ProposalAction,
  type ProposalClarification,
} from './types.js';

export const OLUMI_ACTION_TOOL_NAME = 'olumi_action' as const;

/**
 * Anthropic-SDK-shaped tool definition. Descriptive JSONSchema — the hard
 * contract is enforced by `parseToolCallResponse` via Zod.
 */
export const OLUMI_ACTION_TOOL = {
  name: OLUMI_ACTION_TOOL_NAME,
  description:
    'Route a user turn to one of four intents: execute (take an action), ' +
    'clarify (ask a question), converse (chat), coach (coaching turn). ' +
    'Call this tool when an action is needed or clarification is required; ' +
    'respond with text only for conversational/coaching turns.',
  input_schema: {
    type: 'object' as const,
    additionalProperties: false,
    properties: {
      intent_class: {
        type: 'string',
        enum: ['execute', 'clarify', 'converse', 'coach'],
        description: 'Top-level routing intent.',
      },
      coaching_mode: {
        type: 'string',
        enum: ['reframe', 'challenge', 'deepen', 'summarise'],
        description:
          'Coaching stance. Required when intent_class === "coach", omitted otherwise.',
      },
      action: {
        type: 'object',
        additionalProperties: false,
        description: 'Concrete action payload. Required when intent_class === "execute".',
        properties: {
          handler_id: { type: 'string' },
          entity: {
            type: 'object',
            additionalProperties: false,
            properties: {
              id: { type: 'string' },
              kind: {
                type: 'string',
                enum: ['node', 'edge', 'option', 'goal', 'constraint'],
              },
              label: { type: 'string' },
              resolution_status: {
                type: 'string',
                enum: ['resolved', 'ambiguous', 'unresolved'],
              },
              resolution_method: {
                type: 'string',
                enum: ['id_match', 'label_match', 'kind_inference', 'context_inference'],
              },
              candidates: {
                type: 'array',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  properties: { id: { type: 'string' }, label: { type: 'string' } },
                  required: ['id', 'label'],
                },
              },
            },
            required: ['id', 'kind', 'resolution_status', 'resolution_method'],
          },
          parameters: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string' },
                value: {},
                operator: {
                  type: 'string',
                  enum: ['set', 'increase', 'decrease', 'multiply'],
                },
                source: { type: 'string', enum: ['user_explicit', 'inferred', 'default'] },
                unit: { type: 'string' },
              },
              required: ['name', 'value', 'source'],
            },
          },
          cited_context_fields: { type: 'array', items: { type: 'string' } },
        },
        required: ['handler_id', 'entity'],
      },
      clarification: {
        type: 'object',
        additionalProperties: false,
        description: 'Clarification payload. Required when intent_class === "clarify".',
        properties: {
          ambiguity_type: {
            type: 'string',
            enum: ['entity', 'parameter', 'intent', 'scope', 'missing_context'],
          },
          question: { type: 'string' },
          candidates: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: { id: { type: 'string' }, label: { type: 'string' } },
              required: ['id', 'label'],
            },
          },
        },
        required: ['ambiguity_type', 'question'],
      },
    },
    required: ['intent_class'],
  },
} as const;

/**
 * Parsed tool call response — the authoritative typed shape downstream code
 * consumes. Conditional rules (execute ⇔ action, clarify ⇔ clarification)
 * are enforced by the Zod refinement below; once parsed, consumers can trust
 * the shape.
 */
export type ToolCallResponse =
  | {
      intent_class: 'execute';
      action: ProposalAction;
      coaching_mode?: undefined;
      clarification?: undefined;
    }
  | {
      intent_class: 'clarify';
      clarification: ProposalClarification;
      coaching_mode?: undefined;
      action?: undefined;
    }
  | {
      intent_class: 'converse';
      coaching_mode?: undefined;
      action?: undefined;
      clarification?: undefined;
    }
  | {
      intent_class: 'coach';
      coaching_mode?: z.infer<typeof CoachingModeSchema>;
      action?: undefined;
      clarification?: undefined;
    };

export class ToolCallParseError extends Error {
  readonly issues: readonly z.ZodIssue[];
  constructor(message: string, issues: readonly z.ZodIssue[]) {
    super(message);
    this.name = 'ToolCallParseError';
    this.issues = issues;
  }
}

const RawToolCallSchema = z
  .object({
    intent_class: IntentClassSchema,
    coaching_mode: CoachingModeSchema.optional(),
    action: ProposalActionSchema.optional(),
    clarification: ProposalClarificationSchema.optional(),
  })
  .strict()
  .superRefine((obj, ctx) => {
    const { intent_class, action, clarification, coaching_mode } = obj;
    if (intent_class === 'execute') {
      if (!action) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['action'],
          message: 'action is required when intent_class === "execute"',
        });
      }
      if (clarification) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clarification'],
          message: 'clarification is forbidden when intent_class === "execute"',
        });
      }
    }
    if (intent_class === 'clarify') {
      if (!clarification) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clarification'],
          message: 'clarification is required when intent_class === "clarify"',
        });
      }
      if (action) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['action'],
          message: 'action is forbidden when intent_class === "clarify"',
        });
      }
    }
    if (intent_class === 'converse') {
      if (action) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['action'],
          message: 'action is forbidden when intent_class === "converse"',
        });
      }
      if (clarification) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clarification'],
          message: 'clarification is forbidden when intent_class === "converse"',
        });
      }
      if (coaching_mode) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['coaching_mode'],
          message: 'coaching_mode is forbidden when intent_class === "converse"',
        });
      }
    }
    if (intent_class === 'coach') {
      if (action) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['action'],
          message: 'action is forbidden when intent_class === "coach"',
        });
      }
      if (clarification) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['clarification'],
          message: 'clarification is forbidden when intent_class === "coach"',
        });
      }
    }
  });

/**
 * Parse a raw tool_use block from Anthropic's response into a typed
 * ToolCallResponse. Throws ToolCallParseError on any schema violation.
 *
 * Execute + unresolved/ambiguous resolution_status is ACCEPTED by this
 * parser (does not throw): spec §6 says the validator downstream flags such
 * cases for clarification rather than rejecting the parse. This keeps the
 * parse stage focused on structural conformance.
 */
export function parseToolCallResponse(toolInput: unknown): ToolCallResponse {
  const parsed = RawToolCallSchema.safeParse(toolInput);
  if (!parsed.success) {
    throw new ToolCallParseError(
      `Tool call response failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      parsed.error.issues,
    );
  }
  const data = parsed.data;
  switch (data.intent_class) {
    case 'execute':
      return { intent_class: 'execute', action: data.action as ProposalAction };
    case 'clarify':
      return {
        intent_class: 'clarify',
        clarification: data.clarification as ProposalClarification,
      };
    case 'converse':
      return { intent_class: 'converse' };
    case 'coach':
      return { intent_class: 'coach', coaching_mode: data.coaching_mode };
  }
}

/**
 * All intent class values that the routing layer can produce. `text_only`
 * responses from Sonnet map to 'converse' in routing logs. Exported for the
 * log module and the TurnExecutor translation layer.
 */
export const ALL_INTENT_CLASSES: readonly IntentClass[] = [
  'execute',
  'clarify',
  'converse',
  'coach',
];
