/**
 * ⭐⭐ IS THIS LIMIT ON A SCALE THE TARGET'S DOMAIN CAN CARRY? — a DIFFERENT
 * QUESTION FROM "DOES THE TARGET RECORD A LEVEL", AND THE TWO MUST NOT BE
 * COLLAPSED (CLAUDE.md trap 21).
 *
 * ── THE DEFECT, DERIVED AT THE CONSUMER'S BYTES ───────────────────────────
 * `classifyConstraintWriteAdmissibility` asks whether the target records a
 * quantity. A node that records one passes, and the write path says
 * "Added constraint: …" with no qualification. That is correct for a factor and
 * WRONG for a risk, an outcome or a goal, because those three are not scored in
 * the user's units at all.
 *
 * Derived 17 Sep 2026 at `plot-lite-service` staging `d68d4ffb`,
 * `src/normalisation/constraint-filter.ts` — NOT inferred from a symptom:
 *
 *   :41   PROBABILITY_DOMAIN_KINDS = new Set(['goal', 'outcome', 'risk'])
 *   :121  "Goal/outcome/risk scores are normalised to [0,1]."
 *   :158  if (isProbabilityNode && (value < 0 || value > 1) && !isTemporalUnit)
 *           -> (unless scalable into domain) logger.warn
 *              { event: 'plot.constraint_out_of_domain' }
 *
 * ⚠⚠ AND IT IS A **WARN, DON'T DROP** GATE (:147). The constraint is still
 * forwarded to ISL, which evaluates `P(score <= 200000)` against a score that
 * cannot leave [0,1]. So the limit is not "unchecked" — it is **checked and
 * trivially satisfied, by every option, forever.** The user is shown their
 * budget limit being met.
 *
 * ⭐ THAT IS WHY THIS IS NOT A VARIANT OF THE MEASURABILITY GATE, AND IS WORSE
 * THAN IT. A target that records no level produces `constraint_no_observed_value`
 * and, downstream, an honest "could not be checked". This class produces a
 * confident, green, false PASS.
 *
 * ── SPEAK ONLY WHERE PLoT PROVABLY WARNS ──────────────────────────────────
 * The predicate below is a STRICT SUBSET of PLoT's warn condition, so
 * `carriable: false` ⟹ `plot.constraint_out_of_domain`. The narrowing is the
 * unit: PLoT warns on any non-temporal unit; this speaks only for a CURRENCY.
 *
 * The entailment, limb by limb:
 *   · kind and value range are mirrored exactly, INCLUDING the `value < 0` limb.
 *     A sign-asymmetric copy of a sign-symmetric gate is this estate's measured
 *     defect shape (CLAUDE.md trap 13d) and is why the negative has its own test.
 *   · currency ⟹ not temporal, so PLoT's `!isTemporalUnit` holds.
 *   · currency ⟹ not percent, so PLoT's fallback cap of 100 is `undefined`;
 *     with no declared `goal_threshold_cap` its `scalableIntoDomain` is false.
 * Anything outside that subset stays SILENT, which is today's behaviour.
 *
 * ⚠ THE SAFE DIRECTION IS SILENCE, and the currency narrowing buys it twice
 * over. A false refusal tells a user their good limit will be ignored; a false
 * silence is merely the product as it shipped. The percent case is the one that
 * matters in practice — "churn must not exceed 7%" carries `value: 7` on a risk
 * node, is out of [0,1], and PLoT resolves it against a cap of 100 rather than
 * warning. Speaking there would break the estate's most common real constraint.
 *
 * ⚠ IT IS A MIRROR OF ANOTHER SERVICE'S PREDICATE — this estate's chronic
 * defect class, here deliberately and not by accident, because there is no
 * shared carrier for the domain verdict today. It is dated and SHA-pinned above
 * so a reader can re-derive it, and it fails CLOSED: an unreadable target, an
 * unknown kind or a non-finite value all yield `null`.
 *
 * PURE. No I/O, no clock, no config, no graph mutation.
 */
import { isCurrencyUnit } from '../../../../utils/currency-alphabet.js';

/**
 * `null` is "say nothing", and it is the answer for every case this module has
 * not PROVEN. There is deliberately no `carriable: true` member: this predicate
 * establishes a refusal or it establishes nothing, and a positive verdict would
 * invite a caller to read silence as an assurance the analysis will score the
 * limit — which no gate here can give.
 */
export type ConstraintScaleDomainVerdict =
  | { readonly carriable: false; readonly reason: 'target_scored_on_unit_interval' }
  | null;

