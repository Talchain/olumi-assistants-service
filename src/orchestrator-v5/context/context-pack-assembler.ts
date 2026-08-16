/**
 * V5 Phase 1 — Context Pack Assembler.
 *
 * Projects the LLM-facing ContextPack (spec §10, version "2.0") from:
 *   - the boundary turn payload (stage, message, scenario_id)
 *   - prior conversation turns (from SessionStore.readRecent, already loaded
 *     into EnrichedTurnContext)
 *   - optional graph state (projected passthrough; F.6 — no semantic transforms)
 *   - optional analysis summary (uses existing V4 AnalysisResponseSummary shape
 *     so we do not duplicate the compacting logic)
 *   - optional system event (passthrough)
 *
 * Deliberately separate from `build-turn-context.ts`: TurnContext is the
 * wire-level internal state shape; ContextPack is the LLM-facing projection.
 * Two different concerns, two different files.
 *
 * This module does NOT:
 *   - call any LLM (routing lives in route-with-tool-use.ts)
 *   - mutate graph or session state
 *   - reach into handler internals
 *   - import from UI
 *   - run coaching logic (null for Phase 1a)
 *   - perform compound-intent detection (false for Phase 1a; detector lands
 *     in Phase 1b D9 if time permits)
 */

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { SessionTurnWithContent } from '../session/conversation-content.js';
import type { QuantityExtractionResult } from './cqe/schema-types.js';

import type {
  DriverSummary,
  FlipThreshold,
  OptionSummary,
} from '../../orchestrator/context/analysis-compact.js';
import type { GraphV3Compact } from '../../orchestrator/context/graph-compact.js';
import { toSignedInfluenceValue } from '../../orchestrator/context/influence-direction.js';
import { log } from '../../utils/telemetry.js';
import { sha8 } from '../../utils/logger-config.js';
import {
  applyContextBudgetToAssemblyInputs,
  type ContextBudgetDisclosure,
} from './context-budget-enforcement.js';
import { emitContextTruncation } from './context-budget-telemetry.js';
import {
  CONTEXT_PACK_CEILING_CUT_ORDER,
  CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS,
  CONTEXT_POLICY,
  type ContextPackCeilingCutSection,
} from './context-policy.js';
import { partitionInterventionControlledDrivers } from './intervention-controlled-drivers.js';
import { isRecommendableTypedOption } from '../tools/handlers/recommendable-option.js';
import { EMPTY_COACHING_CACHE, type CoachingCache } from '../coaching/types.js';
import type { ContextPackConversationSummary } from '../rolling-summary/inject.js';
// Selection-aware answering (hop 4). TYPE-ONLY on purpose: the resolved
// selection is produced by `buildTurnContext` and this module only PLACES it,
// so there is no runtime edge from the assembler back to the context builder.
import type { TurnSelection } from '../build-turn-context.js';
import {
  formatAnalysisForContext,
  type DisplaySafeAnalysis,
} from '../format/format-analysis-for-context.js';
import type {
  AnalysisResponseSummaryWithSignals,
  OptionGoalFitSignal,
  OptionOutcomeSignal,
  TippingPointSignal,
} from './analysis-signals.js';
import {
  formatGraphForContext,
  type DisplaySafeGraph,
} from '../format/format-graph-for-context.js';
import { detectCompound } from '../routing/compound-detector.js';
import {
  runExtraction,
  type CqeExtractionSummary,
} from './cqe/extract-quantities.js';
import { config, isProduction, isTest } from '../../config/index.js';
import {
  CONTEXT_PACK_BRIEF_CHAR_CAP,
  CONTEXT_PACK_RECENT_TURNS_CAP,
  ContextPackSchema,
} from './context-pack-schema.js';
import { projectRecentChanges, type RecentMutation } from './recent-changes.js';
import { computeAnalysisAffectingGraphHash } from './graph-hash.js';
import { extractGraphOptionIds } from './option-identity.js';
import {
  selectCanonicalAnalysisState,
  summariseCanonicalAnalysisState,
  type AnalysisStateSummary,
  type CanonicalAnalysisState,
  type CoachingStatePack,
} from './canonical-analysis-state.js';

// Recent turns cap for the conversation projection — the verbatim memory window.
// SINGLE SOURCE is now `context-pack-schema.ts` (FINAL-SWEEP F4); re-exported here
// so existing importers (context-pack-assembler.test.ts, context-budget-
// enforcement.test.ts) keep their import path, and POLICY_VERBATIM_TURNS derives
// from the same constant — no hand-mirror to move in lockstep.
export { CONTEXT_PACK_RECENT_TURNS_CAP } from './context-pack-schema.js';

/**
 * Context v2 S1: mirror of commit.ts `CONVERSATION_TEXT_CAP` (the persist-
 * time hard slice) used to infer per-turn `truncated` flags at projection —
 * the original length is not persisted, so at-cap is the only sound signal.
 * Declared locally (not imported) to keep this module free of a commit.ts
 * import edge; equality is pinned by tests/unit/context-disclosure-v2.test.ts.
 */
export const PERSISTED_MESSAGE_CAP = 2000;

export const CONTEXT_PACK_VERSION = '2.0' as const;

/**
 * Graph passthrough projection. Passes through the underlying node/edge
 * arrays verbatim and derives counts. Options / goals / constraints are
 * surfaced as kind-partitioned lists for LLM ergonomics — F.6 compliant
 * because we only re-index what is already there; we never compute new
 * semantic fields.
 */
export interface ContextPackGraph {
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly options: readonly unknown[];
  readonly goals: readonly unknown[];
  readonly constraints: readonly unknown[];
  readonly counts: {
    readonly nodes: number;
    readonly edges: number;
    readonly options: number;
    readonly goals: number;
    readonly constraints: number;
  };
}

export interface ContextPackAnalysisOption {
  readonly label: string;
  readonly probability: number;
  /**
   * Lane 30 — this option's goal-fit value: the modelled probability the
   * option meets the user's target(s), sourced from the per-option
   * `enrichment.option_comparison[].probability_of_joint_goal` (PLoT #204)
   * via the `option_goal_fits` signal. RAW [0,1] float — handler-facing
   * only; the display formatter renders it as an integer-percent
   * `target_fit` string, clearly distinguished from `win_probability`.
   * Absent when the producer scored no goal fit for this option.
   */
  readonly goal_fit_probability?: number;
  /**
   * Lane 30 fix 3 — this option's modelled-outcome mean, sourced from the
   * per-option `enrichment.option_comparison[].outcome.mean` via the
   * `option_outcomes` signal (NEVER from `OptionSummary.outcome_mean`,
   * whose upstream default of 0 cannot be distinguished from an honest
   * zero). RAW float — the display formatter bands it (`outcome_band`)
   * with the shared influence-band vocabulary. Absent when the producer
   * reported no outcome distribution for this option.
   */
  readonly outcome_mean?: number;
  /**
   * Trust-spine board #1 (CEE half). Literal `true` when this option is the
   * flagged constraint-infeasible WINNER (CEE_CONSTRAINT_INFEASIBLE_GATE ON;
   * the flag is set upstream by `compactAnalysis` via
   * constraint-feasibility.ts and threaded through here — adversarial-review
   * P1: `projectOption` previously field-picked the flag away, so the coach
   * egress never saw it). ABSENT otherwise (never `false`), matching the
   * pack's key-absence style, so flag-off packs are byte-identical.
   */
  readonly constraint_infeasible?: true;
}

export interface ContextPackAnalysisDriver {
  readonly factor_label: string;
  readonly sensitivity_value: number;
}

export interface ContextPackAnalysisFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

/**
 * Lane 21 (P0-A) — raw tipping-point projection entry. Values are raw
 * floats (handler-facing); the display formatter bands them into
 * decision-language phrases and never surfaces the numbers.
 * `no_flip_within_bounds` carries the producer-attested "no flip point
 * exists in the tested range" fact (staging `flip_reason:
 * 'no_effect_within_bounds'`).
 */
export interface ContextPackAnalysisFlipThreshold {
  readonly factor_label: string;
  readonly current_value: number | null;
  readonly flip_value: number | null;
  readonly unit: string | null;
  readonly no_flip_within_bounds: boolean;
  /**
   * ROADMAP 2.205 practical resolution (2026-07-31) — the DISPLAY LICENCE.
   * The producer's own display strings for this factor's current/flip values,
   * present exactly when those digits are already on the user's screen for
   * this analysis (chain traced at
   * `./analysis-signals.ts` → {@link deriveFlipDisplayLicences}). Both keys or
   * neither. ABSENT when unlicensed — key-absence doctrine, so an unlicensed
   * pack stays byte-identical to today's.
   *
   * Strings, never floats: `"40000 GBP"`, not `0.4`. The float cage is
   * enforced downstream at `../format/format-analysis-for-context.ts`, which
   * is the boundary that owns it, using the SAME `looksLikeRawDecimal`
   * predicate the display-graph projection applies to `display_value`.
   */
  readonly current_display?: string;
  readonly flip_display?: string;
}

/** Lane 21 — raw evidence-gap (VOI) projection entry. `voi_score` ∈ [0,1]. */
export interface ContextPackAnalysisEvidenceGap {
  readonly factor_label: string;
  readonly voi_score: number;
}

/** Lane 21 — goal-fit scoring provenance (PLoT #204). Fact + basis only. */
export interface ContextPackAnalysisGoalFit {
  readonly scored: boolean;
  readonly basis: string | null;
}

export interface ContextPackAnalysis {
  readonly status: string;
  readonly leading_option: ContextPackAnalysisOption | null;
  readonly runner_up: ContextPackAnalysisOption | null;
  readonly margin_pp: number | null;
  readonly robustness_band: string | null;
  readonly top_drivers: readonly ContextPackAnalysisDriver[];
  /**
   * Structured fragile-edge labels. Brief brief-display-safe-analysis A2:
   * carry the upstream `{from_label, to_label}` pair through directly so
   * the LLM-facing display projection never has to split the legacy
   * `"A → B"` string. Handler-side consumers also benefit — they get
   * structured access without parsing.
   */
  readonly fragile_edges: readonly ContextPackAnalysisFragileEdge[];
  /**
   * Lane 21 (P0-A) breadth widening. The four fields below are OPTIONAL on
   * the interface (one legacy call site — chip-click-dispatch — hand-builds
   * a narrow projection for `buildAnalysisProjectionSummary` and does not
   * carry them) but the routed `projectAnalysis` path ALWAYS populates them
   * so the LLM-facing display projection can represent the whole analysis:
   *
   *  - `options`: EVERY scale-guard-valid option (label + raw probability),
   *    sorted by win probability descending — not just the leading pair.
   *    Bounded by {@link MAX_PROJECTED_OPTIONS}.
   *  - `flip_thresholds`: tipping-point entries (top-level staging signals
   *    when attached, else the per-option `summary.flip_thresholds`).
   *  - `fragile_edge_count`: the UNCAPPED count behind the capped
   *    `fragile_edges` label list. Fail-closed under lever suppression:
   *    when any edge is suppressed the count collapses to the filtered
   *    list length rather than repeating the producer count.
   *  - `evidence_gaps` / `goal_fit`: VOI + goal-fit provenance signals
   *    (see `./analysis-signals.ts`), raw here, banded by the formatter.
   */
  readonly options?: readonly ContextPackAnalysisOption[];
  readonly flip_thresholds?: readonly ContextPackAnalysisFlipThreshold[];
  readonly fragile_edge_count?: number;
  readonly evidence_gaps?: readonly ContextPackAnalysisEvidenceGap[];
  /**
   * ROADMAP 2.54 (b) — literal `true` when the Lane 30 (#369 audit P1)
   * lever suppression removed at least one entry from `evidence_gaps`
   * (including fail-closed drops of unattributable entries while levers
   * exist). ABSENT otherwise (never `false`), matching the pack's
   * key-absence style. Carries the suppression FACT to the display
   * formatter so an emptied VOI section is disclosed honestly ("excluded
   * by design — options-set factors are not uncertainties to investigate")
   * rather than as "not scored". NOT a new lever-identity source: it is
   * set exactly where `filterLeverControlledFactorEntries` (the reviewed
   * #308-union structural authority) fires.
   */
  readonly evidence_gaps_lever_suppressed?: true;
  readonly goal_fit?: ContextPackAnalysisGoalFit | null;
  /**
   * Lane 30 fix 3 — top-level ordinal confidence tier (attested values
   * 'strong' | 'fair' | 'needs_work'; kept as a string because the
   * enrichment passthrough is untyped). Null when the producer reported
   * none. Rendered as prose by the display formatter.
   */
  readonly confidence_tier?: string | null;
  /**
   * Trust-spine board #1 (CEE half). The honest constraint note produced by
   * `compactAnalysis` when the leading option violates (or is in tension
   * with) a hard constraint — threaded through verbatim so the display
   * projection can surface it to the coach LLM. ABSENT when the gate is off
   * or the winner is feasible (byte-identity by key absence).
   */
  readonly constraint_infeasible_note?: string;
  // V5 state-trust: `staleness_reason` removed from the prompt-visible
  // analysis section — freshness is now a deterministic verdict on the
  // wire (`analysis_ready.freshness`) and a telemetry signal
  // (`v5.analysis_freshness.derived`). The legacy fallback string fired
  // even on freshly-completed analysis turns and contaminated Sonnet's
  // context with a misleading caveat. Telemetry retains the legacy
  // `analysis_state_source` / `analysis_staleness_reason` fields for
  // operator continuity in turn-executor's log payloads.
  //
  // This is a deliberate divergence from spec §10:436 of
  // `Docs/v5/olumi-v5-architecture-design-specification-v3_2.md`. See
  // `Docs/v5-state-trust-phase0.md` for the design record.
}

/**
 * Lane 28 — brief pipeline: the user's decision brief as projected into the
 * ContextPack. `text` is the persisted `scenarios.brief_text` (the user's own
 * words — no display-safety banding applies, unlike model-derived analysis
 * prose) bounded at {@link CONTEXT_PACK_BRIEF_CHAR_CAP}. Truncation is
 * DISCLOSED, never silent: `truncated` flags it and `original_chars` carries
 * the pre-truncation length so no consumer can mistake the bounded text for
 * the whole brief.
 */
export interface ContextPackBrief {
  readonly text: string;
  readonly truncated: boolean;
  readonly original_chars: number;
}

