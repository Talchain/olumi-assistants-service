/**
 * ⭐ THE UNIT → SCALE-CLASS → PINNED-FRAME AUTHORITY, as a DEPENDENCY-FREE LEAF.
 *
 * Extracted verbatim from `records/projector.ts` (which now re-exports every
 * symbol below, so no existing importer or guard moves). The extraction is not
 * tidiness: `orchestrator-v5`'s edit writer needs the SAME answer the draft
 * projector uses, and importing the 3,000-line projector into the edit handler
 * to get a pure string→number function would couple the edit seam to the whole
 * draft pipeline. This file imports NOTHING.
 *
 * ⚠ WHY THE EDIT SEAM MAY CONSULT `unitPinnedScaleFrame` AND MAY NOT CONSULT
 * `deriveFactorScaleFrame` — this is the load-bearing distinction of the whole
 * change, and it is the one `projector.ts` warns about at its persist site:
 *
 *   · `deriveFactorScaleFrame` can fall through to the {1,2,5}·10^k LADDER,
 *     whose answer is a function of the MAGNITUDE SET it was given. Re-deriving
 *     that at an edit is measured-WORSE than refusing: the edit sees only the
 *     edited baseline, never the sibling interventions the real frame was
 *     derived WITH, so £600,000 lands at 0.6 beside a £400,000 option at 0.8
 *     and the analysis recommends the wrong option with no refusal anywhere
 *     (9 of 25 framings distorted, worst 100x).
 *
 *   · `unitPinnedScaleFrame` returns ONLY the two UNIT-PINNED CONSTANTS
 *     (percent → 100, basis points → 10,000), and only inside the bounds that
 *     make them true. Which CONSTANT it returns is a function of the UNIT
 *     ALONE — it cannot depend on which magnitudes are in view — so it can
 *     never hand back a laddered, sibling-dependent number. Sibling distortion
 *     is impossible by construction, not by luck, which is precisely why this
 *     narrow limb is safe at a seam where the general function is forbidden.
 *
 *     ⚠ THE PRECISE CLAIM, BOUNDED — an earlier version of this sentence read
 *     "the SAME number the projector would have written, for every possible
 *     sibling set", and that universal was FALSE on `m ∈ (0, 1]`, where this
 *     returned 100 and the projector returned nothing. The true invariant is
 *     **never contradicts, may abstain**:
 *
 *         unitPinnedScaleFrame(u, m) === undefined
 *           ||  unitPinnedScaleFrame(u, m) === deriveFactorScaleFrame([m], u)
 *
 *     It holds for every unit and every finite magnitude, it is asserted
 *     differentially over a corpus that INCLUDES the sub-1 class the original
 *     guard excluded, and the abstentions are the safe direction. See
 *     `unitPinnedScaleFrame`'s own docstring for the two bounds and why the
 *     lower one cannot be widened without taking a product decision.
 *
 * A caller that wants the ladder must still go to `deriveFactorScaleFrame`.
 */

