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

import type { RunDelta } from '@talchain/schemas/boundary';
import {
  RunDeltaAttributionCase,
  RunDeltaLeaderDeltaSchema,
  RunDeltaPairProvenanceSchema,
  RunDeltaWinProbabilityDeltaSchema,
} from '@talchain/schemas/boundary';

import { RECENT_CHANGES_SUMMARY_MAX_CHARS } from './recent-changes.js';

import { QuantityExtractionResultSchema } from './cqe/schema-types.js';
import { GRAPH_CONTEXT_STATUSES } from './context-graph-snapshot.js';

/**
 * The single allowed value for `version`. Bumping this is a cross-team
 * coordination event per spec §10's "Contract freeze status" table — do
 * not change without an explicit version migration plan.
 */
export const CONTEXT_PACK_VERSION_LITERAL = '2.0' as const;

/**
 * Lane 28 — brief pipeline: size bound for the projected decision brief.
 *
 * The brief is the user's OWN text (no display-safety banding applies — it is
 * not model output), but it is prompt-budget-bounded here so a pathological
 * 8,000-char persisted brief (the `scenarios.brief_text` DB CHECK ceiling)
 * cannot claim an unbounded share of the ~30k-char routing prompt. Truncation
 * is DISCLOSED, never silent: the projection carries a `truncated` flag and
 * the `original_chars` count (see `projectBrief` in
 * `./context-pack-assembler.ts`), so downstream consumers — and the LLM —
 * can see that the text is bounded.
 *
 * Lives in this module (not the assembler) because the schema enforces the
 * bound and the assembler imports the schema — the reverse import would
 * cycle.
 */
export const CONTEXT_PACK_BRIEF_CHAR_CAP = 2000;

/**
 * Verbatim conversation memory window — the number of most-recent turns the
 * ContextPack carries in full (turns beyond it are folded into the rolling
 * summary). Raised 5 → 8 per the D-59-11 "S5 flip" (2026-07-24).
 *
 * SINGLE SOURCE OF TRUTH (FINAL-SWEEP, 2026-07-24; Codex quality F4). Previously
 * this literal was hand-typed in BOTH the assembler (CONTEXT_PACK_RECENT_TURNS_CAP)
 * and the policy (POLICY_VERBATIM_TURNS) with a "move both together" comment and a
 * conformance test pinning them equal — the exact hand-mirror trap-12 hazard. It
 * now lives in this cycle-safe leaf (both the assembler and the policy already
 * import from here) and both derive from it, so it CANNOT drift.
 */
export const CONTEXT_PACK_RECENT_TURNS_CAP = 8;

/**
 * Lane 28 — the projected decision brief carried on the ContextPack. Strict:
 * `text` is non-empty and hard-bounded at {@link CONTEXT_PACK_BRIEF_CHAR_CAP}
 * (the bound is enforced, not advisory); `truncated` + `original_chars`
 * disclose any truncation. Exported so brief-projection tests can validate
 * the shape without assembling a whole pack.
 */
export const ContextPackBriefSchema = z
  .object({
    text: z.string().min(1).max(CONTEXT_PACK_BRIEF_CHAR_CAP),
    truncated: z.boolean(),
    original_chars: z.number().int().positive(),
  })
  .strict();

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
    /**
     * Lane 30 — the option's goal-fit value (modelled probability the option
     * meets the user's target; PLoT #204 `probability_of_joint_goal`).
     * Optional: absent when the producer scored no goal fit for the option.
     */
    goal_fit_probability: z.number().min(0).max(1).optional(),
    /**
     * Lane 30 fix 3 — the option's modelled-outcome mean (raw float, banded
     * by the display formatter). Absent when the producer reported no
     * outcome distribution for the option.
     */
    outcome_mean: z.number().finite().optional(),
    /**
     * Trust-spine board #1 (CEE half) — literal `true` when this option is
     * the flagged constraint-infeasible winner
     * (CEE_CONSTRAINT_INFEASIBLE_GATE ON). ABSENT otherwise (never `false`),
     * matching the pack's key-absence style.
     */
    constraint_infeasible: z.literal(true).optional(),
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

