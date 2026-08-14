/**
 * OBJECTIVE-CONTRADICTION DETECTION — the honesty surface for a leader that
 * does not serve the user's stated objective.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR, AND THE MEASUREMENT THAT FORCED IT
 *
 * `PHASE0-EVIDENCE-2026-07-28/pricing-objective-investigation-2026-08-14/FINDINGS.md`
 * (14 Aug 2026), derived at the producers: **the option comparison never
 * evaluates the user's stated objective.** "Wins" is `argmax` over options of
 * the propagated GOAL-NODE SCALAR per Monte Carlo draw
 * (`robustness_analyzer_v2.py:3135-3139`). Supplying the user's target changes
 * the ranking by EXACTLY NOTHING — measured across five target/frame/constraint
 * variants, with a sign-flip control that did move it:
 *
 *     no target                      : hold 0.7067 | raise_small 0.0152 | raise_big 0.2782
 *     goal_threshold=0.3 delta       : hold 0.7067 | raise_small 0.0152 | raise_big 0.2782
 *     goal_threshold=0.9 delta       : hold 0.7067 | raise_small 0.0152 | raise_big 0.2782
 *     CONTROL (flip churn edge sign) : hold 0.2845 | raise_small 0.0165 | raise_big 0.6990
 *
 * ⭐ At `goal_threshold=0.3 delta` the option reported as **winner with 70.67%**
 * carries **`probability_of_goal = 0.0`**. The leading answer has a zero percent
 * modelled chance of meeting the stated goal. *The two numbers come from
 * channels that never meet* — and the product prints the first one.
 *
 * No component misbehaves. ISL maximises what it was asked; CEE sends the
 * user's graph. **The product composes correct parts into a claim none of them
 * supports** (CLAUDE.md trap 21, at whole-product scale).
 *
 * This module does not fix that — fixing it is goal decomposition, a four-service
 * change (FINDINGS fix 2). It makes the contradiction VISIBLE where the product
 * names a leader, which is FINDINGS fix 1, "ship 1 now".
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ## TWO ARMS, AND WHY THE ARITHMETIC ONE IS THE LOAD-BEARING ONE
 *
 * **ARM B — goal attainment (`detectGoalAttainmentContradiction`). PURE
 * ARITHMETIC, no natural language anywhere.** The leader leads the win share
 * while a different option is strictly more likely to reach the stated target.
 * This is the FINDINGS' headline fact expressed as a predicate over one array
 * CEE already holds (`OptionSummary.probability_of_goal`,
 * `context/analysis-compact.ts:31`, read at `:768-779`).
 *
 * ⚠ ARM B IS WHAT MAKES THE F1 TARGET-RECOVERY WORK SAFE TO SHIP. The
 * investigation's sequencing warning is explicit: *"never ship F1/Option 2's
 * target wiring without Option 1's copy in the same wave — else 'Hold leads
 * 68%' renders beside 'probability of reaching your goal: 0%' with no
 * explanation."* Wiring a target makes `probability_of_goal` APPEAR; this arm is
 * the sentence that stops it appearing as an unexplained contradiction.
 *
 * **ARM A — directional (`detectDirectionalContradiction`).** The user's aim
 * states a DIRECTION over a lever the options intervene on, and the leader sits
 * at the wrong end of that lever. Arithmetic-led by construction: the goal
 * label's language is read ONLY to establish the intended direction and its
 * subject; *everything that decides whether the surface fires is intervention
 * arithmetic on the model's own numbers.*
 *
 * ## ⚠⚠ ARM A IS AN NL PREDICATE AND THIS ESTATE HAS ALREADY LOST FOUR ROUNDS
 * ## TO ONE (CEE #888). THE 22-FAMILY RULES ARE BINDING HERE.
 *
 *   - **The corpus comes from OUTSIDE the author's head** (trap 22): 73 distinct
 *     REAL goal-node labels harvested by script from every fixture and live
 *     capture in the repo. The classification and its confusion matrix live in
 *     `__tests__/objective-contradiction.corpus.test.ts`.
 *   - **Every case has an opposite-direction twin** (trap 22b): a predicate
 *     guarding two opposite harms needs two parameters, never one window. A
 *     false positive that INVENTS a contradiction is a lie; one that MISSES a
 *     contradiction is a gap. They are separated here by making UNDETERMINED the
 *     DEFAULT and the fire condition ARITHMETIC.
 *   - **Where direction cannot be determined the surface is SILENT** (trap 22f):
 *     the exit from an unwinnable parsing problem is to stop guessing, not to
 *     add one more rule. `KNOWN_UNDETERMINED` is pinned EXACTLY in the corpus
 *     spec — its test REDs if the set grows OR shrinks.
 *   - **If this predicate ever reverses direction across two fix rounds, STOP
 *     and report** rather than patching the reverse. Two reversals on one
 *     predicate is a signal; four is proof the approach is wrong.
 *
 * ## ⭐ THE MEASURED SCOPE FACT A FUTURE READER MUST NOT RE-DISCOVER
 *
 * **Zero of the 73 harvested goal labels state a direction over a factor the
 * options intervene on.** They divide into direction-over-the-GOAL-METRIC
 * (`Maximise ARR`, `Grow MRR to £250,000`, `Minimise TCO over 3 years`) and
 * NON-DIRECTIONAL (`Choose vendor`, `Deliver CRM capability on time`).
 *
 * That is not a defect in Arm A — it is Arm A's honest scope, and it is WHY the
 * subject must resolve to an INTERVENED factor before the surface may fire.
 * Consider the banked pricing capture: goal `Grow MRR to £250,000`, options
 * intervening on `fac_price_level` (hold 0.49 · tiers 0.54 · raise 0.59). The
 * aim's direction governs MRR, the goal metric — and `argmax` genuinely does
 * maximise the goal metric, so there is NO directional contradiction to report
 * and Arm A correctly stays silent. Arm B is what speaks there.
 *
 * A detector that fired on "Maximise ARR + status quo leads" would be asserting
 * a contradiction the model does not contain. That is the LIE direction, and it
 * is the one this module is built to refuse.
 */

import { passesAssistantTextContentDefences } from './assistant-text-defences.js';