/**
 * THE UNIT'S SCALE CLASS. ONE AUTHORITY — replacing two overlapping `startsWith`
 * predicates whose contract could not describe the domain.
 *
 * ⛔⛔ THERE IS A THIRD `isPercentScaled`, AND IT IS DELIBERATELY NOT CONVERGED
 * HERE. `src/cee/compound-goal/constraint-frame-evidence.ts:69` carries
 * `unit === "fraction" || unit.startsWith("%")`. It is named in this docstring so
 * that a future "one authority" sweep, arriving by symbol, finds the reason
 * BEFORE it finds the similarity — an unnamed twin is what gets converged by a
 * grep. The two answer DIFFERENT QUESTIONS (trap 21):
 *
 *   this file  — "which SCALE FAMILY is this unit token in, for choosing a
 *                 display FRAME?" Trims, lower-cases, prefix-matched.
 *   that file  — "is THIS PRODUCER's stored `value` already divided by 100, so a
 *                 x100 reading must be allowed when comparing two producers'
 *                 numbers?" A question about `parseValue`'s storage convention,
 *                 not about vocabulary.
 *
 * ⚠ AND THEY DISAGREE IN BOTH DIRECTIONS — measured, 13 probes, with the copied
 * body pinned byte-identical to the committed source: 6 spellings are percent
 * HERE and not there (`percent`, `per cent`, `pct`, `percentage`, `PCT`,
 * `'  percent  '` — that file is case-sensitive and does not trim), and 1 is
 * percent THERE and not here (`"fraction"`, the label
 * `normaliseConstraintUnits` applies to a sub-unit value; this classifier calls
 * it `unknown` and is right to). Each is CORRECT for its own question.
 * Converging them would be the two-`generateGraphHash`-twins defect run in
 * reverse: not two names for one concept, but one name over two.
 *
 * ⭐⭐ THIS CHANGE IS A CONVERGENCE, NOT A SEMANTICS CHANGE. Every spelling
 * classifies exactly as the two predicates it replaces classified it, and
 * `deriveFactorScaleFrame` therefore returns a byte-identical frame for every
 * unit string. `__tests__/unit-scale-class.test.ts` asserts that differentially
 * against a generated corpus, in both directions. **One authority** and **new
 * semantics** are two decisions; the second one is rowed, not taken here.
 *
 * ⚠⚠ WHY THAT RESTRAINT IS THE WHOLE POINT, and it is measured, not stylistic.
 * The first version of this classifier was EXACT-MATCH ONLY. Measured base→head
 * across 32 spellings × 9 magnitudes, 18 spellings moved, silently:
 *
 *     '% churn' at max 1.5   level 0.015 → 0.75      a 50× OVERSTATEMENT
 *     '% churn' at max 3     level 0.03  → 0.6       20×
 *     'percentage points' 1.5  0.015     → 0.75      50×
 *     'bps of revenue' 4500    0.45      → 0.9       2×
 *
 * unbounded as `max → 1+`, and the frame also became DATA-DEPENDENT (adding one
 * option rescaled every sibling: baseline level 0.8 → 0.4 → 0.16), which
 * `projector.ts`'s own header forbids by name. `deriveFactorScaleFrame` CAN
 * refuse — it returns `undefined` for negatives, for `max <= 1`, for a non-finite
 * frame — but it does not refuse for an unclassified unit: it falls through to
 * the derived ladder and hands back a number the caller cannot distinguish from
 * a pinned one. So a narrowed classifier does not fail loudly. It fails silently,
 * on `% NRR` — the exact class named in the ruling behind #1106, whose deciding
 * argument was that "refusing more than needed is safe; a silent wrong number is
 * not". EXACT-ONLY MATCHING PUT THIS SEAM ON THE WRONG SIDE OF THAT DOOR.
 *
 * ⚠ THE STRUCTURE: EXACT FIRST, THEN PREFIX, MOST-SPECIFIC CLASS FIRST.
 *
 *     percent            frame 100    '%' 'percent' 'per cent' 'pct' 'percentage'
 *                                     …and any string PREFIXED by those, which is
 *                                     how '% NRR' / 'pcts' / 'percentage points'
 *                                     reach it — see the rowed door below
 *     percentage_points  no pin       'pp' 'ppt' 'pps' and 'pp'-prefixed strings
 *     basis_points       frame 10000  'bps' 'basis point(s)' and their prefixes
 *     unknown            no pin       everything else
 *
 * The prefix sets are the PREVIOUS PREDICATES' OWN SETS, reproduced token for
 * token. The exact layer sits in front of them so a spelling can be pinned to a
 * class against its prefix — the mechanism the rowed decision below will need —
 * without any spelling changing class today.
 *
 * ⛔⛔ THE ROWED ONE-WAY DOOR — DO NOT "TIDY" THE ASYMMETRY BELOW.
 * 'pp' / 'ppt' / 'pps' classify as `percentage_points`, but the SPELLED-OUT
 * 'percentage point(s)' classifies as `percent`. That is inconsistent AS
 * VOCABULARY and it is deliberate: it is exactly what the predicates being
 * replaced did, and it is what makes this change zero-blast-radius.
 *   · the abbreviations matched NEITHER old predicate — a genuinely homeless
 *     family, which is this classifier's real finding;
 *   · the spelled-out forms matched `startsWith("percent")` and were pinned to
 *     frame 100 by every build to date.
 * Whether percentage points are a ×1 class that must STOP taking frame 100 is a
 * real question with a real answer, and it moves live numbers in the direction
 * this seam has already been burned by. It is ROWED, with the measurement above
 * attached, and it does not ship beside an architectural tidy-up. Closing the
 * asymmetry in either direction IS that decision — take it deliberately, with a
 * frame table, or not at all.
 *
 * ⚠ WHAT 'unknown' AND 'percentage_points' ACTUALLY DO, stated honestly because
 * the previous docstring here said "NO CLAIM" and that was not what the code did.
 * They pin no FIXED frame — and `deriveFactorScaleFrame` then falls through to
 * the derived {1,2,5}·10^k ladder and returns a frame anyway. THAT IS NOT A
 * REFUSAL, and the class is discarded at the boundary, so a caller cannot tell a
 * laddered frame from a pinned one. Pre-existing behaviour, unchanged here, and
 * named so the next reader does not mistake the class for a guard.
 *
 * ⚠ BARE 'bp' IS DELIBERATELY UNKNOWN. Inherited from the original
 * `isBasisPointsUnit`, which argued it explicitly: "a bare 'bp' is left to the
 * derived frame rather than guessed." Suppress-rather-than-guess. Do not add it
 * without refuting that argument.
 *
 * ⚠⚠ THE UNIT ALONE IS NEVER SUFFICIENT — DO NOT RE-ADD A BARE `unit === '%'`.
 * The producer's convention is MAGNITUDE-DEPENDENT. CEE's extractor emits "4%" as
 * `{ value: 0.04, unit: '%' }` — a FRACTION under a '%' label — while a '%' value
 * `>= 1` IS percentage points. PLoT documents both halves at
 * `intervention-normaliser.ts:1153-1180`, citing CEE's own
 * `compound-goal/extractor.ts:704-709` (⚠ this citation read `:925-934` until
 * 2026-08-31; at that tip those lines are `CLAUSE_BOUNDARY_RE` and the
 * convention had moved. The convention is real — `return { value: num / 100,
 * unit }` — the line numbers had drifted, which is the hand-maintained-mirror
 * defect one storey down. Re-derive before relying on it), and CEE's relabel runs only on the
 * regex-extracted branch, so a fractional value under a raw '%' label reaches PLoT
 * on the primary draft path. Any caller converting a magnitude MUST read the VALUE
 * as well as the unit. This classifier answers "which scale family is this token?"
 * and NOTHING about which convention a given number is already in.
 *
 * Percent spellings originally: the banked corpus's ('%-prefixed, all 30 record
 * sets), plus the spelt-out forms the adversarial review supplied from OUTSIDE
 * that corpus ("per cent" — this is a British-English estate — and "pct").
 * Trap 22: the corpus-only version silently read "3 per cent" as a derived-frame
 * 0.6.
 */
