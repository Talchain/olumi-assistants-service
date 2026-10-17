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
import { isPlaceholderLink } from '../../cee/magnitude/link-sizing.js';
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
  return { from, to, quote: st.quote, low: st.low, high: st.high, unit: st.unit.trim(), mean: negative ? -size : size, std,
    band: edgeBandFromMagnitude(size) };
}

/**
 * The card's words for one working point (Olumi's convention, its basis and its limitation, said before the press; BUDDY-A
 * 02:58Z): the user's sentence whole, the range as Olumi read it, the working point and its spread as Olumi's, and what stays.
 */
export function linkWorkingPointWords(graph: unknown, wp: LinkWorkingPoint): string {
  const from = labelOf(graph, wp.from);
  const to = labelOf(graph, wp.to);
  const say = (n: number): string => `${fmt(n)} ${wp.unit}`;
  const mid = (wp.low + wp.high) / 2;
  const said = wp.quote.trim();
  return `Your brief says: “${said}”${/[.!?]$/u.test(said) ? '' : '.'} Olumi reads it as a range of ${say(wp.low)} to ${say(wp.high)} `
    + `for how much switching on ‘${from}’ changes ‘${to}’, in the unit ‘${to}’ is measured in; any other qualifications or `
    + 'conditions in those words were not read. '
    + `Olumi proposes a working point for this link, for this analysis: ${say(mid)}, the middle of that range, with a spread that `
    + `reads your two ends as the middle half of likely effects (about one chance in four below ${say(wp.low)} and one in four above `
    + `${say(wp.high)}). That reading is Olumi’s modelling convention, not something your words say, and not a measured calibration. `
    + `Its limitation: the spread is symmetric around ${say(mid)} with no outer limit, so effects beyond either end, and occasionally `
    + 'in the opposite direction, stay possible in the analysis. '
    + 'Your range stays recorded as you stated it, and a chance shown with this working point rests on it and stays provisional. '
    + 'Record this link to use Olumi’s working point, or change or reject it instead.';
}