/**
 * The per-option projection this module reads. Structurally typed rather than
 * imported from `context/analysis-compact.ts` so the detector stays a leaf and
 * can be exercised from fixtures without dragging the projection graph in.
 *
 * Field semantics are the PRODUCER'S, not this module's reading of them
 * (trap 13c — a mutant kit validates sensitivity, never a wrong oracle):
 *   - `win_probability` — the share of Monte Carlo draws in which this option
 *     produced the LARGEST GOAL-NODE VALUE. It is not "probability this option
 *     is best", and it is not conditioned on any target.
 *   - `probability_of_goal` — ISL's `P(goal samples >= threshold)` for this
 *     option, present ONLY when a goal threshold AND its frame reached ISL and a
 *     baseline conversion was possible. Absent is the COMMON state and is
 *     meaningful: ISL fail-closes rather than emit a confident wrong number.
 */
export interface ObjectiveOptionView {
  readonly option_id: string;
  readonly option_label: string;
  readonly win_probability: number;
  readonly probability_of_goal?: number;
  readonly status?: string;
}

/** A factor the options intervene on, with each option's intervened value. */
export interface InterventionView {
  readonly factor_id: string;
  readonly factor_label: string;
  /** option_id → the value this option sets the factor to. */
  readonly by_option: ReadonlyMap<string, number>;
}

/** The direction a goal's language asks a quantity to move. */
export type GoalDirection = 'increase' | 'decrease' | 'undetermined';

export interface GoalIntent {
  readonly direction: GoalDirection;
  /**
   * The lower-cased noun phrase the direction governs, or `null` when the
   * label carries a direction verb but no resolvable subject. Used ONLY to
   * resolve against a factor label; never rendered.
   */
  readonly subject: string | null;
}

/** Arm B's verdict. Every field is derived; nothing is interpolated free-form. */
export interface GoalAttainmentContradiction {
  readonly kind: 'goal_attainment';
  readonly leader_label: string;
  readonly leader_probability_of_goal: number;
  readonly better_label: string;
  readonly better_probability_of_goal: number;
}

/** Arm A's verdict, including the containment subset. */
export interface DirectionalContradiction {
  readonly kind: 'directional';
  readonly leader_label: string;
  readonly factor_label: string;
  readonly direction: 'increase' | 'decrease';
  /** Best-of-the-pursuing-subset — the "among the options that do, X leads" clause. */
  readonly pursuing_leader_label: string;
  readonly pursuing_leader_win_probability: number;
}

// ============================================================================
// Goal-language direction (ARM A's ONLY natural-language step)
// ============================================================================

/**
 * Verb stems that state a direction, sourced from the harvested corpus rather
 * than invented. Each entry is a STEM matched with an explicit inflection group,
 * never a bare substring — `\brais(?:e|es|ing|ed)?\b` and not `/rais/`, so
 * "praise" and "raised expectations" cannot be read as a lever instruction.
 *
 * ⚠ THE OMISSIONS ARE DELIBERATE AND EACH ONE IS A DECISION. They are pinned by
 * the corpus spec's exact KNOWN-UNDETERMINED set:
 *   - `maintain` / `sustain` / `hold` / `preserve` — these state STASIS. Reading
 *     them as `increase` is the exact inversion trap 22b names: a false positive
 *     that INVENTS a contradiction, on a goal whose author asked for no change.
 *   - `optimise` / `balance` / `improve` — direction genuinely ambiguous over the
 *     named quantity ("Optimise 7-Year Fleet Total Cost of Ownership" wants cost
 *     DOWN; "Optimise conversion" wants it UP). Ambiguous ⇒ UNDETERMINED ⇒
 *     silent. This is trap 22f's ruling applied before the oscillation, not
 *     after it.
 *   - `achieve` / `reach` / `hit` / `meet` / `deliver` / `ship` — these state
 *     ATTAINMENT of a level, not a direction over a lever. They are Arm B's
 *     territory: a target to be met, which is exactly what
 *     `probability_of_goal` measures.
 */
const INCREASE_STEMS: readonly string[] = [
  'increas(?:e|es|ing|ed)?',
  'rais(?:e|es|ing|ed)?',
  'grow(?:s|ing)?',
  'boost(?:s|ing|ed)?',
  'lift(?:s|ing|ed)?',
  'expand(?:s|ing|ed)?',
  'maximis(?:e|es|ing|ed)?',
  'maximiz(?:e|es|ing|ed)?',
  'double',
  'accelerat(?:e|es|ing|ed)?',
];

const DECREASE_STEMS: readonly string[] = [
  'decreas(?:e|es|ing|ed)?',
  'reduc(?:e|es|ing|ed)?',
  'lower(?:s|ing|ed)?',
  'cut(?:s|ting)?',
  'minimis(?:e|es|ing|ed)?',
  'minimiz(?:e|es|ing|ed)?',
  'shrink(?:s|ing)?',
  'drop(?:s|ping|ped)?',
];

/**
 * Stems that look directional and are REFUSED. Held as an explicit list rather
 * than as "everything not in the two lists above", so that adding a stem to
 * INCREASE_STEMS that also appears here is a visible contradiction rather than a
 * silent precedence question.
 *
 * ⚠ CHECKED FIRST. A label carrying BOTH a stasis stem and a direction stem is
 * genuinely ambiguous about which governs the lever, so it is UNDETERMINED
 * (trap 22b: the two harms need two parameters — here, refusing both rather
 * than picking a winner). `Grow MRR while maintaining gross margin` is the
 * case; a surviving mutant proved this branch was untested until a label
 * carrying both was added.
 */
const STASIS_STEMS: readonly string[] = [
  'maintain(?:s|ing|ed)?',
  'sustain(?:s|ing|ed)?',
  'preserv(?:e|es|ing|ed)?',
  'hold(?:s|ing)?',
  'keep(?:s|ing)?',
  'stabilis(?:e|es|ing|ed)?',
  'stabiliz(?:e|es|ing|ed)?',
];

/**
 * Stems whose direction over the named quantity cannot be determined from the
 * label alone. Refused explicitly, for the same reason as the stasis list.
 */
const AMBIGUOUS_STEMS: readonly string[] = [
  'optimis(?:e|es|ing|ed)?',
  'optimiz(?:e|es|ing|ed)?',
  'balanc(?:e|es|ing|ed)?',
  'improv(?:e|es|ing|ed)?',
  'enhanc(?:e|es|ing|ed)?',
  'manag(?:e|es|ing|ed)?',
];

