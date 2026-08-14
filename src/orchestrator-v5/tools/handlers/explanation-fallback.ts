/**
 * Deterministic fallback composers for the V5 explanation handlers.
 *
 * Called when Sonnet's `answer_text` is missing, too short, or fails the
 * side-band quality check. Each composer formats existing fields from the
 * already-assembled context pack into a natural paragraph that reads as
 * Olumi explaining — never a bullet list, never a template dump.
 *
 * F.6 invariant: format only. Sort and slice; do NOT calculate new metrics,
 * derive new margins, or synthesise causality. Numeric values are surfaced
 * via the centralised formatters in `format-analysis-value.ts` (Phase 2
 * workstream C): probabilities render as percentages, margins as
 * percentage points, sensitivities and edge strengths pass through raw
 * (their range is not normalised; surfacing them as percentages would
 * misrepresent the underlying signal).
 *
 * Copy rules:
 *  - Sentence case, British English.
 *  - No em dashes (use commas or full stops).
 *  - No tone words like winner or recommended; say leading option, performs best.
 *  - No internal vocabulary; never reference graph internals or pipeline stages.
 *  - One next-step nudge at the end so the response is actionable.
 */

import type {
  AnalysisProjectionSummary,
  AnalysisProjectionDriver,
  StructureProjectionSummary,
} from '../../context/projection-summaries.js';
// ROADMAP 2.1067: `formatPercentagePoints` is deliberately NOT imported here
// any more. This module composed the last two deterministic sentences that
// rendered the runner-up gap as a magnitude; with those retired, the only
// percentage this file may speak is an option's OWN win share.
import { formatProbability } from '../../format/format-analysis-value.js';
import { bandFromMagnitude } from '../../format/influence-bands.js';
import {
  formatSensitivityDirection,
  hasMaterialInfluence,
} from '../../format/sensitivity-phrases.js';
import {
  describeRobustnessBand,
  isNearTieByMargin,
  isRawFragile,
  quoteLabel,
  type RawRobustnessSignals,
} from '../../coaching/robustness-honesty.js';
import {
  resolveAgreedAlternativeWinner,
  type FlipSummary,
} from '../../compose/flip-proposal.js';
// The conversational layer inherits the ANALYSE turn's disclosure from the ONE
// module that owns it — never a second copy of the words (CLAUDE.md trap 12).
import {
  buildDefaultedAssumptionsDisclosure,
  type DefaultedAssumptionsSignal,
} from '../../coaching/pick-defaulted-assumptions.js';

export { formatSensitivityDirection };

/**
 * Canonical `'fragile'` band — when the projection already canonicalises
 * the upstream verdict to fragile, treat that as a fragility signal even
 * when raw `enrichment.robustness` is unavailable (older facts, dropped
 * envelope). Kept as a tiny named constant so the equality check below
 * reads intentionally rather than as a magic string.
 */
const CANONICAL_FRAGILE_BAND = 'fragile';

/**
 * The one sentence that states a POSITIVE producer attestation that nothing
 * flips in range, in the `flip` voice.
 *
 * ⭐ EXPORTED, AND THAT IS THE POINT (ROADMAP 2.278 continued, 14 Aug 2026).
 * It was an inline literal here, reachable only through
 * `composeWhatWouldFlipFallback` — i.e. only when the turn is ROUTED to the
 * `what_would_flip` handler. It is witnessed doing so on a FREE-TEXT turn
 * (`source: 'composer'`, `chip: null`, one routing call) at
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/deploy-witness-946-944-20260814T015916Z/step2-golden-journey/step-E7_FLIP_QUESTION.json`.
 *
 * The OTHER free-text path to the same question —
 * `routing/post-analysis-advice-gate.ts::composeWhatWouldFlip`, which the
 * `what_would_flip_free_text` advice class takes with ZERO LLM calls — said
 * nothing at all on an attested-no-flip run:
 * `olumi-docs/PHASE0-EVIDENCE-2026-07-28/p1-conversation-derivation-2026-08-14/raw/run-1/step-Q2_WHAT_WOULD_CHANGE.json`
 * (0 LLM calls, no flip content, on a run whose three `flip_thresholds` rows
 * were ALL `flip_reason: "structurally_invariant"` / `no_flip_in_range: true`).
 *
 * ⚠ The distinction is HANDLER-vs-ADVICE-GATE, not chip-click-vs-free-text: an
 * earlier draft of this docstring said "the CHIP-CLICK answer", and no
 * chip-click flip turn exists in either capture cited here (caught in review of
 * #947). Both witnessed turns are free text; what differs is which composer
 * owns them.
 *
 * That composer's own header already declares the invariant this export serves:
 * *"the same voice `composeWhatWouldFlipFallback` uses, so the chip-click
 * fallback and the free-text answer to 'what would flip this?' cannot disagree
 * about either axis."* They disagreed about the flip axis, because the sentence
 * had no owner to import. It has one now — restating it at the second call site
 * would be the hand-maintained-mirror class (CLAUDE.md trap 12).
 */
export const ATTESTED_NO_FLIP_SENTENCE =
  'Within the tested range, no single factor on its own reached a tipping point that would change which option leads.';