export type UnitScaleClass = "percent" | "percentage_points" | "basis_points" | "unknown";

/**
 * Exact tokens per class, consulted FIRST.
 *
 * ⭐ EXPORTED SO ITS GUARD CAN BE DERIVED FROM IT. It was previously private and
 * this docstring claimed to be the "single source for the classifier and its
 * tests"; that sentence was FALSE AS WRITTEN, and the correction is left here in
 * place rather than deleted because the reason matters more than the tidiness.
 * `unit-scale-class.test.ts` iterated an ELEVEN-TOKEN LITERAL DECLARED INSIDE THE
 * TEST — a second copy of this vocabulary, i.e. exactly the hand-maintained
 * mirror the classifier was built to abolish, one level up in the test. Measured:
 * adding the single token `"percentile"` to the `basis_points` row below moved
 * `deriveFactorScaleFrame([45], "percentile")` from **100 to 10000** — level 0.45
 * to 0.0045, a 100x understatement — with **26/26 GREEN** in that spec at
 * `8111337c`, the commit before this one. The literal did not
 * list the token, and the generated corpus (1785 spellings) does not contain it
 * either, so BOTH layers of cover missed it. Neither guard was weak; both were
 * pointed at tokens somebody had already thought of.
 *
 * ⚠ WHAT THE GUARD NOW PROVES: for EVERY token in this array — including one
 * added after this sentence was written — the exact layer and the prefix layer
 * return the SAME class. The test iterates THIS EXPORT, so a new token is covered
 * the moment it is added and nobody has to remember a second list.
 *
 * ⚠⚠ AND WHAT IT STILL CANNOT SEE, stated because a guard that bounds its own
 * claim is worth more than one that reads as total:
 *   1. It CANNOT see a token that OUGHT to be here and is absent. Derivation
 *      proves AGREEMENT between two copies; it is structurally blind to a short
 *      list. The hand-written `MUST_CONTAIN` subset beside it is the other half,
 *      and it only catches the removal of the eleven tokens it names.
 *   2. It CANNOT tell you the class is the RIGHT one. It judges the two layers
 *      against each other, never against the vocabulary. `"percentile" ->
 *      percent` would pass silently — both layers agree — even though admitting
 *      it is a product decision about what the percent family means.
 *   3. It says NOTHING about `UNIT_SCALE_CLASS_PREFIXES` below. A prefix added
 *      there is judged only by the generated differential corpus in
 *      `unit-scale-class.test.ts`, which is a sample, not a proof.
 *
 * ⚠ THIS WHOLE LAYER IS INERT TODAY, AND ITS TESTS ARE NOT BEHAVIOURAL COVERAGE.
 * Every token here resolves to the same class by prefix, so DELETING the exact
 * lookup limb in `classifyUnitScaleClass` is an EQUIVALENT MUTANT — DEMONSTRATED,
 * not asserted, because a survivor is a claim either way. With the limb removed:
 * both spec files stay green (80/80) and 0 of 1785 generated corpus spellings
 * change class, a comparator whose contrast control reports 1 when one row is
 * deliberately altered. And that sample only corroborates a COMPLETE argument:
 * the deleted limb is reachable ONLY by a string that IS an exact token, and the
 * guard below asserts every exact token's prefix answer equals its exact answer —
 * so equivalence holds over the whole input domain, not over 1785 samples.
 * That redundancy is WHY this change is byte-for-byte, and the layer is kept
 * because it is the mechanism the rowed one-way door will need. A reader must not
 * mistake the tests below for evidence that this table does anything yet: they
 * pin a MECHANISM, not a behaviour, and deleting it today would cost nothing
 * measurable.
 */
