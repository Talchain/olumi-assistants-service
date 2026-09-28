/**
 * Agent lane — constraint admission.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ THE CANONICAL VOCABULARY CANNOT SAY "UNDER".
 *
 * `GoalConstraintSchema` (`src/schemas/assist.ts:401-407`) declares
 * `operator: z.enum([">=", "<="])` — ASCII, non-strict, and that is the whole
 * vocabulary. The pricing brief says "keeping monthly churn **under** 4%", and
 * the faithful builder captured that correctly as `operator: "<", value: 4`.
 *
 * There is no `<`. So admitting this user-stated constraint changes its meaning:
 * `<= 4` **admits exactly 4.0**, which the user excluded.
 *
 * ⚠ THIS IS NOT COSMETIC, AND IT IS NOT A MACHINE'S NUMBER — it is the user's
 * own constraint being widened at its boundary. The banked Terra transcript
 * reasons at exactly that point: *"If normal churn is exactly 2%, the shock
 * reaches 4%, which does not satisfy 'under 4%'."* A model that admits 4.0
 * would call that scenario feasible; the user would not.
 *
 * ⛔ THE FORBIDDEN "FIX" is an epsilon — mapping `< 4` to `<= 3.999`. That
 * invents a threshold the user never stated and writes a fabricated figure into
 * a field the contract says holds the user's units. The value is preserved
 * verbatim; it is the OPERATOR that the engine's vocabulary cannot express.
 *
 * ⭐ A2 (DL #72 5861407189): PRESERVE THE NUMBER, HOLD THE ENGINE'S OPERATOR, AND KEEP THE STATED ONE BESIDE IT. The
 * drafter emits the TYPED operator (`buildCandidateSchema`: `>= <= > <`, no word is read), and admission keeps it as
 * `operator` whenever the canonical store can hold it: {@link CANONICAL_CONSTRAINT_OPERATORS} is
 * `GoalConstraintSchema`'s own list, never a second one. Today that list is `>= <=`, so "under 4%" is held as
 * `operator: "<="` WITH `operator_as_stated: "<"`: every surface that states the limit says "less than 4%"
 * (`statedOperatorOf`, `LIMIT_OPERATOR_WORDS`), and the strictness is no longer recorded as a loss.
 *
 * ⚠ WHAT IS WITHHELD, NOT MODELLED. PLoT and ISL still receive `<=` (the run wire withholds `operator_as_stated`).
 * Over continuous draws P(X < 4) = P(X <= 4), so that is the same limit. The ONE case where they differ is a level
 * PINNED exactly at the threshold (an option that sets churn to exactly 4%, or a deterministic path that resolves to
 * it — `context/cqe/__tests__/strictness-is-destroyed-at-extraction.test.ts`): the engine counts it as meeting the
 * limit. The wire is unchanged for it (`limit-operator-as-stated.test.ts` R4); an OPTION that sets the level at the
 * threshold has its result for that limit withheld by the verdict (`strictLimitsPinnedAtThreshold` →
 * `deriveConstraintVerdict`), never said as met. A deterministic path that resolves to the threshold is not detected.
 *
 * ⚠ WIDENING THE SCHEMA'S `operator` ENUM IS NOT THE FIX: `GraphV3.safeParse` fails the whole graph on an unknown
 * operator (Canonical 5860723311), and PLoT's preflight refuses
 * any other operator (`CONSTRAINT_INVALID_OPERATOR`, plot-lite-service `src/validation/preflight-v2.ts`
 * `VALID_OPERATORS`), so the store and PLoT move together, and `admit-constraint-typed-operator.test.ts` pins today's
 * list so that move cannot happen unseen.
 */

import { REPAIR_CODES, type RepairEntry } from '@talchain/schemas';
import { GoalConstraintSchema, type GoalConstraintT } from '../../schemas/assist.js';
import { classifyUnitScaleClass, UNIT_SCALE_CLASS_TOKENS, unitPinnedScaleFrame } from '../../cee/draft/records/unit-scale-class.js';
import { isCurrencyUnit, sameUnit } from '../../utils/currency-alphabet.js';