/**
 * SINGLE near-tie derivation shared by BOTH deterministic post-analysis
 * composers (`composeExplainResultsFallback` and `composeWhatWouldFlipFallback`).
 *
 * The two fallbacks narrate the SAME analysis on the SAME turn, so they must
 * never disagree about whether the result is a near-tie — the S4 defect PR #270
 * fixes is exactly that contradiction (explain: "the lead is meaningful"; flip:
 * "effectively tied"). Round 1 unified the THRESHOLD (`isNearTieByMargin`) but
 * left the CALLS divergent: explain passed a hard-coded `null` raw signal while
 * flip passed the real `rawRobustness`, so the `near_tie.is_tie` override
 * (which fires even on a wider-than-threshold margin) flipped flip to "tied"
 * while explain still claimed a meaningful lead.
 *
 * Routing BOTH composers through this one helper, with the SAME
 * `(projection.margin_pp, rawRobustness)` pair, makes that class of drift
 * unrepresentable: there is one derivation, not two hand-synced call sites.
 * Both handlers receive `invocation.rawRobustness` from the same prior-fact
 * source under the same same-run guard (turn-executor: only when
 * `analysisStateSource !== 'request'`), so the argument is genuinely identical.
 */
function classifyNearTie(
  projection: RobustnessVerdictInput,
  rawRobustness: RawRobustnessSignals | null,
): boolean {
  return isNearTieByMargin(projection.margin_pp, rawRobustness);
}

/**
 * Mode selector for the shared robustness-verdict composer. The two
 * post-analysis fallbacks narrate the SAME verdict in two voices: `explain`
 * describes the standing result, `flip` frames what could change it. The
 * VERDICT itself (the near-tie classification, the stability band, and — the
 * round-3 fix — their JOINT resolution) is computed ONCE; `mode` only selects
 * the surface phrasing of an already-decided category. It never re-derives the
 * verdict, so the two composers cannot drift on it.
 */
export type RobustnessVerdictMode = 'explain' | 'flip';

/**
 * The margin axis: how big the gap between the leading option and the
 * runner-up is. `near_tie` (gap within noise, or the raw override), `clear`
 * (a finite, above-threshold lead), or `indeterminate` (no finite margin and
 * not a near-tie).
 */
export type RobustnessMarginCategory = 'near_tie' | 'clear' | 'indeterminate';

/**
 * The stability axis: how steady each option's OWN score is under variation.
 * Deliberately ORTHOGONAL to the margin axis — a result can be a near-tie
 * (tiny gap) AND stable (each score individually steady). Conflating the two
 * is exactly the S4 defect: "too close to call" (margin) was stitched to
 * "should hold under reasonable variation" (stability) as if they were the
 * same claim.
 */
export type RobustnessStabilityCategory = 'fragile' | 'stable' | 'moderate' | 'unknown';

/**
 * The minimal analysis shape {@link composeRobustnessVerdict} reads.
 *
 * Declared structurally (rather than as `AnalysisProjectionSummary`) so EVERY
 * surface that composes robustness prose can route through the one composer
 * without first assembling a full projection. `AnalysisProjectionSummary`
 * satisfies it as-is; the free-text advice gate adapts its own
 * `AdviceGateAnalysis` onto it. This is what makes "one verdict, many voices"
 * mechanically enforceable instead of a convention.
 */
export interface RobustnessVerdictInput {
  readonly leading_option: { readonly label: string } | null;
  readonly runner_up: { readonly label: string; readonly probability?: number } | null;
  readonly margin_pp: number | null | undefined;
  readonly robustness_band: string | null | undefined;
}

/**
 * The SINGLE joint margin+stability verdict for one post-analysis turn.
 *
 * `headline` is the categorical identity of the matrix cell
 * (`<margin>:<stability>`) — the proof that `margin_clause` and
 * `stability_clause` were built from the SAME category, so they cannot
 * contradict. `stability_implies_flippability` lets the flip composer gate a
 * "could shift / could change" stability claim on its own
 * `margin_supports_flip` evidence; a stable "less likely to flip" line makes
 * no flippability claim and is never gated.
 */
export interface RobustnessVerdict {
  readonly headline: `${RobustnessMarginCategory}:${RobustnessStabilityCategory}`;
  /**
   * The margin axis as a first-class value. Surfaces that need their OWN
   * wording (the free-text advice gate's sentences are longer and differently
   * voiced than the fallbacks') branch on THIS instead of re-deriving the
   * near-tie themselves. Round 4: re-derivation is exactly how the live advice
   * gate drifted from the fallbacks.
   */
  readonly margin_category: RobustnessMarginCategory;
  /**
   * The stability axis as a first-class value. Note it is ORTHOGONAL to the
   * margin: a near-tie does NOT make a result fragile. Reading fragility off
   * the margin axis was the round-3 defect in the advice-gate composers.
   */
  readonly stability_category: RobustnessStabilityCategory;
  readonly margin_clause: string | null;
  readonly stability_clause: string | null;
  readonly stability_implies_flippability: boolean;
  /**
   * The ENGINE's own defaulted-value disclosure for this analysis, or `null`.
   *
   * ⭐ WHY IT RIDES THE VERDICT RATHER THAN EACH FALLBACK. Both post-analysis
   * fallbacks narrate the SAME run, so the disclosure must be decided ONCE and
   * in the same place as the stability verdict it suppresses — otherwise one
   * composer can drop the caveat while the other keeps it, which is the exact
   * S4 drift class this function was centralised to make unrepresentable.
   */
  readonly defaulted_disclosure: string | null;
}