export const UNIT_SCALE_CLASS_TOKENS: ReadonlyArray<readonly [UnitScaleClass, readonly string[]]> = [
  ["percent", ["%", "percent", "per cent", "pct", "percentage"]],
  ["percentage_points", ["pp", "ppt", "pps"]],
  ["basis_points", ["bps", "basis point", "basis points"]],
];

/**
 * Prefix fallback, MOST-SPECIFIC CLASS FIRST. ⚠ These are the REPLACED
 * PREDICATES' OWN PREFIX SETS — `isPercentScaledUnit` was
 * `startsWith('%'|'percent'|'per cent'|'pct')` and `isBasisPointsUnit` was
 * `startsWith('bps'|'basis point')`. Reproduced token for token so no spelling
 * changes class. `'pp'` is NEW as a prefix and is behaviour-neutral by
 * construction: nothing that starts with `'pp'` starts with any percent or
 * basis-point prefix, and `percentage_points` pins no frame, so a `'pp'`-tailed
 * string lands on the same derived ladder `unknown` already sent it to.
 */
const UNIT_SCALE_CLASS_PREFIXES: ReadonlyArray<readonly [UnitScaleClass, readonly string[]]> = [
  ["percentage_points", ["pp"]],
  ["basis_points", ["bps", "basis point"]],
  ["percent", ["%", "percent", "per cent", "pct"]],
];

const UNIT_SCALE_CLASS_BY_TOKEN: ReadonlyMap<string, UnitScaleClass> = (() => {
  const m = new Map<string, UnitScaleClass>();
  for (const [cls, tokens] of UNIT_SCALE_CLASS_TOKENS) for (const t of tokens) m.set(t, cls);
  return m;
})();

export function classifyUnitScaleClass(unit: string | undefined): UnitScaleClass {
  if (typeof unit !== "string") return "unknown";
  const t = unit.trim().toLowerCase();
  if (t.length === 0) return "unknown";
  const exact = UNIT_SCALE_CLASS_BY_TOKEN.get(t);
  if (exact !== undefined) return exact;
  for (const [cls, prefixes] of UNIT_SCALE_CLASS_PREFIXES) {
    for (const p of prefixes) if (t.startsWith(p)) return cls;
  }
  return "unknown";
}

/**
 * Percent spellings. RETAINED as a named question ("is this the percent family?")
 * and now DERIVED from `classifyUnitScaleClass` rather than carrying its own
 * token list — two copies of this vocabulary is the hand-maintained mirror that
 * lets a token be added to one and not the other.
 *
 * ⚠ ITS ANSWER IS UNCHANGED FOR EVERY INPUT. This is the convergence, not the
 * semantics change: `'percentage points'` and `'% NRR'` still return `true`, via
 * the prefix layer, exactly as they did before. See the rowed one-way door on
 * `classifyUnitScaleClass` for why that is deliberate and what it costs.
 */
export function isPercentScaledUnit(unit: string | undefined): boolean {
  return classifyUnitScaleClass(unit) === "percent";
}

/**
 * Basis points declare scale 10,000 — NOT 100. Lumping "bps" into the percent
 * set would be a 100× error in the opposite direction (30 bps = 0.003, never
 * 0.3). Narrow on purpose: "bps" and "basis point(s)"; a bare "bp" is left to
 * the derived frame rather than guessed.
 */
export function isBasisPointsUnit(unit: string | undefined): boolean {
  return classifyUnitScaleClass(unit) === "basis_points";
}

