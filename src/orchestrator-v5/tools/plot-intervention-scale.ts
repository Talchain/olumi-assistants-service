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
 * The demotion postcondition, as a directly-testable predicate.
 *
 * Demotion exists to put the WHOLE request inside [0,1] so PLoT's request-level gate
 * skips. Choosing to demote and not achieving that means the payload is still mixed
 * and the analysis is still computing on corrupted input.
 *
 * ⚠ HONEST SCOPE: given correct decision predicates this is UNREACHABLE end-to-end —
 * a mutant that neuters the call inside `projectRequestInterventionsToWireScale`
 * survives, because no reachable request violates it. It is defence in depth against
 * a FUTURE predicate change, which is exactly when it earns its place. Its logic is
 * pinned here rather than only through the caller so the check itself cannot rot into
 * a no-op unnoticed.
 */
export function isDemotionPostconditionViolated(
  demoteChosen: boolean,
  allWithinUnitInterval: boolean,
): boolean {
  return demoteChosen && !allWithinUnitInterval;
}

/**
 * The outcome of projecting an ENTIRE request's interventions to one wire scale.
 * `perOption` mirrors the input order exactly.
 */
export interface RequestScaleProjection {
  /** Per-option `factorId → number` maps, in input order. */
  readonly perOption: Array<Record<string, number>>;
  /** Redaction-safe conversion records (no magnitudes), flattened across options. */
  readonly conversions: InterventionConversion[];
  /** True when rule 2's promotion was suppressed to keep the request homogeneous. */
  readonly demoted: boolean;
  /** Factor ids whose rule-2 promotion was suppressed (redaction-safe: ids only). */
  readonly demotedFactors: string[];
  /**
   * True when every emitted value is <= 1, i.e. PLoT's request-level gate will
   * SKIP normalisation. Deliberately NOT called "homogeneous": a consistently-RAW
   * request is also homogeneous and this flag is false for it.
   */
  readonly allWithinUnitInterval: boolean;
  /**
   * Count of emitted values OUTSIDE [0,1], per rule — sign-symmetric, matching the
   * producer's gate. MAGNITUDE-FREE by construction: it
   * carries how MANY values crossed the gate threshold, never what they were, so it
   * preserves the no-magnitudes property the egress diagnostic was designed around.
   *
   * WHY: the diagnostic previously recorded rule COUNTS and factor ids only, which
   * cannot tell whether an `encoded_verbatim` or `no_cap` value left [0,1] — so a
   * request corrupted by an encoded category, or by a NEGATIVE magnitude, classified
   * as CLEAN. With this field a corrupted run is derivable: any value outside [0,1]
   * AND a stranded unit-scale sibling (`ambiguous_no_evidence_factors` non-empty).
   */
  readonly outsideUnitIntervalByRule: Record<string, number>;
  /**
   * INVARIANT VIOLATION: demotion was chosen and still did not bring the request
   * inside [0,1]. Should be unreachable — it means the decision predicates and the
   * postcondition disagree, and the request is still computing on corrupted input.
   */
  readonly postconditionViolated: boolean;
  /**
   * True when the request is mixed and CEE must NOT auto-resolve it — because the
   * value above 1 is a magnitude CEE does not own (an explicit `raw_value`, an
   * already-raw passthrough, or an ENCODED category) — or when demotion was chosen
   * and failed its postcondition. Surfaced loudly; never silently shipped.
   */
  readonly mixedUnresolved: boolean;
}

