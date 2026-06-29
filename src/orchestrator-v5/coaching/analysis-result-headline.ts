/**
 * V5 deterministic analysis-result headline builder.
 *
 * Pure helper consumed by the run_analysis handler. Builds a short
 * British-English headline (one or two sentences) from the already-
 * available PLoT V2RunResponseEnvelope fields (leading option label,
 * top driver, fragility) when sufficient data is present. Returns null
 * when data is too thin — the handler then falls back to the locked
 * RUN_ANALYSIS_ASSISTANT_TEMPLATES string.
 *
 * Invariants:
 *  - No LLM call. No I/O. No graph mutation. No telemetry side effects on
 *    the valid path (margin inputs are pre-validated finite probabilities).
 *  - No raw decimals. win_probability renders as an integer %; the
 *    winner->runner-up margin renders as an integer "<N> percentage points"
 *    via the SSOT formatProbabilityMargin.
 *  - No internal IDs leak (winner / driver / fragility labels are guarded
 *    against ID-shaped strings).
 *  - One short sentence, or one + one status-suffix sentence — never more.
 *    Maximum {@link MAX_HEADLINE_CHARS} characters including any suffix.
 *  - Uses "currently leads", "provisional", "sensitive to" — never
 *    "best" / "recommended" / "winner".
 *  - "currently leads" is emitted ONLY when the leading option has a
 *    finite win_probability ≥ {@link MIN_LEAD_PROBABILITY} AND, if a
 *    runner-up exists in the same source, the margin is at least
 *    {@link MIN_LEAD_MARGIN}. A plurality leader with a positive but
 *    smaller margin gets an explicit near-tie / close-call line; only
 *    sub-threshold leaders, non-positive margins, and unsanitisable
 *    labels fall back to the locked template by returning null.
 *  - When a fragile assumption exists, the caution copy names ONLY that
 *    reason (never also the driver) so the same factor is never repeated.
 *
 * The registry forwarder ({@link isAllowedRunAnalysisAssistantText})
 * is exported here so the only strings the wire ever sees from
 * run_analysis are either a locked template literal or a string this
 * helper could have emitted. The handler is trusted to call into this
 * module; the registry is the second line of defence.
 */

import {
  readResultsArraySources,
  selectWinner,
  readGraph,
  readRecord,
  readNumber,
  readRobustnessLevel,
  buildNodeLabelMap,
} from './decision-review-enricher.js';
import { formatProbabilityMargin } from '../format/format-analysis-value.js';
import { NEAR_TIE_PP_THRESHOLD } from './robustness-honesty.js';
// Two-argument label guard relocated to the lean context module (single
// source of truth, shared with the projection layer). Distinct from the
// one-argument `sanitiseLabel` in src/utils/label-sanitiser.ts.
import { sanitiseLabel } from '../context/enrichment-graph-labels.js';

export const MAX_HEADLINE_CHARS = 220;

/**
 * Minimum win_probability for the leading option before the headline may emit a
 * CONFIDENT "currently leads" (cases A–D). A leader below this threshold is too
 * weak to assert a confident lead, regardless of margin. Calibrated against
 * typical 3-way races: 40% is a plausible plurality; below it reads as "no real
 * leader" for a CONFIDENT claim.
 *
 * SOFT-CONFIDENCE BAND (case 'SC', Area F deterministic-copy hardening). The
 * headline now uses a TWO-FLOOR structure:
 *   - >= MIN_LEAD_PROBABILITY (0.40): a CONFIDENT lead may be claimed (A–D).
 *   - [SC_MIN_LEAD_PROBABILITY, MIN_LEAD_PROBABILITY) i.e. [0.30, 0.40): a
 *     "soft confidence" plurality MAY still be named — but ONLY with explicit
 *     provisional caveating ("…but treat this as provisional…") AND only when it
 *     has a real margin (>= MIN_LEAD_MARGIN) AND a driver/fragility. This
 *     increases honest caveating instead of suppressing the lead entirely.
 *   - < SC_MIN_LEAD_PROBABILITY (0.30): too weak to enrich at all — fall back to
 *     the conservative bare Case E floor ("{label} currently leads."), even with
 *     a real margin + driver/fragility. A very weak fragmented plurality (e.g.
 *     0.24 in a 5-way race) technically leads but must not get an enriched
 *     "currently leads by N percentage points" headline.
 */
const MIN_LEAD_PROBABILITY = 0.4;

/**
 * Lower floor of the soft-confidence band (case 'SC'). Inclusive: a winner at
 * exactly 0.30 qualifies; below 0.30 the SC branch is skipped and the headline
 * falls back to the conservative Case E floor. 0.30 preserves the reviewed
 * 0.30/0.25 case while excluding weaker plurality leads.
 */
const SC_MIN_LEAD_PROBABILITY = 0.3;

/**
 * Float tolerance for the inclusive {@link SC_MIN_LEAD_PROBABILITY} floor. The
 * floor is a pure gating threshold with NO displayed probability to match, so —
 * unlike the margin gate, which rounds to whole percentage points to mirror the
 * rendered "<N> percentage points" — it uses a small epsilon to make the
 * `>= 0.30` boundary robust to IEEE-754 representation noise WITHOUT admitting
 * 0.29x values (the next meaningful step down, 0.299, is ~1e-3 below the floor
 * and stays excluded; the epsilon only absorbs ~1e-16 representation drift).
 */
const SC_PROBABILITY_EPSILON = 1e-9;

