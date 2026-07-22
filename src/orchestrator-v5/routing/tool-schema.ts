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

/**
 * The four valid `intent_class` enum members, DERIVED from the enforcing enum
 * (`IntentClassSchema`) so class (e)'s forced-intent default can never drift
 * from what the validator accepts (CLAUDE.md rule 12 — derive, don't mirror).
 * Used to distinguish a MISSING / INVALID-TYPE intent_class (coercible to
 * 'execute' on a forced pill) from a VALID-but-non-execute one (left for the
 * #628 assert-execute guard to reject).
 */
const VALID_INTENT_CLASSES: ReadonlySet<string> = new Set(IntentClassSchema.options);

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

/** The two forced-explanation handler ids a typed analytical pill can pin. */
export type ForcedPillHandlerId = 'explain_results' | 'what_would_flip';

/**
 * The served-tool shape with the two NARROWABLE enums widened to
 * `readonly string[]` (from the base advert's exact literal tuples) and the
 * one overridden `intent_class.description` widened to `string`. It is DERIVED
 * from `typeof OLUMI_ACTION_TOOL` (CLAUDE.md rule 12 — derive, don't mirror):
 * every field other than the three overridden ones keeps the base's exact
 * type, so this cannot drift from the advert. Both the base advert (exact
 * 4-tuple / 7-tuple enums) and the forced-pill single-value narrowing satisfy
 * it — a `['execute']` / `[handlerId]` enum is a `readonly string[]`, and is
 * incompatible with the exact tuple ONLY under literal-tuple invariance, not by
 * shape. This is the honest return type for `buildForcedPillTool`: it preserves
 * full compile-time structural checking of the constructed tool (no
 * `as unknown as` double-cast that would erase it).
 */
export type OlumiActionToolDefinition = Omit<typeof OLUMI_ACTION_TOOL, 'input_schema'> & {
  readonly input_schema: Omit<(typeof OLUMI_ACTION_TOOL)['input_schema'], 'properties'> & {
    readonly properties: Omit<
      (typeof OLUMI_ACTION_TOOL)['input_schema']['properties'],
      'intent_class' | 'action'
    > & {
      readonly intent_class: Omit<
        (typeof OLUMI_ACTION_TOOL)['input_schema']['properties']['intent_class'],
        'enum' | 'description'
      > & { readonly enum: readonly string[]; readonly description: string };
      readonly action: Omit<
        (typeof OLUMI_ACTION_TOOL)['input_schema']['properties']['action'],
        'properties'
      > & {
        readonly properties: Omit<
          (typeof OLUMI_ACTION_TOOL)['input_schema']['properties']['action']['properties'],
          'handler_id'
        > & {
          readonly handler_id: Omit<
            (typeof OLUMI_ACTION_TOOL)['input_schema']['properties']['action']['properties']['handler_id'],
            'enum'
          > & { readonly enum: readonly string[] };
        };
      };
    };
  };
};

/**
 * Forced-pill tool variant (Codex F3 — close the coach-bypass hole + shrink the
 * first-pass schema surface).
 *
 * THE FINDING: on a forced-explanation pill the caller advertises the generic
 * `olumi_action` tool and merely `tool_choice`-forces it, but that tool's schema
 * still offers all four intents (execute|clarify|converse|coach) and every
 * registered handler. So (1) a schema-valid coach/converse output PARSES and
 * then slips past `applyForcedExplanationHandler` (which only pins an *execute*
 * proposal) — the declared "guarantee" has a hole; and (2) the model must author
 * a full generic execute envelope for what is really "write the answer", the
 * structural root of the first-pass schema failures the repair-tax fix chases.
 *
 * This variant DYNAMICALLY CONSTRAINS the served tool for the forced call to a
 * single execute intent and a single handler enum. It is DERIVED from
 * `buildOlumiActionTool()` (spread) and overrides ONLY the two enums, so it can
 * never drift from the base advert (CLAUDE.md rule 12 — derive, don't mirror).
 * The tool NAME is unchanged (`OLUMI_ACTION_TOOL_NAME`) so the existing
 * `tool_choice: { type: 'tool', name }` force and the `toolUse.name` check in
 * route-with-tool-use both still match.
 *
 * The enforcing Zod validator (`RawToolCallSchema`) still structurally accepts
 * all four intents — narrowing the *descriptive* advert reduces the odds the
 * model emits a non-execute, but the load-bearing correctness guarantee is the
 * assert-execute-after-parse in route-with-tool-use (`enforceForcedExecute`),
 * which fails LOUD if the model somehow returns another intent regardless.
 */