import type { CandidateOperator } from './limit-operator-words.js';
export { type CandidateOperator, LIMIT_OPERATOR_WORDS, statedOperatorOf } from './limit-operator-words.js';
/** The comparators the canonical store holds: `GoalConstraintSchema.operator`, derived, never restated. */
export type CanonicalOperator = GoalConstraintT['operator'];
export const CANONICAL_CONSTRAINT_OPERATORS: readonly CanonicalOperator[] = GoalConstraintSchema.shape.operator.options;
/** `GoalConstraintSchema.operator_as_stated`: a strict comparator as the user stated it, held beside `operator`. */
export type StatedOperator = NonNullable<GoalConstraintT['operator_as_stated']>;

// `LIMIT_OPERATOR_WORDS` and `statedOperatorOf` live in the import-free leaf `limit-operator-words.ts`; re-exported above.

export interface CandidateConstraint {
  readonly metric: string;
  readonly operator: CandidateOperator;
  readonly value: number;
  readonly unit?: string;
  readonly provenance: string;
  /** The drafter's reading of the user's words: the limit is on the value itself, or on a change from today. */
  readonly frame?: 'level' | 'delta';
}

export interface AdmittedConstraint {
  constraint_id: string;
  node_id: string;
  operator: CanonicalOperator;
  /** `GoalConstraintSchema.operator_as_stated`: the TYPED strict operator the store cannot hold as `operator`. */
  operator_as_stated?: StatedOperator;
  value: number;
  label?: string;
  unit?: string;
  /** `GoalConstraintSchema.value_frame`. ISL refuses a limit without it (`frame_not_stamped`); never guessed here. */
  value_frame?: 'level' | 'delta';
  /**
   * Canonical authorship marker — `GoalConstraintSchema.provenance`
   * (`src/schemas/assist.ts:418`), values `explicit | inferred | proxy`.
   *
   * ⛔ THIS WAS MISSING, AND THE OMISSION HAD TEETH. `CandidateConstraint`
   * declared `provenance` and this module never read it, so the widening receipt
   * asserted "the user stated a STRICT bound" for a constraint the MODEL
   * invented, and the analysis policy then told the user "a limit you set could
   * not be attached". A model could manufacture a limit, have Olumi certify it
   * as the user's, and have Olumi restrict the user's own analysis on it.
   */
  provenance?: 'explicit' | 'inferred' | 'proxy';
  /** `GoalConstraintSchema.provenance_unit_relabelled`: the unit LABEL was rewritten, the value was not. By presence. */
  provenance_unit_relabelled?: { rule: string; pre_normalisation_value: number; pre_normalisation_unit: string };
  /** `GoalConstraintSchema.provenance_unit_normalised`: the VALUE was rescaled; `original_*` is the figure as stated. */
  provenance_unit_normalised?: { rule: string; original_value: number; original_unit: string };
}

/**
 * ⭐⭐ A LIMIT MUST REACH PLoT IN A UNIT PLoT CAN READ — or it is scored against the wrong number.
 *
 * WIRE (#69 5840961137, PLoT b09c0f2 / ISL 3c4ab84d): the drafter wrote a churn limit as `10 "percent per month"`.
 * PLoT's percent check is an EXACT token match (`isPercentUnit`: `% percent pct percentage`), so the threshold fell
 * through to the node's inferred range and was CLAMPED to 1.0 — and on a level-framed root target the engine
 * DELIVERED P=1 for every option ("churn ≤ 100%"). The same limit as `10 "%"` normalised to 0.10.
 *
 * The classifier that reads "percent per month" as a percent ALREADY EXISTS (`classifyUnitScaleClass`); admission
 * copied the unit verbatim and never asked it. Two rungs, each onto vocabulary PLoT ALREADY handles, and nothing else:
 *
 *   P · a percent HEAD (the classifier's own percent row) + an optional PERIOD tail ("per month", "p.a.") with
 *       1 ≤ |value| ≤ 100 → `"%"`, value UNCHANGED, but ONLY where the target node's level is the percentage ÷ 100
 *       (`levelIsPercentOver100`). On a node capped elsewhere it takes the node's own non-`"%"` spelling, or stays
 *       verbatim. PLoT reads `"%"` with |v| ≥ 1 as percentage points ([0,100]). The period stays in the limit's
 *       meaning ("Monthly churn"); it is not a scale.
 *   M · a currency head + `k`/`m`, onto a node in the BARE currency of the same family → the node's spelling, value
 *       × 10³ / 10⁶ by EXPONENT PARSING (`4.1 * 1e6` is 4099999.999…). Any other node: verbatim.
 *
 * ⛔ WHAT THIS MUST NOT DO, each pinned by a control row in `admit-constraint-unit-canonical.test.ts`:
 *   · "% change vs this year's costs" is a percent OF SOMETHING ELSE. As `"%"` PLoT's unit_percent rung would scale it
 *     with no unit check — a SILENT wrong threshold. Its tail is not a period, so it stays verbatim and PLoT refuses it.
 *   · |value| < 1: PLoT reads `"%"` below 1 as a FRACTION, so "0.5 percent per month" would become 50%. Abstain.
 *   · "percentage points" / "pp" on a DELTA (or unframed) limit: a change, not a level. Verbatim. On a LEVEL limit it is
 *     the P rung below ("PP"), because a level stated in percentage points is the same number as a percent.
 *   · Anything unrecognised stays VERBATIM: PLoT then fails closed on it. CEE never guesses a scale.
 */
