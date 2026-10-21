/**
 * The model-facing context-pack TYPES that live code still reads (chip
 * generator, coaching signals, withheld-leader projection, the context
 * formatters, projection summaries).
 *
 * Moved verbatim from the retired `context-pack-assembler.ts` (deletion 8,
 * 22 Oct 2026): the assembler is gone, these shapes are not.
 */

import type { InvestigationPriorityLicence } from '../coaching/investigation-priority.js';
import type { FactorInvestigationVerdict } from './factor-investigation-licence.js';

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
   * option meets the user's target, the option's own `probability_of_goal`
   * ONLY — never the limits-only `probability_of_joint_goal` (AIQ
   * 5887531086). RAW [0,1] float — handler-facing only; the display formatter
   * renders it as an integer-percent `target_fit` string, clearly
   * distinguished from `win_probability`. Absent when the run gave no
   * P(goal) for this option (absent stays absent).
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
  /**
   * The producer's own verdict on whether this factor is worth RESOLVING —
   * see `./factor-investigation-licence.ts`. Joined on the structural
   * `factor_id` before this projection strips it.
   *
   * ⚠ A DIFFERENT QUESTION FROM `sensitivity_value` (trap #21). Sensitivity
   * says how much this factor moves the outcome; this says whether there is
   * any measured gain in the user going and pinning it down. The witnessed
   * live harm was a factor with `sensitivity_score: -0.35` and
   * `value_of_information: 0` — it mattered a great deal AND was worthless to
   * investigate, and with only the first field projected the model could not
   * possibly know the second.
   *
   * Key absent when the producer said nothing (older producer) or scored a
   * real value of information — both keep today's behaviour exactly.
   */
  readonly investigation_verdict?: FactorInvestigationVerdict;
  /**
   * True when that verdict rests on a heuristic method or a default range, so
   * the display layer can disclose the strength of its own evidence instead of
   * asserting a settledness the producer never claimed.
   */
  readonly investigation_basis_heuristic?: boolean;
  /**
   * The producer's `value_of_information` for this factor — the dimensionless
   * [0,1] figure the verdict above is decided on.
   *
   * ⭐ Carried so a claim's STRENGTH can match its evidence. The verdicts decide
   * whether a factor may be recommended at all; this says how MUCH it is worth,
   * which is a different question and the one the composer was missing for
   * every `informative` factor. Additive only — the display layer bands it and
   * never suppresses on it.
   *
   * ⚠ This is the PUBLIC-SURFACE figure, never `m1_coaching.evidence_gaps[]
   * .voi_score`. Derived at PLoT, those are different quantities sharing a
   * word — see `./factor-investigation-licence.ts` for the two formulas and the
   * producer's own regression pin against conflating them.
   *
   * Key absent when the producer emitted no finite figure.
   */
  readonly investigation_voi?: number;
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
  /**
   * ⭐ WHAT THE INFORMATION-VALUE SCIENCE SAID ABOUT WHAT TO INVESTIGATE FIRST.
   *
   * A DIFFERENT QUESTION FROM `evidence_gaps` ABOVE, from a DIFFERENT PRODUCER
   * CHANNEL, and the two disagreed on the capture that produced this field.
   * `evidence_gaps` is `enrichment.m1_coaching.evidence_gaps[]`; this is ISL's
   * `enrichment.factor_evppi`, read through the existing
   * `coaching/select-factor-evppi.ts` authority.
   *
   * Attached at `reconcileAnalysisSummaryWithEnrichment` — the single seam
   * between a summary and its own enrichment — so it can never describe a
   * different run from the analysis it travels with.
   *
   * ABSENT (never `'not_assessed'`) when the EVPPI channel said nothing at all:
   * other information-value channels retain their separate disclosures.
   */
  readonly investigation_priority?: InvestigationPriorityLicence;
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
  /**
   * ⛔ ABSENT STAYS ABSENT (AIQ 5886457733; DL 5886379820). Present when the run WITHHELD its per-option goal figures
   * (PLoT #416's typed code, `reason_code`) or when any option the run could rank carries no win probability
   * (`reason_code: null`). Then no option leads, none is ranked, and `note` says why — in place of a winner, never a 0.
   * The note names no option. ABSENT otherwise (byte-identity by key absence).
   */
  readonly figures_withheld?: { readonly reason_code: string | null; readonly note: string };
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
   *   · `analysis_withheld` — analysis exists and is current, but its
   *                         option-level comparative result is intentionally
   *                         withheld by the canonical claim-safety verdict;
   *                         no analysis values are attached.
   *   · `analysis_unavailable` — persisted analysis history could not be
   *                         established on this turn; no existence or
   *                         freshness claim is licensed and no figures attach.
   *   · `no_analysis`     — no analysis on this turn to join against.
   */
  readonly analysis_link:
    | 'linked'
    | 'not_in_analysis'
    | 'ambiguous_label'
    | 'analysis_not_current'
    | 'analysis_withheld'
    | 'analysis_unavailable'
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