export interface ContextPackConversationTurn {
  readonly turn_id: string;
  readonly turn_class: string;
  readonly handler_id: string | null;
  readonly created_at: string;
  /**
   * V5 Conversation Context Reliability: the user's verbatim message for this
   * prior turn. Null when none was persisted (system-event turns, pre-migration
   * rows). The LLM reads this (and `assistant_message`) to resolve ordinary
   * follow-ups like "Why?", "do that", "the second one".
   */
  readonly user_message: string | null;
  /** The final public assistant answer for this prior turn; null when none. */
  readonly assistant_message: string | null;
  /**
   * Context v2 (02 §Disclosure): present-and-true when a message on this
   * turn sits AT the persistence cap ({@link PERSISTED_MESSAGE_CAP}) and was
   * therefore hard-sliced at commit time. ABSENT (never `false`) otherwise.
   * Disclosure is unconditional, so the key appears whenever a projected
   * turn is at the cap.
   */
  readonly truncated?: true;
}

export interface ContextPackConversation {
  readonly recent_turns: readonly ContextPackConversationTurn[];
  readonly turn_count: number;
  readonly last_tool_used: string | null;
  /**
   * Context v2 (02 §Disclosure fix 2): how many prior turns the window shows
   * vs how many the read returned — discloses that history exists beyond the
   * window. Emitted unconditionally by projectConversation; optional on the
   * type so partial/legacy fixtures still assign.
   *
   * `summarised` (#536 marker extension, O-2 activation): how many of the
   * not-shown turns arrive via the `conversation_summary` block instead of
   * vanishing. Present IFF a summary section was injected this turn — 0 is
   * an honest value there (a floor / withheld block absorbs nothing);
   * absent means no summary layer entered this prompt at all.
   */
  readonly window?: {
    readonly shown: number;
    /**
     * How many turns the conversation ACTUALLY has — the store's pre-cap
     * count, not the length of the read window. Until 2026-07-25 this was
     * `priorTurns.length`, i.e. the window's own size, so a 78-turn
     * conversation reported `available: 20` and the coach told the user its
     * total was 20.
     */
    readonly available: number;
    readonly summarised?: number;
    /**
     * The one in-band disclosure line, present IFF turns exist that this pack
     * does not show verbatim. Code-owned and emitted by the same function that
     * computes the numbers, so it cannot drift from them (the estate's
     * `HISTORY_CAP_DISCLOSURE` / decision-record `[INCOMPLETE …]` pattern).
     * A number alone leaves the coach free to describe the visible turns as
     * the whole conversation; this says not to, in words.
     */
    readonly notice?: string;
  };
  /**
   * Boolean flag indicating that the next user turn is expected to confirm
   * or dismiss a pending change. Diverges from spec §10:444, which defines
   * the field as `{ patch_id, description } | null`. The structured
   * carriage now lives off-pack on the wire as `pending_actions[]` /
   * `proposed_actions[]` (see `src/orchestrator-v5/session/pending-action.ts`),
   * which carry `proposal_ref`, `inline_patch`, `public_label`, and
   * `public_message`. The boolean here remains for routing/log signal
   * only. No state-trust decision record could be located for this
   * specific simplification — flagged as an undocumented spec divergence;
   * consider a Decision Log entry that supersedes §10:444.
   */
  readonly pending_confirmation: boolean;
}

export interface ContextPack {
  readonly version: typeof CONTEXT_PACK_VERSION;
  /**
   * Scenario identifier from the boundary turn payload. Surfaced on the
   * pack itself (not just buried in `payload`) so downstream consumers —
   * replay/journey harnesses, debug logs, future audit trails — have a
   * single canonical key for the assembled context. Spec §10:414 lists
   * this as a required ContextPack field; this projection closes that
   * compliance gap. Additive: existing consumers do not need to change.
   */
  readonly scenario_id: string;
  readonly stage: string;
  /**
   * Lane 28 — brief pipeline (dossier gap G2): the user's persisted decision
   * brief, projected via {@link projectBrief} (size-bounded, disclosed
   * truncation). Serialised into the routing prompt automatically by
   * `buildUserMessage` (route-with-tool-use.ts) — the LLM finally knows what
   * the decision is about on every turn after the draft, not just via graph
   * labels.
   *
   * OMITTED (key absent) when no brief has been persisted for this scenario
   * — the assembler never emits `brief: null`, so a no-brief pack serialises
   * no `brief` field into the prompt. The type keeps `| null` only for
   * tolerant reading of hand-built packs.
   */
  readonly brief?: ContextPackBrief | null;
  readonly graph: ContextPackGraph;
  /**
   * Raw, handler-facing analysis projection. Carries float probabilities
   * and signed sensitivities so coaching signals, chip generation,
   * projection summaries, and the explain-fallback path can do
   * deterministic logic. Never serialised to the LLM directly — see
   * `display_analysis` and `buildUserMessage` for the LLM-facing view.
   */
  readonly analysis: ContextPackAnalysis | null;
  /**
   * LLM-facing analysis projection. Decision-language strings only — no
   * raw floats, no internal coefficients. Substituted in for `analysis`
   * by `buildUserMessage` (route-with-tool-use.ts) when serialising the
   * ContextPack into the routing prompt. Design principle: raw model
   * values stay in structured state; LLM-facing context uses
   * decision-language projections only.
   */
  readonly display_analysis: DisplaySafeAnalysis | null;
  /**
   * LLM-facing graph projection. Edges carry decision-language `relationship`
   * phrases ("moderate positive link") instead of raw `strength` floats; raw
   * `exists` probabilities and `plain_interpretation` strings are stripped;
   * nodes carry only display-safe fields (id/label/kind plus optional
   * category/unit/intervention_summary). Substituted in for `graph` by
   * `buildUserMessage` (route-with-tool-use.ts) when serialising the
   * ContextPack into the routing prompt. Raw `graph` remains for handlers,
   * freshness hashing, telemetry; edit_graph dispatch reads from a wholly
   * separate path (`editCompactGraph()` over raw boundary state).
   */
  readonly display_graph: DisplaySafeGraph;
  /**
   * SELECTION-AWARE ANSWERING (hop 4): what the user currently has selected on
   * the canvas, resolved against canonical state by `buildTurnContext` and
   * projected here by {@link projectFocus}.
   *
   * Placed with the HARD STRUCTURED STATE, above `conversation`.
   *
   * ⚠ IN THE SERIALISED PROMPT IT DOES NOT SIT NEXT TO THE GRAPH. An earlier
   * version of this note said "immediately after the graph", which is true of
   * THIS literal and false of what the model reads: `buildUserMessage` strips
   * `graph`/`display_graph` out of `...rest` and RE-APPENDS them at the END, so
   * the serialised order is `… brief, focus, conversation, … analysis, graph`.
   * The policy row's position is derived from the SERIALISED order, not from
   * this one — describe the two separately or the next reader mis-places it.
   *
   * ABSENT (key missing, never `focus: null`) on every turn that carried no
   * selection — the same byte-identity guarantee `conversation_summary` and
   * `older_relevant_facts` carry. `buildUserMessage` spreads `...rest`, so the
   * section reaches the routing prompt with no serialisation edit; the
   * code-owned `FOCUS_INSTRUCTION` is appended by the SAME condition.
   */
  readonly focus?: ContextPackFocus;
  readonly conversation: ContextPackConversation;
  /**
   * Context v2 S4-INJECT (ROADMAP 1.73; design pack 01 §2, 04 §3): the
   * rolling conversation summary, projected by the injector
   * (`rolling-summary/inject.ts`) from `scenarios.rolling_summary`.
   * Unconditional since the O-2 activation (CEE_ROLLING_SUMMARY deleted):
   * present ONLY when the conversation extends beyond the verbatim window
   * AND a stored summary exists for the scenario; ABSENT otherwise — key
   * absence is the byte-identity guarantee at the prompt seam.
   *
   * Adjacent to `conversation` here (01 §2); in the SERIALISED routing
   * prompt `buildUserMessage` re-appends it after the ground-truth
   * `analysis`/`graph` sections so the LLM reads it BELOW structured state
   * (04 §3.1 — facts beat summary), alongside the code-owned precedence
   * instruction.
   *
   * NOTE: `conversation_summary` also names a V4 prompt-zones registry
   * entry (src/orchestrator/prompt-zones/*) — unrelated; grep/telemetry
   * key on this V5 pack path.
   */
  readonly conversation_summary?: ContextPackConversationSummary;
  /**
   * Knowledge-over-time (ROADMAP 1.199, P6): a bounded, disclosed projection of
   * the scenario's prior DECISION RECORDS (not just prior turns) — one line per
   * recorded decision `[date] Chose "<option>": <rationale>`. Populated by the
   * turn-executor's fire-safe decision-records loader and bounded to
   * {@link POLICY_OLDER_RELEVANT_FACTS_CHAR_BUDGET}. The key is ABSENT when the
   * scenario has no records (byte-identity for record-less scenarios). Placed
   * among hard structured state (above the rolling summary) so durable facts
   * beat the summary — the CONTEXT_POLICY declares it `enforced`/model-facing.
   */
  readonly older_relevant_facts?: string;
  /**
   * Curated summary of the most recent successful mutations from
   * `prior_facts`, in newest-first order. Capped at three entries with
   * each summary truncated to 80 chars. Non-mutation facts and noop
   * facts are filtered out. Empty array when no prior mutations exist.
   *
   * Fixes the Phase 0 information-starvation finding for state-query
   * follow-ups ("what update did you make?", "what changed?"): without
   * a human-readable receipt of recent actions in the prompt, Sonnet
   * has no payload to reference and falls to the legacy `edit_graph`
   * catch-all. The deterministic state-query guard in the routing
   * pre-route layer also reads this field — both surfaces share the
   * same projection so their answers stay coherent.
   *
   * Hard contract — no raw structural identifiers ever appear here.
   * See {@link projectRecentChanges} for the cap and shape rules.
   */
  readonly recent_changes: readonly RecentMutation[];
  /**
   * Coaching state assembled from prior turns. draft_coaching is populated
   * from the draft-graph sidecar (logs/v5-draft-graph-coaching.jsonl) keyed
   * by scenario_id. decision_review is populated from the most recent
   * run_analysis handler fact's enrichment.decision_review (Task B). Null
   * sub-fields when no prior data exists.
   */
  readonly coaching: CoachingCache;
  readonly compound_detected: boolean;
  /** Populated only when compound_detected is true. Ordered as they appear in the message. */
  readonly compound_segments?: readonly string[];
  /**
   * Conjunction the compound detector matched on (and / then / also / plus),
   * null when no compound was detected. Surfaced into the routing log for
   * Phase 2 evaluation of detector quality.
   */
  readonly compound_pattern_matched: string | null;
  /**
   * Pre-parsed numeric quantities extracted from the user message by the
   * Layer 0 CQE module. Empty when no quantities were found. Consumed by
   * Sonnet via the routing prompt's PARAMETERS section — F.6: the LLM
   * never does arithmetic. See CQE Design v1.1 §3 for field semantics.
   */
  readonly parsed_quantities: readonly QuantityExtractionResult[];
  readonly system_event: unknown | null;
  /**
   * Redacted canonical analysis state (additive observability). Derived from
   * the single canonical selector so prose / chips / context / diagnostics
   * all read one verdict. Statuses / predicates / counts / hashes only — no
   * raw blocker messages, labels, or user text.
   *
   * Null when the assembler had no canonical source on this turn. Pre-M5 the
   * production compacted-graph path passes `graph: undefined`, so the
   * assembler cannot recompute a freshness-comparable hash and emits null
   * rather than a misleadingly-stale verdict — the AUTHORITATIVE verdict
   * ships on the wire via the route's redacted context-summary surface
   * (turn-executor's raw-graph freshness). M5 threads `canonicalState` in so
   * this populates on every turn.
   */
  readonly analysis_state: AnalysisStateSummary | null;
  /**
   * Coaching Context Pack v1 — the hash-free, prompt-safe projection of the
   * canonical analysis state the LLM may RECEIVE for coaching (never author).
   * Present whenever a freshness verdict was derived this turn (the
   * turn-executor supplies it via `AssembleContextPackInput.coachingContext`
   * — UNCONDITIONAL since 2026-07-20, O-7 wave 2:
   * CEE_COACHING_CONTEXT_PROMPT_ENABLED deleted); absent when no verdict.
   * Unlike `analysis_state` (stripped from the prompt for its graph-hash
   * digests) this projection carries no hashes/indices/values/units/labels/text,
   * so it is the ONLY canonical-state surface allowed to reach the prompt.
   */
  readonly coaching_context?: CoachingStatePack;
  /**
   * O-3 — context-size budget disclosure. Present ONLY when the budget
   * module (`enforceContextBudget`) trimmed the compacted graph and/or the
   * analysis summary at assembly; ABSENT otherwise (key-absence doctrine —
   * an under-budget pack is byte-identical to an unbudgeted one). Carries
   * one `{section, original_chars, kept_chars}` record per trimmed
   * section. Serialised into the routing prompt by `buildUserMessage`
   * (rides the `...rest` spread), so the LLM SEES that detail was reduced
   * — the same in-band mechanism as `conversation.window` ("N of M turns
   * included", #536). The turn-executor's routing `v5.context_budget`
   * event derives its `truncations` records from this marker.
   */
  readonly context_budget?: ContextBudgetDisclosure;
}

