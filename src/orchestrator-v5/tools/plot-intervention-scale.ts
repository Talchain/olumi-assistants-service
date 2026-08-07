/**
 * CEE → PLoT intervention value-scale protection (Tier 0, Phase 1 — egress net).
 *
 * Background
 * ----------
 * CEE has historically stored/projected numeric intervention `value` on a
 * normalised `[0,1]` convention (see the draft/edit prompt `SCALE_DISCIPLINE`
 * and `cee-v3.ts` `InterventionV3`). PLoT expects intervention input `value` to
 * be **raw user-scale** and normalises internally using the target factor
 * node's `observed_state.cap`. Forwarding CEE's normalised `0.25` where PLoT
 * expects `25000` therefore causes a *double normalisation* of capped
 * interventions.
 *
 * This was re-verified clean against the live PLoT staging head on 2026-06-18
 * (PLoT build `78aea76`): a direct, non-persisting probe confirmed `outcome` is
 * linear in `value / observed_state.cap` (`value=1` on a `cap=200` factor →
 * `outcome ≈ 0.004`, NOT saturated), `outcome ∝ 1/cap` (so normalisation uses
 * the node cap), and values clamp at `value = cap`. The earlier anchor (PLoT
 * `86038f1`) is unchanged.
 *
 * This module is the single, centralised, pure transformation that runs at the
 * `run_analysis` projection boundary (invoked from
 * `loadScenarioSnapshotForRunAnalysis` — UNCONDITIONAL since 2026-07-20,
 * O-7 wave 2: CEE_PLOT_EGRESS_SCALE_NET_ENABLED deleted). It converts the *outbound* PLoT
 * payload's intervention values to raw user-scale. It NEVER mutates persisted
 * graph state and does NOT touch PLoT's input contract — PLoT still owns final
 * normalisation, and the request shape stays the flat `{ factor_id: number }`
 * map.
 *
 * Scale rule (per numeric intervention) — evidence-gated, no silent corruption
 * ---------------------------------------------------------------------------
 *   1. If the intervention object carries a finite numeric `raw_value`, that IS
 *      the user-scale value — use it (`rule: 'raw_value_used'`). Deterministic
 *      conflict policy: `raw_value` is the explicit user-scale field (the
 *      prompt DERIVED-FIELD rule makes it the patch target / source of truth),
 *      so it WINS even if `value * cap` disagrees; a disagreement beyond
 *      tolerance is flagged `inconsistent` (the `inconsistent_scale` diagnostic
 *      category) — surfaced, never silently repaired.
 *   2. Else, if the value looks normalised (finite, in `[0,1]`), the factor has
 *      a finite positive `cap`, AND the target factor's own `observed_state`
 *      PROVES the normalised convention (`value ≈ raw_value / cap` on the
 *      factor), denormalise: `raw = value * cap` (`rule: 'cap_denormalised'`).
 *      This is "equivalent explicit scale evidence": multiplying by `cap` is
 *      the proven inverse of how that factor stores values.
 *   3. Else pass the value through UNCHANGED:
 *        - finite value `< 0` or `> 1` on a capped factor → already-raw-looking
 *          (`rule: 'passthrough'`) — the key guard that prevents a second
 *          multiplication once Phase 2 prompts emit raw values;
 *        - a `[0,1]` value on a capped factor WITHOUT factor-level evidence →
 *          `rule: 'ambiguous_no_evidence'`. We do NOT multiply on a bare
 *          convention: a genuine raw `[0,1]` value must not be silently
 *          rewritten. Surfaced (redacted) for the Phase-2 migration signal;
 *        - no usable cap → `rule: 'no_cap'`.
 *
 * Encoded categorical / boolean interventions are NEVER scaled — their `value`
 * is an encoded integer / `0|1` and must reach PLoT verbatim
 * (`rule: 'encoded_verbatim'`). Detection uses ROBUST evidence —
 * `value_type` of `categorical`/`boolean`, OR a present `encoding_map`, OR a
 * boolean `raw_value` — and deliberately NOT a bare string `raw_value`, which
 * is ambiguous (a numeric string like `"5000"` is a real magnitude, not an
 * encoding: it is parsed and used via rule 1). The evidence gate in rule 2 is a
 * further backstop — a boolean/categorical factor does not exhibit the
 * normalised-convention signature, so its interventions fall to passthrough.
 *
 * Double-conversion safety (Phase 2 transition)
 * ---------------------------------------------
 *   - Once prompts emit `value === raw_value`, rule 1 wins → never multiplied.
 *   - Once prompts emit raw values without `raw_value`, capped factors
 *     (currency/time/large quantities) carry values `> 1` → rule 3 passthrough.
 *   - A genuine raw `[0,1]` value on a capped factor is NOT multiplied (it
 *     fails the factor-evidence check) → passthrough, no corruption.
 */

