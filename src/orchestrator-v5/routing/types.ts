// Canonical types from V5 Architecture Spec v2 §5. Must migrate to
// @talchain/schemas in next bump.
//
// QUARANTINE: These types are local pending @talchain/schemas bump. No other
// file in src/orchestrator-v5/ may define these types. Grep check in
// validate-handler-ownership.sh enforces this (D11).

import { z } from 'zod';

/**
 * Intent class — the four-way top-level routing decision from Sonnet.
 *
 *  - execute:  an action should be taken, handler dispatch required
 *  - clarify:  the ask is ambiguous, we need more information first
 *  - converse: conversational or informational turn, no action needed
 *  - coach:    decision-coaching mode — text response, distinct from converse
 *              for measurability against the GTX. Phase 1a has no coaching
 *              logic yet, but classification is preserved so Phase 2 can
 *              evaluate coaching-mode accuracy.
 */
export const IntentClassSchema = z.enum(['execute', 'clarify', 'converse', 'coach']);
export type IntentClass = z.infer<typeof IntentClassSchema>;

/**
 * Coaching mode — optional descriptor of the coaching stance Sonnet adopts
 * when intent_class === 'coach'. Open enum per spec §5 — additional modes
 * may be added in later briefs; the parser accepts any of these four.
 */
export const CoachingModeSchema = z.enum([
  'reframe',
  'challenge',
  'deepen',
  'summarise',
]);
export type CoachingMode = z.infer<typeof CoachingModeSchema>;

/**
 * Entity kind — the class of graph entity an action targets. Sonnet declares
 * which kind it intends; validator cross-checks against handler declarations.
 */
export const EntityKindSchema = z.enum(['node', 'edge', 'option', 'goal', 'constraint']);
export type EntityKind = z.infer<typeof EntityKindSchema>;

/**
 * Parameter operator — how a parameter value should be applied. Present on
 * execute actions that modify numeric values.
 */
export const ParameterOperatorSchema = z.enum(['set', 'increase', 'decrease', 'multiply']);
export type ParameterOperator = z.infer<typeof ParameterOperatorSchema>;

/**
 * Resolution status — how confidently Sonnet has identified the target
 * entity. `resolved` means Sonnet is sure; `ambiguous` means it surfaces
 * candidates; `unresolved` means it could not find anything.
 */
export const ResolutionStatusSchema = z.enum(['resolved', 'ambiguous', 'unresolved']);
export type ResolutionStatus = z.infer<typeof ResolutionStatusSchema>;

/**
 * Resolution method — how Sonnet arrived at the entity identifier.
 */
export const ResolutionMethodSchema = z.enum([
  'id_match',
  'label_match',
  'kind_inference',
  'context_inference',
]);
export type ResolutionMethod = z.infer<typeof ResolutionMethodSchema>;

/**
 * Ambiguity type — when clarify is chosen, which category of ambiguity.
 */
export const AmbiguityTypeSchema = z.enum([
  'entity',
  'parameter',
  'intent',
  'scope',
  'missing_context',
]);
export type AmbiguityType = z.infer<typeof AmbiguityTypeSchema>;

/**
 * Parameter source — where Sonnet sourced a numeric parameter. `user_explicit`
 * means the user said the number; `inferred` means Sonnet estimated it;
 * `default` means the handler's own default kicked in.
 */
export const ParameterSourceSchema = z.enum(['user_explicit', 'inferred', 'default']);
export type ParameterSource = z.infer<typeof ParameterSourceSchema>;

/**
 * Context pack field — valid field paths inside ContextPack that Sonnet may
 * cite in its proposal (e.g. to explain which field it used to resolve an
 * entity). String literals kept to the projected leaves — not arbitrary
 * dot-paths — because arbitrary paths are unverifiable downstream.
 */