/**
 * Project an ENTIRE request's interventions to ONE wire scale.
 *
 * WHY THIS EXISTS — two authorities, two different questions (2026-08-10).
 * `resolveRawInterventionValue` answers "is this INTERVENTION raw or normalised?"
 * PER VALUE. PLoT's normalisation gate answers "is this REQUEST raw or
 * normalised?" PER REQUEST: if every value is within [0,1] it treats them as
 * already normalised and skips; if ANY value exceeds 1 it normalises the WHOLE
 * request against each factor's cap. Each rule is correct alone. Composed, a
 * single rule-2 promotion flips the gate for every OTHER factor, and the factors
 * deliberately left at unit scale (`ambiguous_no_evidence` / `no_cap`) are then
 * divided by their caps — silently annihilating them.
 *
 * Measured on the deployed quartet (CEE cab59b7 / PLoT b9f6b5a / ISL 28fe0c9):
 * the mixed request inflated P(Switch) 0.7360 → 0.9584 on capture `pre-deploy/s3`
 * by reducing an £18,000 switching cost to ~0.0000288, i.e. making the costly
 * option free while it kept its full capability gain. A self-consistent request
 * returns 0.7360333333333333 in EITHER scale — the mixture is the whole defect.
 *
 * THE RULE: if rule 2 promoted anything while unit-scale siblings remain, suppress
 * rule 2 for the request (DEMOTE). Demote rather than promote because promotion
 * would have to assert a normalised convention for factors that provably cannot
 * evidence one (their observed baseline is 0, and zero is scale-ambiguous — see
 * `buildFactorScaleMap`). Demote assumes nothing new; both land on the same
 * numbers. An explicit `raw_value` above 1 is NOT ours to rewrite, so a request
 * carrying one is shipped unchanged and flagged via `blockedByStatedRawScale`.
 */