/**
 * ⭐ THE FRAME A UNIT PINS ON ITS OWN, or `undefined` when the unit pins none.
 *
 * The two magnitude-INDEPENDENT limbs of `deriveFactorScaleFrame`, lifted so
 * both the draft projector and the edit writer read ONE authority instead of
 * two copies (trap 12: a hand-maintained mirror drifts, and the drift reads as
 * green). `deriveFactorScaleFrame` now CALLS this rather than repeating it.
 *
 * `magnitude` is the bound the pinned frame must actually contain — a "150
 * percent" cannot be framed by 100 without manufacturing a level > 1 that the
 * unit does not license, so it is REFUSED here and left to the caller. The
 * draft projector passes its magnitude MAX; the edit writer passes the single
 * magnitude it is writing. Both are asking the same question of the same
 * authority.
 *
 * ⚠ `percentage_points` and `unknown` pin NOTHING and return `undefined`. That
 * is a refusal to guess, not an oversight: `pp` is a DIFFERENCE between two
 * percentages and has no fixed divisor, and `unknown` is the honest state for
 * a currency or a count. Widening either family moves live levels silently.
 *
 * ⭐⭐ THE CONTRACT THIS FUNCTION ACTUALLY HONOURS, stated as an invariant over
 * the WHOLE input domain rather than as a claim about the class its author had
 * in view:
 *
 *     unitPinnedScaleFrame(u, m) === undefined
 *       ||  unitPinnedScaleFrame(u, m) === deriveFactorScaleFrame([m], u)
 *
 * **NEVER CONTRADICTS; MAY ABSTAIN.** It is deliberately NOT "always equals" —
 * above the pinned bound (`150` percent) this abstains while the projector
 * ladders to 200, and abstaining is the safe direction at an edit seam. What
 * matters is that where this speaks, it says exactly what the projector would
 * have said for that magnitude, so no caller can be handed a frame the draft
 * pipeline would not have written.
 *
 * ⚠⚠ THE LOWER BOUND IS LOAD-BEARING AND WAS ADDED AFTER REVIEW MEASURED ITS
 * ABSENCE. This function previously had an UPPER bound and no lower one, so on
 * `m ∈ (0, 1]` it returned 100 while `deriveFactorScaleFrame` returned
 * `undefined` — `projector.ts` returns at `max <= 1` BEFORE the pinned limbs
 * are ever consulted. The two authorities were one authority only on `(1, 100]`,
 * and the guard written to pin them together iterated `{45, 12, 30}` and `1.5+`
 * — a corpus that EXCLUDED the entire class on which the property failed
 * (trap 22: the corpus shared the code's asymmetry).
 *
 * The consequence was not academic. `normalise-factor-value.ts` consults this
 * at an edit, so `{rawInput: 0.06, unit: '%'}` moved from level `0.06` to
 * `0.0006` — a silent 100× on a number the analysis already computed on, with
 * NO refusal on either side of the change (measured: the baseline gate blocks
 * neither pair, while it does block `{12, 12}`).
 *
 * ⭐ AND THE CLASS IS AMBIGUOUS AT SOURCE, WHICH IS WHY ABSTAINING IS THE ONLY
 * HONEST ANSWER RATHER THAN A CAUTIOUS ONE. A sub-1 number under a `%` label is
 * genuinely TWO different states in this estate and nothing at this seam can
 * tell them apart:
 *   · this repo's own producer convention — `compound-goal/extractor.ts:704-709`
 *     stores `"4%"` as `{value: 0.04, unit: "%"}`, so the number IS ALREADY a
 *     level and dividing it by 100 is the 100× lie;
 *   · a user genuinely stating "0.5 percent", where the true level is 0.005.
 * Guessing either way ships a confident wrong number on the other. So this
 * abstains, the write falls back to raw, and the analysis seam's gate keeps the
 * decision — the estate's own "refuse rather than guess" rule, applied to a
 * predicate that cannot be settled by more parsing (trap 22f). Widening this
 * bound is a PRODUCT decision about which convention wins; it is not a tidy-up,
 * and it must not be taken by deleting a comparison.
 */
export function unitPinnedScaleFrame(
  unit: string | undefined,
  magnitude: number,
): number | undefined {
  if (!Number.isFinite(magnitude) || magnitude < 0) return undefined;
  // ⚠ STRICTLY `> 1`, matching `deriveFactorScaleFrame`'s `max <= 1` return
  // EXACTLY. Not `>= 1`: at m === 1 the projector writes no frame, so pinning
  // one here would re-open the divergence at a single point.
  if (!(magnitude > 1)) return undefined;
  const scaleClass = classifyUnitScaleClass(unit);
  if (scaleClass === "percent" && magnitude <= 100) return 100;
  if (scaleClass === "basis_points" && magnitude <= 10000) return 10000;
  return undefined;
}