/**
 * The ONE composer for the margin verdict and the stability verdict. They are
 * not two independent sentences — they are one claim about how robust the
 * result is, so they are built TOGETHER here and both post-analysis fallbacks
 * route their margin/stability sentences through this function.
 *
 * The joint rule that kills the S4 contradiction: on a NEAR-TIE the confident
 * "should hold under reasonable variation" reassurance is NEVER emitted, even
 * when the band is stable — a near-tie means the leading option itself is in
 * doubt. Instead a stable near-tie earns honest dual-axis copy ("each option's
 * own score is individually stable, so this is a genuine dead heat rather than
 * noise"): the GAP is within noise while each SCORE is steady. Both truths, no
 * contradiction.
 *
 * F.6 invariant: format only. This reads `projection.margin_pp`,
 * `projection.robustness_band`, the option labels/probabilities, and the raw
 * robustness signal; it never computes a new metric.
 */
export function composeRobustnessVerdict(
  projection: RobustnessVerdictInput,
  rawRobustness: RawRobustnessSignals | null,
  mode: RobustnessVerdictMode,
  defaultedAssumptions: DefaultedAssumptionsSignal | null = null,
): RobustnessVerdict {
  const leading = projection.leading_option;
  const runner = projection.runner_up;
  const band = projection.robustness_band;

  // Margin must be a finite number before this composer may call the lead
  // CLEAR; null / NaN / Infinity fall through to the `indeterminate` arm so we
  // never assert a standing on a phantom lead. Since ROADMAP 2.1067 the margin
  // is a DECIDER only — no arm renders it — so this guard now protects the
  // VERDICT rather than a rendered number.
  const finiteMargin: number | null =
    typeof projection.margin_pp === 'number' && Number.isFinite(projection.margin_pp)
      ? projection.margin_pp
      : null;

  // ONE near-tie derivation (round-2 SSOT): shared inputs, shared threshold,
  // shared raw `near_tie.is_tie` override — via the same classifyNearTie both
  // composers used before this refactor centralised the copy too.
  const nearTie = classifyNearTie(projection, rawRobustness);
  const marginCat: RobustnessMarginCategory = nearTie
    ? 'near_tie'
    : finiteMargin !== null
      ? 'clear'
      : 'indeterminate';

  // Stability axis, computed independently of the margin. Fragile wins on
  // either the raw level OR the canonical band (older facts may carry only the
  // canonicalised verdict).
  const fragile = isRawFragile(rawRobustness) || band === CANONICAL_FRAGILE_BAND;
  const measuredStability: RobustnessStabilityCategory = fragile
    ? 'fragile'
    : band === 'stable' || band === 'highly_stable'
      ? 'stable'
      : band === 'moderate'
        ? 'moderate'
        : 'unknown';

  // ── DEFAULTED VALUES COLLAPSE THE STABILITY AXIS TO `unknown` ───────────
  //
  // ⚠⚠ THE WORST LINE IN THE 13 Aug DEPLOYED WITNESS. On an ORDINARY CHAT TURN,
  // with `analysis_ready.options[].status = needs_encoding` on the same payload,
  // the flip fallback recited the numbers and then added:
  //
  //   "This result looks stable, so smaller changes are less likely to flip
  //    the outcome on their own."
  //
  // A confidence claim, stacked on numbers the product itself calls
  // placeholders. The ANALYSE turn discloses correctly
  // (`coaching/scaffold-disclosure.ts`); the conversational recitation dropped
  // the disclosure and then asserted stability over it.
  //
  // ⭐⭐ THE SUPPRESSION LANDS ON THE CATEGORY, NOT ON THE CLAUSE, AND THAT IS
  // THE WHOLE POINT. `stability_clause` is only ONE of this verdict's readers.
  // The free-text advice gate (`routing/post-analysis-advice-gate.ts`) reads
  // `stability_category` and writes its OWN sentences from it — five call
  // sites. Nulling the clause would have fixed the two fallbacks and left the
  // gate asserting the same thing in its own words: a fix that updates two of
  // three readers REPRODUCES the defect it closes. Collapsing the axis makes
  // every reader stand down at once, and a reader added later inherits it
  // without needing to know this rule exists (CLAUDE.md trap 12: derive, don't
  // mirror; trap 21: one concept, several readers).
  //
  // ⭐ `unknown` IS THE TRUTHFUL VALUE, not a fail-safe fiction. This axis
  // means "how steady is each option's OWN score under variation". Measured
  // over defaulted inputs, that is genuinely not known — and `unknown` is
  // already a member of the type, already handled by every consumer as
  // "omit, no overclaim". Nothing new has to be taught to anybody.
  //
  // ⭐ MODE-BLIND AND DIRECTION-BLIND. Suppressing only the REASSURING arms
  // would leave the FRAGILITY arms making the same class of claim in the other
  // direction. The question is not whether the claim is comforting, it is
  // whether the run supports it (CLAUDE.md trap 22b: one predicate must not be
  // asked to police two opposite harms with one window).
  //
  // The MARGIN axis is deliberately untouched: it states each option's OWN win
  // share, which is what the analysis returned. The recitation is QUALIFIED by
  // the disclosure below, never withheld — withholding the standing result
  // would trade a dishonest answer for no answer, which the ratified per-field
  // egress ruling rejects.
  const defaultedDisclosure =
    defaultedAssumptions !== null && defaultedAssumptions.count > 0
      ? buildDefaultedAssumptionsDisclosure(defaultedAssumptions)
      : null;
  const stabilityCat: RobustnessStabilityCategory =
    defaultedDisclosure !== null ? 'unknown' : measuredStability;

  const headline = `${marginCat}:${stabilityCat}` as RobustnessVerdict['headline'];
  const stabilityPhrase = describeRobustnessBand(band);

  // ---- margin_clause (mode-specific voice; needs a runner-up label) ----
  //
  // ⚠ ROADMAP 2.1067 — THIS CLAUSE IS THE SOLE OWNER OF THE POST-ANALYSIS
  // RUNNER-UP STANDING SENTENCE, and it states NO gap magnitude.
  //
  // Until 2026-08-11 the `clear` arm read "That is ahead of {runner} by {N}
  // percentage points" / "the lead of {N} percentage points would need to
  // close", and `post-analysis-advice-gate.ts` carried a SECOND, copy-identical
  // pair of its own. PR #906 had already retired that sentence family from the
  // run_analysis headline: the number is the difference between two P(argmax)
  // statistics, it invites "N% better" — which it is not — and it INFLATES BY
  // CONSTRUCTION, because the gap is a function of the whole field, so a third
  // option collapsing widens it with no improvement in the leader at all.
  //
  // The #906 shape is followed exactly: the margin is still the DECIDER
  // (`marginCat`/`finiteMargin` gate this branch, unchanged) and is no longer
  // the DISPLAY. What each arm reports instead is each option's OWN win share —
  // the leader's is already stated by the opener one sentence earlier in both
  // fallbacks, so the runner-up's fragment completes the pair without ever
  // performing the subtraction.
  //
  // The QUALITATIVE verdict the margin earns ("meaningful rather than
  // marginal") is deliberately KEPT. It is a claim about whether the lead is
  // real, which is precisely what the margin is the right input to decide; only
  // the magnitude was the wrong thing to say out loud.
  //
  // The probability fragment is guarded because `RobustnessVerdictInput` admits
  // surfaces (the advice gate) whose option shape carries no probability — omit
  // the fragment rather than render "Not available".
  let margin_clause: string | null = null;
  if (leading && runner) {
    const runnerP = runner.probability;
    const runnerPFragment =
      typeof runnerP === 'number' && Number.isFinite(runnerP)
        ? `, with a probability of ${formatProbability(runnerP)}`
        : '';
    if (marginCat === 'near_tie') {
      margin_clause =
        mode === 'explain'
          ? `${quoteLabel(leading.label)} and ${quoteLabel(runner.label)} are effectively tied, so the lead is too close to call without firming up the key assumptions.`
          : `${quoteLabel(leading.label)} and ${quoteLabel(runner.label)} are effectively tied.`;
    } else if (marginCat === 'clear' && finiteMargin !== null) {
      margin_clause =
        mode === 'explain'
          ? `${quoteLabel(runner.label)} sits in second place${runnerPFragment}, so the lead is meaningful rather than marginal.`
          : `${quoteLabel(runner.label)} is the most likely contender to overtake it${runnerPFragment}.`;
    } else {
      // indeterminate: no finite margin and not a near-tie.
      margin_clause =
        mode === 'explain'
          ? `${quoteLabel(runner.label)} sits in second place${runnerPFragment}.`
          : `${quoteLabel(runner.label)} is the most likely contender to overtake it.`;
    }
  }

  // ---- stability_clause (JOINTLY resolved with the margin verdict) ----
  let stability_clause: string | null = null;
  let stability_implies_flippability = false;

  if (mode === 'explain') {
    if (marginCat === 'near_tie') {
      // ROUND-3 FIX: never the confident "should hold" line on a near-tie. A
      // stable near-tie earns the honest dual-axis reading; moderate / fragile
      // / unknown near-ties rely on the margin clause's "too close to call,
      // firm up the key assumptions" caveat and add no stability sentence.
      if (stabilityCat === 'stable') {
        stability_clause =
          "Each option's own score is individually stable, so this is a genuine dead heat rather than noise in the estimates.";
      }
    } else if (stabilityCat === 'stable' && stabilityPhrase !== null) {
      // Clear / indeterminate lead: the "should hold" reassurance is honest
      // only because the lead is NOT a near-tie.
      stability_clause = `This result looks ${stabilityPhrase}, so it should hold under reasonable variation.`;
    } else if (stabilityCat === 'moderate' && stabilityPhrase !== null) {
      stability_clause = `This result looks ${stabilityPhrase}, but it is worth checking the main assumptions before deciding.`;
    }
  } else {
    // flip mode. Fragility is the most specific warning, so it outranks the
    // near-tie closeness line; the stable-band line comes last and only on a
    // finite (clear) margin.
    if (stabilityCat === 'fragile') {
      stability_clause =
        'The picture appears fragile, so even small adjustments to the strongest drivers could shift which option leads.';
      stability_implies_flippability = true;
    } else if (marginCat === 'near_tie') {
      stability_clause =
        'The result is sensitive to small movements in the strongest drivers, so the leading option could change without much shifting.';
      stability_implies_flippability = true;
    } else if (
      marginCat === 'clear'
      && stabilityCat === 'stable'
      && stabilityPhrase !== null
    ) {
      stability_clause = `This result looks ${stabilityPhrase}, so smaller changes are less likely to flip the outcome on their own.`;
    }
    // moderate, unknown, or indeterminate-stable → omit (no overclaim).
  }

  // ⭐ AND THE SECOND HALF, WHICH THE CATEGORY COLLAPSE DOES NOT REACH — this
  // is NOT belt-and-braces, it closes a DIFFERENT arm. In `flip` mode the
  // near-tie clause is gated on `marginCat`, not on the stability axis, so it
  // survives the collapse:
  //
  //   "The result is sensitive to small movements in the strongest drivers, so
  //    the leading option could change without much shifting."
  //
  // That is a BEHAVIOURAL PREDICTION about how the result moves, on inputs the
  // engine defaulted — the same unlicensed claim as the reassuring arm, merely
  // pointing the other way. The margin clause already tells the user the
  // options are effectively tied, which IS what the analysis returned; the
  // extra sentence predicts what would happen next, which it does not support.
  // Suppressing only the comforting direction is exactly the one-parameter-two-
  // harms mistake (CLAUDE.md trap 22b), so both go.
  //
  // The `NO ARM ESCAPES` test sweeps the whole mode × margin × band matrix and
  // is what proved the collapse alone was insufficient here.
  if (defaultedDisclosure !== null) {
    stability_clause = null;
    stability_implies_flippability = false;
  }

  return {
    headline,
    margin_category: marginCat,
    stability_category: stabilityCat,
    margin_clause,
    stability_clause,
    // Follows the collapsed axis by construction: no arm sets this on
    // `unknown`. Pinned by `suppresses stability_implies_flippability with the
    // clause it describes` — the flag is that clause's own summary for
    // downstream callers, so a `true` surviving a suppressed sentence would let
    // a caller re-assert the finding the suppression just withdrew.
    stability_implies_flippability,
    defaulted_disclosure: defaultedDisclosure,
  };
}