export function projectRequestInterventionsToWireScale(
  perOptionRawObjects: ReadonlyArray<Record<string, unknown>>,
  factorScaleById: ReadonlyMap<string, FactorScaleInfo>,
): RequestScaleProjection {
  // Pass 1 — resolve every intervention independently (the per-value rule).
  const resolved = perOptionRawObjects.map((rawObjects) =>
    Object.entries(rawObjects).map(([factorId, rawObject]) => ({
      factorId,
      result: resolveRawInterventionValue(rawObject, factorScaleById.get(factorId)),
    })),
  );
  const present = resolved.flat().filter((r) => r.result.value !== null);

  // ---- Request-level decision, classified by the EMITTED VALUE, not by rule name ----
  // SIX rules can emit a value. An earlier version of this decision keyed on rule
  // NAMES and enumerated four of them, so `encoded_verbatim` was invisible and
  // `no_cap` was miscounted as unit-scale. Both are live: `DEFAULT_ENCODING_MAPS`
  // writes categorical encodings like `{build: 0, buy: 1, outsource: 2}` onto option
  // nodes at the draft ingest boundary, and an encoded `2` flips PLoT's gate exactly
  // as a denormalised magnitude does. What matters to PLoT is the NUMBER on the wire,
  // so every predicate below is numeric.

  // Anything OUTSIDE [0,1] flips PLoT's request-level gate for the WHOLE request.
  // SIGN-SYMMETRIC, deliberately: the producer's gate is
  // `if (value < 0 || value > 1) return true;` (PLoT `src/lib/intervention-normaliser.ts`),
  // so a NEGATIVE magnitude trips it exactly as a value above 1 does. An earlier
  // revision tested only `> 1` and was blind to the whole negative class — which is
  // reachable: `src/cee/extraction/numeric-parser.ts` stores negative relativeValue /
  // delta for decrease/reduce/cut/lower phrasing, the contract is a bare `z.number()`,
  // and this module's own suite already pins `{value: -0.4} -> passthrough`.
  const outsideUnitInterval = present.filter(
    (r) => r.result.value !== null && (r.result.value < 0 || r.result.value > 1),
  );
  // A sibling is STRANDED only if its emitted value really is <= 1: once the gate
  // fires, PLoT divides it by its cap and it is annihilated. A `no_cap` value ABOVE 1
  // is not stranded — and note these are two different claims that must not be
  // collapsed: `no_cap` is genuinely NOT corrupted (there is no cap to divide by), but
  // it is also NOT unit-scale. Counting it as unit-scale regardless of magnitude is
  // what made an earlier version demote a request it could never make homogeneous.
  const strandedUnitScale = present.some(
    (r) =>
      (r.result.rule === 'ambiguous_no_evidence' || r.result.rule === 'no_cap') &&
      r.result.value !== null &&
      r.result.value >= 0 &&
      r.result.value <= 1,
  );
  const mixed = outsideUnitInterval.length > 0 && strandedUnitScale;
  // ONLY rule 2 is ours to undo — CEE derived that number itself. Every other value
  // above 1 is a magnitude we do not own: an explicit `raw_value`, an already-raw
  // passthrough, or an encoded category (where `2` means "outsource", not "two").
  // A NEGATIVE is undemotable for the same reason a stated raw_value is: it is a
  // magnitude CEE does not own, and dividing it back by a cap would not bring it
  // inside [0,1] anyway.
  const undemotableOutside = outsideUnitInterval.some((r) => r.result.rule !== 'cap_denormalised');
  const demote = mixed && !undemotableOutside;

  const perOption: Array<Record<string, number>> = [];
  const conversions: InterventionConversion[] = [];
  const demotedFactors: string[] = [];
  for (const entries of resolved) {
    const interventions: Record<string, number> = {};
    for (const { factorId, result } of entries) {
      if (result.value === null) continue;
      // Demotion re-emits the PRE-promotion value, which rule 2 recorded as
      // `inputValue` — never a re-derived `value / cap`, so no rounding is introduced.
      const demotedHere = demote && result.rule === 'cap_denormalised' && result.inputValue !== null;
      interventions[factorId] = demotedHere ? result.inputValue! : result.value;
      if (demotedHere && !demotedFactors.includes(factorId)) demotedFactors.push(factorId);
      conversions.push({
        factor_id: factorId,
        rule: result.rule,
        inconsistent: result.inconsistent,
      });
    }
    perOption.push(interventions);
  }

  // ---- POSTCONDITION, ASSERTED RATHER THAN LOGGED ----
  // Demotion exists for exactly one purpose: to put the whole request inside [0,1] so
  // PLoT's gate SKIPS. If we chose to demote and did not achieve that, the payload is
  // still mixed and the analysis is still computing on corrupted input — so the claim
  // "demoted" would be a lie. This assertion is what catches the whole defect class
  // WITHOUT anyone having to enumerate the rules in advance; it would have caught the
  // encoded-category case before anybody thought of `encoded_verbatim`.
  // Written against the SPEC ([0,1]), not against the failure mode being fixed. An
  // earlier revision wrote `v <= 1` and therefore inherited the exact blind spot the
  // assertion exists to catch.
  const allWithinUnitInterval = perOption.every((o) =>
    Object.values(o).every((v) => v >= 0 && v <= 1),
  );
  const postconditionViolated = isDemotionPostconditionViolated(demote, allWithinUnitInterval);
  // Counted from the EMITTED values (post-demotion), i.e. what actually reaches PLoT
  // and therefore what actually decides its gate. Counts only — never magnitudes.
  const outsideUnitIntervalByRule: Record<string, number> = {};
  for (const entries of resolved) {
    for (const { factorId, result } of entries) {
      if (result.value === null) continue;
      const emitted = perOption[resolved.indexOf(entries)]?.[factorId];
      if (emitted !== undefined && (emitted < 0 || emitted > 1)) {
        outsideUnitIntervalByRule[result.rule] = (outsideUnitIntervalByRule[result.rule] ?? 0) + 1;
      }
    }
  }
  return {
    perOption,
    conversions,
    demoted: demote && !postconditionViolated && demotedFactors.length > 0,
    demotedFactors,
    allWithinUnitInterval,
    outsideUnitIntervalByRule,
    postconditionViolated,
    // A mixed request we must NOT auto-resolve, OR one where demotion failed to make
    // the request homogeneous. Either way it is unresolved and must not be shipped as
    // if it were fine.
    mixedUnresolved: (mixed && undemotableOutside) || postconditionViolated,
  };
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