/**
 * Minimum margin (winner.win_probability − runner_up.win_probability)
 * required before the headline may say "currently leads". Pads above
 * the existing 1pp near-tie threshold used by the advice-gate copy in
 * post-analysis-advice-gate.ts so headline copy is consistently more
 * conservative than free-text follow-ups. When no runner-up entry
 * carries a finite probability (single-option result) the margin
 * check is waived and only {@link MIN_LEAD_PROBABILITY} applies.
 */
const MIN_LEAD_MARGIN = 0.05;

const PARTIAL_SUFFIX =
  ' The run was flagged as partial — treat as provisional.';
const UNKNOWN_SUFFIX =
  ' The analysis engine reported an unfamiliar status — treat the result with caution.';

export interface AnalysisResultHeadlineInput {
  readonly enrichment: Record<string, unknown>;
  readonly leading_option_id: string;
  readonly status_kind: 'ok' | 'partial' | 'unknown';
  /**
   * Spine A backstop: factor_ids an option intervenes on. The top-driver
   * resolver skips these so an option-controlled lever is never named as the
   * strongest sensitivity driver in the run_analysis headline (the headline
   * reads raw `factor_sensitivity`, bypassing `projectTopDrivers`). Keyed on
   * structural `factor_id` only. Omitted / empty ⇒ no suppression.
   */
  readonly interventionControlledFactorIds?: ReadonlySet<string>;
}

/**
 * Which deterministic case the headline builder picked, or `null` when
 * the locked template is the safe fallback.
 *
 *   A — winner + margin + provisional caution naming the fragile reason
 *   B — winner (+ margin) + driver, robust (no fragility)
 *   C — winner + provisional caution (fragile reason), no margin
 *   D — winner + margin, or integer-percent probability (single-option)
 *   E — minimal floor: `{label} currently leads.`
 *   NT — near-tie / close-call: a positive margin below the meaningful-
 *        lead threshold; flags closeness instead of a confident lead
 *   SC — soft-confidence enriched: winner below the absolute confidence
 *        floor BUT with a real margin (>= MIN_LEAD_MARGIN) and a
 *        driver/fragility available; emits a CAUTIOUS provisional headline
 *        (Case A/C copy shapes) instead of collapsing to the bare Case E
 *        floor. Increases honest caveating rather than suppressing it.
 *   null — fall back to locked template
 *
 * Case E is the link-safe response floor (v5/link-safe). It fires when
 * a clean leading-option label exists but the stronger cases failed
 * because of soft confidence (with no usable margin / driver / fragility)
 * or because a length cap forced an A/B/C/D/NT/SC candidate to be dropped.
 */
export type HeadlineCase = 'A' | 'B' | 'C' | 'D' | 'E' | 'NT' | 'SC' | null;

/**
 * Locked reason class for telemetry. Always present on the descriptor
 * (even when a strong case fired) so call sites can branch deterministically.
 *
 *  - `soft_confidence`        — winner probability below MIN_LEAD_PROBABILITY
 *  - `low_margin`             — margin to runner-up below MIN_LEAD_MARGIN
 *  - `no_driver_no_fragility` — meaningful lead but no driver and no fragility data and Case D length-capped out
 *  - `length_cap`             — driver and/or fragility present but the stronger case exceeded MAX_HEADLINE_CHARS
 *  - `unsafe_label`           — leading option label was missing, ID-shaped, UUID, or otherwise rejected by sanitiseLabel
 *  - `unknown`                — a strong case (A/B/C/D) fired; reason is not applicable
 */
export type HeadlineFallbackReason =
  | 'soft_confidence'
  | 'low_margin'
  | 'no_driver_no_fragility'
  | 'length_cap'
  | 'unsafe_label'
  | 'unknown';

export interface HeadlineDescriptor {
  readonly case: HeadlineCase;
  readonly reason: HeadlineFallbackReason;
  readonly has_leading_option: boolean;
  readonly has_clean_label: boolean;
  readonly has_driver: boolean;
  readonly has_fragility: boolean;
  readonly margin_bucket: 'tight' | 'moderate' | 'comfortable' | null;
}

interface HeadlineResult {
  readonly text: string | null;
  readonly descriptor: HeadlineDescriptor;
}

/**
 * Returns a deterministic headline sentence, or null when fallback to the
 * locked template is the safe choice. The handler should treat null as
 * "use the existing template" — never invent a string from nothing.
 */
export function buildAnalysisResultHeadline(
  input: AnalysisResultHeadlineInput,
): string | null {
  return computeHeadline(input).text;
}

/**
 * Pure introspection helper used by the run_analysis handler to emit
 * `v5.headline.fell_back` telemetry when Case E fires. Shares all
 * internal computation with {@link buildAnalysisResultHeadline}; same
 * pure-function contract (no I/O, no telemetry side effects).
 */
export function describeAnalysisHeadline(
  input: AnalysisResultHeadlineInput,
): HeadlineDescriptor {
  return computeHeadline(input).descriptor;
}

