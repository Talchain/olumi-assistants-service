/**
 * ⭐ THE ONE READER OF A LEVEL-LESS MEDIATOR'S UNIT (no-dead-end slice (B)+(C); MC 21 owns the chain; Science d5
 * #87 6006425419 gauge, 6006548763 carrier (i), 6006685510 label + brief3 fallback).
 *
 * The dead end it closes (MC G1 ceiling, 0 LLM, 9 stored withholds on CEE 21ef54cc): a Run withholds its leader because a
 * goal path runs through a mediator Olumi drafted with no unit and no level ("Annual security audit gross profit",
 * "Online rescheduling failures"). The user cannot size the link out of it: the writer has no unit to read their words in.
 *
 * Three readings, never stored on the node (`data.unit` is outside the analysis hash, DL 5999243055):
 *   · `sized_parents` (C): every sized parent link is Olumi's estimate with a natural effect, and they agree on ONE unit U
 *     that U-GRAMMAR reads. A sized parent already fixes M's scale, so U is M's unit; M keeps its own frame. Derived from
 *     the parents' hashed `natural_effect.amount_unit`, so a corrected parent unit re-derives it (the answered child link
 *     then no longer matches: unit_mismatch, re-asked, never silently re-read).
 *   · `gauge` (B): no parent is sized in units, so M's scale is arbitrary: only lever→M × M→child reaches the goal. M is
 *     measured in its one child's units on the child's frame, M→child = ±1 (`sized_by_identity: { op: 'gauge' }`, written
 *     with the user's answer, never before), and the user's end-to-end answer sizes lever→M. After the answer the stored
 *     gauge edge is the reading's evidence. brief3's fallback (d5 6006685510 (2)): when (C) is refused ONLY because U-GRAMMAR
 *     cannot read U, and M's one sized parent is the lever's own link, the gauge applies and the answer replaces Olumi's
 *     estimate on that link (`replaces`).
 *   · `definitional_part` (FA1, Science d5 6 Oct): M's one goal-path out-link is a definition (±1 per 1, one unit at both
 *     ends) into a total that has that unit, so M is measured in it. Only where no other reading applies; never from a
 *     non-definitional link. It lets (C) ask, and the writer take, a link INTO such a part.
 *
 * Common conditions: M is a factor, risk or outcome on a goal path, not the goal; it has no unit and no level; it has
 * exactly ONE child on the goal path. A unit-bearing label (a currency token, %, a points spelling, or "per <noun>") is
 * never gauged (Science: ask its level instead); under (C) it must not conflict with U on any part both state (C3,
 * `carrierCompatible`), and a period the label names (full reader) must not conflict with U's.
 */
import { magnitudeNodes, percentLevelIds } from '../../cee/magnitude/frame-defaulted-links.js';
import { resolveMagnitudeFrame, unitOf, type MagnitudeNode } from '../../cee/magnitude/link-effect.js';
import { POINTS_SPELLINGS, periodAdverb, periodNoun, type UnitPeriod } from '../../utils/unit-alphabet.js';
import { carrierCompatible, readUnitParts, sameUnit, singular, words, type UnitParts } from './same-unit.js';
import { licenceUnsizedLink } from './goal-certainty.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export type MediatorReading =
  | { readonly via: 'sized_parents'; readonly unit: string; readonly child: string; readonly parents: readonly string[] }
  | {
    readonly via: 'gauge'; readonly unit: string; readonly scale_frame: number; readonly child: string;
    /** The stored gauge edge is the evidence (after the user's answer). */
    readonly stored?: true;
    /** brief3's fallback: the lever whose Olumi-sized link into M the answer replaces. */
    readonly replaces?: string;
  }
  /** FA1 (Science d5, 6 Oct): M is a definitional part of its one child, so it is measured in that total's unit. */
  | { readonly via: 'definitional_part'; readonly unit: string; readonly child: string };

/** The provenance marker of a gauge link (Science 6006425419). */
export const GAUGE_OP = 'gauge' as const;

export function isGaugeLink(edge: unknown): boolean {
  const p = isRec(edge) && isRec(edge.provenance) ? edge.provenance : undefined;
  return isRec(p?.sized_by_identity) && p.sized_by_identity.op === GAUGE_OP;
}