function formatDriver(d: AnalysisProjectionDriver): string {
  return d.factor_label;
}

/**
 * DGAI #341 claim guard: drivers that may be NAMED in the superlative
 * sentences below ("driven mainly by …", "would shift this result the
 * most"). A near-zero driver renders as "has little effect on the lead",
 * which self-contradicts a "most/mainly" claim in the same breath (the live
 * #341 wire). Omit such drivers from the sentence — never substitute a
 * weaker candidate's band for an inflated claim. The projection is already
 * influence-ranked upstream, so filtering preserves rank order.
 */
function nameableDrivers(
  drivers: readonly AnalysisProjectionDriver[],
): readonly AnalysisProjectionDriver[] {
  return drivers.filter((d) => hasMaterialInfluence(d.sensitivity_value));
}

/**
 * Bucketed magnitude for edge strengths in structural explanations.
 * Delegates to `bandFromMagnitude` so structural prose, analysis prose,
 * and the upstream display-safe projection all read from the same
 * thresholds and vocabulary.
 *
 * Returns the bare adjective (`weak | moderate | strong | very strong`)
 * because edge-strength sentences compose it with a noun ("a {band}
 * link") rather than a verb-phrase.
 */
export function formatEdgeStrengthMagnitude(value: number): string {
  if (!Number.isFinite(value)) return 'weak';
  return bandFromMagnitude(Math.abs(value));
}