function stemAlternation(stems: readonly string[]): RegExp {
  return new RegExp(`\\b(?:${stems.join('|')})\\b`, 'i');
}

const INCREASE_RE = stemAlternation(INCREASE_STEMS);
const DECREASE_RE = stemAlternation(DECREASE_STEMS);
const STASIS_RE = stemAlternation(STASIS_STEMS);
const AMBIGUOUS_RE = stemAlternation(AMBIGUOUS_STEMS);

/**
 * Capture the subject a direction verb governs: the words between the verb and
 * the first clause boundary or numeric target.
 *
 * ⚠ THE WINDOW IS NOT CUT AT `[.!?]` — trap 22's measured defect. A guard whose
 * window was cut at the first `[.!?]` was ALSO cutting at the DECIMAL POINT, so
 * `£1.5 million` was truncated to `1` before the guard ever looked, and the
 * module's own header called that guard "the most important line here". The
 * boundary set here is deliberately clause-level and decimal-safe.
 */
const SUBJECT_BOUNDARY =
  /\s+(?:to|by|from|within|over|at|above|below|under|while|without|and|with|for|in|per)\b|[,;:—–]|\d/i;

const DIRECTION_STEM_RE = new RegExp(
  `\\b(?:${[...INCREASE_STEMS, ...DECREASE_STEMS].join('|')})\\b`,
  'i',
);

/**
 * ⚠⚠ NEGATION — REFUSE, NEVER INVERT. THE CEE #888 CLASS, FOUND BY THE
 * REVIEWER'S CORPUS AND NOT BY THE AUTHOR'S.
 *
 * The author's 73-label corpus contained **zero negation cases**, so this hole
 * was invisible to a confusion matrix, opposite-direction twins, a pinned
 * KNOWN-UNDETERMINED set AND a 10/10 mutant kit. Trap 22, exactly as written: a
 * corpus that shares the code's blind spot cannot see the code's defect.
 *
 * MEASURED MISSES at `2186fa3c`, verbatim:
 *   "Do not increase headcount"       → FIRED, dir=increase
 *   "Never cut the marketing budget"  → FIRED, dir=decrease
 *   "Avoid cutting the support team"  → FIRED, dir=decrease
 *   "Avoid raising prices"            → direction read increase (silent only
 *                                        because the plural token missed)
 *
 * The second is the worst thing this surface has done: **the emitted copy
 * endorsed the options that CUT the budget the user said never to cut.** Not a
 * gap — the product actively recommending the forbidden action.
 *
 * ⭐ WHY REFUSE RATHER THAN INVERT (trap 22f). Reading "do not increase" as
 * `decrease` is a second guess stacked on the first: the user has ruled a
 * direction OUT and left what they want UNSTATED. "Do not increase headcount"
 * does not mean "reduce headcount". Inverting would trade a loud lie for a
 * quiet one, which is the oscillation #888 lost four rounds to. UNDETERMINED is
 * the only answer that cannot be wrong.
 *
 * ⚠ POSITION IS LOAD-BEARING: the cue must PRECEDE the direction stem to govern
 * it. "Grow revenue without discounting" states a real direction on revenue —
 * its `without` governs a different verb entirely, and a position-blind refusal
 * would silence a legitimate aim. That is the precision half of the
 * two-parameter rule (trap 22b): wide enough to catch all four misses, narrow
 * enough not to eat ordinary business English.
 *
 * Both apostrophes are carried: ASCII `'` and the typographic `’` a real user's
 * keyboard emits.
 */
const NEGATION_CUE_RE =
  /\b(?:avoid|never|stop|prevent|refuse|without|don['’]t|do\s+not|cannot|can['’]t|no\s+longer)\b/gi;

/**
 * Does a negation cue GOVERN the direction stem — i.e. appear before it?
 *
 * Returns false when there is no direction stem at all; the caller has already
 * established one by then, and a cue with nothing to govern is not a refusal.
 */
function negationGovernsDirection(label: string, stemIndex: number): boolean {
  NEGATION_CUE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = NEGATION_CUE_RE.exec(label)) !== null) {
    if (match.index < stemIndex) return true;
  }
  return false;
}

/**
 * ⭐ THE ENTIRE NATURAL-LANGUAGE SURFACE OF THIS MODULE, and it decides only
 * ONE thing: which direction the user asked for. It can never, on its own,
 * cause a sentence to ship — the arithmetic gates in
 * {@link detectDirectionalContradiction} do that.
 *
 * DEFAULT IS `undetermined`. Every early return below is a refusal to guess.
 */
export function deriveGoalIntent(goalLabel: unknown): GoalIntent {
  const undetermined: GoalIntent = { direction: 'undetermined', subject: null };
  if (typeof goalLabel !== 'string') return undetermined;
  const label = goalLabel.trim();
  if (label.length === 0) return undetermined;

  // Refusals first — a stasis or ambiguous verb ANYWHERE in the label wins over
  // a direction verb, because which one governs the lever is exactly what
  // cannot be determined.
  if (STASIS_RE.test(label)) return undetermined;
  if (AMBIGUOUS_RE.test(label)) return undetermined;

  const hasIncrease = INCREASE_RE.test(label);
  const hasDecrease = DECREASE_RE.test(label);
  // Both directions present, or neither ⇒ which governs the lever is undetermined.
  if (hasIncrease === hasDecrease) return undetermined;

  const match = DIRECTION_STEM_RE.exec(label);
  if (match === null) return undetermined;

  // ⚠ NEGATION IS CHECKED HERE, AFTER the stem is located and BEFORE the
  // direction is returned — the cue must govern THIS stem, and position is what
  // decides that. Refuse, never invert.
  if (negationGovernsDirection(label, match.index)) return undetermined;

  const after = label.slice(match.index + match[0].length).trim();
  const boundary = after.search(SUBJECT_BOUNDARY);
  const subjectRaw = (boundary === -1 ? after : after.slice(0, boundary)).trim();
  const subject = subjectRaw.length > 0 ? subjectRaw.toLowerCase() : null;

  return { direction: hasIncrease ? 'increase' : 'decrease', subject };
}

