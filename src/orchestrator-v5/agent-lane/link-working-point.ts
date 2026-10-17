/**
 * ⭐ G3 WORKING POINT (BUDDY-A 00:12Z / 02:58Z AMENDs; DL-3 04:15Z GO): Olumi's proposed size for a link the user stated as a
 * RANGE in their brief, which nobody sized. The range stays the user's record (construction's, `linkHoldsStatedRange`); the
 * working point is Olumi's estimate, adopted only by the press on the existing link card (`propose_link_strengths`, host
 * origin `working_point`), written by the existing link writer with this spread, and read as Olumi's estimate you accepted.
 *
 * The convention, said as Olumi's on the card: the middle of the range is the working point, and the two ends are read as the
 * middle half of likely effects (the inner quartiles of the Normal the engine draws this link from, ISL a5725a15
 * `robustness_analyzer_v2.py:202–208`), so std = (high − low) / (2 · 0.6745). Coherent only where the range says the change in
 * the TARGET, in the unit the target is measured in, for the ONE change its SOURCE can make: a yes/no source switching on (a
 * switch's effect is its target figure alone, Science 6008844683). A range on a graded source gives no "per what", so no card.
 * Its limitation, also said: the spread has no outer limit, so effects beyond either end, and occasionally the opposite
 * direction, stay possible. Pure.
 */
import { convertLinkEffect } from '../../cee/magnitude/link-effect.js';
import { isPlaceholderLink, linkSizing, sizedByApproval } from '../../cee/magnitude/link-sizing.js';
import { ADJUST_EDGE_STRENGTH_STD_MAX } from '../../cee/magnitude/olumi-spread.js';
import { edgeBandFromMagnitude } from '../format/edge-strength-bands.js';
import type { InfluenceBand } from '../format/influence-bands.js';
import { linkHoldsStatedRange, userStatementFor } from '../statement-door/statements.js';
import { linkEffectConversionFrames, linkEffectEndUnits, statedInOneOf } from '../system-events/link-effect-edit.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** The inner quartiles of a Normal lie this many standard deviations apart (2 · Φ⁻¹(0.75)). */
export const QUARTILES_APART_IN_SD = 2 * 0.6744897501960817;

export interface LinkWorkingPoint {
  readonly from: string;
  readonly to: string;
  /** The user's sentence, as construction recorded it. */
  readonly quote: string;
  /** The range as Olumi read it from that sentence, in the target's own unit. */
  readonly low: number;
  readonly high: number;
  readonly unit: string;
  /** Olumi's working point on the link's own frames: signed by the link's direction. */
  readonly mean: number;
  /** Olumi's spread: the two ends as the inner quartiles. */
  readonly std: number;
  readonly band: InfluenceBand;
}

const labelOf = (graph: unknown, id: string): string => {
  const n = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.find((x) => isRec(x) && x.id === id) : undefined;
  return String((isRec(n) ? n.label : undefined) ?? id).trim();
};
const fmt = (n: number): string => (Number.isInteger(n) ? n.toLocaleString('en-GB') : String(Number(n.toPrecision(6))));

/**
 * The working point for ONE link, or `undefined` whenever the convention does not hold for it: not exactly one edge, not a
 * placeholder, no construction range, more than one statement or any negated one, ends not ascending or below zero, a unit
 * that is not the target's own, a source that is not a yes/no switch, frames that do not resolve, or a size or spread the
 * link writer cannot hold.
 */
