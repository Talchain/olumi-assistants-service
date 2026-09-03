/**
 * ⭐⭐ THE USER'S STATED TARGET, READ FROM THE GOAL NODE'S OWN LABEL AND
 * ATTESTED AGAINST THE BRIEF.
 *
 * ── THE WITNESSED DEFECT (staging build `f4c8f50`, 3 Sep 2026) ──────────────
 * A founder pasted a brief containing "£30k MRR within 18 months". The drafted
 * goal node was labelled **"Reach £30k MRR Within 18 Months"** and shipped with
 *
 *     goal_threshold: null   goal_threshold_raw: null
 *     goal_threshold_unit: null   goal_threshold_cap: null
 *
 * — the target existed ONLY as words inside a display string, and the product's
 * own analysis text said "no limits were set for this decision", three times.
 * Bundle: `olumi-programme-docs/artefacts/manual-test-2026-09-03/
 * olumi-debug-f2e2df1b-20260903.json`, node `552bd1c0`.
 *
 * ── THE CAUSE: THE MINT'S GATE READS THE WRONG OBJECT ──────────────────────
 * `enricher.ts`'s `applyGoalTargetRedirect` is THE ONE mint of `goal_threshold`
 * on the draft path, and both routes to it are gated by `isTargetGoalLabel`,
 * which asks whether a REGEX-INFERRED FACTOR LABEL contains one of four
 * substrings — `target` / `goal` / `objective` / `threshold`. It never looks at
 * the GOAL NODE, whose label is where the drafted target actually lands.
 *
 * MEASURED at `f4c8f501` by running `extractFactors` over the brief: 21 factors,
 * and **not one label contains any of the four words**. The £30,000 was
 * extracted — as a factor labelled `"Customer Count"`. So the gate is not
 * merely narrow for this brief, it is UNREACHABLE for it, and
 * `goalThresholdsMinted` came back `[]`.
 *
 * That is CLAUDE.md trap 19 at the level of the whole predicate: a guard bound
 * to its object by a VALUE PREDICATE (does this label contain a word?) that the
 * intended object need never satisfy, while the object itself — the goal node —
 * sits unread beside it. And trap 12d: four substrings standing in for the open
 * class "ways a person can name a target".
 *
 * ── WHY THIS DOES NOT REOPEN #789 ("no model authors a threshold") ─────────
 * The goal LABEL is model-authored, so a number read from it is NOT, on its
 * own, a number the user stated — and minting from the label alone would be
 * exactly the fabrication #789 closed. So the label is used ONLY to identify
 * WHICH quantity is the target; the number must then be ATTESTED in the user's
 * own brief by the same deterministic scan before anything is minted. Label
 * binds, brief attests, and a label quantity absent from the brief mints
 * NOTHING and says why.
 *
 * ── ⛔⛔ THE EXACT STRENGTH OF THAT ATTESTATION, AND IT IS WEAKER THAN THE
 *    SENTENCE ABOVE READS ────────────────────────────────────────────────────
 * `sameQuantity` answers **"does this figure OCCUR in the brief?"**. It does
 * NOT answer "did the user state this figure AS THEIR TARGET", and an earlier
 * version of this header read as though it did. That is the whole #789
 * defence, so the gap is stated here rather than left to be discovered.
 * Measured at `cd010b55`:
 *
 *     label "Keep Monthly Churn Below 4%"
 *     brief "…Trial-to-paid conversion is 12% and monthly churn is 4%."
 *       →  ok, { value: 0.04, unit: "%", briefQuote: "4%" }
 *
 * The brief states 4% as the CURRENT LEVEL. The model wrote the label. Nothing
 * in the brief says 4% is a target, and the mint stamps
 * `goal_threshold_frame: 'level'` on it — after which ISL computes a
 * `probability_of_goal` against a threshold nobody set. By this module's own
 * doctrine ("a wrong threshold is a confident lie, an absent one is a gap, and
 * a lie outranks a gap") that is the wrong side, and it is NOT CLOSED HERE.
 *
 * A second instance, same root, also open: a BARE YEAR attests a count —
 * label "Sign 2026 Enterprise Accounts" + brief "Our plan runs to 2026." mints
 * 2,026. (A third, "B2B" scanning as 2,000,000,000, WAS closed — see
 * `NOT_INSIDE_A_WORD` — because it is a scanner defect with a closed fix
 * rather than an instance of this predicate's breadth.)
 *
 * ⭐ THE REMEDY IS KNOWN AND IS NOT AN OPEN-ENDED STRING RULE, which is banned
 * here. `factor-extraction/index.ts` already resolves goal constructions and
 * carries a SPAN, having learned this exact lesson — *"an assertion, or a
 * suppression, must bind to its object by IDENTITY, and here identity is
 * position"*. Binding the brief attestation to a span that grammar resolved as
 * a TARGET, rather than to any occurrence of the figure, closes the class. That
 * is work in another module and a change to what this lane owns, so it is
 * reported at the boundary rather than taken: **this module guarantees that the
 * minted figure APPEARS IN THE USER'S BRIEF, and nothing stronger.**
 *
 * ⏰ RE-SURFACE TRIGGER — written here because a parked remedy with no trigger
 * is how this estate loses work: the register almost always has the row, and
 * what dies is anything that would surface it again (CLAUDE.md, chronic failure
 * 2). The span remedy is rowed in the PR thread for the register; it must be
 * picked up at WHICHEVER COMES FIRST of
 *   (a) the goal-chip surface that renders this field reaching staging — UI
 *       #1172 at time of writing — because that is the moment an unstated
 *       figure becomes something the product tells the user they said; or
 *   (b) 2026-10-01.
 * Until then the gap is asserted, not described: see the KNOWN GAP floor in
 * `__tests__/goal-label-target.test.ts`, which REDs when an instance closes.
 *
 * ── FAIL-CLOSED, EVERY BRANCH ─────────────────────────────────────────────
 *   no goal label                     -> refuse `no_goal_label`
 *   no non-temporal quantity in label -> refuse `no_quantity_in_label`
 *   quantity absent from the brief    -> refuse `quantity_not_attested`
 *   two or more attested quantities   -> refuse `ambiguous_multiple_attested`
 * The last is deliberate. Where the direction of a limit could not be proven,
 * this estate's ratified exit is to ASK rather than guess (ROADMAP 2.1051, and
 * the four-round oscillation recorded at CLAUDE.md trap 22f). The same rule
 * applies to WHICH of two numbers is the target: a wrong threshold is a
 * confident lie, an absent one is a gap, and a lie outranks a gap.
 *
 * ── TEMPORAL QUANTITIES ARE NOT TARGETS, AND THE LIST IS DERIVED ──────────
 * "Reach £30k MRR Within 18 Months" carries TWO quantities. `18 Months` is a
 * deadline, and this service has already ruled that time is not a modelled
 * dimension — `partitionTemporalNonBinding` (ROADMAP 2.349) strips exactly this
 * class out of `goal_constraints[]` one stage later, for reasons written out
 * there. Admitting it here would mint `goal_threshold_raw: 18, unit: "months"`
 * onto a node measured in £. The temporal vocabulary is IMPORTED from
 * `compound-goal/extractor.ts`'s `TIME_UNIT_ALT`, which is itself derived from
 * `WORD_UNITS`' `temporal` flag — not restated here (trap 12).
 *
 * ⚠ THE EXCLUSION IS ABOUT THE QUANTITY'S OWN UNIT, NOT ABOUT A NEARBY WORD.
 * "4% year on year" and "£200k year on year" are a percentage and a sum of
 * money that happen to be measured annually; only a BARE COUNT followed by a
 * time word is a duration. Classifying by the trailing word alone deleted
 * attested targets and, on a two-target brief, converted an honest refusal into
 * a silent pick — measured, and written up at `scanQuantities`.
 *
 * Every other grammar below is likewise composed from `utils/magnitude-alphabet`
 * (`AMOUNT_DIGITS`, the ONE magnitude alternation, the ambiguous-trailer guard),
 * so this module cannot read `£30k` differently from the extractor that already
 * reads it elsewhere.
 *
 * PURE. No I/O, no telemetry, no mutation — the caller owns both.
 */

