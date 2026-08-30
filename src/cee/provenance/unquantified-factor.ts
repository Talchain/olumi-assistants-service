/**
 * THE EXPLICIT UNKNOWN — one representation for "we have no value for this factor".
 *
 * ── WHY THIS MODULE EXISTS ─────────────────────────────────────────────────
 * CEE had exactly one honest answer to a missing factor value, and it lived
 * inside `unreachable-factors.ts` where only ONE population could reach it:
 * factors reclassified to `external` because no option reaches them. Every
 * other valueless factor got `value: 0.5` written into it — a number that
 * satisfies `graph-validator.ts`'s `data?.value === undefined` gate and
 * carries no information whatever.
 *
 * The measured consequence (29 Aug 2026, standing brief §9): **60 of 60 present
 * factor values were exactly `0.5`, across 18 drafts and all three brief
 * classes — distinct value set literally `[0.5]`.** And it is not inert: ISL's
 * elasticity is `(causal path gain) x (the factor's baseline) / (baseline
 * outcome mean)`, so a placeholder baseline is a multiplicative term in the
 * headline sensitivity, and PLoT derives sigma as `|value| * 0.15` from the
 * same number. The placeholder reaches the maths.
 *
 * This module is the GENERALISATION of the existing honest path, not a second
 * mechanism beside it. `unreachable-factors.ts` now writes the same shape
 * through the same constants (CLAUDE.md's chronic defect is two same-purpose
 * mechanisms under different names).
 *
 * ── THE RULING IT IMPLEMENTS (the founder, 2026-08-18) ─────────────────────
 * "Factors without a defensible value, evidence-backed range or explicit
 * defensible prior remain VISIBLY PRESENT but are NOT given invented
 * quantitative values simply so analysis can consume them. Do not disguise
 * ignorance as a 0-1 distribution."
 *
 * And the standing invariant (LANE-STANDING-BRIEF.md, NO UNIVERSAL SEMANTIC
 * FALLBACK): there are exactly three legitimate states for a quantity —
 * explicit user fact (preserve it), defensible Olumi estimate (with its
 * provenance and uncertainty), genuinely unknown (UNKNOWN / needs input). A
 * defaulted constant is none of them.
 *
 * ── WHY `U(0,1)` AND NOT "NO PRIOR AT ALL" ─────────────────────────────────
 * MARK, NEVER SUPPRESS. Withholding the prior entirely strips the node of any
 * support and leaves any constraint targeting it evaluating trivially
 * (P=1.0/P=0.0 at intercept=0) — the failure the original prior synthesis was
 * written to prevent. `U(0,1)` is the one range over the unit interval that
 * asserts NOTHING: it does not claim the value is above some floor or below
 * some ceiling. A NARROWED range would be an information claim, and there is no
 * information. That distinction is the whole ruling.
 *
 * ── WHY THE FLAG RIDES INSIDE `prior` ──────────────────────────────────────
 * `prior_is_unquantified` is a statement ABOUT this prior — "this uniform range
 * is ignorance, not an estimate" — so it travels with the thing it qualifies
 * and cannot be orphaned by a transform that moves one and not the other. One
 * owner, one place. The carrier is already proven: `cee-v3.ts:232` types node
 * `prior` as `.passthrough().optional()`, and `schema-v3.ts:447` forwards
 * `v3Node.prior = nodePrior` with NO category gate (despite its comment saying
 * "for external factors" — verified at the bytes, 30 Aug 2026).
 *
 * ⚠ SCOPE OF THAT VERIFICATION: it is a CEE-side claim about CEE's own V3
 * transform and validator. Whether PLoT and ISL preserve the flag is a claim
 * about THEIR bytes and is not asserted here.
 *
 * ── WHY THE DISCRIMINATOR MATTERS DOWNSTREAM ───────────────────────────────
 * The UI's `isFactorNeedsInput` exempts any factor carrying a prior range —
 * an exemption written for genuine external priors. An ignorance prior must NOT
 * inherit it, or the amber "needs your judgement" affordance stays dark on
 * exactly the factors that need it. `prior_is_unquantified` is the field that
 * tells the two apart. CEE's obligation is to EMIT it; the UI change to READ it
 * is a separate lane and is NOT done here.
 */

/**
 * The field name, declared once. Written inside `node.prior`.
 *
 * Kept as a named constant so a consumer-side guard can import the spelling
 * rather than restate it — a hand-copied string is the mirror this estate keeps
 * paying for (CLAUDE.md trap 12).
 */
export const PRIOR_IS_UNQUANTIFIED_FIELD = "prior_is_unquantified";

