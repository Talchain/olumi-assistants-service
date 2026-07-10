/**
 * 1.16 item A2 — option-intervention renormalisation on a factor cap change.
 *
 * Storage convention (verified before implementation, 2026-07-10):
 * option interventions are stored as NORMALISED multiples of the target
 * factor's cap — `value = raw / cap` (CEE SCALE_DISCIPLINE prompt rule;
 * `plot-intervention-scale.ts` module header; `resolveExistingRawValue`
 * trusts the same convention for the factor's own observed_state). An
 * intervention `value: 1` on a cap-£200,000 factor MEANS £200,000.
 *
 * Hazard: when a consented cap change applies (explicit proposal cap on
 * `set_factor_value` — e.g. the "extend the scale" chip), leaving the
 * stored normalised values untouched silently RESCALES every option's
 * absolute configuration (`1` on the new £312,500 cap now means
 * £312,500, not £200,000). This helper renormalises each option's
 * intervention on the changed factor by `old_cap / new_cap` so absolute
 * values are preserved.
 *
 * Scope: OPTION-KIND NODES' top-level `interventions` records only. This
 * is the analysis-visible location — `computeStructuralReadiness` (the
 * run_analysis PLoT projection source) merges interventions from option
 * NODES, and node-level records survive both persistence merges
 * (`applyAndValidateMutation` and `mergeMutatedGraphForPersistence` stamp
 * `nodes`). The top-level `options[]` array is NOT touched: D1 mutations
 * cannot reach it through the persistence merge contract (it passes
 * through from the persisted base byte-for-byte) and the analysis path
 * does not read it.
 *
 * Evidence-gated per entry — no silent corruption (mirrors the egress
 * net's doctrine in `plot-intervention-scale.ts`):
 *   - encoded categorical/boolean entries (value_type, encoding_map, or
 *     boolean raw_value) are NEVER scaled;
 *   - a finite numeric (or numeric-string) `raw_value` is the absolute
 *     truth: when the stored pair is convention-consistent
 *     (`value ≈ raw_value / old_cap`, value in [0,1]) the normalised
 *     `value` is recomputed against the new cap and `raw_value` kept;
 *     an inconsistent pair is left untouched (surfacing beats repair);
 *   - a bare normalised value in (0,1] is rescaled by old/new;
 *   - a raw-looking value (>1 or <0) is already absolute — untouched.
 */

import type { GraphV3T } from '../../../../schemas/cee-v3.js';

/** Relative tolerance for value/raw_value consistency — mirrors
 * `plot-intervention-scale.ts` (0.5%). */
const CONSISTENCY_REL_TOL = 0.005;

function approxEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(1, Math.abs(b)) * CONSISTENCY_REL_TOL;
}

function isFiniteNumber(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

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

function isEncodedIntervention(obj: Record<string, unknown>): boolean {
  const vt = obj.value_type;
  if (vt === 'categorical' || vt === 'boolean') return true;
  if (obj.encoding_map !== null && typeof obj.encoding_map === 'object' && obj.encoding_map !== undefined) {
    return true;
  }
  if (typeof obj.raw_value === 'boolean') return true;
  return false;
}

/**
 * Renormalise a single intervention entry for the cap change. Returns the
 * replacement entry, or `undefined` when the entry must be left untouched
 * (encoded, raw-looking, inconsistent, or not renormalisable).
 */
function renormaliseEntry(
  entry: unknown,
  oldCap: number,
  newCap: number,
): unknown | undefined {
  // Bare number (legacy flat shape): normalised in (0,1] → rescale.
  if (isFiniteNumber(entry)) {
    if (entry > 0 && entry <= 1) return (entry * oldCap) / newCap;
    return undefined;
  }
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) return undefined;
  const obj = entry as Record<string, unknown>;
  if (isEncodedIntervention(obj)) return undefined;
  const value = obj.value;
  if (!isFiniteNumber(value)) return undefined;

  const rawValue = coerceFiniteNumber(obj.raw_value);
  if (rawValue !== undefined) {
    // raw_value is the absolute truth. Only rewrite `value` when the
    // stored pair proves the normalised convention against the OLD cap;
    // a raw-convention pair (value === raw_value) or an inconsistent
    // pair is left untouched.
    if (value >= 0 && value <= 1 && approxEqual(value * oldCap, rawValue)) {
      return { ...obj, value: rawValue / newCap };
    }
    return undefined;
  }

  if (value > 0 && value <= 1) {
    return { ...obj, value: (value * oldCap) / newCap };
  }
  return undefined;
}

/**
 * Walk every option-kind node in `graph` (mutated in place — callers pass
 * the mutation clone) and renormalise its intervention on `factorId` for
 * the `oldCap → newCap` change. Returns the number of entries rewritten.
 */
export function renormaliseOptionInterventionsForCapChange(
  graph: GraphV3T,
  factorId: string,
  oldCap: number | undefined,
  newCap: number | undefined,
): number {
  if (oldCap === undefined || !Number.isFinite(oldCap) || oldCap <= 0) return 0;
  if (newCap === undefined || !Number.isFinite(newCap) || newCap <= 0) return 0;
  if (newCap === oldCap) return 0;
  let rescaled = 0;
  for (const node of graph.nodes) {
    if (node.kind !== 'option') continue;
    const interventions = (node as { interventions?: unknown }).interventions;
    if (
      interventions === null ||
      interventions === undefined ||
      typeof interventions !== 'object' ||
      Array.isArray(interventions)
    ) {
      continue;
    }
    const record = interventions as Record<string, unknown>;
    if (!(factorId in record)) continue;
    const next = renormaliseEntry(record[factorId], oldCap, newCap);
    if (next !== undefined) {
      record[factorId] = next;
      rescaled += 1;
    }
  }
  return rescaled;
}