const CURRENCY_IN_LABEL = /(?:A\$|C\$|NZ\$|[£$€¥₹])|\b(?:GBP|USD|EUR|AUD|CAD|NZD|JPY|INR|CHF)\b/u;
const PERCENT_IN_LABEL = /%|\bper\s?cent\b|\bpercent(?:age)?\b|\bpct\b/iu;
const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const POINTS_IN_LABEL = new RegExp(`(?:^|[^\\p{L}])(?:${[...POINTS_SPELLINGS].sort((a, b) => b.length - a.length).map(escape).join('|')})(?![\\p{L}])`, 'iu');

/** The unit parts a LABEL states, or null when it is not unit-bearing (Science 6006685510 (1)). */
export function labelUnitParts(label: unknown): Partial<Pick<UnitParts, 'kind' | 'code' | 'per'>> | null {
  if (typeof label !== 'string') return null;
  const per = [...label.matchAll(/\bper\s+(\p{L}[\p{L}\p{M}-]*)/giu)].map(m => m[1]!.toLowerCase())
    .filter(w => periodNoun(w) === null);
  const currency = CURRENCY_IN_LABEL.exec(label)?.[0];
  const code = currency === undefined ? undefined : readUnitParts(currency)?.code ?? undefined;
  const points = POINTS_IN_LABEL.test(label);
  const percent = !points && PERCENT_IN_LABEL.test(label);
  if (currency === undefined && !points && !percent && per.length === 0) return null;
  return {
    ...(currency !== undefined ? { kind: 'currency' as const, code: code ?? null } : points ? { kind: 'points' as const } : percent ? { kind: 'percent' as const } : {}),
    ...(per.length > 0 ? { per: per.map(singular) } : {}),
  };
}

/** C3 on the parts the label states: no part both state conflicts (d5: "Revenue (£)" vs "£ a month" passes). */
function labelFitsUnit(label: Partial<Pick<UnitParts, 'kind' | 'code' | 'per'>>, u: UnitParts): boolean {
  return carrierCompatible(
    { kind: label.kind ?? u.kind, code: label.kind === undefined ? u.code : label.code ?? null, scale: 1,
      noun: u.noun, per: label.per ?? null, base: null, qualifiers: null, period: null },
    u,
  );
}

/** Every period the label names, by the full reader (nouns and adverbs alike: "Monthly fees" names month). */
function labelPeriods(label: unknown): Set<UnitPeriod> {
  return new Set(typeof label === 'string'
    ? words(label).flatMap(w => { const p = periodNoun(w) ?? periodAdverb(w); return p === null ? [] : [p]; }) : []);
}

const hasLevel = (n: Rec): boolean => isRec(n.observed_state)
  && ['value', 'raw_value', 'baseline'].some(k => { const v = (n.observed_state as Rec)[k]; return v !== undefined && v !== null; });

