/**
 * Display-safe analysis SHAPES and their budget constants
 * (brief brief-display-safe-analysis A2 v2).
 *
 * This module no longer formats anything. Its formatter
 * (`formatAnalysisForContext`) and every helper only it used were deleted
 * (Track 2 deletion 9, 22 Oct 2026) once nothing served reached them. What
 * remains is:
 *   - the `DisplaySafeAnalysis` type and its member types, read type-only by
 *     `../context/withheld-leader-projection.ts`;
 *   - `DISPLAY_ANALYSIS_CHAR_BUDGET` and `DISPLAY_ANALYSIS_TRUNCATION_ORDER`,
 *     imported by the `display_analysis` row of `../context/context-policy.ts`.
 *
 * Design principle the shapes still encode: the LLM-facing view carries
 * decision-language projections only — never raw probability decimals,
 * raw signed sensitivities or internal coefficients.
 */

export interface DisplaySafeAnalysisOption {
  readonly label: string;
  /**
   * Display percent string, e.g. `"86%"`. Never a raw decimal. Whole percent
   * except at the ends of the range: ROADMAP 2.229 slice 3 renders a value
   * that is not EXACTLY 1 as `">99%"` and one that is not EXACTLY 0 as
   * `"<1%"`, so rounding cannot claim a certainty the analysis never
   * computed. See {@link formatProbability}.
   */
  readonly win_probability: string;
  /**
   * Lane 30 — display percent string of the option's goal-fit value, on the
   * same scale and with the same end-of-range honesty as `win_probability` (the
   * modelled probability it MEETS THE USER'S TARGET; PLoT #204
   * `probability_of_joint_goal`). Deliberately a separate key from
   * `win_probability`: win% says the option beats the alternatives most
   * often; target_fit says whether it is likely to meet the target — the
   * two can diverge sharply (live case: 89% win vs 29% target-fit). Absent
   * when no goal-fit value was scored for this option; the top-level
   * `goal_fit` prose then disclosed the absence explicitly.
   */
  readonly target_fit?: string;
  /**
   * Lane 30 fix 3 — banded modelled-outcome phrase for the option (shared
   * influence-band vocabulary + sign; near-zero → "roughly neutral"), e.g.
   * `"weak positive modelled outcome"`. Presentation bands, not science.
   * Absent when the producer reported no outcome distribution.
   */
  readonly outcome_band?: string;
  /**
   * ROADMAP 2.54 (a) — honest explanation attached ONLY when the option's
   * raw win probability is below the near-zero threshold (0.005),
   * i.e. the bottom band of the range. ⚠ Since ROADMAP 2.229 slice 3 that
   * band renders as `"<1%"`, NOT as `"0%"` — the note explains what a
   * near-zero result MEANS and is no longer the only thing standing between
   * the reader and a bare zero (historic papercut, still the reason this
   * exists: behavioural re-test 2026-07-14, Hybrid at ~zero percent, where an
   * unexplained "0%" read as a bug or a silent elimination). The note states
   * only what the
   * analysis data supports — the option almost never came out best across
   * the sampled runs — and explicitly forbids fabricating a causal reason.
   * Display prose only: the `win_probability` string is untouched.
   */
  readonly win_probability_note?: string;
  /**
   * Trust-spine board #1 (CEE half). Literal `true` when this option is the
   * flagged constraint-infeasible winner (CEE_CONSTRAINT_INFEASIBLE_GATE ON) —
   * passed through from the raw projection so the coach LLM sees the flag on
   * the option itself, next to the probability it would otherwise narrate as
   * a clean lead. ABSENT otherwise (key-absence byte-identity). The paired
   * honest wording lives in {@link DisplaySafeAnalysis.constraint_infeasible_note}.
   */
  readonly constraint_infeasible?: true;
}

/**
 * Lane 21 (P0-A) — one entry of the full ranked option list. `rank` is a
 * string ("1", "2", …) to preserve the structural no-numbers-anywhere
 * invariant of the display-safe projection; array order matches rank.
 */
