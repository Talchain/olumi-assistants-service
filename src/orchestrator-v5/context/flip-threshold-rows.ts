/**
 * ROADMAP 2.228 F1 — the SINGLE owner of the parse for PLoT's TOP-LEVEL
 * `enrichment.flip_thresholds[]` rows.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * Two CEE surfaces need the same rows, and before this module only one of
 * them read the shape PLoT actually emits:
 *
 *   • the COACH context pack — `./analysis-signals.ts`
 *     (`deriveTippingPointsFromTopLevel`) — reads the top-level array. LIVE.
 *   • the DECISION REVIEW prompt input —
 *     `../coaching/decision-review-enricher.ts` (`readFlipThresholdData`) —
 *     derived its rows from `results[].factor_sensitivity[].flip_threshold`,
 *     a shape with zero occurrences in the producer. `analysis-signals.ts`'s
 *     own header already recorded the consequence: *"the per-option
 *     derivation inside `compactAnalysis` is structurally empty on staging,
 *     where `results[]` never carries `factor_sensitivity`"*. So
 *     `enrichment.decision_review.flip_thresholds` was present-and-empty on
 *     every live turn and no flip card could fire.
 *
 * Rather than hand-roll a second top-level reader inside the enricher (the
 * hand-maintained-mirror defect this estate keeps paying for), the parse,
 * the `value_scale` resolution and the row CLASSIFICATION live here once and
 * both surfaces consume them.
 *
 * WHAT THIS MODULE DOES NOT DECIDE
 * --------------------------------
 * Classification only. Whether an `attested_no_flip` row is forwarded to a
 * prompt, dropped, or narrated is a CONSUMER policy — the two consumers have
 * different prompts and different cages, and pretending otherwise would put a
 * prompt decision inside a parser. See each consumer for its filter.
 */

/**
 * A top-level `enrichment.flip_thresholds[]` row, narrowed and classified.
 *
 * `kind` is the load-bearing field:
 *   `flip_pair`        — finite `current_value` AND finite flip value. A real
 *                        tipping point; `direction` is populated.
 *   `attested_no_flip` — flip value null AND the producer explicitly said why
 *                        (`flip_reason: 'no_effect_within_bounds'`). This is
 *                        producer-owned truth ("hard to flip via this
 *                        factor"), NOT "unknown". `direction` is null: there
 *                        is no flip value to move toward, so any direction
 *                        would be invented.
 *   `unusable`         — everything else (flip null with no reason, malformed
 *                        numerics). Asserts nothing, so it is projected as
 *                        nothing.
 */