/**
 * The one range over the unit interval that asserts nothing.
 *
 * ⚠ These are NOT tuning parameters. `0` and `1` are the endpoints of the
 * normalised factor scale, so this range excludes no admissible value. Any
 * other pair would be a claim.
 */
export const IGNORANCE_PRIOR_RANGE = Object.freeze({ range_min: 0, range_max: 1 });

/**
 * The distribution family. `uniform` is the only member of `PriorDistribution`
 * (`schemas/graph.ts`) and the only family `schema-v3.ts`'s drift alarm accepts
 * without logging an error.
 */
export const IGNORANCE_PRIOR_DISTRIBUTION = "uniform";

export interface UnquantifiedPrior {
  readonly distribution: string;
  readonly range_min: number;
  readonly range_max: number;
  readonly prior_is_unquantified: true;
  readonly source: 'cee_repair';
  readonly value_tier: 'fallback_default';
}

/**
 * Build the explicit unknown: maximal uncertainty, labelled as ignorance.
 *
 * A fresh object every call — a frozen shared instance would be aliased onto
 * many nodes, and a repair pass that mutated one would silently move all of
 * them.
 */
export function buildUnquantifiedPrior(): UnquantifiedPrior {
  return {
    distribution: IGNORANCE_PRIOR_DISTRIBUTION,
    range_min: IGNORANCE_PRIOR_RANGE.range_min,
    range_max: IGNORANCE_PRIOR_RANGE.range_max,
    [PRIOR_IS_UNQUANTIFIED_FIELD]: true,
    source: 'cee_repair',
    value_tier: 'fallback_default',
  };
}

/**
 * Is this a prior a downstream consumer can actually express?
 *
 * ⚠⚠ TWO PREDICATES, TWO QUESTIONS, AND CONFLATING THEM IS HOW THIS PR SHIPPED
 * A NEW INFORMATION-LOSS PATH IN ITS FIRST ROUND (CLAUDE.md trap 21):
 *
 *   `factorHasExpressiblePrior`     — "has this factor's level been STATED as a
 *                                      distribution?"        → the VALIDATOR's gate
 *   `factorIsExplicitlyUnquantified`— "is that distribution an admission of
 *                                      IGNORANCE rather than an estimate?"
 *                                                            → the DOWNSTREAM discriminator
 *
 * They are not the same axis and neither is derived from the other. A
 * model-supplied `U(0.6, 1.0)` answers the first YES and the second NO. The
 * first round of this change asked only the second question at the write site
 * and therefore overwrote such a prior with `U(0,1)` flagged as ignorance — a
 * FALSE CLAIM OF IGNORANCE about a factor the model had information on, moving
 * the centre 0.8 → 0.5 on a quantity the maths is linear in.
 *
 * ⭐ THE CONDITIONS ARE THE ONES WE HOLD OURSELVES TO. This is deliberately the
 * same expressibility test the suite asserts against our OWN emitted prior —
 * uniform family, finite bounds, STRICTLY ordered — mirroring PLoT's three
 * declines. One definition, used both to validate what we emit and to decide
 * whether a model's prior is good enough to keep. A second, looser definition
 * here would be the mirror this module exists to remove.
 *
 * `range_min < range_max` is strict on purpose: `min === max` is a point mass,
 * not a stated range, and `min > max` would rely on a downstream swap repair we
 * must not depend on.
 */
export function factorHasExpressiblePrior(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const prior = (node as { prior?: unknown }).prior;
  if (typeof prior !== "object" || prior === null) return false;
  const p = prior as Record<string, unknown>;
  if (p.distribution !== IGNORANCE_PRIOR_DISTRIBUTION) return false;
  const min = p.range_min;
  const max = p.range_max;
  if (typeof min !== "number" || !Number.isFinite(min)) return false;
  if (typeof max !== "number" || !Number.isFinite(max)) return false;
  return min < max;
}