export interface DisplaySafeRankedOption {
  readonly rank: string;
  readonly label: string;
  /**
   * Display percent string, e.g. `"72%"` — same end-of-range honesty as
   * {@link DisplaySafeAnalysisOption.win_probability}.
   */
  readonly win_probability: string;
  /** Lane 30 — see {@link DisplaySafeAnalysisOption.target_fit}. */
  readonly target_fit?: string;
  /** Lane 30 fix 3 — see {@link DisplaySafeAnalysisOption.outcome_band}. */
  readonly outcome_band?: string;
  /** ROADMAP 2.54 (a) — see {@link DisplaySafeAnalysisOption.win_probability_note}. */
  readonly win_probability_note?: string;
  /** Trust-spine #1 — see {@link DisplaySafeAnalysisOption.constraint_infeasible}. */
  readonly constraint_infeasible?: true;
}

/** Lane 21 — banded tipping-risk entry. `risk` is decision-language prose. */
export interface DisplaySafeTippingPoint {
  readonly label: string;
  readonly risk: string;
  /**
   * ROADMAP 2.205 PRACTICAL RESOLUTION (2026-07-31) — the one un-banded
   * quantity, and the reason it is allowed.
   *
   * A pre-formatted display string with units, e.g.
   * `"currently 40000 GBP; flips at 34500 GBP"` — exactly the trick
   * `DisplaySafeNode.display_value` already uses. Present ONLY when the same
   * digits are already on the USER'S SCREEN for this analysis; the licence
   * chain is traced hop by hop at
   * `../context/analysis-signals.ts` → `deriveFlipDisplayLicences`.
   *
   * THE ADJUDICATED RULE (orchestrator, Paul veto open; grounded in the
   * data+coaching doctrine): *a number already display-licensed to the USER on
   * the same turn is speakable by the coach — same licence, same register. The
   * Tier-3 deny (`../compose/claim-safety-cage.ts` TIER3_LEAK_BLOCK_FIELDS)
   * continues to bind any value NOT shown to the user.*
   *
   * WHAT THIS DOES NOT REOPEN. The float cage is WIDER than before, not weaker:
   * this key admits a producer-authored DISPLAY STRING and refuses it unless
   * the (now deleted) `isDisplaySafeFlipString` passed — `looksLikeRawDecimal` (the same
   * predicate that keeps a bare `0.345` out of `display_value`) PLUS a refusal
   * of sub-unit decimals wearing a unit or a currency prefix, the shape an
   * uninverted model-scale value takes (`"0.8625 GBP"`). `"£34,500"` is not
   * `0.345`; `"0.8625 GBP"` is, and is refused. Nothing else
   * moved: `top_drivers[].influence` (sensitivity magnitude) and
   * `value_of_information[]` (VOI score) remain bands, because the licence
   * trace found NO user-facing surface for either — see the manifest in
   * `PHASE0-EVIDENCE-2026-07-28/fix-context-unband.md` §1.2-1.3.
   *
   * ADDITIVE, never a replacement: `risk` is always emitted. Where the display
   * pair is absent the band alone remains — a disclosed band, never a silent
   * hole (the same doctrine as `goal_fit` / `value_of_information_note`).
   *
   * ⚠ POLICY-INVISIBLE, stated plainly (amendment A3; an earlier note implied
   * otherwise). The ContextPolicy conformance anchor and the live
   * `v5.context_policy.divergence` tripwire both work at SECTION granularity —
   * they walk section NAMES and their measured char counts
   * (`findContextPolicyDivergences('routing', { display_analysis: N })`). This
   * key lives INSIDE `display_analysis`, so neither of them can see it, and
   * neither will ever RED on its presence, absence or content. What DOES cover
   * it is the enforced `DISPLAY_ANALYSIS_CHAR_BUDGET` (its bytes are counted in
   * the section total) and `DISPLAY_ANALYSIS_TRUNCATION_ORDER`, where
   * `tipping_points` is rank 2 — so a budget drop takes this key with the rest
   * of its section and DISCLOSES it via `truncation_note`. "Budget-covered" is
   * true; "policy-visible" is not, and the two are not the same claim.
   */
  readonly flip_point?: string;
}