/**
 * `explain_results` happy-path fallback — analysis exists, Sonnet's
 * answer_text was unusable. Format the projection summary into prose.
 *
 * `validationBeatText` (V5-LANE-B-STRUCTURAL-01): the pre-composed
 * "what to validate" sentence from `coaching/validation-priority.ts`,
 * inserted before the closing nudge so the fallback carries the same beat
 * as the Sonnet-valid path. The handler owns composing it (it also reports
 * the mechanism); this composer only places it. No dedup is needed here —
 * this deterministic narrative never states a validation priority itself.
 * Null/absent → omitted (no-signal turns and legacy call sites).
 */
export function composeExplainResultsFallback(
  projection: AnalysisProjectionSummary | undefined,
  validationBeatText?: string | null,
  rawRobustness?: RawRobustnessSignals | null,
  defaultedAssumptions?: DefaultedAssumptionsSignal | null,
): string {
  if (!projection || !projection.leading_option) {
    // Defensive — the handler should not reach this branch without a
    // projection because the precondition bypass already guards the
    // no-analysis case. If the assembler produced no leading option even
    // with an analysis fact present, fall through to a generic line.
    return 'The analysis has finished, but the leading option could not be summarised from the available data. Would you like to explore what would change this result?';
  }

  const leading = projection.leading_option;
  const sentences: string[] = [];

  // The margin verdict and the stability verdict are ONE claim about result
  // robustness, composed together by composeRobustnessVerdict so they can
  // never contradict (the S4 defect: "too close to call" beside "should hold").
  // `rawRobustness` is threaded from the same source flip receives
  // (`invocation.rawRobustness`, prior-fact-sourced and same-run-guarded);
  // routed/request callers pass null and both composers fall back to the
  // margin-only verdict in lockstep.
  const verdict = composeRobustnessVerdict(
    projection,
    rawRobustness ?? null,
    'explain',
    defaultedAssumptions ?? null,
  );

  // Staleness caveat is no longer composed here. The handler's
  // `applyStalenessPrefix` helper prepends it to the final assistant_text
  // (whether this fallback or Sonnet's answer_text) when the analysis
  // projection carries a `staleness_reason`. Keeping the composer free of
  // the caveat sentence avoids duplication when prefix + composer both
  // ran, and keeps prose ordering decisions in one place.

  sentences.push(
    `${leading.label} performs best, with a probability of ${formatProbability(leading.probability)}.`,
  );

  if (verdict.margin_clause !== null) {
    sentences.push(verdict.margin_clause);
  }

  // DGAI #341: only materially-influential drivers may carry the "driven
  // mainly by" claim — a near-zero driver would self-contradict ("driven
  // mainly by X, which has little effect on the lead"). Empty ⇒ omit the
  // sentence entirely.
  const explainDrivers = nameableDrivers(projection.top_drivers);
  if (explainDrivers.length > 0) {
    const drivers = explainDrivers.slice(0, 2);
    if (drivers.length === 1) {
      const d = drivers[0]!;
      sentences.push(
        `The result is driven mainly by ${formatDriver(d)}, which ${formatSensitivityDirection(d.sensitivity_value)}.`,
      );
    } else {
      const a = drivers[0]!;
      const b = drivers[1]!;
      sentences.push(
        `The result is driven mainly by ${formatDriver(a)}, which ${formatSensitivityDirection(a.sensitivity_value)}, and ${formatDriver(b)}, which ${formatSensitivityDirection(b.sensitivity_value)}.`,
      );
    }
  }

  // Stability sentence — routed through the SAME verdict as the margin clause
  // above, so the confident "should hold" reassurance can never sit beside a
  // near-tie's "too close to call". On a near-tie + stable band the verdict
  // yields the honest dual-axis line instead; moderate gets a softer
  // worth-checking line; fragile / unknown bands (and near-tie moderate /
  // fragile / unknown) produce no sentence here.
  if (verdict.stability_clause !== null) {
    sentences.push(verdict.stability_clause);
  }

  if (typeof validationBeatText === 'string' && validationBeatText.length > 0) {
    sentences.push(validationBeatText);
  }

  // ⭐ THE DISCLOSURE THE ANALYSE TURN ALREADY MAKES, INHERITED — not re-worded.
  // Built by `coaching/pick-defaulted-assumptions.ts`, the single owner of this
  // sentence, from the producer's own `enrichment.defaulted_assumptions`. It
  // sits AFTER the result sentences and BEFORE the nudge so the recitation it
  // qualifies is already on screen, matching where the analyse turn's scaffold
  // suffix lands relative to its own headline.
  if (verdict.defaulted_disclosure !== null) {
    sentences.push(verdict.defaulted_disclosure);
  }

  sentences.push('Would you like to explore what would change this result?');

  return sentences.join(' ');
}

