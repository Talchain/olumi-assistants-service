/**
 * ROADMAP 2.159 — the factor's MODEL SCALE, made explicit.
 *
 * ⚠ THE DEFECT THIS CLOSES (Codex P1, live-proven 31 Jul 2026). Editing a
 * normalised `[0,1]` factor to `1.5` was ACCEPTED and PERSISTED end-to-end.
 * The chain: `normaliseFactorValue` writes `value = raw_value = rawInput`
 * verbatim when no `cap` is present (`normalise-factor-value.ts:121-123`),
 * and the range guard in `evaluateFactorValueProposal` runs ONLY inside
 * `if (cap !== undefined)` (`evaluate-factor-value-proposal.ts` §6). So
 * "uncapped" was silently read as "unbounded" — including for factors whose
 * declared model scale IS the unit interval.
 *
 * ⚠ THERE IS NO SCALE FIELD. Derived at the bytes at CEE `63e67ceb`:
 * `ObservedStateV3` (`schemas/cee-v3.ts:52`) declares
 * `value/baseline/unit/source/raw_value/cap/extractionType/factor_type/
 * uncertainty_drivers` and nothing else; the boundary `observed_state` in
 * `@talchain/schemas@0.30.0` declares only `{value, std?, baseline?, unit?,
 * source?}` (`cap` survives on passthrough alone); the wire event
 * `factor_value_edit` is `.strict()` and carries no bounds. `set-factor-value.ts`
 * states the posture outright: "factor values are contract-silent on range (no
 * bound invented)".
 *
 * So the scale is a CONVENTION, and this module makes it a derivation instead
 * of an assumption. Deriving (rather than minting a persisted `scale` field) is
 * deliberate and load-bearing: **the bound must apply to graphs drafted BEFORE
 * this change** — every scenario already in the store, including the one the
 * live probe hit. A minted field would bound only future graphs and would leave
 * the reported defect live everywhere it was actually observed.
 *
 * The derivation reads ONLY fields the estate already declares, and its rules
 * are each anchored to an existing, independent statement of the same
 * convention:
 *
 *   • `cap` present         → `capped`. `value = raw/cap`; the EXISTING
 *                             cap-range guard already bounds it. Unchanged.
 *   • `unit` present        → `unbounded`. A unit-bearing uncapped factor holds
 *                             a raw user-unit magnitude (£, months, engineers),
 *                             never a `[0,1]` model proportion — and the
 *                             `%`-unit case is genuinely ambiguous by the
 *                             prompt's own rules (a bounded percentage is 0-1,
 *                             but NRR/growth/ROI "can meaningfully exceed 100%"
 *                             and are explicitly NOT normalised —
 *                             `prompts/defaults-v187.ts:402-411`). We do not
 *                             guess: behaviour here is byte-identical to today.
 *   • `raw_value` present
 *     and ≠ `value`         → `unbounded`. An uncapped factor stores raw and
 *                             model identically; a pair that disagrees is an
 *                             off-contract graph whose scale provenance is
 *                             unknown. Refuse to guess — same fail-open-to-today
 *                             posture as `resolveExistingRawValue`'s
 *                             `ambiguous`.
 *   • no cap, no unit,
 *     `value` ∈ [0,1]       → `unit_interval`. This is the class the estate
 *                             ALREADY names and ALREADY treats as normalised:
 *                             `graph-data-integrity.ts:129` ("No raw_value or
 *                             no cap → qualitative 0-1 factor"),
 *                             `:252` ("clamp corrected interventions to [0,1]
 *                             since factor values are normalised"),
 *                             `unreachable-factors.ts:122` ("priors are on a
 *                             normalised scale"), `format-factor-value.ts:197`
 *                             ("a bare fractional value … would read as a raw
 *                             normalised decimal"). It is produced by five
 *                             prompt rules: inferred baseline `0.5`, binary
 *                             `0/1`, one-hot indicators, ordinal `0-1`, and the
 *                             qualitative `Low=0.2/Medium=0.5/High=0.8` scale.
 *   • anything else         → `unbounded`. Notably a unitless uncapped factor
 *                             already sitting OUTSIDE [0,1] — the prompt's
 *                             "Small count (0-10) → raw integer" class
 *                             (`defaults-v187.ts:301`) — keeps today's
 *                             behaviour exactly. A count factor is never
 *                             newly refused unless it currently reads as a
 *                             proportion, in which case the estate's own
 *                             integrity pass already calls it one.
 *
 * ⚠ THE BOUND IS DERIVED, NEVER PERSISTED. This module must not cause a `cap`
 * (or any other field) to be written onto `observed_state`. Synthesising
 * `cap: 1` to reuse the cap-range guard was considered and REJECTED: the
 * handler persists `after.cap` (`set-factor-value.ts:359-363`), so a synthetic
 * cap would become a real, permanent scale declaration the user never made,
 * would trip the consented-cap-change machinery, and would make the
 * "extend the scale" chip offer to raise a proportion's ceiling above 1.
 */