/**
 * Factor scale descriptor extracted from a factor node's `observed_state`.
 * `cap` mirrors exactly the value PLoT reads (`observed_state.cap`) so CEE's
 * denormalisation is the precise inverse of PLoT's renormalisation.
 * `normalisedConvention` is the proof (computed in `buildFactorScaleMap`) that
 * the factor stores values as `value = raw_value / cap`; only then is rule 2
 * (`value * cap`) sound. `unit` is diagnostic-only and never affects the rule.
 */
export interface FactorScaleInfo {
  readonly cap?: number;
  readonly unit?: string;
  readonly normalisedConvention?: boolean;
}

/**
 * The conversion category a single intervention fell into. These mirror the
 * Tier 0 brief's diagnostic vocabulary (`inconsistent_scale` is tracked
 * separately on `InterventionScaleResult.inconsistent`, orthogonal to the rule).
 */
export type InterventionScaleRule =
  | 'raw_value_used' // used intervention.raw_value (explicit user-scale)
  | 'cap_denormalised' // value * cap, gated on proven factor normalisation
  | 'passthrough' // value < 0 or > 1 on a capped factor — already raw, sent verbatim
  | 'ambiguous_no_evidence' // [0,1] on a capped factor, no evidence — NOT multiplied
  | 'no_cap' // no usable cap — cannot denormalise, pass through
  | 'encoded_verbatim' // categorical/boolean encoded value preserved
  | 'dropped'; // no finite numeric value — excluded from the PLoT map

export interface InterventionScaleResult {
  /** Value to send to PLoT; `null` means exclude this factor from the map. */
  readonly value: number | null;
  /** Which branch of the scale rule fired (for tests + diagnostics). */
  readonly rule: InterventionScaleRule;
  /** The pre-transform numeric `value` seen (bare number or `.value`); `null` when dropped. */
  readonly inputValue: number | null;
  /**
   * The `inconsistent_scale` diagnostic flag: true when `rule ===
   * 'raw_value_used'` AND `raw_value` disagreed beyond tolerance with the
   * independent estimate — `value * cap` for a normalised-looking value
   * (`[0,1]`, cap present), or `value` itself for a raw-looking value (`>1`).
   */
  readonly inconsistent: boolean;
}

/**
 * Redaction-safe conversion record. Deliberately carries NO numeric magnitudes
 * (no input/output value, no cap) — only the factor id, the rule that fired,
 * and the inconsistency flag — so diagnostics built from it cannot leak
 * business magnitudes.
 */
export interface InterventionConversion {
  readonly factor_id: string;
  readonly rule: InterventionScaleRule;
  readonly inconsistent: boolean;
}

/** Relative tolerance for value/raw_value consistency checks (0.5%). */
const CONSISTENCY_REL_TOL = 0.005;

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b)) * CONSISTENCY_REL_TOL;
}

