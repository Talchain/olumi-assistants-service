/**
 * ⭐ THE USER-STATED LINK EFFECT — the canonical writer (DL #72 5882763151 item a; contract Canonical 5882780438).
 *
 * The user answers "how much does X move Y?" in NATURAL units ("every £1 on the price loses about 50 subscribers").
 * This writer sizes that one link with the construction path's own converter (`sizeLink`, `user_stated: true`, the
 * magnitude contract D2–D8), and stores exactly what it did:
 *   · `strength {mean, std}` from the sizing, `effect_direction` from the stated sign;
 *   · `provenance = {...existing, source: 'user_specified', magnitude: 'user_stated', natural_effect, source_quote,
 *     reading: 'agent_proposed_user_confirmed'}` — the size said back in the
 *     units the user used, bound to the β it was written for (`strength_mean`);
 *   · Every other provenance key is retained; the whole-edge `defaulted` flag goes, and the per-field
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
import { classifyUnitScaleClass } from '../../cee/draft/records/unit-scale-class.js';
import { AdjustEdgeStrengthHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { magnitudeNodes, percentLevelIds } from '../../cee/magnitude/frame-defaulted-links.js';
import { isPercentageLevelUnit, resolveMagnitudeFrame, sizeLink, sourceUnitWords, targetUnitWords, unitOf, type LinkSizeProblem, type MagnitudeNode } from '../../cee/magnitude/link-effect.js';
import { createHash } from 'node:crypto';

import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { isDirectedEdge } from '../../schemas/graph.js';
import { definitionalLinkInUse, type IdentityRunUse } from '../compose/definitional-links.js';
import { unitComparisonKey } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';
import { prepareLinkEffectUnitReadings, sentenceCountsLabel, withPointsAtZero, type LinkEffectUnitReading } from './link-effect-unit-reading.js';
import { POINTS_SPELLINGS, POINTS_UNIT } from '../../utils/unit-alphabet.js';
import { centreRangeOfQuote } from '../agent-lane/stated-by-user.js';
import { labelStandsForCountUnit } from '../agent-lane/same-unit.js';
import { GAUGE_OP, mediatorReadings, storedGaugesKept, withMediatorReading } from '../agent-lane/mediator-reading.js';
import { clampForPersist, refitFramesForStatedEffects, refitKeepsOtherLinks } from '../agent-lane/refit-frames.js';
import { isPlaceholderLink } from '../../cee/magnitude/link-sizing.js';

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

/** A displayed direction correction, approved as part of the exact link-effect reading. */
export interface LinkEffectReversal {
  readonly from: 'positive' | 'negative';
  readonly to: 'positive' | 'negative';
}

export interface ApplyLinkEffectEditParams {
  /** The STORED graph (strict server-side read) — never a client copy. */
  readonly persistedGraph: unknown;
  readonly from: string;
  readonly to: string;
  readonly effect: LinkEffectStatement;
  /** End units inferred from the displayed, literal user statement; approval binds each exact reading. */
  readonly unit_readings?: readonly LinkEffectUnitReading[];
  /** A reversal is written only when the card explicitly disclosed both the old and proposed directions. */
  readonly reversal?: LinkEffectReversal;
  /** Grounded canvas selection, supplied by the request and bound into this approval reading. */
  readonly link_selected?: true;
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
   * `linkEffectReadingToken` of the reading the user APPROVED — including units, reversal and grounded selection. The writer
   * recomputes it over what it is asked to write; absent or different ⇒ `reading_not_confirmed`, nothing written.
   */
  readonly reading_token: string;
  /** What the last Run did with declared identities (`identityRunUseFromFacts`); absent = no Run yet. */
  readonly lastRunIdentityUse?: IdentityRunUse | null;
  /**
   * ⭐ S5t: a user's size the frames cannot hold is written and the frames refit by construction's own rule. Opt-in: only the
   * ONE-link door passes it (its proposer and approval dry runs, and `executeOptionInterventionBatch`'s `linkEffect`), because
   * only that door admits a refit postimage (`linkEffectRefitPostimageIsScoped`). Absent ⇒ `not_representable`, as before.
   */
  readonly frameRefit?: true;
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
      /**
       * ⭐ S5t: present only when the frames were refit — the write BEFORE the refit (the user's link at its full β). The door
       * scope-checks THIS against the stored graph and recomputes construction's refit from it; never the writer's word.
       */
      readonly refitFrom?: unknown;
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
  /** A % LEVEL target whose goal names no unit: its points fallback is stored as the user stated it. */
  readonly storeAsStated?: boolean;
}

/** The strict NodeV3 carrier a disclosed reading is written as: ONE shape for the writer and every reader of its view. */
function unitReadingCarrier(reading: LinkEffectUnitReading): { unit: string; source: 'user_stated'; source_quote: string } {
  const { unit, source_quote } = reading.unit_reading;
  return { unit, source: 'user_stated', source_quote };
}