/**
 * Should a MODEL-SUPPLIED prior be preserved as the factor's stated level?
 *
 * ⚠⚠ EXPRESSIBLE IS NOT THE SAME AS INFORMATIVE, AND CONFLATING THEM COST
 * DISCLOSURE THAT STAGING ALREADY HAD.
 *
 * The served prompt teaches the model to encode ignorance AS a prior
 * (`defaults-v187.ts:514,517-521`):
 *
 *     | Brief language          | range_min | range_max |
 *     | "low", "limited"        | 0.0       | 0.4       |
 *     | "moderate", "normal"    | 0.3       | 0.7       |
 *     | "high", "intense"       | 0.6       | 1.0       |
 *     | unknown / no qualifier  | 0.0       | 1.0       |     <-- THIS ONE
 *
 * So a model-supplied `uniform(0, 1)` is not an estimate we should preserve —
 * it is the model SAYING IT DOES NOT KNOW, in the vocabulary we taught it. A
 * guard that only asked "is this prior expressible?" preserved it unflagged,
 * and the factor then validated clean with no `prior_is_unquantified` and no
 * `value_tier` — **less disclosure than staging**, which at least stamped
 * `value_tier: "fallback_default"`. A fix for silent placeholders that
 * introduces a silent placeholder.
 *
 * The tell was that the two shapes below became indistinguishable while a third,
 * semantically identical to the first, was treated differently:
 *
 *     model `U(0,1)`   -> unflagged   <-- "I don't know", silently
 *     model `U(0.6,1)` -> unflagged   <-- an estimate; correct
 *     no prior at all  -> FLAGGED     <-- "I don't know", disclosed
 *
 * The first and third are the SAME CLAIM and must get the same representation.
 *
 * ⭐ NOTHING IS NARROWED AND NOTHING IS WIDENED. A `U(0,1)` that falls through
 * here is replaced by `buildUnquantifiedPrior()`, whose range is `[0,1]` — the
 * IDENTICAL interval. The only thing that changes is that the node now SAYS so.
 * No information is lost in either direction; disclosure is gained.
 *
 * The bound is `range_max - range_min < 1` rather than an equality test against
 * `0` and `1`, so a prior that spans the whole scale by any spelling (or wider)
 * is treated as the non-statement it is.
 */
export function shouldPreserveModelPrior(node: unknown): boolean {
  if (!factorHasExpressiblePrior(node)) return false;
  const p = (node as { prior: Record<string, unknown> }).prior;
  const min = p.range_min as number;
  const max = p.range_max as number;
  return max - min < IGNORANCE_PRIOR_RANGE.range_max - IGNORANCE_PRIOR_RANGE.range_min;
}

/**
 * Does this node carry an EXPLICIT unknown?
 *
 * ⚠⚠ THIS IS THE VALIDATOR'S DISCRIMINATOR, AND ITS BREADTH IS THE WHOLE
 * SAFETY ARGUMENT. `graph-validator.ts` treats a factor with no numeric value
 * as an ERROR, and that gate is what stops a structurally broken node reaching
 * the maths. Relaxing it for an explicit unknown is correct; relaxing it for a
 * factor carrying NOTHING would delete the gate.
 *
 * So this returns true ONLY on positive evidence — the flag is present and
 * literally `true`. It is deliberately NOT `!== false`, NOT truthiness, and NOT
 * "has a prior". A factor with a prior but no flag is a factor with a genuine
 * external prior, which is a different state and keeps its existing treatment.
 *
 * (Written against the SPEC — "an explicit unknown satisfies the gate, absence
 * of both a value and an explicit unknown must still be an error" — not against
 * the failure mode. LANE-STANDING-BRIEF.md §3.)
 */
export function factorIsExplicitlyUnquantified(node: unknown): boolean {
  if (typeof node !== "object" || node === null) return false;
  const prior = (node as { prior?: unknown }).prior;
  if (typeof prior !== "object" || prior === null) return false;
  return (prior as Record<string, unknown>)[PRIOR_IS_UNQUANTIFIED_FIELD] === true;
}

/**
 * The sentence a user reads. Plain English, no notation, no leaked figure.
 *
 * ⚠ THE WORDING IS NOT A STYLE CHOICE — it is the adversarial-review C1 ruling
 * already applied at `unreachable-factors.ts:743-750`, reused verbatim in
 * substance so the product says ONE thing about this state. An earlier draft of
 * that string printed `[0, 1]`, the word UNQUANTIFIED, and the raw defaulted
 * `0.5` to a user. All three are internal language: the bracket notation is our
 * prior, and the `0.5` is the very number we are disowning.
 *
 * The honest claim is that we have no estimate — not a description of our own
 * machinery.
 */
export const UNQUANTIFIED_CLAUSE =
  "we have no estimate for it yet — its value was left fully open" +
  " rather than narrowed to a figure we cannot support";

export function unquantifiedFactorSentence(label: string): string {
  return `We have no estimate for "${label}" yet — its value was left fully open`
    + ` rather than narrowed to a figure we cannot support`;
}

/**
 * The same claim as a CLAUSE, for appending to a repair action that already
 * describes something else (`unreachable-factors.ts` appends it to its
 * reclassification sentence).
 *
 * Two grammatical forms, ONE wording, declared together — so the product cannot
 * end up saying two different things about one state, which is the failure this
 * whole module exists to stop.
 */
export function unquantifiedClauseSuffix(): string {
  return `, and ${UNQUANTIFIED_CLAUSE}`;
}
