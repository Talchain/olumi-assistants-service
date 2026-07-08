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
          // V5 Task 1.3: constrained to the registered-handler set. 0.9.0
          // adds three no-op routing handlers — explain_from_structure,
          // explain_results, what_would_flip — so Sonnet has correct tool
          // surfaces for analytical / explanatory user intents that
          // previously misrouted as run_analysis proposals targeting wrong
          // entity kinds (debug bundles bef4470b, 69d99ced from 28 April).
          // Other V5ActionType values (set_factor_value, add_constraint,
          // etc.) have no handler in V5 and would be rejected by the
          // validator. `draft_graph` and `edit_graph` are NOT in
          // V5ActionType — they are dispatched by the system layer before
          // routing and never reach this tool call. Parse-layer validation
          // against this enum prevents Sonnet from wasting turns proposing
          // unavailable actions.
          handler_id: {
            type: 'string',
            enum: [
              'run_analysis',
              'explain_from_structure',
              'explain_results',
              'what_would_flip',
              'set_factor_value',
              'add_constraint',
              'adjust_edge_strength',
            ],
            description:
              'The action to execute. Pick the handler that matches the user intent:\n' +
              '\n' +
              '• run_analysis — run the Monte Carlo analysis on the current scenario. ' +
              'Pick when the user asks to run, simulate, or evaluate the model. ' +
              'Mutates: produces analysis projection state. Do NOT include ' +
              'an `explanation` payload on this handler.\n' +
              '\n' +
              '• explain_from_structure — answer pre-analysis structural questions ' +
              'about factor influence, causal relationships, or model structure. ' +
              'Pick when the user asks "what factor most influences X?" or ' +
              '"why might option Y be the leading option?" and no analysis ' +
              'has been run yet. Answers from graph structure only. No mutation. ' +
              'You MUST populate `explanation.answer_text` with your complete ' +
              'structural explanation: cite the available specific factors by ' +
              'their graph labels, the available causal link strengths with ' +
              'numeric values, and any verified pathway from those factors to ' +
              'the goal label. Cite only what the graph actually shows — do ' +
              'not fabricate factors, links, or pathways to fill the response. ' +
              'Write a complete multi-sentence explanation that walks the user ' +
              'through the structural reasoning available in the graph. Use ' +
              '"causal link" or "direct link" — never "edge" or "node". Do not ' +
              'use mutation language (proposing, adding, updating).\n' +
              '\n' +
              '• explain_results — answer post-analysis explanation questions ' +
              '("why did X win?", "explain the analysis results"). Requires ' +
              'a prior analysis run; if none exists the handler will respond ' +
              'with a prompt to run analysis first. No mutation. You MUST ' +
              'populate `explanation.answer_text` with your complete analysis ' +
              'explanation: cite the leading option, probability, runner-up, ' +
              'margin, top drivers, and robustness from context. Do not use ' +
              'mutation language.\n' +
              '\n' +
              '• what_would_flip — answer sensitivity / robustness questions ' +
              '("what would change this outcome?", "how robust is this result?"). ' +
              'Requires a prior analysis run; if none exists the handler will ' +
              'respond with a prompt to run analysis first. No mutation. You ' +
              'MUST populate `explanation.answer_text` with your complete ' +
              'sensitivity explanation: cite margins, top drivers, robustness ' +
              'band, and what changes would alter the outcome. Do not use ' +
              'mutation language.\n' +
              '\n' +
              '• adjust_edge_strength — change the strength of a causal ' +
              'link between two nodes ("strengthen the link from churn to ' +
              'revenue", "weaken the budget→revenue effect"). The entity ' +
              'kind is "edge" and the entity id is the composite ' +
              '"source→target" (use the Unicode arrow → or the ASCII ' +
              'fallback ->). Pass `strength` as a number in [-1, 1]; the ' +
              'handler clamps the result to that range. "Strengthen" ' +
              'means increase |mean| while preserving sign; "weaken" ' +
              'means decrease |mean| toward zero. Translate the user\'s ' +
              'phrasing into the right operator + signed delta yourself ' +
              'before emitting the proposal. Do NOT include an ' +
              '`explanation` payload.\n' +
              '\n' +
              '• add_constraint — attach a threshold constraint to a factor, ' +
              'outcome, or goal ("budget can\'t exceed £50k", "keep churn ' +
              'below 5%", "quality must be at least 80%"). Mutates the ' +
              'graph deterministically. Pass `constraint_type` (at_least | ' +
              'at_most), `value` (in user units — e.g. 50000 for "£50k", ' +
              '5 for "5%"; the handler stores user units, not normalised ' +
              'model units). Optional `label` and `unit` parameters refine ' +
              'the persisted constraint. Idempotent on (target, operator): ' +
              'restating the same threshold updates the existing entry. Do ' +
              'NOT include an `explanation` payload.\n' +
              '\n' +
              '• set_factor_value — change a factor node\'s observed value ' +
              '("set churn to 5%", "increase budget by £10k", "double the ' +
              'team size"). Mutates the graph deterministically; the ' +
              'analysis becomes stale. The entity must be a factor (kind: ' +
              '"node" with the factor\'s id). Pass the value as a structured ' +
              'parameter `{ value: <number>, unit: "%" | "£" | …, cap?: ' +
              '<number> }` so the handler can normalise model units; for ' +
              'percentage factors capped at 100, "5%" must arrive as ' +
              '`{ value: 5, unit: "%", cap: 100 }`, NOT `0.05`. Use the ' +
              '`operator` field for relative changes (set / increase / ' +
              'decrease / multiply). Do NOT include an `explanation` ' +
              'payload on this handler.\n' +
              '\n' +
              'Graph structural changes (draft_graph, edit_graph) are ' +
              'dispatched by the system before routing and never reach this ' +
              'tool call.',
          },
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
                // `value` is open-typed in Zod (`z.unknown()`) because handler-
                // specific validation happens downstream in the validator.
                // Anthropic's strict custom-tool validator, however, rejects
                // an empty `{}` schema with `tools.0.custom: Empty schema
                // ({}) that accepts any JSON value is not supported`. The
                // `anyOf` below is the narrowest concrete non-empty schema
                // that covers today's registered handlers: primitives (for
                // simple set/increase parameters) or a structured wrapper
                // `{ value, unit?, cap? }` for handlers that need to carry
                // unit/cap alongside the numeric value. Future handlers
                // that emit arrays or other shapes must extend this union
                // explicitly so the contract is visible to Sonnet.
                //
                // V5 D1 golden-path closure (A3.1 Task 4): the previous
                // schema also advertised `raw_value` to Sonnet, but the
                // handler's `parseProposalValue` ignored it — dead
                // documentation that risked silent double-normalisation.
                // Dropped here so Sonnet is no longer encouraged to emit
                // it; the handler's StructuredValueSchema is now strict
                // and rejects the key explicitly.
                value: {
                  anyOf: [
                    { type: 'number' },
                    { type: 'string' },
                    { type: 'boolean' },
                    {
                      type: 'object',
                      additionalProperties: false,
                      properties: {
                        value: {
                          anyOf: [
                            { type: 'number' },
                            { type: 'string' },
                            { type: 'boolean' },
                          ],
                        },
                        unit: { type: 'string' },
                        cap: { type: 'number' },
                      },
                      required: ['value'],
                    },
                  ],
                },
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
          // Answer-carrying explanation payload. Required by the side-band
          // validator for explanation handlers (explain_from_structure,
          // explain_results, what_would_flip); silently ignored on
          // mutation/computation handlers (run_analysis). When omitted on an
          // explanation handler, the side-band check stamps
          // `answer_text_valid: false` and the handler composes a
          // deterministic fallback from the context pack — the user always
          // gets a useful response. evidence_used and cited_fields are
          // observability only (telemetry); never persisted.
          explanation: {
            type: 'object',
            additionalProperties: false,
            description:
              'For explanation handlers (explain_from_structure, explain_results, ' +
              'what_would_flip): your complete user-facing answer. Populate ' +
              'answer_text with the full answer; this is what the user reads. ' +
              'Do not use mutation language (proposing, adding, updating). For ' +
              'mutation handlers (run_analysis): omit this field.',
            properties: {
              answer_text: {
                type: 'string',
                description:
                  'The complete user-facing explanation. Sentence case, ' +
                  'British English, no bullet lists. Reference specific values, ' +
                  'factor labels, and causal links from the context.',
              },
              evidence_used: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Observability only: ContextPack field paths the answer ' +
                  'cites (e.g. "analysis.leading_option"). Never user-visible.',
              },
              cited_fields: {
                type: 'array',
                items: { type: 'string' },
                description:
                  'Observability only: specific labels or values referenced ' +
                  'in answer_text. Never user-visible.',
              },
            },
            required: ['answer_text'],
          },
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
      // ROADMAP 1.38 — coach-answer-body fix. The coach and converse
      // (tool-call) branches previously had NO body field: compose could
      // only ship the brief pre-tool-call leading text (a one-sentence
      // "orientation", never meant to be the whole answer), so the fuller
      // coaching/conversational answer Sonnet actually authored was
      // silently dropped (see TRUNCATION-BUG-HANDOVER.md). This optional
      // top-level field gives those two branches a real answer channel,
      // mirroring the `explanation.answer_text` pattern already used by
      // the execute-side explanation handlers. Optional so responses that
      // still put the answer in the leading text (today's shape) remain
      // valid — this is additive, not a breaking change to the contract.
      answer_text: {
        type: 'string',
        description:
          'Your complete user-facing answer. Populate this when ' +
          'intent_class is "coach" or "converse": write your FULL coaching ' +
          'or conversational answer here — every sentence you want the user ' +
          'to read, not a short lead-in. Do not rely on leading text before ' +
          'the tool call to carry the answer; leading text is treated as a ' +
          'brief pre-action orientation only and anything else you say ' +
          'there may not reach the user in full. Forbidden when ' +
          'intent_class is "execute" or "clarify" — those carry their ' +
          'answer via `action.explanation.answer_text` or ' +
          '`clarification.question` respectively.',
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
      answer_text?: undefined;
    }
  | {
      intent_class: 'clarify';
      clarification: ProposalClarification;
      coaching_mode?: undefined;
      action?: undefined;
      answer_text?: undefined;
    }
  | {
      intent_class: 'converse';
      coaching_mode?: undefined;
      action?: undefined;
      clarification?: undefined;
      // ROADMAP 1.38 — optional full-answer channel. See `answer_text`
      // description on the JSON schema above for the authoring contract.
      // Falls back to `orientationText` at compose time when absent.
      answer_text?: string;
    }
  | {
      intent_class: 'coach';
      coaching_mode?: z.infer<typeof CoachingModeSchema>;
      action?: undefined;
      clarification?: undefined;
      // ROADMAP 1.38 — optional full-answer channel. See `answer_text`
      // description on the JSON schema above for the authoring contract.
      // Falls back to `orientationText` at compose time when absent.
      answer_text?: string;
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
    // ROADMAP 1.38 — optional full-answer channel for coach / converse.
    // See the JSON schema `answer_text` description above.
    answer_text: z.string().optional(),
  })
  .strict()
  .superRefine((obj, ctx) => {
    const { intent_class, action, clarification, coaching_mode, answer_text } = obj;
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
      if (answer_text !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answer_text'],
          message:
            'answer_text is forbidden when intent_class === "execute" — use action.explanation.answer_text',
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
      if (answer_text !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answer_text'],
          message:
            'answer_text is forbidden when intent_class === "clarify" — use clarification.question',
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
      return { intent_class: 'converse', answer_text: data.answer_text };
    case 'coach':
      return {
        intent_class: 'coach',
        coaching_mode: data.coaching_mode,
        answer_text: data.answer_text,
      };
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