export const ContextPackFieldSchema = z.enum([
  'graph.nodes',
  'graph.edges',
  'graph.options',
  'graph.goals',
  'graph.constraints',
  'analysis.leading_option',
  'analysis.runner_up',
  'analysis.robustness_band',
  'analysis.top_drivers',
  'analysis.fragile_edges',
  'analysis.status',
  'conversation.recent_turns',
  'conversation.last_tool_used',
  'conversation.pending_confirmation',
  'system_event',
  'stage',
]);
export type ContextPackField = z.infer<typeof ContextPackFieldSchema>;

/**
 * Proposal entity — the target of an execute action. Carries both the
 * identifier and the resolution evidence so the validator can sanity-check.
 */
export const ProposalEntitySchema = z.object({
  id: z.string().min(1),
  kind: EntityKindSchema,
  label: z.string().min(1).optional(),
  resolution_status: ResolutionStatusSchema,
  resolution_method: ResolutionMethodSchema,
  candidates: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
    .optional(),
});
export type ProposalEntity = z.infer<typeof ProposalEntitySchema>;

/**
 * Proposal parameter — a numeric or categorical parameter that modifies the
 * target entity. `value` is open-typed because different handlers accept
 * different shapes; handler-specific validation happens in the validator.
 */
export const ProposalParameterSchema = z.object({
  name: z.string().min(1),
  value: z.unknown(),
  operator: ParameterOperatorSchema.optional(),
  source: ParameterSourceSchema,
  unit: z.string().optional(),
});
export type ProposalParameter = z.infer<typeof ProposalParameterSchema>;

/**
 * Proposal explanation — answer-carrying payload for explanation handlers
 * (`explain_from_structure`, `explain_results`, `what_would_flip`). Sonnet
 * fills `answer_text` with the complete user-facing explanation; the
 * side-band validator (`validateExplanationAnswer`) decides whether to use
 * it or fall through to deterministic fallback. Optional everywhere on the
 * wire — when Sonnet omits it (bare tool_use), the side-band check stamps
 * `answer_text_valid: false` and the handler composes a fallback.
 *
 * `evidence_used` and `cited_fields` are observability-only: emitted as
 * telemetry on the routing turn, never persisted on the handler fact and
 * never surfaced to the user.
 */
export const ProposalExplanationSchema = z.object({
  answer_text: z.string(),
  evidence_used: z.array(z.string()).optional(),
  cited_fields: z.array(z.string()).optional(),
});
export type ProposalExplanation = z.infer<typeof ProposalExplanationSchema>;

/**
 * The set of handler ids that own answer-carrying explanation responses.
 * Drives: side-band answer-text validation, suppress-orientation default at
 * compose time, mutation-language guard's "is this an explanation turn?"
 * check. Mutation/computation handlers are NOT in this set; they tolerate a
 * stray `explanation` field by silently dropping it (telemetry only).
 */
export const EXPLANATION_HANDLER_IDS = new Set<string>([
  'explain_from_structure',
  'explain_results',
  'what_would_flip',
]);

/**
 * Action — the concrete payload of an execute proposal. Handler id is a free
 * string here; the validator cross-checks it against the registry. Keeping
 * it a free string avoids a circular import onto V5ActionType, which would
 * couple the canonical enum file to handler registry types.
 *
 * `explanation` is optional in the wire schema. The side-band validator
 * enforces presence + quality for explanation handlers; mutation/computation
 * handlers tolerate it as a stray field (silently ignored).
 */
export const ProposalActionSchema = z.object({
  handler_id: z.string().min(1),
  entity: ProposalEntitySchema,
  parameters: z.array(ProposalParameterSchema).default([]),
  cited_context_fields: z.array(ContextPackFieldSchema).default([]),
  explanation: ProposalExplanationSchema.optional(),
});
export type ProposalAction = z.infer<typeof ProposalActionSchema>;

/**
 * Clarification — the concrete payload of a clarify proposal. Surfaces the
 * ambiguity type and (optionally) candidate entities the user can choose
 * from.
 */
export const ProposalClarificationSchema = z.object({
  ambiguity_type: AmbiguityTypeSchema,
  question: z.string().min(1),
  candidates: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1) }))
    .optional(),
});
export type ProposalClarification = z.infer<typeof ProposalClarificationSchema>;
