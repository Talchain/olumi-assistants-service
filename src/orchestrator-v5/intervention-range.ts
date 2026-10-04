/**
 * TEMPORAL — an option's stated RANGE for a value it sets (e.g. "5–20 days of downtime").
 *
 * Stored on the intervention it qualifies: `interventions[factorId].range = {low, high, meaning, source, source_quote?}`,
 * in RAW units (the value's `raw_value` unit). Contract: schemas 0.66.0 `InterventionRangeSchema` (#75, tag `v0.66.0`),
 * imported through `cee-v3.ts`. Engine: ISL #216 samples a `likely_range` as the quartiles of a lognormal; PLoT #424 forwards
 * `options[].intervention_ranges` and withholds the limit when ISL does not confirm it sampled the range.
 *
 * Three rules, one module, so the writer and the wire cannot disagree:
 *   1. ADMIT AT WRITE (R3 #75 5914230653 (2)): a range that is malformed, or does not contain the option's own value
 *      (`low ≤ point ≤ high`), is REFUSED — removed from the persisted graph — never stored beside a value it contradicts.
 *   2. THE RANGE CARRIES ITS OWN AUTHOR (AIQ 5914222384): `source` is required, so an Olumi-proposed range can never
 *      inherit the value's user authorship.
 *   3. FORWARD ONLY WHAT THE ENGINE CAN READ: `{low, high, meaning}`, and only when the wire number for that factor IS
 *      the raw point the range brackets. A value CEE rescaled onto the model scale gets no range (the units would
 *      disagree). The wire plan reports that conversion loss so affected outcomes are withheld, never silently
 *      scored as though the user's range had been sampled.
 */
import { InterventionRangeMeaningV3, InterventionRangeV3, type InterventionRangeV3T } from '../schemas/cee-v3.js';

/** schemas 0.66.0 `InterventionRangeMeaning`, imported. Only `likely_range` is sampled by ISL. */
export const INTERVENTION_RANGE_MEANINGS = InterventionRangeMeaningV3.options;

/** schemas 0.66.0 `InterventionRangeSchema`, imported (declared on the intervention contract in `cee-v3.ts`). */
export const StoredInterventionRange = InterventionRangeV3;
export type StoredInterventionRangeT = InterventionRangeV3T;

/** What PLoT's `/v2/run` accepts per factor (`readInterventionRange` in PLoT `intervention-range.ts`). */
export interface WireInterventionRange {
  low: number;
  high: number;
  meaning: StoredInterventionRangeT['meaning'];
}

export type InterventionRangeRefusal = 'malformed' | 'no_point' | 'value_outside_range';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

function finiteNumber(v: unknown): number | undefined {
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v.trim());
    return Number.isFinite(n) && String(n) === v.trim() ? n : undefined;
  }
  return undefined;
}

/**
 * The option's own figure in the range's units: `raw_value` when present (the user-scale quantity), else `value`
 * (a numeric intervention with no separate raw carries its raw figure in `value`). Categorical/boolean → none.
 * ⛔ A finite numeric LEVEL (`value`) is required first (Codex CR 5963331228 P1): a cell whose `value` is missing or
 * invalid sets no level, so a `raw_value` beside it brackets nothing and its range is refused (`no_point`).
 */
export function interventionPoint(intervention: unknown): number | undefined {
  if (!isRec(intervention)) return undefined;
  if (intervention.value_type === 'categorical' || intervention.value_type === 'boolean') return undefined;
  if (typeof intervention.value !== 'number' || !Number.isFinite(intervention.value)) return undefined;
  if (intervention.raw_value !== undefined) return finiteNumber(intervention.raw_value);
  return intervention.value;
}

/** The admitted range, or why it is refused. `undefined` when the intervention states no range. */
export function admitInterventionRange(
  intervention: unknown,
): { range: StoredInterventionRangeT } | { refused: InterventionRangeRefusal } | undefined {
  if (!isRec(intervention) || intervention.range === undefined) return undefined;
  const parsed = StoredInterventionRange.safeParse(intervention.range);
  if (!parsed.success) return { refused: 'malformed' };
  // A likely range has width: equal bounds state a point, not a range (agent admission already requires low < high).
  if (parsed.data.high <= parsed.data.low) return { refused: 'malformed' };
  const point = interventionPoint(intervention);
  if (point === undefined) return { refused: 'no_point' };
  if (point < parsed.data.low || point > parsed.data.high) return { refused: 'value_outside_range' };
  return { range: parsed.data };
}

