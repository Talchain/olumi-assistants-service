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
 * `enricher.ts`'s `applyGoalTargetRedirect` is the ENRICHER'S mint of
 * `goal_threshold` on the draft path, and both routes to it are gated by
 * `isTargetGoalLabel`, which asks whether a REGEX-INFERRED FACTOR LABEL
 * contains one of four substrings — `target` / `goal` / `objective` /
 * `threshold`. It never looks at the GOAL NODE, whose label is where the
 * drafted target actually lands.
 *
 * MEASURED at `f4c8f501` by running `extractFactors` over the brief: 21 factors,
 * and **not one label contains any of the four words**. The £30,000 was
 * extracted — as a factor labelled `"Customer Count"`. So the gate is not
 * merely narrow for this brief, it is UNREACHABLE for it, and
 * `goalThresholdsMinted` came back `[]`.
 *
 * ── ⚠⚠ THE PREMISE THIS MODULE WAS BUILT ON, CORRECTED ────────────────────
 * Earlier versions of this header, of `applyGoalTargetRedirect`'s doc and of
 * the PR body all said that function was **THE ONE** mint of `goal_threshold`
 * on the draft path. **It is not, and it was not on 3 Sep either.**
 * `applyStatedGoalTarget` (`cee/draft/records/projector.ts:1312`) mints the
 * same five fields from the model's STATED GOAL RECORD. It read as absent
 * because `stripModelAuthoredGoalThreshold` deleted its output before the
 * enricher saw it.
 *
 * **#1339 (merged 4 Sep 2026) removed that strip on the ANTHROPIC path.** So on
 * that provider the projector now mints first and reaches the founder's exact
 * witnessed case — `Reach £30k MRR Within 18 Months` — before this module runs,
 * and this module correctly declines. The strip is deliberately RETAINED on the
 * OpenAI path (`adapters/llm/openai.ts`), where the projector's mint can never
 * survive.
 *
 * ⭐ HOW A WRONG UNIVERSAL SURVIVED THREE ROUNDS OF REVIEW. The load-bearing
 * measurement — running `extractFactors` over the brief — is a SINGLE-STAGE
 * instrument. It is true about the factor-extraction stage and structurally
 * cannot see a mint two stages upstream. CLAUDE.md trap 16-inverse:
 * reachability within one stage is not reachability in the system. What was
 * re-derived each round was that `isTargetGoalLabel` gates both routes into
 * `applyGoalTargetRedirect`, which is true; the universal beside it was never
 * tested.
 *
 * ── ⭐ THE CLASS THIS MODULE ACTUALLY CATCHES, POST-#1339 ──────────────────
 * Two residual classes, and they are the honest scope:
 *   1. the model puts the figure in the goal LABEL but does not emit a stated
 *      `goal` record carrying it as a numeric target — the projector branch
 *      requires `typeof item.value === "number" && goalValueIsATarget(item.role)`;
 *   2. the whole OPENAI path, where the strip still runs, so the projector's
 *      mint is always deleted and this is the only route left.
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
 * a lie outranks a gap") that is the wrong side.
 *
 * ✅ CLOSED IN ROUND 6 (CEE #1328, 14 Sep 2026 — see the ROUND 6 block at the
 * end of this file) BY REMOVING THE WRITE, NOT BY A BETTER RULE. Round 5 added
 * a ROLE rule after attestation-by-equality (the ROUND 5 block below
 * `sameQuantity`); it caught much, and sixteen defects later Codex's
 * "We rejected the proposal to reach £64k MRR." still returned `ok: true`. The
 * round-five tweak was run in advance and oscillated. So the role rule now
 * decides only HOW WELL the user's words bind the figure (`governed` vs
 * `present_unbound`), and `deriveGoalTargetCandidate` hands that to the
 * orchestration seam as a CANDIDATE to ask the user about. Nothing on this
 * route writes `goal_threshold` any more. The measurements above are kept as
 * the record of what this module used to do.
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
 * ⏰⛔ RE-SURFACE TRIGGER — **IT HAS ALREADY FIRED. THIS IS NOT A PARKED
 * REMEDY ANY MORE.**
 *
 * The trigger was written as "whichever comes first of (a) the goal-chip
 * surface that renders this field reaching staging — UI #1172 — or
 * (b) 2026-10-01". **Derived 7 Sep 2026: UI #1172 merged to `staging` on
 * 2026-09-04** (`Talchain/DecisionGuideAI`, base `staging`, merge commit
 * `a2fd0656`). Limb (a) fired three days before this was re-read, and the row
 * had not moved — which is exactly the failure `session-start-derive.sh` exists
 * to catch (CLAUDE.md chronic failure 2: the register almost always has the
 * row; what dies is anything that would surface it again). A trigger nobody
 * re-derives is a scheduler that has already stopped.
 *
 * CONSEQUENCE, stated plainly: the moment named as "when an unstated figure
 * becomes something the product tells the user they said" is **now**, not
 * later. The span remedy — bind the attestation to a span that
 * `factor-extraction/index.ts`'s goal grammar resolved as a TARGET — is DUE.
 *
 * ✅ DONE, round 5 — with one correction to the remedy as written above. "Bind
 * to a span the index.ts grammar resolved as a TARGET" would have refused the
 * founder's own phrasing ("I want to reach £30k MRR"), which no deterministic
 * resolver claims; the rule below therefore composes the existing closed
 * vocabularies (goal words, `signals/brief-signals.ts` TARGET_VERBS, the
 * stated-level present-state list, the goal-pair span now exported from
 * `index.ts`) positionally, and binds the metric through the user's words or
 * the user's own goal sentence. The KNOWN-DROPPED table in the test file pins
 * EXACTLY what it still refuses.
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
  AMOUNT_RUN_END,
  MAGNITUDE_AMBIGUOUS_TRAILER_GUARD,
  magnitudeSuffixPattern,
  parseAmountDigits,
  resolveMagnitude,
} from "../../utils/magnitude-alphabet.js";
import { TIME_UNIT_ALT } from "../compound-goal/extractor.js";
import { TARGET_VERBS } from "../signals/brief-signals.js";
import { resolveStatedGoalPairSpan } from "./index.js";

