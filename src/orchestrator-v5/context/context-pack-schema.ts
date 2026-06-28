/**
 * V5 ContextPack — canonical Zod schema.
 *
 * Single source of truth for the contract shape produced by
 * `assembleContextPack` (see `./context-pack-assembler.ts`). Used by tests
 * and any future replay/golden-journey harness that needs to validate a
 * pack independently of the assembler.
 *
 * Design notes:
 *   - The schema mirrors the load-bearing top-level contract: `version`,
 *     `scenario_id`, `stage`, `graph` shape, `analysis | null`, conversation,
 *     `recent_changes`, `coaching`, `compound_*`, `parsed_quantities`, and
 *     `system_event`. Required fields and array-vs-undefined semantics are
 *     enforced here so `parsed_quantities: []` never silently degrades to
 *     `undefined`.
 *   - Deeply structured payloads carried as opaque LLM-facing data — graph
 *     node/edge entries (F.6 passthrough), driver records, fragile-edge
 *     records, the coaching cache children, and the CQE result objects —
 *     use permissive shapes (`z.unknown()` / `z.record(z.unknown())`).
 *     The assembler's TypeScript interfaces remain authoritative for those
 *     internals; this schema's job is to guard the contract boundary, not
 *     to re-validate every nested invariant.
 *   - **Production hot path stays cost-free.** The assembler's non-prod
 *     runtime gate (see `assembleContextPackWithSummary` in
 *     `./context-pack-assembler.ts`) calls `ContextPackSchema.safeParse`
 *     only when `process.env.NODE_ENV !== 'production'`. Under prod the
 *     gate is dead code: a single env-var branch and no schema work.
 *     External callers (replay/golden-journey harness, ad-hoc validation)
 *     can still call `ContextPackSchema.safeParse` themselves.
 *
 * Spec & state-trust references:
 *   - Spec §10 (lines 390–467) of
 *     `Docs/v5/olumi-v5-architecture-design-specification-v3_2.md`.
 *   - State-trust supersedes part of §10 — see
 *     `Docs/v5-state-trust-phase0.md`. Notably:
 *       * `analysis.staleness_reason` is intentionally absent from the
 *         prompt-visible projection (lives on the wire as
 *         `analysis_ready.freshness` plus telemetry).
 *       * `conversation.pending_confirmation` is a `boolean` flag; the
 *         structured carriage lives off-pack on the wire
 *         (`pending_actions[]`, `proposed_actions[]`).
 */

import { z } from 'zod';

import { QuantityExtractionResultSchema } from './cqe/schema-types.js';

/**
 * The single allowed value for `version`. Bumping this is a cross-team
 * coordination event per spec §10's "Contract freeze status" table — do
 * not change without an explicit version migration plan.
 */
export const CONTEXT_PACK_VERSION_LITERAL = '2.0' as const;

const ContextPackGraphSchema = z
  .object({
    nodes: z.array(z.unknown()).readonly(),
    edges: z.array(z.unknown()).readonly(),
    options: z.array(z.unknown()).readonly(),
    goals: z.array(z.unknown()).readonly(),
    constraints: z.array(z.unknown()).readonly(),
    counts: z.object({
      nodes: z.number().int().nonnegative(),
      edges: z.number().int().nonnegative(),
      options: z.number().int().nonnegative(),
      goals: z.number().int().nonnegative(),
      constraints: z.number().int().nonnegative(),
    }),
  })
  .strict();

const ContextPackAnalysisOptionSchema = z
  .object({
    label: z.string(),
    probability: z.number().min(0).max(1),
  })
  .strict();

const ContextPackAnalysisDriverSchema = z
  .object({
    factor_label: z.string(),
    sensitivity_value: z.number().finite(),
  })
  .strict();

const ContextPackAnalysisFragileEdgeSchema = z
  .object({
    from_label: z.string(),
    to_label: z.string(),
  })
  .strict();

/**
 * Strict on contract fields. Notably: `staleness_reason` is intentionally
 * NOT permitted here (state-trust removed it from the prompt-visible
 * projection — see `Docs/v5-state-trust-phase0.md`).
 */