export interface TopLevelFlipRow {
  readonly factor_id: string;
  readonly factor_label: string;
  readonly current_value: number | null;
  readonly flip_value: number | null;
  readonly direction: 'increase' | 'decrease' | null;
  readonly unit: string | null;
  /** Resolved verbatim from the row (top level, else `margin_sensitivity`). */
  readonly value_scale: string | null;
  readonly flip_reason: string | null;
  readonly kind: 'flip_pair' | 'attested_no_flip' | 'unusable';
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * TRUE ids only (`factor_id`/`node_id`/`id`); a label is never promoted to an
 * id — labels collide, and the decision_review prompt keys its output
 * `flip_thresholds[].factor_id` off this value. Mirrors `readFactorId` in
 * `./analysis-signals.ts`.
 */
function readFactorId(entry: Record<string, unknown>): string | null {
  for (const candidate of [entry.factor_id, entry.node_id, entry.id]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return null;
}

function readLabel(entry: Record<string, unknown>): string | null {
  for (const candidate of [entry.factor_label, entry.label]) {
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate;
  }
  return null;
}

/**
 * Resolve PLoT's `value_scale` from a top-level flip row. The contract
 * (`Docs/v5/cee-plot-flip-value-scale-contract.md`) permits the signal at the
 * row top level, and the PLoT build that introduced it nests it under
 * `margin_sensitivity`. Top level wins. Null when neither is a string.
 *
 * THIS IS THE ONE OWNER of that resolution for the top-level shape:
 * `./analysis-signals.ts` imports it rather than keeping its own copy. (A
 * third, structurally identical reader still lives on the CHIP path —
 * `../compose/flip-proposal.ts:readValueScale` — deliberately untouched here:
 * that module reads rows it selects itself and consolidating it is a separate
 * change with its own blast radius.)
 */
export function readRowValueScale(row: Record<string, unknown>): string | null {
  if (typeof row.value_scale === 'string') return row.value_scale;
  const ms = asRecord(row.margin_sensitivity);
  if (ms !== null && typeof ms.value_scale === 'string') return ms.value_scale;
  return null;
}

/**
 * Does this row carry a POSITIVE attestation that its numbers are NOT on the
 * user-facing display scale?
 *
 * `true` only for a non-empty `value_scale` token that is not `display` —
 * i.e. `'model'` (normalised `[0, 1]`) or an unrecognised token. An ABSENT
 * `value_scale` returns `false`: absence is pre-contract data, not a claim,
 * and refusing it would delete the legitimate unitless probability-like case.
 *
 * Deliberately NARROWER than `flipRowScaleIsDisplaySafe` in
 * `./analysis-signals.ts`, which additionally refuses an absent scale whose
 * values sit inside the normalised band. That predicate governs whether CEE
 * may REUSE a producer-authored display STRING; this one governs whether a
 * row may be handed to a prompt at all. The two questions have different
 * answers and are kept as two named predicates rather than one overloaded
 * one.
 */
export function flipRowAttestsNonDisplayScale(row: TopLevelFlipRow): boolean {
  const scale = row.value_scale === null ? '' : row.value_scale.trim().toLowerCase();
  return scale.length > 0 && scale !== 'display';
}

/**
 * Read + narrow + classify every top-level `enrichment.flip_thresholds[]`
 * row. Pure; never throws; never mutates its input.
 *
 * Deduplicated by `factor_id`, FIRST occurrence wins (upstream orders by
 * importance) — matching the historical `collectFactorFlipEntries`
 * behaviour this replaces on the decision_review path.
 *
 * `direction` is DERIVED from the value delta (`flip_value >= current_value`
 * → `'increase'`), never copied from the row's own `direction` string. Two
 * reasons: the derived value cannot disagree with the numbers the prompt is
 * about to quote, and the same key means "elasticity sign" on the sibling
 * `factor_sensitivity[]` rows — a semantic collision that has already cost
 * this estate a wrong answer once.
 *
 * Optional lookups fill gaps the row leaves:
 *   `graphNodeLabels`: factor_id → display label, when the row carries none.
 *   `graphNodeUnits`:  factor_id → unit, when the row carries none.
 */
export function readTopLevelFlipRows(
  enrichment: Record<string, unknown>,
  graphNodeLabels?: Map<string, string>,
  graphNodeUnits?: Map<string, string>,
): TopLevelFlipRow[] {
  const raw = enrichment.flip_thresholds;
  if (!Array.isArray(raw)) return [];

  const seen = new Set<string>();
  const out: TopLevelFlipRow[] = [];

  for (const item of raw) {
    const entry = asRecord(item);
    if (entry === null) continue;

    const factorId = readFactorId(entry);
    if (factorId === null || seen.has(factorId)) continue;
    seen.add(factorId);

    const currentValue = readFiniteNumber(entry.current_value);
    // `flip_value` is the contract key; `flip_threshold` is accepted as the
    // same-meaning alias, exactly as `deriveTippingPointsFromTopLevel` does.
    const flipValue = readFiniteNumber(entry.flip_value) ?? readFiniteNumber(entry.flip_threshold);

    const flipReason = typeof entry.flip_reason === 'string' ? entry.flip_reason : null;
    // `flip_value === current_value` is degenerate (no actionable movement)
    // but still a pair; `'increase'` keeps the projected value consistent
    // rather than inventing a third state, matching the historical reader.
    const direction: TopLevelFlipRow['direction'] =
      currentValue !== null && flipValue !== null
        ? flipValue >= currentValue
          ? 'increase'
          : 'decrease'
        : null;
    const kind: TopLevelFlipRow['kind'] =
      direction !== null
        ? 'flip_pair'
        : flipValue === null && flipReason === 'no_effect_within_bounds'
          ? 'attested_no_flip'
          : 'unusable';

    const unit =
      typeof entry.unit === 'string' && entry.unit.length > 0
        ? entry.unit
        : graphNodeUnits?.get(factorId) ?? null;

    out.push({
      factor_id: factorId,
      factor_label: readLabel(entry) ?? graphNodeLabels?.get(factorId) ?? factorId,
      current_value: currentValue,
      flip_value: flipValue,
      direction,
      unit,
      value_scale: readRowValueScale(entry),
      flip_reason: flipReason,
      kind,
    });
  }

  return out;
}