export interface RefusedInterventionRange {
  readonly container: 'node' | 'option';
  readonly id: string;
  readonly factor_id: string;
  readonly reason: InterventionRangeRefusal;
}

function refusalsIn(container: 'node' | 'option', entries: unknown): RefusedInterventionRange[] {
  if (!Array.isArray(entries)) return [];
  const out: RefusedInterventionRange[] = [];
  for (const entry of entries) {
    if (!isRec(entry) || !isRec(entry.interventions)) continue;
    const id = typeof entry.id === 'string' ? entry.id : '';
    for (const [factorId, iv] of Object.entries(entry.interventions)) {
      const verdict = admitInterventionRange(iv);
      if (verdict !== undefined && 'refused' in verdict) out.push({ container, id, factor_id: factorId, reason: verdict.refused });
    }
  }
  return out;
}

/**
 * The writer rule, at the one persisted form (`projectGraphForPersistence`). Every refused range — on a node's
 * `interventions` or a top-level `options[]` entry's — is removed; the value it sat beside is untouched. A graph with
 * nothing to refuse (every graph without a range) is returned as the ORIGINAL reference, so it stays a fixed point.
 */
export function refuseInadmissibleInterventionRanges<T>(graph: T): { graph: T; refused: RefusedInterventionRange[] } {
  if (!isRec(graph)) return { graph, refused: [] };
  const refused = [...refusalsIn('node', graph.nodes), ...refusalsIn('option', graph.options)];
  if (refused.length === 0) return { graph, refused };
  const clone = JSON.parse(JSON.stringify(graph)) as Rec;
  for (const r of refused) {
    const list = (r.container === 'node' ? clone.nodes : clone.options) as unknown[];
    for (const entry of list) {
      if (!isRec(entry) || entry.id !== r.id || !isRec(entry.interventions)) continue;
      const iv = entry.interventions[r.factor_id];
      if (isRec(iv)) delete iv.range;
    }
  }
  return { graph: clone as T, refused };
}

/**
 * The per-option `intervention_ranges` PLoT reads, or `undefined` for none. `sourceInterventions` are the option's
 * ORIGINAL intervention objects; `wireInterventions` the numbers CEE is about to send. A range is forwarded only when
 * admitted AND the wire number equals the point it brackets (so both are in the same raw units).
 */
export function wireInterventionRanges(
  sourceInterventions: Readonly<Record<string, unknown>>,
  wireInterventions: Readonly<Record<string, number>>,
): Record<string, WireInterventionRange> | undefined {
  return wireInterventionRangePlan(sourceInterventions, wireInterventions).ranges;
}

/**
 * The same read, plus the factors whose ADMITTED range could not ride the wire (Codex CR 5963331228 P1: "0.8 months"
 * projected to 0.08 is no longer the raw point the range brackets). Dropping the range alone would let the engine score
 * that option's limit on the single point (100% / 0%), the very verdict the range exists to replace; the caller
 * withholds that option's result for every limit on these factors instead (fail closed).
 */
export function wireInterventionRangePlan(
  sourceInterventions: Readonly<Record<string, unknown>>,
  wireInterventions: Readonly<Record<string, number>>,
): { ranges: Record<string, WireInterventionRange> | undefined; notForwarded: string[] } {
  let ranges: Record<string, WireInterventionRange> | undefined;
  const notForwarded: string[] = [];
  for (const factorId of Object.keys(sourceInterventions).sort()) {
    const verdict = admitInterventionRange(sourceInterventions[factorId]);
    if (verdict === undefined || !('range' in verdict)) continue;
    const wire = wireInterventions[factorId];
    if (wire === undefined) continue;
    if (wire !== interventionPoint(sourceInterventions[factorId])) { notForwarded.push(factorId); continue; }
    const { low, high, meaning } = verdict.range;
    (ranges ??= {})[factorId] = { low, high, meaning };
  }
  return { ranges, notForwarded };
}
