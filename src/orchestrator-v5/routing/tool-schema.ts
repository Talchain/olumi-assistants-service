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

import { TelemetryEvents, emit } from '../../utils/telemetry.js';

import {
  ANSWER_SHAPE_TOOL_PROPERTY,
  AnswerShapeSchema,
  deriveAnswerTextFromShape,
  type AnswerShape,
} from './answer-shape.js';
import {
  IntentClassSchema,
  CoachingModeSchema,
  ContextPackFieldSchema,
  EXPLANATION_HANDLER_IDS,
  ProposalActionSchema,
  ProposalClarificationSchema,
  type IntentClass,
  type ProposalAction,
  type ProposalClarification,
} from './types.js';

/**
 * The closed set of ContextPack field paths, DERIVED from the enforcing enum
 * (`ContextPackFieldSchema`) so the descriptive tool advert and the
 * first-pass filter can never drift from the validator (CLAUDE.md rule 12 —
 * derive, don't mirror; a hand-listed copy is the exact defect class that
 * caused this repair-tax). Both the `cited_context_fields` JSON-schema enum
 * advertised to the model and `coerceFirstPassToolCall`'s membership check
 * read from here.
 */
const CITED_CONTEXT_FIELD_VALUES: readonly string[] = ContextPackFieldSchema.options;
const CITED_CONTEXT_FIELD_SET: ReadonlySet<string> = new Set(CITED_CONTEXT_FIELD_VALUES);

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
              'REDUCTION-FRAMED targets ("reduce/decrease/cut/lower/shrink ' +
              'X BY N%") state a CHANGE amount, not an absolute level — X ' +
              'moves DOWN when the goal succeeds. Encode the change: ' +
              '`constraint_type: "at_most"` with a NEGATIVE `value` (e.g. ' +
              '"reduce cost by 15%" → `constraint_type: "at_most"`, ' +
              '`value: -15`, `unit: "%"`). Do NOT emit `at_least` with a ' +
              'positive value for this phrasing — that asserts the ' +
              'opposite of what the user asked for. Contrast with an ' +
              'absolute-level restatement using "TO"/"under"/"below" ' +
              '("reduce cost TO £40k", "keep cost under £40k" — a ' +
              'ceiling, not a change): those stay `constraint_type: ' +
              '"at_most"` with a POSITIVE `value` (£40000, no sign flip — ' +
              '"to"/"under" state a level, "by" states a change). If you ' +
              'cannot tell whether the user means a change amount or an ' +
              'absolute level, do not guess — emit `intent_class: ' +
              '"clarify"` instead of proposing add_constraint.\n' +
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
          // Descriptive advert ALIGNED to the enforcing enum (repair-tax fix,
          // 2026-07-22): previously `items: { type: 'string' }` accepted ANY
          // string, but the validator rejects anything outside the closed
          // 16-value `ContextPackFieldSchema` — so a model that cited e.g.
          // "analysis.margin"/"analysis.robustness" (paths the handler
          // descriptions mention) tripped a REPAIR_ONCE. The enum is DERIVED
          // from the validator (CITED_CONTEXT_FIELD_VALUES) so it cannot
          // drift. Observability-only: the field is never shown to the user,
          // and unknown entries are now filtered (not rejected) at parse time.
          cited_context_fields: {
            type: 'array',
            items: { type: 'string', enum: CITED_CONTEXT_FIELD_VALUES },
            description:
              'Observability only (never user-facing): the ContextPack field ' +
              'paths this action drew on. Choose ONLY from the closed enum ' +
              'above; if unsure, omit a field rather than inventing a path. ' +
              'Entries outside the enum are dropped, never surfaced.',
          },
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
 * Answer-shape enforcement (ROADMAP 1.132, F2) — the tool definition actually
 * served to the model.
 *
 * UNCONDITIONAL since the F1 flag deletion (no-dark-launches doctrine — the
 * `CEE_ANSWER_SHAPE_ENFORCED` gate is gone): always returns a copy of
 * `OLUMI_ACTION_TOOL` extended with the `answer_shape` property
 * (`ANSWER_SHAPE_TOOL_PROPERTY` — descriptive; the hard contract is
 * `AnswerShapeSchema` enforced in `RawToolCallSchema` below). Everything else
 * is structurally unchanged (pinned by
 * tool-schema-answer-shape-enforced.test.ts).
 */
