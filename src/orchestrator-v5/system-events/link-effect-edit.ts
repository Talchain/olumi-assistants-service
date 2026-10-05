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
import { resolveMagnitudeFrame, sizeLink, sourceUnitWords, targetUnitWords, unitOf, type LinkSizeProblem } from '../../cee/magnitude/link-effect.js';
import { createHash } from 'node:crypto';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { isDirectedEdge } from '../../schemas/graph.js';
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
  | 'target_ambiguous'
  | 'superseded'
  | 'definitional_link'
  | 'unit_mismatch'
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
 * ⭐ THE UNITS EACH END OF ONE LINK MAY BE STATED IN (RT-6, #87 5992873873). Its own: the end's stored unit, or the words
 * the sizer says its change in. ⭐ An end with NONE (a risk or outcome with no unit or scale, which the drafter still
 * sizes links out of on its 0–`scale_frame` frame) takes the unit THIS link's stored size is already said in for that
 * end: endpoint-specific (`per_source_change_unit` for the source, `amount_unit` for the target) and version-bound (the
 * prepared `edge_token` holds every stored byte of the link, so a link that changed since is `superseded` first).
 * Restating a link in the very unit Olumi already sized it in converts nothing. No stored size ⇒ nothing to adopt, and
 * the end stays unstateable (`unit_mismatch`, said as "no unit or scale").
 * One rule for the check, for what is stored, and for the refusal's words (`linkEffectRefusalWords`).
 */
/** The writer's ONE unit comparator (`same` below): `stated` names one of `own`. Shared with P5 (`target-testability.ts`). */
export function statedInOneOf(stated: unknown, own: readonly (string | undefined)[]): boolean {
  return typeof stated === 'string' && unitComparisonKey(stated) !== undefined
    && own.some((u) => u !== undefined && u !== '' && unitComparisonKey(stated) === unitComparisonKey(u));
}

export interface LinkEndUnits {
  readonly own: readonly string[];
  readonly adopted?: string;
}
export function linkEffectEndUnits(graph: unknown, from: string, to: string): { readonly source: LinkEndUnits; readonly target: LinkEndUnits } | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const found = linkEffectTargetOf(graph, from, to);
  if (found.kind === 'refused') return null;
  const view = magnitudeNodes(graph.nodes.filter(isRec), percentLevelIds(graph));
  const sourceNode = view.get(from);
  const targetNode = view.get(to);
  if (sourceNode === undefined || targetNode === undefined) return null;
  const present = (...u: (string | undefined)[]): string[] => u.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  const sourceOwn = present(unitOf(sourceNode), sourceUnitWords(sourceNode, resolveMagnitudeFrame(sourceNode)),
    targetUnitWords(sourceNode, resolveMagnitudeFrame(sourceNode)));
  // ⛔ The points-only rule applies to a % LEVEL target the graph marks `percent_level` from `goal_constraints`
  // (Science, #87 5993238492): "gross margin falls 2%" may mean 2 points or 2% of today's level, so a bare "%" for that
  // target is refused and the user is asked for points. A % goal not so marked keeps the pre-existing comparison
  // (follow-up for Science).
  // A % LEVEL target's unit is fixed (points), so it is never adopted from the link: a stored "%" must not let a
  // relative % size it (Codex buddy #2586 @b278c84d, P2: a marked level with no `goal_threshold_unit`).
  const levelPoints = targetNode.percent_level === true ? present(targetUnitWords(targetNode, resolveMagnitudeFrame(targetNode))) : [];
  const targetOwn = targetNode.percent_level === true
    ? (levelPoints.length > 0 ? levelPoints : ['percentage points'])
    : present(unitOf(targetNode), targetUnitWords(targetNode, resolveMagnitudeFrame(targetNode)));
  const provenance = isRec(found.edge.provenance) ? found.edge.provenance : {};
  const stored = isRec(provenance.natural_effect) ? provenance.natural_effect : undefined;
  const storedUnit = (key: 'amount_unit' | 'per_source_change_unit'): string | undefined =>
    typeof stored?.[key] === 'string' && (stored[key] as string).trim() !== '' ? stored[key] as string : undefined;
  const sourceAdopted = sourceOwn.length === 0 ? storedUnit('per_source_change_unit') : undefined;
  const targetAdopted = targetOwn.length === 0 && targetNode.percent_level !== true ? storedUnit('amount_unit') : undefined;
  return {
    source: { own: sourceOwn, ...(sourceAdopted !== undefined ? { adopted: sourceAdopted } : {}) },
    target: { own: targetOwn, ...(targetAdopted !== undefined ? { adopted: targetAdopted } : {}) },
  };
}