const PERCENT_HEADS: readonly string[] = [...(UNIT_SCALE_CLASS_TOKENS.find(([cls]) => cls === 'percent')?.[1] ?? [])]
  .sort((a, b) => b.length - a.length);
// The groups name the period a match states (`periodOf`); they do not change what the grammar accepts.
const PERIOD_TAIL = /^(?:(?:per|a|an|each|\/)\s*(month|year|annum|quarter|week|day)|(monthly|annually|annual|yearly|quarterly|weekly|daily)|(p\.?a\.?))?$/;
/** The one period each word PERIOD_TAIL accepts names ("p.a." is a year): the grammar's own words, never a wider list. */
const PERIOD_NAME: Readonly<Record<string, string>> = {
  month: 'month', monthly: 'month',
  year: 'year', annum: 'year', annual: 'year', annually: 'year', yearly: 'year',
  quarter: 'quarter', quarterly: 'quarter',
  week: 'week', weekly: 'week',
  day: 'day', daily: 'day',
};
/** The classifier's own `percentage_points` row ("pp", "ppt", "pps"), longest first: never a private copy. */
const POINTS_HEADS: readonly string[] = [...(UNIT_SCALE_CLASS_TOKENS.find(([cls]) => cls === 'percentage_points')?.[1] ?? [])]
  .sort((a, b) => b.length - a.length);
/** "point" / "points" after a percent head ("percentage points", "% points"), then only an optional period. */
const POINTS_TAIL = /^points?(?:\s+(.*))?$/;
/** "of <population>" after a percent head: "% of Pro subscribers per month", "percent of customers". */
const OF_TAIL = /^of\s+\S/;
/** A unit that ends in a magnitude suffix; whether its head is a currency is asked of the ONE vocabulary below. */
const MAGNITUDE_SUFFIX = /^(.*?)\s*([km])$/i;

/**
 * ⛔⛔ THE TARGET NODE DECIDES, NOT THE LIMIT'S UNIT ALONE (#1934 review 5841434798).
 *
 * PLoT normalises a limit against its node (`intervention-normaliser.ts` at b09c0f2, :1564-1580): `"%"` takes the
 * unit_percent rung `[0,100]` and IGNORES `observed_state.cap`; any other unit reaches `deriveRange` →
 * `explicit_cap [0,cap]`, and two different non-token spellings are then `mismatched`
 * (`classifyUnitCompatibility`). A unit-only rewrite turned `10 "percent per month"` on a `cap 20` node from 0.5
 * (right) into 0.1, and `250 "£k"` on a `£k` node from 0.25 into a unit mismatch. So a rewrite happens only where
 * the node's own scale proves the result: this is the node's `observed_state` as admission wrote it
 * (`framedObservedState` / `estimatedObservedState`, `admit-model.ts`) plus its `scale_frame`.
 */
export interface LimitTargetScale {
  readonly unit?: string;
  readonly cap?: number;
  readonly value?: number;
  readonly raw_value?: number;
  readonly scale_frame?: number;
}

type UnitCanonical = Pick<AdmittedConstraint, 'value' | 'unit' | 'provenance_unit_relabelled' | 'provenance_unit_normalised'>;

function norm(unit: string): string {
  return unit.trim().toLowerCase();
}

/**
 * A percent head (the classifier's own row) and nothing after it but an optional period ("per month", "p.a.").
 * Exported as the one "is this a percentage LEVEL?" test: the magnitude contract reads a target's domain with it
 * (`cee/magnitude/link-effect.ts`), so a "% change" is never read as a level bounded by 0 and 100.
 */