export interface AssembleContextPackInput {
  // v0.7.0: assembler only operates on message-kind turns (system events
  // take a deterministic pre-TurnExecutor path in route-v2.ts).
  readonly payload: MessageTurnPayload;
  // V5 Conversation Context Reliability: the content-bearing superset so
  // projectConversation can surface user_message / assistant_message to the
  // LLM. SessionTurnWithContent ⊇ SessionTurn.
  readonly priorTurns: readonly SessionTurnWithContent[];
  /**
   * How many turns the scenario ACTUALLY has (`EnrichedTurnContext.
   * prior_turns_total`) — the store's pre-cap count. `priorTurns` above is a
   * window capped at `SESSION_READ_WINDOW_TURNS` (default 20), so its length
   * is NOT the conversation's length.
   *
   * `null`/absent = unknown (count read failed, or a legacy/test store). The
   * projection then states the shortfall WITHOUT a number instead of falling
   * back to the window length — that fallback is the defect.
   */
  readonly priorTurnsTotal?: number | null;
  /**
   * Prior handler facts (newest-first), used to project the
   * `recent_changes` summary into the LLM-facing ContextPack. Optional
   * for backwards-compat with callers (and tests) that don't yet wire
   * facts through; when absent the projection collapses to an empty
   * array. Production callers — turn-executor.ts — MUST pass facts so
   * follow-up state-queries can be grounded.
   */
  readonly priorFacts?: readonly HandlerFact[];
  /**
   * CONTEXT/MEMORY V5 defect 4 — did the read that produced `priorFacts`
   * SUCCEED? Threaded from `EnrichedTurnContext.prior_facts_read_ok`.
   *
   * `priorFacts === undefined` (facts never wired) is already handled above by
   * omitting the canonical state entirely. This flag covers the OTHER empty:
   * facts WERE wired, the read THREW, and the array is `[]`. Without it
   * `deriveContextPackAnalysisState` reads that as canonical `'none'` and puts
   * "never analysed" into the LLM-facing pack.
   *
   * `false` ONLY on a thrown read; absent ⇒ pre-fix behaviour. Deliberately
   * mirrors `prior_facts_read_ok` rather than inventing a second vocabulary.
   */
  readonly priorFactsReadOk?: boolean;
  /**
   * Lane 28 — brief pipeline: the persisted `scenarios.brief_text` for this
   * scenario, threaded by the turn-executor from
   * `EnrichedTurnContext.scenarioBriefText` (loaded once per turn by
   * `buildTurnContext` via `loadGraphAndBriefText`). Optional for
   * backwards-compat with callers/tests that don't wire it; absent/null/
   * whitespace-only means the pack carries NO `brief` key at all (the
   * assembler omits it — a null is never serialised into the prompt).
   */
  readonly brief?: string | null;
  readonly graph?: GraphWithOptions | null;
  /**
   * V5 Task 1.2: pre-compacted graph projection. When present, the assembler
   * uses this to populate ContextPack.graph (nodes/edges/derived lists and
   * counts) instead of the raw `graph` passthrough. Options/goals are
   * derived from the compact nodes by kind; constraints come through via
   * `compactedConstraints` below when the caller has them (compactGraph
   * itself drops `goal_constraints`). The full graph remains available to
   * the validator via `graphLookupForValidate` in turn-executor.
   *
   * Absent / null falls back to the raw passthrough projection, preserving
   * the pre-1.2 behaviour for callers that haven't adopted compaction.
   */
  readonly compactedGraph?: GraphV3Compact | null;
  /**
   * V5 review: raw `goal_constraints` from the ingress carried alongside
   * the compact graph so Sonnet does not lose decision constraints in the
   * compact path. Passthrough only — assembler does not introspect.
   */
  readonly compactedConstraints?: readonly unknown[] | null;
  /**
   * The compact analysis summary, optionally carrying the Lane 21 signal
   * extensions (tipping points / evidence-gap VOI / goal-fit provenance —
   * see `./analysis-signals.ts`). Plain `AnalysisResponseSummary` values
   * remain assignable; the extensions are additive and optional.
   */
  readonly analysis?: AnalysisResponseSummaryWithSignals | null;
  /**
   * V5 Task 1.4: when the analysis came from a server-side fallback
   * (prior handler facts, not this request's body), the caller supplies a
   * string describing the reason. It is passed through to
   * `ContextPackAnalysis.staleness_reason` so Sonnet can treat the results
   * as potentially-stale reference material rather than fresh output.
   * Absent/null means analysis is fresh (or absent).
   */
  readonly analysisStalenessReason?: string | null;
  /**
   * Spine A (V5-owned claim-safety BACKSTOP): the set of `factor_id`s that an
   * option intervenes on, computed by the dispatch path from the RAW turn graph
   * (the compacted projection strips intervention bundles, so this must be
   * supplied here, NOT derived from `compactedGraph`). When present,
   * `projectTopDrivers` suppresses any top driver whose factor is in the set so
   * deterministic prose / LLM context never name an option-controlled lever as a
   * tunable sensitivity driver. Producer values are untouched — this is a
   * presentation suppression, NOT the Lane A1 producer fix. Omitted / empty ⇒ no
   * suppression (fail-safe).
   */
  readonly interventionControlledFactorIds?: ReadonlySet<string>;
  readonly systemEvent?: unknown | null;
  readonly pendingConfirmation?: boolean;
  /** Pre-resolved coaching state. Caller reads sidecar / prior facts before
   *  calling the assembler; keeps the assembler synchronous. Defaults to
   *  EMPTY_COACHING_CACHE when not supplied. */
  readonly coaching?: CoachingCache;
  /**
   * V5 canonical analysis state, pre-computed by the dispatch path (M5,
   * turn-executor — which has the raw graph + freshness). When provided it
   * is authoritative for the ContextPack `analysis_state`. When absent, the
   * assembler best-effort derives it from `priorFacts` + the turn graph, and
   * emits null when no freshness-comparable hash is available here. Additive;
   * existing callers omit it (call site unchanged until M5).
   */
  readonly canonicalState?: CanonicalAnalysisState;
  /**
   * Coaching Context Pack v1 (unconditional since 2026-07-20 — O-7 wave 2:
   * CEE_COACHING_CONTEXT_PROMPT_ENABLED deleted). The hash-free, prompt-safe
   * `CoachingStatePack` the turn-executor projects from the live
   * `deriveAnalysisFreshness` verdict for coaching turns. When present, it is
   * surfaced verbatim as `ContextPack.coaching_context` (and thereby into the
   * LLM routing prompt). Omitted when no freshness was derived.
   */
  readonly coachingContext?: CoachingStatePack;
  /**
   * Context v2 S4-INJECT: the pre-projected rolling-summary section, built
   * by `loadConversationSummaryForInjection` (rolling-summary/inject.ts) in
   * the turn-executor — the loader owns the activation condition (beyond-
   * window only, since the O-2 flag deletion), the store read, the lag
   * computation, and the staleness disclosure; the assembler stays
   * synchronous and only places the section. Omitted (undefined) when the
   * conversation fits the verbatim window or no stored summary exists →
   * the field is absent → byte-identity with pre-S4 packs.
   */
  readonly conversationSummary?: ContextPackConversationSummary;
  /**
   * #536 marker extension (O-2): the loader's `summarisedTurns` — how many
   * not-shown window turns the injected block absorbs. Stamped onto
   * `conversation.window.summarised` ONLY when `conversationSummary` is
   * also supplied (a coverage number without its block would be a marker
   * that discloses nothing). Null/undefined → marker unchanged.
   */
  readonly summarisedTurns?: number | null;
  /**
   * Knowledge-over-time (P6): the pre-projected `older_relevant_facts` section
   * text, built by the turn-executor's fire-safe decision-records loader
   * (loadOlderRelevantFactsSection) — mirroring how `conversationSummary` is
   * pre-loaded. The assembler stays synchronous and only PLACES it. Omitted
   * (undefined) when the scenario has no records or the read failed → the pack
   * key is absent → byte-identity for record-less scenarios.
   */
  readonly olderRelevantFacts?: string;
  /**
   * Selection-aware answering (hop 4): the turn's canvas selection, ALREADY
   * resolved against canonical state by `buildTurnContext`. The assembler
   * PLACES it and does not re-resolve — a second resolution would be a second
   * authority on what the user selected, and the two would disagree the first
   * time the graph read degrades.
   */
  readonly selection?: TurnSelection;
}

// ---------------------------------------------------------------------------
// Selection-aware answering (hop 4) — the `focus` projection
// ---------------------------------------------------------------------------

/**
 * Element cap. THE INGRESS HAS NO CAP OF ITS OWN: the widened
 * `TurnSelection.requested_ids` / `unresolved_ids` are unbounded (the shared
 * contract's `.max(20)` is absent on the CEE-side type), so this projection is
 * the ONLY bound between a hostile or runaway selection and the routing prompt.
 * 20 matches the contract's intent for the same concept.
 */
export const FOCUS_MAX_ELEMENTS = 20;
/** Per-field text bounds — a hostile label must not balloon the prompt. */
export const FOCUS_LABEL_MAX_CHARS = 120;
export const FOCUS_DESCRIPTION_MAX_CHARS = 160;
export const FOCUS_SHORT_TEXT_MAX_CHARS = 48;
export const FOCUS_ID_MAX_CHARS = 96;

/**
 * The analysis outputs attached to a selected element — DISPLAY-SAFE STRINGS
 * copied from the projection the model already receives (`display_analysis`),
 * never re-derived here. Re-deriving would make this a second author of the
 * same numbers, which is how two surfaces come to disagree.
 */
export interface ContextPackFocusAnalysis {
  /** Display percent string, e.g. `"62%"`. Options only. */
  readonly win_probability?: string;
  /** Display percent string for goal fit. Options only. */
  readonly target_fit?: string;
  /** Decision-language sensitivity phrase, e.g. `"strong positive influence"`. */
  readonly influence?: string;
  /** Banded value-of-information phrase. */
  readonly value_of_information?: string;
  /** Banded flip-risk phrase for this factor. */
  readonly tipping_point_risk?: string;
}

export interface ContextPackFocusElement {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly description?: string;
  readonly category?: string;
  readonly value?: number;
  readonly unit?: string;
  readonly display_value?: string;
  readonly value_source?: string;
  /**
   * How this element relates to the current analysis, as a CLOSED ENUM:
   *   · `linked`          — matched exactly one analysis entry; `analysis` present.
   *   · `not_in_analysis` — the analysis ran and scored nothing for this element.
   *   · `ambiguous_label` — the label does not uniquely identify this element,
   *                         so the join was REFUSED. See the note on
   *                         {@link projectFocus}.
   *   · `analysis_not_current` — analysis exists, but canonical state does not
   *                         license it as current/trustworthy for exploration;
   *                         no analysis values are attached.
   *   · `no_analysis`     — no analysis on this turn to join against.
   */
  readonly analysis_link:
    | 'linked'
    | 'not_in_analysis'
    | 'ambiguous_label'
    | 'analysis_not_current'
    | 'no_analysis';
  /** Present IFF `analysis_link === 'linked'` and at least one value matched. */
  readonly analysis?: ContextPackFocusAnalysis;
}

export interface ContextPackFocus {
  readonly elements: readonly ContextPackFocusElement[];
  /**
   * Why some requested elements are missing — a CLOSED ENUM, never prose.
   * Prose composed here would be a second place authoring user-facing
   * language, and the REASON is a fact, not a phrasing.
   *
   * ⭐ `not_in_model` and `could_not_check` MUST NOT COLLAPSE. `graph_read`
   * exists precisely so nothing downstream can tell a user their node is gone
   * when the truth is that the model could not be read.
   */
  readonly unresolved: 'none' | 'not_in_model' | 'could_not_check';
  /** How many elements the turn asked about, before any cap. */
  readonly requested_count: number;
  /** How many did not resolve. Read WITH `unresolved`, never without it. */
  readonly unresolved_count: number;
  /** Present ONLY when the element cap dropped entries — disclosed truncation. */
  readonly elements_omitted?: number;
}

/** Bound a display string without letting a hostile value reach the prompt. */
function boundText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}

/**
 * Project the resolved selection into an LLM-facing focus section.
 *
 * ⚠ RETURNS `null` — key ABSENT, never `focus: null` — when there is nothing
 * honest to say. Absence preserves byte-identity for every turn that carried no
 * selection, exactly as `conversation_summary` and `older_relevant_facts` do.
 *
 * ⭐ THE HONESTY RULE, AND IT IS THE WHOLE POINT OF THE SECTION:
 *   · elements resolved  → name them, with label/kind/value/unit and their
 *                          analysis outputs;
 *   · unresolved AND the graph WAS read (`ok_present` / `ok_absent`)
 *       → `not_in_model`: the user is pointing at something this model does
 *         not contain;
 *   · unresolved AND `degraded`
 *       → `could_not_check`: the user is pointing at something we could not
 *         look up. NOT the same claim, and never collapsed into one.
 *
 * ⭐⭐ THE ANALYSIS JOIN IS ID-FIRST, AND FAILS CLOSED. This matters, and the
 * reason is a defect this estate has already paid for twice.
 *
 * The PACK's analysis projection is LABEL-KEYED — `projectAnalysis` receives
 * `option_id` on every upstream option and `factor_id` on every upstream driver
 * and DISCARDS BOTH, five lines below a comment that calls the id load-bearing
 * *precisely because* "labels collide". So a join written against the pack
 * alone could only use the label, which is exactly the "value predicate another
 * object could satisfy" defect (trap #19).
 *
 * The ids DO still exist on the assembler's UPSTREAM input, so the join is made
 * there: {@link buildAnalysisIdentityIndex} maps `node id → {label, kind}`, by
 * IDENTITY. Only the second hop — from that label to the already-formatted
 * display entry — is by label, and it carries THREE guards, each closing a
 * defect proven by execution. See {@link resolveAnalysisLink}, which is where
 * the argument lives; the short version is that uniqueness is judged on the
 * UNCAPPED upstream and the lists are scoped BY KIND, because a capped display
 * list has already had the evidence of a collision removed.
 *
 * ⚠ An earlier version of this claimed "nothing is ever guessed into a
 * different node" while a review refuted it twice by execution. The claim now
 * rests on the three guards and on the twinned corpus in
 * `__tests__/context-pack-focus.spec.ts` (`F1 —`), not on this sentence.
 *
 * Display-safe only: label, kind, unit, `display_value`, the value-source
 * vocabulary, and display strings copied from `display_analysis` — never
 * re-derived here, so `focus` cannot show a number that disagrees with the
 * `analysis` section beside it. No raw internal coefficients.
 */