export function buildForcedPillTool(
  forcedHandlerId: ForcedPillHandlerId,
): OlumiActionToolDefinition {
  const base = buildOlumiActionTool();
  const props = base.input_schema.properties;
  return {
    ...base,
    input_schema: {
      ...base.input_schema,
      properties: {
        ...props,
        intent_class: {
          ...props.intent_class,
          enum: ['execute'],
          description:
            'Top-level routing intent. FORCED to "execute" for this ' +
            'button-triggered analytical answer — emit an execute proposal only, ' +
            'with your complete answer in action.explanation.answer_text.',
        },
        action: {
          ...props.action,
          properties: {
            ...props.action.properties,
            handler_id: {
              ...props.action.properties.handler_id,
              enum: [forcedHandlerId],
            },
          },
        },
      },
    },
  };
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

const RawToolCallObject = z.object({
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
});

/**
 * The top-level keys the strict {@link RawToolCallSchema} accepts, DERIVED
 * from the object shape above (CLAUDE.md rule 12 — derive, don't mirror). A
 * 7th key added to `RawToolCallObject` is picked up here automatically, so
 * `coerceFirstPassToolCall`'s class-(d) stray-key strip can never fall out of
 * sync with what `.strict()` rejects (the hand-maintained-mirror defect class
 * this repair-tax hunt keeps finding).
 */
const ALLOWED_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set(
  Object.keys(RawToolCallObject.shape),
);

const RawToolCallSchema = RawToolCallObject
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
  | 'parameter_source_alias'
  // Class (d) — a stray unknown TOP-LEVEL key outside the six the strict
  // RawToolCallSchema accepts (root `unrecognized_keys`, the fourth,
  // attribution-proven class the forced explain pills trip). Carries the
  // stripped key NAME (structural, R-004-safe).
  | 'stray_top_level_key'
  // Class (e) — a MISSING / INVALID-TYPE intent_class on a FORCED pill turn,
  // defaulted to 'execute' (the #628 assert-execute guard still backstops
  // semantics). Fires only when the parse context is a forced pill.
  | 'missing_intent_class_forced';

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
  /**
   * For `stray_top_level_key` only: the NAME of the stripped top-level key —
   * a structural schema identifier (R-004-safe; never the value). Absent on
   * every other reason.
   */
  readonly key?: string;
}

/** Telemetry correlation context for the coercion drift-alarm event. */
export interface ParseTelemetryContext {
  readonly requestId: string;
  readonly sessionId: string | null;
  /** 1 = first routing call, 2 = REPAIR_ONCE retry. */
  readonly llmCall: 1 | 2;
  /**
   * Set to the pinned handler when this parse is a FORCED analytical-pill turn
   * (threaded from route-with-tool-use's `forcedExplanationHandlerId`). Enables
   * class (e): a MISSING / INVALID-TYPE intent_class is coerced to 'execute'.
   * Absent on every non-pill turn (the coercion behaves exactly as before).
   */
  readonly forcedHandlerId?: ForcedPillHandlerId;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Best-effort recovery of authored answer text from an ANSWER-LOOKING stray
 * top-level value (class (d) lift). Handles the three shapes the model plausibly
 * hoists to the top level instead of `action.explanation.answer_text`:
 *   - a plain non-blank string;
 *   - a hoisted `explanation`-like object `{ answer_text: "…" }`;
 *   - an `answer_shape`-shaped object (derived via deriveAnswerTextFromShape).
 * Returns undefined when the value carries no usable prose (so a non-answer
 * stray — a number, a diagnostic object — is dropped without a phantom lift).
 * Never throws; never mutates.
 */
function recoverStrayAnswerText(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (isPlainObject(value)) {
    if (typeof value.answer_text === 'string' && value.answer_text.trim().length > 0) {
      return value.answer_text.trim();
    }
    const parsedShape = AnswerShapeSchema.safeParse(value);
    if (parsedShape.success) {
      const derived = deriveAnswerTextFromShape(parsedShape.data);
      if (derived.trim().length > 0) return derived;
    }
  }
  return undefined;
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
 * byte-identical, unless class (e) below defaults a forced turn INTO execute):
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
 *   (d) any stray unknown TOP-LEVEL key outside the six the strict
 *       RawToolCallSchema accepts (root `unrecognized_keys` — the fourth,
 *       attribution-proven class the forced explain pills trip) is STRIPPED.
 *       An answer-looking stray value is LIFTED into `explanation.answer_text`
 *       first (same content-preserving rule as (a)); the stripped key NAME is
 *       carried on the coercion (structural, R-004-safe).
 *   (e) FORCED pills only (`opts.forced`): a MISSING / INVALID-TYPE
 *       `intent_class` is defaulted to 'execute' so the turn enters the
 *       execute-branch coercions above instead of paying a repair. A
 *       VALID-but-non-execute intent (coach/converse/clarify) is NOT rewritten
 *       — the #628 enforceForcedExecute assert rejects that (fail-loud →
 *       repair). The assert still backstops semantics after this default.
 *
 * A GENUINELY malformed execute action (e.g. missing `handler_id`, missing
 * `action`) is left untouched by everything above and still fails the strict
 * parse → REPAIR_ONCE path intact.
 */