// ============================================================================
// ARM B — goal attainment. PURE ARITHMETIC.
// ============================================================================

/**
 * Is this option eligible to be crowned / compared?
 *
 * Mirrors CEE's shared status doctrine: absent status is RECOMMENDABLE (legacy
 * and most current payloads carry none), and an errored option is neither
 * crowned nor used as the comparison partner. Tightening this to
 * `=== 'computed'` would filter out every status-less record and silently
 * withhold a comparison that legitimately exists.
 */
function isComparable(option: ObjectiveOptionView): boolean {
  return option.status === undefined || option.status === 'computed';
}

function finite(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * ⚠ A PROBABILITY IS A NUMBER IN THE CLOSED UNIT INTERVAL — WRITE THE INVARIANT
 * AGAINST THE SPEC, NOT AGAINST THE FAILURE MODE (trap 13d).
 *
 * MEASURED at `2186fa3c`: `probability_of_goal: 1.5` rendered
 * *"(150% against 20%)"* and PASSED egress, because the tail grammar's
 * `\d{1,3}` admits anything up to 999. Guarding at "less than 1000" would be
 * writing the guard against what the GRAMMAR happens to allow; the consumer's
 * actual contract is `[0, 1]`, and that is what this asserts. Both ends: a
 * negative is as impossible as a 1.5.
 *
 * ⚠ THIS IS DELIBERATELY *NOT* FOLDED INTO {@link finite}, and the distinction
 * is load-bearing. `finite` also guards INTERVENTION VALUES, which are in the
 * factor's own units and legitimately leave [0,1] — a headcount of 20, a price
 * of 59, a spend of 600000. Tightening `finite` globally would silently blind
 * the directional arm to every non-normalised lever in the estate: a fix for
 * one field that breaks a different one, under a shared name (trap 21).
 */
function unitProbability(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * The RENDERED integer percentage. Declared here, beside the detector, because
 * the detector's contradiction test must be made on the SAME number the copy
 * prints — see {@link detectGoalAttainmentContradiction}.
 */
function toPercent(probability: number): number {
  return Math.round(probability * 100);
}

/**
 * ⭐ ARM B. The leader leads the win share while a DIFFERENT option is strictly
 * more likely to reach the user's stated target.
 *
 * Returns `null` — silent — in every one of these states, each pinned by its own
 * case in the spec (trap 13b: presence of a control is not coverage of the
 * branch):
 *   - fewer than two comparable options;
 *   - the leader carries no `probability_of_goal` (no target reached ISL, or ISL
 *     fail-closed — the COMMON state, and silence is the honest response);
 *   - no other comparable option carries one;
 *   - the leader already has the greatest `probability_of_goal` (it pursues the
 *     aim — the surface must not fire);
 *   - ties (`<=`), because a tie is not a contradiction.
 *
 * ⚠ The leader is taken as the greatest `win_probability` among COMPARABLE
 * options, re-derived here rather than assuming the caller's array order. An
 * upstream sort is a fact about the caller, not an invariant of this function,
 * and binding to it would make the detector silently wrong the day a caller
 * passes an unsorted array.
 */
export function detectGoalAttainmentContradiction(
  options: readonly ObjectiveOptionView[],
): GoalAttainmentContradiction | null {
  const comparable = options.filter(isComparable);
  if (comparable.length < 2) return null;

  let leader: ObjectiveOptionView | null = null;
  for (const option of comparable) {
    if (!finite(option.win_probability)) continue;
    if (leader === null || option.win_probability > leader.win_probability) {
      leader = option;
    }
  }
  if (leader === null) return null;
  if (!unitProbability(leader.probability_of_goal)) return null;

  let best: ObjectiveOptionView | null = null;
  for (const option of comparable) {
    if (option.option_id === leader.option_id) continue;
    if (!unitProbability(option.probability_of_goal)) continue;
    if (best === null || option.probability_of_goal > (best.probability_of_goal as number)) {
      best = option;
    }
  }
  if (best === null) return null;

  const leaderPog = leader.probability_of_goal;
  const bestPog = best.probability_of_goal as number;
  // ⚠ THE COMPARISON IS ON THE RENDERED INTEGERS, NOT THE RAW FLOATS.
  // MEASURED at `2186fa3c`: 0.484 vs 0.478 are strictly ordered as floats but
  // BOTH render 48%, so the surface emitted "more likely to reach your stated
  // target (48% against 48%)" — a sentence asserting a difference the very
  // numbers it prints do not show. A claim must be true of the text the user
  // reads, not of the doubles behind it. Strictly greater still: a tie is not a
  // contradiction.
  if (toPercent(bestPog) <= toPercent(leaderPog)) return null;

  return {
    kind: 'goal_attainment',
    leader_label: leader.option_label,
    leader_probability_of_goal: leaderPog,
    better_label: best.option_label,
    better_probability_of_goal: bestPog,
  };
}

// ============================================================================
// ARM A — directional. ARITHMETIC-GATED.
// ============================================================================

/**
 * Does the intervened factor's label name the subject the goal's direction
 * governs? Token-containment in either direction, so "price" resolves against
 * "Seat Price Level" and "subscription price" against "Price".
 *
 * ⚠ THE MINIMUM TOKEN LENGTH IS LOAD-BEARING, and a surviving mutant proved it
 * untested until a case was added: a one-character token is a substring of
 * almost any factor label ("Seat Price Level" contains "e"), so dropping the
 * filter would resolve a subject to a factor it does not name and fire the
 * surface on a resolution that means nothing. That is the LIE direction.
 *
 * ⚠ BOUND BY IDENTITY, NOT BY A VALUE PREDICATE (trap 19). The resolution
 * returns the factor's ID and every later step keys on that ID — never on "the
 * factor whose value looks right", which another factor could satisfy.
 */
const SUBJECT_STOPWORDS: ReadonlySet<string> = new Set([
  'the',
  'our',
  'your',
  'their',
  'its',
  'all',
  'any',
  'new',
  'net',
  'total',
  'overall',
  'current',
  'this',
  'that',
  'these',
  'those',
  'more',
  'less',
  'and',
  'for',
  'per',
  'from',
  'with',
  'into',
  'over',
  'under',
]);

function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !SUBJECT_STOPWORDS.has(t));
}