const ContextPackAnalysisSchema = z
  .object({
    status: z.string(),
    leading_option: ContextPackAnalysisOptionSchema.nullable(),
    runner_up: ContextPackAnalysisOptionSchema.nullable(),
    margin_pp: z.number().nullable(),
    robustness_band: z.string().nullable(),
    top_drivers: z.array(ContextPackAnalysisDriverSchema).readonly(),
    fragile_edges: z.array(ContextPackAnalysisFragileEdgeSchema).readonly(),
  })
  .strict();

const ContextPackConversationTurnSchema = z
  .object({
    turn_id: z.string(),
    turn_class: z.string(),
    handler_id: z.string().nullable(),
    created_at: z.string(),
    // V5 Conversation Context Reliability: the verbatim user message and final
    // public assistant answer for this prior turn, so the LLM can resolve
    // follow-ups ("Why?", "the second one"). Null when no content was persisted
    // (system-event turns, pre-migration rows).
    user_message: z.string().nullable(),
    assistant_message: z.string().nullable(),
  })
  .strict();

const ContextPackConversationSchema = z
  .object({
    recent_turns: z.array(ContextPackConversationTurnSchema).readonly(),
    turn_count: z.number().int().nonnegative(),
    last_tool_used: z.string().nullable(),
    pending_confirmation: z.boolean(),
  })
  .strict();

/**
 * RecentMutation shape — see `./recent-changes.ts`.
 *
 * Exported so the projection ↔ schema drift guard (see
 * `__tests__/recent-changes-edit-graph.test.ts`) can validate the
 * projector's output against the same schema the ContextPack uses,
 * without having to assemble a complete ContextPack probe.
 */
export const RecentMutationSchema = z
  .object({
    action: z.enum([
      'constraint_added',
      'factor_value_updated',
      'link_strength_updated',
      // V5 stale-aware explain recovery — DL-7 PR B added `'graph_edited'`
      // to `RecentChangeAction` in `recent-changes.ts` but the
      // ContextPack schema's enum was never updated to match. Result: a
      // successful edit_graph fact projected to `action: 'graph_edited'`
      // would fail ContextPack validation at orient, surface as
      // "ContextPack validation" in the unexpected-routing-error path,
      // and prevent the state-query guard from seeing the mutation on
      // the next turn — exactly the V5 Golden Journey dl7-edit-graph
      // failure. This entry brings the schema in line with what the
      // projection emits. Internal schema only; not on the wire.
      'graph_edited',
    ]),
    summary: z.string(),
    target_label: z.string(),
  })
  .strict();

/**
 * Coaching cache. Children are kept opaque — the cache is built from
 * heterogeneous prior-fact projections that have their own type contracts;
 * we only require that the three slots exist (or are explicitly null).
 */
const CoachingCacheSchema = z
  .object({
    draft_coaching: z.unknown().nullable(),
    decision_review: z.unknown().nullable(),
    last_coaching_signal: z.unknown().nullable(),
  })
  .strict();

/**
 * Display-safe analysis projection (LLM-facing). Strings only — no raw
 * floats. Schema is permissive on internal field shapes because the formatter
 * owns them; we only assert the slot is `null` or an object.
 */
const DisplaySafeAnalysisSchema = z.record(z.unknown()).nullable();

/**
 * Display-safe graph projection (LLM-facing). Same passthrough policy as
 * the raw graph contract — strict counts + array slots, opaque entries.
 */
const DisplaySafeGraphSchema = z.record(z.unknown());

/**
 * Redacted canonical analysis-state summary (additive observability).
 * Statuses / predicates / counts / hashes only — the same shape the
 * diagnostic context-summary wire surface carries. Strict so a new field
 * cannot silently appear in the prompt-facing pack without review.
 */