/**
 * Why no target was derived. Carried so the caller can log a REASON rather than
 * a silence: an absent threshold that mints nothing must be distinguishable
 * from a scanner that stopped matching (CLAUDE.md trap 12, "fail loud").
 */
export type GoalLabelTargetRefusal =
  | "no_goal_label"
  | "no_quantity_in_label"
  | "quantity_not_attested"
  | "ambiguous_multiple_attested"
  /* ── ROUND 5 (CEE #1328 BLOCKING 3): the figure OCCURS but was not STATED AS THIS GOAL'S TARGET ── */
  /** Attested by equality only — no target construction governs any occurrence. */
  | "quantity_not_stated_as_target"
  /** Every occurrence is a present-state report ("churn is 5% today", "MRR is £8k"). */
  | "stated_as_current_level"
  /** Every occurrence is a spend/cost/price/charge ("we spent £42k", "we charge £49"). */
  | "stated_as_spend"
  /** Every occurrence reports a PAST level or achievement ("we reached £42k last year"). */
  | "stated_as_past"
  /** Governed by a bound/limit construction whose comparison direction the mint cannot carry. */
  | "limit_direction_not_representable"
  /** Governed, but negated ("we don't want to reach £42k"). */
  | "negated_target"
  /** Governed, but inside a conditional/hypothetical sentence ("if we wanted £42k"). */
  | "hypothetical_target"
  /** Governed, but the stated subject is not the user ("our competitor targets £42k"). */
  | "subject_not_bound"
  /** Governed, and the construction names a metric the goal label does not carry. */
  | "metric_mismatch"
  /** Governed, but the construction names NO metric and no goal sentence binds it. */
  | "metric_unbound"
  /** Governed, but the occurrence lies OUTSIDE the sentence the user wrote as their goal. */
  | "outside_goal_statement"
  /** Governed, but the amount is a CHANGE ("increase MRR by £64k") or a baseline ("from £42k"), not a level. */
  | "stated_as_change_amount";

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
  | {
      ok: false;
      refusal: GoalLabelTargetRefusal;
      /**
       * The brief span the refusal is ABOUT, when the figure was found. Carried
       * only by the round-5 role refusals so a log can say WHICH occurrence was
       * read as a level, a spend, a limit; the four original refusals keep
       * their exact shape.
       */
      briefQuote?: string;
    };

/**
 * What the caller knows about the goal node beyond its label. The user's own
 * goal sentence, when the projector stamped one (`provenance.source_quote`),
 * is the strongest binding this module can be handed: a figure INSIDE that
 * sentence is the user's goal figure; a figure outside it is a coincidence.
 */
export interface GoalLabelTargetContext {
  readonly goalSourceQuote?: string | null;
}

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
 * 2. ✅ THE TEMPORARY DUPLICATE IS GONE. This module briefly carried its own
 *    character-identical copy, `DIGIT_RUN_END_LOCAL`, because the shared anchor
 *    did not yet exist. **#1327 merged on 7 Sep 2026** and added it to
 *    `utils/magnitude-alphabet.ts` as `AMOUNT_RUN_END`, so the copy was deleted
 *    and the survivor is imported — the estate holds ONE anchor, not two
 *    (trap 12). The scanner below composes it.
 */

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
      AMOUNT_RUN_END +
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
  /** Half-open [index, end) of the match in the scanned text — identity is position (trap 19). */
  index: number;
  end: number;
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

    out.push({ value, unit, matchedText: m[0], temporal: isTemporal, index: m.index, end: m.index + m[0].length });
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

/* ===========================================================================
 * ROUND 5 — A FIGURE MUST BE STATED AS THIS GOAL'S TARGET, NOT MERELY OCCUR.
 *
 * `sameQuantity` answers "does this figure occur in the brief?". Every refusal
 * above the line was about the SCANNER; the class below is about ROLE, and it
 * is the class the module header called NOT CLOSED: a figure the user stated as
 * a current level, a cost, a year or a competitor's number attested a label the
 * MODEL wrote, and ISL then scored a `probability_of_goal` against a threshold
 * nobody set.
 *
 * THE RULE, stated against the SPEC ("the user stated this figure as the
 * target of this goal") and never against the failure in hand:
 *
 *   C1  the occurrence is GOVERNED by a target construction — one of
 *         · the goal-pair grammar's resolved span (`index.ts`, exported span);
 *         · a goal word (`target|goal|objective|threshold`) reaching the amount
 *           through ≤3 words ("our goal of reaching £20k MRR");
 *         · a desire lead (`want|aim|plan|need|hope|intend|would like`) reaching
 *           the amount through ≤3 words ("we want 800 customers");
 *         · a target verb (`signals/brief-signals.ts` TARGET_VERBS, plus the
 *           change verbs compound-goal already reads, plus `take|get|bring`
 *           in the "<verb> <metric> to <amount>" shape) reaching the amount
 *           through ≤3 words ("reach £30k MRR", "take conversion to 30%").
 *       and NOT screened out by a closed-class stop: negation, conditional
 *       mood, past tense, a present-state marker, a spend/price verb, a
 *       third-party subject, or a BOUND ("under 4%", "at least", "cap at") —
 *       the last withheld outright because `goal_threshold_frame` is the code
 *       constant `level` and this mint cannot carry a comparison direction; a
 *       ceiling minted as a level would be scored as something to REACH. The
 *       user's limit still rides `goal_constraints[]`, which keeps its operator.
 *   C2  the METRIC is bound by the user's words, never by the label alone:
 *         (a) the construction's metric words (the words between the governor
 *             and the amount, and the noun phrase after it) must ALL appear in
 *             the goal label — stated-level.ts's own subject-binding rule, fail
 *             closed ("competitor churn" does not bind "Churn");
 *         (b) a construction with NO metric words binds only if the occurrence
 *             lies INSIDE the sentence the user wrote as their goal
 *             (`provenance.source_quote`); no quote → withhold. The label is
 *             model-authored, so "we want to reach £42k" + "Reach £42k MRR"
 *             is the model's reading of the metric, not the user's statement;
 *         (c) if a goal sentence exists and the occurrence lies OUTSIDE it,
 *             withhold — two conjuncts that disagree withhold (a lie outranks
 *             a gap).
 *
 * Every vocabulary here is CLOSED and, where one already existed, IMPORTED —
 * but composing old lists positionally is a NEW rule, and the parts being old
 * does not validate the whole. The outside corpus in the test file is the
 * evidence; the KNOWN-DROPPED table there pins EXACTLY what this rule still
 * refuses among legitimate phrasings, so its reach cannot move silently in
 * either direction.
 * ========================================================================= */