/**
 * How strongly does an intervened factor's label name the subject the goal's
 * direction governs? Returns the count of shared content words; `0` is no match.
 *
 * ⚠⚠ WORD EQUALITY, NOT SUBSTRING — AND THE OLD SUBSTRING TEST SHIPPED FOUR
 * MEASURED DEFECTS, ALL FOUND BY THE REVIEWER'S CORPUS.
 *
 *   "Increase our subscription price" → matched "Hourly Support Rate"
 *        because  "our" ⊂ "h-OUR-ly"
 *   "Grow total revenue"              → matched "Total Headcount"
 *        because  "total" was admitted as a content word
 *   "Increase win rate"               → matched "Pricing Strategy"
 *        because  "rate" ⊂ "st-RATE-gy"
 *
 * Two independent causes, and both are fixed here rather than one:
 *   1. `includes()` matched INSIDE a word. Tokenising the factor label and
 *      comparing whole tokens makes that impossible by construction.
 *   2. `length > 2` admitted stopwords — "our", "the", "all", "net", "total",
 *      "new" — which carry no subject identity and collide constantly. They are
 *      dropped from BOTH sides.
 *
 * ⭐ AND THE FOURTH DEFECT, WHICH WAS A GAP RATHER THAN A LIE AND IS THE ONE
 * THE WHOLE SURFACE EXISTS TO CATCH: the caller used `interventions.find(...)`,
 * binding the FIRST factor whose label collided. With a decoy ordered ahead of
 * the genuinely-defied lever, the real contradiction was never examined and the
 * product went SILENT on a true contradiction. That is why this function
 * returns a SCORE and the caller takes the BEST match — see
 * {@link detectDirectionalContradiction}.
 *
 * ⚠ NO STEMMING, deliberately, and the gap is PINNED rather than hidden:
 * "Raise our prices" does not resolve against "Price Level". That is
 * fail-closed (silent on a real contradiction, never a false claim), and the
 * exact set is asserted in `objective-contradiction.reviewer-corpus.test.ts`
 * with a positive control on the singular forms, so it REDs if the set grows or
 * shrinks (trap 22f).
 */
function subjectFactorMatchScore(subject: string, factorLabel: string): number {
  const subjectTokens = tokenise(subject);
  if (subjectTokens.length === 0) return 0;
  const factorTokens = new Set(tokenise(factorLabel));
  if (factorTokens.size === 0) return 0;
  let score = 0;
  for (const token of subjectTokens) if (factorTokens.has(token)) score += 1;
  return score;
}

/**
 * ⭐ ARM A. The aim states a direction over a lever the options intervene on,
 * and the leader sits at the wrong end of it.
 *
 * THE FIRE CONDITION IS ARITHMETIC. The goal label decides only `direction`;
 * everything that follows is intervention values:
 *   1. the subject must resolve to a factor the options actually intervene on —
 *      the gate that keeps `Maximise ARR` (a direction over the GOAL METRIC)
 *      silent, because no option intervenes on the goal;
 *   2. the leader's value on that factor must be at the wrong extreme;
 *   3. at least one other option must move it the way the aim asks — STRICTLY
 *      beyond the leader, so an option sitting at the SAME lever value is not
 *      counted as pursuing (a surviving mutant proved this branch untested).
 *
 * The returned `pursuing_leader_*` is the containment clause: among the options
 * that DO pursue the aim, which leads, and by what share. Derived from the SAME
 * run's win probabilities — never a second analysis call, never an invented
 * number. When the pursuing subset is empty the whole verdict is `null`, so the
 * clause can never be emitted without a subset to describe.
 */
export function detectDirectionalContradiction(
  goalLabel: unknown,
  options: readonly ObjectiveOptionView[],
  interventions: readonly InterventionView[],
): DirectionalContradiction | null {
  const intent = deriveGoalIntent(goalLabel);
  if (intent.direction === 'undetermined' || intent.subject === null) return null;

  const comparable = options.filter(isComparable);
  if (comparable.length < 2) return null;

  let leader: ObjectiveOptionView | null = null;
  for (const option of comparable) {
    if (!finite(option.win_probability)) continue;
    if (leader === null || option.win_probability > leader.win_probability) {
      leader = option;
    }
  }
  if (leader === null) return null;

  // ⚠ BEST MATCH, NOT FIRST MATCH. `interventions.find(...)` bound whichever
  // intervened factor happened to be ordered first, so a decoy label could
  // shadow the genuinely-defied lever and the surface went SILENT on a true
  // contradiction (reviewer corpus, measured). Ties keep the earlier factor,
  // which is stable and arbitrary rather than arbitrary and unstable.
  let factor: InterventionView | undefined;
  let bestScore = 0;
  for (const candidate of interventions) {
    const score = subjectFactorMatchScore(intent.subject as string, candidate.factor_label);
    if (score > bestScore) {
      bestScore = score;
      factor = candidate;
    }
  }
  if (factor === undefined) return null;

  const leaderValue = factor.by_option.get(leader.option_id);
  if (!finite(leaderValue)) return null;

  const wantsUp = intent.direction === 'increase';
  // The options that pursue the aim: strictly beyond the leader in the intended
  // direction. Strict, so an option tied with the leader is not "pursuing".
  const pursuing: ObjectiveOptionView[] = [];
  for (const option of comparable) {
    if (option.option_id === leader.option_id) continue;
    const value = factor.by_option.get(option.option_id);
    if (!finite(value)) continue;
    if (wantsUp ? value > leaderValue : value < leaderValue) pursuing.push(option);
  }
  if (pursuing.length === 0) return null;

  let pursuingLeader: ObjectiveOptionView | null = null;
  for (const option of pursuing) {
    if (pursuingLeader === null || option.win_probability > pursuingLeader.win_probability) {
      pursuingLeader = option;
    }
  }
  if (pursuingLeader === null || !finite(pursuingLeader.win_probability)) return null;

  return {
    kind: 'directional',
    leader_label: leader.option_label,
    factor_label: factor.factor_label,
    direction: intent.direction,
    pursuing_leader_label: pursuingLeader.option_label,
    pursuing_leader_win_probability: pursuingLeader.win_probability,
  };
}

