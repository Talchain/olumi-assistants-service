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
 */
import { linkSizing } from '../../cee/magnitude/link-sizing.js';

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
 * Read by the definitional part's unit (`mediatorReadings`, FA1) and, with the user-stated class, by the hold.
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
 * The two ends of a link as the validated-definition test reads them: the labels, and each end's OWN unit when it has one.
 * Built once per graph (`endsOfGraph`) and passed to every reader, so no reader holds a link another does not.
 */
export interface LinkEnds {
  readonly fromLabel: string | undefined;
  readonly toLabel: string | undefined;
  readonly fromUnit: string | undefined;
  readonly toUnit: string | undefined;
}

/**
 * Ends with no labels and no units: no link validates as a definition, so `heldLinkOf` reads the USER-only hold of
 * #2643/#2653. HISTORY ONLY (`graph-hash.ts` 'pre_definition' projection): a version recorded before the validated rule
 * is still that version. Never a Run, freshness or display reader: those pass `endsOfGraph(graph)`.
 */
export const UNVALIDATED_ENDS: LinkEnds = Object.freeze({ fromLabel: undefined, toLabel: undefined, fromUnit: undefined, toUnit: undefined });

export function endsOfGraph(graph: unknown): (e: unknown) => LinkEnds {
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
  const unitOf = (n: Rec | undefined): string | undefined => text(isRec(n?.observed_state) ? n!.observed_state.unit : undefined);
  return (e) => {
    if (!isRec(e)) return UNVALIDATED_ENDS;
    const from = byId.get(e.from);
    const to = byId.get(e.to);
    return { fromLabel: text(from?.label), toLabel: text(to?.label), fromUnit: unitOf(from), toUnit: unitOf(to) };
  };
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
 * ⭐ A VALIDATED DEFINITION (Science d5 #87 6011224941, correcting 6009797390's drafter-only clause; DL ruling): a CURRENT
 * definitional carrier (±1 per 1, ONE unit at both ends of its size, its β still carried) whose unit is each end's own
 * where that end has one, and whose source label holds the target's quantity words. WHOEVER flagged it. A flag that fails
 * any clause is not a definition: an Olumi link keeps its 0.8 and is disclosed. Returns the definition's unit, else
 * undefined. Exact unit strings, so the UI's mirror can read it with no unit grammar of its own.
 */
export function validatedDefinition(e: unknown, ends: LinkEnds): string | undefined {
  const u = currentDefinitionalCarrier(e);
  if (u === undefined) return undefined;
  if ((ends.toUnit !== undefined && ends.toUnit !== u) || (ends.fromUnit !== undefined && ends.fromUnit !== u)) return undefined;
  return ends.fromLabel !== undefined && ends.toLabel !== undefined && labelHoldsQuantity(ends.fromLabel, ends.toLabel) ? u : undefined;
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
 * The hold for one edge, or `null`. β is linear in the stated amount, so each end of the range maps through the size the
 * link carries: β(x) = x · strength_mean / amount. `natural_effect` is the user's size while it is current: every write of
 * the strength or the size drops or replaces it (refit-frames, CODEX 5925312387), and reframing rescales it with the edge.
 */
export function heldLinkOf(e: unknown, ends: LinkEnds): { readonly std: number } | null {
  // ⭐ DEFINITIONAL (Science d5 #87 6011224941, correcting the drafter-only clause of 6009797390): a VALIDATED definition
  // (a part → its total, ±1 per 1) is exact WHOEVER flagged it, so it holds with no range, at the structural minimum
  // spread (as on option → factor edges), never the ±50% default. The mechanism's doubt stays on the upstream causal link.
  if (validatedDefinition(e, ends) !== undefined) return { std: DEFINITIONAL_STD };
  if (!isUserStatedLink(e)) return null;
  // The user's OWN definitional link (stated, or quoted from their brief) holds as before (#2653; d5 6009797390 (a), which
  // 6011224941 left standing): the user is the authority on what their total is made of, labels or not.
  // ⛔ Codex r1 #2653 P1: only while the link still carries its definition (the ONE predicate): a band edit keeps the flag.
  if (currentDefinitionalCarrier(e) !== undefined) return { std: DEFINITIONAL_STD };
  const ne = (e as Rec).provenance?.natural_effect;
  if (!isRec(ne) || !isRec(ne.stated_range)) return null;
  const { low, high } = ne.stated_range;
  if (!finite(low) || !finite(high) || !finite(ne.amount) || ne.amount === 0 || !finite(ne.strength_mean)) return null;
  // ⛔ CURRENT CARRIER ONLY (Codex r1 #2643 P1): a writer that changed the strength and kept `natural_effect` (a quoted
  // brief link sized by Olumi) leaves it stale. Held only while the link still carries the user's β, or a verified stored
  // clamp of it (|mean| 1, same sign, `clamped_from` = that β), the same rule `withStatedStrengths` applies.
  if (!carriesStatedSize(e as Rec, ne.strength_mean)) return null;
  // Excludes zero: both ends strictly on one side. A range touching or crossing zero says the effect may not be there.
  if (!((low > 0 && high > 0) || (low < 0 && high < 0))) return null;
  const std = Math.abs((high - low) * (ne.strength_mean / ne.amount)) / RANGE_90_WIDTH_Z;
  return finite(std) && std > 0 ? { std } : null;
}

/**
 * The Run-input graph with every held link at exists_probability 1.0 and its range's spread. The SAME object when nothing
 * is held; otherwise a copy (the persisted graph is never written). Runs after `withStatedStrengths`, which rescales a
 * restored clamp's std: the held std is already on the stated β's own frame.
 */
export function withHeldUserLinks<G>(graph: G): G {
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges : [];
  const endsOf = endsOfGraph(graph);
  if (!edges.some((e: unknown) => heldLinkOf(e, endsOf(e)) !== null)) return graph;
  const g = structuredClone(graph) as Rec;
  for (const e of g.edges as unknown[]) {
    const held = heldLinkOf(e, endsOf(e));
    if (held === null) continue;
    const edge = e as Rec;
    edge.exists_probability = 1;
    edge.strength = { ...(isRec(edge.strength) ? edge.strength : {}), std: held.std };
  }
  return g as G;
}