export function isPercentWithPeriod(unit: string): boolean {
  if (classifyUnitScaleClass(unit) !== 'percent') return false;
  const t = norm(unit);
  const head = PERCENT_HEADS.find((h) => t.startsWith(h));
  return head !== undefined && PERIOD_TAIL.test(t.slice(head.length).trim());
}

/**
 * ⭐ A percentage-POINTS spelling and nothing after it but an optional period: "percentage points", "% points",
 * "pp", "ppt per month". Read as a LEVEL only where the limit's own frame says `level` (`canonicaliseLimitUnit`): a level
 * stated in percentage points is the same number as that percent. On a delta it is a change and stays verbatim.
 *
 * ⚠ SERVED (joined run 2 `f-20260926T225444Z/01-F1-brief`, CEE f4596ca, DL #70 5850702248): the drafter wrote churn in
 * "percentage points" on both the level limit (10) and the node (raw 7, `scale_frame` 100). The limit stayed verbatim, so
 * the baseline carry (`levelLimitReadsOnNodeLevel`, which needs `"%"`) sent nothing, and PLoT refused the level frame
 * (`CONSTRAINT_NOT_CONVERTIBLE`, no `observed_state.baseline`): 0/3 options decision-grade. Run 1, same brief, drafted
 * "percent per month", was relabelled to `"%"` and scored 4/4.
 */
/**
 * ⭐ A percent head qualified by its population ("% of Pro subscribers per month"). On a LEVEL limit it is that percent,
 * like percentage points (DL #70 5851043488, the unit-spelling CLASS): served `f-20260926T174453Z/01` spelled churn so on
 * both the limit (10) and the node (raw 6, `scale_frame` 100), and the limit was never scored. "% change vs …" and
 * "percentage points of …" are not this shape and stay verbatim.
 */
export function isPercentOfPopulation(unit: string): boolean {
  if (classifyUnitScaleClass(unit) !== 'percent') return false;
  const t = norm(unit);
  const head = PERCENT_HEADS.find((h) => t.startsWith(h));
  return head !== undefined && OF_TAIL.test(t.slice(head.length).trim());
}

export function isPercentagePointsWithPeriod(unit: string): boolean {
  const t = norm(unit);
  const cls = classifyUnitScaleClass(unit);
  if (cls === 'percentage_points') {
    const head = POINTS_HEADS.find((h) => t.startsWith(h));
    return head !== undefined && PERIOD_TAIL.test(t.slice(head.length).trim());
  }
  if (cls !== 'percent') return false;
  const head = PERCENT_HEADS.find((h) => t.startsWith(h));
  if (head === undefined) return false;
  const points = POINTS_TAIL.exec(t.slice(head.length).trim());
  return points !== null && PERIOD_TAIL.test((points[1] ?? '').trim());
}

/** The period a PERIOD_TAIL match states, or `null` for the empty tail (no period). */
function periodOf(m: RegExpExecArray): string | null {
  if (m[3] !== undefined) return 'year';
  const word = m[1] ?? m[2];
  return word === undefined ? null : (PERIOD_NAME[word] ?? null);
}

/**
 * The period a percent-LEVEL spelling states, read by the grammar that admits it: "% per month" / "%/month" / "percent
 * monthly" → `month`; "% p.a." / "percent per annum" / "pp per year" → `year`. `null` when it states none ("%",
 * "percent", "% of Pro subscribers"), or it is not one of these spellings. A "% of <population>" spelling states one only
 * as its last word or two ("% of Pro subscribers per month").
 */
function percentLevelPeriod(unit: string): string | null {
  const t = norm(unit);
  const cls = classifyUnitScaleClass(unit);
  const tailPeriod = (tail: string): string | null => {
    const m = PERIOD_TAIL.exec(tail.trim());
    return m === null ? null : periodOf(m);
  };
  if (cls === 'percentage_points') {
    const head = POINTS_HEADS.find((h) => t.startsWith(h));
    return head === undefined ? null : tailPeriod(t.slice(head.length));
  }
  if (cls !== 'percent') return null;
  const head = PERCENT_HEADS.find((h) => t.startsWith(h));
  if (head === undefined) return null;
  const rest = t.slice(head.length).trim();
  if (PERIOD_TAIL.test(rest)) return tailPeriod(rest);
  const points = POINTS_TAIL.exec(rest);
  if (points !== null) return tailPeriod(points[1] ?? '');
  if (!OF_TAIL.test(rest)) return null;
  const words = rest.split(/\s+/);
  // "of", at least one population word, then the period: never the population word itself.
  for (const n of [2, 1]) {
    if (words.length < n + 2) continue;
    const period = tailPeriod(words.slice(-n).join(' '));
    if (period !== null) return period;
  }
  return null;
}