/**
 * The graph exactly as the writer reads it once the card's disclosed unit readings are applied (a copy; the input is
 * untouched). The refusal's words read THIS view (red team #87 6004429045): read off the stored graph, an end whose unit
 * the sentence itself stated looked unitless, and the user was told it "has no unit or scale".
 */
export function withLinkEffectUnitReadings(graph: unknown, readings: readonly LinkEffectUnitReading[] | undefined): unknown {
  if (readings === undefined || readings.length === 0 || !isRec(graph) || !Array.isArray(graph.nodes)) return graph;
  return { ...graph, nodes: graph.nodes.map((n) => {
    const reading = isRec(n) ? readings.find((r) => r.node_id === n.id) : undefined;
    return reading === undefined ? n : { ...(n as Rec), unit_reading: unitReadingCarrier(reading) };
  }) };
}

/**
 * ⭐ The points spellings an end whose change is in points may be stated in: U1's leaf (`POINTS_SPELLINGS`), plus the bare
 * word, exactly as before. ONE list for BOTH arms (red team #87 6004429045: the target arm named only "pp"/"points", so
 * "1 percentage point of wholesale subscription revenue" was refused 12/12 while the source arm took it). The writer's
 * comparator folds no points spellings, so every one the leaf owns is named here, derived, never a new table.
 */
export const POINTS_STATED: readonly string[] = [...POINTS_SPELLINGS, 'points'];

function hasAdoptedPercentUnit(node: Rec | undefined, magnitude: MagnitudeNode): boolean {
  const candidate = node?.unit_reading;
  const reading = isRec(candidate) ? candidate : undefined;
  // The shared percent classifier, never an inline equality (unit-scale-class KNOWN-UNMIGRATED guard). An adopted reading
  // exists only on an end with no own unit (U1), and the reader writes "%" for points, so this is the bare-% case.
  return reading?.source === 'user_stated' && typeof reading.unit === 'string'
    && classifyUnitScaleClass(reading.unit) === 'percent' && classifyUnitScaleClass(unitOf(magnitude)) === 'percent';
}

/** U2's adopted points unit is a % level: one point is one raw unit on 100, even when no scale was stored. */
function withAdoptedPercentFrame(node: Rec | undefined, magnitude: MagnitudeNode): MagnitudeNode {
  return hasAdoptedPercentUnit(node, magnitude) && resolveMagnitudeFrame(magnitude) === undefined
    ? { ...magnitude, scale_frame: 100 } // Sizing view only; no scale_frame is added to the persisted node.
    : magnitude;
}
export function linkEffectEndUnits(graph: unknown, from: string, to: string): { readonly source: LinkEndUnits; readonly target: LinkEndUnits } | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return null;
  const found = linkEffectTargetOf(graph, from, to);
  if (found.kind === 'refused') return null;
  const view = magnitudeNodes(graph.nodes.filter(isRec), percentLevelIds(graph));
  // ⭐ No-dead-end (C)/(B): a level-less mediator's unit, from the ONE reader (never stored on the node).
  const readings = mediatorReadings(graph);
  const sourceStored = view.get(from);
  const targetStored = view.get(to);
  if (sourceStored === undefined || targetStored === undefined) return null;
  const sourceView = withMediatorReading(sourceStored, readings.get(from), 'source');
  const targetView = withMediatorReading(targetStored, readings.get(to), 'target');
  const sourceEnd = graph.nodes.filter(isRec).find(n => n.id === from);
  const targetEnd = graph.nodes.filter(isRec).find(n => n.id === to);
  const sourceNode = withAdoptedPercentFrame(sourceEnd, sourceView);
  const targetNode = withAdoptedPercentFrame(targetEnd, targetView);
  const present = (...u: (string | undefined)[]): string[] => u.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  // U2 permits these literal points spellings for a disclosed sentence reading. Keep the existing comparator and
  // pre-existing node units unchanged: the aliases apply only while this end's governing reading is user-stated %.
  const sourceOwn = present(unitOf(sourceNode), sourceUnitWords(sourceNode, resolveMagnitudeFrame(sourceNode)),
    targetUnitWords(sourceNode, resolveMagnitudeFrame(sourceNode)),
    ...(hasAdoptedPercentUnit(sourceEnd, sourceNode) || isPercentageLevelUnit(unitOf(sourceNode), resolveMagnitudeFrame(sourceNode))
      || sourceNode.percent_level === true ? POINTS_STATED : []));
  // ⛔ The points-only rule applies to a % LEVEL target the graph marks `percent_level` from `goal_constraints`
  // (Science, #87 5993238492): "gross margin falls 2%" may mean 2 points or 2% of today's level, so a bare "%" for that
  // target is refused and the user is asked for points. A % goal not so marked keeps the pre-existing comparison
  // (follow-up for Science).
  // A % LEVEL target's unit is fixed (points), so it is never adopted from the link: a stored "%" must not let a
  // relative % size it (Codex buddy #2586 @b278c84d, P2: a marked level with no `goal_threshold_unit`).
  const targetIsLevel = targetNode.percent_level === true || isPercentageLevelUnit(unitOf(targetNode), resolveMagnitudeFrame(targetNode));
  const levelPoints = targetIsLevel ? present(targetUnitWords(targetNode, resolveMagnitudeFrame(targetNode))) : [];
  const targetOwn = [...(targetIsLevel
    ? (levelPoints.length > 0 ? levelPoints : [POINTS_UNIT])
    : present(unitOf(targetNode), targetUnitWords(targetNode, resolveMagnitudeFrame(targetNode)))),
    ...(hasAdoptedPercentUnit(targetEnd, targetNode) || targetIsLevel ? POINTS_STATED : [])];
  const provenance = isRec(found.edge.provenance) ? found.edge.provenance : {};
  const stored = isRec(provenance.natural_effect) ? provenance.natural_effect : undefined;
  const storedUnit = (key: 'amount_unit' | 'per_source_change_unit'): string | undefined =>
    typeof stored?.[key] === 'string' && (stored[key] as string).trim() !== '' ? stored[key] as string : undefined;
  const sourceAdopted = sourceOwn.length === 0 ? storedUnit('per_source_change_unit') : undefined;
  const targetAdopted = targetOwn.length === 0 && !targetIsLevel ? storedUnit('amount_unit') : undefined;
  return {
    source: { own: sourceOwn, ...(sourceAdopted !== undefined ? { adopted: sourceAdopted } : {}) },
    target: { own: targetOwn, ...(targetAdopted !== undefined ? { adopted: targetAdopted } : {}),
      ...(targetIsLevel && levelPoints.length === 0 ? { storeAsStated: true } : {}) },
  };
}