function computeHeadline(input: AnalysisResultHeadlineInput): HeadlineResult {
  const { enrichment, leading_option_id, status_kind, interventionControlledFactorIds } = input;

  // Same-source resolution: the winner label, winner probability, and
  // runner-up probability ALL come from the SAME source array (one of
  // results[], option_comparison[], decision_brief.options[] in priority
  // order). This guards against the round-2 cross-source mixing risk —
  // a clean label from one source paired with stale or inconsistent
  // probability maths from another.
  const winner = resolveWinner(enrichment, leading_option_id);
  if (winner === null) {
    // No source produced a winner with a clean label AND a finite
    // probability — fall back to the locked template. Telemetry reports
    // `unsafe_label` as the predominant cause; could also be "no
    // probability anywhere" but that case is rare and the floor is the
    // same.
    return {
      text: null,
      descriptor: {
        case: null,
        reason: 'unsafe_label',
        has_leading_option: false,
        has_clean_label: false,
        has_driver: false,
        has_fragility: false,
        margin_bucket: null,
      },
    };
  }

  const winnerLabel = winner.label;
  const winnerProbability = winner.winnerProb;
  const driverLabel = resolveTopDriverLabel(enrichment, interventionControlledFactorIds);
  const fragileLabel = resolveFragileLabel(enrichment);
  const suffix = statusSuffix(status_kind);
  const marginBucket = computeMarginBucket(winner);
  const hasDriver = driverLabel !== null;
  const hasFragility = fragileLabel !== null;

  // Margin fragment (copy priority #2): rendered only when a runner-up
  // probability exists in the SAME source. Uses the SSOT formatter
  // (formatProbabilityMargin) — never a hand-rolled multiply, never a raw
  // decimal. In the meaningful-lead branch the margin is guaranteed
  // ≥ MIN_LEAD_MARGIN (≥ 5pp), so it always renders as a plural integer
  // "<N> percentage points".
  const marginText = marginPointsText(winner);
  const marginFragment = marginText !== null ? ` by ${marginText}` : '';

  // Stronger cases only fire when probability/margin gates pass.
  if (hasMeaningfulLead(winner)) {
    if (hasFragility) {
      // Caution shapes (priority #3 + #4): a fragile assumption exists, so name
      // ONLY that one validation reason and frame the result as provisional —
      // never also the driver. This follows the copy priority order (leading
      // option, margin, provisional framing, one specific reason) AND makes the
      // "same factor as both driver and caveat" repetition impossible by
      // construction. Case A = with margin; Case C = margin shed under length.
      const cautionTail =
        `, but treat this as provisional: the result is sensitive to ${fragileLabel}.${suffix}`;
      const caseA = `${winnerLabel} currently leads${marginFragment}${cautionTail}`;
      if (caseA.length <= MAX_HEADLINE_CHARS) {
        return {
          text: caseA,
          descriptor: buildDescriptor('A', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      const caseC = `${winnerLabel} currently leads${cautionTail}`;
      if (caseC.length <= MAX_HEADLINE_CHARS) {
        return {
          text: caseC,
          descriptor: buildDescriptor('C', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Both caution candidates exceeded the length cap — fall through to Case E.
    } else if (hasDriver) {
      // Robust (no fragility): name the driver as the notable factor. Makes no
      // direction claim — "strongest driver" is a magnitude / salience
      // statement, so the PR #221 direction-honest path is not engaged here.
      const driverTail = ` because ${driverLabel} is the strongest driver.${suffix}`;
      const caseBMargin = `${winnerLabel} currently leads${marginFragment}${driverTail}`;
      if (caseBMargin.length <= MAX_HEADLINE_CHARS) {
        return {
          text: caseBMargin,
          descriptor: buildDescriptor('B', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      const caseB = `${winnerLabel} currently leads${driverTail}`;
      if (caseB.length <= MAX_HEADLINE_CHARS) {
        return {
          text: caseB,
          descriptor: buildDescriptor('B', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Length cap exceeded — fall through to Case E.
    } else if (marginText !== null) {
      // No driver, no fragility, but a margin is available — surface it
      // (preferred over a bare probability number per the copy priority order).
      const caseDMargin = `${winnerLabel} currently leads${marginFragment}.${suffix}`;
      if (caseDMargin.length <= MAX_HEADLINE_CHARS) {
        return {
          text: caseDMargin,
          descriptor: buildDescriptor('D', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Length cap exceeded — fall through to Case E.
    } else {
      // No driver, no fragility, no margin (single-option source): keep the
      // existing probability sentence as the most informative honest floor.
      // The probability guard already enforced ≥ MIN_LEAD_PROBABILITY so the
      // rendered integer percentage is always ≥ 40%.
      const pct = Math.round(winnerProbability * 100);
      const caseD =
        `${winnerLabel} currently leads with ${pct}% probability.` +
        ` Run the follow-up checks before treating this as final.${suffix}`;
      if (caseD.length <= MAX_HEADLINE_CHARS) {
        return {
          text: caseD,
          descriptor: buildDescriptor('D', 'unknown', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Length cap exceeded — fall through to Case E.
    }
  } else if (winnerProbability >= MIN_LEAD_PROBABILITY && winner.runnerUpProb !== null) {
    // Near-tie / close-call branch: a plurality leader (≥ MIN_LEAD_PROBABILITY)
    // whose margin to the runner-up is positive but below the meaningful-lead
    // threshold (< MIN_LEAD_MARGIN, i.e. < 5pp). Never emit a bare confident
    // "{label} currently leads." — flag the closeness honestly so a near-tie
    // does not read as a decisive lead.
    const marginRaw = winnerProbability - winner.runnerUpProb;
    if (marginRaw <= 0) {
      // The designated leading option is not actually ahead of the runner-up —
      // do not claim a lead at all; fall back to the locked template.
      return {
        text: null,
        descriptor: buildDescriptor(null, 'low_margin', { hasDriver, hasFragility, marginBucket }),
      };
    }
    // Compare the ROUNDED pp (matching what would be rendered) against the
    // near-tie threshold so floating-point noise at the boundary (e.g.
    // 0.41 - 0.40 = 1.0000000000000009) does not flip the verdict.
    const marginPpRounded = Math.round(marginRaw * 100);
    if (marginPpRounded <= NEAR_TIE_PP_THRESHOLD) {
      // Effectively tied (≤ 1pp): no margin number, no lead-strength claim.
      const caseTied =
        `${winnerLabel} is currently only fractionally ahead, so the options are effectively tied.${suffix}`;
      if (caseTied.length <= MAX_HEADLINE_CHARS) {
        return {
          text: caseTied,
          descriptor: buildDescriptor('NT', 'low_margin', { hasDriver, hasFragility, marginBucket }),
        };
      }
    } else if (marginText !== null) {
      // 1pp < margin < 5pp: a small but real lead — state it, flag closeness.
      const caseClose =
        `${winnerLabel} currently leads${marginFragment}, but the options are close.${suffix}`;
      if (caseClose.length <= MAX_HEADLINE_CHARS) {
        return {
          text: caseClose,
          descriptor: buildDescriptor('NT', 'low_margin', { hasDriver, hasFragility, marginBucket }),
        };
      }
    }
    // A near-tie result must NEVER fall through to the Case E confident floor
    // ("{label} currently leads.") — on a long label the near-tie sentence can
    // exceed MAX_HEADLINE_CHARS while the much shorter Case E line still fits,
    // which would turn a genuine ≤5pp near-tie into a confident lead. When the
    // near-tie copy overflows the cap (pathologically long label) or the margin
    // text is unrenderable, return null so the handler uses the neutral locked
    // template (no lead claim) instead of a confident headline.
    return {
      text: null,
      descriptor: buildDescriptor(null, 'low_margin', { hasDriver, hasFragility, marginBucket }),
    };
  }

  // Soft-confidence enriched branch (V5 deterministic-copy hardening, Area F).
  // The winner sits in the soft-confidence BAND [SC_MIN_LEAD_PROBABILITY,
  // MIN_LEAD_PROBABILITY) i.e. [0.30, 0.40): too soft for the confident
  // meaningful-lead cases (A/B/C/D) and below the near-tie branch above (which
  // only handles plurality leaders >= MIN_LEAD_PROBABILITY), BUT strong enough
  // to name provisionally. With a real margin (>= MIN_LEAD_MARGIN) over a
  // runner-up AND a fragility or driver available, surface a CAUTIOUS provisional
  // headline naming the single most-relevant sensitivity (fragility preferred;
  // never both — preserves the no-repetition invariant) rather than collapsing
  // to the bare Case E floor.
  //
  // Honest by construction: "leads by N percentage points" is a factual
  // plurality statement and "treat this as provisional" caveats the soft
  // confidence — this INCREASES honest caveating rather than suppressing the
  // available ingredients into a bare "currently leads.". Deliberate policy
  // change from the prior "drop driver/fragility at soft confidence" behaviour.
  //
  // Honesty guards retained by the entry condition: very weak plurality leads
  // BELOW SC_MIN_LEAD_PROBABILITY (e.g. 0.24 in a fragmented 5-way race),
  // near-ties (margin < MIN_LEAD_MARGIN), and thin data (no driver AND no
  // fragility) all fall through to Case E — a weak/near-tie plurality must never
  // read as an enriched lead, and we never fabricate a sensitivity reason.
  // Single-option sources (runnerUpProb === null) also fall through (no margin to
  // honestly state).
  //
  // Reuses the Case A (with margin) / Case C (no margin) copy shapes verbatim,
  // so the emitted text already satisfies the registry grammar allowlist
  // (isAllowedRunAnalysisAssistantText) with no new pattern.
  // Compare the ROUNDED pp (matching the rendered "<N> percentage points")
  // against the threshold so floating-point noise at the boundary does not
  // flip the verdict — e.g. 0.30 − 0.25 = 0.04999999999999999 in IEEE-754
  // would spuriously fail a raw `>= 0.05` check while the headline still
  // renders "5 percentage points". Mirrors the rounded comparison the
  // near-tie branch uses above.
  const softConfidenceMarginPp =
    winner.runnerUpProb !== null
      ? Math.round((winner.winnerProb - winner.runnerUpProb) * 100)
      : -1;
  if (
    winner.runnerUpProb !== null &&
    // Soft-confidence BAND: [SC_MIN_LEAD_PROBABILITY, MIN_LEAD_PROBABILITY) i.e.
    // [0.30, 0.40). The lower floor is INCLUSIVE and uses a tiny epsilon (not
    // pp-rounding) because it is a pure threshold with no displayed probability:
    // exactly 0.30 qualifies; 0.29x stays excluded; FP representation noise at
    // 0.30 cannot flip the verdict.
    winner.winnerProb >= SC_MIN_LEAD_PROBABILITY - SC_PROBABILITY_EPSILON &&
    winner.winnerProb < MIN_LEAD_PROBABILITY &&
    softConfidenceMarginPp >= Math.round(MIN_LEAD_MARGIN * 100) &&
    (hasFragility || hasDriver)
  ) {
    const sensitivityTarget = fragileLabel ?? driverLabel;
    if (sensitivityTarget !== null) {
      const cautionTail =
        `, but treat this as provisional: the result is sensitive to ${sensitivityTarget}.${suffix}`;
      // Prefer the margin-bearing shape (Case A grammar); shed the margin under
      // the length cap (Case C grammar) before giving up to Case E.
      const scWithMargin = `${winnerLabel} currently leads${marginFragment}${cautionTail}`;
      if (marginText !== null && scWithMargin.length <= MAX_HEADLINE_CHARS) {
        return {
          text: scWithMargin,
          descriptor: buildDescriptor('SC', 'soft_confidence', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // No-margin SC shape (Case C grammar): fires only when the margin-bearing
      // shape overflowed the length cap (pathologically long label). Even here
      // the winner is within the soft-confidence band [0.30, 0.40) (the entry
      // condition's lower floor already excluded the very weak < 0.30 leads), so
      // it is a caveated, bounded fallback — not a free-for-all sub-40% claim.
      const scNoMargin = `${winnerLabel} currently leads${cautionTail}`;
      if (scNoMargin.length <= MAX_HEADLINE_CHARS) {
        return {
          text: scNoMargin,
          descriptor: buildDescriptor('SC', 'soft_confidence', { hasDriver, hasFragility, marginBucket }),
        };
      }
      // Both shapes overflow the length cap — fall through to Case E below.
    }
  }

  // Case E (link-safe floor): we have a clean winner label but the
  // stronger cases didn't qualify or didn't fit. Output is the minimum
  // non-overclaiming "{Label} currently leads." (+ status suffix).
  // No "best", "winner", "recommended", "optimal", "preferred". No
  // probability number. No driver/fragility clauses.
  const caseE = `${winnerLabel} currently leads.${suffix}`;
  const reason = deriveCaseEReason(winner, driverLabel, fragileLabel);
  if (caseE.length <= MAX_HEADLINE_CHARS) {
    return {
      text: caseE,
      descriptor: buildDescriptor('E', reason, { hasDriver, hasFragility, marginBucket }),
    };
  }

  // Even Case E exceeds the length cap (extremely long sanitised label).
  // Fall back to the locked template.
  return {
    text: null,
    descriptor: buildDescriptor(null, 'length_cap', { hasDriver, hasFragility, marginBucket }),
  };
}

function buildDescriptor(
  caseKind: HeadlineCase,
  reason: HeadlineFallbackReason,
  args: { hasDriver: boolean; hasFragility: boolean; marginBucket: 'tight' | 'moderate' | 'comfortable' | null },
): HeadlineDescriptor {
  return {
    case: caseKind,
    reason,
    has_leading_option: true,
    has_clean_label: true,
    has_driver: args.hasDriver,
    has_fragility: args.hasFragility,
    margin_bucket: args.marginBucket,
  };
}

function deriveCaseEReason(
  winner: ResolvedWinner,
  driverLabel: string | null,
  fragileLabel: string | null,
): HeadlineFallbackReason {
  // Soft confidence: absolute probability gate failed.
  if (winner.winnerProb < MIN_LEAD_PROBABILITY) return 'soft_confidence';
  // Low margin: margin gate failed.
  if (winner.runnerUpProb !== null) {
    const margin = winner.winnerProb - winner.runnerUpProb;
    if (margin < MIN_LEAD_MARGIN) return 'low_margin';
  }
  // Meaningful lead but a stronger case failed. The only reasons we
  // reach Case E at this point are: (a) Case D-shape (no driver, no
  // fragility) overshot the length cap, or (b) a Case A/B/C with
  // driver/fragility overshot it.
  if (driverLabel === null && fragileLabel === null) {
    return 'no_driver_no_fragility';
  }
  return 'length_cap';
}

function computeMarginBucket(
  winner: ResolvedWinner,
): 'tight' | 'moderate' | 'comfortable' | null {
  if (winner.runnerUpProb === null) return null;
  const margin = winner.winnerProb - winner.runnerUpProb;
  if (margin < 0.05) return 'tight';
  if (margin < 0.15) return 'moderate';
  return 'comfortable';
}

/**
 * Render the winner→runner-up margin as the SSOT "<N> percentage points"
 * string, or null when no runner-up probability exists in the same source.
 * Reuses {@link formatProbabilityMargin} (the single source of truth for
 * margin wording); both inputs are pre-validated finite probabilities in
 * {@link resolveWinner}, so the formatter's invalid-input telemetry branch is
 * unreachable on this path. Returns null unless the result matches the
 * canonical "<int> percentage point(s)" shape — defence so a future formatter
 * change can never leak "Not available" (or a decimal) into a headline.
 *
 * MARGIN-OWNERSHIP CONTRACT (follow-up): this composer receives the RAW PLoT
 * envelope before the context-projection path exposes `margin_pp`, so it
 * derives the margin here from same-source PLoT-owned win probabilities. This
 * is an accepted display-only derivation, but `compactAnalysis` computes its
 * own `margin_pp` (rounded to 1 decimal) downstream, so the two can disagree
 * by 1pp at rounding edges. If a canonical `margin_pp` ever becomes available
 * on THIS path, consume it here instead of recomputing.
 */
function marginPointsText(winner: ResolvedWinner): string | null {
  if (winner.runnerUpProb === null) return null;
  const text = formatProbabilityMargin(winner.winnerProb, winner.runnerUpProb);
  return /^\d+ percentage points?$/.test(text) ? text : null;
}

interface ResolvedWinner {
  /** Sanitised label (no ID-shape, trimmed, non-empty). */
  readonly label: string;
  /** Finite winner probability, in [0, 1]. */
  readonly winnerProb: number;
  /**
   * Finite runner-up probability from the SAME source, in [0, 1],
   * or null when no other entry in that source carries a finite
   * probability (e.g., a single-option source, or a runner-up
   * missing its probability field). When null the margin guard is
   * waived; only the absolute probability check applies.
   */
  readonly runnerUpProb: number | null;
}

/**
 * Resolve the leading option's label, its win_probability, AND the
 * runner-up probability — all from the SAME source array in a single
 * pass. Iterates sources in priority order
 * ({@link readResultsArraySources}); a source is accepted only when
 * BOTH the candidate winner has a non-ID-shaped label AND a finite,
 * in-range win_probability. Sources that fail either check are
 * skipped (continue) so a thin/ID-shaped first source can be rescued
 * by a richer subsequent source — but each accepted source provides
 * the full triple, never a label from one and a probability from
 * another.
 *
 * Returns null when no source provides all three signals — the
 * caller treats null as "fall back to the locked template".
 */
function resolveWinner(
  enrichment: Record<string, unknown>,
  leadingOptionId: string,
): ResolvedWinner | null {
  const sources = readResultsArraySources(enrichment);
  if (sources.length === 0) return null;

  const id = leadingOptionId.trim();
  for (const source of sources) {
    const winner = selectWinner(source, id.length > 0 ? id : null);
    if (winner === null) continue;
    const cleanedLabel = sanitiseLabel(winner.label, winner.id);
    if (cleanedLabel === null) continue;

    // Re-read the winner's probability directly from the source.
    // `selectWinner` calls `projectOptionAsWinner` which coerces a
    // missing/non-finite `win_probability` to 0 — that conceals the
    // difference between "explicitly 0" (a legitimate, finite signal
    // for a dominated option) and "missing entirely" (a thin source
    // that should be skipped so a richer downstream source can carry
    // both label and probability). Reading raw lets the skip path
    // fire when the source can't supply a finite probability at all.
    const winnerRaw = source.find((r) => {
      const rId =
        (typeof r.option_id === 'string' && r.option_id) ||
        (typeof r.id === 'string' && r.id) ||
        '';
      return rId === winner.id;
    });
    const winnerProb = winnerRaw ? readNumber(winnerRaw.win_probability) : null;
    if (winnerProb === null || winnerProb < 0 || winnerProb > 1) continue;

    let runnerUpProb: number | null = null;
    for (const raw of source) {
      const rId =
        (typeof raw.option_id === 'string' && raw.option_id) ||
        (typeof raw.id === 'string' && raw.id) ||
        '';
      if (rId === winner.id) continue;
      const p = readNumber(raw.win_probability);
      if (p === null || p < 0 || p > 1) continue;
      if (runnerUpProb === null || p > runnerUpProb) runnerUpProb = p;
    }
    return { label: cleanedLabel, winnerProb, runnerUpProb };
  }
  return null;
}

/**
 * Predicate: does the resolved winner support a "currently leads"
 * headline? Two gates:
 *   1. Winner probability ≥ MIN_LEAD_PROBABILITY (an absolute floor —
 *      a leader below 40% is a "no real leader" race regardless of
 *      margin).
 *   2. If a runner-up probability exists in the same source, the
 *      margin must be ≥ MIN_LEAD_MARGIN. Single-option sources
 *      (runnerUpProb === null) waive the margin check.
 */
function hasMeaningfulLead(winner: ResolvedWinner): boolean {
  if (winner.winnerProb < MIN_LEAD_PROBABILITY) return false;
  if (winner.runnerUpProb !== null) {
    const margin = winner.winnerProb - winner.runnerUpProb;
    if (margin < MIN_LEAD_MARGIN) return false;
  }
  return true;
}

function statusSuffix(kind: AnalysisResultHeadlineInput['status_kind']): string {
  if (kind === 'partial') return PARTIAL_SUFFIX;
  if (kind === 'unknown') return UNKNOWN_SUFFIX;
  return '';
}

interface DriverCandidate {
  readonly label: string;
  readonly score: number;
}

function resolveTopDriverLabel(
  enrichment: Record<string, unknown>,
  controlledFactorIds?: ReadonlySet<string>,
): string | null {
  const arr = enrichment.factor_sensitivity;
  if (!Array.isArray(arr)) return null;

  let best: DriverCandidate | null = null;
  for (const raw of arr) {
    const entry = readRecord(raw);
    if (!entry) continue;
    const idGuess =
      (typeof entry.factor_id === 'string' && entry.factor_id) ||
      (typeof entry.id === 'string' && entry.id) ||
      '';
    // Spine A backstop: never name an option-controlled lever as the strongest
    // driver. Match on the SAME id the analysis keys factors by — `node_id`
    // first (mirroring compactAnalysis's `node_id ?? factor_id` precedence), so
    // a lever is suppressed even when a PLoT entry carries only `node_id`.
    // Structural id only; never the label.
    const controlledMatchId =
      (typeof entry.node_id === 'string' && entry.node_id) || idGuess;
    if (
      controlledFactorIds !== undefined &&
      controlledMatchId.length > 0 &&
      controlledFactorIds.has(controlledMatchId)
    ) {
      continue;
    }
    const rawLabel =
      (typeof entry.factor_label === 'string' && entry.factor_label) ||
      (typeof entry.label === 'string' && entry.label) ||
      '';
    const label = sanitiseLabel(rawLabel, idGuess);
    if (label === null) continue;

    const score = computeDriverScore(entry);
    if (score === null) continue;
    if (best === null || score > best.score) {
      best = { label, score };
    } else if (score === best.score && label.localeCompare(best.label) < 0) {
      best = { label, score };
    }
  }
  return best?.label ?? null;
}

function computeDriverScore(entry: Record<string, unknown>): number | null {
  const sensitivity = readNumber(entry.sensitivity_score);
  if (sensitivity !== null) return Math.abs(sensitivity);
  const elasticity = readNumber(entry.elasticity);
  if (elasticity === null) return null;
  const confidence = readNumber(entry.confidence);
  return Math.abs(elasticity) * (confidence ?? 1);
}

function resolveFragileLabel(enrichment: Record<string, unknown>): string | null {
  // Robust scenarios skip the fragility clause entirely.
  const level = readRobustnessLevel(enrichment);
  if (level === 'high') return null;

  const rob = readRecord(enrichment.robustness);
  if (!rob) return null;
  const fragile = rob.fragile_edges;
  if (!Array.isArray(fragile) || fragile.length === 0) return null;

  const labelMap = buildNodeLabelMap(readGraph(enrichment));

  let bestLabel: string | null = null;
  let bestProb = -Infinity;
  for (const raw of fragile) {
    const entry = readRecord(raw);
    if (!entry) continue;
    const prob = readNumber(entry.switch_probability) ?? 0;
    const label = pickFragileEdgeLabel(entry, labelMap);
    if (label === null) continue;
    if (prob > bestProb) {
      bestProb = prob;
      bestLabel = label;
    }
  }
  return bestLabel;
}

function pickFragileEdgeLabel(
  edge: Record<string, unknown>,
  labelMap: Map<string, string>,
): string | null {
  const directFrom =
    typeof edge.from_label === 'string' && edge.from_label.length > 0
      ? edge.from_label
      : null;
  const directTo =
    typeof edge.to_label === 'string' && edge.to_label.length > 0
      ? edge.to_label
      : null;
  const fromId =
    typeof edge.from_node_id === 'string' && edge.from_node_id.length > 0
      ? edge.from_node_id
      : null;
  const toId =
    typeof edge.to_node_id === 'string' && edge.to_node_id.length > 0
      ? edge.to_node_id
      : null;

  const resolvedFrom = directFrom ?? (fromId ? labelMap.get(fromId) ?? null : null);
  const resolvedTo = directTo ?? (toId ? labelMap.get(toId) ?? null : null);

  const idGuessFrom = fromId ?? '';
  const idGuessTo = toId ?? '';

  const cleanFrom = resolvedFrom !== null ? sanitiseLabel(resolvedFrom, idGuessFrom) : null;
  if (cleanFrom !== null) return cleanFrom;
  const cleanTo = resolvedTo !== null ? sanitiseLabel(resolvedTo, idGuessTo) : null;
  return cleanTo;
}

// `sanitiseLabel` is imported from ../context/enrichment-graph-labels.ts.

// ============================================================================
// Registry-side allowlist for run_analysis assistant_text
// ============================================================================
//
// The validation-registry forwarder ({@link
// ../routing/validation-registry.ts}) calls into this module so the wire
// only ever sees strings the handler is permitted to emit:
//   1. An exact match for one of the locked RUN_ANALYSIS_ASSISTANT_TEMPLATES
//      values (kept in sync below — see the `RUN_ANALYSIS_LOCKED_TEMPLATES`
//      constant), OR
//   2. A string that satisfies the deterministic headline grammar
//      defined here (single-line, length-capped, no forbidden vocabulary,
//      no internal-ID prefixes, no raw decimals, must contain the
//      "currently leads" anchor, must end with a period).
//
// A regressed handler emitting arbitrary prose — even if the prose
// happens to contain the substring "currently leads" — is rejected by
// the structural rules below and falls back to the locked template.

/**
 * Exact-match set mirroring `RUN_ANALYSIS_ASSISTANT_TEMPLATES` in
 * `../tools/handlers/run-analysis.ts`. Kept here as a frozen
 * compile-time constant so the registry forwarder can do a strict
 * `.has()` membership test without importing the handler module
 * (which would cause an undesirable dependency cycle). The pinned
 * test `analysis-result-headline.test.ts > locked templates kept in
 * sync` verifies these values match the handler's source of truth.
 */
export const RUN_ANALYSIS_LOCKED_TEMPLATES: ReadonlySet<string> = new Set([
  'Ran analysis on your current scenario.',
  'Ran analysis on your current scenario. No options were compared.',
  'Ran analysis on your current scenario. Some results may be incomplete — treat with caution.',
  'Ran analysis on your current scenario. The analysis engine reported an unfamiliar status — treat the result with caution.',
  'Ran analysis on your current scenario. The engine flagged the run as partial and produced no option comparisons — treat with caution.',
]);

/**
 * Forbidden vocabulary in any run_analysis assistant_text. Case-
 * insensitive substring / word-boundary checks; mirrors the spirit of
 * the broader forbidden-user-facing-phrases list but narrowed to the
 * headline-relevant prescriptive terms.
 */
const FORBIDDEN_HEADLINE_VOCABULARY_REGEX =
  /\b(?:recommend(?:s|ed|ation|ations)?|winners?|best|optimal|preferred)\b/i;

/**
 * Slug-shape ID prefixes. Mirrors the runtime ID-prefix detector used
 * by {@link sanitiseLabel}, but applied to the whole assistant_text
 * — a regressed handler that interpolates `opt_a` into its prose
 * would be caught here even when the headline builder's label
 * sanitiser was bypassed.
 */
const ASSISTANT_TEXT_ID_REGEX = /\b(?:opt|goal|fac|node|edge|n|e)_[a-z0-9_]+/i;

/**
 * Raw decimals: `\d+\.\d+`. The headline only emits integer
 * percentages ("62%"); any decimal in the text suggests improvised
 * prose.
 */
const RAW_DECIMAL_REGEX = /\d+\.\d+/;

/**
 * Headline grammar regex set — mirrors the exact Case A/B/C/D/E shapes
 * {@link buildAnalysisResultHeadline} can emit, optionally followed
 * by one of the two status-suffix sentences. The placeholders
 * (winner label, driver label, fragility label, integer probability)
 * match any non-newline character sequence; the SURROUNDING tokens
 * are pinned verbatim so improvised prose containing only the
 * "currently leads" anchor (e.g. "Hire A currently leads for reasons
 * outside the deterministic headline grammar.") cannot satisfy the
 * grammar. Case E ("{label} currently leads.") is the link-safe
 * floor — it is the only pattern where the leading "currently leads"
 * anchor is followed immediately by a literal period; cases A/B/C/D
 * all extend with "because", ", but", or "with N% probability" before
 * the terminal period.
 *
 * Defence-in-depth rules (length cap, no newlines, no forbidden
 * vocabulary, no ID prefixes, no raw decimals) still apply on top of
 * the grammar match — a label slot or driver slot that happened to
 * contain forbidden vocabulary would still be rejected after the
 * grammar matches.
 *
 * Each pattern uses lazy `.+?` so the engine prefers shorter slot
 * matches and the trailing `\.${STATUS_SUFFIX}$` anchor pins the
 * terminator. The lazy quantifier prevents the regex from skipping
 * across a legitimate sentence boundary inside an unusual label.
 */
function escapeForRegex(source: string): string {
  return source.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
const PARTIAL_SUFFIX_RE_SRC = escapeForRegex(PARTIAL_SUFFIX);
const UNKNOWN_SUFFIX_RE_SRC = escapeForRegex(UNKNOWN_SUFFIX);
const STATUS_SUFFIX_PATTERN = `(?:${PARTIAL_SUFFIX_RE_SRC}|${UNKNOWN_SUFFIX_RE_SRC})?`;

const HEADLINE_GRAMMAR_REGEXES: ReadonlyArray<RegExp> = [
  // Case A: winner + margin + provisional caution naming the fragile reason.
  new RegExp(
    `^.+? currently leads by \\d{1,3} percentage points?, but treat this as provisional: the result is sensitive to .+?\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case C: provisional caution naming the fragile reason, no margin.
  new RegExp(
    `^.+? currently leads, but treat this as provisional: the result is sensitive to .+?\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case B (with margin): winner + margin + driver.
  new RegExp(
    `^.+? currently leads by \\d{1,3} percentage points? because .+? is the strongest driver\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case B (no margin): winner + driver.
  new RegExp(
    `^.+? currently leads because .+? is the strongest driver\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case D (margin only): winner + margin.
  new RegExp(
    `^.+? currently leads by \\d{1,3} percentage points?\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case D (probability): winner + integer-percentage probability + nudge.
  new RegExp(
    `^.+? currently leads with \\d{1,3}% probability\\. Run the follow-up checks before treating this as final\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case NT (close): small but real lead, flagged as close.
  new RegExp(
    `^.+? currently leads by \\d{1,3} percentage points?, but the options are close\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case NT (tied): effectively tied, no margin number.
  new RegExp(
    `^.+? is currently only fractionally ahead, so the options are effectively tied\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case E (link-safe floor): minimal "{label} currently leads.{suffix}".
  // MUST stay last — the trailing `\\.${STATUS_SUFFIX_PATTERN}$` anchor is
  // strictly less specific than the other cases and would not match their
  // outputs (those extend "leads" with " by N percentage points", "because",
  // ", but", "with N% probability", or " is currently only fractionally
  // ahead" before the terminal period), so ordering is for clarity rather
  // than correctness.
  new RegExp(`^.+? currently leads\\.${STATUS_SUFFIX_PATTERN}$`),
];

function matchesHeadlineGrammar(text: string): boolean {
  for (const re of HEADLINE_GRAMMAR_REGEXES) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Returns true when `text` is a string the run_analysis handler is
 * permitted to expose on the wire — either an exact locked-template
 * literal, or a string that satisfies the deterministic headline
 * grammar end-to-end. The validation-registry forwarder uses this as
 * the second line of defence: if a future handler regression emits
 * improvised prose, the forwarder substitutes the locked-template
 * fallback instead of letting the prose through.
 *
 * Rules (in order):
 *   1. Must be a non-empty string.
 *   2. Must be at most {@link MAX_HEADLINE_CHARS}.
 *   3. Must not contain newline characters.
 *   4. Locked-template literals pass exactly (case-sensitive).
 *   5. Otherwise must match one of the five headline grammar regexes
 *      ({@link HEADLINE_GRAMMAR_REGEXES}) — Case A/B/C/D/E with an
 *      optional partial / unknown status suffix. Anchor-only prose
 *      that lacks the surrounding tokens (e.g. "Hire A currently leads
 *      for reasons outside the deterministic grammar.") is rejected by
 *      the case-E literal-period anchor. Cases A/B/C/D extend the
 *      anchor with "because", ", but", or "with N% probability" before
 *      the terminal period.
 *   6. Even when the grammar matches, the following defence-in-depth
 *      rules still apply:
 *        - no forbidden vocabulary (recommend / winner / best / …)
 *        - no ID-prefix tokens (opt_, fac_, …)
 *        - no raw decimal numbers (only integer % allowed)
 */
export function isAllowedRunAnalysisAssistantText(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  if (text.length === 0 || text.length > MAX_HEADLINE_CHARS) return false;
  if (text.includes('\n') || text.includes('\r')) return false;
  if (RUN_ANALYSIS_LOCKED_TEMPLATES.has(text)) return true;
  if (!matchesHeadlineGrammar(text)) return false;
  // Defence-in-depth: grammar-shaped but content-leaky strings still
  // fail. A slot filler that happens to contain forbidden vocabulary
  // or an internal ID is caught here even though the surrounding
  // grammar matched.
  if (FORBIDDEN_HEADLINE_VOCABULARY_REGEX.test(text)) return false;
  if (ASSISTANT_TEXT_ID_REGEX.test(text)) return false;
  if (RAW_DECIMAL_REGEX.test(text)) return false;
  return true;
}