/** Lane 21 — raw tipping-point entry (see ContextPackAnalysisFlipThreshold). */
const ContextPackAnalysisFlipThresholdSchema = z
  .object({
    factor_label: z.string(),
    current_value: z.number().finite().nullable(),
    flip_value: z.number().finite().nullable(),
    unit: z.string().nullable(),
    no_flip_within_bounds: z.boolean(),
    /**
     * ROADMAP 2.205 practical resolution (2026-07-31) — the display licence
     * (see `ContextPackAnalysisFlipThreshold`). Optional and ABSENT when
     * unlicensed, so an unlicensed pack is byte-identical to today's. Kept
     * `.strict()`-compatible deliberately: a stray display key on an entry
     * that never earned one must still fail the schema.
     */
    current_display: z.string().min(1).optional(),
    flip_display: z.string().min(1).optional(),
  })
  .strict();

/** Lane 21 — raw evidence-gap (VOI) entry. */
const ContextPackAnalysisEvidenceGapSchema = z
  .object({
    factor_label: z.string(),
    voi_score: z.number().finite().nonnegative(),
  })
  .strict();

/** Lane 21 — goal-fit scoring provenance (fact + basis, never values). */
const ContextPackAnalysisGoalFitSchema = z
  .object({
    scored: z.boolean(),
    basis: z.string().nullable(),
  })
  .strict();

/**
 * Strict on contract fields. Notably: `staleness_reason` is intentionally
 * NOT permitted here (state-trust removed it from the prompt-visible
 * projection — see `Docs/v5-state-trust-phase0.md`).
 *
 * Lane 21 (P0-A): `options` / `flip_thresholds` / `fragile_edge_count` /
 * `evidence_gaps` / `goal_fit` are optional in shape (the chip-click
 * dispatch hand-builds a narrow projection without them) but the routed
 * `projectAnalysis` path always emits them.
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
    options: z.array(ContextPackAnalysisOptionSchema).readonly().optional(),
    flip_thresholds: z
      .array(ContextPackAnalysisFlipThresholdSchema)
      .readonly()
      .optional(),
    fragile_edge_count: z.number().int().nonnegative().optional(),
    evidence_gaps: z
      .array(ContextPackAnalysisEvidenceGapSchema)
      .readonly()
      .optional(),
    // ROADMAP 2.54 (b) — literal `true` when the Lane 30 lever suppression
    // removed at least one evidence-gap entry; ABSENT otherwise (never
    // `false`), matching the pack's key-absence style (cf. conversation
    // `truncated`).
    evidence_gaps_lever_suppressed: z.literal(true).optional(),
    /**
     * The EVPPI channel's investigation-priority verdict
     * (`../coaching/investigation-priority.ts`). A discriminated union so a
     * malformed or unknown state fails the schema rather than reaching the
     * display projection as an unrecognised object.
     *
     * `'not_assessed'` is a legal member of the TYPE but is never attached by
     * the producer seam (it is already disclosed by `VOI_NOT_SCORED_NOTE`); it
     * is admitted here so the schema describes the type rather than the
     * producer's current habit — a schema narrower than its type is a trap
     * for the next writer.
     */
    investigation_priority: z
      .discriminatedUnion('kind', [
        z.object({ kind: z.literal('named'), factorLabel: z.string().min(1) }).strict(),
        z.object({ kind: z.literal('below_resolution') }).strict(),
        z.object({ kind: z.literal('incomplete') }).strict(),
        z.object({ kind: z.literal('not_assessed') }).strict(),
      ])
      .optional(),
    goal_fit: ContextPackAnalysisGoalFitSchema.nullable().optional(),
    /**
     * Lane 30 fix 3 — top-level ordinal confidence tier (attested values
     * 'strong' | 'fair' | 'needs_work'; kept as a string because the
     * enrichment passthrough is untyped). Null when the producer reported
     * none; optional so the chip-click narrow projection stays valid.
     */
    confidence_tier: z.string().nullable().optional(),
    /**
     * Trust-spine board #1 (CEE half) — the honest constraint note from
     * `compactAnalysis`, threaded verbatim. Absent when the gate is off or
     * the winner is feasible.
     */
    constraint_infeasible_note: z.string().optional(),
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
    // Context v2 (02 §Disclosure): literal `true` when a message on this
    // turn was hard-sliced at the persistence cap. ABSENT otherwise (never a
    // noisy `false`). Disclosure is unconditional, so the key appears
    // whenever a projected turn sits at the cap.
    truncated: z.literal(true).optional(),
  })
  .strict();

