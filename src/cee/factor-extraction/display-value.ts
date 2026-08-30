/**
 * Display Value Synthesis
 *
 * Pure, deterministic helpers that build human-readable value strings from
 * factor numeric data when the LLM has not provided a `display_value`.
 *
 * Two exported functions:
 *
 * - `synthesiseDisplayValue` — single point-estimate for controllable /
 *   observable factors (e.g. `"£500k"`, `"3%"`, `"42 days"`, `"Low (0.15)"`).
 *
 * - `synthesiseRangeDisplayValue` — range string for external factors whose
 *   numeric state is captured as a `prior` distribution
 *   (e.g. `"£200k to £500k"`, `"10% to 25%"`, `"Up to £500k"`).
 *
 * These functions must never throw. If the input is insufficient to produce a
 * meaningful string they return `undefined` so callers can omit the field.
 */

import { MAGNITUDE_DISPLAY_LADDER } from "../../utils/magnitude-alphabet.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Input to `synthesiseDisplayValue`.
 * All fields are optional — the function degrades gracefully.
 */
export interface DisplayValueInput {
  /** Normalised numeric value (0–1 or 0–100 range) */
  value?: number;
  /** Pre-normalisation numeric value (e.g. 500000 for £500k) */
  raw_value?: number;
  /** Unit string from LLM/enricher (e.g. "£", "$", "%", "days", "months") */
  unit?: string;
  /** Factor type classification */
  factor_type?: string;
  /** Normalisation cap (e.g. 1000000 for "up to £1m") */
  cap?: number;
}

/**
 * Input to `synthesiseRangeDisplayValue`.
 */
/**
 * ⚠ CORRECTED: these bounds are NOT "pre-normalisation raw values".
 *
 * That is what this interface claimed, and it is false for BOTH live
 * producers — a false interface doc is what licensed the per-bound magnitude
 * sniff below, so it is corrected here rather than left as a comment nobody
 * reconciled. Derived at the bytes, CEE staging, 2026-08-26:
 *
 *   1. Existing graph inputs can carry a `prior` on a normalised scale. The
 *      legacy graph-output prompt described that encoding, but it is NOT the
 *      current draft records contract: `buildDraftRecordsSchema()` has a
 *      scalar claim `value`, not factor `range_min` / `range_max` fields.
 *      Do not use the old prompt table as proof of the live records producer.
 *
 *   2. `synthesisePriorFromBaseline` (repair stage,
 *      `unified-pipeline/stages/repair/unreachable-factors.ts:690`), which
 *      derives the range from the factor's own `observed_state.value` and
 *      therefore emits ON THAT VALUE'S SCALE — model units for a framed
 *      factor, and the RAW magnitude for an unframed one, because
 *      `normalise-factor-value.ts` writes `{raw_value: x, value: x}` for
 *      counts, ratios and unbounded scales.
 *
 * So the honest statement is: THE BOUNDS ARE ON WHATEVER SCALE THEIR PRODUCER
 * USED, and this type cannot promise which. That is the ambiguity the percent
 * limb below now declines to guess at instead of sniffing per bound.
 */
export interface RangeDisplayValueInput {
  /** Lower bound of the prior distribution, on its producer's scale (see above) */
  range_min?: number;
  /** Upper bound of the prior distribution, on its producer's scale (see above) */
  range_max?: number;
  /** Distribution type (unused for formatting, present for future use) */
  distribution?: string;
}

// ============================================================================
// Currency Symbols
// ============================================================================

const CURRENCY_SYMBOLS = new Set(["£", "$", "€", "¥", "₹", "GBP", "USD", "EUR"]);

/**
 * Return the display prefix for a currency unit (e.g. "GBP" → "£").
 * Returns `undefined` if the unit is not a recognised currency.
 */
function currencyPrefix(unit: string): string | undefined {
  if (unit === "£" || unit === "GBP") return "£";
  if (unit === "$" || unit === "USD") return "$";
  if (unit === "€" || unit === "EUR") return "€";
  if (unit === "¥") return "¥";
  if (unit === "₹") return "₹";
  return undefined;
}