/**
 * A factor's declared model scale.
 *
 * `unit_interval` carries no numbers because the bound is fixed by the
 * convention it derives from — see {@link NORMALISED_FACTOR_MIN} /
 * {@link NORMALISED_FACTOR_MAX}. Making it a bare tag (rather than
 * `{min, max}`) keeps this from drifting into a general per-factor range
 * mechanism, which is out of scope and would need a contract field.
 */
export type FactorScale =
  | { readonly kind: 'capped'; readonly cap: number }
  | { readonly kind: 'unit_interval' }
  | { readonly kind: 'unbounded' };

/** Lower bound of the normalised model scale. */
export const NORMALISED_FACTOR_MIN = 0;
/** Upper bound of the normalised model scale. */
export const NORMALISED_FACTOR_MAX = 1;

/**
 * The `observed_state` fields the derivation reads. Structurally identical to
 * the validator's `FactorObservedStateSnapshot` and the handler's
 * `ObservedSnapshot`, so all three call sites can pass what they already hold
 * without a projection step (a projection is exactly where a mirror drifts).
 */
export interface FactorScaleSnapshot {
  readonly value?: number;
  readonly raw_value?: number;
  readonly unit?: string;
  readonly cap?: number;
}

/**
 * Derive a factor's model scale from its declared `observed_state`.
 *
 * Pure and total. Fails toward `unbounded` — i.e. toward TODAY'S behaviour —
 * in every case the declaration does not settle, so this can only ever refuse
 * an edit that the estate's own convention already says is out of scale.
 */
export function resolveFactorScale(snapshot: FactorScaleSnapshot): FactorScale {
  const { value, raw_value, unit, cap } = snapshot;

  // A cap IS the scale declaration. `value = raw/cap`, and the existing
  // cap-range guard bounds `raw` to [0, cap]. Nothing here changes it.
  // A non-positive / non-finite cap is rejected separately by
  // `cap_non_positive`; treat it as capped so this module never changes which
  // rejection the user sees.
  if (cap !== undefined) return { kind: 'capped', cap };

  // A unit means a raw user-unit magnitude, not a model proportion. Includes
  // the deliberately-unresolved `%` case (bounded percentage vs NRR-style
  // ratio). No change to today.
  if (unit !== undefined && unit.length > 0) return { kind: 'unbounded' };

  // Uncapped stores raw and model identically. A disagreeing pair is
  // off-contract and its scale provenance is unknown — do not guess.
  if (raw_value !== undefined && raw_value !== value) return { kind: 'unbounded' };

  if (
    value !== undefined &&
    Number.isFinite(value) &&
    value >= NORMALISED_FACTOR_MIN &&
    value <= NORMALISED_FACTOR_MAX
  ) {
    return { kind: 'unit_interval' };
  }

  return { kind: 'unbounded' };
}
