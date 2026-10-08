/**
 * ⭐ D3 cut 6, HOLD-AT-1.0 (Science d5 #87 6008807178 / 6008817484). A link the USER stated, whose own stated range
 * excludes zero, holds at exists_probability 1.0 on the Run's input: the user said the effect is there and which way it
 * goes, so Olumi's 0.8 existence prior must not doubt it a second time. Its spread is the range's: sd_β =
 * |β(high) − β(low)| / 3.29 (a 90% range), and its mean stays the STATED size (never the range's midpoint).
 *
 * ONE function for every reader that sends or shows existence: the PLoT payload (`run-analysis`), the licence's existence
 * flag (`userStatedLinksBelowOne`) and the input snapshot (captured from the payload). The persisted graph is never
 * written. No range → no hold: a spread derived from the edge's own mean ± k·std would be circular.
 *
 * ⭐ A VALIDATED DEFINITION holds too, whoever drew it (Science d5 #87 6011224941; DL): "Starter-tier MRR" → "MRR" at +£1
 * per £1 is an accounting identity, not a 20% chance that Starter revenue isn't revenue. `validatedDefinition` below.
 *
 * ⭐ RULE R, ROUTE-ONCE (Science 393023; DESIGN science-mechanism-doubt-DESIGN.md §2/§6; DL 0fd71f, 7 Oct). Olumi's own
 * existence doubt (a blanket 0.8 on every drafted causal link) is counted ONCE per route, so an option's chance reflects
 * what the team believes about each route, not how many boxes Olumi drew (R5: freelance 0.636 → 0.792 beside hire 0.801).
 * A link that is Olumi's DEFAULT doubt (`defaultExistence`) whose SOURCE is covered (every route into it already carries
 * one) holds at existence 1.0 on the Run's input; its strength is untouched. The route's FIRST default link is never held,
 * so every route that carried Olumi's doubt still carries exactly one (I1). Relational, so `endsOfGraph` computes it once
 * per graph (`LinkEnds.routeOnce`) and every reader of `heldLinkOf` sees it. `reason` says WHICH hold: only `user_range`
 * is the user's; `route_once` is Olumi's bookkeeping. Fail-closed: a cycle anywhere holds nothing by this rule; a link
 * ISL FIXES rather than draws (an identity operand, an event risk's mitigation) is never default, so it never gives cover;
 * a bidirected link, or one touching a node kept out of the calculation, is not in the route structure at all. An event
 * risk's OCCURRENCE is never a route's doubt for this rule (occurrence is not existence): only drawn link existence covers.
 */
import { eventShareEndpointMatches } from './share-by-date-carrier.js';
import { linkSizing } from '../../cee/magnitude/link-sizing.js';
import { nodeUnitOf } from '../../orchestrator/context/placeholder-parts.js';
import { sameUnit } from '../agent-lane/same-unit.js';
import { isRetainedExcluded } from '../tools/handlers/run-analysis-participation-guard.js';

type Rec = Record<string, any>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

const TOL = 1e-9;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOL * Math.max(1, Math.abs(b));

function carriesStatedSize(e: Rec, beta: number): boolean {
  const mean = isRec(e.strength) ? e.strength.mean : undefined;
  if (!finite(mean)) return false;
  if (near(mean, beta)) return true;
  const clampedFrom = isRec(e.provenance) ? e.provenance.clamped_from : undefined;
  return finite(clampedFrom) && near(clampedFrom, beta) && near(Math.abs(mean), 1) && Math.sign(mean) === Math.sign(beta);
}

/**
 * ⭐ THE ONE "CURRENT DEFINITIONAL CARRIER" (DL #87, 6 Oct; Codex r1 #2653 P1): a link typed definitional whose stored size
 * is still that definition: ±1 per 1 in ONE unit at both ends (the hashed `natural_effect`), and the edge still carries that
 * β, or a verified stored clamp of it (`carriesStatedSize`). A strength or band write that keeps the flag but moves the size
 * (adjust-edge-strength keeps `definitional`) is no longer a definition. Returns the definition's unit, else undefined.
 * Read by the definitional part's unit (`mediatorReadings`, FA1) and, through `validatedDefinition`, by the hold.
 */