function isCurrencyUnit(unit: string | undefined): boolean {
  if (!unit) return false;
  return CURRENCY_SYMBOLS.has(unit) || unit === "GBP" || unit === "USD" || unit === "EUR";
}

// ============================================================================
// Number Formatting
// ============================================================================

/**
 * Format a currency amount with magnitude shorthand.
 * - 1,000 → "1k"      - 1,500 → "1.5k"
 * - 1,000,000 → "1m"  - 1,250,000 → "1.25m"
 * - 5,000,000,000 → "5b"   - 5e12 → "5t"
 * - < 1,000 → integer or 1 d.p.
 * Handles negative values: -500000 → "-500k".
 *
 * ⚠ THE LADDER USED TO BE TWO HAND-WRITTEN RUNGS AND IT STOPPED AT 1e6
 * (ROADMAP 2.322), so a value the parsers happily read as five TRILLION came
 * back out as `"$5000000m"`. Not untruthful — the digits were right — but a
 * formatter that cannot spell a magnitude its own parser accepts is the same
 * list-drift defect wearing a cosmetic mask, and the rung added to the
 * alphabet would never have reached it.
 *
 * The rungs are now DERIVED from the shared alphabet (descending, each with
 * the shortest key that spells its multiplier), so parse and print cannot
 * disagree about which magnitudes exist.
 *
 * PRECISION IS PRESERVED PER RUNG, deliberately and not incidentally: the
 * pre-2.322 code showed 2 d.p. above a million and 1 d.p. below it, and those
 * two spellings are pinned in the suite. The rule generalises as "the
 * thousands rung shows 1 d.p., every larger rung shows 2" rather than being
 * flattened to one precision, because flattening would have been a silent
 * display change smuggled in under a magnitude repair.
 */
function formatCurrencyAmount(amount: number): string {
  const sign = amount < 0 ? "-" : "";
  const abs = Math.abs(amount);
  for (const [multiplier, suffix] of MAGNITUDE_DISPLAY_LADDER) {
    if (abs < multiplier) continue;
    const scaled = abs / multiplier;
    const decimals = multiplier === 1e3 ? 1 : 2;
    return `${sign}${scaled % 1 === 0 ? `${scaled}${suffix}` : `${parseFloat(scaled.toFixed(decimals))}${suffix}`}`;
  }
  // Sub-thousand: show as integer or 1 d.p. if non-integer
  return abs % 1 === 0 ? `${sign}${abs}` : `${sign}${parseFloat(abs.toFixed(1))}`;
}

/**
 * Format a plain number with locale-style thousands separator (no currency
 * prefix). Rounds to at most 2 decimal places.
 */
function formatPlainNumber(n: number): string {
  if (Math.abs(n) >= 1_000) {
    // Whole number with thousands separators
    return n.toLocaleString("en-GB", { maximumFractionDigits: 2 });
  }
  // Small number — preserve meaningful precision, strip trailing zeros
  return String(parseFloat(n.toFixed(2)));
}

// ============================================================================
// Qualitative Band
// ============================================================================

/**
 * Map a normalised value (0–1) to a qualitative band label (title case).
 * Bands: 0–0.25 = Low, 0.25–0.5 = Moderate, 0.5–0.75 = High, 0.75–1 = Very high.
 *
 * Exported so orchestrator surfaces (response composer, chip engine) can
 * render a qualitative label for unitless 0–1 factors without reimplementing
 * the banding rule. Callers that want sentence case should call `.toLowerCase()`
 * on the result.
 */
export function qualitativeBand(value: number): string {
  if (value <= 0.25) return "Low";
  if (value <= 0.5) return "Moderate";
  if (value <= 0.75) return "High";
  return "Very high";
}

// ============================================================================
// synthesiseDisplayValue
// ============================================================================

