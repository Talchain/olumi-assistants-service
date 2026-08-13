/**
 * Display-safe analysis projection for the LLM-facing context pack
 * (brief brief-display-safe-analysis A2 v2).
 *
 * Design principle: raw model values stay in structured state for
 * handlers, telemetry, signals, and chip generation; the LLM-facing
 * context pack uses decision-language projections only. Sonnet never
 * sees raw probability decimals (`0.862`), raw signed sensitivities
 * (`-0.40`), or internal coefficients (`strength.mean`). Without raw
 * floats in the prompt, Sonnet naturally speaks in percentages and
 * influence bands rather than echoing internal numerics.
 *
 * This formatter operates strictly downstream of `projectAnalysis()` —
 * the raw `ContextPackAnalysis` is preserved for handler-side reads
 * (coaching signals, chip generator, projection summaries, run-analysis
 * fallbacks). Only the prompt-serialised view is transformed.
 *
 * Pure function. No side effects. Idempotency note: feeding raw
 * `ContextPackAnalysis` through twice produces the same `DisplaySafeAnalysis`
 * (the function does not accept its own output as input).
 */

import type {
  ContextPackAnalysis,
  ContextPackAnalysisDriver,
  ContextPackAnalysisEvidenceGap,
  ContextPackAnalysisFlipThreshold,
  ContextPackAnalysisFragileEdge,
  ContextPackAnalysisOption,
} from '../context/context-pack-assembler.js';
import { formatPercentagePoints, formatProbability } from './format-analysis-value.js';
import { looksLikeRawDecimal } from './format-graph-for-context.js';
import { bandFromMagnitude, NEAR_ZERO_INFLUENCE_THRESHOLD } from './influence-bands.js';

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
   * raw win probability is below {@link NEAR_ZERO_WIN_PROBABILITY_THRESHOLD},
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

/**
 * AMENDMENT A1(a) — options for the display projection.
 *
 * THE DEFECT THIS CLOSES, and it was the worst reachable case in the first cut.
 * On a STALE turn `compose.ts` emits ONLY the stale-rerun coaching block and
 * SUPPRESSES every Phase 3 block (`:1185`, `:1258-1262`), so no flip card ships
 * — but `buildAnalysisFromPriorFacts` has no freshness gate and re-projects the
 * persisted analysis regardless. The coach would therefore hold the flip digits
 * on precisely the turn the user is being told the analysis is out of date.
 * A licence whose premise ("this is on the user's screen") is false is not a
 * narrow licence; it is a wrong one.
 */