export function projectFocus(
  selection: TurnSelection | undefined,
  displayAnalysis: DisplaySafeAnalysis | null,
  index: AnalysisIdentityIndex,
  /**
   * Canonical permission to bind analysis figures to the selected element.
   * Production passes `CoachingStatePack.usable_for_chips`, which already
   * composes freshness, blockers and contradictions in the canonical analysis
   * selector. The default is deliberately fail-closed for any isolated caller;
   * the sole production caller always supplies the explicit canonical verdict
   * below.
   */
  analysisUsableForFocus = false,
): ContextPackFocus | null {
  if (selection === undefined) return null;
  // An EMPTY selection is not a selection: a truthy object on every turn would
  // make every turn look selection-aware.
  //
  // ⚠ A selection carrying ONLY unreadable references is still a selection —
  // the user clicked something. It resolves to no elements and discloses
  // `could_not_check` rather than going quiet, which is the whole point of the
  // channel. Node selections are unaffected: `unreadable_ref_ids` is empty for
  // every one of them, so this predicate is byte-identical there.
  if (selection.requested_ids.length === 0 && selection.unreadable_ref_ids.length === 0) {
    return null;
  }

  const capped = selection.elements.slice(0, FOCUS_MAX_ELEMENTS);
  const omitted = selection.elements.length - capped.length;

  const elements: ContextPackFocusElement[] = capped.map((el) => {
    const analysisLink = resolveAnalysisLink(
      el.id,
      displayAnalysis,
      index,
      analysisUsableForFocus,
    );
    return {
      id: boundText(el.id, FOCUS_ID_MAX_CHARS),
      kind: boundText(el.kind, FOCUS_SHORT_TEXT_MAX_CHARS),
      label: boundText(el.label, FOCUS_LABEL_MAX_CHARS),
      ...(el.description !== undefined
        ? { description: boundText(el.description, FOCUS_DESCRIPTION_MAX_CHARS) }
        : {}),
      ...(el.category !== undefined
        ? { category: boundText(el.category, FOCUS_SHORT_TEXT_MAX_CHARS) }
        : {}),
      // Absence is meaningful: a defaulted 0 would be indistinguishable from a
      // real observed value.
      ...(el.value !== undefined ? { value: el.value } : {}),
      ...(el.unit !== undefined ? { unit: boundText(el.unit, FOCUS_SHORT_TEXT_MAX_CHARS) } : {}),
      ...(el.display_value !== undefined
        ? { display_value: boundText(el.display_value, FOCUS_SHORT_TEXT_MAX_CHARS) }
        : {}),
      ...(el.value_source !== undefined
        ? { value_source: boundText(el.value_source, FOCUS_SHORT_TEXT_MAX_CHARS) }
        : {}),
      analysis_link: analysisLink.link,
      ...(analysisLink.analysis !== undefined ? { analysis: analysisLink.analysis } : {}),
    };
  });

  return {
    elements,
    unresolved: deriveUnresolved(selection),
    // Counts describe what the USER selected, so an unreadable reference is
    // counted as requested AND unresolved — reporting 0 requested for a turn
    // where someone clicked an edge would be the same silence one field over.
    // Both addends are 0 for every node selection, so this is byte-identical
    // there.
    requested_count: selection.requested_ids.length + selection.unreadable_ref_ids.length,
    unresolved_count: selection.unresolved_ids.length + selection.unreadable_ref_ids.length,
    ...(omitted > 0 ? { elements_omitted: omitted } : {}),
  };
}

/**
 * The three-state discrimination, isolated so it can be read and mutated on its
 * own. Nothing unresolved ⇒ nothing to disclose. Otherwise the reason depends
 * ENTIRELY on whether the graph was actually read.
 */
function deriveUnresolved(selection: TurnSelection): ContextPackFocus['unresolved'] {
  if (selection.unresolved_ids.length === 0) {
    // ⭐ TWO QUESTIONS, KEPT APART (see `TurnSelection.unreadable_ref_ids`).
    // Nothing failed to RESOLVE, but a reference may have been unreadable —
    // the user pointed at something whose address we cannot parse. That is
    // `could_not_check`: we did not look and find nothing, we could not look.
    // Claiming `not_in_model` here would assert an absence we never tested.
    return selection.unreadable_ref_ids.length === 0 ? 'none' : 'could_not_check';
  }
  // Unchanged, and deliberately still keyed on `graph_read` ALONE: for a
  // reference we COULD read, the only question left is whether the model was
  // readable. Byte-identical for every node selection.
  return selection.graph_read === 'degraded' ? 'could_not_check' : 'not_in_model';
}

/**
 * Build `node id → the analysis's own label for that node` from the UPSTREAM
 * analysis, where the structural ids still exist.
 *
 * This function is the whole reason the focus join is an identity join rather
 * than a label join: `projectAnalysis` strips `option_id` and `factor_id` on
 * the way into the pack, so by the time the display projection exists the ids
 * are gone. Reading them HERE — from the same input `projectAnalysis` reads —
 * costs nothing and removes an entire class of mis-attribution.
 *
 * Tolerant by construction: the assembler accepts hand-built and narrow
 * analysis shapes (the chip-click dispatch supplies a partial projection), so
 * every field is checked rather than assumed. A shape that carries no ids
 * simply yields an empty index, and every element then reports
 * `not_in_analysis` — honest, and never a wrong attachment.
 */
/** What the analysis knows about one node: its own label for it, and its KIND. */
export interface AnalysisIdentityEntry {
  readonly label: string;
  /** `option` ⇒ scored in `options`; `factor` ⇒ scored as a driver. */
  readonly kind: 'option' | 'factor';
}

/**
 * The uncapped, kind-aware identity index the focus join reads.
 *
 * ⭐ `idsPerLabel` IS THE LOAD-BEARING HALF, and it is derived from the
 * UNCAPPED upstream on purpose. See {@link resolveAnalysisLink}.
 */
export interface AnalysisIdentityIndex {
  readonly byId: ReadonlyMap<string, AnalysisIdentityEntry>;
  /** How many DISTINCT node ids claim each label, before any cap or trim. */
  readonly idsPerLabel: ReadonlyMap<string, number>;
}

/**
 * Build the identity index from the UPSTREAM analysis, where the structural ids
 * still exist (`projectAnalysis` strips `option_id` and `factor_id` on the way
 * into the pack).
 *
 * ⭐⭐ IT MUST BE BUILT FROM THE UNCAPPED INPUT. That is not an optimisation —
 * it is the entire correctness argument. `MAX_PROJECTED_OPTIONS`, the driver
 * cap and the display char-budget tail-trim all SHORTEN the display lists, so a
 * label shared by two nodes upstream can arrive at the display as a single
 * surviving entry. Anything that judges uniqueness by looking at the display is
 * therefore asking a list that has already had the evidence removed.
 *
 * Tolerant by construction: the assembler accepts narrow and hand-built
 * analysis shapes, so every field is checked. A shape carrying no ids yields an
 * empty index and every element honestly reports `not_in_analysis`.
 */
export function buildAnalysisIdentityIndex(analysis: unknown): AnalysisIdentityIndex {
  const byId = new Map<string, AnalysisIdentityEntry>();
  if (analysis === null || typeof analysis !== 'object') {
    return { byId, idsPerLabel: new Map() };
  }
  const a = analysis as { options?: readonly unknown[]; top_drivers?: readonly unknown[] };
  const add = (id: unknown, label: unknown, kind: 'option' | 'factor'): void => {
    if (typeof id === 'string' && id.length > 0 && typeof label === 'string' && label.length > 0) {
      // First writer wins: a duplicate id is a producer defect, and silently
      // overwriting would make the winner depend on array order.
      if (!byId.has(id)) byId.set(id, { label, kind });
    }
  };
  for (const o of a.options ?? []) {
    add((o as { option_id?: unknown }).option_id, (o as { option_label?: unknown }).option_label, 'option');
  }
  for (const d of a.top_drivers ?? []) {
    add((d as { factor_id?: unknown }).factor_id, (d as { factor_label?: unknown }).factor_label, 'factor');
  }
  // DERIVED from `byId`, never maintained alongside it — one authority, and a
  // duplicate id can only ever be counted once.
  const idsPerLabel = new Map<string, number>();
  for (const { label } of byId.values()) {
    idsPerLabel.set(label, (idsPerLabel.get(label) ?? 0) + 1);
  }
  return { byId, idsPerLabel };
}

/** Exactly-one match, or a verdict. Never the first of several. */
type Match<T> = { readonly kind: 'one'; readonly entry: T } | { readonly kind: 'none' } | { readonly kind: 'many' };

function matchByLabel<T>(
  entries: readonly T[] | undefined,
  label: string,
  labelOf: (entry: T) => string,
): Match<T> {
  if (entries === undefined) return { kind: 'none' };
  const matches = entries.filter((e) => labelOf(e) === label);
  if (matches.length === 1) return { kind: 'one', entry: matches[0]! };
  return matches.length === 0 ? { kind: 'none' } : { kind: 'many' };
}

/**
 * Resolve one selected element to its analysis figures — or refuse.
 *
 * ⭐⭐ THREE GUARDS, AND EACH CLOSES A DEFECT PROVEN BY EXECUTION. An earlier
 * version of this function had only the third, claimed "nothing is ever guessed
 * into a different node", and was refuted twice by an independent review. Both
 * refutations shared ONE root cause: **it judged a label's uniqueness from the
 * DISPLAY lists, which are capped and trimmed, while the id index came from the
 * UNCAPPED upstream.** The guard was asking the list that had already had the
 * evidence removed.
 *
 *   1. UNCAPPED UNIQUENESS (`idsPerLabel > 1`) — the authority. If two nodes
 *      upstream claim this label, the display entry cannot be attributed to
 *      either, no matter how many survived the cap. Closes the case where 13
 *      options share a label at ranks 1 and 13, `MAX_PROJECTED_OPTIONS` drops
 *      the 13th, and the survivor's 62% was reported for an option whose true
 *      figure was 1%. Reachable identically via the driver cap and the display
 *      budget tail-trim.
 *
 *   2. KIND SCOPING — an option reads only option figures; a factor reads only
 *      factor figures. Closes the cross-kind coincidence, which needed NO
 *      trimming at all: an option and a factor sharing a label each matched
 *      exactly one entry in their own list, so no list was `many`, the guard
 *      stayed silent, and the option quietly collected the factor's influence
 *      phrase. A per-list check cannot see a collision spread ACROSS lists.
 *      It also covers factor-labelled lists this index cannot see: upstream
 *      `EvidenceGapSignal.factor_id` is OPTIONAL and `projectAnalysis` strips
 *      it regardless, so a VOI entry can exist with no id anywhere — invisible
 *      to the index and to `idsPerLabel`. That id-less class is guard 2's ONLY
 *      distinctive work: with guard 1 in place, every collision whose entities
 *      BOTH carry ids is refused before guard 2 is consulted. It is therefore
 *      also the only place guard 2 can honestly be pinned — see
 *      `__tests__/context-pack-focus.spec.ts` (`GUARD 2 —`), whose
 *      discriminator is the one test a minimal kind-scoping mutant turns red.
 *
 *      ⚠ RESIDUAL, AND IT IS IRREDUCIBLE AT THIS SEAM: kind scoping stops an
 *      OPTION reading factor figures, but it CANNOT stop a FACTOR from
 *      collecting a same-label VOI phrase belonging to a DIFFERENT factor that
 *      exists only in the id-less list — both are factor-kind and there is no
 *      id here to tell them apart. Pinned as a KNOWN RESIDUAL in that spec
 *      rather than left silent. The honest exit is the premise already pinned
 *      by `the identity index is built from UPSTREAM ids…`: carry `factor_id`
 *      through `projectAnalysis` into the pack and this class closes with it.
 *
 *   3. PER-LIST AMBIGUITY (`many`) — the residual guard, for two entries
 *      sharing a label WITHIN one kind-scoped display list.
 *
 * On any refusal: `ambiguous_label` and NOTHING attached. A partially-safe
 * attachment is still a claim about which node the numbers belong to.
 */
function resolveAnalysisLink(
  elementId: string,
  displayAnalysis: DisplaySafeAnalysis | null,
  index: AnalysisIdentityIndex,
  analysisUsableForFocus: boolean,
): { link: ContextPackFocusElement['analysis_link']; analysis?: ContextPackFocusAnalysis } {
  if (displayAnalysis === null) return { link: 'no_analysis' };

  // Analysis identity alone is not enough: the selected node comes from the
  // CURRENT persisted graph, while `displayAnalysis` may be a prior run whose
  // graph hash no longer matches. Attaching its figures would make stale values
  // look selected/current. Consume the canonical usability predicate and fail
  // closed before either the identity index or display labels are consulted.
  if (!analysisUsableForFocus) return { link: 'analysis_not_current' };

  // HOP 1 — IDENTITY. What the analysis calls THIS node id, and what kind it is.
  const entry = index.byId.get(elementId);
  if (entry === undefined) return { link: 'not_in_analysis' };

  // GUARD 1 — uniqueness judged on the UNCAPPED upstream, not on the display.
  if ((index.idsPerLabel.get(entry.label) ?? 0) > 1) return { link: 'ambiguous_label' };

  // HOP 2 — that label into the display entries, SCOPED BY KIND (guard 2).
  const isOption = entry.kind === 'option';
  const option = isOption
    ? matchByLabel(displayAnalysis.options, entry.label, (o) => o.label)
    : ({ kind: 'none' } as Match<never>);
  const driver = isOption
    ? ({ kind: 'none' } as Match<never>)
    : matchByLabel(displayAnalysis.top_drivers, entry.label, (d) => d.label);
  const gap = isOption
    ? ({ kind: 'none' } as Match<never>)
    : matchByLabel(displayAnalysis.value_of_information, entry.label, (g) => g.label);
  const tipping = isOption
    ? ({ kind: 'none' } as Match<never>)
    : matchByLabel(displayAnalysis.tipping_points, entry.label, (t) => t.label);

  // GUARD 3 — residual per-list ambiguity within the kind-scoped lists.
  if ([option, driver, gap, tipping].some((m) => m.kind === 'many')) {
    return { link: 'ambiguous_label' };
  }

  const analysis: ContextPackFocusAnalysis = {
    ...(option.kind === 'one' && option.entry.win_probability !== undefined
      ? { win_probability: option.entry.win_probability }
      : {}),
    ...(option.kind === 'one' && option.entry.target_fit !== undefined
      ? { target_fit: option.entry.target_fit }
      : {}),
    ...(driver.kind === 'one' && driver.entry.influence !== undefined
      ? { influence: driver.entry.influence }
      : {}),
    ...(gap.kind === 'one' && gap.entry.value_of_information !== undefined
      ? { value_of_information: gap.entry.value_of_information }
      : {}),
    ...(tipping.kind === 'one' && tipping.entry.risk !== undefined
      ? { tipping_point_risk: tipping.entry.risk }
      : {}),
  };

  return Object.keys(analysis).length > 0
    ? { link: 'linked', analysis }
    : { link: 'not_in_analysis' };
}

/**
 * Graph input shape accepted by the assembler. The assembler treats graph
 * content as opaque passthrough (F.6): it only reads `kind` on nodes to
 * derive goals, and never introspects edges/options beyond forwarding them
 * into the ContextPack. Accept any shape that carries the minimal wire
 * fields — both `GraphV3T` (full Zod-validated shape) and `GraphStateIngress`
 * (permissive Phase 1.5 boundary shape) are structurally compatible.
 */
export interface GraphWithOptions {
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly kind?: unknown; readonly label?: unknown; readonly [k: string]: unknown }>;
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string; readonly [k: string]: unknown }>;
  readonly options?: readonly unknown[];
  readonly goal_node_id?: string;
  readonly goal_constraints?: readonly unknown[];
}