/** The existing writer's conversion frames, including its mediator and adopted-% views. Read-only. */
export function linkEffectConversionFrames(graph: unknown, from: string, to: string): { source: number | undefined; target: number | undefined } | null {
  if (!isRec(graph) || !Array.isArray(graph.nodes) || linkEffectEndUnits(graph, from, to) === null) return null;
  const nodes = graph.nodes.filter(isRec);
  const view = magnitudeNodes(nodes, percentLevelIds(graph));
  const source = view.get(from); const target = view.get(to);
  if (source === undefined || target === undefined) return null;
  const readings = mediatorReadings(graph);
  const sourceNode = withAdoptedPercentFrame(nodes.find(n => n.id === from), withMediatorReading(source, readings.get(from), 'source'));
  const targetNode = withAdoptedPercentFrame(nodes.find(n => n.id === to), withMediatorReading(target, readings.get(to), 'target'));
  return { source: resolveMagnitudeFrame(sourceNode), target: resolveMagnitudeFrame(targetNode) };
}

/** An end the user stated by its node's own LABEL, read as that node's count unit (shown on the card for approval). */
export interface LinkEffectLabelReading {
  readonly node_id: string;
  /** The user's words for the unit, exactly as the Agent passed them ("café subscribers"). */
  readonly said: string;
  /** The node's own unit the effect is now stated in ("cafés"). */
  readonly unit: string;
}

/**
 * ⭐ RT-6 row 1b (Science ruling #87 6005615422; red team 6005529714, 2 of 3 live sentences): "Every 10 more café
 * subscribers adds …" names the SOURCE by its label, and the Agent passes those words as the unit. When an end's stated
 * unit is none of its own but IS its node's label (`labelStandsForCountUnit`: identity, count units only), the effect is
 * restated in the node's own unit and the reading is returned, so the card says it and the user approves it. It is never
 * a silent credit. Both arms read the ONE matcher; an end already stated in one of its own units is untouched.
 * ⛔ Codex r1: the Agent's unit alone proves nothing. The user's sentence (`said`) must COUNT the end by its label, right
 * after that end's own figure (`sentenceCountsLabel`), or a head noun ("10 more subscribers") would map to "cafés".
 */