export function currentDefinitionalCarrier(e: unknown): string | undefined {
  if (!isRec(e) || !isRec(e.provenance) || e.provenance.definitional !== true) return undefined;
  const ne = e.provenance.natural_effect;
  if (!isRec(ne) || !finite(ne.amount) || Math.abs(ne.amount) !== 1 || ne.per_source_change !== 1 || !finite(ne.strength_mean)) return undefined;
  const u = ne.amount_unit;
  const per = ne.per_source_change_unit;
  // The SAME unit string at both ends (a drafted definition copies it): exact, so the UI's mirror (`heldUserLink.ts`) reads
  // it identically with no unit grammar of its own.
  if (typeof u !== 'string' || u.trim() === '' || per !== u) return undefined;
  return carriesStatedSize(e, ne.strength_mean) ? u : undefined;
}

/**
 * The two ends of a link as the validated-definition test reads them: the labels, and the unit each end's level is read in
 * (`nodeUnitOf`, the reading `holdsByDefinition` (DL #75) already uses). Built once per graph (`endsOfGraph`) and passed to
 * every reader, so no reader holds a link another does not.
 */
export interface LinkEnds {
  readonly fromLabel: string | undefined;
  readonly fromId?: string;
  readonly fromKind?: string;
  readonly toKind?: string;
  readonly toId?: string;
  readonly toLabel: string | undefined;
  readonly fromUnit: string | undefined;
  readonly toUnit: string | undefined;
  readonly routeOnce: boolean;
  /**
   * ISL FIXES this link, never draws it (Science 393023): an IDENTITY operand (the target's `nonlinear_identity` lists the
   * source) or an event risk's MITIGATION (the target's `event_risk.mitigations` names the source; ISL applies −p̄·m at
   * existence 1). Neither is a doubt ISL draws, so it is never default and never gives cover.
   */
  readonly fixedByIsl?: boolean;
}

/** Ends with no labels and no units: nothing validates against them (a non-record edge). */
const UNVALIDATED_ENDS: LinkEnds = Object.freeze({ fromLabel: undefined, toLabel: undefined, fromUnit: undefined, toUnit: undefined, routeOnce: false });

/**
 * Science 393023 rule R (route-once), DESIGN science-mechanism-doubt-DESIGN.md §2/§6.
 * Pure O(V+E) coverage: every incoming route must already carry default existence doubt.
 * Kahn's order detects any directed cycle; a cycle withholds coverage throughout the graph.
 * Callers supply structural links only (snapshot links already represent sent structure).
 */
export function routeOnceCoveredSources(links: readonly { from: string; to: string; isDefault: boolean }[]): ReadonlySet<string> {
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, (typeof links)[number][]>();
  for (const link of links) {
    if (!incoming.has(link.from)) incoming.set(link.from, 0);
    incoming.set(link.to, (incoming.get(link.to) ?? 0) + 1);
    const out = outgoing.get(link.from);
    if (out === undefined) outgoing.set(link.from, [link]);
    else out.push(link);
  }
  const remaining = new Map(incoming);
  const uncovered = new Set<string>();
  const covered = new Set<string>();
  const queue = [...incoming].filter(([, count]) => count === 0).map(([id]) => id);
  for (let i = 0; i < queue.length; i++) {
    const source = queue[i]!;
    if (incoming.get(source)! > 0 && !uncovered.has(source)) covered.add(source);
    for (const link of outgoing.get(source) ?? []) {
      if (!link.isDefault && !covered.has(source)) uncovered.add(link.to);
      const count = remaining.get(link.to)! - 1;
      remaining.set(link.to, count);
      if (count === 0) queue.push(link.to);
    }
  }
  return queue.length === incoming.size ? covered : new Set<string>();
}