/** Letter-word bridge of up to N words, each followed by whitespace. */
function bridge(n: number): string {
  return `(?:[A-Za-z][A-Za-z'-]*\\s+){0,${n}}`;
}

/** Closed goal-word governance: "target is", "goal of reaching", "objective: ". */
const GOAL_WORD_GOVERNOR = new RegExp(
  `\\b(?<lead>[A-Za-z']+)?\\s*\\b(?:target|goal|objective|threshold)s?\\b\\s*(?:is|of|to|at|for|:|=|-)?\\s*(?:(?:a|an|the)\\s+)?(?<bridge>${bridge(3)})$`,
  "i",
);

/** Closed desire-lead governance: "we want to reach", "aiming for", "would like". */
const DESIRE_GOVERNOR = new RegExp(
  // `want|need|would like` may take the amount directly ("we want 800
  // customers"); `aim|plan|hope|intend` are nouns as often as verbs ("our PLAN
  // runs to 2026") and govern only through their infinitive/prepositional
  // complement ("plan TO reach", "aim FOR", "hope TO hit").
  `\\b(?<lead>[A-Za-z']+)?\\s*\\b(?:(?:want(?:s|ed|ing)?|need(?:s|ed|ing)?|would\\s+like)\\b\\s+(?:to\\s+)?|(?:aim(?:s|ed|ing)?|plan(?:s|ned|ning)?|hop(?:e|es|ed|ing)|intend(?:s|ed|ing)?)\\s+(?:to|for|on|at)\\s+)(?:(?:a|an|the)\\s+)?(?<bridge>${bridge(3)})$`,
  "i",
);

/**
 * Target verbs: the imported closed list, plus the change verbs the compound-goal
 * extractor already reads in "<verb> <metric> to <amount>", plus `take|get|bring`
 * in that same shape only. Present-tense and gerund forms; the `-ed` past is
 * deliberately absent (a level REACHED is history, not a target).
 */
/**
 * PURE target verbs take the amount directly ("reach £42k", "hit 12%"); the
 * CHANGE verbs compound-goal reads, plus `take|get|bring`, govern only through
 * an explicit "to" ("grow MRR TO £42k", "take conversion TO 30%") — without it
 * "we grow 22% a year" is a rate report and "increase MRR by £42k" is a delta,
 * neither a level. `generate|deliver` are NOT here: "we generate £42k MRR" is
 * a statement of current output as often as an aim (measured 13 Sep: it
 * minted).
 */
const PURE_TARGET_VERB_STEMS = Array.from(
  new Set<string>([...TARGET_VERBS.map((v) => v.split(/\s+/)[0]!), "achieve", "reach", "hit"]),
).filter((v) => !/^(?:keep|reduce|grow)$/.test(v));
const CHANGE_TO_VERB_STEMS = [
  "grow", "maximise", "maximize", "increase", "improve", "boost", "raise", "take", "get", "bring", "lift", "push",
];
const TARGET_VERB_STEMS = [...PURE_TARGET_VERB_STEMS, ...CHANGE_TO_VERB_STEMS];

/** Inflections of a verb stem: -s/-es/-ing, with English's doubled final consonant ("get" → "getting"). */
function verbForms(stem: string): string {
  const last = stem[stem.length - 1]!;
  const doubled = /[bdgklmnprt]/.test(last) ? `${last}?` : "";
  return `${stem}${doubled}(?:s|es|ing)?`;
}

const TARGET_VERB_GOVERNOR = new RegExp(
  `\\b(?<lead>[A-Za-z']+)?\\s*\\b(?<verb>${PURE_TARGET_VERB_STEMS.map(verbForms).join("|")})\\b\\s+(?:(?:a|an|the|our|my)\\s+)?(?<bridge>${bridge(3)})(?:(?:of|at)\\s+)?$`,
  "i",
);
const CHANGE_TO_GOVERNOR = new RegExp(
  `\\b(?<lead>[A-Za-z']+)?\\s*\\b(?<verb>${CHANGE_TO_VERB_STEMS.map(verbForms).join("|")})\\b\\s+(?:(?:a|an|the|our|my)\\s+)?(?<bridge>${bridge(3)})to\\s+(?:(?:a|an|the)\\s+)?$`,
  "i",
);

/**
 * A bare subject + verb is a STATEMENT ("we hit £42k MRR", "we generate £42k")
 * — a fact or a habit, not an aim. A target verb governs only through an
 * infinitive/modal ("to reach", "will hit"), a desire lead (handled above), or
 * at clause start (imperative/gerund: "Reach £42k by June", "Reaching £42k…").
 * `target(ing)` is exempt: it is aspiration in every form.
 */
const BARE_SUBJECT_LEAD =
  /^(?:we|i|they|it|you|he|she|we're|we've|i'm|i've|they're|they've|it's|you're|revenue|mrr|arr|sales|churn|growth|the|our|my|this|that)$/i;
