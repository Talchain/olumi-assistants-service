/**
 * ── A WRITTEN `cap` MUST SHIP WITH A CORROBORATING `raw_value` ──────────────
 *
 * THE QUESTION THIS MODULE ANSWERS, NAMED APART (trap 21): "can this factor's
 * own observed state PROVE the scale convention it is stored on?" It is NOT
 * "is the value sensible" and it is NOT "does the factor have a raw value".
 *
 * WHY IT MATTERS. PLoT normalises intervention values by the target factor's
 * `observed_state.cap`. A factor carrying a cap and a framed `[0,1]` value with
 * no `raw_value` cannot evidence that convention, so
 * `resolveRawInterventionValue` classifies it `ambiguous_no_evidence` and
 * refuses to denormalise it — correctly: submitting `0.6` against a cap of
 * 150,000 would reach ISL as ~0.000004, a catastrophic intervention
 * masquerading as "no change" (a measured 100,000x corruption class). That
 * rejection is right and is NOT weakened. The defect is upstream: a producer
 * that writes the cap but not the corroboration leaves its own factors
 * unusable — the analysable-option gate can only HOLD a status quo at factors
 * whose observed values are provable, so a status quo whose factors are all
 * unprovable is EXCLUDED rather than held, and if that leaves fewer than two
 * options the whole run refuses.
 *
 * ⚠ THE GUARD ASKS THE CONSUMER, IT DOES NOT MIRROR THE WRITER. Every verdict
 * below is computed by `buildFactorScaleMap` and `resolveRawInterventionValue`
 * — the very functions the analysis seam uses — over the candidate object the
 * hold actually synthesises (`analysable-option-gate.ts::buildHoldFactorValues`,
 * `{value, raw_value}` on a capped factor). So the guard CANNOT be satisfied by
 * agreeing with {@link deriveCorroboratingRawValue}: writer and guard are
 * independent, which is what makes the pair evidence rather than a tautology
 * (trap 12d — a derived guard proves agreement, never correctness, so the two
 * halves must not share a definition).
 */

import {
  buildFactorScaleMap,
  resolveRawInterventionValue,
} from '../../orchestrator-v5/tools/plot-intervention-scale.js';

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

/**
 * The `raw_value` that corroborates a framed value on a capped factor, or
 * `undefined` when no truthful one exists.
 *
 * ── THE DOMAIN, DERIVED FROM THE CONSUMER'S EVIDENCE RULE, NOT ASSUMED ──────
 * `buildFactorScaleMap` grants `normalisedConvention` only when
 * `value in (0,1]`, `cap > 0`, `raw_value > value` and `value * cap ~= raw_value`.
 * `raw_value > value` combined with `value * cap ~= raw_value` FORCES `cap > 1`,
 * so the write domain is bounded to exactly what the reader can accept:
 *
 *   · `cap` finite and `> 1` — a cap of 1 or less cannot downscale, and is the
 *     degenerate class the consumer names explicitly (a genuine raw `[0,1]`
 *     value could otherwise be falsely "denormalised");
 *   · `value` finite and within `[0,1]` — outside it the value is ALREADY a raw
 *     magnitude (the consumer's `passthrough` branch) and multiplying it again
 *     would fabricate a second normalisation; a NEGATIVE value has no
 *     unit-interval representation at all;
 *   · no `raw_value` already present — a stated one is the author's, wins by
 *     the derived-field rule, and a disagreement is surfaced by the consumer's
 *     `inconsistent` flag rather than silently repaired.
 *
 * ⚠ OUTSIDE THAT DOMAIN NOTHING IS INVENTED. An absent `raw_value` that keeps a
 * factor honestly unprovable is a disclosed limitation; a fabricated one would
 * launder the exact corruption the `ambiguous_no_evidence` rule exists to stop.
 *
 * `value === 0` is included and is arithmetically exact (`0 * cap === 0`). It
 * does NOT grant `normalisedConvention` — the consumer still requires
 * `raw_value > value`, and zero is scale-ambiguous — but it does let the
 * factor's OWN observed state resolve through rule 1 (`raw_value_used`) instead
 * of `ambiguous_no_evidence`, which is what makes it holdable. Nothing is
 * claimed that is not true: the factor is observed at zero.
 */
export function deriveCorroboratingRawValue(
  value: unknown,
  cap: unknown,
  existingRawValue: unknown,
): number | undefined {
  if (existingRawValue !== undefined && existingRawValue !== null) return undefined;
  if (!isFiniteNumber(value) || !isFiniteNumber(cap)) return undefined;
  if (cap <= 1) return undefined;
  if (value < 0 || value > 1) return undefined;
  return value * cap;
}

/**
 * Factor ids whose `observed_state` writes a `cap` beside a framed `[0,1]`
 * value that the ANALYSIS SEAM cannot prove — i.e. the factor is unusable as
 * hold provenance and its interventions cannot be denormalised.
 *
 * Two failure modes, both reported, because a guard that checked only PRESENCE
 * would bless a wrong number:
 *   · no `raw_value` at all → the consumer returns `ambiguous_no_evidence`;
 *   · a `raw_value` that disagrees with `value * cap` beyond the consumer's own
 *     tolerance → the consumer returns `inconsistent: true`.
 *
 * Returns ids only — redaction-safe, carrying no business magnitudes.
 */
export function findUncorroboratedCapFactorIds(nodes: unknown): string[] {
  const out: string[] = [];
  if (!Array.isArray(nodes)) return out;
  const scaleById = buildFactorScaleMap(nodes);
  for (const n of nodes) {
    if (n === null || typeof n !== 'object') continue;
    const node = n as Record<string, unknown>;
    if (node.kind !== 'factor') continue;
    const id = node.id;
    if (typeof id !== 'string' || id.length === 0) continue;
    const observed =
      node.observed_state !== null && typeof node.observed_state === 'object'
        ? (node.observed_state as Record<string, unknown>)
        : undefined;
    if (observed === undefined) continue;
    const scale = scaleById.get(id);
    // Capless factors are OUT OF SCOPE by design: `draft/records/projector.ts`
    // deliberately stores no cap (a stored cap flips every later user edit to a
    // normalised write), and a capless factor's value is the level itself.
    if (scale?.cap === undefined || scale.cap <= 0) continue;
    const value = observed.value;
    if (!isFiniteNumber(value)) continue;
    // Exactly the candidate the hold synthesises for a capped factor.
    const candidate: Record<string, unknown> = { value };
    if (isFiniteNumber(observed.raw_value)) candidate.raw_value = observed.raw_value;
    const result = resolveRawInterventionValue(candidate, scale);
    if (result.rule === 'ambiguous_no_evidence' || result.inconsistent) out.push(id);
  }
  return out;
}