const ContextPackConversationSchema = z
  .object({
    recent_turns: z.array(ContextPackConversationTurnSchema).readonly(),
    turn_count: z.number().int().nonnegative(),
    last_tool_used: z.string().nullable(),
    pending_confirmation: z.boolean(),
    // Context v2 (02 §Disclosure fix 2): window disclosure — how many
    // prior turns are shown vs available, so the LLM knows history exists
    // beyond the window. Emitted unconditionally by projectConversation;
    // optional here so partial/legacy pack fixtures still validate.
    // `summarised` (#536 extension, O-2 activation): how many not-shown
    // turns arrive via `conversation_summary` instead of vanishing —
    // present IFF a summary section was injected (0 there is honest: a
    // floor / withheld block absorbs nothing).
    // `available` is the conversation's PRE-CAP length (the store's exact
    // count), NOT the length of the read window — it was the latter until
    // 2026-07-25, which made a 78-turn conversation report 20.
    // `notice` is the code-owned in-band disclosure emitted by
    // `projectConversation` whenever turns exist that the pack does not show;
    // it travels with the numbers it describes so it cannot drift from them.
    window: z
      .object({
        shown: z.number().int().nonnegative(),
        available: z.number().int().nonnegative(),
        summarised: z.number().int().nonnegative().optional(),
        notice: z.string().min(1).optional(),
      })
      .strict()
      .optional(),
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
    summary: z.string().max(RECENT_CHANGES_SUMMARY_MAX_CHARS),
    target_label: z.string().max(RECENT_CHANGES_SUMMARY_MAX_CHARS),
    transition: z.literal('node_label_changed').optional(),
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
 * Coaching Context Pack v1 (unconditional since 2026-07-20 — O-7 wave 2:
 * CEE_COACHING_CONTEXT_PROMPT_ENABLED deleted). The
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
    latest_run_attempt_refused: z.literal(true).optional(),
  })
  .strict();

/**
 * Context v2 S4-INJECT (ROADMAP 1.73; design pack 01 §2/§4): the rolling
 * conversation summary section. `.strict()` so no field can silently join
 * the prompt-facing block without review (same posture as
 * CoachingStatePackSchema). `note` is the in-band staleness disclosure —
 * present IFF `stale` (never silently stale, 01 §4). `stale` is lag-derived
 * (lag ≥ window depth) EXCEPT for a generator:'floor' summary, where the
 * injector forces it true regardless of lag — a floor absorbed no
 * conversation history, so lag-freshness is vacuous for it (1.73-pre b).
 * Doctrine P: `text` is summariser prose (no raw floats by the summariser's
 * own contract).
 *
 * NOTE: `conversation_summary` also names a V4 prompt-zones registry entry
 * (src/orchestrator/prompt-zones/*) — unrelated; this is the V5 pack path.
 */
const ContextPackConversationSummarySchema = z
  .object({
    text: z.string(),
    current_to_turn_id: z.string(),
    lag_turns: z.number().int().nonnegative(),
    stale: z.boolean(),
    note: z.string().optional(),
  })
  .strict();