export function coerceFirstPassToolCall(
  toolInput: unknown,
  opts?: { forced?: boolean },
): {
  value: unknown;
  coercions: FirstPassCoercion[];
} {
  if (!isPlainObject(toolInput)) {
    return { value: toolInput, coercions: [] };
  }

  // (e) forced-intent default. A missing / non-enum intent_class on a FORCED
  // pill is the 494e4a0b `invalid_type @ intent_class` first pass; default it
  // to 'execute' so the execute-branch coercions below run. Restricted to
  // missing / invalid-type — a valid non-execute is left for enforceForcedExecute.
  const rawIntent = toolInput.intent_class;
  const intentMissingOrInvalidType =
    typeof rawIntent !== 'string' || !VALID_INTENT_CLASSES.has(rawIntent);
  const forcedDefault = opts?.forced === true && intentMissingOrInvalidType;

  if (!forcedDefault && rawIntent !== 'execute') {
    // Non-execute and not a forced default: byte-identical passthrough — the
    // pre-fix contract for every coach/converse/clarify turn is unchanged.
    return { value: toolInput, coercions: [] };
  }

  const coercions: FirstPassCoercion[] = [];
  const out: Record<string, unknown> = { ...toolInput };
  if (forcedDefault) {
    out.intent_class = 'execute';
    coercions.push({ reason: 'missing_intent_class_forced' });
  }
  const action = isPlainObject(out.action) ? { ...out.action } : undefined;
  const isExplanationHandler =
    action !== undefined &&
    typeof action.handler_id === 'string' &&
    EXPLANATION_HANDLER_IDS.has(action.handler_id);

  const hasStrayShape = 'answer_shape' in out && out.answer_shape !== undefined;
  const strayTextPresent = 'answer_text' in out && out.answer_text !== undefined;
  const strayTextValue =
    typeof out.answer_text === 'string' ? out.answer_text : undefined;

  // (a) lift authored content into explanation.answer_text BEFORE stripping,
  // but only for explanation handlers (mutation handlers carry no user-facing
  // prose — the answer is the deterministic receipt).
  if (action && isExplanationHandler && (hasStrayShape || strayTextValue !== undefined)) {
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

  // (d) strip stray unknown TOP-LEVEL keys (the fourth class). Every key not in
  // the derived allowlist would trip the strict schema's root `unrecognized_keys`
  // → repair / exhaustion. answer_shape / answer_text are in the allowlist and
  // were already handled by (a); this catches everything else. An answer-looking
  // stray is lifted into the (still-empty) explanation slot before dropping, so
  // no authored prose is lost. Object.keys() is a snapshot, safe to delete during.
  for (const key of Object.keys(out)) {
    if (ALLOWED_TOP_LEVEL_KEYS.has(key)) continue;
    if (action && isExplanationHandler) {
      const existing =
        isPlainObject(action.explanation) &&
        typeof action.explanation.answer_text === 'string'
          ? action.explanation.answer_text
          : '';
      if (existing.trim().length === 0) {
        const recovered = recoverStrayAnswerText(out[key]);
        if (recovered) {
          action.explanation = {
            ...(isPlainObject(action.explanation) ? action.explanation : {}),
            answer_text: recovered,
          };
        }
      }
    }
    delete out[key];
    coercions.push({ reason: 'stray_top_level_key', key });
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
 * answer_shape/answer_text, unknown cited fields, "explicit" parameter source,
 * a stray unknown top-level key, and — on a FORCED pill — a missing/invalid
 * intent_class) validates on the FIRST pass instead of paying a ~4-5s
 * REPAIR_ONCE second LLM call. The forced-pill signal is threaded via
 * `telemetry.forcedHandlerId` (absent → non-forced → class (e) is inert). When
 * a `telemetry` context is supplied, every coercion emits a counted
 * `v5.routing.first_pass_coerced` drift-alarm event (reason-tagged, no user
 * text; `stray_top_level_key` also carries the stripped key NAME) — the
 * best-effort dropped-action path omits it to avoid double counting. Coercion
 * is deterministic and idempotent.
 */
export function parseToolCallResponse(
  toolInput: unknown,
  telemetry?: ParseTelemetryContext,
): ToolCallResponse {
  const { value, coercions } = coerceFirstPassToolCall(toolInput, {
    forced: telemetry?.forcedHandlerId !== undefined,
  });
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
        // Structural key NAME for the stray-top-level-key strip (R-004-safe —
        // never the value). Names the offending field in prod, closing the
        // R-004 log gap the static attribution had to route around.
        ...(coercion.key !== undefined ? { stray_key: coercion.key } : {}),
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
