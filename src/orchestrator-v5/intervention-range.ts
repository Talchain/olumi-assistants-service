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
import { isPersonsOwnSetting } from '../cee/provenance/provenance-of.js';
import { sayFigureExactly } from './agent-lane/say-figure.js';
import { pressedRecord, userStatementOnNode } from './statement-door/statements.js';
import { subjectKey, type DoorSubject } from './statement-door/subject.js';

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
  law?: StoredInterventionRangeT['law'];
  source?: string;
  source_quote?: string;
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
    const { low, high, meaning, law } = verdict.range;
    (ranges ??= {})[factorId] = law === undefined ? { low, high, meaning } : verdict.range;
  }
  return { ranges, notForwarded };
}

/**
 * ⭐ C2 JOIN (AIE 6184022140; DL 15 Oct: disclose + provisional for every likely range): a `likely_range` the analysis samples is
 * two ends (the person's, or the brief's, or Olumi's) READ WITH OLUMI'S EQUAL-TAIL APPROXIMATION, which ISL samples as the
 * quartiles of a lognormal. No writer elicits that law from anyone, so it is never the person's calibration, whoever gave the
 * ends: every result that rests on it says so ({@link likelyRangeLawWords}), and the person's own ends stay theirs.
 */
export interface LikelyRangeUse {
  readonly factor_id: string;
  readonly low: number;
  readonly high: number;
  readonly unit?: string;
  /** The ends are the person's own (the range's own stamp, `isPersonsOwnSetting`), else not theirs. */
  readonly persons_own: boolean;
  /** The words the ends were stated in, where the range keeps them (`source_quote`): the approximation card quotes them. */
  readonly source_quote?: string;
  /** Set by a reader that knows the option (`rangeLawAdopted`): the approximation of exactly these ends was adopted. */
  readonly adopted?: boolean;
}

/**
 * ⭐ AIE 6184726873: a person's likely range licenses a number only once Olumi's equal-tail approximation of it is ADOPTED, by the
 * press of a card that showed it whole (`RANGE_LAW_ROW`, the C2 template). The adoption is the ONE door store's record on the
 * factor, keyed by the option's setting, attesting the law and the exact ends it was shown for: a changed range is not adopted.
 */
export const RANGE_LAW_EQUAL_TAIL = 'equal_tail' as const;
/** The door subject an option's setting of a factor is: its range's adoption record is keyed by it. */
export const rangeLawSubject = (optionId: string, factorId: string): DoorSubject => ({ kind: 'factor', id: factorId, option_id: optionId, field: 'level' });
export function rangeLawAdopted(graph: unknown, optionId: string, u: Pick<LikelyRangeUse, 'factor_id' | 'low' | 'high'>): boolean {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes : [];
  const node = nodes.find((n) => isRec(n) && n.id === u.factor_id);
  // Only a PRESS adopts (#3207: a record construction wrote from the brief on the same setting is never one).
  const record = node === undefined ? undefined : pressedRecord(userStatementOnNode(node, subjectKey(rangeLawSubject(optionId, u.factor_id))));
  return record?.attest?.range_law === RANGE_LAW_EQUAL_TAIL && record.attest.low === u.low && record.attest.high === u.high;
}
/** AIE 6184726873's face, exact, where the recorded use is known. */
export const rangeLawWithheldWords = (factorLabel: string, optionLabel: string): string =>
  `Chance not shown: this result uses an equal-tail approximation for ‘${factorLabel.trim()}’ in ‘${optionLabel.trim()}’ that has not been adopted. `
  + 'Your stated range remains recorded.';

/** The admitted `likely_range` an option's cell carries for a factor, or `undefined` (none, another meaning, or refused). */
export function likelyRangeUseOf(factorId: string, cell: unknown): LikelyRangeUse | undefined {
  const verdict = admitInterventionRange(cell);
  if (verdict === undefined || 'refused' in verdict || (verdict.range.meaning !== 'likely_range' || verdict.range.law !== undefined)) return undefined;
  const unit = isRec(cell) && typeof cell.unit === 'string' && cell.unit.trim() !== '' ? cell.unit.trim() : undefined;
  return { factor_id: factorId, low: verdict.range.low, high: verdict.range.high, ...(unit !== undefined ? { unit } : {}),
    persons_own: isPersonsOwnSetting(verdict.range),
    ...(verdict.range.source_quote !== undefined ? { source_quote: verdict.range.source_quote } : {}) };
}

/**
 * ⭐ C2 (template AIE 6184022140, exact): the person's range AS STATED, then the equal-tail fit as Olumi's proposed approximation,
 * never their calibration. Its basis is the analysis's own convention for a likely range (ISL samples it as the quartiles of a
 * lognormal, RATIFIED_COVERAGE 0.5): a modelling convention, not evidence or the meaning of "likely"; the lognormal's shape is said
 * as its limitation. The level card (`statedRangeAssumptionWords`) and the approximation card (`RANGE_LAW_ROW`) say it alike.
 */
export const rangeApproximationWords = (low: string, high: string): string =>
  `Your stated range is ${low} to ${high}, with its qualification read as “likely”; any other qualifications or conditions in your `
  + `words were not read. Olumi proposes an equal-tail approximation, about one chance in four below ${low} and one in four above ${high}, `
  + `for this analysis, based on how the analysis treats a likely range (as its lower and upper quarter points), a modelling convention, `
  + `not evidence about this case or what “likely” means, with the limitation that the shape of the spread is also Olumi’s assumption: `
  + `always above zero, with a longer tail on the high side. Your words did not specify those tail probabilities or how values are distributed`;

/** One sentence: the option, the range's ends with whose they are, and the law as Olumi's approximation (never their calibration). */
export function likelyRangeLawWords(optionLabel: string, factorLabel: string, u: LikelyRangeUse): string {
  const say = (n: number): string => sayFigureExactly(n, u.unit ?? '') ?? `${n}${u.unit !== undefined ? ` ${u.unit}` : ''}`;
  return `‘${optionLabel.trim()}’ uses ${u.persons_own ? 'your' : 'Olumi’s'} range for ‘${factorLabel.trim()}’, ${say(u.low)} to ${say(u.high)}, `
    + `read with Olumi’s equal-tail approximation: about one chance in four below ${say(u.low)} and one in four above ${say(u.high)}, `
    + `a modelling convention, not ${u.persons_own ? 'your own' : 'a measured'} calibration.`;
}