/**
 * `what_would_flip` happy-path fallback — analysis exists, answer_text
 * was unusable. Cite margins, top drivers, and robustness; gesture at
 * "what could change the outcome" without inventing scenarios.
 *
 * Robustness honesty (PR #193 SSOT reuse): when `rawRobustness` is
 * available the composer prefers the raw signal over the projected band
 * because canonicalisation can flatten a `very_low`/`low` raw level into
 * a moderate-sounding label. The routed (turn-executor) path threads the raw
 * signal through (`invocation.rawRobustness` → handler → here); callers
 * without a raw signal may pass `null` and the composer falls back to the
 * projected band.
 *
 * The margin sentence AND the closing robustness sentence both come from the
 * shared {@link composeRobustnessVerdict} (`flip` mode), so they resolve
 * together and cannot contradict — the S4 defect this PR closes. That verdict
 * produces the `flip`-voice ladder: fragility (the only branch that names the
 * robustness band) → near-tie closeness → stable-band "less likely to flip"
 * (finite margin only) → omit for moderate / unknown.
 *
 * `enrichment.flip_thresholds[]` still OWNS the closing sentence when present
 * (`flipSummary` not `'none'`): a direct flip verdict outranks the robustness
 * heuristic, and the verdict's flippability-implying clauses (fragile /
 * near-tie) are additionally gated on `flip.margin_supports_flip` via
 * `verdict.stability_implies_flippability`.
 */