/**
 * Synthesise a human-readable display string for a factor's current value.
 *
 * Priority order (first that produces a result wins):
 * 1. `raw_value` + currency `unit`  → `"£500k"`, `"$2.1m"`
 * 2. `raw_value` + percentage `unit` → `"3%"`
 * 3. `raw_value` + time `unit`       → `"42 days"`, `"18 months"`
 * 4. `raw_value` only                → `"500,000"` (thousands-separated)
 * 5. normalised `value` (0–1) + `factor_type` → `"Low (0.15)"` (qualitative band)
 * 6. normalised `value` only         → `"0.15"` (last resort)
 *
 * Returns `undefined` when there is no usable input.
 * Caps the output at 50 characters.
 *
 * @param data - Numeric factor data available at enrichment time
 * @returns Human-readable display string, or `undefined` if no data available
 */
export function synthesiseDisplayValue(data: DisplayValueInput): string | undefined {
  const { value, raw_value: rawValue, unit, factor_type: factorType } = data;

  let result: string | undefined;

  // ── Priority 1–4: raw_value is available ─────────────────────────────────
  if (rawValue !== undefined && typeof rawValue === "number" && !Number.isNaN(rawValue)) {
    const prefix = unit ? currencyPrefix(unit) : undefined;

    if (prefix) {
      // Priority 1: currency
      result = `${prefix}${formatCurrencyAmount(rawValue)}`;
    } else if (unit === "%") {
      // Priority 2: percentage — raw_value is already the display percentage
      const pct = parseFloat(rawValue.toFixed(2));
      result = `${pct}%`;
    } else if (unit && /^(?:days?|weeks?|months?|years?|hrs?|hours?)$/i.test(unit)) {
      // Priority 3: time unit
      const rounded = parseFloat(rawValue.toFixed(1));
      const display = rounded % 1 === 0 ? String(rounded | 0) : String(rounded);
      result = `${display} ${unit.toLowerCase()}`;
    } else if (unit) {
      // Other explicit unit
      const display = formatPlainNumber(rawValue);
      result = `${display} ${unit}`;
    } else {
      // Priority 4: no unit — plain number with thousands separators
      result = formatPlainNumber(rawValue);
    }
  }

  // ── Priority 5–7: fall back to normalised value ───────────────────────────
  if (result === undefined && value !== undefined && typeof value === "number" && !Number.isNaN(value)) {
    // Check for percentage unit with normalised value (e.g. value=0.03, unit="%")
    if (unit === "%") {
      // Normalised percentage: multiply by 100 if ≤ 1
      const pct = value <= 1 ? parseFloat((value * 100).toFixed(2)) : parseFloat(value.toFixed(2));
      result = `${pct}%`;
    } else if (unit) {
      // Priority 5: value with unit (e.g. "6 developers", "18 months").
      // Covers cases where data.value holds a raw count/quantity rather than
      // a 0-1 normalised score, and raw_value was not separately populated.
      const display = formatPlainNumber(value);
      result = `${display} ${unit}`;
    } else if (factorType) {
      // Priority 6: qualitative band from factor_type
      const band = qualitativeBand(Math.min(1, Math.max(0, value)));
      const displayValue = parseFloat(value.toFixed(2));
      result = `${band} (${displayValue})`;
    } else {
      // Priority 7: bare normalised value
      result = String(parseFloat(value.toFixed(2)));
    }
  }

  if (result === undefined) return undefined;

  // Cap at 50 characters
  return result.length > 50 ? result.slice(0, 50) : result;
}

// ============================================================================
// synthesiseRangeDisplayValue
// ============================================================================

/**
 * Synthesise a human-readable range string for an external factor's prior
 * distribution (e.g. `"£200k to £500k"`, `"10% to 25%"`, `"Up to £500k"`).
 *
 * Uses the same formatting conventions as `synthesiseDisplayValue` for each
 * individual bound.
 *
 * Fallbacks:
 * - Both bounds available → `"£200k to £500k"`
 * - Only `range_max`      → `"Up to £500k"`
 * - Only `range_min`      → `"At least £200k"`
 * - Neither bound but `distribution` present → `"Estimated (uncertain)"`
 * - No usable data         → `undefined`
 *
 * @param prior - Prior distribution data from the external factor node
 * @param unit - Unit string from the factor node
 * @param factorType - Factor type classification
 * @returns Human-readable range string, or `undefined` if no data available
 */