/**
 * O-3 — context-size budget disclosure (`ContextPack.context_budget`).
 * One record per section the budget module trimmed at assembly. `.strict()`
 * so no field can silently join the prompt-facing marker without review
 * (same posture as CoachingStatePackSchema); `min(1)` because the assembler
 * OMITS the key entirely when nothing was trimmed — an empty marker would
 * be a disclosure that discloses nothing.
 */
const ContextBudgetTrimRecordSchema = z
  .object({
    section: z.enum(['graph', 'analysis']),
    original_chars: z.number().int().nonnegative(),
    kept_chars: z.number().int().nonnegative(),
  })
  .strict();

const ContextBudgetDisclosureSchema = z
  .object({
    truncations: z.array(ContextBudgetTrimRecordSchema).min(1).readonly(),
  })
  .strict();

/**
 * Selection-aware answering (hop 4) — the analysis outputs attached to a
 * selected element. DISPLAY STRINGS ONLY (percent strings, banded phrases),
 * copied from `display_analysis`. `.strict()` so a raw float cannot appear.
 */
const ContextPackFocusAnalysisSchema = z
  .object({
    win_probability: z.string().optional(),
    target_fit: z.string().optional(),
    influence: z.string().optional(),
    value_of_information: z.string().optional(),
    tipping_point_risk: z.string().optional(),
  })
  .strict();

const ContextPackFocusElementSchema = z
  .object({
    id: z.string(),
    kind: z.string(),
    label: z.string(),
    description: z.string().optional(),
    category: z.string().optional(),
    value: z.number().optional(),
    unit: z.string().optional(),
    display_value: z.string().optional(),
    value_source: z.string().optional(),
    /**
     * Closed enum. `ambiguous_label` is the FAIL-CLOSED state: the pack's
     * analysis projection is label-keyed, so an ambiguous label means the join
     * was refused rather than guessed (see `projectFocus`).
     */
    analysis_link: z.enum([
      'linked',
      'not_in_analysis',
      'ambiguous_label',
      'analysis_not_current',
      'analysis_withheld',
      'analysis_unavailable',
      'no_analysis',
    ]),
    analysis: ContextPackFocusAnalysisSchema.optional(),
  })
  .strict()
  .superRefine((element, ctx) => {
    if (
      element.analysis_link === 'analysis_unavailable' &&
      element.analysis !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['analysis'],
        message:
          'analysis_unavailable cannot carry analysis figures',
      });
    }
  });

/**
 * The focus section. `unresolved` is a CLOSED ENUM and never prose: the reason
 * an element is missing is a FACT, and `not_in_model` (the model does not
 * contain it) must never collapse into `could_not_check` (the model could not
 * be read) — that conflation is the defect `graph_read` exists to prevent.
 */
const ContextPackFocusSchema = z
  .object({
    elements: z.array(ContextPackFocusElementSchema).readonly(),
    unresolved: z.enum(['none', 'not_in_model', 'could_not_check']),
    requested_count: z.number().int().nonnegative(),
    unresolved_count: z.number().int().nonnegative(),
    /** Disclosed truncation — present ONLY when the element cap cut entries. */
    elements_omitted: z.number().int().positive().optional(),
  })
  .strict();

/**
 * The success-target record projected onto the pack.
 *
 * Mirrors `ContextPackGoalTarget` (context/goal-target-record.ts), derived
 * through the SINGLE authority `extractPersistedGoalTarget`
 * (compose/goal-target-receipt-guard.ts) — the same predicate the receipt guard
 * polices assistant claims against.
 *
 * ⚠ THE FIRST DRAFT OF THIS COMMENT CLAIMED THE TWO "CAN NEVER DISAGREE". THAT
 * WAS FALSE AND IS THE CORRECTION WORTH KEEPING. Sharing a predicate is not
 * sharing an input: the projector was reading the REQUEST-first graph while the
 * guard read `context.persistedGraph`, so a stale or forged client
 * `graph_state` could put `status: 'set'` in front of the model on a scenario
 * the guard would have called unbacked. They agree now because both are given
 * the persisted graph — an invariant maintained at the CALL SITE, not by the
 * shared function, and pinned by the divergent-arm test in
 * record-vs-transcript-boundary.route-level.test.ts.
 *
 * `.strict()` on both arms: a value plus its unit is the whole contract, and
 * nothing else from the goal node belongs in the prompt.
 */