export function endsOfGraph(graph: unknown): (e: unknown) => LinkEnds {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  // Per target node, the sources ISL FIXES rather than draws: identity operands, and an event risk's mitigations (read
  // loosely, fail-closed: any `factor_id` named there is excluded, whether or not the block would pass the write door).
  const fixedSources = new Map(nodes.map((n) => [n.id, new Set<unknown>([
    ...(isRec(n.nonlinear_identity) && Array.isArray(n.nonlinear_identity.factor_ids) ? n.nonlinear_identity.factor_ids : []),
    ...(isRec(n.event_risk) && Array.isArray(n.event_risk.mitigations)
      ? n.event_risk.mitigations.filter(isRec).map((m) => m.factor_id) : []),
  ])] as const));
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
  const unitOf = nodeUnitOf(nodes);
  // The route structure is the graph the Run is SENT (Codex buddy r1 P1): `guardAnalysisParticipation` withholds a node the
  // user kept out of the calculation, and every link touching it, before the hold. So such a node never covers, is never
  // covered, and its links are never held — on the Run, the hash, the Agent and the LLM context alike.
  const participating = new Set(nodes.filter((n) => !isRetainedExcluded(n)).map((n) => n.id));
  // A BIDIRECTED link is not a route at all (Codex buddy r2 P1): PLoT sends ISL directed links only
  // (`translator-v3.ts` "ISL operates on directed edges only"), so it neither covers its target nor is ever held.
  const structural = (e: Rec): boolean => typeof e.from === 'string' && typeof e.to === 'string'
    && participating.has(e.from) && participating.has(e.to) && e.edge_type !== 'bidirected';
  const baseEnds = (e: Rec): LinkEnds => ({
    // S-E GOALS S2b: the actual endpoint ids and kinds, so a minted share_by_date carrier binds to real nodes.
    fromId: text(byId.get(e.from)?.id), toId: text(byId.get(e.to)?.id),
    fromKind: text(byId.get(e.from)?.kind), toKind: text(byId.get(e.to)?.kind),
    fromLabel: text(byId.get(e.from)?.label), toLabel: text(byId.get(e.to)?.label),
    fromUnit: unitOf(e.from), toUnit: unitOf(e.to), routeOnce: false,
    ...(fixedSources.get(e.to)?.has(e.from) ? { fixedByIsl: true } : {}),
  });
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const covered = routeOnceCoveredSources(edges.filter(structural).map((e) => ({
    from: e.from, to: e.to, isDefault: defaultExistence(e, baseEnds(e)),
  })));
  return (e) => isRec(e) ? { ...baseEnds(e), routeOnce: structural(e) && covered.has(e.from) } : UNVALIDATED_ENDS;
}

const QUANTITY_STOP = new Set(['a', 'an', 'the', 'of', 'to', 'from', 'for', 'in', 'on', 'per', 'by', 'and', 'or', 'with', 'at', 'into', 'its', 'their']);
const singularWord = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const quantityWords = (label: string): string[] =>
  label.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w !== '' && !QUANTITY_STOP.has(w)).map(singularWord);

/**
 * Science d5 (#87 6011224941): the SOURCE label holds every content word of the TARGET's quantity ("Starter-tier monthly
 * recurring revenue" → "monthly recurring revenue"), or the target's acronym ("Starter-tier MRR" → "monthly recurring
 * revenue"). Plurals fold to the singular. Exact words only: a word the source does not hold is never inferred, so a near
 * miss stays Olumi's disclosed estimate (fails safe). "Pipeline value" → "revenue" and "Support cost" → "MRR" hold none.
 */
export function labelHoldsQuantity(sourceLabel: string, targetLabel: string): boolean {
  const source = new Set(quantityWords(sourceLabel));
  const target = quantityWords(targetLabel);
  if (source.size === 0 || target.length === 0) return false;
  if (target.every((w) => source.has(w))) return true;
  return target.length >= 2 && source.has(target.map((w) => w[0]).join(''));
}

/**
 * ⭐ A VALIDATED DEFINITION (Science d5 #87 6011224941, correcting 6009797390's drafter-only clause; DL ruling), WHOEVER
 * flagged it:
 *   1. a CURRENT definitional carrier (`currentDefinitionalCarrier`: ±1 per 1, one unit at both ends of its size, its β
 *      still carried or a verified stored clamp of it, so the saved link and the Run's restored copy agree; Codex r2 #2665);
 *   2. `sameUnit` at both ends, as `holdsByDefinition` (DL #75 5916504679) reads them: the total's level is read in that
 *      unit (REQUIRED), and the part's too where its node carries one;
 *   3. the source label holds the target's quantity words (`labelHoldsQuantity`).
 * A flag that fails any clause is not a definition: an Olumi link keeps its 0.8 and is disclosed. Returns the
 * definition's unit, else undefined.
 */