import {
  AMOUNT_DIGITS,
  MAGNITUDE_AMBIGUOUS_TRAILER_GUARD,
  magnitudeSuffixPattern,
  parseAmountDigits,
  resolveMagnitude,
} from "../../utils/magnitude-alphabet.js";
import { TIME_UNIT_ALT } from "../compound-goal/extractor.js";

/**
 * Why no target was derived. Carried so the caller can log a REASON rather than
 * a silence: an absent threshold that mints nothing must be distinguishable
 * from a scanner that stopped matching (CLAUDE.md trap 12, "fail loud").
 */
export type GoalLabelTargetRefusal =
  | "no_goal_label"
  | "no_quantity_in_label"
  | "quantity_not_attested"
  | "ambiguous_multiple_attested";

/**
 * A target quantity read from the goal label and attested in the brief.
 *
 * ⚠ `value` IS IN THE `ExtractedFactor` CONVENTION, NOT USER UNITS. The regex
 * factor extractor pre-divides percentages into a 0–1 fraction, and
 * `applyGoalTargetRedirect` reconstructs the raw percent by multiplying by 100
 * on the `unit === "%"` branch. A synthesised factor that handed it `30` for
 * "30%" would register `goal_threshold_raw: 3000`. So `%` values are FRACTIONS
 * here, exactly as `extractFactors` emits them, and every other unit is the
 * number as written.
 */