/**
 * Mirrors `ContextPackFactorValueEntry` (context/factor-value-record.ts).
 *
 * ⚠ `has_value` and `provenance` are SEPARATE AXES and must stay separate: the
 * witnessed model carried factors that were BOTH valueless AND stamped as AI
 * estimates. `provenance` is AUTHORSHIP (`classifyValueSource`), which is a
 * weaker claim than a user-write receipt — see the record module's header.
 */
const ContextPackFactorValueEntrySchema = z
  .object({
    label: z.string().min(1),
    has_value: z.boolean(),
    provenance: z.enum(['user_stated', 'ai_drafted', 'system_repaired', 'unattributed']),
  })
  .strict();

/** Mirrors `ContextPackFactorValues` (context/factor-value-record.ts). */
export const ContextPackFactorValuesSchema = z
  .object({
    factors: z.array(ContextPackFactorValueEntrySchema).readonly(),
    /**
     * ZERO IS A POSITIVE CLAIM — `nonnegative()`, deliberately NOT `positive()`.
     * The sibling `items_omitted` markers omit their key at zero because a
     * marker disclosing nothing is noise; this is the opposite kind of field.
     * "Every factor has a value" is the answer to the user's question, and it
     * must be sayable.
     */
    without_value_count: z.number().int().nonnegative(),
    /** Disclosed truncation — present ONLY when the cap dropped factors. */
    factors_omitted: z.number().int().positive().optional(),
  })
  .strict();

/**
 * RUN-OVER-RUN CONSEQUENCE — the model-facing projection of the WIRE `RunDelta`
 * (`@talchain/schemas/boundary`), built by the SAME pure producer that stamps
 * the turn envelope (`coaching/build-run-delta.ts`).
 *
 * ⭐ DERIVED FROM THE WIRE SUB-SCHEMAS, NOT MIRRORED (trap 12). Every member
 * below is the contract's own schema object, so a change to the wire shape
 * propagates here instead of drifting. Only the top-level KEY LIST is written
 * out, and `.strict()` makes a new wire key fail LOUD in the non-prod
 * `safeParse` gate rather than ride silently into the prompt.
 * `tests/contract/run-delta-pack-parity.guard.test.ts` pins this key set against
 * the wire's, deriving BOTH sides at runtime so a new wire key REDs here.
 *
 * ⛔ `flip_thresholds` IS DELIBERATELY ABSENT, AND THAT IS NOT AN OVERSIGHT —
 * DO NOT "FIX" IT BY PASSING IT THROUGH. The producer emits it FROZEN EMPTY
 * (`RUN_DELTA_FLIP_THRESHOLDS_NOT_COMPUTED`, `compose/claim-safety-cage.ts`)
 * because the flip-threshold join is DEFERRED and it never looked. That
 * constant's own header states the rule: *"an empty array is NOT a neutral
 * placeholder: read naively it asserts THERE ARE NO FLIP THRESHOLDS, which is
 * a claim"*, and *"POPULATING this slot is a claim-safety change, not a wiring
 * change"*. An LLM is precisely a naive reader, so serialising `[]` into the
 * prompt would hand it a computed-looking answer to a question nothing asked.
 * Omitting the key is the honest projection: the field is not merely empty
 * here, it is ABSENT, and `RUN_DELTA_INSTRUCTION` tells the model in as many
 * words that it must not infer flip behaviour from that absence.
 * (Consumption of the constant is also pinned to exactly ONE call site by
 * `tests/contract/run-delta-flip-thresholds-single-site.guard.test.ts`, so this
 * module must never import it.)
 */