const EMPTY_GRAPH: ContextPackGraph = Object.freeze({
  nodes: Object.freeze([]),
  edges: Object.freeze([]),
  options: Object.freeze([]),
  goals: Object.freeze([]),
  constraints: Object.freeze([]),
  counts: Object.freeze({ nodes: 0, edges: 0, options: 0, goals: 0, constraints: 0 }),
}) as ContextPackGraph;

export interface AssembleContextPackResult {
  readonly contextPack: ContextPack;
  readonly cqeSummary: CqeExtractionSummary;
}

export function assembleContextPack(input: AssembleContextPackInput): ContextPack {
  return assembleContextPackWithSummary(input).contextPack;
}

/**
 * Lane 28 — brief pipeline: project the persisted decision brief into the
 * ContextPack shape.
 *
 * Rules (mirrors the write-side `normaliseBriefText` discipline — trim first,
 * bound second, disclose always):
 *   - null / undefined / whitespace-only → null (no brief persisted; the
 *     assembler then OMITS the `brief` key from the pack entirely — a null
 *     is never serialised into the routing prompt).
 *   - trimmed length ≤ {@link CONTEXT_PACK_BRIEF_CHAR_CAP} → verbatim
 *     (trimmed) text, `truncated: false`.
 *   - trimmed length >  cap → hard slice at the cap, `truncated: true`,
 *     with `original_chars` carrying the full trimmed length — DISCLOSED
 *     truncation, never a silent slice (contrast `CONVERSATION_TEXT_CAP`'s
 *     documented hard-slice in commit.ts, which this deliberately does not
 *     repeat).
 *
 * Pure and total; exported for direct unit coverage.
 */
export function projectBrief(
  briefText: string | null | undefined,
): ContextPackBrief | null {
  if (briefText == null) return null;
  const trimmed = briefText.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= CONTEXT_PACK_BRIEF_CHAR_CAP) {
    return { text: trimmed, truncated: false, original_chars: trimmed.length };
  }
  // Context v2 S0: the slice was already DISCLOSED in-pack (truncated +
  // original_chars); it now also lands on the truncation telemetry stream.
  emitContextTruncation({
    site: 'context-pack-assembler.projectBrief',
    section: 'brief',
    original_chars: trimmed.length,
    kept_chars: CONTEXT_PACK_BRIEF_CHAR_CAP,
    strategy: 'hard_slice',
    disclosed: true,
  });
  return {
    text: trimmed.slice(0, CONTEXT_PACK_BRIEF_CHAR_CAP),
    truncated: true,
    original_chars: trimmed.length,
  };
}

/**
 * Derive the redacted canonical analysis-state summary for the ContextPack.
 *
 * Source order:
 *   1. `input.canonicalState` (M5 — authoritative, threaded by the dispatch
 *      path which has the raw graph + freshness).
 *   2. Best-effort from `input.priorFacts` + a freshness hash of the turn
 *      graph — ONLY when a raw graph is available here. The production
 *      compacted-graph path passes `graph: undefined`; hashing a compacted
 *      projection would not match `graph_hash_at_run`, so we return null
 *      rather than emit a misleadingly-stale verdict. The authoritative
 *      verdict ships on the wire via the route's redacted context-summary
 *      surface.
 *
 * Critical-omission diagnostic: when `priorFacts` is absent entirely, emit a
 * structured warning rather than silently returning an authoritative-looking
 * 'none' — production callers (turn-executor) always thread facts.
 */
function deriveContextPackAnalysisState(
  input: AssembleContextPackInput,
): AnalysisStateSummary | null {
  if (input.canonicalState) {
    return summariseCanonicalAnalysisState(input.canonicalState);
  }
  if (input.priorFacts === undefined) {
    log.warn(
      {
        event: 'context_pack.canonical_state_facts_absent',
        scenario_id: input.payload.scenario_id,
      },
      'ContextPack assembled without prior_facts — canonical analysis_state omitted',
    );
    return null;
  }
  // Only the RAW (non-compacted) graph yields a freshness-comparable hash.
  const rawGraph = input.graph ?? null;
  if (rawGraph === null) return null;
  const currentGraphHash = computeAnalysisAffectingGraphHash(
    rawGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  const canonical = selectCanonicalAnalysisState({
    priorFacts: input.priorFacts,
    currentGraphHash,
    // Option-identity guard (CEE_OPTION_IDENTITY_FRESHNESS_GUARD): keep the
    // diagnostic / coaching-pack canonical state consistent with the wire
    // verdict. Same raw graph the hash is derived from. undefined when off.
    currentGraphOptionIds: config.cee.optionIdentityFreshnessGuard
      ? extractGraphOptionIds(rawGraph)
      : undefined,
    scenarioClaimsAnalysis: input.analysis != null,
    // CONTEXT/MEMORY V5 defect 4 — the pack's canonical state is LLM-facing
    // and diagnostic-facing. A thrown prior-fact read arrives here as `[]`,
    // which is indistinguishable from "never analysed" without this flag.
    ...(input.priorFactsReadOk === undefined
      ? {}
      : { priorFactsReadOk: input.priorFactsReadOk }),
  });
  return summariseCanonicalAnalysisState(canonical);
}

export function assembleContextPackWithSummary(
  input: AssembleContextPackInput,
): AssembleContextPackResult {
  const compound = detectCompound(input.payload.message);
  const extraction = runExtraction(input.payload.message);
  // O-3 — context-size budget (graceful degradation). Applied BEFORE
  // projection so both the handler-facing slots and the LLM-facing
  // display projections are built from the budgeted objects. Under
  // budget this returns the inputs by reference (byte-identity, pinned
  // by test); over budget it degrades per the budget module's own
  // policy and returns the `context_budget` disclosure stamped onto the
  // pack below. The conversation window is NOT budgeted here (O-2's
  // surface). The raw-graph fallback path (`input.graph`) is outside
  // the budget module's compact-shape domain and passes through
  // unbudgeted, as before.
  const budgeted = applyContextBudgetToAssemblyInputs({
    compactedGraph: input.compactedGraph ?? null,
    analysis: input.analysis ?? null,
    scenarioId: input.payload.scenario_id ?? null,
  });
  // Compute the raw analysis projection ONCE — it is shared between the
  // handler-facing `analysis` slot and the LLM-facing `display_analysis`
  // wrapper. Calling projectAnalysis twice would double-emit
  // analysis_projection_invalid_probability telemetry on bad inputs.
  const rawAnalysis = projectAnalysis(
    budgeted.analysis,
    input.analysisStalenessReason ?? null,
    input.interventionControlledFactorIds,
  );
  const projectedGraph: ContextPackGraph = budgeted.compactedGraph
    ? projectCompactGraph(budgeted.compactedGraph, input.compactedConstraints ?? null)
    : projectGraph(input.graph ?? null);
  const analysisStateSummary = deriveContextPackAnalysisState(input);
  // Lane 28 — the persisted decision brief (size-bounded, disclosed
  // truncation). Projected once; when no brief exists the key is OMITTED
  // entirely (never `brief: null`) so no-brief packs serialise no `brief`
  // field into the routing prompt — prompt hygiene: don't make the LLM read
  // a null. When present it is placed early in the literal so the serialised
  // prompt surfaces "what this decision is about" before the graph/analysis
  // detail.
  const projectedBrief = projectBrief(input.brief);
  // #536 marker extension (O-2 activation): when a summary section is
  // injected, the "N of M turns included" window marker additionally says
  // how many of the not-shown turns arrive as the summary (`summarised`).
  // The count comes from the loader (the only component that knows whether
  // the block is a real four-slot summary, a floor, or a withheld refusal
  // — the latter two stamp an honest 0). No section ⇒ marker unchanged ⇒
  // byte-identity with pre-S4 packs.
  const projectedConversation = projectConversation(
    input.priorTurns,
    input.pendingConfirmation ?? false,
    input.priorTurnsTotal,
  );
  const conversation =
    input.conversationSummary !== undefined &&
    input.summarisedTurns != null &&
    projectedConversation.window !== undefined
      ? {
          ...projectedConversation,
          window: { ...projectedConversation.window, summarised: input.summarisedTurns },
        }
      : projectedConversation;
  // Hoisted out of the literal below (it was inline) so the hop-4 focus
  // projection can join against the SAME display-safe values the model
  // receives. One computation, one authority — a second call here would be a
  // second place formatting the same numbers.
  const displayAnalysis = formatAnalysisForContext(rawAnalysis, {
    analysisFreshness: input.coachingContext?.freshness,
  });
  // Selection-aware answering (hop 4). `buildTurnContext` already resolved the
  // selection against canonical state; this only PLACES it.
  // The identity index is built from the UPSTREAM analysis, where `option_id`
  // and `factor_id` still exist — `projectAnalysis` strips both on the way into
  // `rawAnalysis`, so reading them here is what keeps the focus join an
  // IDENTITY join rather than a label join.
  const projectedFocus = projectFocus(
    input.selection,
    displayAnalysis,
    buildAnalysisIdentityIndex(input.analysis),
    // One authority for analysis currency: the turn-executor projects this
    // boolean from the canonical analysis selector, where `usable_for_chips`
    // requires fresh analysis and rejects blockers/contradictions. Absence is
    // fail-closed. This prevents a current selected node from inheriting values
    // from a stale prior run merely because its id/label still exists.
    input.coachingContext?.usable_for_chips === true,
  );

  const base: ContextPack = {
    version: CONTEXT_PACK_VERSION,
    scenario_id: input.payload.scenario_id,
    stage: input.payload.stage,
    ...(projectedBrief !== null ? { brief: projectedBrief } : {}),
    graph: projectedGraph,
    analysis: rawAnalysis,
    // Display-safe analysis projection — what Sonnet actually sees.
    // Sources structured fragile-edge labels off the raw projection
    // (no longer needs the upstream summary as a second argument).
    // AMENDMENT A1(a) — thread the live freshness verdict so the flip-point
    // display licence can fail closed on a stale turn, where compose ships NO
    // review cards and the digits are therefore on no screen.
    // No `?? null` default here, deliberately: the option is optional and the
    // formatter treats undefined and null IDENTICALLY (both fail closed), so a
    // coalescing default would add a science-field fallback the
    // forbidden-boundary gate rightly flags, while changing nothing.
    display_analysis: displayAnalysis,
    // Display-safe graph projection — what Sonnet actually sees in
    // place of the raw graph. Edge `strength` floats become decision-
    // language `relationship` phrases; `exists` and `plain_interpretation`
    // are dropped; node numeric fields stripped. Raw `graph` above is
    // unchanged for handlers, freshness hashing, telemetry.
    display_graph: formatGraphForContext(projectedGraph),
    // Selection-aware answering (hop 4). Placed with the HARD STRUCTURED STATE,
    // above `conversation`, so the model reads the user's focus as part of the
    // model rather than as conversational colour. ⚠ In the SERIALISED prompt
    // this is NOT adjacent to the graph — buildUserMessage re-appends
    // graph/analysis at the END (see the ContextPack.focus docblock).
    // Conditional spread — key ABSENT when the turn carried no
    // selection, so a no-selection pack serialises byte-identically to pre-hop-4
    // (pinned by a sha256 golden captured at the pre-change tip).
    //
    // The analysis join reads the SAME display-safe projection the model
    // receives, so `focus` can never show a number that disagrees with the
    // `analysis` section beside it.
    ...(projectedFocus !== null ? { focus: projectedFocus } : {}),
    conversation,
    // Context v2 S4-INJECT: placed adjacent to `conversation` (01 §2).
    // Conditional spread — when the caller supplies nothing the key is
    // ABSENT (never null/undefined-valued), preserving off/maintain
    // byte-identity of the serialised pack.
    ...(input.conversationSummary !== undefined
      ? { conversation_summary: input.conversationSummary }
      : {}),
    recent_changes: projectRecentChanges(input.priorFacts),
    // Knowledge-over-time (P6): the decision-records read slice. Placed with the
    // hard structured state (above the rolling summary, which buildUserMessage
    // re-appends LAST) so durable prior DECISIONS beat the summary. Conditional
    // spread — key ABSENT when the loader supplied nothing (no records / read
    // failed) so record-less scenarios serialise byte-identically to pre-P6.
    ...(input.olderRelevantFacts !== undefined
      ? { older_relevant_facts: input.olderRelevantFacts }
      : {}),
    coaching: input.coaching ?? EMPTY_COACHING_CACHE,
    compound_detected: compound.detected,
    compound_pattern_matched: compound.telemetry.pattern_matched,
    parsed_quantities: extraction.results,
    system_event: input.systemEvent ?? null,
    analysis_state: analysisStateSummary,
    // O-3 — in-band budget disclosure. Key ABSENT when nothing was
    // trimmed (never `context_budget: null`), so under-budget packs stay
    // byte-identical; when present the LLM sees the reduction via
    // buildUserMessage's `...rest` spread (#536 marker pattern).
    ...(budgeted.disclosure !== null
      ? { context_budget: budgeted.disclosure }
      : {}),
  };
  const withSegments =
    compound.detected && compound.segments
      ? { ...base, compound_segments: compound.segments }
      : base;
  // Coaching Context Pack v1: additive, flag-gated. When the caller supplies
  // the pack (flag on), surface it verbatim; otherwise the field is absent so
  // the assembled pack is byte-identical to today (flag-off byte-identity).
  const assembled: ContextPack = input.coachingContext
    ? { ...withSegments, coaching_context: input.coachingContext }
    : withSegments;
  // Context/Memory V5 defect 3 — the WHOLE-PACK ceiling, enforced. Runs on the
  // finished pack (every section placed, every conditional key resolved), so
  // the number it measures is the pack that ships, not a proxy for it. Under
  // budget it returns the SAME object by reference: no cut, no key, no event,
  // byte-identity preserved (pinned by the O-3 golden).
  const contextPack = enforceContextPackCeiling({
    pack: assembled,
    priorTurnsTotalKnown: isKnownPriorTurnsTotal(input.priorTurnsTotal),
    scenarioId: input.payload.scenario_id ?? null,
  });
  // Non-production contract gate. Production assembly path stays cost-free
  // — `safeParse` is only invoked when `isProduction()` is false, so live
  // traffic pays the price of a single config read and nothing more. See
  // `context-pack-schema.ts` header for the schema's role and constraints.
  //
  // Behaviour ladder:
  //   - test       → throw (CI catches drift loudly, no risk of silent ship)
  //   - everything else non-prod → log.warn (developer-visible, non-fatal)
  //   - production → no parse, no log (dead code under prod)
  //
  // Error format (developer-safe — structural-only):
  //   `[ContextPack validation] <field path>: <zod message>`
  // Capped at five issues; carries no field values, no graph/analysis
  // payload, no conversation/user text.
  //
  // Env predicates come from `src/config/index.ts` (the centralised, Zod-
  // validated config) rather than direct `process.env` reads — keeps
  // dispatch consistent with the rest of the service and matches the
  // `no-restricted-syntax` lint policy.
  if (!isProduction()) {
    const parsed = ContextPackSchema.safeParse(contextPack);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .slice(0, 5)
        .map(
          (i) =>
            `[ContextPack validation] ${i.path.join('.') || '<root>'}: ${i.message}`,
        );
      if (isTest()) {
        throw new Error(issues.join('\n'));
      }
      log.warn(
        { event: 'context_pack_schema_drift', issues },
        'ContextPack failed schema validation',
      );
    }
  }
  return { contextPack, cqeSummary: extraction.summary };
}

