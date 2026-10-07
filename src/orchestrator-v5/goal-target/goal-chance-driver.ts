/**
 * ⭐ G4/G5 PHASE 2, CEE P2b — HOW PRECISELY EACH OPTION'S GOAL CHANCE IS KNOWN, AND WHAT MOVES IT MOST (DL 0df0e1 rulings
 * 1–6; design-g4g6 Q3/Q7; ISL shape isl-4d §1–2 with the DL's R1–R4). Read off the option's OWN record (the blocks ISL emits
 * beside `probability_of_goal`, carried by PLoT) and joined to the Run's OWN graph for authorship. Pure; no words.
 *
 *  · PRECISION (ruling 5): `probability_of_goal_precision` is a 95% Wilson interval on (`n_met`, `n_informative`). The
 *    displayed step is `whole` while its half-width is ≤ 2.5 points, else `nearest_5`. A nearest-5 step never shows 0 or
 *    100 for a chance strictly between them (it would read as a certainty the Run did not earn).
 *  · MAIN DRIVER (ruling 1): only the TOP row (largest `spread`; ties by `kind`, then `quantity_id`, ISL's own order), and
 *    only when it is `resolved`, not `correlated`, not a factor the option itself sets, and has what its words need.
 *    Otherwise `no_driver` with the typed reason. NEVER the next row: "most" would then be false. A block from which
 *    PLoT dropped invalid rows (`invalid_rows_dropped` > 0, #440) has no main driver at all (`invalid_rows`).
 *  · SIDE (ruling 2): the side where the chance FALLS (the lower `p_goal_if_*`).
 *  · LINK STRENGTH (ruling 3): carries NO number (never a β, never a cut); only whether the chance falls when the link is
 *    weaker or stronger than its assumed size, read from the sign of that size on the Run's graph.
 *  · AUTHORSHIP (ruling 4), CEE's existing readers on the Run's graph, never the current canvas:
 *      `link_existence`  the doubt (existence < 1) is ALWAYS Olumi's prior unless the link is held (`heldLinkOf`); a user's
 *                        link keeps Olumi's doubt (`user_stated_link: true`, authored_by `olumi`);
 *      `link_strength`   whoever sized the link (`linkSizing` 'user' → user; any Olumi size → olumi);
 *      `factor_value`    an inferred value (`deriveInferredValues`) or Olumi's template range (`spread_source` 'template',
 *                        echoed on the row, else the Run's `factor_evppi` row) → olumi; the user's range → user.
 *    Anything else is `unattributed`: calling a user's value Olumi's is the worse error (`inferred-value-disclosure.ts`).
 */
import { linkSizing, isSizedOnlyByOlumi } from '../../cee/magnitude/link-sizing.js';
import { deriveInferredValues } from '../coaching/inferred-value-disclosure.js';
import { readEdgeParams } from '../../cee/unified-pipeline/utils/edge-format.js';
import { endsOfGraph, heldLinkOf, isUserStatedLink, validatedDefinition } from './held-user-links.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const unitInterval = (v: unknown): v is number => finite(v) && v >= 0 && v <= 1;
const positiveCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v > 0;
const TOL = 1e-9;

/** z for a two-sided 95% interval: ISL's own constant (isl-4d §10). */
export const WILSON_Z_95 = 1.959963984540054;
/** Ruling 5: the widest Wilson half-width, in percentage points, that is still shown as a whole percentage. */
export const WHOLE_PCT_MAX_HALF_WIDTH_POINTS = 2.5;

export type GoalChanceDisplayRounding = 'whole' | 'nearest_5';

/** The displayed percentage of a chance at a step. `whole` is exactly `displayedGoalPct`'s rule. */
export function displayedPctAt(p: number, rounding: GoalChanceDisplayRounding): number {
  const c = Math.max(0, Math.min(1, p));
  if (rounding === 'whole') return Math.round(c * 100);
  const five = Math.round(c * 20) * 5;
  // Never 0 or 100 for a chance strictly between them: a coarse step must not manufacture a certainty.
  if (c > 0 && five === 0) return 5;
  if (c < 1 && five === 100) return 95;
  return five;
}

/** Ruling 5 on a half-width in percentage points. */
export function displayRoundingFor(halfWidthPoints: number): GoalChanceDisplayRounding {
  return halfWidthPoints <= WHOLE_PCT_MAX_HALF_WIDTH_POINTS + TOL ? 'whole' : 'nearest_5';
}