/**
 * ⛔⛔ A PERIOD IS PART OF A PERCENT LIMIT'S MEANING (rule1-limit-period, engine-direct on PLoT 22f3d94).
 *
 * `"%"` is read on the NODE's period: PLoT never reads the relabel stamp. So "annual churn under 10 %" relabelled onto
 * a `% per month` node (level 3 %/month, roughly 31 %/year) was scored as "monthly churn ≤ 10 %": P = 1 on every option,
 * decision-grade — a wrong pass. In its own unit PLoT refuses it and names the unit: the honest outcome.
 *
 * True only when BOTH spellings state a period and they differ. A spelling that states none ("%", "percent") is not
 * "different", so a bare `"%"` keeps today's reading on any node. Bound to the two units — the limit's own and the
 * unit of the node its `node_id` names — never to the metric's words.
 */
export function percentPeriodsDiffer(limitUnit: string, nodeUnit: string | undefined): boolean {
  if (nodeUnit === undefined) return false;
  const limitPeriod = percentLevelPeriod(limitUnit);
  const nodePeriod = percentLevelPeriod(nodeUnit);
  return limitPeriod !== null && nodePeriod !== null && limitPeriod !== nodePeriod;
}

/**
 * True only when the node's level IS the percentage ÷ 100 — the one scale PLoT's `"%"` rung lands on. A frame of
 * exactly 100 (`cap`, else the estimate's `scale_frame` — the served agent-lane churn estimate, `{value 0.07,
 * raw_value 7}` + `scale_frame 100`), or an unframed, UNITLESS level already in [0, 1).
 *
 * ⛔ An unframed level in a PERCENT spelling is not provably a proportion (review 5841746528): `0.8 "percent per
 * month"` may be 0.8% or 80%. Read as a proportion it would turn PLoT's fail-closed `inferred_value` into a
 * decision-grade `unit_percent` threshold on a node at 0.8. It stays verbatim, so PLoT flags it.
 */
function levelIsPercentOver100(target: LimitTargetScale): boolean {
  if (target.cap !== undefined) return target.cap === 100;
  if (target.scale_frame !== undefined) return target.scale_frame === 100;
  return (
    target.unit === undefined &&
    target.raw_value === undefined &&
    typeof target.value === 'number' &&
    target.value >= 0 &&
    target.value < 1
  );
}

/**
 * ⛔⛔ CAN PLoT READ A FRAMED LIMIT IN THIS UNIT ON THIS LEVEL'S OWN SCALE? (#70 5843365832)
 *
 * PLoT's percent rung is `[0,100]` whatever the target's own frame (`intervention-normaliser.ts` at b09c0f2: :1493
 * reads only a goal's `goal_threshold_cap`; :1564-1567). WIRE, engine-direct: the same 4% root level scored P(meet ≤
 * 10%) 1 on a frame of 100 and 0.017 on 20; the same 12% level 0.017 on 100 and 1 on 200 — all `decision_grade: true`.
 * So a percent-ROW unit is provable only on a level that IS the percentage ÷ 100 (`levelIsPercentOver100`, the
 * canonicaliser's own test). Every other unit is `true` here: a spelling outside the row ("% per month") reaches
 * `deriveRange`, which reads the node's cap.
 */
export function percentLimitFrameProvable(unit: string | undefined, target: LimitTargetScale | undefined): boolean {
  if (unit === undefined || !PERCENT_HEADS.includes(norm(unit))) return true;
  return target !== undefined && levelIsPercentOver100(target);
}

