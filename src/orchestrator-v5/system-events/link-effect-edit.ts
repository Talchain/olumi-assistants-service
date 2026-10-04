/**
 * ⭐ THE USER-STATED LINK EFFECT — the canonical writer (DL #72 5882763151 item a; contract Canonical 5882780438).
 *
 * The user answers "how much does X move Y?" in NATURAL units ("every £1 on the price loses about 50 subscribers").
 * This writer sizes that one link with the construction path's own converter (`sizeLink`, `user_stated: true`, the
 * magnitude contract D2–D8), and stores exactly what it did:
 *   · `strength {mean, std}` from the sizing, `effect_direction` from the stated sign;
 *   · `provenance = {source: 'user_specified', magnitude: 'user_stated', natural_effect}` — the size said back in the
 *     units the user used, bound to the β it was written for (`strength_mean`);
 *   · Olumi's `reasoning` and the whole-edge `defaulted` flag go (a user statement is not Olumi's); the per-field
 *     `exists_defaulted` / `std_defaulted` keep what the statement did not state (A6e / A6f).
 * Since schemas 0.62.0 (projection v3) who sized a link and its natural unit are analysis inputs, so the write moves
 * the analysis revision and the prior Run reads stale — the placeholder-parts predicate reads exactly this.
 *
 * IT FABRICATES NOTHING. Every case it cannot do exactly is a typed refusal, and the served fallback stays "can't be
 * checked with this model yet": a unit that is not the end's own (no conversion by guess), an end with no frame, a
 * definitional link, a link that moved since the ask was prepared, words missing from the approval.
 *
 * IN-PROCESS by design: the Agent's two-request answer handler (Runtime) calls it through the approval door and
 * commits `mutatedGraph` + `handlerFacts` on the one CAS-guarded append, as `authoriseChange` does for values. Pure:
 * the stored graph is never mutated. No schemas release: the stored shape is CEE's declared `EdgeProvenanceV3` and the
 * receipt is the existing `adjust_edge_strength` fact.
 */
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { AdjustEdgeStrengthHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { magnitudeNodes, percentLevelIds } from '../../cee/magnitude/frame-defaulted-links.js';
import { resolveMagnitudeFrame, sizeLink, sourceUnitWords, targetUnitWords, unitAfterOne, unitOf, type LinkSizeProblem } from '../../cee/magnitude/link-effect.js';
import { createHash } from 'node:crypto';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { definitionalLinkInUse, type IdentityRunUse } from '../compose/definitional-links.js';
import { unitComparisonKey } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The user's statement, in the units of the link's two ends. */
export interface LinkEffectStatement {
  /** Signed change in the TARGET, in `amount_unit`. Its sign is the link's direction. */
  readonly amount: number;
  /** The target's own unit, or the words the ask is phrased in (`targetUnitWords`: "percentage points" for a % level). */
  readonly amount_unit: string;
  /** Non-zero change in the SOURCE, in `per_source_change_unit`. */
  readonly per_source_change: number;
  /** The source's own unit, or the ask's words for it (`sourceUnitWords`: "switch" for a yes/no source). */
  readonly per_source_change_unit: string;
}

export interface ApplyLinkEffectEditParams {
  /** The STORED graph (strict server-side read) — never a client copy. */
  readonly persistedGraph: unknown;
  readonly from: string;
  readonly to: string;
  readonly effect: LinkEffectStatement;
  /**
   * What the ask was prepared against (DL 5882808387). Either one moved ⇒ `superseded`, nothing written.
   *  · `graph_hash` — the wire `graph_hash` (`computeAnalysisAffectingGraphHash`), which every Agent proposal carries as
   *    `base_graph_identity_hash` and the level door's CAS reads. It is the analysis hash on purpose: proposal staleness
   *    is owned by it, so a cosmetic edit elsewhere never discards a valid proposal (proposal-staleness-hash-doctrine).
   *  · `edge_token` — `linkEffectEdgeToken(graph, from, to)` at prepare time: every stored byte of THIS link, so a change
   *    the analysis hash does not read (the natural effect's amount, Olumi's reasoning) is caught too.
   */
  readonly expected: { readonly graph_hash: string; readonly edge_token: string };
  /** The user's verbatim words (1..400), carried on the receipt for the approval card and audit. */
  readonly quote: string;
  /**
   * `linkEffectReadingToken` of the reading the user APPROVED — the card's {from, to, effect, quote}. The writer
   * recomputes it over what it is asked to write; absent or different ⇒ `reading_not_confirmed`, nothing written.
   */
  readonly reading_token: string;
  /** What the last Run did with declared identities (`identityRunUseFromFacts`); absent = no Run yet. */
  readonly lastRunIdentityUse?: IdentityRunUse | null;
}

export type LinkEffectRefusal =
  | 'invalid_graph'
  | 'quote_invalid'
  | 'reading_not_confirmed'
  | 'edge_not_found'
  | 'superseded'
  | 'definitional_link'
  | 'unit_mismatch'
  /** The end holds NO unit at all (a served risk or outcome is `{label, provenance}`): nothing to say a size in. */
  | 'target_not_quantified'
  | 'source_not_quantified'
  | 'unconvertible'
  | Exclude<LinkSizeProblem, 'unconvertible'>;

export type LinkEffectEditResult =
  | {
      readonly kind: 'mutated';
      /** The stored graph with the one link re-sized (a copy; the input is untouched). */
      readonly mutatedGraph: unknown;
      /** The same graph through the strict parse — the gate every writer passes. */
      readonly graph: GraphV3T;
      readonly handlerFacts: readonly HandlerFact[];
      /** The size said back in the user's units (`sizeLink`'s own words), for the one-line acknowledgement. */
      readonly statement?: string;
    }
  | { readonly kind: 'refused'; readonly reason: LinkEffectRefusal };

const QUOTE_MAX = 400;

/**
 * Every stored byte of one link (key-order independent), as a short digest — the prepared-edge half of `expected`.
 * `null` when there is no such link. The Agent computes it on the read it proposes from and stores it on the proposal.
 */
export function linkEffectEdgeToken(graph: unknown, from: string, to: string): string | null {
  const edges = isRec(graph) && Array.isArray(graph.edges) ? graph.edges : [];
  const edge = edges.find((e): e is Rec => isRec(e) && e.from === from && e.to === to);
  return edge === undefined ? null : `edge:${createHash('sha256').update(stableStringify(edge)).digest('hex')}`;
}

/**
 * ⭐ `user_stated` IS WRITTEN ONLY ON THE APPROVAL OF A DISPLAYED READING (AIQ 5885290014, "proposer, not stamper";
 * DL 5884931550). The approval card shows exactly {from, to, effect, quote}; its caller passes this token of THAT
 * reading, and the writer recomputes it over what it is asked to write. A proposal with no reading shown has no token
 * to pass, and one whose shown reading differs from the write has the wrong one: either way nothing is written. It binds
 * the READING; the graph half is `expected` (analysis hash + edge token).
 */
export function linkEffectReadingToken(reading: {
  readonly from: string;
  readonly to: string;
  readonly effect: LinkEffectStatement;
  readonly quote: string;
}): string {
  const { amount, amount_unit, per_source_change, per_source_change_unit } = reading.effect;
  const bound = { from: reading.from, to: reading.to, effect: { amount, amount_unit, per_source_change, per_source_change_unit }, quote: reading.quote };
  return `reading:${createHash('sha256').update(stableStringify(bound)).digest('hex')}`;
}
const refuse = (reason: LinkEffectRefusal): LinkEffectEditResult => ({ kind: 'refused', reason });

/**
 * ⭐ THE STATED UNIT IS THE END'S OWN, HOWEVER IT IS SPELLED (served 4 Oct, journey3: "£49 a month", "each subscriber").
 * The estate's one unit key (`unitComparisonKey`: "£/month" = "GBP per month"), read after the two spellings a plain
 * sentence uses that the key does not fold: a rate said with "a" / "each" / "every" ("£ a month" is "£ per month"), and
 * the unit said of ONE (`unitAfterOne`, the sizer's own singular rule: "subscriber" is "subscribers"). Never a
 * conversion: another currency, period or noun is still a different unit.
 */
export function linkEffectUnitIs(stated: string, own: string | undefined): boolean {
  if (own === undefined || own.trim() === '') return false;
  const key = (unit: string): string | undefined => unitComparisonKey(unitAfterOne(unit.trim().replace(/\s+(?:an?|each|every)\s+/i, ' per ')));
  const statedKey = key(stated);
  return statedKey !== undefined && statedKey === key(own);
}
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

/**
 * Which end of a link has NO SCALE to size against (`resolveMagnitudeFrame`), read as the writer reads it — so an
 * `unconvertible` refusal can name the one end, never "this model". `null` when both resolve (or the graph is unreadable).
 */
export function linkEndWithoutScale(graph: unknown, from: string, to: string): 'target' | 'source' | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const view = magnitudeNodes(graph.nodes.filter(isRec), percentLevelIds(graph));
  const target = view.get(to);
  const source = view.get(from);
  if (target !== undefined && resolveMagnitudeFrame(target) === undefined) return 'target';
  if (source !== undefined && resolveMagnitudeFrame(source) === undefined) return 'source';
  return null;
}