const AnalysisStateSummarySchema = z
  .object({
    status: z.string().nullable(),
    freshness: z.string(),
    freshness_reason: z.string(),
    usable_for_prose: z.boolean(),
    usable_for_chips: z.boolean(),
    usable_for_followup_context: z.boolean(),
    requires_rerun: z.boolean(),
    blocked_unusable: z.boolean(),
    blocker_count: z.number().int().nonnegative(),
    actionable_blocker_count: z.number().int().nonnegative(),
    selected_fact_index: z.number().int().nullable(),
    graph_hash_at_run: z.string().nullable(),
    current_graph_hash: z.string().nullable(),
    degraded_fact_status: z.string().nullable(),
    contradiction_codes: z.array(z.string()).readonly(),
    // Redacted option-identity guard verdict (CEE_OPTION_IDENTITY_FRESHNESS_GUARD).
    // Closed enums / booleans / counts only — no IDs, labels, hashes or values —
    // so it stays prompt-safe under the same redaction discipline as the rest of
    // this summary. Present only when the guard ran this turn (current option IDs
    // supplied + a selected fact); omitted otherwise. Mirrors
    // `OptionIdentitySummary` in `./canonical-analysis-state.ts`. Reviewed-safe
    // addition (the projection has carried this field since #306; this teaches the
    // strict validator about it so the default-ON guard does not trip the leak gate).
    option_identity: z
      .object({
        checked: z.boolean(),
        match: z.boolean(),
        reason: z.enum([
          'match',
          'leader_absent',
          'analysed_option_absent',
          'current_option_added',
          'indeterminate',
        ]),
        analysed_option_count: z.number().int().nonnegative(),
        current_option_count: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();

/**
 * Coaching Context Pack v1 (CEE_COACHING_CONTEXT_PROMPT_ENABLED). The
 * hash-free, prompt-safe projection of the canonical analysis state the LLM
 * may RECEIVE for coaching (never author). Strictly narrower than
 * `AnalysisStateSummarySchema`: closed enums / booleans / one count only — no
 * hashes, indices, `freshness_reason`, `degraded_fact_status`, or
 * contradiction codes. Mirrors `CoachingStatePack` in
 * `./canonical-analysis-state.ts`. `.strict()` so a hash/value/label field can
 * never silently appear in the prompt-facing pack without review.
 */
const CoachingStatePackSchema = z
  .object({
    analysis_present: z.boolean(),
    freshness: z.enum(['fresh', 'stale', 'unknown', 'none']),
    readiness_status: z
      .enum([
        'ready',
        'needs_user_mapping',
        'needs_encoding',
        'needs_user_input',
        'blocked',
      ])
      .nullable(),
    rerun_required: z.boolean(),
    usable_for_prose: z.boolean(),
    usable_for_chips: z.boolean(),
    blocked: z.boolean(),
    actionable_blocker_count: z.number().int().nonnegative(),
  })
  .strict();

export const ContextPackSchema = z
  .object({
    version: z.literal(CONTEXT_PACK_VERSION_LITERAL),
    scenario_id: z.string().min(1),
    stage: z.string(),
    graph: ContextPackGraphSchema,
    analysis: ContextPackAnalysisSchema.nullable(),
    display_analysis: DisplaySafeAnalysisSchema,
    display_graph: DisplaySafeGraphSchema,
    conversation: ContextPackConversationSchema,
    recent_changes: z.array(RecentMutationSchema).readonly(),
    coaching: CoachingCacheSchema,
    compound_detected: z.boolean(),
    /**
     * Present only when `compound_detected === true`. Optional in shape so
     * the schema accepts both branches the assembler emits.
     */
    compound_segments: z.array(z.string()).readonly().optional(),
    compound_pattern_matched: z.string().nullable(),
    /**
     * Empty-array semantics (NOT `undefined`) when no parseable quantities
     * are present — guards the contract the routing prompt's PARAMETERS
     * section depends on.
     */
    parsed_quantities: z.array(QuantityExtractionResultSchema).readonly(),
    system_event: z.unknown().nullable(),
    /**
     * Redacted canonical analysis state (additive observability). Null when
     * the assembler had no canonical source on this turn (e.g. the
     * compacted-graph path before M5 threads the authoritative verdict).
     */
    analysis_state: AnalysisStateSummarySchema.nullable(),
    /**
     * Coaching Context Pack v1 (additive, flag-gated by
     * CEE_COACHING_CONTEXT_PROMPT_ENABLED). Present ONLY when the behaviour
     * flag is on; absent otherwise (flag-off byte-identity). Unlike
     * `analysis_state` this projection IS prompt-safe (hash-free), so it is
     * the only canonical-state surface allowed to reach the LLM.
     */
    coaching_context: CoachingStatePackSchema.optional(),
  })
  // Allow additive fields without immediate schema bumps — tighten later
  // by switching to `.strict()` once the contract is fully fixed.
  .passthrough();

export type ContextPackSchemaType = z.infer<typeof ContextPackSchema>;