// ============================================================================
// THE DISCLOSURE — copy, grammar and budget
//
// Constructed to the SAME contract as `intake-option-disclosure.ts`, which is
// the estate's reviewed template for a leading-space tail that names options:
//   - {@link OBJECTIVE_CONTRADICTION_RE_SRC} — the grammar the egress allowlist
//     compiles, DERIVED from the copy constants by `escapeForRegex`, never
//     hand-written beside them (trap 12: a hand-maintained mirror drifts, and
//     the drift always reads as green);
//   - {@link OBJECTIVE_CONTRADICTION_MAX_CHARS} — the length budget, DERIVED
//     from the builder's own worst-case output, never hand-estimated;
//   - a module-load probe that composes every shape and asserts each one
//     survives that same grammar AND the shared content defences.
//
// ⚠ THE FAILURE MODE THIS PREVENTS IS SILENT. A tail the allowlist does not
// admit does not error: `isAllowedRunAnalysisAssistantText` rejects the whole
// summary and the user silently receives the bland locked template instead.
// That is precisely how the constraint-gap disclosure was swallowed for
// ID-shaped labels, and it is invisible from a green suite.
// ============================================================================

/** Mirrors `INTAKE_OPTION_LABEL_MAX_CHARS` — one cap for every label slot. */
export const OBJECTIVE_LABEL_MAX_CHARS = 60;

const ATTAINMENT_LEAD_IN = ' Two different questions have two different answers here: ';
const ATTAINMENT_MIDDLE = ' came out ahead most often, but ';
const ATTAINMENT_TAIL_A = ' is more likely to reach your stated target (';
const ATTAINMENT_TAIL_B =
  '). Coming out ahead counts how often an option scored highest on the goal, not whether your target was met.';

const DIRECTIONAL_MIDDLE = ' came out ahead most often without moving ';
const DIRECTIONAL_TAIL_A = ' the way your goal asks. Among the options that do, ';
/**
 * ⚠⚠ THIS CLAUSE MUST NOT END IN THE HEADLINE'S OWN LEAD CLAUSE, and the first
 * draft did — caught by a probe, not by inspection.
 *
 * `analysis-result-headline.ts` builds its Case-E grammar as
 * `^.+? came out ahead in \d{1,3}% of runs of this model\.${TAIL_PATTERN}$`.
 * The draft ended with exactly `came out ahead in 28% of runs of this model.`,
 * so `^.+?` swallowed the template AND this whole disclosure, and the summary
 * was ADMITTED BY THE HEADLINE GRAMMAR — measured `true` with no tail slot
 * registered at all, against a control that read `false` once the clause was
 * changed.
 *
 * TWO HARMS, and the second is worse than the first:
 *   1. the egress test for this arm could not fail — it would have passed
 *      whether or not the tail slot was ever added (trap 13b, a guard agreeing
 *      with itself, reached through the GRAMMAR rather than through the test);
 *   2. the response was being validated as a CASE-E LEADER HEADLINE whose
 *      subject is the PURSUING option — i.e. the grammar read "Raise to £59
 *      came out ahead in 28% of runs" as the turn's top-level claim, which is a
 *      statement about the wrong option and precisely the misreading this
 *      surface exists to prevent.
 *
 * Keep this clause structurally distinct from `LEAD_CLAUSE_RE_SRC`. The
 * discriminating pair in the wiring spec pins it: the composed summary must be
 * REJECTED with the slot removed and ADMITTED with it present.
 */
const DIRECTIONAL_TAIL_B = ' came out ahead in ';
const DIRECTIONAL_TAIL_C = '% of runs.';

function quote(label: string): string {
  return `“${label}”`;
}

/**
 * Integer percentage. The shared content defences REJECT any raw decimal
 * (`\d+\.\d+`) in an assistant_text, so a probability must never be rendered
 * with a decimal point — `Math.round` here is a correctness requirement, not a
 * presentation preference.
 */
function pct(probability: number): number {
  // DELEGATES to the detector's own `toPercent`, so the number the copy prints
  // and the number the contradiction test was made on cannot drift apart. Two
  // roundings under one name is exactly how "(48% against 48%)" shipped.
  return toPercent(probability);
}

function composeAttainment(
  leader: string,
  better: string,
  betterPct: number,
  leaderPct: number,
): string {
  return (
    ATTAINMENT_LEAD_IN +
    quote(leader) +
    ATTAINMENT_MIDDLE +
    quote(better) +
    ATTAINMENT_TAIL_A +
    `${betterPct}% against ${leaderPct}%` +
    ATTAINMENT_TAIL_B
  );
}

function composeDirectional(
  leader: string,
  factor: string,
  pursuing: string,
  pursuingPct: number,
): string {
  return (
    ' ' +
    quote(leader) +
    DIRECTIONAL_MIDDLE +
    quote(factor) +
    DIRECTIONAL_TAIL_A +
    quote(pursuing) +
    DIRECTIONAL_TAIL_B +
    `${pursuingPct}` +
    DIRECTIONAL_TAIL_C
  );
}