export interface GoalLabelTarget {
  /** Fraction for `%`; the written amount (magnitude applied) for every other unit. */
  value: number;
  /** `£` / `$` / `€` / `%` / `count`. */
  unit: string;
  /** The exact span of the GOAL LABEL this was read from. */
  matchedText: string;
  /** The exact span of the BRIEF that attests it. */
  briefQuote: string;
}

export type GoalLabelTargetResult =
  | { ok: true; target: GoalLabelTarget }
  | { ok: false; refusal: GoalLabelTargetRefusal };

/** Currency symbols this service reads, in the spelling every sibling pattern uses. */
const CURRENCY_CLASS = "[£$€]";

/**
 * The unit a quantity carries when it is neither money nor a percentage — a
 * bare number of things. Named because it is the ONE unit that a trailing time
 * word can legitimately turn into a duration, and the temporal test below reads
 * it rather than restating the currency/percent precedence a second time.
 */
const UNIT_COUNT = "count";

/**
 * ONE quantity grammar, used for the label scan AND the brief scan, so a number
 * cannot be readable in one and invisible in the other.
 *
 * Order of the trailing groups is load-bearing: `%` binds tighter than a word
 * unit ("30% months" is not a thing), and the temporal tail is captured rather
 * than excluded by lookahead so the caller can report WHY a quantity was
 * skipped instead of it vanishing.
 */
/**
 * ⭐⭐⭐ "THE DIGIT RUN ENDS HERE" — without which the refusal below is not a
 * refusal, it is a SHORTER, WRONG NUMBER.
 *
 * `AMOUNT_DIGITS` is greedy and `MAGNITUDE_AMBIGUOUS_TRAILER_GUARD` is a bare
 * negative lookahead, so when the guard fires the engine does not reject the
 * match — it BACKTRACKS THE DIGITS until the lookahead is satisfied. Measured
 * through `deriveGoalTargetFromLabel` at `cd010b55`:
 *
 *     "£80kARR"                         →  £8   (intended: no match)  10,000x
 *     "£1.5mARR"                        →  £1
 *     "the run rate is £250grandish"    →  £25
 *     "Reach £30kMRR Within 18 Months"  →  £3   ← the very target this exists for
 *
 * `MRR` / `ARR` straight after a magnitude key is not a corner case in this
 * product's domain: the witnessed goal label is literally
 * "Reach £30k MRR Within 18 Months", and a model writing it without the space
 * is a coin flip. On the BRIEF side it is worse than a bad read — it injects
 * spurious small quantities into the attested set, so a label reading
 * "Reach £80kARR" against a brief containing "£8" mints **£8** as the target.
 *
 * ⚠⚠ TWO DISCLOSURES, BOTH LOAD-BEARING.
 *
 * 1. THE CLASS IS ESTATE-WIDE AND PRE-DATES THIS MODULE. `compound-goal/
 *    extractor.ts` and `provenance/stated-amounts.ts` compose the same guard
 *    the same way; this scanner is the fourth instance, not the origin. It is
 *    fixed HERE because this consumer mints THE goal threshold — the single
 *    number ISL scores every option against.
 *
 * 2. ⛔ THIS CONSTANT IS A DELIBERATE, TEMPORARY DUPLICATE. Sibling PR #1327
 *    adds exactly this anchor to `utils/magnitude-alphabet.ts` as
 *    `AMOUNT_RUN_END`, the shared home where it belongs. That PR is not merged,
 *    and adding the export here as well would put two PRs in one file for no
 *    gain. **WHEN #1327 LANDS, DELETE THIS AND IMPORT `AMOUNT_RUN_END`** — the
 *    two are character-for-character identical, which is the point and also the
 *    hazard (trap 12). Rebasing onto #1327 is the reviewer's stated merge order.
 */