export function withLabelCountUnits(graph: unknown, from: string, to: string, effect: LinkEffectStatement, said: string):
  { readonly effect: LinkEffectStatement; readonly label_readings: readonly LinkEffectLabelReading[] } {
  const ends = linkEffectEndUnits(graph, from, to);
  if (ends === null || !isRec(graph) || !Array.isArray(graph.nodes)) return { effect, label_readings: [] };
  const nodes = graph.nodes.filter(isRec);
  const view = magnitudeNodes(nodes, percentLevelIds(graph));
  const readEnd = (id: string, stated: string, end: LinkEndUnits, figure: number): LinkEffectLabelReading | undefined => {
    if (statedInOneOf(stated, [...end.own, end.adopted])) return undefined;
    const label = nodes.find((n) => n.id === id)?.label;
    const magnitude = view.get(id);
    const unit = magnitude === undefined ? undefined : unitOf(magnitude);
    return typeof unit === 'string' && labelStandsForCountUnit(stated, label, unit) && sentenceCountsLabel(said, figure, label)
      ? { node_id: id, said: stated, unit } : undefined;
  };
  const source = readEnd(from, effect.per_source_change_unit, ends.source, effect.per_source_change);
  const target = readEnd(to, effect.amount_unit, ends.target, effect.amount);
  return {
    effect: { ...effect, ...(source !== undefined ? { per_source_change_unit: source.unit } : {}),
      ...(target !== undefined ? { amount_unit: target.unit } : {}) },
    label_readings: [source, target].filter((r): r is LinkEffectLabelReading => r !== undefined),
  };
}

/**
 * ⭐ THE ONE STATEMENT RULE THROUGH A GAUGE (Codex r1 P1: the runtime's consent read the lever's sign, the writer the
 * path's): the user's END-TO-END figure E sizes lever→M as E × g, g = M→child's stored sign (MC 21: ±1). The writer AND
 * the consent that prepares the card's reversal read this ONE function. Any other link: the effect as stated.
 */
export function linkEffectGaugeStatement<E extends { readonly amount: number }>(graph: unknown, from: string, to: string, effect: E): E {
  const reading = mediatorReadings(graph).get(to);
  if (reading?.via !== 'gauge' || !isRec(graph) || !Array.isArray(graph.edges)) return effect;
  const child = graph.edges.filter(isRec).find(e => e.from === to && e.to === reading.child && isDirectedEdge(e as never));
  if (child === undefined || from === reading.child) return effect;
  const mean = isRec(child.strength) && finite(child.strength.mean) ? child.strength.mean : 0;
  const negative = child.effect_direction === 'negative' || (child.effect_direction !== 'positive' && mean < 0);
  return negative ? { ...effect, amount: effect.amount * -1 } : effect;
}

/** A level-less mediator end the card names, so the reading is approved, never silent (no-dead-end (B)/(C)). */
export interface LinkEffectMediatorReading {
  readonly node_id: string;
  readonly via: 'sized_parents' | 'gauge' | 'definitional_part' | 'product';
  /** The unit Olumi measures the mediator in (C), its one child's unit (B), the total it is a part of (FA1), or its operands' composed unit (FA1-3). */
  readonly unit: string;
  /**
   * (C) the parent link whose estimate fixes the unit; (B) the child the answer reaches through the mediator; (FA1) the total;
   * (FA1-3) the product as said, its two operand labels quoted: "‘Starter subscribers’ × ‘Support cost per starter subscriber’".
   */
  readonly other_label: string;
  /** brief3's fallback (d5 6006685510 (2)): the answer replaces Olumi's own estimate on this link. */
  readonly replaces?: true;
}

/**
 * The card's mediator readings for one link, from the ONE reader (`mediatorReadings`): a source Olumi measures in its
 * sized parents' unit (C, Science #87 6006548763: "Olumi measures ‘{M}’ in {U}, from its own estimate of the link from
 * ‘{parent}’; correct that if it’s wrong."), and a gauge target (B, 6006425419: the answer sizes the whole path to the
 * child). Empty for every other link.
 */
export function linkEffectMediatorReadings(graph: unknown, from: string, to: string): LinkEffectMediatorReading[] {
  if (!isRec(graph) || !Array.isArray(graph.nodes)) return [];
  const nodes = graph.nodes.filter(isRec);
  const label = (id: string): string => { const l = nodes.find((n) => n.id === id)?.label; return typeof l === 'string' && l.trim() !== '' ? l : id; };
  const readings = mediatorReadings(graph);
  const out: LinkEffectMediatorReading[] = [];
  const source = readings.get(from);
  if (source?.via === 'sized_parents' && source.parents.length > 0) {
    out.push({ node_id: from, via: 'sized_parents', unit: source.unit, other_label: label(source.parents[0]!) });
  } else if (source?.via === 'definitional_part') {
    // DL P2 (#2652): sizing the part → total link itself (an identity withdrawn, or none declared) still reads the part in
    // the total's unit, so the card says it; the writer takes the answer in that unit either way.
    out.push({ node_id: from, via: 'definitional_part', unit: source.unit, other_label: label(source.child) });
  } else if (source?.via === 'product') {
    out.push({ node_id: from, via: 'product', unit: source.unit, other_label: productWords(source.operands) });
  }
  const target = readings.get(to);
  if (target?.via === 'gauge') {
    out.push({ node_id: to, via: 'gauge', unit: target.unit, other_label: label(target.child),
      ...(target.replaces === from ? { replaces: true as const } : {}) });
  } else if (target?.via === 'sized_parents' && !target.parents.includes(from) && target.parents.length > 0) {
    out.push({ node_id: to, via: 'sized_parents', unit: target.unit, other_label: label(target.parents[0]!) });
  } else if (target?.via === 'definitional_part') {
    out.push({ node_id: to, via: 'definitional_part', unit: target.unit, other_label: label(target.child) });
  } else if (target?.via === 'product') {
    out.push({ node_id: to, via: 'product', unit: target.unit, other_label: productWords(target.operands) });
  }
  return out;

  function productWords(operands: readonly [string, string]): string {
    return `\u2018${label(operands[0])}\u2019 \u00d7 \u2018${label(operands[1])}\u2019`;
  }
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
 * DL 5884931550). The approval card shows exactly {from, to, effect, quote} and any end-unit readings; its caller passes this token of THAT
 * reading, and the writer recomputes it over what it is asked to write. A proposal with no reading shown has no token
 * to pass, and one whose shown reading differs from the write has the wrong one: either way nothing is written. It binds
 * the READING; the graph half is `expected` (analysis hash + edge token).
 */