/**
 * Project a compacted graph (output of `compactGraphForContextPack`) into
 * the ContextPackGraph shape. Options / goals are derived from the compact
 * nodes by kind; constraints are passed through from the caller (the
 * compactor itself drops `goal_constraints`, so they must be threaded here
 * explicitly or Sonnet loses them on every turn).
 *
 * The returned object uses the compact shapes for nodes and edges — callers
 * that typed these as `readonly unknown[]` consume them unchanged. Downstream
 * uses (turn-executor routing-log counts, JSON serialisation to Sonnet) are
 * both shape-agnostic.
 */
function projectCompactGraph(
  compact: GraphV3Compact,
  constraints: readonly unknown[] | null,
): ContextPackGraph {
  const options = compact.nodes
    .filter((n) => n.kind === 'option')
    .map((n) => ({ id: n.id, label: n.label }));
  const goals = compact.nodes.filter((n) => n.kind === 'goal');
  const safeConstraints = constraints ?? [];
  return {
    nodes: compact.nodes,
    edges: compact.edges,
    options,
    goals,
    constraints: safeConstraints,
    counts: {
      nodes: compact.nodes.length,
      edges: compact.edges.length,
      options: options.length,
      goals: goals.length,
      constraints: safeConstraints.length,
    },
  };
}

function projectGraph(graph: GraphWithOptions | null): ContextPackGraph {
  if (graph === null) return EMPTY_GRAPH;

  const nodes = graph.nodes;
  const edges = graph.edges;
  const options = graph.options ?? nodes
    .filter((node) => node.kind === 'option')
    .map((node) => ({ id: node.id, label: typeof node.label === 'string' ? node.label : null }));
  const goals = nodes.filter((n) => (n as { kind?: string }).kind === 'goal');
  const constraints = graph.goal_constraints ?? [];

  return {
    nodes,
    edges,
    options,
    goals,
    constraints,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      options: options.length,
      goals: goals.length,
      constraints: constraints.length,
    },
  };
}

/**
 * Probability scale guard. Returns true when `value` is a finite number in
 * [0, 1]. On violation, emits a telemetry event the caller can correlate
 * with the offending option/scenario; the caller is expected to *exclude*
 * the offending option from the projection (do not throw — Sonnet should
 * still see the rest of the analysis).
 */
function isProbabilityValid(
  value: unknown,
  context: { call_site: string; option_label?: string | null; option_id?: string | null },
): value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    // PII rule (14-Jul ruling): option labels are user decision content
    // and option ids are label-derived slugs; the raw `value` is analysis
    // output. The log carries a correlation digest of the id plus a
    // bounded violation enum only — never the label or the raw value.
    const violation =
      typeof value !== 'number'
        ? 'not_a_number'
        : !Number.isFinite(value)
          ? 'not_finite'
          : 'out_of_range';
    log.warn(
      {
        event: 'analysis_projection_invalid_probability',
        call_site: context.call_site,
        option_id_digest:
          context.option_id != null ? sha8(context.option_id) : null,
        violation,
      },
      'context-pack-assembler: dropping option with invalid win_probability',
    );
    return false;
  }
  return true;
}

const TOP_DRIVER_CAP = 3;

/**
 * Lane 21 (P0-A): the ROUTED ContextPack projection carries up to five
 * drivers — parity with the top-5 derivation in `compactAnalysis` and the
 * five factors the UI renders. The chip-click dispatch keeps the legacy
 * default cap of {@link TOP_DRIVER_CAP}; ordering/sign logic is shared via
 * `projectTopDrivers` so only the breadth differs.
 */
export const CONTEXT_PACK_TOP_DRIVER_CAP = 5;

/**
 * Lane 21 (P0-A): bound on the widened all-options projection so a
 * degenerate many-option graph cannot blow the prompt budget. Realistic
 * graphs carry ≤ 8 options; options beyond the cap are truncated at the
 * slice below (no overflow disclosure reaches the formatter today).
 */
export const MAX_PROJECTED_OPTIONS = 12;

/**
 * P0b-1 — source-only fragile-edge lever suppression, shared by `projectAnalysis`
 * (routed path) and the chip-click dispatch so the two re-projection sites cannot
 * drift (mirrors how `projectTopDrivers` is shared).
 *
 * An option-controlled lever as an edge SOURCE ("lever → X") would imply the user
 * can validate / test / act on a tunable driver — the unsafe claim — so it is
 * suppressed. A lever as edge TARGET ("X → lever") describes something acting ON
 * the lever, not tuning it, so it is preserved (mirrors PLoT Lane A1c
 * `isLeverSourcedEdge`).
 *
 * Authority is STRUCTURAL `from_id` membership ONLY — never the label (labels
 * collide; #308). FAIL-CLOSED: an edge with no resolvable `from_id` cannot be
 * proven non-lever, so when any lever exists it is dropped rather than risk a
 * silent bypass on the fallback path this guard protects. `from_id` is populated
 * fresh at derivation time on every path (per-option and top-level/fallback), so
 * the fail-closed branch only fires for malformed/label-only raw input. Producer
 * values are never mutated — a suppressed edge is simply not surfaced. Empty
 * controlled set ⇒ no-op.
 */
export function filterLeverSourcedFragileEdges<E extends { from_id?: string; from_label: string }>(
  edges: readonly E[],
  controlledFactorIds?: ReadonlySet<string>,
): E[] {
  if (controlledFactorIds === undefined || controlledFactorIds.size === 0) {
    return edges.slice();
  }
  return edges.filter((e) => {
    const fromId = typeof e.from_id === 'string' ? e.from_id.trim() : '';
    if (fromId.length === 0) return false; // fail-closed — see doc
    return !controlledFactorIds.has(fromId);
  });
}

/**
 * Lane 30 (#369 audit P1) — factor-keyed lever suppression for the tipping
 * (`flip_thresholds`, section 5) and evidence-gap (`evidence_gaps`, section
 * 7) projections. Before this lane, `projectAnalysis` filtered top_drivers
 * and fragile_edges by the intervention-controlled set but NOT these two
 * sections — an option-controlled lever excluded from the driver list could
 * still surface as a tipping point ("a small decrease in X could flip the
 * result") or an evidence gap ("gather data on X"), both of which imply the
 * user can independently tune / validate the lever. Same doctrine as
 * {@link filterLeverSourcedFragileEdges}:
 *
 *   - authority is STRUCTURAL `factor_id` membership ONLY — never the label
 *     (labels collide; #308);
 *   - FAIL-CLOSED: when any lever exists, an entry with no resolvable
 *     `factor_id` cannot be proven non-lever and is dropped;
 *   - empty / absent controlled set ⇒ no-op (fail-safe);
 *   - producer values are never mutated — a suppressed entry is simply not
 *     surfaced.
 *
 * A fired suppression is logged under the EXISTING
 * `v5.intervention_controlled_driver_suppressed` event (frozen telemetry
 * registry — no new event names) with a section-specific `source`.
 */
export function filterLeverControlledFactorEntries<
  E extends { factor_id?: string | null; factor_label: string },
>(
  entries: readonly E[],
  controlledFactorIds: ReadonlySet<string> | undefined,
  source: string,
): E[] {
  if (controlledFactorIds === undefined || controlledFactorIds.size === 0) {
    return entries.slice();
  }
  const kept: E[] = [];
  const suppressedIds: string[] = [];
  for (const entry of entries) {
    const id = typeof entry.factor_id === 'string' ? entry.factor_id.trim() : '';
    if (id.length === 0) {
      // Fail-closed: unattributable entry while levers exist.
      suppressedIds.push('<no_factor_id>');
      continue;
    }
    if (controlledFactorIds.has(id)) {
      suppressedIds.push(id);
      continue;
    }
    kept.push(entry);
  }
  if (suppressedIds.length > 0) {
    // EVIDENCE THE PRODUCER FIX (Science/PLoT Lane A1) IS STILL REQUIRED —
    // never a sign it is closed. factor_ids are internal identifiers (not
    // user-facing prose), safe to log.
    log.warn(
      {
        event: 'v5.intervention_controlled_driver_suppressed',
        source,
        suppressed_count: suppressedIds.length,
        suppressed_factor_ids: suppressedIds,
        producer_fix_required: true,
      },
      'V5 Lane 30: suppressed option-controlled lever from analysis projection (producer fix still required)',
    );
  }
  return kept;
}

/**
 * Project `DriverSummary[]` into the display-safe ContextPack driver shape —
 * the single rule shared by `projectAnalysis` (routed path) and the chip-click
 * dispatch so the two sign-reattachment sites cannot drift:
 *   1. drop non-finite magnitudes;
 *   2. re-attach the sign via `toSignedInfluenceValue` (`neutral` → 0);
 *   3. sort by absolute signed value, descending;
 *   4. cap at `cap` (default `TOP_DRIVER_CAP`; the routed ContextPack path
 *      passes `CONTEXT_PACK_TOP_DRIVER_CAP` — Lane 21 breadth widening).
 * Because the sort runs AFTER `neutral` is zeroed, a no-effect driver is always
 * demoted (and usually capped out) in both paths — it can never lead a "would
 * shift the most" claim on one path while being demoted on the other.
 */
export function projectTopDrivers(
  drivers: readonly DriverSummary[],
  controlledFactorIds?: ReadonlySet<string>,
  cap: number = TOP_DRIVER_CAP,
): ContextPackAnalysisDriver[] {
  // Spine A backstop: drop any driver whose factor is option-controlled BEFORE
  // the projection strips `factor_id` (the structural match key). Authority is
  // structural `factor_id` membership only — never the label. Producer values
  // are not touched; the driver is simply not surfaced as tunable.
  let source: readonly DriverSummary[] = drivers;
  if (controlledFactorIds !== undefined && controlledFactorIds.size > 0) {
    const { kept, suppressed } = partitionInterventionControlledDrivers(
      drivers,
      controlledFactorIds,
    );
    if (suppressed.length > 0) {
      // The backstop fired: an option-controlled lever was about to be surfaced
      // as a tunable driver. This is EVIDENCE THE PRODUCER FIX (Science/PLoT
      // Lane A1) IS STILL REQUIRED — never a sign it is closed. `factor_id`s are
      // internal identifiers (not user-facing prose), so they are safe to log.
      log.warn(
        {
          event: 'v5.intervention_controlled_driver_suppressed',
          source: 'projectTopDrivers',
          suppressed_count: suppressed.length,
          suppressed_factor_ids: suppressed.map((d) => d.factor_id),
          producer_fix_required: true,
        },
        'V5 Spine A: suppressed option-controlled lever from tunable-driver projection (producer fix still required)',
      );
    }
    source = kept;
  }
  return source
    .filter((d) => isFiniteSensitivity(d.sensitivity))
    .map((d) => ({
      factor_label: d.factor_label,
      sensitivity_value: toSignedInfluenceValue(d.direction, d.sensitivity),
    }))
    .sort((a, b) => Math.abs(b.sensitivity_value) - Math.abs(a.sensitivity_value))
    .slice(0, cap);
}

/**
 * Map a per-option `FlipThreshold` (compactAnalysis derivation — always a
 * complete numeric pair) into the widened tipping-point projection shape.
 */
function tippingFromFlipThreshold(entry: FlipThreshold): ContextPackAnalysisFlipThreshold {
  return {
    factor_label: entry.factor_label,
    current_value: entry.current_value,
    flip_value: entry.flip_value,
    unit: entry.unit,
    no_flip_within_bounds: false,
  };
}

function tippingFromSignal(entry: TippingPointSignal): ContextPackAnalysisFlipThreshold {
  // ROADMAP 2.205 — carry the display licence through, both keys or neither.
  // `factor_id` is still stripped here (internal match key only); the licence
  // was already resolved against it upstream.
  const currentDisplay =
    typeof entry.current_display === 'string' && entry.current_display.length > 0
      ? entry.current_display
      : null;
  const flipDisplay =
    typeof entry.flip_display === 'string' && entry.flip_display.length > 0
      ? entry.flip_display
      : null;
  return {
    factor_label: entry.factor_label,
    current_value: entry.current_value,
    flip_value: entry.flip_value,
    unit: entry.unit,
    no_flip_within_bounds: entry.no_flip_within_bounds,
    ...(currentDisplay !== null && flipDisplay !== null
      ? { current_display: currentDisplay, flip_display: flipDisplay }
      : {}),
  };
}

/** Finite [0,1] check for goal-fit values (no telemetry — the derivation
 *  already guards; this is defence for hand-built signal inputs). */