/** The 95% Wilson half-width of a proportion `p` over `n` draws, in percentage points. */
export function wilsonHalfWidthPoints(p: number, n: number): number {
  const z2 = WILSON_Z_95 * WILSON_Z_95;
  const half = (WILSON_Z_95 * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / (1 + z2 / n);
  return half * 100;
}

export interface GoalChancePrecision {
  readonly n_informative: number;
  readonly n_met: number;
  readonly interval_lower: number;
  readonly interval_upper: number;
}

/**
 * The option record's own precision block, or null when it is absent or not the ruled shape (a 95% Wilson interval that
 * contains the record's own `probability_of_goal`). Null is "not known", never "precise".
 */
export function goalChancePrecisionOf(record: Rec): GoalChancePrecision | null {
  const b = record.probability_of_goal_precision;
  if (!isRec(b) || b.basis !== 'simulation_precision' || b.method !== 'wilson_score' || b.confidence_level !== 0.95) return null;
  const { n_informative: n, n_met: met, interval_lower: lo, interval_upper: hi } = b;
  if (!positiveCount(n) || typeof met !== 'number' || !Number.isInteger(met) || met < 0 || met > n) return null;
  if (!unitInterval(lo) || !unitInterval(hi) || lo > hi) return null;
  const p = record.probability_of_goal;
  if (!unitInterval(p) || p < lo - TOL || p > hi + TOL) return null;
  return { n_informative: n, n_met: met, interval_lower: lo, interval_upper: hi };
}

/** The interval's half-width in percentage points. */
export const precisionHalfWidthPoints = (pr: GoalChancePrecision): number => ((pr.interval_upper - pr.interval_lower) / 2) * 100;

/** Two options' Wilson intervals are DISTINCT when they do not overlap (ruling 6). */
export const intervalsDistinct = (a: GoalChancePrecision, b: GoalChancePrecision): boolean =>
  a.interval_lower > b.interval_upper || b.interval_lower > a.interval_upper;

export type GoalChanceDriverKind = 'factor_value' | 'link_strength' | 'link_existence';
export type GoalChanceDriverSide = 'low' | 'high' | 'absent' | 'present';
export type GoalChanceNoDriverReason =
  'invalid_rows' | 'below_resolution' | 'correlated' | 'set_by_option' | 'no_cut_value' | 'none';
export type GoalChanceAuthor = 'user' | 'olumi' | 'unattributed';

export interface GoalChanceDriver {
  /** ISL's id: a factor id, or "from->to" for a link (isl-4d R4). */
  readonly quantity_id: string;
  readonly kind: GoalChanceDriverKind;
  /** `factor_value` only. */
  readonly factor_id?: string;
  /** Links only. */
  readonly from?: string;
  readonly to?: string;
  /** Ruling 2: the side where the chance FALLS. */
  readonly side: GoalChanceDriverSide;
  /** `link_strength` only (ruling 3, no number): the chance falls when the link is weaker / stronger than its assumed size. */
  readonly strength?: 'weaker' | 'stronger';
  /**
   * `factor_value` only: the cut on the falling side in the USER's units, exactly as PLoT sent it (`low_upper_display` for
   * `low`, `high_lower_display` for `high`), with its `display_unit`. Never ISL's model-scale `*_value` (DL addendum 3).
   */
  readonly cut_value?: number;
  readonly cut_unit?: string;
  /** `factor_value` and `link_existence`: the DISPLAYED chance on the falling side, at that group's own step (ruling 5). */
  readonly pct_if_side?: number;
  readonly pct_if_side_rounding?: GoalChanceDisplayRounding;
  /** Ruling 4: whose assumption the driver varies. */
  readonly authored_by: GoalChanceAuthor;
  /** Links only: the RELATIONSHIP is the user's (`isUserStatedLink`), whoever authored the doubt (W3, case E). */
  readonly user_stated_link?: boolean;
}

export type GoalChanceDriverClaim = { readonly driver: GoalChanceDriver } | { readonly no_driver: GoalChanceNoDriverReason };

const KINDS: ReadonlySet<string> = new Set(['factor_value', 'link_strength', 'link_existence']);
const none = (reason: GoalChanceNoDriverReason): GoalChanceDriverClaim => ({ no_driver: reason });

/** ISL's ranking (isl-4d §9): spread descending, then `kind`, then `quantity_id` (code-point order, as Python's). */
export function byIslRank(a: Rec, b: Rec): number {
  const d = (b.spread as number) - (a.spread as number);
  if (d !== 0) return d;
  const ka = String(a.kind), kb = String(b.kind);
  if (ka !== kb) return ka < kb ? -1 : 1;
  const qa = String(a.quantity_id), qb = String(b.quantity_id);
  return qa === qb ? 0 : qa < qb ? -1 : 1;
}

/** The TOP row of an option's driver block, or null (absent, empty, or any row it cannot rank). Never a second row. */
export function topDriverRow(record: Rec): Rec | null {
  const block = record.probability_of_goal_drivers;
  if (!isRec(block) || !Array.isArray(block.drivers) || block.drivers.length === 0) return null;
  const rows = block.drivers;
  if (!rows.every((r) => isRec(r) && finite(r.spread) && typeof r.kind === 'string' && typeof r.quantity_id === 'string')) return null;
  return [...(rows as Rec[])].sort(byIslRank)[0]!;
}

/**
 * ⭐ S-DEF (Science 393023, DL P0, 7 Oct): a link that holds BY DEFINITION carries no doubt, so it is never what an option's
 * chance rests on. Served Wave B9 T1b: "‘Launch starter tier’ … It rests most on Olumi’s own estimate of how strongly
 * ‘Starter-tier monthly recurring revenue’ affects ‘monthly recurring revenue’" — an identity (£1 per £1), whose rows topped
 * the block only because it was drawn as a belief. The hold sends it at 1.0 / 0.01, but on a small frame (mean 0.05) that
 * floor is still a numerical spread, not anyone's doubt. So its rows (strength and existence) leave the ranking; the top of
 * the REST is the main driver (or none). A flag that fails validation is an ordinary link and stays.
 */
export function withoutDefinitionRows(record: Rec, graph: unknown): Rec {
  const block = record.probability_of_goal_drivers;
  if (!isRec(block) || !Array.isArray(block.drivers)) return record;
  const endsOf = endsOfGraph(graph);
  const drivers = block.drivers.filter((r) => {
    if (!isRec(r) || (r.kind !== 'link_strength' && r.kind !== 'link_existence')) return true;
    const ends = linkEnds(r);
    const edge = ends === null ? undefined : runEdge(graph, ends.from, ends.to);
    return edge === undefined || validatedDefinition(edge, endsOf(edge)) === undefined;
  });
  return drivers.length === block.drivers.length ? record : { ...record, probability_of_goal_drivers: { ...block, drivers } };
}

export function linkEnds(row: Rec): { from: string; to: string } | null {
  if (typeof row.from === 'string' && typeof row.to === 'string' && row.from !== '' && row.to !== '') return { from: row.from, to: row.to };
  const m = /^(.+)->(.+)$/.exec(String(row.quantity_id));
  return m === null ? null : { from: m[1]!, to: m[2]! };
}

export function runEdge(graph: unknown, from: string, to: string): Rec | undefined {
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  return edges.find((e) => e.from === from && e.to === to && e.edge_type !== 'bidirected');
}

function optionSets(graph: unknown, optionId: string, factorId: string): boolean {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const option = nodes.find((n) => n.id === optionId && n.kind === 'option');
  if (option === undefined) return false;
  const interventions = isRec(option.interventions) ? option.interventions : isRec(option.data) && isRec(option.data.interventions) ? option.data.interventions : undefined;
  return interventions !== undefined && Object.hasOwn(interventions, factorId);
}

function factorAuthor(graph: unknown, envelope: unknown, factorId: string, row: Rec): GoalChanceAuthor {
  if (deriveInferredValues(graph).some((v) => v.factor_id === factorId)) return 'olumi';
  const evppi = isRec(envelope) && Array.isArray(envelope.factor_evppi)
    ? envelope.factor_evppi.filter(isRec).find((r) => r.factor_id === factorId) : undefined;
  const source = typeof row.spread_source === 'string' ? row.spread_source : evppi?.spread_source;
  return source === 'template' ? 'olumi' : source === 'user' ? 'user' : 'unattributed';
}

function strengthAuthor(edge: Rec): GoalChanceAuthor {
  if (linkSizing(edge) === 'user') return 'user';
  return isSizedOnlyByOlumi(edge) ? 'olumi' : 'unattributed';
}

/** The falling side of two group chances, or null when they are equal (nothing falls). */
function fallingSide<S extends string>(pA: number, pB: number, a: S, b: S): S | null {
  return pA < pB ? a : pB < pA ? b : null;
}

export function groupPct(p: number, n: number): { pct_if_side: number; pct_if_side_rounding: GoalChanceDisplayRounding } {
  const rounding = displayRoundingFor(wilsonHalfWidthPoints(p, n));
  return { pct_if_side: displayedPctAt(p, rounding), pct_if_side_rounding: rounding };
}

/**
 * Ruling 1–4 for ONE licensed option: its main driver, or why there is none. `graph` is the Run's OWN graph
 * (`graphForAnalysis`), `envelope` the Run's own result (for `factor_evppi`). Pure.
 */
export function goalChanceDriverOf(record: Rec, optionId: string, graph: unknown, envelope: unknown): GoalChanceDriverClaim {
  // ⛔ PLoT #440: `invalid_rows_dropped` (present only when > 0) counts driver rows PLoT refused. The row it dropped may
  // have been the top one, so no surviving row can be called the main driver. Any value but 0 fails closed.
  const block = record.probability_of_goal_drivers;
  if (isRec(block) && 'invalid_rows_dropped' in block && block.invalid_rows_dropped !== 0) return none('invalid_rows');
  const top = topDriverRow(withoutDefinitionRows(record, graph));
  if (top === null || !KINDS.has(top.kind as string)) return none('none');
  if (top.status === 'below_resolution') return none('below_resolution');
  if (top.status !== 'resolved') return none('none');
  // R2: a correlated row's conditional chance is true but not "all else equal". Anything but an explicit false is correlated.
  if (top.correlated !== undefined && top.correlated !== false) return none('correlated');
  const quantity_id = top.quantity_id as string;

  if (top.kind === 'factor_value') {
    const factorId = typeof top.factor_id === 'string' && top.factor_id !== '' ? top.factor_id : quantity_id;
    // R3 / S3: a factor the option itself sets moves its chance through the reference, not through the option.
    if (optionSets(graph, optionId, factorId)) return none('set_by_option');
    const { p_goal_if_low: pl, p_goal_if_high: ph, n_low: nl, n_high: nh } = top;
    if (!unitInterval(pl) || !unitInterval(ph) || !positiveCount(nl) || !positiveCount(nh)) return none('none');
    const side = fallingSide(pl, ph, 'low' as const, 'high' as const);
    if (side === null) return none('none');
    // ⛔ DL addendum (3), DGAI P3: the cut is quoted ONLY in the user's units, as PLoT sent it (`low_upper_display` /
    // `high_lower_display` + `display_unit`). ISL's raw `*_value` is on the model's scale: NEVER a fallback. An uncapped
    // factor, or a cut outside the factor's range, has no display cut → no claim.
    const cut = top[side === 'low' ? 'low_upper_display' : 'high_lower_display'];
    const unit = top.display_unit;
    if (!finite(cut) || typeof unit !== 'string' || unit.trim() === '') return none('no_cut_value');
    return { driver: {
      quantity_id, kind: 'factor_value', factor_id: factorId, side, cut_value: cut, cut_unit: unit,
      ...groupPct(side === 'low' ? pl : ph, side === 'low' ? nl : nh),
      authored_by: factorAuthor(graph, envelope, factorId, top),
    } };
  }

  const ends = linkEnds(top);
  if (ends === null) return none('none');
  // A link the Run's own graph does not carry cannot be attributed or worded: fail closed.
  const edge = runEdge(graph, ends.from, ends.to);
  if (edge === undefined) return none('none');
  if (top.kind === 'link_strength') {
    const { p_goal_if_low: pl, p_goal_if_high: ph } = top;
    if (!unitInterval(pl) || !unitInterval(ph)) return none('none');
    const side = fallingSide(pl, ph, 'low' as const, 'high' as const);
    if (side === null) return none('none');
    // Weaker = a smaller size in the direction the link was assumed: the low draws of a positive link, the high of a negative.
    const mean = readEdgeParams(edge).mean;
    if (mean === undefined || mean === 0) return none('no_cut_value');
    const strength = (side === 'low') === (mean > 0) ? 'weaker' as const : 'stronger' as const;
    return { driver: {
      quantity_id, kind: 'link_strength', from: ends.from, to: ends.to, side, strength,
      authored_by: strengthAuthor(edge),
      user_stated_link: isUserStatedLink(edge),
    } };
  }

  const { p_goal_if_absent: pa, p_goal_if_present: pp, n_absent: na, n_present: np } = top;
  if (!unitInterval(pa) || !unitInterval(pp) || !positiveCount(na) || !positiveCount(np)) return none('none');
  const side = fallingSide(pa, pp, 'absent' as const, 'present' as const);
  if (side === null) return none('none');
  return { driver: {
    quantity_id, kind: 'link_existence', from: ends.from, to: ends.to, side,
    ...groupPct(side === 'absent' ? pa : pp, side === 'absent' ? na : np),
    // Ruling 4: existence < 1 is ALWAYS Olumi's prior unless the link is held, even on the user's own link.
    // S-DEF: only the USER's own held link makes the doubt theirs; a definition's hold is nobody's doubt (and leaves the ranking).
    authored_by: heldLinkOf(edge, endsOfGraph(graph)(edge))?.reason === 'user_range' ? 'user' : 'olumi',
    user_stated_link: isUserStatedLink(edge),
  } };
}