export function linkEffectReadingToken(reading: {
  readonly from: string;
  readonly to: string;
  readonly effect: LinkEffectStatement;
  readonly quote: string;
  readonly unit_readings?: readonly LinkEffectUnitReading[];
  readonly reversal?: LinkEffectReversal;
  readonly link_selected?: true;
}): string {
  const { amount, amount_unit, per_source_change, per_source_change_unit } = reading.effect;
  const bound = { from: reading.from, to: reading.to, effect: { amount, amount_unit, per_source_change, per_source_change_unit }, quote: reading.quote,
    ...(reading.unit_readings?.length ? { unit_readings: reading.unit_readings } : {}),
    ...(reading.reversal !== undefined ? { reversal: reading.reversal } : {}),
    ...(reading.link_selected === true ? { link_selected: true } : {}) };
  return `reading:${createHash('sha256').update(stableStringify(bound)).digest('hex')}`;
}
const refuse = (reason: LinkEffectRefusal): LinkEffectEditResult => ({ kind: 'refused', reason });

/**
 * ⭐ THE GAUGE'S SIGN (MC 21: "M→child = ±1, its stored sign"): the stored child link's own orientation, read before the
 * write. ONE rule for the writer and the commit door (#2634 r1 P2), so the door never admits a gauge the writer would not write.
 */