function isValidGoalFitProbability(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Lane 30 — option-identity-keyed lookup over a per-option signal array.
 * Match authority: STRUCTURAL `option_id` first (labels are not identity —
 * the fallback path relabels options from the current graph); label matching
 * ONLY for signals that carried no id at all.
 */
function buildOptionSignalLookup<S extends { option_id: string | null; option_label: string }>(
  signals: readonly S[] | undefined,
  readValue: (signal: S) => number,
  isValid: (value: unknown) => value is number,
): (option: OptionSummary) => number | undefined {
  const byId = new Map<string, number>();
  const byLabelIdless = new Map<string, number>();
  for (const s of signals ?? []) {
    const value = readValue(s);
    if (!isValid(value)) continue;
    if (typeof s.option_id === 'string' && s.option_id.trim().length > 0) {
      if (!byId.has(s.option_id)) byId.set(s.option_id, value);
    } else if (typeof s.option_label === 'string' && s.option_label.trim().length > 0) {
      if (!byLabelIdless.has(s.option_label)) byLabelIdless.set(s.option_label, value);
    }
  }
  return (option: OptionSummary): number | undefined => {
    const viaId = byId.get(option.option_id);
    if (viaId !== undefined) return viaId;
    return byLabelIdless.get(option.option_label);
  };
}

/**
 * Lane 30 — per-option goal-fit resolver: the option's own
 * `probability_of_goal` wins when a producer path populates it (that field
 * is only ever set from real data, never defaulted), then the
 * `option_goal_fits` signal lookup. Returns undefined when no valid value
 * resolves — the projected option then omits `goal_fit_probability` and the
 * display formatter renders the explicit "target-fit not scored" disclosure
 * instead.
 */
function buildGoalFitResolver(
  signals: readonly OptionGoalFitSignal[] | undefined,
): (option: OptionSummary) => number | undefined {
  const lookup = buildOptionSignalLookup(
    signals,
    (s) => s.probability_of_joint_goal,
    isValidGoalFitProbability,
  );
  return (option: OptionSummary): number | undefined => {
    if (isValidGoalFitProbability(option.probability_of_goal)) {
      return option.probability_of_goal;
    }
    return lookup(option);
  };
}

/** Finite check for outcome means (any sign, any magnitude). */
function isFiniteOutcomeMean(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Lane 30 fix 3 — per-option outcome-mean resolver. SIGNALS ONLY: the
 * `OptionSummary.outcome_mean` field is deliberately never read because its
 * upstream default of 0 is indistinguishable from an honest zero (banding a
 * fabricated 0 as "roughly neutral" would be a false claim).
 */
function buildOutcomeResolver(
  signals: readonly OptionOutcomeSignal[] | undefined,
): (option: OptionSummary) => number | undefined {
  return buildOptionSignalLookup(signals, (s) => s.outcome_mean, isFiniteOutcomeMean);
}

export function projectAnalysis(
  analysis: AnalysisResponseSummaryWithSignals | null,
  stalenessReason: string | null,
  controlledFactorIds?: ReadonlySet<string>,
): ContextPackAnalysis | null {
  if (analysis === null) return null;

  // 1. Status gate FIRST: a FAILED / skipped option (per-option ISL status)
  //    must never surface as the leading or runner-up coaching option — the
  //    same rule the direct receipt (run-analysis.ts) and compactAnalysis
  //    apply, routed through the ONE shared isRecommendableOption predicate.
  //    `OptionSummary` now RETAINS `status` (it used to be dropped here, which
  //    is exactly why this projection could not previously gate on it). Absent
  //    status stays recommendable, so status-less inputs are unaffected.
  //    Then the probability scale guard, then sort desc. F.6 passthrough: we
  //    only filter+sort; we do not transform values.
  const validOptions: OptionSummary[] = analysis.options
    .filter(isRecommendableTypedOption)
    .filter((o) =>
      isProbabilityValid(o.win_probability, {
        call_site: 'projectAnalysis.options',
        option_label: o.option_label,
        option_id: o.option_id,
      }),
    )
    .slice()
    .sort((a, b) => b.win_probability - a.win_probability);

  const leadingSrc = validOptions[0];
  const runnerUpSrc = validOptions[1];

  // Lane 30 — per-option goal-fit + outcome carriage. Resolvers shared by
  // the leading pair and the full option list so the same option can never
  // show a value in one slot and not the other.
  const goalFitFor = buildGoalFitResolver(analysis.option_goal_fits);
  const outcomeFor = buildOutcomeResolver(analysis.option_outcomes);
  // Trust-spine board #1 (CEE half, adversarial-review P1): the upstream
  // compactAnalysis winner flag was previously field-picked away here, so the
  // coach egress never carried it. Thread it through: the flagged winner's
  // structural option_id (never the label — labels collide) marks the same
  // option wherever it appears (leading_option AND the ranked options list —
  // the same option must never show the flag in one slot and not the other).
  // No config re-check here: the upstream field is only ever set when
  // CEE_CONSTRAINT_INFEASIBLE_GATE is ON, so flag-off packs carry no key and
  // stay byte-identical (key-absence doctrine).
  const flaggedInfeasibleWinnerId =
    analysis.winner.constraint_infeasible === true && analysis.winner.option_id.length > 0
      ? analysis.winner.option_id
      : null;
  const projectOption = (o: OptionSummary): ContextPackAnalysisOption => {
    const goalFit = goalFitFor(o);
    const outcomeMean = outcomeFor(o);
    return {
      label: o.option_label,
      probability: o.win_probability,
      ...(goalFit !== undefined ? { goal_fit_probability: goalFit } : {}),
      ...(outcomeMean !== undefined ? { outcome_mean: outcomeMean } : {}),
      ...(flaggedInfeasibleWinnerId !== null && o.option_id === flaggedInfeasibleWinnerId
        ? { constraint_infeasible: true as const }
        : {}),
    };
  };

  const leading: ContextPackAnalysisOption | null = leadingSrc
    ? projectOption(leadingSrc)
    : null;
  const runnerUp: ContextPackAnalysisOption | null = runnerUpSrc
    ? projectOption(runnerUpSrc)
    : null;

  // margin_pp is pre-computed upstream in compactAnalysis — passthrough.
  // When the upstream margin_pp is missing (legacy callers) or scale-guard
  // dropped one of the leading two options, fall through to null rather
  // than recompute here (F.6).
  const marginPp =
    leading && runnerUp ? analysis.margin_pp ?? null : null;

  // 2. Top drivers — shared with the chip-click dispatch via projectTopDrivers:
  //    filter non-finite, re-attach sign (neutral → 0), sort by |signed value|,
  //    cap. Keeping both reattachment sites on one helper prevents drift.
  //    Lane 21: the routed path carries up to five drivers (UI parity); the
  //    chip path keeps the legacy default cap.
  const topDrivers: ContextPackAnalysisDriver[] = projectTopDrivers(
    analysis.top_drivers,
    controlledFactorIds,
    CONTEXT_PACK_TOP_DRIVER_CAP,
  );

  // 3. Robustness band: null when source is unknown / empty; do not fabricate.
  const rawBand = analysis.robustness_level;
  const robustnessBand =
    typeof rawBand === 'string' && rawBand.trim().length > 0 && rawBand !== 'unknown'
      ? rawBand
      : null;

  // 4. Lane 21 breadth: every valid option (F.6 passthrough — filter + sort
  //    only, values untouched), bounded by MAX_PROJECTED_OPTIONS. Lane 30:
  //    each entry additionally carries its goal-fit value when one resolves.
  const allOptions: ContextPackAnalysisOption[] = validOptions
    .slice(0, MAX_PROJECTED_OPTIONS)
    .map(projectOption);

  // 5. Lane 21 tipping points: prefer the attached top-level staging signals
  //    (see analysis-signals.ts — the per-option derivation is structurally
  //    empty on staging); fall back to the per-option summary.flip_thresholds.
  //    Lane 30 (#369 audit P1): BOTH sources are filtered by the
  //    intervention-controlled set BEFORE factor_id is stripped — an
  //    option-controlled lever must not surface as a tipping point.
  const tippingSignals = analysis.tipping_points ?? [];
  const flipThresholds: ContextPackAnalysisFlipThreshold[] =
    tippingSignals.length > 0
      ? filterLeverControlledFactorEntries(
          tippingSignals,
          controlledFactorIds,
          'projectAnalysis.flip_thresholds',
        ).map(tippingFromSignal)
      : filterLeverControlledFactorEntries(
          analysis.flip_thresholds ?? [],
          controlledFactorIds,
          'projectAnalysis.flip_thresholds',
        ).map(tippingFromFlipThreshold);

  // 6. P0b-1: drop lever-SOURCED fragile edges before they reach the prose /
  //    validation surfaces (explain_results, explanation-fallback, advice gate —
  //    all read this same projection). Source-only; the output shape is unchanged
  //    ({from_label,to_label}), so the strict ContextPack schema is unaffected.
  const sourceFragile = analysis.top_fragile_edges ?? [];
  const filteredFragile = filterLeverSourcedFragileEdges(sourceFragile, controlledFactorIds);
  // Lane 21: uncapped count behind the capped list. FAIL-CLOSED under lever
  // suppression: once any edge is suppressed the producer's uncapped count can
  // no longer be attested (it may include other lever-sourced edges beyond the
  // capped list), so collapse to the filtered list length.
  const suppressionFired = filteredFragile.length < sourceFragile.length;
  const fragileEdgeCount = suppressionFired
    ? filteredFragile.length
    : Math.max(
        typeof analysis.fragile_edge_count === 'number' &&
          Number.isFinite(analysis.fragile_edge_count) &&
          analysis.fragile_edge_count >= 0
          ? analysis.fragile_edge_count
          : 0,
        filteredFragile.length,
      );

  // 7. Lane 21 signal passthrough — raw values; banding is the formatter's
  //    job. Lane 30 (#369 audit P1): filtered by the intervention-controlled
  //    set BEFORE factor_id is stripped — a lever must not surface as an
  //    evidence gap the user is invited to gather data on.
  const rawEvidenceGaps = analysis.evidence_gaps ?? [];
  const keptEvidenceGaps = filterLeverControlledFactorEntries(
    rawEvidenceGaps,
    controlledFactorIds,
    'projectAnalysis.evidence_gaps',
  );
  // ROADMAP 2.54 (b) — carry the suppression FACT (not a re-derivation) so
  // the display formatter can disclose an emptied VOI section honestly.
  const evidenceGapsLeverSuppressed = keptEvidenceGaps.length < rawEvidenceGaps.length;
  const evidenceGaps: ContextPackAnalysisEvidenceGap[] = keptEvidenceGaps
    .filter((g) => Number.isFinite(g.voi_score) && g.voi_score >= 0)
    .map((g) => ({ factor_label: g.factor_label, voi_score: g.voi_score }));
  const goalFit: ContextPackAnalysisGoalFit | null = analysis.goal_fit
    ? { scored: analysis.goal_fit.scored, basis: analysis.goal_fit.basis }
    : null;

  // Lane 30 fix 3 — ordinal confidence tier passthrough (string token; the
  // formatter renders prose). Null when the producer reported none.
  const confidenceTier =
    typeof analysis.confidence_tier === 'string' && analysis.confidence_tier.trim().length > 0
      ? analysis.confidence_tier
      : null;

  // stalenessReason is intentionally not threaded into the projection —
  // V5 state-trust removed it from the prompt-visible shape. Reading the
  // parameter here keeps the assembler's signature stable for callers
  // that still pass it (turn-executor's telemetry log fields), but the
  // value is dropped on the floor.
  void stalenessReason;
  return {
    status: analysis.analysis_status,
    leading_option: leading,
    runner_up: runnerUp,
    margin_pp: marginPp,
    robustness_band: robustnessBand,
    top_drivers: topDrivers,
    fragile_edges: filteredFragile.map((e) => ({
      from_label: e.from_label,
      to_label: e.to_label,
    })),
    options: allOptions,
    flip_thresholds: flipThresholds,
    fragile_edge_count: fragileEdgeCount,
    evidence_gaps: evidenceGaps,
    // ROADMAP 2.54 (b) — key absent (never `false`) when nothing was
    // suppressed.
    ...(evidenceGapsLeverSuppressed ? { evidence_gaps_lever_suppressed: true as const } : {}),
    goal_fit: goalFit,
    confidence_tier: confidenceTier,
    // Trust-spine board #1 (CEE half): the honest constraint note, verbatim
    // from compactAnalysis. Key absent when unset (flag off / feasible winner)
    // → byte-identical projection.
    ...(typeof analysis.constraint_infeasible_note === 'string' &&
    analysis.constraint_infeasible_note.length > 0
      ? { constraint_infeasible_note: analysis.constraint_infeasible_note }
      : {}),
  };
}

function isFiniteSensitivity(value: unknown): value is number {
  return typeof value === 'number' && !Number.isNaN(value) && value !== Infinity && value !== -Infinity;
}

/**
 * Exported so `dispatchEditGraph` (ROADMAP 1.33 — edit-lane conversation
 * starvation) can reuse the exact same 5-turn conversation-slice projection
 * the coaching/draft LLM path uses, rather than assembling a second,
 * divergent slice. The V4 edit-graph dispatch runs entirely outside
 * `assembleContextPackWithSummary`'s call site (see `turn-executor.ts`), so
 * it calls this directly against its own `loadRecentConversationTurns`
 * read; `pendingConfirmation` is irrelevant to that caller and is passed as
 * `false`.
 */
export function projectConversation(
  priorTurns: readonly SessionTurnWithContent[],
  pendingConfirmation: boolean,
  /**
   * The scenario's PRE-CAP turn total. `priorTurns` is a read window
   * (`SESSION_READ_WINDOW_TURNS`, default 20) — its length is the window's
   * size, never the conversation's. Omitted/`null` = unknown; the disclosure
   * then states the shortfall without a number rather than substituting the
   * window length, which is the falsehood this parameter removes.
   *
   * Optional so the edit-graph dispatch call site (which reads only
   * `recent_turns`) is unchanged.
   */
  totalStored?: number | null,
): ContextPackConversation {
  // Context v2 (02 §Disclosure fix 2): window + per-turn `truncated`
  // disclosure is now UNCONDITIONAL — the pack always tells the LLM how much
  // history exists beyond the window and which projected turns were sliced.
  // The pack is JSON.stringified into the routing prompt.

  // priorTurns arrives ordered by created_at DESC (most recent first) from
  // SessionStore.readRecent. We cap at five. `last_tool_used` is the most
  // recent handler invocation — scan the full prior_turns to find it even
  // when it falls outside the five-turn window.
  //
  // V5 Conversation Context Reliability: project the per-turn conversation
  // content (user_message / assistant_message) so the LLM sees the actual
  // words of recent turns, not content-free stubs. This flows into the prompt
  // automatically via route-with-tool-use's `JSON.stringify(contextPack)` —
  // no prompt-template change needed. Null stays null.
  const recent = priorTurns.slice(0, CONTEXT_PACK_RECENT_TURNS_CAP).map((turn) => {
    const projected: ContextPackConversation['recent_turns'][number] = {
      turn_id: turn.turn_id,
      turn_class: turn.turn_class,
      handler_id: turn.handler_id,
      created_at: turn.created_at,
      // `?? null`: content is optional on SessionTurnWithContent for fixture
      // assignability; the DB read path always sets a string|null, so this only
      // normalises legacy/test turns that omit the fields.
      user_message: turn.user_message ?? null,
      assistant_message: turn.assistant_message ?? null,
    };
    // Per-message disclosure (now unconditional): a message AT the
    // persistence cap was (in all real cases) hard-sliced by
    // commit.capConversationText — the original length is not persisted, so
    // at-cap is the only sound inference (a naturally-exactly-2,000-char
    // message false-positives; an actually-truncated one never
    // false-negatives). Key added only when at-cap — never a noisy
    // `truncated:false`.
    if (
      (projected.user_message?.length ?? 0) >= PERSISTED_MESSAGE_CAP ||
      (projected.assistant_message?.length ?? 0) >= PERSISTED_MESSAGE_CAP
    ) {
      return { ...projected, truncated: true as const };
    }
    return projected;
  });

  const lastTool = priorTurns.find((t) => t.turn_class === 'handler' && t.handler_id !== null);

  // Context v2 S0: the window slice becomes observable. Char accounting is
  // over the projected conversation CONTENT (user/assistant message text) —
  // the thing the LLM loses when a turn falls out of the window.
  // `disclosed` is now always true — the `{shown, available}` window
  // disclosure below renders unconditionally.
  if (priorTurns.length > CONTEXT_PACK_RECENT_TURNS_CAP) {
    const contentChars = (turns: readonly SessionTurnWithContent[]): number =>
      turns.reduce(
        (sum, t) => sum + (t.user_message?.length ?? 0) + (t.assistant_message?.length ?? 0),
        0,
      );
    emitContextTruncation({
      site: 'context-pack-assembler.projectConversation',
      section: 'conversation',
      original_chars: contentChars(priorTurns),
      kept_chars: contentChars(priorTurns.slice(0, CONTEXT_PACK_RECENT_TURNS_CAP)),
      strategy: 'window_slice',
      disclosed: true,
    });
  }

  // Window disclosure (02 §Disclosure fix 2, now unconditional): the LLM
  // learns how much history exists beyond the window, so "earlier in this
  // conversation" can be said honestly instead of hallucinating certainty.
  //
  // `available` and `turn_count` are the CONVERSATION's length, from the
  // store's pre-cap count. They used to be `priorTurns.length` — the READ
  // WINDOW's length — which made both numbers false past the window and made
  // them false CONSISTENTLY (shown + summarised summed to them exactly), so
  // no cross-field check could catch it. Live on build `f00b8ef`, a 78-turn
  // scenario produced "Total turn count on record for this conversation is
  // 20". Unknown total ⇒ fall back to the window length for the numbers but
  // NEVER let the disclosure claim it is the whole conversation.
  const totalKnown = isKnownPriorTurnsTotal(totalStored);
  // A total below the window length is incoherent (rows cannot vanish between
  // the two reads in a way that shrinks history) — most likely a stale or
  // wrong count. Take the larger: never report FEWER turns than are visibly
  // present in this very pack.
  const total = totalKnown ? Math.max(totalStored as number, priorTurns.length) : priorTurns.length;
  const notice = conversationWindowNotice({
    shown: recent.length,
    total,
    totalKnown,
    windowCapped: priorTurns.length > recent.length,
  });
  return {
    recent_turns: recent,
    turn_count: total,
    last_tool_used: lastTool?.handler_id ?? null,
    pending_confirmation: pendingConfirmation,
    window: {
      shown: recent.length,
      available: total,
      ...(notice !== null ? { notice } : {}),
    },
  };
}

/**
 * Is the scenario's pre-cap turn total KNOWN this turn?
 *
 * ONE authority, deliberately: `projectConversation` and the whole-pack
 * ceiling trim (`enforceContextPackCeiling`) must agree about this, because it
 * selects which of the two {@link conversationWindowNotice} sentences renders.
 * A second inline copy of the predicate at the trim site is exactly the
 * hand-maintained mirror that would let a trimmed window claim a total the
 * untrimmed window refused to claim.
 */
function isKnownPriorTurnsTotal(totalStored?: number | null): boolean {
  return typeof totalStored === 'number' && Number.isFinite(totalStored) && totalStored >= 0;
}

/**
 * The one in-band conversation-window disclosure, or `null` when this pack
 * genuinely shows the whole conversation.
 *
 * Code-owned and computed by the same call that computes `shown`/`available`,
 * so the sentence and the numbers cannot drift apart — the estate's
 * `HISTORY_CAP_DISCLOSURE` / decision-record `[INCOMPLETE …]` pattern, applied
 * to the cap that did not disclose. It states BOTH numbers for the same reason
 * the decision-record line does: a disclosure that only says "some turns are
 * not shown" still leaves the coach free to count the visible turns and assert
 * that as the total, which is the failure it replaces.
 */
function conversationWindowNotice(args: {
  readonly shown: number;
  readonly total: number;
  readonly totalKnown: boolean;
  readonly windowCapped: boolean;
}): string | null {
  const { shown, total, totalKnown, windowCapped } = args;
  if (!totalKnown) {
    // The count read failed. We still know history was cut whenever the read
    // window itself over-ran the projected slice — say so WITHOUT a number
    // rather than passing off the window length as the total.
    if (!windowCapped) return null;
    return (
      `[INCOMPLETE — the ${shown} most recent turns are shown above and earlier turns exist that ` +
      `are not shown. The true total could not be read this turn. Do not describe the turns above ` +
      `as the whole conversation, and do not state a total number of turns or exchanges.]`
    );
  }
  if (total <= shown) return null;
  const notShown = total - shown;
  return (
    `[INCOMPLETE — ${total} turns are on record for this conversation; the ${shown} most recent ` +
    `are shown above and ${notShown} earlier ${notShown === 1 ? 'one is' : 'ones are'} not shown. ` +
    `Do not describe the turns above as the whole conversation; if asked how many turns or ` +
    `exchanges are on record, the true total is ${total}.]`
  );
}

// ---------------------------------------------------------------------------
// Whole-pack ceiling enforcement (Context/Memory V5 defect 3)
// ---------------------------------------------------------------------------

/**
 * What a ceiling cutter needs to know that it cannot read off the pack.
 * Currently one fact: whether the scenario's pre-cap turn total was KNOWN this
 * turn, which selects which disclosure sentence renders. Derived from the SAME
 * predicate `projectConversation` used ({@link isKnownPriorTurnsTotal}), never
 * re-inferred here.
 */
interface CeilingCutContext {
  readonly priorTurnsTotalKnown: boolean;
}

/**
 * One ceiling-cuttable section. `cutOne` removes exactly ONE unit and returns
 * the new pack, or `null` when the section is at its floor / has nothing left
 * to give — which is how the pass terminates without a timeout or a step
 * counter.
 */
interface CeilingSectionCutter {
  /** Serialised size of the section, for the disclosure record. */
  readonly chars: (pack: ContextPack) => number;
  /** Item count (turn-pairs, records, …) for the disclosure record. */
  readonly records: (pack: ContextPack) => number;
  /** The `v5.context_truncation` strategy this cut reports. */
  readonly strategy: string;
  readonly cutOne: (pack: ContextPack, ctx: CeilingCutContext) => ContextPack | null;
}

/**
 * Remove the OLDEST retained turn-pair from the verbatim window and re-derive
 * the window disclosure.
 *
 * Three things make this honest rather than a silent drop:
 *   - `recent_turns` is newest-first (the store reads `created_at DESC`), so
 *     the oldest retained turn is the LAST element — the user keeps the turns
 *     the current question is most likely about;
 *   - `shown` is re-stamped and the notice is RE-RENDERED by
 *     {@link conversationWindowNotice}, the same builder that owns the
 *     untrimmed disclosure, so the sentence and the numbers cannot drift (a
 *     stale notice is explicitly dropped, never carried through the spread);
 *   - `available` / `turn_count` describe the CONVERSATION, not the window, so
 *     a trim must not move them.
 */
function cutOldestConversationTurnPair(
  pack: ContextPack,
  ctx: CeilingCutContext,
): ContextPack | null {
  const conversation = pack.conversation;
  const retained = conversation.recent_turns;
  if (retained.length <= CONTEXT_PACK_CEILING_MIN_RETAINED_TURNS) return null;
  const kept = retained.slice(0, retained.length - 1);
  const total = conversation.window?.available ?? conversation.turn_count;
  const notice = conversationWindowNotice({
    shown: kept.length,
    total,
    totalKnown: ctx.priorTurnsTotalKnown,
    // We have just removed turns this pack was holding, so history beyond the
    // window is a fact of THIS pack regardless of what the read window looked
    // like — the unknown-total sentence must still say turns are missing.
    windowCapped: true,
  });
  // Spread-and-replace rather than re-listing the window's fields: anything
  // else riding the window (e.g. the O-2 `summarised` count) survives a trim
  // without this function having to know about it. Only `notice` is dropped
  // first, because a stale sentence would outlive the numbers it describes.
  const { notice: _staleNotice, ...carried } = conversation.window ?? {
    shown: kept.length,
    available: total,
  };
  return {
    ...pack,
    conversation: {
      ...conversation,
      recent_turns: kept,
      window: {
        ...carried,
        shown: kept.length,
        available: total,
        ...(notice !== null ? { notice } : {}),
      },
    },
  };
}

/**
 * The cutter for every section named in {@link CONTEXT_PACK_CEILING_CUT_ORDER}.
 * Typed as a TOTAL record over that const, so adding a section to the order
 * fails to COMPILE until its cutter exists — the declared order and the
 * executed one cannot diverge (the defect shape
 * `DISPLAY_ANALYSIS_TRUNCATION_ORDER` has: a declared order sitting beside a
 * separately hand-written drops list).
 */
const CEILING_CUTTERS: Readonly<Record<ContextPackCeilingCutSection, CeilingSectionCutter>> = {
  conversation: {
    chars: (pack) => JSON.stringify(pack.conversation).length,
    records: (pack) => pack.conversation.recent_turns.length,
    strategy: 'window_slice',
    cutOne: cutOldestConversationTurnPair,
  },
};

interface CeilingCutRecord {
  readonly section: ContextPackCeilingCutSection;
  readonly strategy: string;
  readonly originalChars: number;
  readonly keptChars: number;
  readonly originalRecords: number;
  readonly keptRecords: number;
  /** The cut stopped because the section reached its floor, not because it fit. */
  readonly stoppedAtFloor: boolean;
}

/**
 * Enforce the coach_converse WHOLE-PACK char ceiling (Context/Memory V5
 * defect 3).
 *
 * Before this pass, `CONTEXT_POLICY.coach_converse.total_char_budget` was
 * REPORTED and never ENFORCED: `computeOverBudget` flagged a `'total'` overrun
 * on the `v5.context_budget` stream and nothing acted on it, while the only
 * cut machinery (`orchestrator/context/budget.ts`) is allocated 25% of a
 * 120,000-TOKEN budget for the graph and cannot fire below ~120,000 chars.
 *
 * Contract:
 *   - the budget is CONSUMED from the policy, never re-typed here;
 *   - UNDER budget the input pack is returned BY REFERENCE — no cut, no key,
 *     no event, byte-identity preserved (pinned by the O-3 golden);
 *   - over budget, sections are cut in {@link CONTEXT_PACK_CEILING_CUT_ORDER},
 *     one unit at a time, re-measuring after each, stopping the moment the
 *     pack fits;
 *   - a section that reaches its floor while the pack is STILL over budget
 *     stops there and says so (`floor_reached`) rather than stripping the pack
 *     to nothing — a pack whose non-conversation content alone blows the
 *     ceiling is the graph/analysis valve's problem, not this pass's;
 *   - never throws: a budgeting fault degrades to "pack unchanged", the same
 *     posture as `applyContextBudgetToAssemblyInputs`.
 *
 * ⚠ SCOPE, stated precisely: this bounds `JSON.stringify(pack).length`. The
 * `v5.context_budget` telemetry measures `buildUserMessage(pack, message)
 * .length` — the exact embedded prompt, which is LARGER (2-space indentation
 * plus the code-owned instruction blocks). A pack this pass judges to fit can
 * therefore still report a `'total'` overrun on that stream. The ceiling is
 * enforced on the PACK, not on the rendered prompt.
 */
export function enforceContextPackCeiling(args: {
  readonly pack: ContextPack;
  readonly priorTurnsTotalKnown: boolean;
  readonly scenarioId: string | null;
}): ContextPack {
  const { pack, scenarioId } = args;
  try {
    const budget = CONTEXT_POLICY.coach_converse.total_char_budget;
    if (budget === null) return pack;
    let chars = JSON.stringify(pack).length;
    if (chars <= budget) return pack;

    const charsBefore = chars;
    const ctx: CeilingCutContext = { priorTurnsTotalKnown: args.priorTurnsTotalKnown };
    let current = pack;
    const cuts: CeilingCutRecord[] = [];

    for (const section of CONTEXT_PACK_CEILING_CUT_ORDER) {
      if (chars <= budget) break;
      const cutter = CEILING_CUTTERS[section];
      const originalChars = cutter.chars(current);
      const originalRecords = cutter.records(current);
      let stoppedAtFloor = false;
      while (chars > budget) {
        const next = cutter.cutOne(current, ctx);
        if (next === null) {
          stoppedAtFloor = true;
          break;
        }
        // Progress guard: `cutOne` must STRICTLY shrink its section, so this
        // loop is bounded by the section's item count. A cutter that returned
        // a same-sized pack would otherwise spin forever — the one failure
        // mode a re-measuring loop can have.
        if (cutter.records(next) >= cutter.records(current)) {
          stoppedAtFloor = true;
          break;
        }
        current = next;
        chars = JSON.stringify(current).length;
      }
      if (cutter.records(current) < originalRecords) {
        cuts.push({
          section,
          strategy: cutter.strategy,
          originalChars,
          keptChars: cutter.chars(current),
          originalRecords,
          keptRecords: cutter.records(current),
          stoppedAtFloor,
        });
      }
    }

    // Nothing could be cut (every section already at its floor): return the
    // ORIGINAL reference and claim no truncation. An event asserting a cut
    // that did not happen is the fabrication class, not a diagnostic.
    if (cuts.length === 0) return pack;

    for (const cut of cuts) {
      emitContextTruncation({
        site: 'context-pack-assembler.enforceContextPackCeiling',
        section: cut.section,
        original_chars: cut.originalChars,
        kept_chars: cut.keptChars,
        original_records: cut.originalRecords,
        kept_records: cut.keptRecords,
        strategy: cut.strategy,
        // The re-stamped `window.shown` + re-rendered notice ARE the in-band
        // disclosure — the LLM reads them in the serialised pack.
        disclosed: true,
        scenario_id: scenarioId,
        pack_total_chars_before: charsBefore,
        pack_total_chars_after: chars,
        pack_total_budget: budget,
        // Only true when the pass ran out of room AND the pack still does not
        // fit — the honest "this could not be made to fit" signal.
        ...(cut.stoppedAtFloor && chars > budget ? { floor_reached: true as const } : {}),
      });
    }
    return current;
  } catch (err) {
    log.warn(
      { err: err instanceof Error ? err.message : String(err) },
      'context-pack ceiling: enforcement failed — assembling the unbounded pack (turn must not fail)',
    );
    return pack;
  }
}