/**
 * PLoT's `PROBABILITY_DOMAIN_KINDS` (`constraint-filter.ts:41`). These three
 * carry a normalised [0,1] score, never the user's units.
 */
const UNIT_INTERVAL_SCORED_KINDS: ReadonlySet<string> = new Set(['goal', 'outcome', 'risk']);

/**
 * The producer-declared scale this threshold would be normalised against.
 *
 * Mirrors `collectGoalThresholdNodeMeta` (`plot-lite-service/src/routes/v2/run.ts:2281`),
 * which reads `node.goal_threshold_cap ?? node.data?.goal_threshold_cap` off the
 * RAW node — so both spellings are consulted here too. A node that declares one
 * is a node PLoT may resolve rather than warn about, so its presence alone
 * silences this module: checking `value <= cap` as PLoT does would make us speak
 * on a class it stays quiet about.
 */
function declaresItsOwnScale(target: Record<string, unknown>): boolean {
  const data = target.data;
  const candidates: readonly unknown[] = [
    target.goal_threshold_cap,
    data !== null && typeof data === 'object' && !Array.isArray(data)
      ? (data as Record<string, unknown>).goal_threshold_cap
      : undefined,
  ];
  return candidates.some((c) => typeof c === 'number' && Number.isFinite(c) && c > 0);
}

/**
 * Whether a limit of `value` `unit` written onto `target` would be forwarded to
 * ISL and scored against a [0,1] score — i.e. satisfied whatever happens.
 *
 * @param target the RAW graph node, for the same reason
 *   `classifyConstraintWriteAdmissibility` takes one: `NodeV3` strips undeclared
 *   keys, and the V1 `data` cap carrier is undeclared.
 */
export function classifyConstraintScaleDomain(input: {
  readonly target: Record<string, unknown>;
  readonly value: number;
  readonly unit: string | null | undefined;
}): ConstraintScaleDomainVerdict {
  const kind = input.target.kind;
  if (typeof kind !== 'string' || !UNIT_INTERVAL_SCORED_KINDS.has(kind)) return null;

  // ⚠ SIGN-SYMMETRIC, exactly as the consumer's gate is. `> 1` alone would miss
  // the negative half and leave a whole direction unobserved.
  const value = input.value;
  if (!Number.isFinite(value)) return null;
  if (value >= 0 && value <= 1) return null;

  const unit = typeof input.unit === 'string' ? input.unit.trim() : '';
  if (unit === '' || !isCurrencyUnit(unit)) return null;

  if (declaresItsOwnScale(input.target)) return null;

  return { carriable: false, reason: 'target_scored_on_unit_interval' };
}

/**
 * The sentence. It names the CAUSE — the target is scored on a 0-1 scale — not
 * merely the symptom, because the symptom here is invisible: the limit reports
 * as satisfied.
 *
 * ⚠ IT DOES NOT PROMISE THE ANALYSIS WILL SCORE ANYTHING once corrected, and it
 * does not re-target. The user chose a node; moving their limit under them on a
 * unit match is the confident wrongness these gates exist to prevent.
 */
export function formatConstraintScaleDomainRefusal(input: {
  readonly targetLabel: string;
  readonly unit: string;
}): string {
  return (
    `I recorded this against ${input.targetLabel}, but the analysis scores `
    + `${input.targetLabel} as a 0-1 likelihood, not in ${input.unit} — so a limit `
    + `in ${input.unit} would be met no matter what happens. Put it on something `
    + `measured in ${input.unit}, or set it as a likelihood.`
  );
}

/**
 * The same refusal when exactly one factor in the graph already records the
 * constraint's own unit. Named apart from
 * `formatConstraintTargetAlternative` because that sentence states a DIFFERENT
 * cause — "has no figure for the analysis to test" — which is FALSE here: this
 * target may record a figure, and the figure is the wrong KIND of quantity.
 * The candidate itself is found by the shared
 * `findConstraintTargetAlternative`, not by a second finder.
 */
export function formatConstraintScaleDomainAlternative(input: {
  readonly chosenLabel: string;
  readonly alternativeLabel: string;
  readonly unit: string;
}): string {
  return (
    `I recorded this against ${input.chosenLabel}, which the analysis scores as a `
    + `0-1 likelihood rather than in ${input.unit} — so a limit in ${input.unit} `
    + `would be met no matter what happens. ${input.alternativeLabel} may be the one `
    + `you meant — it is the only thing in your model recorded in ${input.unit}. `
    + `Say so and I will put the limit on it.`
  );
}