/**
 * The display multiplier a DECLARED scale licenses for a '%' unit, or
 * `undefined` where the scale is UNDECLARED and the caller must fall back.
 *
 * ⚠ THE VOCABULARY AND THE BOUNDS ARE THE CONTRACT'S, NOT THIS MODULE'S.
 * `@talchain/schemas` `graph.ts` exports
 * `DeclaredScale = z.enum(['unit_interval', 'ratio', 'raw_count'])` and defines
 * each member in its own doc block. Quoted, because these three lines are the
 * whole justification for the mapping below:
 *
 *   * `unit_interval` — "a proportion or a cap-normalised magnitude.
 *     Admissible [0, 1]" ("3% churn -> value 0.03").        -> x100
 *   * `ratio` — "a ratio that can meaningfully exceed 100% (NRR, growth, ROI).
 *     Admissible [0, +inf); 1.0 is parity."                  -> x100
 *   * `raw_count` — "a magnitude left un-normalised in `unit`.
 *     Admissible [0, +inf)."                                 -> x1
 *
 * So `unit_interval` and `ratio` share a multiplier and differ only in their
 * ADMISSIBLE DOMAIN — which is the authority check's business, not display's.
 * `raw_count` is the only member already on the display scale.
 *
 * ⚠ ABSENCE IS NOT A VALUE, AND THE CONTRACT SAYS SO IN TERMS: *"A consumer
 * MUST NOT treat absence as `unit_interval`: that is the unsound guess 2.193
 * exists to retire, and it would refuse legal values on stored graphs."*
 * An unrecognised member is treated the same way — a future contract addition
 * must degrade to today's behaviour, never be coerced into one of these arms.
 */
function percentMultiplierFromDeclaredScale(declaredScale?: string): number | undefined {
  switch (declaredScale) {
    case "unit_interval":
    case "ratio":
      return 100;
    case "raw_count":
      return 1;
    default:
      return undefined;
  }
}