export function buildOlumiActionTool(): typeof OLUMI_ACTION_TOOL {
  return {
    ...OLUMI_ACTION_TOOL,
    input_schema: {
      ...OLUMI_ACTION_TOOL.input_schema,
      properties: {
        ...OLUMI_ACTION_TOOL.input_schema.properties,
        answer_shape: ANSWER_SHAPE_TOOL_PROPERTY,
      },
    },
  } as typeof OLUMI_ACTION_TOOL;
}

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
      answer_shape?: undefined;
    }
  | {
      intent_class: 'clarify';
      clarification: ProposalClarification;
      coaching_mode?: undefined;
      action?: undefined;
      answer_text?: undefined;
      answer_shape?: undefined;
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
      // ROADMAP 1.132 (F2) — structured answer shape (UNCONDITIONAL since
      // the F1 flag deletion). Always present on a parsed coach/converse
      // proposal (guaranteed valid, with `answer_text` derived from it — see
      // parseToolCallResponse).
      answer_shape?: AnswerShape;
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
      // ROADMAP 1.132 (F2) — structured answer shape (UNCONDITIONAL since
      // the F1 flag deletion). Always present on a parsed coach/converse
      // proposal (guaranteed valid, with `answer_text` derived from it — see
      // parseToolCallResponse).
      answer_shape?: AnswerShape;
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
    // ROADMAP 1.132 (F2) — structured answer shape for coach / converse.
    // Declared `unknown` so the conditional rules below own ALL validation:
    // flag OFF preserves the pre-flag rejection (same failure class as the
    // `.strict()` unknown-key error this key would otherwise produce); flag
    // ON validates against AnswerShapeSchema with issues that flow through
    // the EXISTING REPAIR_ONCE mechanism.
    answer_shape: z.unknown().optional(),
  })
  .strict()
  .superRefine((obj, ctx) => {
    const { intent_class, action, clarification, coaching_mode, answer_text, answer_shape } =
      obj;
    // Answer-shape enforcement (ROADMAP 1.132, F2) — UNCONDITIONAL since the
    // F1 flag deletion (no-dark-launches doctrine; CEE_ANSWER_SHAPE_ENFORCED
    // is gone). coach/converse MUST carry a shape valid per AnswerShapeSchema
    // (headline exactly one sentence, ≤3 non-blank bullets, non-blank
    // detail); execute/clarify remain forbidden from carrying one. Every
    // violation is a plain Zod issue → the EXISTING REPAIR_ONCE retry in
    // route-with-tool-use.ts, then a typed schema_repair_failed — no new
    // retry plumbing (same design as the unconditional answer_text rule
    // below).
    let answerShapeValid = false;
    if (intent_class === 'execute' || intent_class === 'clarify') {
      if (answer_shape !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answer_shape'],
          message:
            intent_class === 'execute'
              ? 'answer_shape is forbidden when intent_class === "execute" — use action.explanation.answer_text'
              : 'answer_shape is forbidden when intent_class === "clarify" — use clarification.question',
        });
      }
    } else {
      // coach / converse with the flag ON: shape required + validated.
      if (answer_shape === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['answer_shape'],
          message:
            `answer_shape is required when intent_class === "${intent_class}" ` +
            '— populate headline (exactly one sentence), bullets (at most 3) ' +
            'and detail with your complete user-facing answer.',
        });
      } else {
        const parsedShape = AnswerShapeSchema.safeParse(answer_shape);
        if (!parsedShape.success) {
          for (const issue of parsedShape.error.issues) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ['answer_shape', ...issue.path],
              message: issue.message,
            });
          }
        } else {
          answerShapeValid = true;
        }
      }
    }
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
    // answer_text hardening, layer A / schema pressure — UNCONDITIONAL since
    // 2026-07-20 (O-7 wave 2: CEE_ANSWER_TEXT_REQUIRED deleted, live-true on
    // staging). A coach or converse tool call MUST carry a non-blank
    // top-level `answer_text`. This is a plain Zod validation failure like
    // every other rule in this refinement, so it flows through the EXISTING
    // REPAIR_ONCE mechanism in route-with-tool-use.ts unchanged — one
    // retry, with this issue's message surfaced to the model verbatim in
    // the repair's tool_result content, then a typed schema_repair_failed
    // error if the retry also omits it. execute/clarify are untouched
    // (they forbid answer_text outright above).
    // ROADMAP 1.132 interaction: coach/converse always carry a VALID shape
    // (enforced above), and parseToolCallResponse derives answer_text from it
    // — the requirement below is satisfied by construction (derived text is
    // non-blank), so a shape-only tool call must not repair-loop on a
    // missing answer_text.
    if (
      (intent_class === 'coach' || intent_class === 'converse') &&
      !answerShapeValid &&
      !answer_text?.trim()
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['answer_text'],
        message:
          `answer_text is required when intent_class === "${intent_class}" ` +
          '— populate it with your complete user-facing answer, not just ' +
          'a brief lead-in.',
      });
    }
  });