export function validatedDefinition(e: unknown, ends: LinkEnds): string | undefined {
  const u = currentDefinitionalCarrier(e);
  if (u === undefined) return undefined;
  if (ends.toUnit === undefined || !sameUnit(ends.toUnit, u) || (ends.fromUnit !== undefined && !sameUnit(ends.fromUnit, u))) return undefined;
  // Admission's durable, endpoint-bound team definition survives renaming.
  const carrier = isRec(e) && isRec(e.provenance) ? e.provenance.share_by_date : undefined;
  if (carrier !== undefined) return isRec(carrier) && u === `% of ${carrier.deliverable}`
    && eventShareEndpointMatches(e, { id: ends.fromId, kind: ends.fromKind }, { id: ends.toId, kind: ends.toKind }) ? u : undefined;
  return ends.fromLabel !== undefined && ends.toLabel !== undefined && labelHoldsQuantity(ends.fromLabel, ends.toLabel) ? u : undefined;
}

/** RC4's graph-bound definition reader, using the same endpoint ID as GoalPathLink. Ambiguous links stay estimates. */
export function validatedDefinitionForGraph(graph: unknown): (linkId: string) => string | undefined {
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges.filter(isRec) : [];
  const ends = endsOfGraph(graph);
  return linkId => {
    const matches = edges.filter(e => typeof e.from === 'string' && typeof e.to === 'string' && `${e.from}->${e.to}` === linkId);
    return matches.length === 1 ? validatedDefinition(matches[0], ends(matches[0])) : undefined;
  };
}

/** A definitional link's spread on the Run input: the structural minimum (d5). */
const DEFINITIONAL_STD = 0.01;

/** The z-width of a 90% range: 2 × 1.645. */
const RANGE_90_WIDTH_Z = 3.29;

/**
 * The licence's "the user's link" class: the user sized it, or their brief stated it WITH its evidence. Science d5 #87
 * 6008444863: a `brief_extraction` edge without its `source_quote` may be a drafter-invented mediator, never "your link".
 */
export function isUserStatedLink(e: unknown): boolean {
  if (!isRec(e)) return false;
  if (linkSizing(e) === 'user') return true;
  const p = e.provenance;
  return isRec(p) && p.source === 'brief_extraction' && typeof p.source_quote === 'string' && p.source_quote.trim() !== '';
}

/**
 * The hold for one edge, or `null`.
 *   - ⭐ DEFINITIONAL (Science d5 #87 6011224941, correcting 6009797390's drafter-only clause): a VALIDATED definition (a
 *     part → its total, ±1 per 1) is exact WHOEVER flagged it, so it holds with no range, at the structural minimum spread
 *     (as on option → factor edges), never the ±50% default. The mechanism's doubt stays on the upstream causal link. A
 *     flag that fails validation is not a definition, whoever flagged it (Codex r1 #2665 P1): an Olumi link keeps 0.8; a
 *     user's link is an ordinary user link (held only by its own range, below).
 *   - A link the USER stated whose own range excludes zero (#2643).
 *   - Rule R: default existence doubt whose source is covered on every route; its strength stays untouched.
 */
export type HoldReason = 'definition' | 'user_range' | 'route_once';
type BaseHold = { readonly reason: 'definition' | 'user_range'; readonly std: number };
export type LinkHold = BaseHold | { readonly reason: 'route_once'; readonly std: number | undefined };

/** The validated definition, then user range hold, before rule R (history only). */
export function heldLinkBeforeRouteOnce(e: unknown, ends: LinkEnds): BaseHold | null {
  if (validatedDefinition(e, ends) !== undefined) return { reason: 'definition', std: DEFINITIONAL_STD };
  const range = isUserStatedLink(e) ? rangeHold(e as Rec) : null;
  return range === null ? null : { reason: 'user_range', std: range.std };
}

function defaultExistence(e: Rec, ends: LinkEnds): boolean {
  return finite(e.exists_probability) && e.exists_probability > 0 && e.exists_probability < 1
    && ends.fixedByIsl !== true && heldLinkBeforeRouteOnce(e, ends) === null;
}