export function composeWhatWouldFlipFallback(
  projection: AnalysisProjectionSummary | undefined,
  rawRobustness?: RawRobustnessSignals | null,
  flipSummary?: FlipSummary | null,
  defaultedAssumptions?: DefaultedAssumptionsSignal | null,
): string {
  if (!projection || !projection.leading_option) {
    return 'The analysis has finished, but the sensitivity picture could not be summarised from the available data. Would you like to run the analysis again?';
  }

  const leading = projection.leading_option;
  const sentences: string[] = [];
  const raw = rawRobustness ?? null;
  // ONE joint verdict — identical function + identical inputs as
  // composeExplainResultsFallback, so the two composers cannot diverge on the
  // near-tie (including the raw `near_tie.is_tie` override) OR on how the
  // margin verdict and stability verdict resolve together. `flip` mode selects
  // the "what could change it" voice.
  const verdict = composeRobustnessVerdict(projection, raw, 'flip', defaultedAssumptions ?? null);

  // Staleness caveat is no longer composed here — see the parallel note in
  // composeExplainResultsFallback. The handler's applyStalenessPrefix
  // helper prepends it to the final assistant_text when staleness_reason
  // is set on the projection.

  sentences.push(
    `${quoteLabel(leading.label)} currently leads, with a probability of ${formatProbability(leading.probability)}.`,
  );

  // Margin sentence (near-tie "effectively tied" / clear "would need to close"
  // / neutral contender) — routed through the shared verdict so a near-zero gap
  // is never described as "the lead would need to close".
  if (verdict.margin_clause !== null) {
    sentences.push(verdict.margin_clause);
  }

  // DGAI #341: only materially-influential drivers may carry the "would
  // shift this result the most" claim. The live defect paired that claim
  // with "Today it has little effect on the lead" about the SAME factor —
  // a self-contradiction. A near-zero driver is omitted from this sentence,
  // never re-billed as the top mover. Empty ⇒ omit the sentence entirely.
  const flipDrivers = nameableDrivers(projection.top_drivers);
  if (flipDrivers.length > 0) {
    const drivers = flipDrivers.slice(0, 2);
    if (drivers.length === 1) {
      const d = drivers[0]!;
      sentences.push(
        `Movement on ${formatDriver(d)} would shift this result the most. Today it ${formatSensitivityDirection(d.sensitivity_value)}.`,
      );
    } else {
      const a = drivers[0]!;
      const b = drivers[1]!;
      sentences.push(
        `Movement on ${formatDriver(a)} or ${formatDriver(b)} would shift this result the most. ${formatDriver(a)} ${formatSensitivityDirection(a.sensitivity_value)}; ${formatDriver(b)} ${formatSensitivityDirection(b.sensitivity_value)}.`,
      );
    }
  }

  // Closing sentence — flip-threshold evidence first, robustness band second.
  //
  // `enrichment.flip_thresholds[]` is the most direct signal for "what could
  // change the outcome", so when it is available (`flipSummary` present and
  // not `'none'`) it OWNS the closing sentence and the robustness-band
  // heuristic is bypassed. Critically, this is where we stop the live staging
  // contradiction (build cef69b0): the band said `fragile` and the composer
  // claimed "small adjustments could shift which option leads", while the
  // flip analysis had found NO single-factor tipping point within bounds.
  //
  // The flippability claims (fragile / near-tie branches) are additionally
  // gated on `flip.margin_supports_flip`: a `margin_sensitivity` block that
  // reports `movement: 'none'` is NOT evidence that small changes could flip.
  // When `flipSummary` is absent (routed/Sonnet path, older facts with no
  // flip thresholds, or an explicit `'none'` summary) the ladder is unchanged
  // — backward-compatible verbatim.
  const flip =
    flipSummary !== null && flipSummary !== undefined && flipSummary.overall_status !== 'none'
      ? flipSummary
      : null;
  const flipVerdict = flip !== null ? flip.overall_status : null;
  const flippabilityClaimAllowed = flip === null || flip.margin_supports_flip;

  if (flipVerdict === 'no_practical_flip') {
    // flip_value null + reason no_effect_within_bounds across the tested
    // factors: say so plainly. No fragility/flippability claim.
    sentences.push(ATTESTED_NO_FLIP_SENTENCE);
  } else if (flipVerdict === 'concrete') {
    // A real single-factor tipping point exists. Name the clearest lever(s)
    // and frame as something to TEST. We deliberately do not quote a
    // threshold value here (the scale-safe "Test X at N" number is surfaced
    // by the separate flip-proposal chip, which honours the value_scale
    // contract); the prose names the factor so we never misprint a scale.
    const namedEntries = flip!.entries
      .filter((e) => typeof e.flip_value === 'number' && Number.isFinite(e.flip_value))
      .slice(0, 2);
    const concrete = namedEntries.map((e) => e.factor_label);
    if (concrete.length === 1) {
      sentences.push(
        `${concrete[0]} is the most likely single factor to change which option leads, so it is the clearest one to test.`,
      );
    } else if (concrete.length >= 2) {
      sentences.push(
        `${concrete[0]} and ${concrete[1]} are the most likely single factors to change which option leads, so they are the clearest ones to test.`,
      );
    }

    // PROVENANCE (contract step-2 slice 1): PLoT already computed WHICH option
    // would lead once the tipping point is crossed and ships it as
    // `alternative_winner_id` on every flip row. Name it from that IDENTITY —
    // never from a label, and never re-derived here. `resolveAgreedAlternativeWinner`
    // returns null unless the named rows agree on ONE id AND that id has a
    // display name PLoT actually resolved (its `resolveLabel` echoes the raw id
    // when lookup fails, so an id-shaped "label" is withheld, not printed).
    // Null ⇒ this sentence is simply omitted and the copy is byte-identical to
    // the pre-repair prose. We name the option only; no probability, no margin.
    if (concrete.length > 0) {
      const altWinner = resolveAgreedAlternativeWinner(namedEntries);
      if (altWinner !== null) {
        sentences.push(`If that happened, ${altWinner.display} would lead instead.`);
      }
    }
  } else if (flipVerdict === 'insufficient_data') {
    sentences.push(
      'The analysis did not isolate a single-factor tipping point here, so it is not clear that any one change on its own would change which option leads.',
    );
  } else if (
    verdict.stability_clause !== null
    && (!verdict.stability_implies_flippability || flippabilityClaimAllowed)
  ) {
    // No flip-threshold evidence owns the sentence, so the shared verdict's
    // stability clause closes it: fragility (most specific), then near-tie
    // closeness, then the stable-band "less likely to flip" line. The
    // flippability-implying clauses (fragile / near-tie) are gated on
    // `flip.margin_supports_flip` — a `margin_sensitivity` reporting
    // `movement: 'none'` is NOT evidence that small changes could flip. The
    // stable-band line makes no flippability claim, so it is never gated.
    // Moderate / unknown / indeterminate-stable verdicts yield a null clause
    // and this branch simply does not fire — no overclaim.
    sentences.push(verdict.stability_clause);
  }

  // ⭐ THE DISCLOSURE THE ANALYSE TURN ALREADY MAKES, INHERITED — not re-worded.
  // Built by `coaching/pick-defaulted-assumptions.ts`, the single owner of this
  // sentence, from the producer's own `enrichment.defaulted_assumptions`. It
  // sits AFTER the result sentences and BEFORE the nudge so the recitation it
  // qualifies is already on screen, matching where the analyse turn's scaffold
  // suffix lands relative to its own headline.
  if (verdict.defaulted_disclosure !== null) {
    sentences.push(verdict.defaulted_disclosure);
  }

  sentences.push('Which of those would you like to explore changing?');

  return sentences.join(' ');
}