/** Local regex-literal escape (kept local to avoid an import cycle). */
function escapeForRegex(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const LABEL_SLOT = `“[^”\\n]{1,${OBJECTIVE_LABEL_MAX_CHARS}}”`;

/**
 * The grammar the egress allowlist compiles for this tail. Two alternatives,
 * one per arm. Percentages are `\d{1,3}` — integers only, matching {@link pct}.
 */
export const OBJECTIVE_CONTRADICTION_RE_SRC =
  '(?:' +
  escapeForRegex(ATTAINMENT_LEAD_IN) +
  LABEL_SLOT +
  escapeForRegex(ATTAINMENT_MIDDLE) +
  LABEL_SLOT +
  escapeForRegex(ATTAINMENT_TAIL_A) +
  '\\d{1,3}% against \\d{1,3}%' +
  escapeForRegex(ATTAINMENT_TAIL_B) +
  '|' +
  '\\u0020' +
  LABEL_SLOT +
  escapeForRegex(DIRECTIONAL_MIDDLE) +
  LABEL_SLOT +
  escapeForRegex(DIRECTIONAL_TAIL_A) +
  LABEL_SLOT +
  escapeForRegex(DIRECTIONAL_TAIL_B) +
  '\\d{1,3}' +
  escapeForRegex(DIRECTIONAL_TAIL_C) +
  ')';

let exactRegex: RegExp | null = null;
function EXACT_REGEX(): RegExp {
  exactRegex ??= new RegExp(`^(?:${OBJECTIVE_CONTRADICTION_RE_SRC})$`);
  return exactRegex;
}

/**
 * Builder-side validation against the SAME source the allowlist compiles, so
 * builder/grammar drift fails loudly here instead of silently downgrading every
 * disclosure-bearing summary at the wire.
 */
function survivesEgress(suffix: string): boolean {
  if (suffix.includes('\n') || suffix.includes('\r')) return false;
  if (!EXACT_REGEX().test(suffix)) return false;
  return passesAssistantTextContentDefences(suffix);
}

/**
 * Egress budget the allowlist length cap is extended by — computed from the
 * builder's own worst case (every label at the cap, three-digit percentages),
 * never hand-estimated.
 */
export const OBJECTIVE_CONTRADICTION_MAX_CHARS = Math.max(
  composeAttainment(
    'x'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
    'y'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
    100,
    100,
  ).length,
  composeDirectional(
    'x'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
    'y'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
    'z'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
    100,
  ).length,
);

/**
 * ⭐ THE BUILDER. Returns `''` — ship nothing — in every state but a detected
 * contradiction with labels that survive their own grammar.
 *
 * ⚠⚠ `leaderWasNamed` IS A HARD PRECONDITION, NOT A CONVENIENCE. This tail
 * NAMES OPTIONS. On a turn whose headline was WITHHELD (the analysis is not
 * entitled to name a leader), appending it would introduce a leader claim the
 * turn had just withheld — which is the G-CEE-1 defect class this estate has
 * now found FIVE independent producers of, each one a new surface asserting the
 * leader the disclosure above it denied. The caller passes whether a headline
 * was actually composed; on `false` the builder ships nothing at all.
 *
 * Labels are capped at {@link OBJECTIVE_LABEL_MAX_CHARS}; a label that exceeds
 * the cap or carries the quoting characters suppresses the WHOLE disclosure
 * rather than shipping a half-sentence — an honest silence, never a mangled
 * claim.
 */
export function buildObjectiveContradictionDisclosure(
  contradiction: GoalAttainmentContradiction | DirectionalContradiction | null,
  leaderWasNamed: boolean,
): string {
  if (contradiction === null) return '';
  if (!leaderWasNamed) return '';

  const clean = (label: string): string | null => {
    const trimmed = typeof label === 'string' ? label.trim() : '';
    if (trimmed.length === 0 || trimmed.length > OBJECTIVE_LABEL_MAX_CHARS) return null;
    if (trimmed.includes('“') || trimmed.includes('”')) return null;
    return trimmed;
  };

  let suffix: string;
  if (contradiction.kind === 'goal_attainment') {
    const leader = clean(contradiction.leader_label);
    const better = clean(contradiction.better_label);
    if (leader === null || better === null) return '';
    suffix = composeAttainment(
      leader,
      better,
      pct(contradiction.better_probability_of_goal),
      pct(contradiction.leader_probability_of_goal),
    );
  } else {
    const leader = clean(contradiction.leader_label);
    const factor = clean(contradiction.factor_label);
    const pursuing = clean(contradiction.pursuing_leader_label);
    if (leader === null || factor === null || pursuing === null) return '';
    suffix = composeDirectional(
      leader,
      factor,
      pursuing,
      pct(contradiction.pursuing_leader_win_probability),
    );
  }

  // The builder never ships a suffix its own published grammar would reject.
  return survivesEgress(suffix) ? suffix : '';
}

/**
 * BUILD-TIME PROBE — this module's copy must survive its own egress grammar and
 * the shared content defences, at module load, so a copy edit throws at import
 * rather than degrading the wire.
 *
 * ⚠ EVERY ARM HAS A POSITIVE CONTROL (trap 13). A survives-its-own-grammar
 * probe passes vacuously if the composer never produces anything, so the corpus
 * below spans both arms, ordinary labels, and the worst case at the cap.
 *
 * The leader-vocabulary half is checked in this module's TEST rather than here,
 * to avoid an import cycle through `compose/leading-option-egress-guard.ts`
 * (which imports the coaching surface this file feeds) — the same construction,
 * and the same stated reason, as `intake-option-disclosure.ts`.
 */
export const OBJECTIVE_DISCLOSURE_SURVIVES_ITS_OWN_GRAMMAR: true = (() => {
  const shapes: readonly string[] = [
    composeAttainment('Hold at £49 Per Seat (Status Quo)', 'Raise to £59 Per Seat', 48, 0),
    composeAttainment('A', 'B', 100, 0),
    composeAttainment(
      'x'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
      'y'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
      100,
      100,
    ),
    composeDirectional(
      'Hold at £49 Per Seat (Status Quo)',
      'Seat Price Level',
      'Raise to £59 Per Seat',
      28,
    ),
    composeDirectional('A', 'B', 'C', 0),
    composeDirectional(
      'x'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
      'y'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
      'z'.repeat(OBJECTIVE_LABEL_MAX_CHARS),
      100,
    ),
  ];
  for (const shape of shapes) {
    if (!survivesEgress(shape)) {
      throw new Error(
        'objective-contradiction: composed suffix does not survive its own published ' +
          'grammar — the allowlist would reject it and the user would silently receive ' +
          `the locked template. Offending shape: ${shape}`,
      );
    }
    if (shape.length > OBJECTIVE_CONTRADICTION_MAX_CHARS) {
      throw new Error(
        'objective-contradiction: composed suffix exceeds its own derived budget ' +
          `(${shape.length} > ${OBJECTIVE_CONTRADICTION_MAX_CHARS}).`,
      );
    }
  }
  return true as const;
})();

// ============================================================================
// ADAPTERS — the wiring layer
//
// ⚠ THESE ARE THE PART THAT CAN BE SILENTLY WRONG. The detectors above are
// pure and easy to test; an adapter that reads the wrong field, or reads the
// right field off the wrong object, makes every one of those tests true and the
// product silent. CLAUDE.md trap 16's inverse: reachability WITHIN a module is
// not reachability in the system, and a fixture you wrote yourself is not
// evidence about the wire.
//
// Every field read here is the SAME field, off the SAME object, that
// `context/analysis-compact.ts:768-779` reads — the estate's existing
// projection of `option_comparison[]`. Deliberately NOT imported from it (that
// module pulls in the whole projection graph and would make this a non-leaf),
// but deliberately IDENTICAL in field names and coercion rules, because a
// second reader that drifts from the first is trap 12 in its purest form.
// ============================================================================

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Project raw `option_comparison[]` records to the detector's view.
 *
 * Mirrors `analysis-compact.ts`'s reader exactly: `option_id` falls back to
 * `option_label`, `option_label` falls back to the id, `win_probability`
 * defaults to 0 when absent, and `probability_of_goal` / `status` are OMITTED
 * when absent rather than defaulted — absence is meaningful for both (ISL
 * fail-closes on the first; absent status means recommendable for the second).
 */
export function readObjectiveOptionViews(
  records: ReadonlyArray<Record<string, unknown>>,
): ObjectiveOptionView[] {
  const views: ObjectiveOptionView[] = [];
  for (const record of records) {
    const optionId =
      typeof record.option_id === 'string'
        ? record.option_id
        : typeof record.option_label === 'string'
          ? record.option_label
          : null;
    if (optionId === null) continue;
    const optionLabel =
      typeof record.option_label === 'string' ? record.option_label : optionId;
    const view: ObjectiveOptionView = {
      option_id: optionId,
      option_label: optionLabel,
      win_probability: typeof record.win_probability === 'number' ? record.win_probability : 0,
      ...(typeof record.probability_of_goal === 'number'
        ? { probability_of_goal: record.probability_of_goal }
        : {}),
      ...(typeof record.status === 'string' ? { status: record.status } : {}),
    };
    views.push(view);
  }
  return views;
}

/** The goal node's label, or `null` when the graph carries no identifiable goal. */
export function readGoalLabel(rawGraph: unknown): string | null {
  const graph = asRecord(rawGraph);
  if (graph === null) return null;
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];
  const goalNodeId = typeof graph.goal_node_id === 'string' ? graph.goal_node_id : null;
  for (const raw of nodes) {
    const node = asRecord(raw);
    if (node === null) continue;
    const isGoal = goalNodeId !== null ? node.id === goalNodeId : node.kind === 'goal';
    if (!isGoal) continue;
    return typeof node.label === 'string' ? node.label : null;
  }
  return null;
}