export function storedGaugeSign(edge: { readonly strength?: unknown; readonly effect_direction?: unknown }): 1 | -1 {
  const s = edge.strength as { mean?: unknown } | undefined;
  const mean = typeof s?.mean === 'number' && Number.isFinite(s.mean) ? s.mean : 0;
  const direction = edge.effect_direction === 'positive' || edge.effect_direction === 'negative' ? edge.effect_direction
    : mean < 0 ? 'negative' : mean > 0 ? 'positive' : null;
  return direction === 'negative' ? -1 : 1;
}
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function applyLinkEffectEdit(params: ApplyLinkEffectEditParams): LinkEffectEditResult {
  const { from, to, effect, expected } = params;
  if (typeof params.quote !== 'string' || params.quote.trim() === '' || params.quote.length > QUOTE_MAX) return refuse('quote_invalid');
  if (typeof params.reading_token !== 'string'
    || params.reading_token !== linkEffectReadingToken({ from, to, effect, quote: params.quote, unit_readings: params.unit_readings,
      reversal: params.reversal, link_selected: params.link_selected })) {
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

  // Unit readings are identity content, outside the analysis hash: independently re-check eligibility against the
  // persisted node and its other sized links. A level or governing unit added since approval makes adoption stale.
  const unitReadings = params.unit_readings ?? [];
  const prepared = prepareLinkEffectUnitReadings(params.persistedGraph, from, to, effect, params.quote,
    { link_selected: params.link_selected === true });
  if (prepared.ask !== undefined || stableStringify(prepared.unit_readings) !== stableStringify(unitReadings)
    // A % at the user's own 0 is stored in points, exactly as its card said (Science F1); never as a bare %.
    || stableStringify(withPointsAtZero(effect, prepared.points_at_zero, from, to)) !== stableStringify(effect)) {
    return refuse('unit_mismatch');
  }
  if (unitReadings.length > 0) {
    for (const reading of unitReadings) {
      const node = nodes.find(n => n.id === reading.node_id);
      if (node === undefined || (reading.node_id !== from && reading.node_id !== to)) return refuse('unit_mismatch');
      // Emit exactly the strict NodeV3 carrier. Extra keys silently drop the whole reading on register/reload.
      node.unit_reading = unitReadingCarrier(reading);
    }
  }

  // ── THE UNITS ARE THE ENDS' OWN — never converted by guess ─────────────────────────────────────────────────────────
  const view = magnitudeNodes(nodes, percentLevelIds(graph));
  const readings = mediatorReadings(graph);
  const sourceNode = withAdoptedPercentFrame(nodes.find(n => n.id === from), withMediatorReading(view.get(from)!, readings.get(from), 'source'));
  const targetNode = withAdoptedPercentFrame(nodes.find(n => n.id === to), withMediatorReading(view.get(to)!, readings.get(to), 'target'));
  // ⭐ (B) THE GAUGE (Science #87 6006425419): the user's END-TO-END answer through a level-less M sizes lever→M in M's one
  // child's units, and M→child = ±1 (its stored sign) is written in the SAME mutation (never before, never asked apart).
  // brief3's fallback (6006685510 (2)): only the lever whose Olumi-sized link the answer replaces may answer.
  const mediated = readings.get(to);
  // Only a NEW gauge is written. A stored, intact one is never rewritten (Codex r2 P1): a later answer keeps its sign
  // through the one statement rule (`linkEffectGaugeStatement`).
  const gauge = mediated?.via === 'gauge' && mediated.stored !== true ? mediated : undefined;
  if (gauge?.replaces !== undefined && gauge.replaces !== from) return refuse('unit_mismatch');
  const gaugeEdge = gauge === undefined ? undefined
    : graph.edges.filter(isRec).find(e => e.from === to && e.to === gauge.child && isDirectedEdge(e as never));
  if (gauge !== undefined && gaugeEdge === undefined) return refuse('unit_mismatch');
  // ⛔ Codex r1 P1: the gauge write is the second edge's write: it never touches a definition in use.
  if (gauge !== undefined && definitionalLinkInUse(graph, to, gauge.child, params.lastRunIdentityUse ?? null) !== null) return refuse('definitional_link');
  const endUnits = linkEffectEndUnits(graph, from, to);
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
  // The stated sign must agree with the STORED link, or carry the exact reversal the approval card disclosed. A token
  // for an ordinary sizing cannot approve a reversal: both old and proposed direction are bound into its reading.
  // The link's direction is the SIGNED SLOPE (amount ÷ per_source_change; PR Review 5883720887): "lowering price by £1
  // gains 50" (+50 per −1) runs the same way as "raising it by £1 loses 50" (−50 per +1).
  const directionOf = (e: Rec): 'positive' | 'negative' | null => {
    const mean = isRec(e.strength) && finite(e.strength.mean) ? e.strength.mean : 0;
    return e.effect_direction === 'positive' || e.effect_direction === 'negative' ? e.effect_direction
      : mean < 0 ? 'negative' : mean > 0 ? 'positive' : null;
  };
  // ⭐ (B) THE GAUGE KEEPS M'S ORIENTATION (MC 21: "M→child = ±1"): M→child = g, its stored sign, so M is measured in the
  // child's units AS IT ALREADY MOVES IT, and the user's END-TO-END figure E sizes lever→M = E × g. Every other link into or
  // out of M keeps its meaning (a +1 gauge would silently flip them), and the ordinary sign check below is the PATH's.
  const gaugeSign = gaugeEdge === undefined ? 1 : storedGaugeSign(gaugeEdge);
  // Read the same prospective units as consent and sizing: an adopted own-noun unit removes an unwritten gauge.
  // Stored gauges still govern, and the direction check below still refuses an undisclosed reversal.
  const stated = linkEffectGaugeStatement(graph, from, to, effect);
  if (gaugeEdge !== undefined && stated.amount !== effect.amount * gaugeSign) return refuse('unit_mismatch');
  const direction = Math.sign(stated.amount) * Math.sign(stated.per_source_change) < 0 ? 'negative' : 'positive';
  const storedDirection = directionOf(edge);
  if (params.reversal !== undefined && (!isRec(params.reversal) || Object.keys(params.reversal).length !== 2
    || params.reversal.from !== storedDirection || params.reversal.to !== direction
    || params.reversal.from === params.reversal.to)) return refuse('sign_conflict');
  if (storedDirection !== null && storedDirection !== direction && params.reversal === undefined) return refuse('sign_conflict');

  // ── THE CONSTRUCTION PATH'S OWN SIZING ────────────────────────────────────────────────────────────────────────────
  // ⭐ G1b answer door: the range the user wrote around their figure in the quoted sentence (`centreRangeOfQuote`, the
  // door's own reading, bound by the reading token through the quote) is carried exactly as construction carries the same
  // sentence from a brief (`natural_effect.stated_range`, `end: 'centre'`), so the chat and the brief size it alike.
  const centre = centreRangeOfQuote(params.quote, effect);
  const sizing = sizeLink(
    { direction, effect_amount: stated.amount, effect_per_source_change: stated.per_source_change, user_stated: true,
      ...(centre !== undefined ? { stated_range: centre } : {}) },
    sourceNode,
    targetNode,
  );
  // ⭐ S5t (Science d5 #87 6007669630; DL): a USER's size the frames cannot hold (|β| > 1) is written at its full β and the
  // frames are refit below by CONSTRUCTION's own rule, exactly as the same sentence in a brief would be. Every other
  // sizing problem is still a refusal.
  const fitsByRefit = params.frameRefit === true && sizing.problem === 'not_representable' && sizing.outcome === 'user_stated';
  if (sizing.problem !== undefined && !fitsByRefit) return refuse(sizing.problem);
  if (sizing.outcome !== 'user_stated' || sizing.natural_effect === undefined) return refuse('unconvertible');

  // Placeholder licence (P48 dry walk, 8 Oct): the receipt's BEFORE side names who sized it, so no reader turns a
  // placeholder's prior into a band ("Strong → Moderate" on a link nobody sized). Additive: \`before\` is a record.
  const before = { from, to, strength: { ...strength }, effect_direction: edge.effect_direction, provenance: { ...provenance },
    ...(isPlaceholderLink(edge) ? { sizing: 'placeholder' as const } : {}) };
  // Olumi's why, its old size, its clamp marker and its "holds by definition" claim describe OLUMI's figure, never the
  // user's (Review Desk; Codex buddy r1): `reasoning` would be read as the stated reason for a user-set link, a stale
  // `clamped_from` keeps "cut short" asked, and `definitional` would call the user's size a definition. MC P0: a user size
  // clears `mean_projected` (Olumi's projected-mean record) together with the mean/magnitude change, so the hash moves.
  const { reasoning: _olumisWhy, basis: _olumisBasis, natural_effect: _oldSize, clamped_from: _oldClamp, definitional: _olumisDefinition, mean_projected: _projectedMean, ...keptProvenance } = provenance;
  edge.strength = { ...strength, mean: sizing.mean, std: sizing.std };
  edge.effect_direction = direction;
  // RT-6: an end taking this link's stored unit, or a newly disclosed sentence unit, keeps its change in the words
  // STATED (checked equal to that end above), so the card's read-back holds, including source percentage points.
  // The card's figures ARE the stored ones (Codex buddy r1 P2): the sizing rounds to 6 significant figures to cancel float
  // error, so once it reproduces the user's figures their exact numbers are stored; a sizing that does not is no write.
  const sameToSixFigures = (stated: number, sized: number): boolean => Number(stated.toPrecision(6)) === sized;
  if (!sameToSixFigures(stated.amount, sizing.natural_effect.amount)
    || !sameToSixFigures(stated.per_source_change, sizing.natural_effect.per_source_change)) return refuse('unconvertible');
  const naturalEffect = {
    ...sizing.natural_effect,
    amount: stated.amount,
    per_source_change: stated.per_source_change,
    ...(endUnits.source.adopted !== undefined || unitReadings.some(r => r.node_id === from)
      ? { per_source_change_unit: effect.per_source_change_unit } : {}),
    ...(endUnits.target.adopted !== undefined || endUnits.target.storeAsStated === true || unitReadings.some(r => r.node_id === to)
      ? { amount_unit: effect.amount_unit } : {}),
  };
  // The confirmed reading is identity content, outside the analysis hash; every other provenance key (not Olumi's) survives.
  edge.provenance = { ...keptProvenance, source: 'user_specified', magnitude: 'user_stated', natural_effect: naturalEffect,
    source_quote: params.quote, reading: 'agent_proposed_user_confirmed' };
  edge.provenance_display = 'user_set';
  // A6e: `defaulted` is whole-edge; the statement sizes the strength only, so existence stays Olumi's per field.
  if (edge.defaulted === true) edge.exists_defaulted = true;
  delete edge.defaulted;
  // A6f: a natural effect states the size, not its spread — the std is the sizing's, still not the user's.
  edge.std_defaulted = true;
  if (gaugeEdge !== undefined) {
    // The gauge: sized, never the user's (MIXED), never a placeholder or a projected mean, never Olumi's old size or why.
    const kept = isRec(gaugeEdge.provenance) ? gaugeEdge.provenance : {};
    const { reasoning: _gaugeWhy, basis: _gaugeBasis, natural_effect: _gaugeSize, clamped_from: _gaugeClamp, definitional: _gaugeDefinition,
      mean_projected: _gaugeProjected, ...keptGauge } = kept;
    gaugeEdge.strength = { ...(isRec(gaugeEdge.strength) ? gaugeEdge.strength : {}), mean: gaugeSign };
    gaugeEdge.effect_direction = gaugeSign < 0 ? 'negative' : 'positive';
    gaugeEdge.provenance = { ...keptGauge, magnitude: 'olumi_estimate', sized_by_identity: { op: GAUGE_OP } };
    if (gaugeEdge.defaulted === true) gaugeEdge.exists_defaulted = true;
    delete gaugeEdge.defaulted;
    gaugeEdge.std_defaulted = true;
  }

  // ⭐ S5t: ONE refit rule for the brief and the chat (no chat-only path): construction's `refitFramesForStatedEffects`, called
  // as construction calls it, then its clamp-at-persist. A frame is a choice of UNITS: every link touching a re-framed node
  // keeps its natural size, and raw levels and the raw target stay. If the refit does not fit THIS link (v1 refuses a factor
  // target, a target an option sets or a limit names, a bounded scale, a moving spread, or a new cut), nothing is written.
  let written: Rec & { nodes: unknown[]; edges: unknown[] } = graph;
  let refitFrom: unknown;
  if (fitsByRefit) {
    // Only THIS link moves the frames: a stored graph construction would already refit (another user link it now fits) is
    // refused, so no other link's size changes because of this sentence.
    if (refitFramesForStatedEffects(params.persistedGraph as Rec).refits.length > 0) return refuse('not_representable');
    refitFrom = structuredClone(graph);
    const fitted = refitFramesForStatedEffects(graph);
    const mine = (fitted.graph.edges as Rec[]).find(e => e.from === from && e.to === to && isDirectedEdge(e as never));
    if (mine === undefined || !finite((mine.strength as Rec | undefined)?.mean) || Math.abs((mine.strength as Rec).mean as number) > 1) {
      return refuse('not_representable');
    }
    written = clampForPersist(fitted.graph) as typeof graph;
    // r2 (Codex r1 on #2631): no OTHER link's analysed size may move (a clamped sibling, or one from an implicit frame).
    if (!refitKeepsOtherLinks(refitFrom as Rec, written, new Set([`${from}→${to}`]))) return refuse('not_representable');
    // r2b (Codex r2 on #2631): a refit never breaks a gauge (the one written with this answer, or one already stored).
    if (!storedGaugesKept(refitFrom, written)) return refuse('not_representable');
  }
  const writtenEdge = (written.edges as Rec[]).find(e => e.from === from && e.to === to && isDirectedEdge(e as never)) ?? edge;
  // ⭐ S5t-W (e7 #87 6011176086; Science Q2 6009456901: a frame change is never narrated as a change): the links the refit
  // RESCALED (β = b·F_s/F_t, natural size unchanged), each with its persisted mean before and after, recorded on this
  // write's own receipt so S7 can tell them from an Olumi re-estimate (`frameRefitMove`, build-run-delta.ts). Only links
  // this write did not itself change: the user's link is the receipt's target, and a gauge the answer sized is a sizing.
  const persistedMean = (g: unknown, e: Rec): unknown => (isRec(g) && Array.isArray(g.edges)
    ? (g.edges as Rec[]).find(x => x.from === e.from && x.to === e.to && isDirectedEdge(x as never))?.strength as Rec | undefined : undefined)?.mean;
  const frameRefit = refitFrom === undefined ? [] : (written.edges as Rec[]).flatMap((e) => {
    if (!isDirectedEdge(e as never) || (e.from === from && e.to === to)) return [];
    const before = persistedMean(params.persistedGraph, e);
    const after = (e.strength as Rec | undefined)?.mean;
    return finite(before) && finite(after) && before !== after && persistedMean(refitFrom, e) === before
      ? [{ from: String(e.from), to: String(e.to), before_mean: before, after_mean: after }] : [];
  });
  const parsed = GraphV3.safeParse(written);
  if (!parsed.success) return refuse('invalid_graph');
  // `.catch(undefined)` can make the graph parse succeed after dropping a malformed reading. Never report the card's
  // disclosed unit as saved unless each named node still carries precisely that reading after the real reload parse.
  if (unitReadings.some(reading => stableStringify(parsed.data.nodes.find(n => n.id === reading.node_id)?.unit_reading)
    !== stableStringify(reading.unit_reading))) return refuse('unit_mismatch');
  const fact = AdjustEdgeStrengthHandlerFactSchema.parse({
    fact_type: 'adjust_edge_strength',
    fact_version: 1,
    noop: false,
    result: {
      target_id: `${from}→${to}`,
      status: 'applied',
      before,
      after: { from, to, strength: { ...(writtenEdge.strength as Rec) }, effect_direction: direction, provenance: writtenEdge.provenance, stated_quote: params.quote,
        ...(frameRefit.length > 0 ? { frame_refit: frameRefit } : {}),
        // P48 (buddy r1 P2-5): the gauge this answer sized also changed; name it so "changed since the last Run" marks it.
        ...(gaugeEdge !== undefined ? { also_changed_links: [{ from: String(gaugeEdge.from), to: String(gaugeEdge.to) }] } : {}) },
    },
  });
  return { kind: 'mutated', mutatedGraph: written, graph: parsed.data, handlerFacts: [fact as HandlerFact],
    ...(sizing.statement !== undefined ? { statement: sizing.statement } : {}), ...(refitFrom !== undefined ? { refitFrom } : {}) };
}