export const ContextPackRunDeltaSchema = z
  .object({
    attribution_case: RunDeltaAttributionCase,
    pair_provenance: RunDeltaPairProvenanceSchema,
    leader: RunDeltaLeaderDeltaSchema,
    /** May be empty (no options with a computable pair) — the wire's own semantics. */
    win_probabilities: z.array(RunDeltaWinProbabilityDeltaSchema),
    /**
     * The edit set between the two runs. `.min(1)` mirrors the wire: an empty
     * list is unrepresentable, so ABSENCE is the only way to say "underivable".
     */
    edit_list: z.array(z.string()).min(1).optional(),
  })
  .strict();

/**
 * The TypeScript face of {@link ContextPackRunDeltaSchema}, derived from the
 * WIRE type rather than from the Zod schema — deliberately a SECOND,
 * INDEPENDENT derivation of the same contract. The assembler assigns the
 * producer's own `RunDelta` (minus the omitted key) into this type, so if the
 * schema above and this type ever disagree about the shape, the assignment
 * stops compiling instead of drifting quietly.
 */
export type ContextPackRunDelta = Omit<RunDelta, 'flip_thresholds'>;

export const ContextPackGoalTargetSchema = z.discriminatedUnion('status', [
  z
    .object({
      status: z.literal('set'),
      value: z.number(),
      unit: z.string().optional(),
    })
    .strict(),
  z.object({ status: z.literal('unset') }).strict(),
]);

/**
 * One still-open readiness item. `kind` is the canonical low-cardinality
 * presentation tag from `summariseReadiness`; `description` is the recovery
 * authority's user-safe next step (the ROUTE, not just the fact of a
 * blocker). `.strict()` so no raw value/hash can join a prompt-facing item.
 */
const ContextPackReadinessOpenItemSchema = z
  .object({
    kind: z.enum([
      'too_few_options',
      'goal_node_missing',
      'option_needs_mapping',
      'option_needs_encoding',
      'goal_threshold_missing',
      'model_needs_review',
    ]),
    description: z.string().min(1),
    option_label: z.string().optional(),
  })
  .strict();

/**
 * The readiness verdict projected onto the pack. `status` is the canonical
 * `analysis_ready.status` VERBATIM.
 *
 * ⚠ `open_items` MAY BE EMPTY ON A NON-READY STATUS — the canonical projection
 * filters auto-repairable issues out. `status` is therefore carried alongside,
 * and `.min(1)` is deliberately NOT applied: an empty list is a legitimate,
 * honest state and must not be conflated with "may run".
 */
const ContextPackReadinessSchema = z
  .object({
    status: z.string().min(1),
    open_items: z.array(ContextPackReadinessOpenItemSchema).readonly(),
    /**
     * Disclosed truncation — present ONLY when the cap dropped DISTINCT items.
     * `positive()` because the projector OMITS the key at zero: a marker that
     * discloses nothing is noise (same posture as `focus.elements_omitted`).
     */
    items_omitted: z.number().int().positive().optional(),
  })
  .strict();