/**
 * `explain_from_structure` fallback — no analysis required. Sonnet rarely
 * populates `answer_text` for generic structural prompts ("what factor
 * most influences my decision?"); this composer therefore acts as the
 * primary user-facing prose for those turns. Reads as Olumi explaining
 * causal structure, not a system reporting.
 *
 * Two prose branches:
 *  - **Named-factor branch** when the user mentioned a factor by label:
 *    open with the factor and its strongest pathway, preserving the F.6
 *    over-claim guard so we only assert reach-to-goal when a cited
 *    pathway actually terminates at the goal node.
 *  - **Generic branch** when no factor was named: open with the goal and
 *    walk through the strongest 1-2 direct causal links shaping it.
 *
 * The next-step nudge ("Running the analysis would show…") is only
 * appended when `options.canRunAnalysis === true`. The handler should
 * pass `invocation.analysisReady?.status === 'ready'` so Sonnet's
 * suggestion stays grounded in the structural-readiness signal — we do
 * not nudge the user toward an analysis the precondition will not let
 * run.
 *
 * Length target: 300–600 chars on a typical 5-factor / 4-option graph;
 * sparse graphs (1 factor / 1 option) may produce shorter prose, which is
 * fine — do not pad.
 */
export interface ExplainFromStructureFallbackOptions {
  readonly canRunAnalysis?: boolean;
}

export function composeExplainFromStructureFallback(
  projection: StructureProjectionSummary | undefined,
  options?: ExplainFromStructureFallbackOptions,
): string {
  const canRunAnalysis = options?.canRunAnalysis === true;
  if (!projection) {
    // No projection at all — extremely thin context. Give a neutral one-
    // sentence response and only nudge toward analysis when readiness says
    // it's actually runnable.
    return canRunAnalysis
      ? 'The model structure could not be summarised from the available data. Would you like to run the analysis?'
      : 'The model structure could not be summarised from the available data.';
  }

  const sentences: string[] = [];

  if (
    projection.named_factor_label &&
    projection.named_factor_pathways.length > 0
  ) {
    const factor = projection.named_factor_label;
    const pathways = projection.named_factor_pathways.slice(0, 2);

    // Over-claim guard: only assert the named factor "feeds into" the goal
    // when at least one cited pathway actually terminates at the goal node
    // (1-hop, structurally verified from the projection). If the named
    // factor is only adjacent to sibling factors or other non-goal nodes,
    // describe the structural connection without claiming it reaches the
    // goal — multi-hop derivation crosses the F.6 line.
    const reachesGoal =
      projection.goal_label !== null &&
      pathways.some(
        (p) =>
          (p.label_from === factor && p.label_to === projection.goal_label) ||
          (p.label_to === factor && p.label_from === projection.goal_label),
      );

    const top = pathways[0];
    const otherEnd =
      top.label_from === factor ? top.label_to : top.label_from;
    sentences.push(
      `${factor} shapes this decision through its causal links in the model.`,
    );
    if (reachesGoal && projection.goal_label) {
      sentences.push(
        `Its strongest direct influence runs to ${projection.goal_label} as a ${formatEdgeStrengthMagnitude(top.strength)} link, meaning movement here would have the most structural effect on your goal.`,
      );
    } else {
      sentences.push(
        `Its strongest direct connection is to ${otherEnd} as a ${formatEdgeStrengthMagnitude(top.strength)} link, so changes there would propagate first.`,
      );
    }
    if (pathways.length > 1) {
      const second = pathways[1];
      const secondOther =
        second.label_from === factor ? second.label_to : second.label_from;
      sentences.push(
        `A second pathway runs to ${secondOther} as a ${formatEdgeStrengthMagnitude(second.strength)} link, giving you a secondary lever if the first proves hard to move.`,
      );
    }
  } else if (projection.top_causal_links.length > 0) {
    const top = projection.top_causal_links.slice(0, 2);
    const goalIntro = projection.goal_label
      ? `Your decision around ${projection.goal_label} is shaped by several causal mechanisms.`
      : 'This decision is shaped by several causal mechanisms.';
    sentences.push(goalIntro);
    const first = top[0];
    sentences.push(
      `${first.label_from} has the strongest visible direct influence on ${first.label_to} via a ${formatEdgeStrengthMagnitude(first.strength)} link, meaning changes here would have the most structural effect.`,
    );
    if (top.length > 1) {
      const second = top[1];
      sentences.push(
        `${second.label_from} also contributes meaningfully through a ${formatEdgeStrengthMagnitude(second.strength)} direct link to ${second.label_to}, so it is worth keeping in view as a secondary lever.`,
      );
    }
  } else if (projection.goal_label) {
    sentences.push(
      `Your goal in this model is ${projection.goal_label}, but no causal links are recorded yet to drive it.`,
    );
  } else {
    sentences.push('The model structure is currently empty.');
  }

  if (projection.factor_count > 0 && projection.option_count > 0) {
    sentences.push(
      `Across the model there are ${projection.factor_count} factors influencing ${projection.option_count} ${
        projection.option_count === 1 ? 'option' : 'options'
      }.`,
    );
  }

  if (canRunAnalysis) {
    sentences.push(
      'Running the analysis would show how these structural relationships translate into option-level probabilities.',
    );
  }

  return sentences.join(' ');
}
