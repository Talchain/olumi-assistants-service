/**
 * V5 P0.2 — flip-threshold → `set_factor_value` proposal builder (Seam 1).
 *
 * Pure. Turns one flip-threshold entry (from `enrichment.flip_thresholds[]`)
 * into a `ProposedChange` the caller emits via `emitProposedChange()`, or
 * skips it. NEVER improvises: when the value cannot be inverted to a
 * user-scale number AND displayed safely, it returns a typed skip.
 *
 * SCALE / INVERSION (verified against the real normaliser + a real
 * staging envelope, 2026-06-06):
 *   - `flip_thresholds[].flip_value` / `current_value` are MODEL-scale
 *     (confirmed: a real `current_value` of 0.3 equalled the factor's
 *     `observed_state.value` 0.3, whose `raw_value` was 15 at cap 50).
 *   - `set_factor_value` normalises USER-scale input to model via
 *     `value = rawInput / cap` (capped) or `value = rawInput` (uncapped)
 *     — see `d1-shared/normalise-factor-value.ts`.
 *   - Therefore the inverse (user-scale value to replay) is:
 *        capped:   rawInput = flip_value * cap
 *        uncapped: rawInput = flip_value
 *   - We DISPLAY and EXECUTE the same rounded user-scale value, so the
 *     user sees exactly what gets set (no raw decimal, no double-
 *     normalisation). Round-trip correctness is proven against the real
 *     `normaliseFactorValue` in the unit tests.
 *
 * COPY is provenance-safe: a threshold TEST, never a guarantee. We emit
 * "Test X at N" / "Check whether X at N changes the result." — never
 * "this will flip the result".
 */

import type { ProposedChange } from '../types/proposed-change.js';
import { formatFactorValue } from './format-factor-value.js';

/** One entry read defensively from `enrichment.flip_thresholds[]`. */
export interface FlipEntry {
  readonly factor_id: string;
  readonly factor_label: string;
  /** MODEL-scale value at which the result flips. `null` ⇒ no flip found. */
  readonly flip_value: number | null | undefined;
  readonly direction?: string | null;
  readonly unit?: string | null;
}

/** The factor's graph node info needed to invert + display safely. */
export interface FactorNodeInfo {
  readonly cap?: number | null;
  readonly unit?: string | null;
}

export type FlipProposalSkipReason =
  | 'no_flip_value'
  | 'factor_not_in_graph'
  | 'empty_label'
  | 'cap_non_positive'
  | 'model_value_out_of_range'
  | 'unrenderable_value';

export type FlipProposalResult =
  | { readonly ok: true; readonly proposal: ProposedChange }
  | { readonly ok: false; readonly reason: FlipProposalSkipReason };

/**
 * Build a safe `set_factor_value` ProposedChange from one flip entry, or
 * return a typed skip. The caller passes the factor's graph node info
 * (cap/unit from `observed_state`) so the model→user inversion uses the
 * SAME cap the handler will normalise against at execute time (the
 * graph-hash precondition on the pending action guards against drift).
 */
export function buildFlipProposal(
  entry: FlipEntry,
  node: FactorNodeInfo | undefined,
): FlipProposalResult {
  const flip = entry.flip_value;
  if (flip === null || flip === undefined || !Number.isFinite(flip)) {
    return { ok: false, reason: 'no_flip_value' };
  }
  if (!node) {
    return { ok: false, reason: 'factor_not_in_graph' };
  }
  const label = entry.factor_label?.trim() ?? '';
  if (label.length === 0) {
    return { ok: false, reason: 'empty_label' };
  }

  const unit = entry.unit ?? node.unit ?? null;
  const cap = node.cap ?? null;

  let rawInput: number;
  if (cap !== null && cap !== undefined) {
    if (!(cap > 0)) return { ok: false, reason: 'cap_non_positive' };
    // A capped factor's model value lives in [0, 1]; anything else means
    // the flip value is not on the scale we expect — skip rather than
    // invert into an out-of-range raw value.
    if (flip < 0 || flip > 1) return { ok: false, reason: 'model_value_out_of_range' };
    rawInput = flip * cap;
  } else {
    // Uncapped factor: model value === user value.
    rawInput = flip;
  }

  const rendered = formatFactorValue(rawInput, unit);
  if (rendered === null) {
    return { ok: false, reason: 'unrenderable_value' };
  }

  // Execute the SAME rounded value the user sees (display === execution).
  const execRaw = rendered.value;
  const params: Readonly<Record<string, unknown>> =
    cap !== null && cap !== undefined
      ? { value: { value: execRaw, cap } } // capped: handler stores model = execRaw / cap
      : { value: execRaw }; // uncapped: handler stores model = execRaw

  const proposal: ProposedChange = {
    intent: 'set_factor_value',
    label: `Test ${label} at ${rendered.display}`,
    message: `Check whether ${label} at ${rendered.display} changes the result.`,
    params,
    target_entity_ids: [entry.factor_id],
  };
  return { ok: true, proposal };
}

/**
 * Read `enrichment.flip_thresholds[]` defensively into typed FlipEntry[].
 * Tolerates the opaque enrichment shape; drops malformed rows.
 */
export function readFlipEntries(enrichment: unknown): FlipEntry[] {
  if (!enrichment || typeof enrichment !== 'object') return [];
  const arr = (enrichment as Record<string, unknown>).flip_thresholds;
  if (!Array.isArray(arr)) return [];
  const out: FlipEntry[] = [];
  for (const raw of arr) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const factorId = typeof r.factor_id === 'string' ? r.factor_id : null;
    const factorLabel = typeof r.factor_label === 'string' ? r.factor_label : null;
    if (!factorId || !factorLabel) continue;
    out.push({
      factor_id: factorId,
      factor_label: factorLabel,
      flip_value: typeof r.flip_value === 'number' ? r.flip_value : null,
      direction: typeof r.direction === 'string' ? r.direction : null,
      unit: typeof r.unit === 'string' ? r.unit : null,
    });
  }
  return out;
}

/**
 * Select the single best flip entry to propose: the first entry that
 * builds a safe proposal. (Entries arrive in the analysis's own
 * importance order; we do not re-rank.) Returns the proposal + the
 * source entry, or null when none are safely proposable.
 */
export function selectFlipProposal(
  entries: readonly FlipEntry[],
  nodeLookup: (factorId: string) => FactorNodeInfo | undefined,
): { proposal: ProposedChange; entry: FlipEntry } | null {
  for (const entry of entries) {
    const result = buildFlipProposal(entry, nodeLookup(entry.factor_id));
    if (result.ok) return { proposal: result.proposal, entry };
  }
  return null;
}
