/**
 * Confidence banding — the SINGLE source for mapping a PLoT-provided
 * `factor_sensitivity[].confidence` scalar (0–1) onto the three-band
 * `'high' | 'medium' | 'low'` classification.
 *
 * Extracted so the evidence-block confidence lookup
 * (`buildFactorConfidenceLookup`, phase3-blocks.ts) and the capability-layer
 * lens selector (`lens-selector.ts`) band IDENTICALLY. A second hand-copied
 * threshold pair would be exactly the hand-maintained-mirror defect class the
 * platform has repeatedly been bitten by: a selector whose `'low confidence'`
 * trigger silently drifted from the evidence band would mislabel real state.
 * Both callers derive from HERE — change the thresholds once, both move.
 *
 * Thresholds:
 *   c >= 0.7 → high · c >= 0.4 → medium · else → low.
 *
 * ⚠ THESE ARE PLoT'S NUMBERS, NOT OURS — ROADMAP 2.681. They are pinned to the
 * boundaries PLoT uses for the "Add evidence" suggested-action the user
 * actually READS, at
 *   Talchain/plot-lite-service · src/review-pass/evidence-priority.ts
 *   · `suggestedEvidenceText` (lines 139-145) @ bc4b2a34 (deployed, 7 Aug 2026):
 *       confidence >= 0.7 → suppressed  ·  < 0.4 → "…is low."  ·  else "…is medium."
 *
 * The medium floor WAS 0.3, and that single drifted number was a live
 * user-facing contradiction: PLoT told the user "your confidence in its
 * strength is low" while CEE stamped the same factor 'medium'. Because live
 * confidence FLOORS at exactly 0.30 (ISL `STABILITY_CONFIDENCE_MAP.negligible`
 * = 0.1 → PLoT `0.5*islConf + 0.25` = 0.30), the contested [0.3, 0.4) window was
 * 218 of 404 rows (54%) across 125 deployed-staging captures — and every one of
 * the 286 evidence blocks in those captures carried `current_confidence:
 * 'medium'` / `severity: 'info'` / `category: 'could_fix'`. The two services had
 * ALWAYS agreed exactly on 0.7, which is the tell that 0.3 was the drifted side.
 *
 * ⚠ DO NOT "TIDY" EITHER NUMBER, and do not change one to match a CEE-side
 * expectation. They are one half of a cross-service agreement whose other half
 * lives in another repo. `__tests__/confidence-bands.plot-parity.test.ts` pins
 * both against PLoT's provenance and a corpus of committed staging captures, so
 * a drift on either side REDs there with a pointer to the file to re-read.
 * That guard is the fail-loud mirror this seam gets INSTEAD of a derivation:
 * the band cannot be derived cross-repo at this tip — `@talchain/schemas` types
 * no factor confidence band (its `EnrichmentConfidenceTier` is the unrelated
 * whole-analysis `strong|fair|needs_work`), the wire carries `confidence` as a
 * bare scalar, and PLoT's band reaches the user only as pre-rendered prose.
 *
 * A non-finite / absent confidence returns `null` ("unknown") — NEVER a silent
 * default band. Absent ≠ a real signal (the enrichment doc: "absent means
 * unavailable, NOT zero"); a defaulted band would mislabel severity. This
 * matters more now than it did at 0.3: `low` carries `critical`/`warning`, so a
 * fabricated band would fabricate an alarm.
 */

export const CONFIDENCE_HIGH_MIN = 0.7;
export const CONFIDENCE_MEDIUM_MIN = 0.4;

export type ConfidenceBand = 'high' | 'medium' | 'low';

export function bandConfidence(confidence: unknown): ConfidenceBand | null {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) {
    return null;
  }
  if (confidence >= CONFIDENCE_HIGH_MIN) return 'high';
  if (confidence >= CONFIDENCE_MEDIUM_MIN) return 'medium';
  return 'low';
}

// ============================================================================
// A SECOND, DELIBERATELY DIFFERENT NUMBER — read this before "tidying" it
// ============================================================================

/**
 * The threshold at which the lens ladder treats the #1-influence factor as too
 * uncertain to leave alone (`TOP_FACTOR_LOW_CONFIDENCE`, lens-selector.ts).
 *
 * ⚠⚠ THIS IS NOT A STALE COPY OF {@link CONFIDENCE_MEDIUM_MIN}, AND MERGING THE
 * TWO IS A MEASURED REGRESSION. It looks exactly like the hand-maintained
 * mirror this file was extracted to abolish, which is why the difference is
 * documented here rather than left to be rediscovered.
 *
 * THE TWO CONSTANTS ANSWER DIFFERENT QUESTIONS (ROADMAP 2.681, trap 21 — two
 * authorities that seem to disagree because nothing wrote down what each one is
 * for):
 *
 *   CONFIDENCE_MEDIUM_MIN (0.4) answers
 *     "WHAT CONFIDENCE WORD DO WE DISPLAY FOR THIS FACTOR?"
 *   It is not ours to choose. PLoT has already put a word on the same user's
 *   screen for the same factor, so agreement is the whole requirement.
 *
 *   LENS_LOW_CONFIDENCE_MAX (0.3) answers
 *     "IS THE TOP FACTOR UNCERTAIN ENOUGH THAT A PRE-MORTEM SHOULD OUTRANK THE
 *      OTHER COACHING EXERCISES THIS TURN?"
 *   That is a coaching-ladder PRIORITY decision. Nothing cross-service
 *   constrains it, and it trades directly against the other exercises.
 *
 * WHY IT IS PINNED AT THE HISTORICAL 0.3 RATHER THAN MOVED WITH THE DISPLAY
 * BAND — measured at this tip, not assumed. `pre_mortem` sits at ladder
 * position 2, ABOVE both DSK exercises. Widening this trigger to 0.4 makes it
 * fire on 21 of 31 live captured analyses (it fires on 0 of 31 at 0.3), and on
 * the sessionA capture that is enough to STARVE `consider_opposite` and
 * `devils_advocacy` across a whole 8-turn walk — including the positive control
 * in `lens-dsk-sequence-2490.test.ts`. ROADMAP 2.490 shipped deliberate work to
 * make `devils_advocacy` reachable at all; moving this number as a side effect
 * of a display-copy fix would silently undo it on real traffic.
 *
 * ⚠ CONSEQUENCE, STATED PLAINLY: `TOP_FACTOR_LOW_CONFIDENCE` REMAINS DARK.
 * Live confidence floors at exactly 0.30, so `< 0.3` was not reached on any of
 * 404 rows across 125 August-2026 staging captures. That is a known, rowed gap
 * (2.681-b), NOT an oversight — lighting it is a coaching-design change that
 * needs its own review and a re-derivation of 2.490's partition, because the
 * question it answers is one only we get to answer.
 */
export const LENS_LOW_CONFIDENCE_MAX = 0.3;

/**
 * Whether the lens ladder should treat `confidence` as "low" for
 * `TOP_FACTOR_LOW_CONFIDENCE`. Absent / non-finite is NOT low — an unknown
 * confidence must never trigger a coaching exercise that asserts the user is
 * unsure about the factor (same fail-closed rule as {@link bandConfidence}).
 */
export function isLensLowConfidence(confidence: unknown): boolean {
  if (typeof confidence !== 'number' || !Number.isFinite(confidence)) return false;
  return confidence < LENS_LOW_CONFIDENCE_MAX;
}