export function heldLinkOf(e: unknown, ends: LinkEnds): LinkHold | null {
  const base = heldLinkBeforeRouteOnce(e, ends);
  if (base !== null) return base;
  if (!isRec(e) || !ends.routeOnce || !defaultExistence(e, ends)) return null;
  return { reason: 'route_once', std: isRec(e.strength) && finite(e.strength.std) ? e.strength.std : undefined };
}

/** The existence the wire sends. With no ends, read an already-projected wire edge without applying a hold again. */
export function effectiveLinkExistenceProbability(e: unknown, ends?: LinkEnds): number | undefined {
  if (ends !== undefined && heldLinkOf(e, ends) !== null) return 1;
  return isRec(e) && finite(e.exists_probability) && e.exists_probability >= 0 && e.exists_probability <= 1
    ? e.exists_probability : undefined;
}

/**
 * HISTORY ONLY (`graph-hash.ts` 'pre_definition'): the hold as #2643 + #2653 computed it before the validated rule — the
 * user's links only, their definitional flag held unvalidated. A model version or Run recorded then is still that one.
 * Never a Run, freshness or display reader.
 */
export function heldLinkBeforeValidatedDefinition(e: unknown): { readonly std: number } | null {
  if (!isUserStatedLink(e)) return null;
  if (currentDefinitionalCarrier(e) !== undefined) return { std: DEFINITIONAL_STD };
  return rangeHold(e as Rec);
}

/**
 * A user link's RANGE hold. β is linear in the stated amount, so each end of the range maps through the size the link
 * carries: β(x) = x · strength_mean / amount. `natural_effect` is the user's size while it is current: every write of the
 * strength or the size drops or replaces it (refit-frames, CODEX 5925312387), and reframing rescales it with the edge.
 */
function rangeHold(e: Rec): { readonly std: number } | null {
  const ne = e.provenance?.natural_effect;
  if (!isRec(ne) || !isRec(ne.stated_range)) return null;
  const { low, high } = ne.stated_range;
  if (!finite(low) || !finite(high) || !finite(ne.amount) || ne.amount === 0 || !finite(ne.strength_mean)) return null;
  // ⛔ CURRENT CARRIER ONLY (Codex r1 #2643 P1): a writer that changed the strength and kept `natural_effect` (a quoted
  // brief link sized by Olumi) leaves it stale. Held only while the link still carries the user's β, or a verified stored
  // clamp of it (|mean| 1, same sign, `clamped_from` = that β), the same rule `withStatedStrengths` applies.
  if (!carriesStatedSize(e, ne.strength_mean)) return null;
  // Excludes zero: both ends strictly on one side. A range touching or crossing zero says the effect may not be there.
  if (!((low > 0 && high > 0) || (low < 0 && high < 0))) return null;
  const std = Math.abs((high - low) * (ne.strength_mean / ne.amount)) / RANGE_90_WIDTH_Z;
  return finite(std) && std > 0 ? { std } : null;
}

/**
 * The Run-input graph with every held link at exists_probability 1.0. Only base holds change spread; rule R retains
 * the exact strength object. The SAME object when nothing
 * is held; otherwise a copy (the persisted graph is never written). Runs after `withStatedStrengths`, which rescales a
 * restored clamp's std: the held std is already on the stated β's own frame.
 */
export function withHeldUserLinks<G>(graph: G): G {
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges : [];
  const endsOf = endsOfGraph(graph);
  const holds = edges.map((e: unknown) => heldLinkOf(e, endsOf(e)));
  if (holds.every((held: LinkHold | null) => held === null)) return graph;
  const g = structuredClone(graph) as Rec;
  g.edges = (g.edges as Rec[]).map((copy, i) => {
    const held = holds[i] as LinkHold | null;
    if (held === null) return copy;
    const exists_probability = effectiveLinkExistenceProbability(edges[i], endsOf(edges[i]));
    // Rule R changes only existence: the copy's strength (mean, std, absent or not) is the persisted one, byte for byte.
    // Built from the CLONE, never the persisted edge, so no nested object of the persisted graph is shared with the Run's.
    if (held.reason === 'route_once') return { ...copy, exists_probability };
    return { ...copy, exists_probability, strength: { ...(isRec(copy.strength) ? copy.strength : {}), std: held.std } };
  });
  return g as G;
}