/** Lane 21 — banded value-of-information entry (influence-band vocabulary). */
export interface DisplaySafeEvidenceGap {
  readonly label: string;
  readonly value_of_information: string;
}

/**
 * Lane 21 — LLM-facing char budget for the serialised (2-space-indented)
 * display-safe analysis projection. The pre-widening projection measured
 * ~603 chars and starved the LLM; breadth-first widening must still stay
 * bounded so the ~21k-char routing prompt keeps its shape.
 *
 * Lane 30 fix 4 made this runtime-enforced inside `formatAnalysisForContext`.
 * That formatter was deleted (Track 2 deletion 9) once nothing served reached
 * it, so no code enforces this budget now; the constant survives only as the
 * `display_analysis` row of `../context/context-policy.ts`.
 */
export const DISPLAY_ANALYSIS_CHAR_BUDGET = 4000;

/**
 * Lane 30 fix 4 — the order in which sections are DROPPED when the
 * serialised projection exceeds {@link DISPLAY_ANALYSIS_CHAR_BUDGET}
 * (lowest keep-priority first). Leader/runner-up, goal-fit prose,
 * confidence tier, margin, robustness and status are never dropped; the
 * ranked option list (carrier of per-option goal-fit) is tail-trimmed to a
 * minimum of two entries before it is dropped wholesale as the last resort.
 */
export const DISPLAY_ANALYSIS_TRUNCATION_ORDER = [
  'value_of_information',
  'tipping_points',
  'fragile_edges',
  'top_drivers',
  'options',
] as const;

export interface DisplaySafeAnalysisDriver {
  readonly label: string;
  /** Decision-language phrase, e.g. `"very strong positive influence"`,
   *  `"moderate negative influence"`, or `"no material influence"` for
   *  near-zero sensitivities where sign is not meaningful. */
  readonly influence: string;
  /**
   * ⭐ THE PRODUCER'S OWN VERDICT ON WHETHER THIS FACTOR IS WORTH RESOLVING.
   *
   * Added because its ABSENCE caused a witnessed live harm (2026-09-04): the
   * model was handed `{label, influence}` and nothing else, so for a factor
   * with `value_of_information: 0` and `flip_risk_category: "negligible"` the
   * only inference available was "this matters, so investigate it" — and the
   * product spent eight narrations telling a founder to run a pilot that its
   * own engine scored at zero benefit.
   *
   * Carries ONE of two things, never both: the honest verdict sentence for a
   * factor the producer scored at zero, or — for an `informative` factor — the
   * MAGNITUDE of what resolving it is worth. The second exists because a
   * verdict-only fix leaves every positively-scored factor projected exactly as
   * it was before, which is the shape that produced the harm.
   *
   * Key ABSENT (never empty string) when the factor is unscored, or informative
   * with no producer magnitude, so the pre-fix projection is reproduced
   * byte-for-byte for every case this fix is not about.
   *
   * ⚠ Lives on the SAME object as `influence` deliberately: the budget
   * truncator drops `top_drivers` wholesale, so a drop can never strip the
   * counter-evidence while leaving the influence claim standing.
   */
  readonly investigation?: string;
}

export interface DisplaySafeFragileEdge {
  readonly from_label: string;
  readonly to_label: string;
}