/** Every mediator reading of a graph, by node id. Pure; one pass. */
export function mediatorReadings(graph: unknown): Map<string, MediatorReading> {
  const out = new Map<string, MediatorReading>();
  if (!isRec(graph) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) return out;
  const nodes = graph.nodes.filter(isRec);
  // Directed links only: a bidirected pair is a shared cause, never a path a gauge can size.
  const edges = graph.edges.filter(isRec).filter(e => e.edge_type !== 'bidirected');
  const byId = new Map(nodes.map(n => [n.id, n] as const));
  const goal = nodes.find(n => n.kind === 'goal');
  if (goal === undefined || typeof goal.id !== 'string') return out;
  const walkable = (id: unknown): boolean => { const k = byId.get(id)?.kind; return k !== undefined && k !== 'option' && k !== 'decision'; };
  const reaches = new Set<unknown>([goal.id]);
  for (let grew = true; grew;) {
    grew = false;
    for (const e of edges) if (reaches.has(e.to) && !reaches.has(e.from) && walkable(e.from)) { reaches.add(e.from); grew = true; }
  }
  const view = magnitudeNodes(nodes, percentLevelIds(graph));
  for (const m of nodes) {
    const id = m.id;
    if (typeof id !== 'string' || id === goal.id || !['factor', 'risk', 'outcome'].includes(String(m.kind)) || !reaches.has(id)) continue;
    const mv = view.get(id);
    if (mv === undefined || unitOf(mv) !== undefined || hasLevel(m)) continue;
    const kids = edges.filter(e => e.from === id && reaches.has(e.to));
    if (kids.length !== 1 || typeof kids[0]!.to !== 'string') continue;
    const childId = kids[0]!.to as string;
    const cv = view.get(childId);
    const childUnit = cv === undefined ? undefined : unitOf(cv);
    const childFrame = cv === undefined ? undefined : resolveMagnitudeFrame(cv);
    // ⛔ A gauge only ever sizes a link NOBODY sized (P5's unsized: an Olumi placeholder or a projected mean), never the
    // user's figure, a definition or Olumi's sized estimate: the writer overwrites M→child with it.
    const kidProvenance = isRec(kids[0]!.provenance) ? kids[0]!.provenance as Rec : {};
    // ⛔ Codex r1 P1: rescaling M (M→child = ±1) rescales EVERY path through M, so a gauge is only a pure CHAIN link: M has
    // exactly one parent and one child in the whole graph, and the child is not a product of M (an identity operand).
    const childNode = byId.get(childId);
    const operand = isRec(childNode?.nonlinear_identity) && Array.isArray(childNode!.nonlinear_identity.factor_ids)
      && (childNode!.nonlinear_identity.factor_ids as unknown[]).includes(id);
    const chainOnly = !operand && edges.filter(e => e.from === id).length === 1
      && edges.filter(e => e.to === id && walkable(e.from)).length === 1;
    const kidUnsized = !isRec(kidProvenance.natural_effect) && kidProvenance.definitional !== true
      && licenceUnsizedLink(kids[0]) && kidProvenance.source !== 'user_specified';
    const gauge = (extra: { stored?: true; replaces?: string }): MediatorReading | null =>
      childUnit === undefined || childFrame === undefined || (extra.stored !== true && (!kidUnsized || !chainOnly)) ? null
        : { via: 'gauge', unit: childUnit, scale_frame: childFrame, child: childId, ...extra };
    // After the user's answer, the stored gauge edge IS the reading (its parent is now the user's), but ONLY while it is
    // still intact (Codex r2 P1): Olumi's ±1, no size of its own, no definition, and still a pure chain. A gauge someone
    // has since edited (a band edit keeps the marker), or a later second parent or child of M, breaks it: no reading, so
    // M has no unit again and a re-answer is refused, never written over the edit or across another path.
    if (isGaugeLink(kids[0])) {
      const kidMean = isRec(kids[0]!.strength) ? (kids[0]!.strength as Rec).mean : undefined;
      const intact = chainOnly && kidProvenance.magnitude === 'olumi_estimate' && kidProvenance.source !== 'user_specified'
        && !isRec(kidProvenance.natural_effect) && kidProvenance.definitional !== true && (kidMean === 1 || kidMean === -1);
      const r = intact ? gauge({ stored: true }) : null;
      if (r !== null) out.set(id, r);
      continue;
    }
    const label = labelUnitParts(m.label);
    const parents = edges.filter(e => e.to === id && walkable(e.from));
    const sized = parents.filter(e => isRec(e.provenance) && isRec(e.provenance.natural_effect));
    if (sized.length > 0) {
      // (C) Every sized parent is Olumi's estimate with a natural effect: never a placeholder, a projected mean or the user's.
      if (!sized.every(e => (e.provenance as Rec).magnitude === 'olumi_estimate' && !licenceUnsizedLink(e))) continue;
      const units = sized.map(e => ((e.provenance as Rec).natural_effect as Rec).amount_unit);
      if (!units.every((u): u is string => typeof u === 'string' && u.trim() !== '')) continue;
      const u = units[0]!;
      // Identity first: an unreadable U equals itself (brief3's "£ over 2 years"); otherwise the U1 comparator.
      if (!units.every(x => x === u || sameUnit(u, x))) continue;
      const parts = readUnitParts(u);
      if (parts === null) {
        // d5 (2): (C) refused ONLY for an unreadable U, M's one sized parent is the lever's own link → the gauge, and the
        // answer replaces Olumi's estimate on that link. A unit-bearing label is never gauged.
        const lever = sized.length === 1 && typeof sized[0]!.from === 'string' ? view.get(sized[0]!.from) : undefined;
        if (label !== null || lever === undefined || unitOf(lever) === undefined) continue;
        const r = gauge({ replaces: sized[0]!.from as string });
        if (r !== null) out.set(id, r);
        continue;
      }
      if (label !== null && !labelFitsUnit(label, parts)) continue;
      const periods = labelPeriods(m.label);
      if (periods.size > 1 || (periods.size === 1 && parts.period !== null && !periods.has(parts.period))) continue;
      out.set(id, { via: 'sized_parents', unit: u, child: childId, parents: sized.map(e => String(e.from)) });
      continue;
    }
    // (B) No parent sized in units: the gauge, only when a user answer can still size the path (a parent with a unit),
    // and never for a unit-bearing label (asked for its level instead).
    if (label !== null || !parents.some(e => { const pv = view.get(e.from as string); return pv !== undefined && unitOf(pv) !== undefined; })) continue;
    const r = gauge({});
    if (r !== null) out.set(id, r);
  }
  // ⭐ FA1 (Acceptance e7; Science d5 ruling, 6 Oct): a DEFINITIONAL PART takes its total's unit. M meets the common
  // conditions, has no other reading, and its ONE goal-path out-link is a definition, ±1 per 1 in one unit at both ends (the
  // hashed `natural_effect`), into a total that has that unit of its own. Olumi's definitional flag is enough: the card the
  // user approves says the reading. Never from a non-definitional link, whatever its figure.
  for (const m of nodes) {
    const id = m.id;
    if (typeof id !== 'string' || out.has(id) || id === goal.id || !['factor', 'risk', 'outcome'].includes(String(m.kind)) || !reaches.has(id)) continue;
    const mv = view.get(id);
    if (mv === undefined || unitOf(mv) !== undefined || hasLevel(m)) continue;
    const kids = edges.filter(e => e.from === id && reaches.has(e.to));
    if (kids.length !== 1 || typeof kids[0]!.to !== 'string') continue;
    const childId = kids[0]!.to as string;
    const unit = definitionalPartUnit(kids[0]!, view.get(childId));
    const parts = unit === undefined ? null : readUnitParts(unit);
    if (unit === undefined || parts === null) continue;
    const label = labelUnitParts(m.label);
    if (label !== null && !labelFitsUnit(label, parts)) continue;
    const periods = labelPeriods(m.label);
    if (periods.size > 1 || (periods.size === 1 && parts.period !== null && !periods.has(parts.period))) continue;
    // A sized parent that states M in another unit is a conflict, never a choice.
    const parentUnits = edges.filter(e => e.to === id && walkable(e.from) && isRec(e.provenance) && isRec(e.provenance.natural_effect))
      .map(e => ((e.provenance as Rec).natural_effect as Rec).amount_unit);
    if (parentUnits.some(u => typeof u !== 'string' || (u !== unit && !sameUnit(unit, u)))) continue;
    out.set(id, { via: 'definitional_part', unit, child: childId });
  }
  return out;
}