export function canonicaliseLimitUnit(
  value: number,
  unit: string | undefined,
  target?: LimitTargetScale,
  frame?: string,
): UnitCanonical {
  if (unit === undefined) return { value };
  const verbatim: UnitCanonical = { value, unit };
  // PP: a LEVEL limit in percentage points is that percent (`isPercentagePointsWithPeriod`); the same gates as P follow.
  const pointsLevel = frame === 'level' && isPercentagePointsWithPeriod(unit);
  const ofLevel = frame === 'level' && isPercentOfPopulation(unit);
  /**
   * ⭐ THE NODE'S OWN PERCENT SPELLING (DL #72 5868320182, AIQ ACK 5868356303; served journey A run 2 A14): the drafter wrote
   * churn "% monthly churn" on BOTH the node and its ≤ 4 level limit — a percent head, a period, the node's name. Neither
   * rule above reads that tail, so the limit reached PLoT verbatim, missed its exact-token '%' rung, and 4 was clamped on
   * [0,1] and refused (`CONSTRAINT_REFUSED_FRAME_FIDELITY`). A LEVEL limit spelled EXACTLY as its node's own percent unit
   * is on that node's scale by construction — the "of" rule's own guard — so it is that percent, under the same gates.
   */
  const ownSpellingLevel = frame === 'level' && !pointsLevel && !ofLevel && !isPercentWithPeriod(unit)
    && target?.unit !== undefined && norm(target.unit) === norm(unit) && classifyUnitScaleClass(unit) === 'percent';

  if ((isPercentWithPeriod(unit) || pointsLevel || ofLevel || ownSpellingLevel) && Math.abs(value) >= 1 && Math.abs(value) <= 100) {
    // A rewrite onto the spelling the limit already has is no rewrite: nothing to stamp.
    const relabel = (to: string): UnitCanonical =>
      to === unit
        ? verbatim
        : {
            value,
            unit: to,
            provenance_unit_relabelled: {
              rule: pointsLevel ? 'agent_lane_limit_pp_level_v1' : ofLevel ? 'agent_lane_limit_pct_of_level_v1'
                : ownSpellingLevel ? 'agent_lane_limit_pct_own_spelling_level_v1' : 'agent_lane_limit_unit_v1',
              pre_normalisation_value: value,
              pre_normalisation_unit: unit,
            },
          };
    if (target === undefined) return verbatim;
    const nodeUnit = target.unit;
    // A node that is not a plain percent (a count, a "% change") is not the limit's scale: PLoT refuses it. A node's
    // observed state is its LEVEL, so a node spelled in percentage points is a percent level (served run 2's churn).
    // A node "% of <population>" is a percent level too. An "of" LIMIT reads only a node in its own spelling: "% of X" can
    // name a reference ("90% of last year's churn"), not a population, and only the node's own unit tells them apart
    // (MG #2061 B1: on a plain-percent node that limit became "churn ≤ 90%", trivially met).
    const nodeIsPercentLevel = ofLevel || ownSpellingLevel
      ? nodeUnit !== undefined && norm(nodeUnit) === norm(unit)
      : nodeUnit === undefined || isPercentWithPeriod(nodeUnit) || isPercentagePointsWithPeriod(nodeUnit) || isPercentOfPopulation(nodeUnit);
    if (!nodeIsPercentLevel) return verbatim;
    // ⛔ Another period is another quantity ("10 % per year" is not "≤ 10 %" of a monthly level): verbatim, before
    // either relabel below (`"%"`, or the capped node's own spelling), so PLoT refuses it rather than scoring it.
    if (percentPeriodsDiffer(unit, nodeUnit)) return verbatim;
    // The same spelling on a capped node: PLoT already reconciles it against the cap.
    if (target.cap !== undefined && nodeUnit !== undefined && norm(nodeUnit) === norm(unit)) return verbatim;
    if (levelIsPercentOver100(target)) return relabel('%');
    // A capped node in a spelling PLoT does NOT read as `"%"`: adopt that spelling, so the limit reaches
    // `explicit_cap [0,cap]` and reconciles. A `"%"`-token node has no such spelling — PLoT ignores its cap.
    if (target.cap !== undefined && nodeUnit !== undefined && !PERCENT_HEADS.includes(norm(nodeUnit))) return relabel(nodeUnit);
    return verbatim;
  }

  // The currency vocabulary is the estate's one list (`utils/currency-alphabet.ts`), never a private copy: the head must
  // be a recognised currency, and the node must be in the BARE currency of the SAME one (`sameUnit`: £ ≡ GBP). The
  // node's own spelling is emitted, so PLoT reads a single unit.
  const m = MAGNITUDE_SUFFIX.exec(unit.trim());
  const currencyNode = target?.unit;
  if (m !== null && currencyNode !== undefined && isCurrencyUnit(currencyNode) && sameUnit(currencyNode, m[1])) {
    const scaled = Number(`${value}e${m[2].toLowerCase() === 'k' ? 3 : 6}`);
    if (Number.isFinite(scaled)) {
      return {
        value: scaled,
        unit: currencyNode,
        provenance_unit_normalised: { rule: 'agent_lane_limit_magnitude_v1', original_value: value, original_unit: unit },
      };
    }
  }

  return verbatim;
}