/**
 * Coerce a `raw_value` to a finite number, accepting a numeric value OR a
 * numeric string (e.g. `"5000"`). Returns `undefined` for non-numeric strings
 * (`"£5k"`, `"UK"`), booleans, or anything unparseable — those do NOT yield a
 * numeric raw user-scale value, so the caller falls through to factor evidence
 * rather than suppressing denormalisation.
 */
function coerceFiniteNumber(x: unknown): number | undefined {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined;
  if (typeof x === 'string') {
    const t = x.trim();
    if (t === '') return undefined;
    const n = Number(t);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Detect an encoded categorical/boolean intervention, where `value` is an
 * encoded integer / `0|1` that must NOT be scaled. Uses ROBUST evidence —
 * never a bare string `raw_value`, which is ambiguous (a numeric string like
 * `"5000"` is a real magnitude, not an encoding): an explicit
 * categorical/boolean `value_type`, OR a present `encoding_map`, OR a boolean
 * `raw_value` (an un-encoded flag). A non-numeric string `raw_value` is handled
 * downstream (it neither denormalises via raw_value nor suppresses the
 * factor-evidence path); the normalised-convention gate is the further backstop
 * for genuinely categorical factors (which never exhibit that signature).
 */
function isEncodedIntervention(obj: Record<string, unknown>): boolean {
  const vt = obj.value_type;
  if (vt === 'categorical' || vt === 'boolean') return true;
  if (obj.encoding_map !== null && typeof obj.encoding_map === 'object') return true;
  if (typeof obj.raw_value === 'boolean') return true;
  return false;
}

/**
 * Resolve the raw user-scale value PLoT should receive for one numeric
 * intervention. Pure — no logging, no graph mutation. See module header for
 * the rule and its double-conversion / no-silent-corruption properties.
 *
 * @param intervention the ORIGINAL intervention entry (object `{value, raw_value, ...}`
 *   or bare number), NOT the already-numeric-projected value.
 * @param factor the target factor's scale info, or `undefined` when unknown.
 */
export function resolveRawInterventionValue(
  intervention: unknown,
  factor: FactorScaleInfo | undefined,
): InterventionScaleResult {
  // Bare finite number (legacy flat intervention shape) → treat as numeric.
  if (isFiniteNumber(intervention)) {
    return scaleNumeric(intervention, undefined, factor);
  }
  // Mirror `extractNumericIntervention`'s notion of "object": any non-null
  // object (arrays included — they simply have no finite `.value`).
  if (intervention === null || typeof intervention !== 'object') {
    return { value: null, rule: 'dropped', inputValue: null, inconsistent: false };
  }
  const obj = intervention as Record<string, unknown>;
  const value = obj.value;
  // Membership gate — mirror `extractNumericIntervention`: an intervention is
  // present only when it has a finite numeric `value`. Anything else is
  // dropped exactly as the pre-existing numeric projection dropped it.
  if (!isFiniteNumber(value)) {
    return { value: null, rule: 'dropped', inputValue: null, inconsistent: false };
  }
  // Encoded categorical/boolean → preserve verbatim, never scale.
  if (isEncodedIntervention(obj)) {
    return { value, rule: 'encoded_verbatim', inputValue: value, inconsistent: false };
  }
  // Coerce raw_value to a number (accepts numeric strings like "5000"); a
  // non-numeric string falls through to the factor-evidence path.
  return scaleNumeric(value, coerceFiniteNumber(obj.raw_value), factor);
}

function scaleNumeric(
  value: number,
  rawValue: number | undefined,
  factor: FactorScaleInfo | undefined,
): InterventionScaleResult {
  const cap = factor?.cap;
  const capUsable = isFiniteNumber(cap) && cap > 0;

  // 1. Explicit numeric raw_value wins (deterministic conflict policy), but we
  //    flag disagreements for diagnostics:
  //      - normalised-looking value ([0,1]) with a cap → compare via value*cap;
  //      - raw-looking value (outside [0,1]) → both fields appear raw-scale,
  //        compare value vs raw_value directly (catches stale Phase-2 raws).
  if (rawValue !== undefined) {
    let inconsistent = false;
    if (value >= 0 && value <= 1) {
      if (capUsable) inconsistent = !approxEqual(value * cap, rawValue);
    } else {
      inconsistent = !approxEqual(value, rawValue);
    }
    return { value: rawValue, rule: 'raw_value_used', inputValue: value, inconsistent };
  }

  // 2/3. Cap-based handling requires a usable cap.
  if (!capUsable) {
    return { value, rule: 'no_cap', inputValue: value, inconsistent: false };
  }

  // Already-raw-looking (outside the unit interval) → pass through. This is the
  // guard that stops a second multiplication after Phase 2 prompt clean-up.
  if (value < 0 || value > 1) {
    return { value, rule: 'passthrough', inputValue: value, inconsistent: false };
  }

  // [0,1] on a capped factor: ONLY denormalise with proven factor evidence.
  if (factor?.normalisedConvention === true) {
    return { value: value * cap, rule: 'cap_denormalised', inputValue: value, inconsistent: false };
  }

  // [0,1] on a capped factor with no evidence → do NOT silently corrupt a
  // possibly-genuine raw value. Pass through; surface for the Phase-2 signal.
  return {
    value,
    rule: 'ambiguous_no_evidence',
    inputValue: value,
    inconsistent: false,
  };
}

/**
 * Legacy (scale-net OFF) per-entry numeric intervention projection — the
 * rule the pre-2026-07-20 OFF branch applied to configured options: a bare
 * finite number passes through; an object contributes its finite numeric
 * `.value`; anything else is dropped. The production loader path is now
 * always net-ON; this survives for the scaffold's pure-function OFF
 * convention (unit-tested) only. Lives in THIS module (the single home of both
 * outbound wire conventions) so every producer of PLoT intervention numbers
 * — the snapshot loader's sibling projection AND the D-ask-1 scaffold —
 * derives from the same function instead of mirroring it (P1-1: one scale
 * convention, not two).
 */
export function extractNumericInterventionValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const candidate = (value as Record<string, unknown>).value;
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

/**
 * Build a `factorId → FactorScaleInfo` map from graph nodes. Reads the factor
 * cap PLoT uses (`observed_state.cap`), with defensive fallbacks to alternate
 * persisted shapes (`data.cap`, top-level `cap`) — all representing the SAME
 * factor cap, never the intervention-level cap. Computes `normalisedConvention`
 * (the rule-2 evidence) by checking the factor's own `observed_state` is
 * self-consistent under `value = raw_value / cap`.
 */
export function buildFactorScaleMap(nodes: unknown): ReadonlyMap<string, FactorScaleInfo> {
  const map = new Map<string, FactorScaleInfo>();
  if (!Array.isArray(nodes)) return map;
  for (const n of nodes) {
    if (n === null || typeof n !== 'object') continue;
    const node = n as Record<string, unknown>;
    const id = node.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const observed =
      node.observed_state !== null && typeof node.observed_state === 'object'
        ? (node.observed_state as Record<string, unknown>)
        : undefined;
    const data =
      node.data !== null && typeof node.data === 'object'
        ? (node.data as Record<string, unknown>)
        : undefined;
    const cap = firstFiniteNumber(observed?.cap, data?.cap, node.cap);
    const unit = firstString(observed?.unit, data?.unit, node.unit);
    const baselineValue = firstFiniteNumber(observed?.value, data?.value);
    const baselineRaw = firstFiniteNumber(observed?.raw_value, data?.raw_value);
    // The factor PROVES the normalised convention when its own observed state is
    // a NON-ZERO, genuinely-downscaled point satisfying value ≈ raw_value / cap:
    //   - baselineValue ∈ (0, 1]  — zero is scale-ambiguous (0 == 0/anything),
    //     so a zero baseline carries no evidence and must NOT grant it;
    //   - baselineRaw > baselineValue — real downscaling occurred. Combined with
    //     value*cap ≈ raw this forces cap > 1, excluding the degenerate cap ≤ 1
    //     case where a genuine raw [0,1] value could be falsely "denormalised".
    const normalisedConvention =
      cap !== undefined &&
      cap > 0 &&
      baselineValue !== undefined &&
      baselineValue > 0 &&
      baselineValue <= 1 &&
      baselineRaw !== undefined &&
      baselineRaw > baselineValue &&
      approxEqual(baselineValue * cap, baselineRaw);
    const info: FactorScaleInfo = {
      ...(cap !== undefined ? { cap } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(normalisedConvention ? { normalisedConvention: true } : {}),
    };
    map.set(id, info);
  }
  return map;
}

function firstFiniteNumber(...candidates: unknown[]): number | undefined {
  for (const c of candidates) {
    if (isFiniteNumber(c)) return c;
  }
  return undefined;
}

function firstString(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.length > 0) return c;
  }
  return undefined;
}

/**
 * Project a node's ORIGINAL intervention objects (factorId → object|number,
 * as returned by `mergeInterventionSourceObjects`) into the raw user-scale
 * `Record<string, number>` PLoT expects. Returns the numeric map plus
 * redaction-safe `conversions` (no magnitudes) for diagnostics. Membership is
 * identical to the pre-existing numeric projection (every input here already
 * has a finite `value`).
 */
export function projectInterventionsToRawScale(
  rawObjects: Record<string, unknown>,
  factorScaleById: ReadonlyMap<string, FactorScaleInfo>,
): { interventions: Record<string, number>; conversions: InterventionConversion[] } {
  const interventions: Record<string, number> = {};
  const conversions: InterventionConversion[] = [];
  for (const [factorId, rawObject] of Object.entries(rawObjects)) {
    const factor = factorScaleById.get(factorId);
    const result = resolveRawInterventionValue(rawObject, factor);
    if (result.value === null) continue;
    interventions[factorId] = result.value;
    conversions.push({ factor_id: factorId, rule: result.rule, inconsistent: result.inconsistent });
  }
  return { interventions, conversions };
}

/**
 * Redaction-safe aggregate of conversions for a single snapshot load. Carries
 * rule counts and factor-id lists ONLY — never input/output magnitudes or caps
 * — so the diagnostic logged from it cannot leak business values.
 */
export interface ConversionSummary {
  readonly total: number;
  readonly by_rule: Record<string, number>;
  readonly cap_denormalised_factors: string[];
  readonly inconsistent_scale_factors: string[];
  readonly ambiguous_no_evidence_factors: string[];
}

export function summariseConversions(
  conversions: ReadonlyArray<InterventionConversion>,
): ConversionSummary {
  const by_rule: Record<string, number> = {};
  const cap_denormalised_factors: string[] = [];
  const inconsistent_scale_factors: string[] = [];
  const ambiguous_no_evidence_factors: string[] = [];
  for (const c of conversions) {
    by_rule[c.rule] = (by_rule[c.rule] ?? 0) + 1;
    if (c.rule === 'cap_denormalised') cap_denormalised_factors.push(c.factor_id);
    if (c.rule === 'ambiguous_no_evidence') ambiguous_no_evidence_factors.push(c.factor_id);
    if (c.inconsistent) inconsistent_scale_factors.push(c.factor_id);
  }
  return {
    total: conversions.length,
    by_rule,
    cap_denormalised_factors,
    inconsistent_scale_factors,
    ambiguous_no_evidence_factors,
  };
}

/**
 * True when the summary contains anything worth surfacing (a denormalisation, a
 * raw_value inconsistency, or an ambiguous-no-evidence passthrough) — used by
 * the egress projection to emit a single redacted diagnostic per load.
 */
export function summaryIsNoteworthy(summary: ConversionSummary): boolean {
  return (
    summary.cap_denormalised_factors.length > 0 ||
    summary.inconsistent_scale_factors.length > 0 ||
    summary.ambiguous_no_evidence_factors.length > 0
  );
}