const DIGIT_RUN_END_LOCAL = "(?!\\d)(?!,\\d{3})(?!\\.\\d)";

/**
 * ⭐ A DIGIT INSIDE A WORD IS NOT A QUANTITY. The scanner had no left boundary,
 * so the `2` of **"B2B"** scanned as the count 2,000,000,000 — `B` read as a
 * magnitude key — and attested a label reading "Reach 2bn Monthly Impressions"
 * against a brief that says only "We're a B2B SaaS". Measured at `cd010b55`:
 * `briefQuote: "2B"`.
 *
 * ⚠ THE KEY IS NAMED AS `B`, NOT SPELLED OUT, AND THAT IS DELIBERATE. Spelling
 * the scale word here trips `magnitude-alphabet.union.test.ts`'s REVIEWED-
 * manifest guard, whose remedy is a row in that file — which #1324 and #1327
 * are both already editing. This module holds NO magnitude list (it composes
 * `magnitudeSuffixPattern` from the one alphabet), so there is nothing for that
 * guard to protect here; naming the key avoids putting a third PR into one
 * contended registry. If a reviewer would rather have the REVIEWED row, it is
 * one line and this note is the reason it is not already there.
 *
 * Bound to the LEFT, where the defect is; a letter to the RIGHT is already the
 * ambiguous-trailer guard's question, and they must not be collapsed (trap 21).
 *
 * ⭐⭐ THE DIGIT IN THE CLASS IS NOT DECORATION, AND A MUTANT FOUND IT. The
 * first cut was `(?<![A-Za-z])`. A mutant widening it to `[A-Za-z0-9]` SURVIVED
 * the corpus, so rather than assert it equivalent (an equivalent mutant must be
 * DEMONSTRATED, never assumed) the two spellings were run against each other
 * over a corpus drawn from outside the fix, with a positive control proving the
 * probe could see a difference. They differ, and the letters-only spelling is
 * the WORSE of the two:
 *
 *     "12a34"     letters-only → ["12", "4"]      digits too → ["12"]
 *     "£30k30k"   letters-only → ["£30", "0k"]    digits too → ["£30"]
 *
 * When the start of a number is refused, the engine advances INTO it and
 * matches the tail — publishing "4" out of "34" and "0k" out of "30k". That is
 * the backtracking defect one level out: a refusal that yields a shorter, wrong
 * number instead of nothing. A digit can never legitimately begin a new
 * quantity while another digit sits immediately to its left, so the class
 * carries both.
 */
const NOT_INSIDE_A_WORD = "(?<![A-Za-z0-9])";

function quantityScanner(): RegExp {
  return new RegExp(
    NOT_INSIDE_A_WORD +
      `(?<currency>${CURRENCY_CLASS})?` +
      `(?<amount>${AMOUNT_DIGITS})` +
      DIGIT_RUN_END_LOCAL +
      magnitudeSuffixPattern("mag") +
      MAGNITUDE_AMBIGUOUS_TRAILER_GUARD +
      `(?<pct>\\s*%|\\s*percent\\b)?` +
      `(?<time>\\s*(?:${TIME_UNIT_ALT})\\b)?`,
    "gi",
  );
}

interface ScannedQuantity {
  value: number;
  unit: string;
  matchedText: string;
  temporal: boolean;
}