export function linkWorkingPointOf(graph: unknown, from: string, to: string): LinkWorkingPoint | undefined {
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter((e) => isRec(e) && e.from === from && e.to === to) : [];
  if (edges.length !== 1 || !isPlaceholderLink(edges[0]) || !linkHoldsStatedRange(graph, from, to)) return undefined;
  const edge = edges[0] as Rec;
  const record = userStatementFor(graph, { kind: 'link', id: from, to_id: to, field: 'effect' });
  // ONE statement, so `linkHoldsStatedRange` (one un-negated range, construction's) is the whole of what it says.
  const st = record?.statements.length === 1 ? record.statements[0] : undefined;
  if (st === undefined || !finite(st.low) || !finite(st.high) || st.low < 0 || !(st.low < st.high)
    || typeof st.unit !== 'string' || typeof st.quote !== 'string') return undefined;
  // ⛔ AIE (17 Oct, on #3346): a range stated UNDER conditions the reading bound is a conditional effect, and no reader after the
  // press carries that scope, so no working point: the words and their reasoning stay, the dependent number is not proposed.
  if (typeof st.conditions === 'string' && st.conditions.trim() !== '') return undefined;
  const units = linkEffectEndUnits(graph, from, to);
  if (units === null || !units.source.own.includes('switch')) return undefined;
  if (!statedInOneOf(st.unit, [...units.target.own, units.target.adopted])) return undefined;
  const frames = linkEffectConversionFrames(graph, from, to);
  if (frames === null) return undefined;
  const lo = convertLinkEffect(st.low, 1, frames.target, frames.source);
  const hi = convertLinkEffect(st.high, 1, frames.target, frames.source);
  if (lo === null || hi === null || !(hi > lo)) return undefined;
  const mean = edge.strength !== undefined && isRec(edge.strength) ? edge.strength.mean : undefined;
  const negative = edge.effect_direction === 'negative' || (edge.effect_direction !== 'positive' && finite(mean) && mean < 0);
  const size = (lo + hi) / 2;
  const std = (hi - lo) / QUARTILES_APART_IN_SD;
  if (!(size > 0) || size > 1 || !(std > 0) || std > ADJUST_EDGE_STRENGTH_STD_MAX) return undefined;
  const signed = negative ? -size : size;
  // ⛔ #3346 R1 (BUDDY-A B1): the press must SIZE the link. By the canonical approval rule, as the card's own preview reads it
  // (`sizedByApproval`), a working point equal to the stored mean leaves the placeholder unsized, and the writer refuses that
  // `set` as unchanged. So no card then: the existing size ask stays.
  const provenance = isRec(edge.provenance) ? edge.provenance : {};
  if (linkSizing({ ...edge, provenance: sizedByApproval({ ...provenance, reviewed_by_user: { intent: 'confirm' } }, edge, signed) }) !== 'olumi_accepted') return undefined;
  return { from, to, quote: st.quote, low: st.low, high: st.high, unit: st.unit.trim(), mean: signed, std,
    band: edgeBandFromMagnitude(size) };
}

/**
 * The card's words for one working point, the AIE's AMEND (17 Oct, on #3346) filled with this link's facts: the user's sentence
 * whole, the range as Olumi read it, the conditions not yet interpreted, the working point and its spread as Olumi's assumptions
 * (never the user's probabilities or a calibration), the unbounded tails without a claimed frequency, and the AIE's closing.
 */
export function linkWorkingPointWords(graph: unknown, wp: LinkWorkingPoint): string {
  const from = labelOf(graph, wp.from);
  const to = labelOf(graph, wp.to);
  const say = (n: number): string => `${fmt(n)} ${wp.unit}`;
  const range = `${fmt(wp.low)} to ${fmt(wp.high)} ${wp.unit}`;
  const said = wp.quote.trim();
  return `Your brief says: “${said}”${/[.!?]$/u.test(said) ? '' : '.'} Olumi reads it as a range of ${range} for how much switching on `
    + `‘${from}’ changes ‘${to}’, in the unit ‘${to}’ is measured in. Other qualifications or conditions in these words have not yet `
    + 'been interpreted. This proposal does not establish that they hold or are included in the calculation. '
    + `For this conditional analysis, Olumi proposes ${wp.mean < 0 ? 'a decrease' : 'an increase'} of ${say((wp.low + wp.high) / 2)}, `
    + `the middle of ${range}, using a symmetric Normal spread with no outer limits. In this assumed model, half of the effects lie `
    + `between ${say(wp.low)} and ${say(wp.high)}, with one quarter below and one quarter above. Those probabilities and the spread are `
    + 'Olumi’s modelling assumptions, not probabilities you supplied or an empirical calibration. The assumed spread permits effects '
    + 'beyond both ends, including effects in the opposite direction; it does not establish how frequently those outcomes occur in '
    + 'reality. Adopt this displayed Olumi approximation, or change or reject it. Your original range and full source remain '
    + 'unchanged. Any permitted result rests on these assumptions and on the qualifications or conditions in your words that have '
    + 'not yet been interpreted.';
}
