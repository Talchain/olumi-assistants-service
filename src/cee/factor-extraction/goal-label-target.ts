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
 * ONE quantity grammar, used for the label scan AND the brief scan, so a number
 * cannot be readable in one and invisible in the other.
 *
 * Order of the trailing groups is load-bearing: `%` binds tighter than a word
 * unit ("30% months" is not a thing), and the temporal tail is captured rather
 * than excluded by lookahead so the caller can report WHY a quantity was
 * skipped instead of it vanishing.
 */
function quantityScanner(): RegExp {
  return new RegExp(
    `(?<currency>${CURRENCY_CLASS})?` +
      `(?<amount>${AMOUNT_DIGITS})` +
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
    const isTemporal = m.groups?.time !== undefined;

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
      unit = "count";
      value = digits * magnitude;
    }

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
  const briefQuantities = scanQuantities(briefText);

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