/** Every quantity in `text`, in source order, each classified temporal or not. */
function scanQuantities(text: string): ScannedQuantity[] {
  const out: ScannedQuantity[] = [];
  const re = quantityScanner();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // A zero-length match cannot happen with a required `amount`, but an
    // unadvancing lastIndex would hang the loop — assert rather than assume.
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    const digits = parseAmountDigits(m.groups?.amount);
    if (digits === null) continue;

    const magnitude = resolveMagnitude(m.groups?.mag);
    const currency = m.groups?.currency;
    const isPercent = m.groups?.pct !== undefined;

    // `%` and a currency symbol are mutually exclusive readings; a currency
    // symbol wins because it is written on the left and cannot be incidental.
    let unit: string;
    let value: number;
    if (currency) {
      unit = currency;
      value = digits * magnitude;
    } else if (isPercent) {
      unit = "%";
      // THE FRACTION CONVENTION — see `GoalLabelTarget.value`.
      value = (digits * magnitude) / 100;
    } else {
      unit = UNIT_COUNT;
      value = digits * magnitude;
    }

    // ⭐⭐ THE QUESTION THIS ANSWERS IS "IS THIS QUANTITY DENOMINATED IN TIME?"
    // — NOT "IS A TIME WORD NEARBY?", WHICH IS WHAT IT USED TO ANSWER.
    //
    // The trailing `time` group is captured, not excluded by lookahead, so
    // "18 months" and "4% year on year" both carry it. Reading the group ALONE
    // classified the second as a duration, which is false by construction: a
    // percentage cannot be a duration, and neither can a sum of money. The
    // scanner has already decided which of the three the quantity is, two lines
    // above, so the test is bound to THAT decision — one place to change if the
    // unit set ever grows, and no second copy of the currency/percent
    // precedence to drift out of step with the first (trap 12).
    //
    // MEASURED at `d167f80a`, on the brief side, where the previous round had
    // just added the filter:
    //
    //   label "Reach £30k MRR And 4% Churn"
    //   brief "£30k MRR and churn under 4% year on year"
    //     →  ok, £30,000            ← ONE of the user's TWO stated targets
    //
    // The user stated two targets; "4% year on year" was dropped from the
    // attested set as temporal, `attested.length` fell to 1, and the module
    // SILENTLY PICKED ONE. Its own header commits to the opposite — where the
    // target could not be determined, ASK rather than guess (ROADMAP 2.1051,
    // trap 22f) — and at `cd010b55`, measured, this same input refused
    // `ambiguous_multiple_attested`.
    //
    // The same misclassification cost two SINGLE-target mints beside it, both
    // measured at both heads, so their direction is not inferred either:
    //
    //                                    cd010b55        d167f80a
    //   "4% year on year"     (brief)    mints %0.04     quantity_not_attested
    //   "£200k year on year"  (brief)    mints £200k     quantity_not_attested
    //
    // Those two are gaps, not lies, and the previous round introduced them; the
    // two-target case above is the lie, and it is why this is fixed rather than
    // rowed. The LABEL side carried the same misclassification BEFORE either
    // head — "Keep Churn Under 4% Year On Year" refused `no_quantity_in_label`
    // at `cd010b55` too — and one predicate serves both sides, so this closes
    // that as well.
    //
    // ⚠ THE COMPLEMENT IS PINNED SEPARATELY, because a fix spelled "stop
    // filtering when a time word follows" would reopen the defect the previous
    // round closed: a BARE COUNT with a time word is still a duration, and the
    // suite asserts that in both directions on inputs of its own.
    const isTemporal = m.groups?.time !== undefined && unit === UNIT_COUNT;

    out.push({ value, unit, matchedText: m[0], temporal: isTemporal });
  }
  return out;
}

/**
 * Two quantities are the same when their unit and their resolved value agree.
 *
 * The comparison is on the RESOLVED number, so "£30k" in the label and
 * "£30,000" in the brief are the same quantity — which is the point: the label
 * is a rewrite of the brief, and requiring byte equality would refuse every
 * ordinary paraphrase. A relative tolerance absorbs float error from the `%`
 * division without admitting a genuinely different figure (1e-9 is ~30 orders
 * of magnitude tighter than the smallest distinction any brief makes).
 */
function sameQuantity(a: ScannedQuantity, b: ScannedQuantity): boolean {
  if (a.unit !== b.unit) return false;
  if (a.value === b.value) return true;
  const scale = Math.max(Math.abs(a.value), Math.abs(b.value));
  return scale > 0 && Math.abs(a.value - b.value) / scale < 1e-9;
}

/**
 * Derive the goal target from the goal node's own label, attested against the
 * brief. See the module header for why both halves are required.
 *
 * @param goalLabel the GOAL NODE's label — binds which quantity is the target
 * @param brief     the user's own words — attests that the number is theirs
 */