/**
 * Build the per-factor intervention view from the persisted graph.
 *
 * Handles BOTH shapes the estate carries, because the handler's own fallback
 * (`snapshot.rawPersistedGraph ?? { options: snapshot.options }`) can hand
 * either one: options as `nodes[]` entries with `kind: 'option'` (the L60
 * persisted row), or a separate top-level `options[]` array (cee-v3). An
 * intervention value is either a bare number or `{ value: number }`.
 *
 * Factor LABELS come from the graph's factor nodes; a factor with no resolvable
 * label is skipped rather than rendered by id — an id in prose is exactly what
 * `ASSISTANT_TEXT_ID_REGEX` rejects at egress, and shipping one would silently
 * downgrade the whole summary to the locked template.
 */
export function readInterventionViews(rawGraph: unknown): InterventionView[] {
  const graph = asRecord(rawGraph);
  if (graph === null) return [];
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : [];

  const factorLabels = new Map<string, string>();
  for (const raw of nodes) {
    const node = asRecord(raw);
    if (node === null) continue;
    if (typeof node.id === 'string' && typeof node.label === 'string') {
      factorLabels.set(node.id, node.label);
    }
  }

  const optionSources: Array<Record<string, unknown>> = [];
  for (const raw of nodes) {
    const node = asRecord(raw);
    if (node !== null && node.kind === 'option') optionSources.push(node);
  }
  if (Array.isArray(graph.options)) {
    for (const raw of graph.options) {
      const option = asRecord(raw);
      if (option !== null) optionSources.push(option);
    }
  }

  const byFactor = new Map<string, Map<string, number>>();
  for (const option of optionSources) {
    const optionId = typeof option.id === 'string' ? option.id : null;
    if (optionId === null) continue;
    const interventions = asRecord(option.interventions);
    if (interventions === null) continue;
    for (const [factorId, rawValue] of Object.entries(interventions)) {
      const value =
        typeof rawValue === 'number'
          ? rawValue
          : typeof asRecord(rawValue)?.value === 'number'
            ? (asRecord(rawValue)!.value as number)
            : null;
      if (value === null || !Number.isFinite(value)) continue;
      let entry = byFactor.get(factorId);
      if (entry === undefined) {
        entry = new Map<string, number>();
        byFactor.set(factorId, entry);
      }
      entry.set(optionId, value);
    }
  }

  const views: InterventionView[] = [];
  for (const [factorId, byOption] of byFactor) {
    const label = factorLabels.get(factorId);
    if (label === undefined) continue;
    views.push({ factor_id: factorId, factor_label: label, by_option: byOption });
  }
  return views;
}

/**
 * ⭐ THE ONE ENTRY POINT THE HANDLER CALLS.
 *
 * Arm B is tried FIRST and wins when both fire: a goal-attainment contradiction
 * is a statement about the user's actual TARGET, which is strictly more
 * informative than a statement about lever direction, and only ONE tail may
 * ship (the grammar admits one slot, and two sentences would double-count the
 * same leader). Exactly one sentence, or none.
 *
 * `leaderWasNamed` is threaded straight through to the builder's hard
 * precondition — on a withheld turn this returns `''`.
 */
export function composeObjectiveContradictionDisclosure(
  rawGraph: unknown,
  records: ReadonlyArray<Record<string, unknown>>,
  leaderWasNamed: boolean,
): string {
  if (!leaderWasNamed) return '';
  const options = readObjectiveOptionViews(records);
  if (options.length < 2) return '';

  const attainment = detectGoalAttainmentContradiction(options);
  if (attainment !== null) {
    return buildObjectiveContradictionDisclosure(attainment, leaderWasNamed);
  }

  const directional = detectDirectionalContradiction(
    readGoalLabel(rawGraph),
    options,
    readInterventionViews(rawGraph),
  );
  return buildObjectiveContradictionDisclosure(directional, leaderWasNamed);
}