export function synthesiseRangeDisplayValue(
  prior: RangeDisplayValueInput,
  unit?: string,
  _factorType?: string,
  declaredScale?: string,
): string | undefined {
  const { range_min: rangeMin, range_max: rangeMax, distribution } = prior;

  const hasMin = rangeMin !== undefined && typeof rangeMin === "number" && !Number.isNaN(rangeMin);
  const hasMax = rangeMax !== undefined && typeof rangeMax === "number" && !Number.isNaN(rangeMax);

  if (!hasMin && !hasMax) {
    // Fallback: distribution type present
    if (distribution) return "Estimated (uncertain)";
    return undefined;
  }

  // DGAI #342(2): a range that spans the FULL normalised domain is not an
  // estimate — it is the domain itself (typically a defaulted prior on a
  // factor drafted with no observed value). Rendering it produced
  // "Range: 0 to 1" as the factor's VALUE line on the canvas card — raw
  // internals presented as if a value had been set. Return undefined so the
  // caller omits display_value (the honest "no value set yet" state).
  // Applies to unitless bounds at 0..1 and percentage bounds at 0..1 /
  // 0..100 (both render as "0% to 100%"), including the one-sided
  // "Up to 1" / "At least 0" degenerate forms. Real-world units (currency,
  // time, counts) are untouched — a 0..1 range there is a genuine quantity.
  const isDomainScale = !unit || unit === "%";
  if (isDomainScale) {
    const domainMax = unit === "%" && ((hasMax && rangeMax! > 1) || (hasMin && rangeMin! > 1))
      ? 100
      : 1;
    const minIsDomainEdge = !hasMin || rangeMin === 0;
    const maxIsDomainEdge = !hasMax || rangeMax === domainMax;
    if (minIsDomainEdge && maxIsDomainEdge) return undefined;
  }

  // ⭐⭐ ROW 2.1207 — A CURRENCY SIGN IS A CLAIM ABOUT SCALE, AND IT WAS BEING
  // MADE ABOUT NORMALISED BOUNDS.
  //
  // MEASURED on deployed staging (closing witness 14 Aug, capture
  // `captures-run/captures/P3/committed-graph.json`, node `19d5a529`): against a
  // brief stating **£120,000**, `Annual Support Cost` shipped
  //
  //     prior: { range_min: 0.21, range_max: 0.63 }  →  display_value "£0.2 to £0.6"
  //
  // — a normalised 0–1 prior wearing a pound sign, six orders of magnitude out,
  // on a node that also claimed the number came from the brief.
  //
  // ── THE ASYMMETRY WAS INSIDE THIS FUNCTION, IN ITS OWN WORDS ──────────────
  // `formatBound` below says of the percent branch: *"range_min/range_max are
  // normalised (0–1) values; multiply by 100 for display."* So the module
  // already knows what scale a prior bound is on — and compensated for it on
  // ONE of the two scaled units. Currency got the raw number with a symbol
  // glued to the front.
  //
  // ── AND THE GUARD ABOVE ASSERTS THE OPPOSITE AS FACT ──────────────────────
  // *"Real-world units (currency, time, counts) are untouched — a 0..1 range
  // there is a genuine quantity."* The capture refutes exactly that sentence.
  // It is true of time and counts, where a prior is authored on the real scale;
  // it is false of currency, which the pipeline NORMALISES (`computeNormalisationCap`,
  // `raw_value`, `cap`) precisely because currency magnitudes are unbounded.
  //
  // ── WHAT IS CLAIMED, AND WHAT IS NOT ──────────────────────────────────────
  // Currency-scale evidence is a bound OUTSIDE the normalised magnitude domain.
  // Inside it, this function cannot tell a normalised prior from a genuine
  // sub-unit price, and it does not guess: it declines to render, which is the
  // behaviour the domain-edge guard directly above already ships for the
  // sibling case (DGAI #342(2)). The caller omits `display_value` and the node
  // reads as "no value set yet" — the honest state.
  //
  // Two opposite harms, and they are not symmetric (trap 22b):
  //   • rendering it  → a LIE about a number the user never wrote;
  //   • declining it  → a genuine sub-£1 range loses its display, a DEGRADATION,
  //     and one bounded by the fact that a real currency quantity that has been
  //     normalised carries `raw_value`/`cap` and reaches `synthesiseDisplayValue`
  //     (the point-estimate path), which gates its currency prefix on `raw_value`
  //     for this very reason. This branch only ever sees the un-raw case.
  //
  // ⚠ MAGNITUDE, NOT SIGN. The schema admits a negative bound (`z.number()`,
  // unbounded), and a predicate written as `<= 1` would pass `-0.4` straight
  // through to `£-0.4` — the sign-asymmetry that cost CEE #891 a 100,000x
  // suppression. The test is on |value|.
  if (isCurrencyUnit(unit)) {
    const withinNormalisedDomain =
      (!hasMin || Math.abs(rangeMin!) <= 1) && (!hasMax || Math.abs(rangeMax!) <= 1);
    if (withinNormalisedDomain) return undefined;
  }

  // ⭐⭐ THE PERCENT SCALE IS ONE DECISION FOR THE PAIR, NOT ONE PER BOUND —
  // AND WHERE THE PAIR CANNOT DECIDE, IT IS DECLINED.
  //
  // `formatBound` below used to sniff the scale PER BOUND
  // (`n >= 0 && n <= 1 ? n * 100 : n`). The two bounds of one range come from
  // ONE producer on ONE scale, so a pair that spans the boundary was rendered
  // under TWO DIFFERENT CONVENTIONS: `[0.56, 1.68]` became "56% to 1.68%" —
  // the first bound multiplied, the second not.
  // `unified-pipeline/stages/repair/unreachable-factors.ts:549-552` records
  // that exact output and calls it "replacing a silent omission with a
  // confidently wrong number". `[1, 25]` was worse still: "100% to 25%", a
  // range whose lower bound reads HIGHER than its upper.
  //
  // ⚠⚠ BUT THE HEADLINE CAPTURE IS ALREADY MITIGATED PRODUCER-SIDE, AND AN
  // EARLIER VERSION OF THIS COMMENT PRESENTED IT AS LIVE. CORRECTED IN PLACE
  // RATHER THAN DELETED, because the cited capture is real and the inference
  // drawn from it was not. Derived at the bytes:
  //
  //   `synthesisePriorFromBaseline(1.12)` sits on a factor whose value is 1.12
  //   with `unit === '%'`, and `declaredScaleOf` (`unreachable-factors.ts:326`)
  //   returns `"ratio"` for exactly that shape (`unit === "%" && value > 1`).
  //   `:589` then sets `withholdUnit = scale === "ratio"` and does NOT stamp
  //   `node.unit`, so the FIRST arm of `schema-v3.ts:508`
  //   (`anyNode.unit ?? node.data.unit`) is undefined.
  //
  //   The SECOND arm needs `node.data` to be gone, and it usually is: `:457`
  //   has already run `delete data.value`, so `hasValue` at `:611` is false and
  //   `:622` deletes `node.data`.
  //
  // ⚠ BUT THAT DELETION IS CONDITIONAL, AND THE CONDITION IS NAMED HERE RATHER
  // THAN FLATTENED — the gate at `:612` requires `!hasInterventions &&
  // !hasOperator && !hasValue`. A reclassified factor that still carries a string
  // `data.operator`, or a non-empty `data.interventions`, KEEPS its `data`, and
  // `node.data.unit` then feeds `priorUnit` even though the node-level unit was
  // withheld. On that path the '%' gate below CAN fire on a ratio-scale prior.
  //
  // So the precise statement is: "56% to 1.68%" is not reachable through the
  // ORDINARY repair path that produced the capture — a simple reclassified
  // factor loses both arms — and this block cannot be credited with closing
  // that case. It IS still the guard for the operator/interventions-bearing
  // variant, where the withholding is defeated by the surviving `data`.
  //
  // ⭐ WHAT THIS BLOCK GENUINELY CLOSES, stated narrowly so the next reader
  // inherits the true scope: the pairs that arrive with a '%' unit INTACT —
  // i.e. anything the repair stage did not classify as ratio, and every
  // MODEL-AUTHORED external factor, for which no producer stamps a scale at
  // all. `[1, 25]` is the live member of that class, and it is why the
  // undeclared limb below still earns its place.
  //
  // That output is wrong under EVERY reading. Under the multiplier convention
  // the pair is 56%–168%; under percentage-points it is 0.56%–1.68%. It is
  // never "56% to 1.68%".
  //
  // ── WHY DECLINE RATHER THAN PICK A CONVENTION ────────────────────────────
  // Which convention a straddling pair is on is NOT derivable here. The draft
  // prompt's SCALE_DISCIPLINE asks the model "can this metric meaningfully
  // exceed 100%?" and the answer survives only implicitly, in how it scaled
  // `value`, then is discarded; the shared contract's own ruling (ROADMAP
  // 2.193 / the #766 review) is that no classifier can be built from the value
  // alone — a `0` or a `1` is a legal raw count AND a legal proportion.
  //
  // So this follows the precedent THIS FUNCTION ALREADY SHIPS one block up:
  // row 2.1207's currency limb declines inside the normalised domain rather
  // than guess. The caller omits `display_value` and the node reads "no value
  // set yet" — the honest state. Rendering it is a LIE about a number the user
  // never wrote; declining it is a DEGRADATION the receipt already discloses.
  //
  // ⚠ MAGNITUDE, NOT SIGN — same reasoning as the currency limb above. A
  // predicate written `<= 1` passes `-0.4` straight through, the sign
  // asymmetry that cost CEE #891 a 100,000x suppression.
  //
  // ⚠ SCOPED TO THE PERCENT LIMB. Currency keeps its own ratified rule; time
  // and unitless ranges are authored on the real scale and have no competing
  // convention, so a 0.5-to-8 span there is a genuine quantity, not a straddle.
  let percentMultiplier = 1;
  if (unit === "%") {
    // ⭐⭐ THE PRODUCER'S ANSWER OUTRANKS THE SNIFF — READ IT FIRST.
    //
    // Everything below this block infers a scale from MAGNITUDE. That is a
    // CLASSIFIER, and the estate already has one for this exact concept:
    // `unified-pipeline/stages/repair/unreachable-factors.ts:540-542` stamps
    // `node.declared_scale` via `declaredScaleOf`, and its own comment at `:555`
    // states the ruling verbatim — *"the producer-side answer is
    // `declared_scale` above"*. `transforms/schema-v3.ts:508` reads
    // `anyNode.unit` off THE SAME OBJECT, so the answer was sitting one
    // property away from the input this function was guessing from.
    //
    // ⭐ Minting a second CLASSIFIER leaves no new NAME behind, so a name sweep
    // never finds it — which is precisely why this one survived review. It is
    // the differently-named-twins defect one level down, and the fix is to
    // CONSUME the declaration rather than to compete with it.
    //
    // ── ⛔ DELETION CONDITION (this is a compatibility branch, and it is dated)
    // The `else` limb below exists ONLY because `declared_scale` is stamped by
    // the repair stage and NOT by the draft/edit transform, so a model-authored
    // factor carrying a prior arrives UNDECLARED. WHEN THE MODEL-AUTHORED
    // PRODUCER STAMPS `declared_scale` — the contract names CEE's
    // "draft/edit transform that already applies SCALE_DISCIPLINE" as the
    // producer — THE ENTIRE `else` BRANCH IS DELETED, NOT EXTENDED, and this
    // function keeps only the declaration read. A percent range that is still
    // undeclared at that point is a PRODUCER defect to fix upstream, never a
    // reason to keep a magnitude sniff alive down here.
    //
    // ⚠ ABSENCE MUST NOT DEFAULT. The contract's failure semantics are explicit
    // that a consumer may not read absence as `unit_interval`; that is why the
    // helper returns `undefined` rather than a multiplier, and why the fallback
    // is the pre-existing behaviour rather than a guess.
    // ⚠⚠ THE ONE ASSUMPTION THIS READ RESTS ON, STATED AND VERIFIED RATHER THAN
    // LEFT IMPLICIT — because it is the "two concepts under similar names" trap.
    //
    // `declared_scale` is declared ABOUT THE FACTOR'S OBSERVED VALUE
    // (`declaredScaleOf(originalValue, ...)`, `unreachable-factors.ts:540`),
    // and it is being consumed here FOR THE PRIOR'S BOUNDS. Those are two
    // different fields, and if they could sit on different scales this read
    // would produce confident wrongness — the exact failure it exists to stop.
    //
    // They cannot, on the path where the declaration exists. Verified at the
    // bytes: the same stage synthesises the prior FROM THAT SAME VALUE —
    // `synthesisePriorFromBaseline(originalValue)` at `:690`, the identical
    // `originalValue` passed to `declaredScaleOf` at `:540`. That function's
    // own branches are even labelled in the contract's vocabulary: "RATIO
    // SCALE" for `value > 1` (no upper clamp) and "UNIT INTERVAL" for
    // `value <= 1`. So bounds and declaration share a scale BY CONSTRUCTION.
    //
    // (Worked example, and it is the PR's headline pair: value 1.12 -> ratio;
    // margin = max(0.1, 0.56) = 0.56 -> prior [0.56, 1.68].)
    //
    // ⛔ THE STANDING CONDITION THIS PUTS ON FUTURE WORK: if any producer ever
    // stamps `declared_scale` WITHOUT deriving the prior from the same value,
    // this read must be re-verified before it is trusted — the declaration
    // would then be describing a different number than the one being rendered.
    const declaredMultiplier = percentMultiplierFromDeclaredScale(declaredScale);
    if (declaredMultiplier !== undefined) {
      // DECLARED: the pair is decided, so a straddle is no longer undecidable
      // and must NOT be declined — declining a decided pair is the gap-harm.
      percentMultiplier = declaredMultiplier;
    } else {
      const magnitudes: number[] = [];
      // ⭐ A BOUND OF ZERO IS SCALE-INVARIANT AND MUST NOT VOTE ON THE SCALE.
      // `0 * 100 === 0`, so a zero bound renders identically under BOTH
      // conventions and carries no evidence about which one the pair is on.
      // Counting it as "within the unit interval" made every `[0, N>1]` percent
      // range a FALSE STRADDLE: `[0, 25]` — unambiguously "0% to 25%" under
      // either reading — silently lost its `display_value`. Measured against the
      // merge base 7401725f: base rendered "0% to 25%", "0% to 75%" and
      // "25% to 0%"; head rendered nothing for all three.
      //
      // ⚠ This is the SECOND harm of the pair this function is about, and the two
      // cannot share one window: a mis-scaled number is a LIE, a silently missing
      // display is a GAP. Fixing the lie by widening the decline traded one for
      // the other, and the author suite could not see it because every case it
      // added pointed at the lie.
      //
      // Both-zero is unaffected: `magnitudes` is then empty, `every()` is
      // vacuously true, the pair is not a straddle, and `[0, 0]` renders "0% to
      // 0%" exactly as the base did.
      if (hasMin && rangeMin !== 0) magnitudes.push(Math.abs(rangeMin!));
      if (hasMax && rangeMax !== 0) magnitudes.push(Math.abs(rangeMax!));
      const allWithinUnitInterval = magnitudes.every((m) => m <= 1);
      const allOutsideUnitInterval = magnitudes.every((m) => m > 1);
      // A single bound can never straddle: it is trivially all-within or
      // all-outside, so the one-bound forms keep rendering exactly as before.
      if (!allWithinUnitInterval && !allOutsideUnitInterval) return undefined;
      percentMultiplier = allWithinUnitInterval ? 100 : 1;
    }
  }

  /**
   * Format a single bound using the same logic as synthesiseDisplayValue
   * (currency prefix, % multiply, time unit, plain number).
   */
  function formatBound(n: number): string {
    const prefix = unit ? currencyPrefix(unit) : undefined;
    if (prefix) return `${prefix}${formatCurrencyAmount(n)}`;
    if (unit === "%") {
      // Scale decided ONCE for the pair above — never re-sniffed here, because
      // a per-bound decision is what produced "56% to 1.68%".
      const pct = parseFloat((n * percentMultiplier).toFixed(2));
      return `${pct}%`;
    }
    if (unit && /^(?:days?|weeks?|months?|years?|hrs?|hours?)$/i.test(unit)) {
      const rounded = parseFloat(n.toFixed(1));
      const display = rounded % 1 === 0 ? String(rounded | 0) : String(rounded);
      return `${display} ${unit.toLowerCase()}`;
    }
    if (unit) return `${formatPlainNumber(n)} ${unit}`;
    return formatPlainNumber(n);
  }

  let result: string;

  if (hasMin && hasMax) {
    // For time and plain-number units, format as "3 to 8 months" (unit once at end)
    // rather than "3 months to 8 months". Currency and % are prefix/suffix per-bound
    // so they always display both (e.g. "£200k to £500k", "10% to 25%").
    const isUnitPerBound = !unit || isCurrencyUnit(unit) || unit === "%";
    if (isUnitPerBound) {
      result = `${formatBound(rangeMin!)} to ${formatBound(rangeMax!)}`;
    } else {
      // Time and other suffix units: format number only for min, full for max
      const minNumeric = formatPlainNumber(rangeMin!);
      result = `${minNumeric} to ${formatBound(rangeMax!)}`;
    }
  } else if (hasMax) {
    result = `Up to ${formatBound(rangeMax!)}`;
  } else {
    result = `At least ${formatBound(rangeMin!)}`;
  }

  // Cap at 50 characters
  return result.length > 50 ? result.slice(0, 50) : result;
}