const ContextPackObjectSchema = z
  .object({
    version: z.literal(CONTEXT_PACK_VERSION_LITERAL),
    scenario_id: z.string().min(1),
    stage: z.string(),
    /**
     * Lane 28 — brief pipeline: the user's persisted decision brief
     * (`scenarios.brief_text`), size-bounded with disclosed truncation.
     * OMITTED (key absent) when no brief has been persisted for the
     * scenario (or the persisted value is whitespace-only) — the assembler
     * never emits `brief: null`, so a no-brief pack serialises no `brief`
     * field into the routing prompt. `.nullable()` is kept only for
     * tolerant validation of hand-built packs. This is the field that
     * closes dossier gap G2 — before it, the brief reached no LLM after
     * the draft turn.
     */
    brief: ContextPackBriefSchema.nullable().optional(),
    /**
     * Authority of the graph-derived reasoning snapshot. Optional only for
     * legacy hand-built packs; assembler/prompt omission resolves to the
     * weakest safe state (`unavailable`).
     */
    graph_context: z
      .object({
        status: z.enum(GRAPH_CONTEXT_STATUSES),
      })
      .strict()
      .optional(),
    /**
     * Exact marker for an unavailable persisted-analysis read. It is optional
     * because healthy absence and every established state carry no marker;
     * omission is never interpreted as permission or as proof of no analysis.
     */
    analysis_context: z
      .object({
        status: z.literal('unavailable'),
      })
      .strict()
      .optional(),
    graph: ContextPackGraphSchema,
    analysis: ContextPackAnalysisSchema.nullable(),
    display_analysis: DisplaySafeAnalysisSchema,
    display_graph: DisplaySafeGraphSchema,
    /**
     * READINESS: can this model be analysed, and if not, WHAT is open and what
     * is the route out. Present ONLY when the turn derived a canonical
     * `analysis_ready` payload (key absent otherwise — byte-identity for every
     * turn that derived none). Absence means UNKNOWN, never "unblocked".
     */
    readiness: ContextPackReadinessSchema.optional(),
    /**
     * SUCCESS TARGET: is one recorded on the model, and to what value.
     *
     * A DISCRIMINATED UNION on purpose. `unset` is a POSITIVE claim — the
     * graph was read and registers no target — and it is exactly the claim
     * that was previously unsayable: with no field at all, "no target is
     * recorded" and "the projection dropped it" were the same token, so a
     * model asked "is it set?" answered from the conversation transcript,
     * quoting a number the user had merely mentioned as persisted state.
     *
     * Present ONLY when a graph was read this turn (key absent otherwise).
     * ABSENCE MEANS UNKNOWN, NEVER "unset". `.strict()` so a raw threshold
     * cap or a fabricated provenance cannot ride along into the prompt.
     */
    goal_target: ContextPackGoalTargetSchema.optional(),
    /**
     * FACTOR VALUE STATE: which factors still have no value, and whose value is
     * on the ones that do. Mirrors `ContextPackFactorValues`
     * (context/factor-value-record.ts) — see that module for the witnessed
     * defect this closes.
     *
     * Present ONLY when a graph was read this turn (key absent otherwise).
     * ⚠ ABSENCE MEANS UNKNOWN, NEVER "nothing is missing". When a graph WAS
     * read and every factor carries a value the slice is PRESENT with
     * `without_value_count: 0` — a positive claim. Encoding "none missing" as
     * absence is precisely how the model came to say it could not see which
     * factors were unset while the Model tab named all three.
     *
     * `.strict()` so a raw coefficient or a fabricated provenance cannot ride
     * into the prompt alongside the label.
     */
    factor_values: ContextPackFactorValuesSchema.optional(),
    /**
     * RUN-OVER-RUN CONSEQUENCE: what changed between the two most recent
     * completed runs, and what the producer is ENTITLED to say about it.
     *
     * Present ONLY when the pure producer could honestly classify the pair
     * (`buildRunDelta` returns a discriminated REFUSAL otherwise, and a
     * refusal projects to NO KEY).
     *
     * ⛔ ABSENCE MEANS "NO ENTITLED COMPARISON", NEVER "NOTHING CHANGED".
     * The producer refuses on every pair it cannot classify, and the omit path
     * is the DEFAULT rather than a degraded state — a fabricated comparison is
     * worse than an absent one. `RUN_DELTA_INSTRUCTION` carries that rule to
     * the model, because a field the model reads as "nothing changed" would
     * convert an honest refusal into a confident falsehood.
     */
    run_delta: ContextPackRunDeltaSchema.optional(),
    /**
     * SELECTION-AWARE ANSWERING (hop 4): the user's canvas selection, resolved
     * against canonical state and projected display-safe by `projectFocus`.
     * Present ONLY when the turn carried a selection (key absent otherwise —
     * byte-identity for every turn that did not). `.strict()` on both levels so
     * a raw coefficient cannot silently join the section that reaches the
     * prompt.
     */
    focus: ContextPackFocusSchema.optional(),
    conversation: ContextPackConversationSchema,
    /**
     * Context v2 S4-INJECT (unconditional since the O-2 activation —
     * CEE_ROLLING_SUMMARY deleted): present ONLY when the conversation
     * extends beyond the verbatim window AND a stored summary exists (key
     * absent otherwise — byte-identity with pre-S4 packs).
     */
    conversation_summary: ContextPackConversationSummarySchema.optional(),
    /**
     * Knowledge-over-time (ROADMAP 1.199, P6): the pre-projected, bounded,
     * disclosed decision-records read slice. Present ONLY when the scenario has
     * prior decision records (key absent otherwise — byte-identity for
     * record-less scenarios). A plain string (the loader owns projection +
     * truncation disclosure).
     */
    older_relevant_facts: z.string().optional(),
    recent_changes: z.array(RecentMutationSchema).readonly(),
    /**
     * Scenario history authority for `recent_changes`. An empty array is an
     * authoritative no-changes claim only when this is `complete`.
     */
    recent_changes_status: z.enum(['complete', 'capped', 'degraded']),
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
     * Coaching Context Pack v1 (additive; unconditional since 2026-07-20 —
     * O-7 wave 2: CEE_COACHING_CONTEXT_PROMPT_ENABLED deleted). Present
     * whenever a freshness verdict was derived. Unlike `analysis_state` this
     * projection IS prompt-safe (hash-free), so it is the only
     * canonical-state surface allowed to reach the LLM.
     */
    coaching_context: CoachingStatePackSchema.optional(),
    /**
     * O-3 — context-size budget disclosure. Present ONLY when the budget
     * module trimmed the graph and/or analysis at assembly; the assembler
     * omits the key entirely otherwise (key-absence byte-identity).
     */
    context_budget: ContextBudgetDisclosureSchema.optional(),
  })
  // Allow additive fields without immediate schema bumps — tighten later
  // by switching to `.strict()` once the contract is fully fixed.
  .passthrough();