// -----------------------------------------------------------------------
// First-pass coercion (repair-tax fix, 2026-07-22)
// -----------------------------------------------------------------------

/**
 * The reason tags for a {@link FirstPassCoercion}. Each corresponds to one of
 * the three prompt/descriptive-schema/validator divergences a forced-pill
 * (execute-branch) turn was tripping — the ones the REPAIR_ONCE second LLM
 * call only ever STRIPPED or FIXED, at a ~4-5s cost. Coercing on the first
 * pass instead of rejecting removes that repair tax.
 *
 * See REPAIR-TAX-ROOT-CAUSE-2026-07-22.md.
 */
export type FirstPassCoercionReason =
  | 'stray_answer_shape'
  | 'stray_answer_text'
  | 'unknown_cited_field'
  | 'parameter_source_alias';

/**
 * A single coercion applied to a routing tool call before the strict Zod
 * parse. `count` is present only for coercions that can cover more than one
 * entry (unknown cited-fields filtered / parameter sources re-aliased). NO
 * user text is ever carried here — the reason tag + count are the whole
 * payload (R-004 redaction discipline).
 */
export interface FirstPassCoercion {
  readonly reason: FirstPassCoercionReason;
  readonly count?: number;
}

/** Telemetry correlation context for the coercion drift-alarm event. */
export interface ParseTelemetryContext {
  readonly requestId: string;
  readonly sessionId: string | null;
  /** 1 = first routing call, 2 = REPAIR_ONCE retry. */
  readonly llmCall: 1 | 2;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Make a routing tool call FIRST-PASS VALID by coercing (never rejecting) the
 * three execute-branch divergences the served prompt v118 + descriptive tool
 * schema instruct but the enforcing validator forbids. Pure: returns a NEW
 * value (the caller's `toolInput` is never mutated) plus the list of coercions
 * applied. Emitting the drift-alarm telemetry is the caller's job
 * (`parseToolCallResponse`) — this stays side-effect-free so it is trivially
 * unit-testable and safe to run on the best-effort dropped-action path.
 *
 * Coercions (execute branch only — every non-execute turn is returned
 * byte-identical):
 *   (a) a stray top-level `answer_shape`/`answer_text` (forbidden on execute)
 *       is STRIPPED. If the handler is an explanation handler and its
 *       `explanation.answer_text` is empty, the stray answer is LIFTED in
 *       first (top-level `answer_text` string, else derived from a VALID stray
 *       `answer_shape`) so no authored content is lost — mirrors the
 *       applyForcedExplanationHandler orientation-lift.
 *   (b) `cited_context_fields` entries outside the closed enum are FILTERED
 *       (observability-only, never user-facing — must not cost a repair).
 *   (c) a parameter `source: "explicit"` is normalised to `"user_explicit"`
 *       (the prompt says "explicit", the enum says "user_explicit").
 *
 * A GENUINELY malformed execute action (e.g. missing `handler_id`, missing
 * `action`) is left untouched by everything above and still fails the strict
 * parse → REPAIR_ONCE path intact.
 */
export function coerceFirstPassToolCall(toolInput: unknown): {
  value: unknown;
  coercions: FirstPassCoercion[];
} {
  if (!isPlainObject(toolInput) || toolInput.intent_class !== 'execute') {
    return { value: toolInput, coercions: [] };
  }

  const coercions: FirstPassCoercion[] = [];
  const out: Record<string, unknown> = { ...toolInput };
  const action = isPlainObject(out.action) ? { ...out.action } : undefined;

  const hasStrayShape = 'answer_shape' in out && out.answer_shape !== undefined;
  const strayTextPresent = 'answer_text' in out && out.answer_text !== undefined;
  const strayTextValue =
    typeof out.answer_text === 'string' ? out.answer_text : undefined;

  // (a) lift authored content into explanation.answer_text BEFORE stripping,
  // but only for explanation handlers (mutation handlers carry no user-facing
  // prose — the answer is the deterministic receipt).
  if (action && (hasStrayShape || strayTextValue !== undefined)) {
    const isExplanationHandler =
      typeof action.handler_id === 'string' &&
      EXPLANATION_HANDLER_IDS.has(action.handler_id);
    if (isExplanationHandler) {
      const explanation = isPlainObject(action.explanation)
        ? { ...action.explanation }
        : undefined;
      const existingText =
        explanation && typeof explanation.answer_text === 'string'
          ? explanation.answer_text
          : undefined;
      if (!existingText || existingText.trim().length === 0) {
        let recovered: string | undefined;
        if (strayTextValue && strayTextValue.trim().length > 0) {
          recovered = strayTextValue.trim();
        } else if (hasStrayShape) {
          const parsedShape = AnswerShapeSchema.safeParse(out.answer_shape);
          if (parsedShape.success) {
            recovered = deriveAnswerTextFromShape(parsedShape.data);
          }
        }
        if (recovered && recovered.length > 0) {
          action.explanation = { ...(explanation ?? {}), answer_text: recovered };
        }
      }
    }
  }

  // (a) strip the stray top-level fields (forbidden on execute regardless of
  // content). A distinct reason per field keeps the drift alarm precise.
  if (hasStrayShape) {
    delete out.answer_shape;
    coercions.push({ reason: 'stray_answer_shape' });
  }
  if (strayTextPresent) {
    delete out.answer_text;
    coercions.push({ reason: 'stray_answer_text' });
  }

  if (action) {
    // (b) filter unknown cited_context_fields entries (closed enum, derived
    // from the validator).
    if (Array.isArray(action.cited_context_fields)) {
      const original = action.cited_context_fields as unknown[];
      const filtered = original.filter(
        (entry): entry is string =>
          typeof entry === 'string' && CITED_CONTEXT_FIELD_SET.has(entry),
      );
      if (filtered.length !== original.length) {
        action.cited_context_fields = filtered;
        coercions.push({
          reason: 'unknown_cited_field',
          count: original.length - filtered.length,
        });
      }
    }

    // (c) normalise the parameter_source alias "explicit" → "user_explicit".
    if (Array.isArray(action.parameters)) {
      let aliased = 0;
      const params = (action.parameters as unknown[]).map((param) => {
        if (isPlainObject(param) && param.source === 'explicit') {
          aliased += 1;
          return { ...param, source: 'user_explicit' };
        }
        return param;
      });
      if (aliased > 0) {
        action.parameters = params;
        coercions.push({ reason: 'parameter_source_alias', count: aliased });
      }
    }

    out.action = action;
  }

  return { value: out, coercions };
}

/**
 * Parse a raw tool_use block from Anthropic's response into a typed
 * ToolCallResponse. Throws ToolCallParseError on any schema violation.
 *
 * Execute + unresolved/ambiguous resolution_status is ACCEPTED by this
 * parser (does not throw): spec §6 says the validator downstream flags such
 * cases for clarification rather than rejecting the parse. This keeps the
 * parse stage focused on structural conformance.
 *
 * Repair-tax fix (2026-07-22): the input is first passed through
 * {@link coerceFirstPassToolCall} so a coercible execute-branch shape (stray
 * answer_shape/answer_text, unknown cited fields, "explicit" parameter source)
 * validates on the FIRST pass instead of paying a ~4-5s REPAIR_ONCE second LLM
 * call. When a `telemetry` context is supplied, every coercion emits a counted
 * `v5.routing.first_pass_coerced` drift-alarm event (reason-tagged, no user
 * text) — the best-effort dropped-action path omits it to avoid double
 * counting. Coercion is deterministic and idempotent.
 */
export function parseToolCallResponse(
  toolInput: unknown,
  telemetry?: ParseTelemetryContext,
): ToolCallResponse {
  const { value, coercions } = coerceFirstPassToolCall(toolInput);
  if (telemetry) {
    for (const coercion of coercions) {
      emit(TelemetryEvents.V5RoutingFirstPassCoerced, {
        request_id: telemetry.requestId,
        turn_id: telemetry.requestId,
        v5_journey_id: telemetry.sessionId,
        scenario_id: telemetry.sessionId,
        llm_call: telemetry.llmCall,
        reason: coercion.reason,
        ...(coercion.count !== undefined ? { dropped_count: coercion.count } : {}),
      });
    }
  }
  const parsed = RawToolCallSchema.safeParse(value);
  if (!parsed.success) {
    throw new ToolCallParseError(
      `Tool call response failed schema validation: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      parsed.error.issues,
    );
  }
  const data = parsed.data;
  // ROADMAP 1.132 (F2): the refinement above guarantees coach/converse carry
  // a VALID shape (UNCONDITIONAL since the F1 flag deletion), so this
  // re-parse cannot throw; it exists purely to narrow `unknown` →
  // `AnswerShape`. The shape is the single source of truth: `answer_text` is
  // DERIVED from it (deterministically — headline / • bullets / detail),
  // overriding any model-authored answer_text, so legacy consumers keep a
  // populated answer_text while the user-facing text stops being a wall of
  // prose.
  const shape: AnswerShape | undefined =
    (data.intent_class === 'coach' || data.intent_class === 'converse') &&
    data.answer_shape !== undefined
      ? AnswerShapeSchema.parse(data.answer_shape)
      : undefined;
  switch (data.intent_class) {
    case 'execute':
      return { intent_class: 'execute', action: data.action as ProposalAction };
    case 'clarify':
      return {
        intent_class: 'clarify',
        clarification: data.clarification as ProposalClarification,
      };
    case 'converse':
      return {
        intent_class: 'converse',
        answer_text: shape ? deriveAnswerTextFromShape(shape) : data.answer_text,
        ...(shape ? { answer_shape: shape } : {}),
      };
    case 'coach':
      return {
        intent_class: 'coach',
        coaching_mode: data.coaching_mode,
        answer_text: shape ? deriveAnswerTextFromShape(shape) : data.answer_text,
        ...(shape ? { answer_shape: shape } : {}),
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