/**
 * Every stored byte of one link (key-order independent), as a short digest — the prepared-edge half of `expected`.
 * `null` when there is no such link. The Agent computes it on the read it proposes from and stores it on the proposal.
 */
export function linkEffectEdgeToken(graph: unknown, from: string, to: string): string | null {
  // No ONE link (a parallel copy of the pair, or an end's id on two nodes): no token, so nothing is prepared or written.
  const found = linkEffectTargetOf(graph, from, to);
  return found.kind !== 'one' ? null : `edge:${createHash('sha256').update(stableStringify(found.edge)).digest('hex')}`;
}

/**
 * ⛔ EXACTLY ONE STORED LINK AND ONE NODE PER END, OR NOTHING (DL #2561 round 2; the edge-strength writer's own
 * `target_ambiguous` rule, `edge-strength-edit.ts`). A parallel copy of the endpoint pair, or two nodes under one end's
 * id, is never resolved by array order: the card names neither copy, so a write to "the first" is a guess. The token,
 * every dry run and every write read through this; a missing pair stays `edge_not_found`.
 * ⛔ ONLY A CAUSAL LINK IS SIZED: a bidirected edge is an unmeasured-confounder annotation the analysis never simulates
 * (`schemas/graph.ts` `isDirectedEdge`), so a user's "X moves Y by N" is never written onto it (adversarial review of
 * #2561, pre-existing). A pair holding only a confounder has no link to size; a directed link beside one is THE link.
 */
export function linkEffectTargetOf(graph: unknown, from: string, to: string):
  | { readonly kind: 'one'; readonly edge: Rec }
  | { readonly kind: 'refused'; readonly reason: 'edge_not_found' | 'target_ambiguous' } {
  const edges = isRec(graph) && Array.isArray(graph.edges)
    ? graph.edges.filter((e): e is Rec => isRec(e) && e.from === from && e.to === to && isDirectedEdge(e as Parameters<typeof isDirectedEdge>[0]))
    : [];
  const nodes = isRec(graph) && Array.isArray(graph.nodes) ? graph.nodes.filter(isRec) : [];
  const sources = nodes.filter((n) => n.id === from).length;
  const targets = nodes.filter((n) => n.id === to).length;
  if (edges.length > 1 || sources > 1 || targets > 1) return { kind: 'refused', reason: 'target_ambiguous' };
  if (edges.length === 0 || sources === 0 || targets === 0) return { kind: 'refused', reason: 'edge_not_found' };
  return { kind: 'one', edge: edges[0]! };
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
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

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
  const found = linkEffectTargetOf(graph, from, to);
  if (found.kind === 'refused') return refuse(found.reason);
  const edge = found.edge;

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
  const endUnits = linkEffectEndUnits(params.persistedGraph, from, to);
  // Either the end's stored unit or the words the ask itself is phrased in (Runtime 5882802252: a % level is asked in
  // "percentage points", a yes/no source as "switch") — the same key `sizeLink` says the natural effect back in.
  const same = (stated: string, ...own: (string | undefined)[]) => statedInOneOf(stated, own);
  // ⛔ A PERCENTAGE LEVEL'S CHANGE IS SAID IN POINTS AT EITHER END (served on 074de08, 29 Sep, Canonical's #2283 witness):
  // the sizer says a % level's change in points whether it is the target or the SOURCE (`statementWords` →
  // `amountWords`), so the ask reads "raising "Monthly churn rate" by 1 point …", and the writer refused exactly those
  // words for the source ("requires the churn change in its stored unit, %"). The Agent then asked for "rises by 1%",
  // which on a rate reads as a RELATIVE change. Accepted here: the stored natural effect is still `naturalEffectOf`'s
  // own unit, and one point is one raw unit of a % level, so the conversion is unchanged.
  if (endUnits === null
    || !same(effect.amount_unit, ...endUnits.target.own, endUnits.target.adopted)
    || !same(effect.per_source_change_unit, ...endUnits.source.own, endUnits.source.adopted)) {
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
  // RT-6: an end that took this link's stored unit is stored in the unit as STATED (checked equal to it above), so the
  // read-back (`sameUnit` against the card) holds and the link stays stateable in that unit next time.
  const naturalEffect = {
    ...sizing.natural_effect,
    ...(endUnits.source.adopted !== undefined ? { per_source_change_unit: effect.per_source_change_unit } : {}),
    ...(endUnits.target.adopted !== undefined ? { amount_unit: effect.amount_unit } : {}),
  };
  edge.provenance = { ...keptProvenance, source: 'user_specified', magnitude: 'user_stated', natural_effect: naturalEffect };
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