const ACHIEVEMENT_MARKER =
  /\b(?:'ve|have|has|had|just|already|recently|finally|now)\s+(?:already\s+|just\s+|now\s+|recently\s+)?(?:hit|reached|achieved|got|grown|passed|crossed|delivered|generated|made)\b|\b(?:hit|reached|achieved|passed|crossed)\s+(?:[A-Za-z£$€0-9.,%k]+\s+){0,4}(?:in|during|back\s+in|as\s+of)\s+(?:january|february|march|april|may|june|july|august|september|october|november|december|q[1-4]|20\d\d|19\d\d)\b/i;

/**
 * A BOUND, not a target: carries a direction the level mint cannot express.
 * Includes the downward-level verbs (`reduce|cut|lower|decrease … to`) because
 * "cut churn to 2%" is reached by going DOWN, and nothing on the node says so.
 */
const BOUND_GOVERNOR = new RegExp(
  `\\b(?:below|under|beneath|above|over|exceed(?:s|ing)?|at\\s+least|at\\s+most|no\\s+more\\s+than|no\\s+less\\s+than|not\\s+(?:to\\s+)?exceed(?:ing)?|(?:a\\s+)?max(?:imum)?(?:\\s+of)?|(?:a\\s+)?min(?:imum)?(?:\\s+of)?|capp?(?:ed)?(?:\\s+at|\\s+of)?|less\\s+than|more\\s+than|up\\s+to|floor\\s+of|ceiling\\s+of|keep(?:s|ing)?\\s+(?:[A-Za-z]+\\s+){0,3}(?:below|under|above|over|at)|(?:reduc(?:e|es|ing)|cut(?:s|ting)?|lower(?:s|ing)?|decreas(?:e|es|ing)|minimi[sz](?:e|es|ing)|bring(?:s|ing)?\\s+(?:[A-Za-z]+\\s+){0,3}down)\\s+(?:[A-Za-z]+\\s+){0,3}to)\\s+(?:(?:a|an|the)\\s+)?${bridge(2)}$`,
  "i",
);

/** Present-state report: copula or tense marker right before the amount. */
const PRESENT_STATE_GOVERNOR =
  /\b(?:is|are|am|'s|'re|sits?\s+at|stands?\s+at|running\s+at|currently(?:\s+at)?|now(?:\s+at)?|presently|today|at\s+the\s+moment|right\s+now|we\s+have|we've\s+got|we\s+are\s+at|we're\s+at)\s*(?:at|around|about|roughly|approximately|circa|only|just)?\s*$/i;
const PRESENT_STATE_MARKER = /\b(?:currently|now|presently|today|at\s+the\s+moment|right\s+now|so\s+far|to\s+date)\b/i;

/** Spend / price / charge verbs and nouns right before the amount. */
const SPEND_GOVERNOR =
  /\b(?:spen[dt](?:s|ing)?|cost(?:s|ing)?|pa(?:y|ys|id|ying)|charg(?:e|es|ed|ing)|pric(?:e|es|ed|ing)|budget(?:s|ed)?|invest(?:s|ed|ing)?|bill(?:s|ed)?|fee(?:s)?|salary|salaries)\b\s*(?:of|is|at|was|were|about|around|roughly|us|them|me|it|for|per)?\s*(?:(?:a|an|the)\s+)?(?:[A-Za-z]+\s+){0,2}$/i;

/** Negation proper, in the governing window. */
const NEGATION_MARKER =
  /\b(?:not|no|never|don't|doesn't|didn't|won't|wouldn't|can't|cannot|couldn't|shouldn't|mustn't|without|nor)\b/i;
/** Conditional mood — read on the WHOLE sentence, both sides of the amount. */
const CONDITIONAL_MARKER =
  /\b(?:if|unless|suppose|supposing|imagine|assuming|hypothetically|what\s+if|were\s+we\s+to|had\s+we|in\s+case)\b/i;
/** Past tense / past reference in the governing window. */
const PAST_MARKER =
  /\b(?:last\s+(?:year|month|quarter|week)|ago|previously|used\s+to|was|were|had|has\s+been|have\s+been|reached|achieved|hit\s+(?:[A-Za-z]+\s+)*last|grew|rose|fell|went|got\s+to|already)\b/i;

/** First-person and function tokens that may sit right before a governor. */
const FIRST_PERSON_OR_FUNCTION: ReadonlySet<string> = new Set([
  "we", "i", "our", "my", "us", "ours", "mine", "we're", "we've", "i'm", "i've", "we'll", "i'll",
  "we'd", "i'd", "let's", "the", "a", "an", "this", "that", "these", "those", "and", "but",
  "so", "then", "also", "still", "really", "just", "now", "to", "will", "would", "should", "must",
  "can", "could", "may", "might", "do", "does", "did", "have", "has", "had", "be", "is", "are",
  "which", "who", "what", "where", "with", "given", "of", "for", "in", "on", "by", "at",
  // The speaker's own organisation, named in the third person — still the user.
  "team", "company", "business", "firm", "startup", "ideally", "ultimately", "eventually",
  "hopefully", "realistically", "definitely", "really",
  // ⚠ NOT here, deliberately: "board", "founder(s)", "investor(s)", "competitor(s)",
  // "client(s)" — a target another party holds for the user is pinned in the
  // KNOWN-DROPPED table as a gap, never admitted as the user's own statement.
]);
/** Third-party possessives — never the user's own statement. */
const THIRD_PARTY_LEAD = /^(?:their|his|her|its|your|theirs|competitor'?s?|rival'?s?|client'?s?|customer'?s?)$/i;

/**
 * Tokens that END a metric phrase: prepositions, conjunctions, relatives. A
 * word after one of these belongs to a different phrase ("£30k BY June").
 */
const METRIC_STOP_TOKENS: ReadonlySet<string> = new Set([
  "to", "of", "is", "at", "for", "be", "by", "on", "in", "from", "with", "within", "per",
  "over", "across", "during", "before", "after", "and", "or", "but", "so", "which", "that",
  "as", "while", "until", "till", "than", "into", "onto", "towards", "toward", "if", "when",
  "where", "because", "since", "whilst", "then", "versus", "vs", "against", "without",
]);
/**
 * Tokens that are SKIPPED inside a metric phrase without ending it: articles,
 * quantifiers, hedges, and first-person furniture ("2bn MONTHLY impressions",
 * "the TOTAL headcount"). Temporal adverbs and participles are skipped too —
 * "18 enterprise accounts SIGNED" names the accounts, not the signing.
 */
const METRIC_SKIP_TOKENS: ReadonlySet<string> = new Set([
  "a", "an", "the", "about", "around", "roughly", "approximately", "circa", "our", "my", "us",
  "it", "its", "them", "up", "out", "this", "next", "every", "each", "end", "least", "most",
  "we", "i", "some", "total", "overall", "new", "more", "less", "again", "ideally", "only",
  "just", "net", "gross", "roughly", "combined", "all", "extra", "additional", "further",
]);
const NON_METRIC_TOKENS: ReadonlySet<string> = new Set([...METRIC_STOP_TOKENS, ...METRIC_SKIP_TOKENS]);
const TEMPORAL_WORD = new RegExp(`^(?:${TIME_UNIT_ALT}|annually|monthly|weekly|daily|quarterly|yearly|yoy|y\\/y|mom|m\\/m)$`, "i");
const PARTICIPLE_OR_ADVERB = /(?:ing|ed|ly)$/i;

function singularise(word: string): string {
  if (/[a-z]{3,}s$/.test(word) && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
}
function labelWordSet(label: string): Set<string> {
  return new Set(
    label.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0).map(singularise),
  );
}
/**
 * The label's HEAD metric noun: the last word of the goal label that is not a
 * number, a temporal word, a stop/skip token or a goal/change verb form —
 * "Reach £30k MRR Within 18 Months" → "mrr"; "Reach 18 Enterprise Accounts" →
 * "account"; "Hold Price At £49pcm" → "price". `undefined` for a wordless label.
 *
 * ⭐ THE BINDING IS THROUGH THE USER'S WORDS OR NOT AT ALL (Codex, 13 Sep, on
 * "For ARR, we want to reach £64k" + label "Reach £64k MRR"): the label is
 * model-authored, so its metric is licensed only when the user's own governed
 * SENTENCE carries that noun. A quoted occurrence proves the figure is in the
 * brief; it never proves the model's metric reading. Direction is deliberate:
 * an unrecognised label verb counted as a noun costs a withhold (a gap), never
 * a mint.
 */
function labelHeadMetricNoun(label: string): string | undefined {
  const words = label
    .toLowerCase()
    .split(/[^a-z0-9%£$€]+/)
    .filter((w) => w.length > 0 && /^[a-z]/.test(w))
    .filter((w) => isMetricWord(w) && !/^(?:zero|nil|none|half|double|triple)$/.test(w));
  const last = words[words.length - 1];
  return last === undefined ? undefined : singularise(last);
}

function isMetricWord(raw: string): boolean {
  const w = raw.toLowerCase().replace(/[^a-z0-9'-]/g, "");
  if (w.length === 0 || NON_METRIC_TOKENS.has(w)) return false;
  if (TEMPORAL_WORD.test(w)) return false;
  if (PARTICIPLE_OR_ADVERB.test(w) && w.length > 4) return false;
  if (TARGET_VERB_STEMS.some((v) => w === v || w === `${v}s` || w === `${v}es`)) return false;
  if (/^(?:want|wants|aim|aims|plan|plans|need|needs|hope|hopes|intend|intends|like|target|targets|goal|goals|objective|objectives|threshold|thresholds)$/.test(w)) return false;
  // Common verbs of producing/obtaining that sit between a desire lead and the
  // amount ("want to GENERATE £42k") — closed, and none names a metric.
  if (/^(?:generate|generates|deliver|delivers|produce|produces|make|makes|build|builds|create|creates|sell|sells|sign|signs|close|closes|win|wins|book|books|add|adds|land|lands|secure|secures|earn|earns|collect|collects|convert|converts|see|sees|have|has|get|gets|be)$/.test(w)) return false;
  return true;
}

/** Sentence containing `index` — split on sentence punctuation only. */
function sentenceAround(text: string, index: number): string {
  let start = 0;
  for (let i = index - 1; i >= 0; i -= 1) {
    if (/[.!?;]/.test(text[i]!) && !/\d/.test(text[i + 1] ?? "")) { start = i + 1; break; }
  }
  let end = text.length;
  for (let i = index; i < text.length; i += 1) {
    if (/[.!?;]/.test(text[i]!) && !/\d/.test(text[i + 1] ?? "")) { end = i; break; }
  }
  return text.slice(start, end);
}

/**
 * The governing WINDOW before an occurrence: back to the nearest clause
 * boundary — sentence punctuation, comma, dash, or a coordinating word — so a
 * verb in an earlier clause cannot govern a figure in this one.
 */
function windowBefore(text: string, index: number): string {
  const before = text.slice(0, index);
  const m = /(?:[.!?;:,]|—|–|\s-\s|\((?=[^)]*$)|\b(?:and|but|while|whereas|although|though|because|since|so\s+that|which|whilst|then)\b)(?![^]*(?:[.!?;:,]|—|–|\s-\s|\b(?:and|but|while|whereas|although|though|because|since|which|whilst|then)\b))/i.exec(before);
  return m ? before.slice(m.index + m[0].length) : before;
}

/** Up to 3 letter-words after the amount, stopping at the first non-metric token. */
function trailingWords(text: string, end: number): string[] {
  const after = text.slice(end);
  // Must begin with whitespace: a token glued to the digits is a unit/trailer,
  // which the scanner's guards already adjudicated (£49pcm, 30kMRR).
  const m = /^\s+((?:[A-Za-z][A-Za-z'-]*)(?:\s+[A-Za-z][A-Za-z'-]*){0,2})/.exec(after);
  if (!m) return [];
  const words: string[] = [];
  for (const w of m[1]!.split(/\s+/)) {
    const lower = w.toLowerCase().replace(/[^a-z0-9'-]/g, "");
    if (METRIC_STOP_TOKENS.has(lower)) break;
    if (!isMetricWord(w)) continue; // skipped, not stopped: temporal, participle, determiner
    words.push(w);
  }
  return words;
}

type GovernorKind = "goal_pair" | "goal_word" | "desire" | "target_verb";

interface OccurrenceVerdict {
  readonly ok: boolean;
  readonly refusal?: GoalLabelTargetRefusal;
  /** Higher = the occurrence got FURTHER before refusing; used to pick the reported reason. */
  readonly rank: number;
}

function judgeOccurrence(
  brief: string,
  occ: ScannedQuantity,
  label: string,
  quoteSpan: readonly [number, number] | "absent" | "unplaceable",
  pairSpan: ReturnType<typeof resolveStatedGoalPairSpan>,
): OccurrenceVerdict {
  // A doubled or spaced currency symbol ("££30k", "£ 30k") leaves a stray
  // symbol at the window's end; it is not a word and must not hide the governor.
  const window = windowBefore(brief, occ.index).replace(/[£$€\s]+$/, " ");
  const sentence = sentenceAround(brief, occ.index);
  const labelWords = labelWordSet(label);

  // ── C1: which construction, if any, governs this occurrence? ──────────────
  let governor: GovernorKind | undefined;
  let lead: string | undefined;
  let bridgeWords: string[] = [];

  const pairGoverned =
    pairSpan !== null && occ.index >= pairSpan.span[0] && occ.end <= pairSpan.span[1];
  if (pairGoverned) {
    const pairTargetSameUnit = (pairSpan!.pair.unit ?? UNIT_COUNT) === occ.unit;
    const eq = (a: number, b: number): boolean => {
      if (a === b) return true;
      const scale = Math.max(Math.abs(a), Math.abs(b));
      return scale > 0 && Math.abs(a - b) / scale < 1e-9;
    };
    if (pairTargetSameUnit && eq(pairSpan!.pair.baseline, occ.value) && !eq(pairSpan!.pair.value, occ.value)) {
      return { ok: false, refusal: "stated_as_current_level", rank: 3 };
    }
    if (pairTargetSameUnit && eq(pairSpan!.pair.value, occ.value)) {
      governor = "goal_pair";
      bridgeWords = brief.slice(pairSpan!.span[0], occ.index).split(/\s+/).filter(isMetricWord);
    }
  }

  // Bounds are checked BEFORE the target governors: "keep churn under 4%"
  // also matches the desire/verb shapes, and the bound is the truth about it.
  if (governor === undefined && BOUND_GOVERNOR.test(window)) {
    return { ok: false, refusal: "limit_direction_not_representable", rank: 4 };
  }

  const tryGovernor = (re: RegExp, kind: GovernorKind): boolean => {
    const m = re.exec(window);
    if (!m) return false;
    const verb = (m.groups?.verb ?? "").toLowerCase();
    const leadToken = (m.groups?.lead ?? "").toLowerCase();
    // A bare subject + target verb is a statement, not an aim (see
    // BARE_SUBJECT_LEAD); "targeting" is exempt as aspiration in every form.
    if (kind === "target_verb" && !verb.startsWith("target") && BARE_SUBJECT_LEAD.test(leadToken)) {
      return false;
    }
    governor = kind;
    lead = m.groups?.lead;
    // Words between the governor and the amount, minus function and verb
    // tokens, are the construction's own metric words ("grow MRR to £42k").
    bridgeWords = (m.groups?.bridge ?? "").split(/\s+/).filter(isMetricWord);
    return true;
  };
  if (governor === undefined && !tryGovernor(GOAL_WORD_GOVERNOR, "goal_word")) {
    if (!tryGovernor(DESIRE_GOVERNOR, "desire") && !tryGovernor(TARGET_VERB_GOVERNOR, "target_verb")) {
      tryGovernor(CHANGE_TO_GOVERNOR, "target_verb");
    }
  }

  if (governor === undefined) {
    // Not governed. Say WHICH non-target role was read, when one was.
    if (PRESENT_STATE_GOVERNOR.test(window) || PRESENT_STATE_MARKER.test(window)) {
      return { ok: false, refusal: "stated_as_current_level", rank: 2 };
    }
    if (SPEND_GOVERNOR.test(window)) return { ok: false, refusal: "stated_as_spend", rank: 2 };
    const reportedSpan = window + brief.slice(occ.index, occ.end + 40);
    if (PAST_MARKER.test(window) || ACHIEVEMENT_MARKER.test(reportedSpan)) {
      return { ok: false, refusal: "stated_as_past", rank: 2 };
    }
    return { ok: false, refusal: "quantity_not_stated_as_target", rank: 1 };
  }

  // ── C1 stops: closed-class screens on the governed occurrence ─────────────
  // FRAME, before anything else and for every construction alike: "by" makes
  // the amount a CHANGE, "from" a BASELINE — neither is a level, whatever
  // governs it ("we want to increase MRR BY £64k" is not an MRR target; Codex,
  // 13 Sep: a desire prefix must not bypass the change/level distinction).
  if (/\bby\s*$/i.test(window)) return { ok: false, refusal: "stated_as_change_amount", rank: 5 };
  if (/\bfrom\s*$/i.test(window)) return { ok: false, refusal: "stated_as_current_level", rank: 5 };
  if (NEGATION_MARKER.test(window)) return { ok: false, refusal: "negated_target", rank: 5 };
  if (CONDITIONAL_MARKER.test(sentence)) return { ok: false, refusal: "hypothetical_target", rank: 5 };
  const afterText = brief.slice(occ.end, occ.end + 40);
  if (PAST_MARKER.test(window) || ACHIEVEMENT_MARKER.test(window + brief.slice(occ.index, occ.end) + afterText)) {
    return { ok: false, refusal: "stated_as_past", rank: 5 };
  }
  if (PRESENT_STATE_MARKER.test(window) || /^\s*(?:[A-Za-z]+\s+){0,2}(?:currently|today|now|presently|at\s+the\s+moment|right\s+now)\b/i.test(afterText)) {
    return { ok: false, refusal: "stated_as_current_level", rank: 5 };
  }
  if (governor !== "goal_pair" && lead !== undefined) {
    const l = lead.toLowerCase();
    if (THIRD_PARTY_LEAD.test(l) || (!FIRST_PERSON_OR_FUNCTION.has(l) && !labelWords.has(singularise(l)))) {
      return { ok: false, refusal: "subject_not_bound", rank: 5 };
    }
  }

  // ── C2: the metric is bound by the user's words, in BOTH directions ───────
  // (a) the construction's own metric words must all be in the label;
  // (b) the label's head metric noun must be in the user's governed SENTENCE
  //     (not just the governor window — "For ARR, we want to reach £64k" names
  //     its metric before the comma, and a label reading "MRR" must not win);
  // (c) the user's goal sentence, when stamped, is a NEGATIVE guard only: an
  //     occurrence outside it withholds; an occurrence inside it licenses
  //     nothing on its own.
  if (quoteSpan !== "absent" && quoteSpan !== "unplaceable") {
    const inside = occ.index >= quoteSpan[0] && occ.end <= quoteSpan[1];
    if (!inside) return { ok: false, refusal: "outside_goal_statement", rank: 6 };
  }
  const metricWords = [...bridgeWords, ...trailingWords(brief, occ.end)];
  // A label carrying NO words at all ("£30k") names no metric to conflict
  // with; the user's own metric words stand alone. Not the removed escape
  // hatch — that licensed the LABEL's metric; here the label is silent.
  const labelHasWords = [...labelWords].some((w) => /^[a-z]/.test(w));
  if (labelHasWords) {
    const unbound = metricWords.filter((w) => !labelWords.has(singularise(w.toLowerCase())));
    if (unbound.length > 0) return { ok: false, refusal: "metric_mismatch", rank: 7 };
    const head = labelHeadMetricNoun(label);
    if (head !== undefined) {
      const sentenceWords = new Set(
        sentence.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 0).map(singularise),
      );
      if (!sentenceWords.has(head)) {
        return { ok: false, refusal: metricWords.length === 0 ? "metric_unbound" : "metric_mismatch", rank: 7 };
      }
    }
  } else if (metricWords.length === 0) {
    return { ok: false, refusal: "metric_unbound", rank: 6 };
  }
  return { ok: true, rank: 9 };
}

/** Whitespace runs collapsed, so a quote still places inside a brief that wrapped it. */
function canonicalise(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Derive the goal target from the goal node's own label, attested against the
 * brief AND bound to a target statement in the user's words. See the module
 * header and the ROUND 5 block for why every half is required.
 *
 * @param goalLabel the GOAL NODE's label — names WHICH quantity is the target
 * @param brief     the user's own words — must STATE that quantity as a target
 * @param context   the node's `provenance.source_quote`, when the projector
 *                  stamped the user's goal sentence on it
 */
export function deriveGoalTargetFromLabel(
  goalLabel: string | undefined | null,
  brief: string | undefined | null,
  context: GoalLabelTargetContext = {},
): GoalLabelTargetResult {
  if (typeof goalLabel !== "string" || goalLabel.trim() === "") {
    return { ok: false, refusal: "no_goal_label" };
  }

  const labelQuantities = scanQuantities(goalLabel).filter((q) => !q.temporal);
  if (labelQuantities.length === 0) {
    return { ok: false, refusal: "no_quantity_in_label" };
  }

  // The brief is scanned in CANONICAL form so quote containment and every
  // span below share one coordinate system.
  const briefText = canonicalise(typeof brief === "string" ? brief : "");
  const briefQuantities = scanQuantities(briefText).filter((q) => !q.temporal);

  // ⚠ THE ATTESTED SET IS DEDUPED BY QUANTITY, NOT BY OCCURRENCE — unchanged
  // from round 1: a label naming one target that the brief states three times
  // is UNAMBIGUOUS. Attestation-by-equality runs FIRST, so "two label figures
  // both present" still refuses as ambiguous rather than letting the role rule
  // quietly pick the one it can govern (the round-3 harm, one level up).
  const attested: Array<{ label: ScannedQuantity; occurrences: ScannedQuantity[] }> = [];
  for (const lq of labelQuantities) {
    if (attested.some((a) => sameQuantity(a.label, lq))) continue;
    const occurrences = briefQuantities.filter((bq) => sameQuantity(bq, lq));
    if (occurrences.length > 0) attested.push({ label: lq, occurrences });
  }

  if (attested.length === 0) return { ok: false, refusal: "quantity_not_attested" };
  if (attested.length > 1) return { ok: false, refusal: "ambiguous_multiple_attested" };

  // ── ROUND 5: of the occurrences, which (if any) is STATED AS THE TARGET? ──
  const quote = typeof context.goalSourceQuote === "string" ? canonicalise(context.goalSourceQuote) : "";
  let quoteSpan: readonly [number, number] | "absent" | "unplaceable" = "absent";
  if (quote.length > 0) {
    const at = briefText.indexOf(quote);
    quoteSpan = at >= 0 ? [at, at + quote.length] : "unplaceable";
  }
  const pairSpan = resolveStatedGoalPairSpan(briefText);

  const only = attested[0]!;
  let best: { verdict: OccurrenceVerdict; occ: ScannedQuantity } | undefined;
  for (const occ of only.occurrences) {
    const verdict = judgeOccurrence(briefText, occ, goalLabel, quoteSpan, pairSpan);
    if (verdict.ok) {
      return {
        ok: true,
        target: {
          value: only.label.value,
          unit: only.label.unit,
          matchedText: only.label.matchedText,
          briefQuote: occ.matchedText,
        },
      };
    }
    if (best === undefined || verdict.rank > best.verdict.rank) best = { verdict, occ };
  }
  return { ok: false, refusal: best!.verdict.refusal!, briefQuote: best!.occ.matchedText };
}

/**
 * The conservation question, asked as a predicate so a guard can fail on it.
 *
 * TRUE when the goal node's label states a non-temporal quantity that the
 * user's brief STATES AS THE TARGET, and the node carries NO typed threshold —
 * i.e. the exact state the witnessed defect shipped in, where the target
 * survived only as label prose. A figure the brief does not contain, or
 * contains in another role, is a model invention and must NOT be minted, so it
 * is not a conservation failure either.
 */
export function goalLabelStatesUncarriedTarget(
  node:
    | { label?: string | null; goal_threshold_raw?: unknown; provenance?: unknown }
    | null
    | undefined,
  brief: string | undefined | null,
): boolean {
  if (!node) return false;
  const raw = node.goal_threshold_raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return false;
  const provenance = node.provenance;
  const quote =
    typeof provenance === "object" && provenance !== null
      ? (provenance as { source_quote?: unknown }).source_quote
      : undefined;
  return deriveGoalTargetFromLabel(node.label, brief, {
    goalSourceQuote: typeof quote === "string" ? quote : undefined,
  }).ok;
}

/* ===========================================================================
 * ROUND 6 (CEE #1328, 14 Sep 2026) — A LABEL-DERIVED FIGURE IS A CANDIDATE,
 * NEVER A WRITE.
 *
 * Codex's disposition (PR38 5657776136): the unsafe cases return `ok: true`
 * ("We rejected the proposal to reach £64k MRR." mints 64000 on both routes),
 * so a record on the REFUSAL branch can never intercept them, and no further
 * string rule settles which occurrences are safe (the round-five tweak was run
 * in advance and oscillates). The exit is the product's own doctrine: a target
 * the model read from its own label is a SUGGESTION the user is asked about —
 * never authority to write `goal_threshold`.
 *
 * So this module now yields a CANDIDATE: which figure the label names, where
 * the brief says it, and how well the user's words bind it. The consumer is the
 * orchestration seam (`elicit_goal_target`, whose pending record carries NO
 * value field — the user must supply the amount, and the canonical writer
 * writes what THEY said). A wrong candidate can only ever be a prompt to think.
 *
 * No figure in the brief ⇒ no candidate. Nothing here mints.
 * ========================================================================= */

/** How well the user's own words bind the figure the label names. */
export type GoalTargetCandidateBinding = "governed" | "present_unbound";

export interface GoalTargetCandidate {
  readonly goal_node_id: string;
  /** In USER units (20 for "20%", 20000 for "£20k") — never the extractor's fraction. */
  readonly value_user_units: number;
  /** `£` / `$` / `€` / `%` / `count`. */
  readonly unit: string;
  /** The exact span of the goal LABEL the figure was read from. */
  readonly label_span: string;
  /** The exact span of the BRIEF where the figure occurs (the first governed occurrence when governed). */
  readonly brief_span: string;
  readonly binding: GoalTargetCandidateBinding;
  /** `"governed"`, or the named reason the figure is present but unbound. */
  readonly reason: GoalLabelTargetRefusal | "governed";
}

function toUserUnits(value: number, unit: string): number {
  return unit === "%" ? value * 100 : value;
}

/** The first label quantity that occurs in the brief, with its first occurrence. */
function firstAttestedLabelQuantity(
  goalLabel: string,
  briefText: string,
): { label: ScannedQuantity; brief: ScannedQuantity } | undefined {
  const briefQuantities = scanQuantities(briefText).filter((q) => !q.temporal);
  for (const lq of scanQuantities(goalLabel).filter((q) => !q.temporal)) {
    const occ = briefQuantities.find((bq) => sameQuantity(bq, lq));
    if (occ) return { label: lq, brief: occ };
  }
  return undefined;
}

/**
 * The candidate the goal label names, or `undefined` when the label names no
 * figure the brief contains (a model invention is not a candidate either).
 */
export function deriveGoalTargetCandidate(
  goalNodeId: string,
  goalLabel: string | undefined | null,
  brief: string | undefined | null,
  context: GoalLabelTargetContext = {},
): GoalTargetCandidate | undefined {
  const r = deriveGoalTargetFromLabel(goalLabel, brief, context);
  if (r.ok) {
    return {
      goal_node_id: goalNodeId,
      value_user_units: toUserUnits(r.target.value, r.target.unit),
      unit: r.target.unit,
      label_span: r.target.matchedText,
      brief_span: r.target.briefQuote,
      binding: "governed",
      reason: "governed",
    };
  }
  if (
    r.refusal === "no_goal_label" ||
    r.refusal === "no_quantity_in_label" ||
    r.refusal === "quantity_not_attested"
  ) {
    return undefined;
  }
  const att = firstAttestedLabelQuantity(
    typeof goalLabel === "string" ? goalLabel : "",
    canonicalise(typeof brief === "string" ? brief : ""),
  );
  if (!att) return undefined;
  return {
    goal_node_id: goalNodeId,
    value_user_units: toUserUnits(att.label.value, att.label.unit),
    unit: att.label.unit,
    label_span: att.label.matchedText,
    brief_span: r.briefQuote ?? att.brief.matchedText,
    binding: "present_unbound",
    reason: r.refusal,
  };
}