/**
 * ⭐ THE ONE "IS THIS LIMIT A PERCENTAGE LEVEL?" RULE (R&C #2034 B1). A limit is one when its unit pins a frame on its own
 * (`unitPinnedScaleFrame`) AND the canonicaliser carries it as a plain `"%"` on that frame: a percent head with at most a
 * period, above 1 and up to 100. Returns that frame, else `undefined`. Admission (both of `admit-model`'s blocks) and a
 * later value edit (`frame-defaulted-links`) all ask THIS, so a limit is never a level on one path and not on another
 * ("0.5 % per month" is admitted verbatim and is NOT one: the percent arm needs |v| ≥ 1).
 */
export function percentLevelFrame(value: number, unit: string | undefined, valueFrame?: string): number | undefined {
  // "pp" pins no frame of its own (the classifier's rowed door); a LEVEL in it is a percent, so it takes the percent pin.
  const pointsLevel = valueFrame === 'level' && unit !== undefined && isPercentagePointsWithPeriod(unit);
  const frame = unitPinnedScaleFrame(unit, value) ?? (pointsLevel ? unitPinnedScaleFrame('%', value) : undefined);
  if (frame === undefined) return undefined;
  return canonicaliseLimitUnit(value, unit, { scale_frame: frame, unit }, valueFrame).unit === '%' ? frame : undefined;
}

export interface ConstraintAdmissionResult {
  readonly constraints: readonly AdmittedConstraint[];
  readonly loss: readonly RepairEntry[];
}

const RELAXES_TO: Record<CandidateOperator, CanonicalOperator> = {
  '>=': '>=',
  '<=': '<=',
  '>': '>=',
  '<': '<=',
};

/** True when the candidate operator is strict and the canonical one is not. */
export function isStrictnessLost(op: CandidateOperator): boolean {
  return op === '<' || op === '>';
}

/** The typed operator as stated when the store can hold it; otherwise its non-strict widening (`RELAXES_TO`). */
export function admittedOperator(
  op: CandidateOperator,
  operators: readonly string[] = CANONICAL_CONSTRAINT_OPERATORS,
): CanonicalOperator {
  return operators.includes(op) ? (op as CanonicalOperator) : RELAXES_TO[op];
}

/** A lower bound (`>=`, `>`) as opposed to an upper one; strict or not, it is the same side. */
const isLowerBound = (op: string): boolean => op.startsWith('>');

/** Only a bound the user actually stated may be reported as theirs. */
function isUserAuthored(candidateProvenance: string): boolean {
  return candidateProvenance === 'explicit';
}

function canonicalProvenance(candidateProvenance: string): 'explicit' | 'inferred' {
  return isUserAuthored(candidateProvenance) ? 'explicit' : 'inferred';
}