export function applyLinkEffectEdit(params: ApplyLinkEffectEditParams): LinkEffectEditResult {
  const { from, to, effect, expected } = params;
  if (typeof params.quote !== 'string' || params.quote.trim() === '' || params.quote.length > QUOTE_MAX) return refuse('quote_invalid');
  if (typeof params.reading_token !== 'string'
    || params.reading_token !== linkEffectReadingToken({ from, to, effect, quote: params.quote })) {
    return refuse('reading_not_confirmed');
  }
  if (!isRec(params.persistedGraph) || !Array.isArray(params.persistedGraph.nodes) || !Array.isArray(params.persistedGraph.edges)) {
    return refuse('invalid_graph');
  }
  const graph = structuredClone(params.persistedGraph) as Rec & { nodes: unknown[]; edges: unknown[] };
  const nodes = graph.nodes.filter(isRec);
  const edge = graph.edges.find((e): e is Rec => isRec(e) && e.from === from && e.to === to);
  const source = nodes.find((n) => n.id === from);
  const target = nodes.find((n) => n.id === to);
  if (edge === undefined || source === undefined || target === undefined) return refuse('edge_not_found');

  // ── REVISION-SAFE: the analysis revision AND every byte of this link are what the ask was prepared against ─────────
  if (computeAnalysisAffectingGraphHash(params.persistedGraph as never) !== expected.graph_hash
    || linkEffectEdgeToken(params.persistedGraph, from, to) !== expected.edge_token) {
    return refuse('superseded');
  }
  const strength = isRec(edge.strength) ? edge.strength : {};
  const provenance = isRec(edge.provenance) ? edge.provenance : {};
  if (definitionalLinkInUse(graph, from, to, params.lastRunIdentityUse ?? null) !== null) return refuse('definitional_link');

  // ── THE UNITS ARE THE ENDS' OWN — never converted by guess ─────────────────────────────────────────────────────────
  const view = magnitudeNodes(nodes, percentLevelIds(graph));
  const sourceNode = view.get(from)!;
  const targetNode = view.get(to)!;
  // Either the end's stored unit or the words the ask itself is phrased in (Runtime 5882802252: a % level is asked in
  // "percentage points", a yes/no source as "switch") — the same key `sizeLink` says the natural effect back in.
  const targetUnits = [unitOf(targetNode), targetUnitWords(targetNode, resolveMagnitudeFrame(targetNode))];
  const sourceUnits = [unitOf(sourceNode), sourceUnitWords(sourceNode, resolveMagnitudeFrame(sourceNode))];
  // An end that holds no unit at all is not a mismatch of the user's: it is named, so the refusal can say which end.
  const held = (units: readonly (string | undefined)[]): boolean => units.some((u) => u !== undefined && u.trim() !== '');
  if (!held(targetUnits)) return refuse('target_not_quantified');
  if (!held(sourceUnits)) return refuse('source_not_quantified');
  if (!targetUnits.some((u) => linkEffectUnitIs(effect.amount_unit, u))
    || !sourceUnits.some((u) => linkEffectUnitIs(effect.per_source_change_unit, u))) {
    return refuse('unit_mismatch');
  }
  if (!finite(effect.amount) || !finite(effect.per_source_change) || effect.per_source_change === 0 || effect.amount === 0) {
    return refuse('unconvertible');
  }

  // ── NEVER A SILENT REVERSAL (Runtime 5883054365, reproduced on served journey C) ─────────────────────────────────
  // The stated sign must agree with the STORED link's: its `effect_direction`, else the sign of its mean. A user who says
  // the link runs the other way is correcting Olumi's direction — that is the reversal door (`propose_link_strength`
  // with the user's direction words), never a side effect of sizing. `sizeLink`'s own check compares the figure with
  // itself, so this one is the guard.
  // The link's direction is the SIGNED SLOPE (amount ÷ per_source_change; PR Review 5883720887): "lowering price by £1
  // gains 50" (+50 per −1) runs the same way as "raising it by £1 loses 50" (−50 per +1).
  const direction = Math.sign(effect.amount) * Math.sign(effect.per_source_change) < 0 ? 'negative' : 'positive';
  const storedMean = isRec(edge.strength) && finite(edge.strength.mean) ? edge.strength.mean : 0;
  const storedDirection = edge.effect_direction === 'positive' || edge.effect_direction === 'negative' ? edge.effect_direction
    : storedMean < 0 ? 'negative' : storedMean > 0 ? 'positive' : null;
  if (storedDirection !== null && storedDirection !== direction) return refuse('sign_conflict');

  // ── THE CONSTRUCTION PATH'S OWN SIZING ────────────────────────────────────────────────────────────────────────────
  const sizing = sizeLink(
    { direction, effect_amount: effect.amount, effect_per_source_change: effect.per_source_change, user_stated: true },
    sourceNode,
    targetNode,
  );
  if (sizing.problem !== undefined) return refuse(sizing.problem);
  if (sizing.outcome !== 'user_stated' || sizing.natural_effect === undefined) return refuse('unconvertible');

  const before = { from, to, strength: { ...strength }, effect_direction: edge.effect_direction, provenance: { ...provenance } };
  const { reasoning: _olumisWhy, natural_effect: _oldSize, clamped_from: _oldClamp, ...keptProvenance } = provenance;
  edge.strength = { ...strength, mean: sizing.mean, std: sizing.std };
  edge.effect_direction = direction;
  edge.provenance = { ...keptProvenance, source: 'user_specified', magnitude: 'user_stated', natural_effect: sizing.natural_effect };
  edge.provenance_display = 'user_set';
  // A6e: `defaulted` is whole-edge; the statement sizes the strength only, so existence stays Olumi's per field.
  if (edge.defaulted === true) edge.exists_defaulted = true;
  delete edge.defaulted;
  // A6f: a natural effect states the size, not its spread — the std is the sizing's, still not the user's.
  edge.std_defaulted = true;

  const parsed = GraphV3.safeParse(graph);
  if (!parsed.success) return refuse('invalid_graph');
  const fact = AdjustEdgeStrengthHandlerFactSchema.parse({
    fact_type: 'adjust_edge_strength',
    fact_version: 1,
    noop: false,
    result: {
      target_id: `${from}→${to}`,
      status: 'applied',
      before,
      after: { from, to, strength: { ...(edge.strength as Rec) }, effect_direction: direction, provenance: edge.provenance, stated_quote: params.quote },
    },
  });
  return { kind: 'mutated', mutatedGraph: graph, graph: parsed.data, handlerFacts: [fact as HandlerFact],
    ...(sizing.statement !== undefined ? { statement: sizing.statement } : {}) };
}