/** The unit a definitional ±1-per-1 link states at both ends, when its total carries that unit too; else undefined. */
function definitionalPartUnit(e: Rec, total: MagnitudeNode | undefined): string | undefined {
  const p = isRec(e.provenance) ? e.provenance : undefined;
  const ne = p?.definitional === true && isRec(p.natural_effect) ? p.natural_effect : undefined;
  if (ne === undefined || typeof ne.amount !== 'number' || Math.abs(ne.amount) !== 1 || ne.per_source_change !== 1) return undefined;
  const u = ne.amount_unit;
  const per = ne.per_source_change_unit;
  if (typeof u !== 'string' || u.trim() === '' || typeof per !== 'string' || (per !== u && !sameUnit(u, per))) return undefined;
  const totalUnit = total === undefined ? undefined : unitOf(total);
  return totalUnit !== undefined && (totalUnit === u || sameUnit(totalUnit, u)) ? u : undefined;
}

/**
 * A writer's view of one END of a link: the stored node, plus M's derived unit (and, for a gauge, the child's frame).
 * `arm` matters: a gauge measures M only as the TARGET of the user's end-to-end answer (lever→M); M→child is never
 * sized separately (MC 21: "never ask about the two links separately"), so as a source a gauge reading adds nothing.
 */
export function withMediatorReading(node: MagnitudeNode, reading: MediatorReading | undefined, arm: 'source' | 'target'): MagnitudeNode {
  if (reading === undefined || (reading.via === 'gauge' && arm === 'source')) return node;
  return { ...node, unit: reading.unit, ...(reading.via === 'gauge' ? { scale_frame: reading.scale_frame } : {}) };
}