export function admitCandidateConstraints(
  candidates: readonly CandidateConstraint[],
  nodeIdFor: (metric: string) => string | undefined,
  targetScaleFor: (nodeId: string) => LimitTargetScale | undefined = () => undefined,
  /** The store's comparators (`GoalConstraintSchema`'s own list); a parameter only so a test can hold a wider store. */
  operators: readonly string[] = CANONICAL_CONSTRAINT_OPERATORS,
): ConstraintAdmissionResult {
  const constraints: AdmittedConstraint[] = [];
  const loss: RepairEntry[] = [];

  for (const c of candidates) {
    const nodeId = nodeIdFor(c.metric);
    if (nodeId === undefined) {
      loss.push({
        code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
        layer: 'cee',
        field_path: `goal_constraints[${c.metric}].node_id`,
        before: c.metric,
        after: null,
        reason:
          `${isUserAuthored(c.provenance) ? 'A limit you stated' : 'A limit this system proposed'} ` +
          'names a metric with no node in the admitted model, so it cannot be attached. Withheld ' +
          'rather than attached to a guessed target.',
        severity: 'warn',
      });
      continue;
    }

    const operator = admittedOperator(c.operator, operators);
    // The user's number is never adjusted to compensate for the operator. It is rescaled ONLY by a stated magnitude
    // suffix (£k) onto a node in the bare currency, and every rewrite is stamped (`canonicaliseLimitUnit`).
    const { value, unit, ...unitProvenance } = canonicaliseLimitUnit(c.value, c.unit, targetScaleFor(nodeId), c.frame);
    const admitted: AdmittedConstraint = {
      constraint_id: `agent-lane:${nodeId}:${operator}`,
      node_id: nodeId,
      operator,
      // ⭐ A2: a STRICT typed operator the store cannot hold as `operator` is held beside it, as stated — so the limit
      // is said "less than 4%", and nothing is lost. The engine still receives `operator` alone (see the header).
      ...(operator !== c.operator && (c.operator === '<' || c.operator === '>') ? { operator_as_stated: c.operator } : {}),
      value,
      // ⛔ THE LABEL IS THE LIMIT'S NAME, NOT THE LIMIT (`GoalConstraintSchema.label`: "Human-readable label, e.g.
      // 'First-year budget cap'"). The bound lives in `operator`/`value`/`unit`, which every consumer renders itself: a
      // label carrying "< 40000GBP/year" rendered on the canvas as "Annual PA salary < 40000GBP/year ≤ 40,000 GBP/year"
      // (Canvas D2, 5832368556) and quoted the drafter's strict symbol against the stored "<=".
      label: c.metric,
      ...(unit !== undefined ? { unit } : {}),
      provenance: canonicalProvenance(c.provenance),
      ...unitProvenance,
      ...(c.frame === 'level' || c.frame === 'delta' ? { value_frame: c.frame } : {}),
    };

    constraints.push(admitted);
  }

  // ⛔ A LIMIT READ BOTH WAYS IS NOT A LIMIT (review 5831251158, saved draw cap-attach/L/B2/draw-4): "Budget is
  // £900k either way" was drafted as BOTH "at least 900000" and "at most 900000" on one node. Attached, the lower
  // half turned the user's ceiling into a floor. When a node's lower bound meets or exceeds its upper bound, both
  // are withheld together and the loss is said in words; neither side is guessed. A genuine range still attaches.
  const contradicted = new Set<string>();
  for (const lower of constraints) {
    if (!isLowerBound(lower.operator)) continue;
    const upper = constraints.find((u) => u.node_id === lower.node_id && !isLowerBound(u.operator) && lower.value >= u.value);
    if (upper === undefined || contradicted.has(lower.node_id)) continue;
    contradicted.add(lower.node_id);
    const metric = candidates.find((c) => nodeIdFor(c.metric) === lower.node_id)?.metric ?? lower.node_id;
    const authored = lower.provenance === 'explicit' || upper.provenance === 'explicit';
    loss.push({
      code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
      layer: 'cee',
      field_path: `goal_constraints[${lower.node_id}].bound_direction`,
      before: `${metric}: at least ${lower.value}${lower.unit ?? ''} and at most ${upper.value}${upper.unit ?? ''}`,
      after: null,
      reason:
        `${authored ? 'Your limit' : 'The limit Olumi proposed'} on "${metric}" was drafted both as at least ` +
        `${lower.value}${lower.unit ?? ''} and as at most ${upper.value}${upper.unit ?? ''}, which would count every ` +
        `option on one side of it as breaking it. Neither was attached, so the analysis will not check this limit ` +
        `until you say which way it runs (a budget is usually at most).`,
      severity: 'warn',
    });
  }

  // ⛔ A RANGE ON ONE METRIC NEEDS TWO NAMES (review 5833797482). The label is the limit's NAME, so a floor and a cap on
  // the same node would both read "Gross margin" in the "could not be checked" card. On that collision only, the lower
  // bound is named "<metric> floor" and the upper "<metric> cap" (structural-reconciliation strips both suffixes).
  const kept = constraints.filter((c) => !contradicted.has(c.node_id));
  const directions = new Map<string, Set<CanonicalOperator>>();
  for (const c of kept) directions.set(c.node_id, (directions.get(c.node_id) ?? new Set<CanonicalOperator>()).add(c.operator));
  const named = kept.map((c) => ((directions.get(c.node_id)?.size ?? 0) > 1 && c.label !== undefined
    ? { ...c, label: `${c.label} ${isLowerBound(c.operator) ? 'floor' : 'cap'}` }
    : c));
  return { constraints: named, loss };
}