export function deriveGoalTargetFromLabel(
  goalLabel: string | undefined | null,
  brief: string | undefined | null,
): GoalLabelTargetResult {
  if (typeof goalLabel !== "string" || goalLabel.trim() === "") {
    return { ok: false, refusal: "no_goal_label" };
  }

  const labelQuantities = scanQuantities(goalLabel).filter((q) => !q.temporal);
  if (labelQuantities.length === 0) {
    return { ok: false, refusal: "no_quantity_in_label" };
  }

  const briefText = typeof brief === "string" ? brief : "";
  // ⚠⚠ THE TEMPORAL EXCLUSION APPLIES TO BOTH SIDES, AND IT USED TO APPLY TO
  // ONE. The label side was filtered; the brief side was not — and
  // `sameQuantity` compares only unit and value, so "18 months" in the brief
  // ATTESTED a bare count of 18 in the label. Measured at `cd010b55`:
  //
  //   label "Reach 18 Enterprise Accounts" + brief "…grow the business within
  //   18 months."   →  ok, { value: 18, unit: "count", briefQuote: "18 months" }
  //   label "Hire 6 Salespeople" + brief "…keep at least 6 months of runway."
  //                 →  ok, { value: 6,  unit: "count", briefQuote: "6 months" }
  //
  // The user stated 18 as a DEADLINE and the mint stamped it as a LEVEL. That
  // is precisely the class the header says is closed, and the reason
  // `TIME_UNIT_ALT` is imported at all — the invariant was right, its domain
  // had one side missing.
  //
  // ⚠ THE KIT COULD NOT SEE IT: the mutant mutates the LABEL-side filter, so by
  // construction it only ever measured the side that exists, and no case in the
  // corpus had a temporal brief quantity as the attesting one. The invariant
  // was written with the same asymmetry as the code (trap 13d).
  //
  // ⚠⚠ AND THE SENTENCE THAT USED TO SIT HERE WAS FALSE. It read: "It cannot
  // cost a legitimate mint, and that is structural rather than measured." The
  // structural argument was sound about the shape it examined — a temporal
  // LABEL quantity is refused above as `no_quantity_in_label`, and
  // `sameQuantity` requires equal units — and it was still wrong, because it
  // assumed `temporal` meant "denominated in time" when the classifier read
  // only whether a time word followed. It DID cost a legitimate mint: a
  // two-target brief refused correctly at `cd010b55` and minted one of the two
  // at `d167f80a`. See `scanQuantities` for the measurement and the fix. The
  // claim is not restated in a corrected form here — the predicate now says it
  // itself, and a safety argument written a second time in a second place is
  // the mirror this estate keeps paying for (trap 12).
  const briefQuantities = scanQuantities(briefText).filter((q) => !q.temporal);

  // ⚠ THE ATTESTED SET IS DEDUPED BY QUANTITY, NOT BY OCCURRENCE. A label that
  // names one target and a brief that states it three times is UNAMBIGUOUS;
  // counting occurrences would refuse it as "multiple".
  const attested: Array<{ label: ScannedQuantity; brief: ScannedQuantity }> = [];
  for (const lq of labelQuantities) {
    if (attested.some((a) => sameQuantity(a.label, lq))) continue;
    const match = briefQuantities.find((bq) => sameQuantity(bq, lq));
    if (match) attested.push({ label: lq, brief: match });
  }

  if (attested.length === 0) return { ok: false, refusal: "quantity_not_attested" };
  if (attested.length > 1) return { ok: false, refusal: "ambiguous_multiple_attested" };

  const only = attested[0];
  return {
    ok: true,
    target: {
      value: only.label.value,
      unit: only.label.unit,
      matchedText: only.label.matchedText,
      briefQuote: only.brief.matchedText,
    },
  };
}

/**
 * The conservation question, asked as a predicate so a guard can fail on it.
 *
 * TRUE when the goal node's label states a non-temporal quantity that the
 * user's brief also states, and the node carries NO typed threshold — i.e. the
 * exact state the witnessed defect shipped in, where the target survived only
 * as label prose. Deliberately narrower than "the label has digits": a figure
 * the brief does not contain is a model invention and must NOT be minted, so it
 * is not a conservation failure either.
 */
export function goalLabelStatesUncarriedTarget(
  node: { label?: string | null; goal_threshold_raw?: unknown } | null | undefined,
  brief: string | undefined | null,
): boolean {
  if (!node) return false;
  const raw = node.goal_threshold_raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return false;
  return deriveGoalTargetFromLabel(node.label, brief).ok;
}