export interface DisplaySafeAnalysis {
  readonly status: string;
  readonly leading_option?: DisplaySafeAnalysisOption;
  readonly runner_up?: DisplaySafeAnalysisOption;
  /** Phrase like `"7 percentage points"`. Omitted when 0 / unavailable. */
  readonly margin?: string;
  readonly robustness_band?: string;
  readonly top_drivers?: readonly DisplaySafeAnalysisDriver[];
  /** Labels only — no `exists_probability`, no `strength`. */
  readonly fragile_edges?: readonly DisplaySafeFragileEdge[];
  /**
   * Lane 21 (P0-A) breadth fields. All optional, all omitted (never null /
   * never empty-array) when the raw source is missing or empty:
   *
   *  - `options`: EVERY option, ranked, display-percent probability
   *    (Lane 30: plus a `target_fit` percent when goal fit was scored).
   *  - `tipping_points`: banded flip-risk phrases (never raw thresholds).
   *  - `fragile_edge_count`: string count behind the capped edge list.
   *  - `value_of_information`: banded VOI per evidence-gap factor
   *    (influence-band vocabulary; near-zero entries dropped).
   *  - `goal_fit`: Lane 30 — ALWAYS present on a non-null projection.
   *    Either the win%-vs-target-fit definition + basis caveat (values
   *    present), a values-missing disclosure (scored, no values), or the
   *    explicit "target-fit not scored" line. Never silent — a silent gap
   *    is what let the LLM narrate win% as target-fit (live defect,
   *    scenario 90385279).
   */
  readonly options?: readonly DisplaySafeRankedOption[];
  readonly tipping_points?: readonly DisplaySafeTippingPoint[];
  readonly fragile_edge_count?: string;
  readonly value_of_information?: readonly DisplaySafeEvidenceGap[];
  /**
   * ROADMAP 2.54 (b) — DISCLOSED VOI absence (never-silent, same doctrine
   * as `goal_fit`). Present exactly when the banded VOI list is empty at
   * assembly time: the silent gap was what let the LLM narrate sensitivity
   * as "the highest value of information" while every delivered VOI was 0
   * (live papercut, behavioural re-test 2026-07-14 §G). Three honest
   * states: not scored, all effectively zero, or emptied by the D-U
   * option-controlled-lever suppression. NEVER emitted when the list was
   * merely dropped by the char-budget guard — that would be a false
   * zero-VOI claim (the truncation_note discloses that case instead).
   * Like `goal_fit`, this note is never dropped by the budget guard —
   * VOI-claim truthfulness outranks breadth.
   */
  readonly value_of_information_note?: string;
  /**
   * ⭐ WHAT THE INFORMATION-VALUE SCIENCE SAID ABOUT WHAT TO INVESTIGATE FIRST.
   *
   * A DIFFERENT QUESTION FROM `value_of_information` ABOVE, AND THAT IS THE
   * POINT — they read different producer channels and answered differently on
   * the capture that produced this field. `value_of_information` bands
   * `m1_coaching.evidence_gaps[]`; this projects the `factor_evppi` authority
   * (`coaching/select-factor-evppi.ts` → `coaching/investigation-priority.ts`),
   * which is the channel PLoT actually populated on 3 Sep 2026.
   *
   * Present exactly when the caller supplied a licence AND that licence is not
   * `not_assessed` (already covered by `value_of_information_note`). Absent
   * otherwise, so a caller that has not wired the licence gets a
   * byte-identical projection.
   *
   * Like `goal_fit` and `value_of_information_note`, NEVER dropped by the
   * char-budget guard: without it the pack's only ranking is `top_drivers`,
   * which ranks INFLUENCE, and narrating that as an investigation priority is
   * the live defect this field exists to stop.
   */
  readonly investigation_priority_note?: string;
  readonly goal_fit?: string;
  /**
   * Lane 30 fix 3 — analysis confidence prose from the producer's ordinal
   * tier token (e.g. `'needs_work'` → "analysis confidence needs work").
   * Omitted when the producer reported no tier.
   */
  readonly confidence_tier?: string;
  /**
   * Lane 30 fix 4 — DISCLOSED truncation marker. Present ONLY when the
   * runtime budget guard dropped or trimmed sections to fit
   * {@link DISPLAY_ANALYSIS_CHAR_BUDGET}; names what was omitted so the
   * LLM knows the analysis carries more detail than shown (and never
   * infers "no tipping points exist" from a truncated section).
   */
  readonly truncation_note?: string;
  /**
   * CONTEXT/MEMORY V5 defect 2 — DISCLOSED STALENESS, on the figures themselves.
   *
   * Present exactly when this turn's canonical freshness verdict is anything
   * other than the literal `'fresh'` (stale / unknown / none / absent — the
   * same fail-closed rule as the flip-point licence). Absent on a fresh turn,
   * so a fresh projection is byte-identical to the pre-fix one.
   *
   * WHY IT EXISTS. Before this, `display_analysis` rendered IDENTICALLY fresh
   * or stale: the only thing `analysisFreshness` gated was the tipping-point
   * digits. Freshness was therefore the one qualifying condition in this pack
   * with no in-band marker, while `truncation_note`,
   * `value_of_information_note`, `constraint_infeasible_note`,
   * `conversation.window.notice` and `brief.truncated` all have one — an idiom
   * this estate adopted precisely BECAUSE a sibling field is not a disclosure.
   * The verdict lived only in the sibling `coaching_context.freshness` enum.
   *
   * CEE #978 made the gap sharper rather than closing it: it gated the
   * per-element `focus` join on `usable_for_chips` and instructed the model not
   * to "recover, infer or rejoin figures from the broader `analysis` section by
   * label" — so the model is told those figures are unlicensed for the SELECTED
   * element, while this block still presented them unqualified.
   *
   * NEVER DROPPED by the char-budget guard (deliberately absent from
   * {@link DISPLAY_ANALYSIS_TRUNCATION_ORDER}): a truncated projection that
   * loses its staleness marker presents stale figures as current exactly when
   * the pack is most crowded. Same doctrine as `goal_fit` and
   * `constraint_infeasible_note` — truthfulness outranks breadth.
   *
   * QUALIFIES, never withholds. The figures stay: the coach still needs the
   * prior run to explain what re-running would update, and a silently missing
   * analysis block would be a larger and less honest change.
   */
  readonly analysis_not_current_note?: string;
  /**
   * Trust-spine board #1 (CEE half) — the honest constraint note, verbatim
   * from `compactAnalysis` (via the raw projection). Present exactly when
   * the leading option is flagged constraint-infeasible
   * (CEE_CONSTRAINT_INFEASIBLE_GATE ON); ABSENT otherwise. NEVER dropped by
   * the char-budget guard (it is not in {@link DISPLAY_ANALYSIS_TRUNCATION_ORDER})
   * — constraint truthfulness outranks breadth, same doctrine as `goal_fit`.
   */
  readonly constraint_infeasible_note?: string;
  /**
   * ⛔ ABSENT STAYS ABSENT (AIQ 5886457733) — the pack's `figures_withheld.note`, verbatim: the run withheld its goal
   * figures, or an option has no win probability, so no option leads. NEVER dropped by the char-budget guard (not in
   * {@link DISPLAY_ANALYSIS_TRUNCATION_ORDER}): it stands in place of a winner. ABSENT otherwise.
   */
  readonly figures_withheld_note?: string;
  /**
   * T1 claim safety (ROADMAP 1.231) — the DISCLOSED absence of the option
   * ranking on a turn whose persisted constraint verdict withholds the
   * leading-option claim.
   *
   * Never set by the (now deleted) `formatAnalysisForContext`. It is stamped by
   * `context/withheld-leader-projection.ts`, which removes `leading_option`,
   * `runner_up`, `margin` and the ranked `options` list and puts this in their
   * place. Declared HERE, on the shape, rather than bolted on with a cast — the
   * note is part of what a display-safe analysis can legitimately be, and
   * declaring it is what lets the projection be written without erasing the
   * type at the boundary (`scripts/check-forbidden-boundary-patterns.sh`).
   *
   * Same never-silent doctrine as `goal_fit` and `value_of_information_note`:
   * an absent ranking with no explanation invites the model either to invent
   * one or to read "no options exist".
   */
  readonly leading_option_note?: string;
}