const ContextPackRefinedSchema = ContextPackObjectSchema.superRefine(
  (pack, ctx) => {
    const unavailable = pack.analysis_context?.status === 'unavailable';
    const unavailableFocus =
      pack.focus?.elements.some(
        (element) => element.analysis_link === 'analysis_unavailable',
      ) ?? false;

    if (unavailable && pack.display_analysis !== null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['display_analysis'],
        message:
          'unavailable analysis authority cannot carry display analysis',
      });
    }
    if (
      unavailable &&
      pack.focus?.elements.some(
        (element) => element.analysis_link !== 'analysis_unavailable',
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['focus', 'elements'],
        message:
          'unavailable analysis authority requires fail-weak focus links',
      });
    }
    if (!unavailable && unavailableFocus) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['focus', 'elements'],
        message:
          'analysis_unavailable focus requires the unavailable authority marker',
      });
    }
    if (
      unavailable &&
      (pack.coaching.decision_review !== null ||
        pack.coaching.last_coaching_signal !== null)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coaching'],
        message:
          'unavailable analysis authority cannot carry analysis-derived coaching',
      });
    }
  },
);

/**
 * The refined canonical contract plus its static field map. Zod 3 wraps a
 * refined object in `ZodEffects`, which otherwise hides `.shape`; exposing the
 * unchanged base map preserves the existing prompt-sanction and drift gates
 * without bypassing root validation in `parse`/`safeParse`.
 */
export const ContextPackSchema = Object.assign(ContextPackRefinedSchema, {
  shape: ContextPackObjectSchema.shape,
});

export type ContextPackSchemaType = z.infer<typeof ContextPackSchema>;