export interface FormatAnalysisOptions {
  /**
   * The live `deriveAnalysisFreshness` verdict for this turn
   * (`ContextPack.coaching_context.freshness`). The flip-point licence opens
   * ONLY on the literal `'fresh'`. Absent / stale / unknown / degraded all keep
   * the band — the same fail-closed rule `classifyClaimUsable` applies to its
   * own freshness gate ("anything but 'fresh' — including absence").
   *
   * Defaulting to absent is deliberate: a caller that has not wired the verdict
   * gets the pre-fix behaviour, never an ungated licence.
   */
  readonly analysisFreshness?: string | null;
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
   * {@link isDisplaySafeFlipString} passes — `looksLikeRawDecimal` (the same
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
 * Lane 30 fix 4 — RUNTIME-ENFORCED (previously test-asserted only): see
 * {@link enforceDisplayAnalysisBudget}. A live pack with pathological label
 * lengths now truncates gracefully — keep-priority order, disclosed via
 * `truncation_note` — instead of silently blowing the prompt budget.
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

/** Minimum ranked options retained while tail-trimming under the budget. */
export const DISPLAY_ANALYSIS_MIN_OPTIONS = 2;

/**
 * Relative-distance thresholds for the tipping-risk band phrases
 * (presentation bands, not science): |flip − current| / |current|
 * below `small` reads as a small shift, below `moderate` as a moderate
 * shift, else a large shift.
 */
export const FLIP_PROXIMITY_BANDS = {
  small: 0.1,
  moderate: 0.35,
} as const;

export interface DisplaySafeAnalysisDriver {
  readonly label: string;
  /** Decision-language phrase, e.g. `"very strong positive influence"`,
   *  `"moderate negative influence"`, or `"no material influence"` for
   *  near-zero sensitivities where sign is not meaningful. */
  readonly influence: string;
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
   * Trust-spine board #1 (CEE half) — the honest constraint note, verbatim
   * from `compactAnalysis` (via the raw projection). Present exactly when
   * the leading option is flagged constraint-infeasible
   * (CEE_CONSTRAINT_INFEASIBLE_GATE ON); ABSENT otherwise. NEVER dropped by
   * the char-budget guard (it is not in {@link DISPLAY_ANALYSIS_TRUNCATION_ORDER})
   * — constraint truthfulness outranks breadth, same doctrine as `goal_fit`.
   */
  readonly constraint_infeasible_note?: string;
  /**
   * T1 claim safety (ROADMAP 1.231) — the DISCLOSED absence of the option
   * ranking on a turn whose persisted constraint verdict withholds the
   * leading-option claim.
   *
   * NOT produced by {@link formatAnalysisForContext}: this formatter never sets
   * it. It is stamped downstream by
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

/**
 * Convert a signed sensitivity into the user-visible influence phrase.
 *
 *   1.0  → "very strong positive influence"
 *   0.5  → "moderate positive influence"
 *  -0.4  → "moderate negative influence"
 *   0.02 → "no material influence"   (sign suppressed below NEAR_ZERO_INFLUENCE_THRESHOLD)
 */
export function influencePhrase(signedSensitivity: number): string {
  if (!Number.isFinite(signedSensitivity)) return 'no material influence';
  const abs = Math.abs(signedSensitivity);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return 'no material influence';
  const band = bandFromMagnitude(abs);
  const sign = signedSensitivity < 0 ? 'negative' : 'positive';
  return `${band} ${sign} influence`;
}

function formatDriver(driver: ContextPackAnalysisDriver): DisplaySafeAnalysisDriver {
  return {
    label: driver.factor_label,
    influence: influencePhrase(driver.sensitivity_value),
  };
}

/** Finite [0,1] check for the raw goal-fit value. */
function isValidGoalFit(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Lane 30 fix 3 — band a modelled-outcome mean into decision language using
 * the SHARED influence-band vocabulary plus sign (presentation bands, not
 * science — same doctrine as `tippingRiskPhrase`). Near-zero means read as
 * "roughly neutral" (sign is not meaningful at that scale); non-finite
 * values return null so the caller omits the field rather than fabricating
 * a claim.
 *
 *   outcomeBandPhrase(0.237)  → "weak positive modelled outcome"
 *   outcomeBandPhrase(-0.4)   → "moderate negative modelled outcome"
 *   outcomeBandPhrase(0.01)   → "roughly neutral modelled outcome"
 */
export function outcomeBandPhrase(outcomeMean: number): string | null {
  if (!Number.isFinite(outcomeMean)) return null;
  const abs = Math.abs(outcomeMean);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return 'roughly neutral modelled outcome';
  const band = bandFromMagnitude(abs);
  const sign = outcomeMean < 0 ? 'negative' : 'positive';
  return `${band} ${sign} modelled outcome`;
}

/**
 * ROADMAP 2.54 (a) — the raw win probability below which a plain
 * `Math.round(p * 100)` would render "0%" (⇔ `p < 0.005`). The note fires on
 * exactly that band.
 *
 * ⚠ What this band RENDERS changed in ROADMAP 2.229 slice 3: it is now
 * `"<1%"`, because a non-zero value may not be reported as an impossibility.
 * The threshold is unchanged and still selects the right band for the note;
 * only the sentence about what the reader sees was falsified. Kept as its own
 * constant deliberately — {@link formatProbability} states its rule over the
 * whole domain and has no threshold to drift against this one.
 */
export const NEAR_ZERO_WIN_PROBABILITY_THRESHOLD = 0.005;

/**
 * ROADMAP 2.54 (a) — honest one-liner for a near-zero win probability
 * (live papercut: behavioural re-test 2026-07-14 §G — an option at a tiny
 * fraction of a percent rendered as an unexplained "0%" and read as a bug).
 *
 * Claim discipline: win probability IS the frequency of coming out best
 * across the sampled simulation runs, so "almost never came out best" and
 * "an alternative scored better in almost every sampled run" are
 * definitionally supported. Anything beyond that (WHY it lost) is NOT in
 * the data, so the note forbids inventing a reason. No digits — the
 * display projection stays number-free outside the percent strings.
 */
export const NEAR_ZERO_WIN_PROBABILITY_NOTE =
  'near-zero win probability: this option almost never came out best across the sampled ' +
  'simulation runs — at least one alternative scored better in almost every sampled run. ' +
  'That can mean it is consistently outperformed (for example reliably mid-ranked, so ' +
  'rarely the single best) rather than broken; a near-zero win probability is a real ' +
  'result, not an error. Do not invent a specific reason it lost — the analysis only ' +
  'establishes that other options scored better on the sampled runs.';

/**
 * ROADMAP 2.54 (a) — true when the raw probability is valid and renders as
 * zero percent. Invalid values (non-finite / out of range) never get the
 * note: `formatProbability` renders "Not available" for those and a
 * near-zero explanation would be a false claim.
 */
function isNearZeroWinProbability(probability: number): boolean {
  return (
    typeof probability === 'number' &&
    Number.isFinite(probability) &&
    probability >= 0 &&
    probability < NEAR_ZERO_WIN_PROBABILITY_THRESHOLD
  );
}

function formatOption(
  option: Pick<
    ContextPackAnalysisOption,
    'label' | 'probability' | 'goal_fit_probability' | 'outcome_mean' | 'constraint_infeasible'
  >,
): DisplaySafeAnalysisOption {
  const outcomeBand =
    typeof option.outcome_mean === 'number' ? outcomeBandPhrase(option.outcome_mean) : null;
  return {
    label: option.label,
    win_probability: formatProbability(option.probability, 'display'),
    // ROADMAP 2.54 (a) — a "0%" render carries its honest explanation
    // inline, next to the value it explains. Display prose only.
    ...(isNearZeroWinProbability(option.probability)
      ? { win_probability_note: NEAR_ZERO_WIN_PROBABILITY_NOTE }
      : {}),
    // Lane 30 — target-fit percent string, only when the raw value is a
    // valid probability (an out-of-range value is dropped, never rendered
    // as a false percent).
    ...(isValidGoalFit(option.goal_fit_probability)
      ? { target_fit: formatProbability(option.goal_fit_probability, 'display') }
      : {}),
    // Lane 30 fix 3 — banded modelled outcome (never the raw mean).
    ...(outcomeBand !== null ? { outcome_band: outcomeBand } : {}),
    // Trust-spine #1 (CEE half) — pass the constraint-infeasible winner flag
    // through to the LLM-facing option. Key absent when unset (byte-identity).
    ...(option.constraint_infeasible === true ? { constraint_infeasible: true as const } : {}),
  };
}

/**
 * Lane 30 fix 3 — confidence-tier prose. Known ordinal tokens (the PLoT
 * producer emits 'strong' | 'fair' | 'needs_work', derived from
 * `m1_coaching.readiness`) map to fixed phrases; unknown tokens are
 * humanised (underscores → spaces) behind a stable prefix rather than
 * echoed raw — same doctrine as the goal-fit basis phrases.
 */
const CONFIDENCE_TIER_PHRASES: Readonly<Record<string, string>> = {
  strong: 'analysis confidence is strong',
  fair: 'analysis confidence is fair',
  needs_work: 'analysis confidence needs work',
};

export function confidenceTierPhrase(tier: string): string {
  return (
    CONFIDENCE_TIER_PHRASES[tier] ?? `analysis confidence: ${tier.replace(/_/g, ' ')}`
  );
}

/** Writable view of the projection while it is being assembled/truncated. */
type MutableDisplaySafeAnalysis = {
  -readonly [K in keyof DisplaySafeAnalysis]: DisplaySafeAnalysis[K];
};

/** Serialised size in the SAME form the budget contract measures
 *  (2-space-indented JSON — the shape `buildUserMessage` embeds). */
function serialisedLength(out: MutableDisplaySafeAnalysis): number {
  return JSON.stringify(out, null, 2).length;
}

/**
 * Lane 30 fix 4 — runtime enforcement of {@link DISPLAY_ANALYSIS_CHAR_BUDGET}.
 *
 * Graceful priority truncation: sections are dropped lowest-keep-priority
 * first ({@link DISPLAY_ANALYSIS_TRUNCATION_ORDER} — flip/VOI, then fragile
 * edges, then sensitivities), then the ranked option list is tail-trimmed
 * (lowest-ranked first, keeping at least
 * {@link DISPLAY_ANALYSIS_MIN_OPTIONS}) and dropped wholesale only as the
 * last resort. `status`, the leading pair, `margin`, `robustness_band`,
 * `goal_fit` and `confidence_tier` are never dropped — goal-fit truthfulness
 * (this lane's live defect) outranks breadth.
 *
 * Every drop/trim is DISCLOSED via `truncation_note` (recomputed before each
 * measurement so the note's own length is inside the budget arithmetic). If
 * the projection still exceeds the budget after every drop (pathological
 * never-dropped labels), the note stays as evidence — nothing is silently
 * sliced mid-string.
 */
function enforceDisplayAnalysisBudget(out: MutableDisplaySafeAnalysis): void {
  if (serialisedLength(out) <= DISPLAY_ANALYSIS_CHAR_BUDGET) return;

  const omitted: string[] = [];
  const setNote = (): void => {
    out.truncation_note =
      'analysis detail truncated to fit the context budget — omitted: ' +
      omitted.join(', ') +
      '; the analysis contains more detail than shown here';
  };

  const drops: ReadonlyArray<{ name: string; present: () => boolean; drop: () => void }> = [
    {
      // ROADMAP 2.54 (b): only the banded LIST is budget-droppable. The
      // `value_of_information_note` is never set when the list exists (so
      // a budget drop cannot leave a false "zero VOI" claim behind) and is
      // never dropped when it does exist — like `goal_fit`, VOI-claim
      // truthfulness outranks breadth.
      name: 'value_of_information',
      present: () => out.value_of_information !== undefined,
      drop: () => {
        delete out.value_of_information;
      },
    },
    {
      name: 'tipping_points',
      present: () => out.tipping_points !== undefined,
      drop: () => {
        delete out.tipping_points;
      },
    },
    {
      name: 'fragile_edges',
      present: () => out.fragile_edges !== undefined || out.fragile_edge_count !== undefined,
      drop: () => {
        delete out.fragile_edges;
        delete out.fragile_edge_count;
      },
    },
    {
      name: 'top_drivers',
      present: () => out.top_drivers !== undefined,
      drop: () => {
        delete out.top_drivers;
      },
    },
  ];

  for (const section of drops) {
    if (!section.present()) continue;
    section.drop();
    omitted.push(section.name);
    setNote();
    if (serialisedLength(out) <= DISPLAY_ANALYSIS_CHAR_BUDGET) return;
  }

  // Tail-trim the ranked option list (lowest-ranked first) before dropping
  // it wholesale — it carries the per-option goal-fit values this lane
  // exists to surface.
  if (out.options !== undefined && out.options.length > DISPLAY_ANALYSIS_MIN_OPTIONS) {
    omitted.push('lower-ranked options');
    while (out.options.length > DISPLAY_ANALYSIS_MIN_OPTIONS) {
      out.options = out.options.slice(0, -1);
      setNote();
      if (serialisedLength(out) <= DISPLAY_ANALYSIS_CHAR_BUDGET) return;
    }
  }
  if (out.options !== undefined) {
    delete out.options;
    const trimIndex = omitted.indexOf('lower-ranked options');
    if (trimIndex !== -1) omitted.splice(trimIndex, 1);
    omitted.push('options');
    setNote();
  }
  // Still over budget → never-dropped sections carry pathological labels.
  // The note remains as disclosure; nothing is sliced mid-string.
}

/**
 * Lane 21 — banded tipping-risk phrase (doctrine A2: the LLM never sees the
 * raw current/flip values).
 *
 *   tippingRiskPhrase(100, 88, false)
 *     → "a moderate decrease could flip the result"     (12% relative shift)
 *   tippingRiskPhrase(0.3, 0.297, false)
 *     → "close to a tipping point — a small decrease could flip the result"
 *   tippingRiskPhrase(10, 20, false)
 *     → "only a large increase would flip the result"
 *   tippingRiskPhrase(0, 5, false)
 *     → "an increase in this factor could flip the result"  (relative
 *        distance undefined at current = 0 — direction only, no band)
 *   tippingRiskPhrase(null, null, true)
 *     → "no flip point found within the tested range"       (producer-attested)
 *
 * Returns null when nothing can be said safely (no flip pair, no attested
 * no-flip) — the caller omits the entry rather than fabricating a claim.
 */
export function tippingRiskPhrase(
  currentValue: number | null,
  flipValue: number | null,
  noFlipWithinBounds: boolean,
): string | null {
  if (noFlipWithinBounds) return 'no flip point found within the tested range';
  if (
    typeof currentValue !== 'number' ||
    !Number.isFinite(currentValue) ||
    typeof flipValue !== 'number' ||
    !Number.isFinite(flipValue)
  ) {
    return null;
  }
  const direction = flipValue >= currentValue ? 'increase' : 'decrease';
  if (currentValue === 0) {
    // Relative distance undefined — direction only, no proximity band.
    return `an ${direction} in this factor could flip the result`;
  }
  const relative = Math.abs(flipValue - currentValue) / Math.abs(currentValue);
  if (relative < FLIP_PROXIMITY_BANDS.small) {
    return `close to a tipping point — a small ${direction} could flip the result`;
  }
  if (relative < FLIP_PROXIMITY_BANDS.moderate) {
    return `a moderate ${direction} could flip the result`;
  }
  return `only a large ${direction} would flip the result`;
}

/**
 * Lane 21 — band a normalised [0,1] value-of-information score using the
 * SHARED influence-band vocabulary (single source of truth:
 * `./influence-bands.ts`). Near-zero scores return null so the caller drops
 * the entry instead of rendering noise; non-finite scores return null.
 */
export function voiBandPhrase(voiScore: number): string | null {
  if (!Number.isFinite(voiScore)) return null;
  const abs = Math.abs(voiScore);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return null;
  return bandFromMagnitude(abs);
}

/**
 * ROADMAP 2.54 (b) — the three DISCLOSED-absence lines for the VOI section.
 * Shared instruction tail: forbid VOI superlatives, redirect to influence
 * phrasing (the vocabulary `top_drivers` actually grounds). Claim
 * discipline per line:
 *
 *  - NOT_SCORED: no evidence-gap signal reached this projection — "no
 *    value-of-information scores are available" is unconditionally true.
 *  - ALL_NEAR_ZERO: entries arrived but every score banded below the
 *    shared noise floor (`NEAR_ZERO_INFLUENCE_THRESHOLD`) — exactly the
 *    live scorecard shape (every delivered VOI was zero).
 *  - LEVER_SUPPRESSED: the D-U option-controlled-lever suppression
 *    (`filterLeverControlledFactorEntries`, structural #308-union
 *    authority) emptied the section — options-set factors are not
 *    independent uncertainties to investigate, and fail-closed drops
 *    (unattributable entries while levers exist) are covered by the
 *    "excluded by design" phrasing.
 *
 * No digits — the display projection stays number-free outside the percent
 * strings.
 */
const VOI_NOTE_INSTRUCTION_TAIL =
  'do not claim any factor carries the highest (or a high) value of information, and do ' +
  'not present a sensitivity or influence ranking as a value-of-information ranking — ' +
  'describe factors by their modelled influence instead';

export const VOI_NOT_SCORED_NOTE =
  'no value-of-information scores are available for this analysis — ' +
  VOI_NOTE_INSTRUCTION_TAIL;

export const VOI_ALL_NEAR_ZERO_NOTE =
  'value of information is at or near zero for every factor available to investigate in ' +
  'this analysis, so no factor stands out as worth investigating on value-of-information ' +
  'grounds — ' +
  VOI_NOTE_INSTRUCTION_TAIL;

export const VOI_LEVER_SUPPRESSED_NOTE =
  'no independently investigable factor carries a scored value of information in this ' +
  'analysis (factors set directly by the options themselves are excluded by design — ' +
  'they are choices, not uncertainties to investigate) — ' +
  VOI_NOTE_INSTRUCTION_TAIL;

const GOAL_FIT_BASIS_PHRASES: Readonly<Record<string, string>> = {
  modelled_outcome_distribution: 'goal fit was scored from the modelled outcome distribution',
};

/**
 * Lane 30 — the definition sentence rendered ONCE (never per option) when
 * per-option `target_fit` values are present. It binds the two percent
 * vocabularies apart so the LLM cannot conflate them: `win_probability`
 * = "wins most often" (beats the alternatives), `target_fit` = "meets your
 * target" (the modelled probability of goal attainment). The live defect
 * (scenario 90385279) was exactly this conflation — an 89% win probability
 * narrated as target attainment when the scored target-fit was 29.3%.
 */
export const TARGET_FIT_DEFINITION =
  'each option\'s target_fit is the modelled probability it meets your target; ' +
  'win_probability only says how often the option beats the alternatives — ' +
  'an option can win most often yet still be unlikely to meet the target';

/**
 * Lane 30 — the DISCLOSED-absence line. Rendered whenever an analysis is
 * present but nothing attests goal-fit scoring, so the LLM can never fill a
 * silent gap with win probabilities.
 */
export const GOAL_FIT_NOT_SCORED_LINE =
  'target-fit not scored: no goal-fit values are available for this analysis — ' +
  'win probabilities show how often each option leads, not whether it meets your target';

/**
 * Lane 30 — rendered when provenance attests scoring but no per-option
 * values arrived (appended to the basis phrase).
 */
export const GOAL_FIT_VALUES_MISSING_SUFFIX =
  '; per-option target-fit values are not available for this run — ' +
  'win probabilities do not measure target-fit';

/**
 * Lane 21 — goal-fit provenance prose (PLoT #204). States THAT goal fit was
 * scored and its basis; never values. Unknown basis tokens are humanised
 * (underscores → spaces) rather than echoed raw.
 */
function goalFitPhrase(goalFit: { scored: boolean; basis: string | null }): string | null {
  if (!goalFit.scored) return null;
  if (goalFit.basis === null) return 'goal fit was scored';
  return (
    GOAL_FIT_BASIS_PHRASES[goalFit.basis] ??
    `goal fit was scored from ${goalFit.basis.replace(/_/g, ' ')}`
  );
}

/**
 * AMENDMENT A2 — THE WIDENED FLOAT CAGE.
 *
 * The first cut used `looksLikeRawDecimal` alone. That predicate only matches a
 * string composed ENTIRELY of a number, so it admitted `"0.8625 GBP"` — a raw
 * model-scale probability wearing a unit, which is exactly the shape the
 * producer emits when PLoT hands it an uninverted value (the prompt tells it to
 * quote the number with its unit). Reproduced by the reviewer; the cage now
 * refuses both shapes.
 *
 * REFUSED:
 *   - a bare number, with or without thousands separators (`looksLikeRawDecimal`,
 *     shared with the display-graph projection);
 *   - a value whose leading numeric token is a sub-unit decimal, with or without
 *     a currency prefix or a trailing unit — `"0.8625 GBP"`, `"£0.345"`,
 *     `".86"`. Nothing in a decision graph is legitimately expressed as a bare
 *     fraction of a unit at this seam, and a normalised probability always is.
 *
 * ADMITTED: `"40000 GBP"`, `"£34,500"`, `"8.5%"`, `"6.1 story points"`,
 * `"18 months"` — every shape the user-facing chip formatter itself produces.
 */
export function isDisplaySafeFlipString(value: string): boolean {
  if (looksLikeRawDecimal(value)) return false;
  // Strip a leading sign and any currency/space prefix, then look for a
  // sub-unit decimal at the head of the numeric part: `0.x`, `.x`, `-0.x`.
  const head = value.trim().replace(/^[^0-9.-]+/, '');
  if (/^-?(?:0*)?\.\d/.test(head)) return false;
  return true;
}

/**
 * ROADMAP 2.205 practical resolution — render the display-licensed flip pair
 * into ONE pre-formatted string, or return null so the caller emits the band
 * alone.
 *
 * THE FLOAT CAGE IS ENFORCED HERE, at the boundary that owns it. Either string
 * that reads as a bare number ({@link looksLikeRawDecimal} — the SAME predicate
 * `format-graph-for-context.ts` applies to `display_value`, imported rather
 * than copied) fails the whole pair: a producer that emitted `"0.345"` did not
 * write a display form, it echoed a model value, and admitting one half of the
 * pair would be worse than admitting neither.
 *
 * Both-or-neither, and only on a real flip pair — `no_flip_within_bounds`
 * entries never reach here with a licence (the derivation withholds it), and
 * the guard is repeated at the fork so the invariant is visible where the
 * string is built.
 */
export function formatFlipPointDisplay(
  entry: ContextPackAnalysisFlipThreshold,
): string | null {
  if (entry.no_flip_within_bounds) return null;
  const current = entry.current_display;
  const flip = entry.flip_display;
  if (typeof current !== 'string' || typeof flip !== 'string') return null;
  if (current.length === 0 || flip.length === 0) return null;
  if (!isDisplaySafeFlipString(current) || !isDisplaySafeFlipString(flip)) return null;
  return `currently ${current}; flips at ${flip}`;
}

function formatTippingPoint(
  entry: ContextPackAnalysisFlipThreshold,
  licenceOpen: boolean,
): DisplaySafeTippingPoint | null {
  const risk = tippingRiskPhrase(
    entry.current_value,
    entry.flip_value,
    entry.no_flip_within_bounds,
  );
  if (risk === null) return null;
  // ROADMAP 2.205 — the band is ALWAYS emitted; the licensed number is
  // additive. Absent licence ⇒ key absent ⇒ byte-identical to the pre-fix pack.
  const flipPoint = licenceOpen ? formatFlipPointDisplay(entry) : null;
  return {
    label: entry.factor_label,
    risk,
    ...(flipPoint !== null ? { flip_point: flipPoint } : {}),
  };
}

function formatEvidenceGap(
  entry: ContextPackAnalysisEvidenceGap,
): DisplaySafeEvidenceGap | null {
  const band = voiBandPhrase(entry.voi_score);
  if (band === null) return null;
  return { label: entry.factor_label, value_of_information: band };
}

/**
 * Project the raw `ContextPackAnalysis` into the display-safe shape
 * sent to Sonnet. The structured `{from_label, to_label}` fragile-edge
 * pair lives directly on `ContextPackAnalysis.fragile_edges`, so this
 * function takes a single argument and there is no foot-gun where a
 * caller forgets the second source and silently drops fragile edges.
 *
 * Returns null when the raw analysis is null. Omits (does not emit
 * `null`) optional fields whose source is missing/empty.
 */
export function formatAnalysisForContext(
  raw: ContextPackAnalysis | null,
  options: FormatAnalysisOptions = {},
): DisplaySafeAnalysis | null {
  if (raw === null) return null;
  // AMENDMENT A1(a) — the flip-point licence is gated on the FRESH verdict,
  // fail-closed on absence. See {@link FormatAnalysisOptions.analysisFreshness}.
  const flipLicenceOpen = options.analysisFreshness === 'fresh';

  const out: MutableDisplaySafeAnalysis = {
    status: raw.status,
  };

  if (raw.leading_option) {
    out.leading_option = formatOption(raw.leading_option);
  }
  if (raw.runner_up) {
    out.runner_up = formatOption(raw.runner_up);
  }

  // margin_pp arrives upstream pre-scaled to percentage points
  // (compactAnalysis stores `margin × 1000 / 10`). Use the shared
  // `formatPercentagePoints` formatter for consistency with the rest of
  // the analysis-display surface (handles singular `1 percentage point`
  // correctly via the formatter, plus invalid-value telemetry). 0 is
  // omitted because "0 percentage points" reads as a pseudo-tie.
  if (typeof raw.margin_pp === 'number' && Number.isFinite(raw.margin_pp)) {
    const rounded = Math.round(raw.margin_pp);
    if (rounded !== 0) {
      out.margin = formatPercentagePoints(raw.margin_pp, 'prose', { field_path: 'analysis.margin' });
    }
  }

  if (raw.robustness_band) {
    out.robustness_band = raw.robustness_band;
  }

  if (raw.top_drivers.length > 0) {
    out.top_drivers = raw.top_drivers.map(formatDriver);
  }

  if (raw.fragile_edges.length > 0) {
    out.fragile_edges = raw.fragile_edges.map(
      (e: ContextPackAnalysisFragileEdge) => ({
        from_label: e.from_label,
        to_label: e.to_label,
      }),
    );
  }

  // Lane 21 (P0-A) breadth fields — every field below follows the file's
  // omission semantics (absent, never null / empty).

  // Full ranked option list. The raw projection arrives sorted by win
  // probability descending and bounded (MAX_PROJECTED_OPTIONS); rank is a
  // string so no raw number ever enters the display projection. Lane 30:
  // each entry carries its `target_fit` percent when the raw option carries
  // a valid goal-fit value.
  const rawOptions = raw.options ?? [];
  if (rawOptions.length > 0) {
    out.options = rawOptions.map((o, i) => ({
      rank: String(i + 1),
      ...formatOption(o),
    }));
  }

  // Banded tipping risks. Entries with nothing safe to say are dropped by
  // the formatter (null risk), never fabricated.
  const tipping = (raw.flip_thresholds ?? [])
    .map((e) => formatTippingPoint(e, flipLicenceOpen))
    .filter((t): t is DisplaySafeTippingPoint => t !== null);
  if (tipping.length > 0) {
    out.tipping_points = tipping;
  }

  // Uncapped fragile-edge count as a string (no-numbers invariant). Only
  // rendered when there is something to count.
  if (
    typeof raw.fragile_edge_count === 'number' &&
    Number.isFinite(raw.fragile_edge_count) &&
    raw.fragile_edge_count > 0
  ) {
    out.fragile_edge_count = String(raw.fragile_edge_count);
  }

  // Banded VOI per evidence-gap factor (shared influence-band vocabulary);
  // near-zero entries dropped as noise. ROADMAP 2.54 (b): an empty result
  // is now DISCLOSED, never silent — the silent gap let the LLM narrate
  // sensitivity as "the highest value of information" while every
  // delivered VOI was zero (behavioural re-test 2026-07-14 §G). Branch
  // order: surviving raw entries (all near-zero) are the most precise
  // fact even when lever suppression also fired upstream.
  const rawGaps = raw.evidence_gaps ?? [];
  const gaps = rawGaps
    .map(formatEvidenceGap)
    .filter((g): g is DisplaySafeEvidenceGap => g !== null);
  if (gaps.length > 0) {
    out.value_of_information = gaps;
  } else if (rawGaps.length > 0) {
    out.value_of_information_note = VOI_ALL_NEAR_ZERO_NOTE;
  } else if (raw.evidence_gaps_lever_suppressed === true) {
    out.value_of_information_note = VOI_LEVER_SUPPRESSED_NOTE;
  } else {
    out.value_of_information_note = VOI_NOT_SCORED_NOTE;
  }

  // Lane 30 — goal-fit prose. Three DISCLOSED states (never silent, so the
  // LLM can never fill a target-fit gap with win probabilities):
  //   1. per-option target_fit values present → the definition sentence
  //      (win% vs target-fit, stated once) + the basis caveat when known;
  //   2. provenance attests scoring but no per-option values arrived → the
  //      basis phrase + an explicit values-missing disclosure;
  //   3. nothing attests scoring → the explicit "target-fit not scored"
  //      line.
  const hasPerOptionGoalFit = [raw.leading_option, raw.runner_up, ...(raw.options ?? [])].some(
    (o) => o != null && isValidGoalFit(o.goal_fit_probability),
  );
  const basisPhrase = raw.goal_fit ? goalFitPhrase(raw.goal_fit) : null;
  if (hasPerOptionGoalFit) {
    out.goal_fit =
      basisPhrase !== null ? `${TARGET_FIT_DEFINITION}; ${basisPhrase}` : TARGET_FIT_DEFINITION;
  } else if (basisPhrase !== null) {
    out.goal_fit = `${basisPhrase}${GOAL_FIT_VALUES_MISSING_SUFFIX}`;
  } else {
    out.goal_fit = GOAL_FIT_NOT_SCORED_LINE;
  }

  // Lane 30 fix 3 — confidence-tier prose (ordinal token → phrase). Omitted
  // when the producer reported no tier (no fabricated confidence claim).
  if (typeof raw.confidence_tier === 'string' && raw.confidence_tier.trim().length > 0) {
    out.confidence_tier = confidenceTierPhrase(raw.confidence_tier.trim());
  }

  // Trust-spine #1 (CEE half) — the honest constraint note, verbatim. Set
  // BEFORE the budget guard but never droppable by it (not in the truncation
  // order): constraint truthfulness outranks breadth, like goal_fit. Key
  // absent when unset (flag off / feasible winner) → byte-identity.
  if (
    typeof raw.constraint_infeasible_note === 'string' &&
    raw.constraint_infeasible_note.length > 0
  ) {
    out.constraint_infeasible_note = raw.constraint_infeasible_note;
  }

  // Lane 30 fix 4 — runtime char-budget guard (graceful, disclosed).
  enforceDisplayAnalysisBudget(out);

  return out;
}
