/**
 * ⛔ A TARGET THE OPTIONS MOVE ONLY THROUGH ITS PARTS, ON LINKS OLUMI HAS NOT SIZED, HAS NO CHECKABLE LIMIT (R-c: AI
 * Quality ruling #72 5881541947, accepted by the Codex DL 5881593118). The level-limit baseline carrier (T4,
 * `level-limit-baseline.ts`) and the per-limit fold (`constraint-feasibility.ts`) share ONE predicate, for level and
 * change frames alike. Its one import is the sizer's own unit rule (`naturalAmountUnitsOf`), which reaches neither module.
 *
 * An option that sets a PART of a target (a factor upstream of it, a direct parent or further up) and not the target
 * itself moves it only through the model's links. ISL then scores a limit on that target through those links' sizes.
 * When a link on that path is a bare placeholder, the P is an artefact of the placeholder coefficient, not an estimate
 * of the user's quantity: journey C's "Additional Advertising" at £18k on a £15k limit read P 0.695 (the verifier's T4
 * measurement), and a user-stated base cannot upgrade it (a `change_abs` P never reads the base).
 *
 * WITHHELD when some option moves a part and not the target, AND either:
 *   · (i)  a link on that option's path to the target is a bare placeholder: its `provenance.magnitude` is not an
 *          estimate (`olumi_estimate`) or the user's own (`user_stated`), or its `provenance.natural_effect.amount_unit`
 *          is not the unit the sizer says a size in for the node it points at (`naturalAmountUnitOf`: "percentage
 *          points" only for a percentage level on 100, else the node's unit), or that natural
 *          effect was written for another mean than the edge now holds. A path is sized only if EVERY link is.
 *          `defaulted` is NOT the discriminator: Olumi's sized links carry it too (AIQ 5881541947, 5882087383);
 *   · (ii) the target declares a `nonlinear_identity`: the engine does not combine parts by it yet ("product treated
 *          as additive", served journey-cloud).
 * ⛔ B6 (AIQ #75 5916187873, superseding R-e's "Olumi-sized links fold normally"): otherwise an option's P is still
 * withheld when it rests on Olumi's guess — (i) a link on its path Olumi sized (served cloud: share % → duration →
 * downtime, `olumi_estimate` in weeks), (ii) the target's own level Olumi's and not definitional (not 0), or (iii) the
 * option setting the target to Olumi's single point with no stated range. A placeholder still reports as a
 * placeholder. Otherwise the normal fold applies. Pure.
 */

import { isSizedOnlyByOlumi, isAcceptedOlumiSize, linkSizing } from '../../cee/magnitude/link-sizing.js';
import { naturalAmountUnitsOf } from '../../cee/magnitude/frame-defaulted-links.js';
import { classifyValueSource, earnsAuthorshipCredit } from '../../cee/graph-readiness/obligation-provenance.js';
import { isAcceptedOlumiEstimate } from '../../cee/transforms/provenance-display.js';
import { exactIdentityOperandLinks } from '../../orchestrator-v5/admission/identity-evaluations.js';
import { sameUnit } from '../../orchestrator-v5/agent-lane/same-unit.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Why a target's limit is withheld. Each is a per-limit `reason` code on the contract (a string: hazard 1). */
export const PLACEHOLDER_PARTS_REASON = 'parts_links_placeholder';
export const PARTS_IDENTITY_UNMODELLED_REASON = 'parts_identity_unmodelled';
export const OLUMI_GUESS_LIMIT_REASON = 'limit_rests_on_olumi_guess';
export type PlaceholderPartsReason =
  | typeof PLACEHOLDER_PARTS_REASON
  | typeof PARTS_IDENTITY_UNMODELLED_REASON
  | typeof OLUMI_GUESS_LIMIT_REASON;

/**
 * A link sized only by Olumi: an `olumi_*` magnitude, OR a plain `defaulted: true` size, and never a link the user sized
 * (`user_specified`), nor a size construction credits to the user (`magnitude: 'user_stated'`, written only where the
 * brief writes that link's own figure: #2389's link-scoped check). `defaulted` on such a size marks a projected field
 * (the spread), not Olumi's size (MODEL GENERATION 5918011036; AIQ 5918035214; P0 PARTNER 5918144110). Read through
 * {@link olumiGuessedLink}.
 */
export function olumiSizedLink(e: Rec): boolean {
  // ONE predicate (L4, `link-sizing.ts`): the parts rule — no Olumi size, accepted or not, scores a parts limit
  // (DL 5929790081 (ii)).
  return isSizedOnlyByOlumi(e);
}

/**
 * ⭐ A link that holds BY DEFINITION is no Olumi guess (DL #75 5916504679; R3 5916525389): money lost to a risk is money
 * the goal does not get, one for one. CHECKED on the stored edge every read, never claimed: construction's type
 * (`provenance.definitional`, #2386, written only when its own size proves it) AND that size still describes the edge
 * (`natural_effect.strength_mean` is the β the Run uses: the sizer's staleness key, `link-effect.ts` `natural()`; P0
 * PARTNER CR 5917993638) AND it is exactly ±1 per unit in ONE unit AND the target's unit is that unit (the source's
 * too, where its node carries one). Anything else stays a guess.
 */
export function holdsByDefinition(e: Rec, unitOf: (id: unknown) => string | undefined): boolean {
  const p = isRec(e.provenance) ? e.provenance : undefined;
  const ne = isRec(p?.natural_effect) ? p!.natural_effect as Rec : undefined;
  if (p?.definitional !== true || ne === undefined) return false;
  if (!finite(ne.strength_mean) || ne.strength_mean !== (isRec(e.strength) ? e.strength.mean : undefined)) return false;
  if (!finite(ne.amount) || !finite(ne.per_source_change) || ne.per_source_change === 0 || Math.abs(ne.amount / ne.per_source_change) !== 1) return false;
  const [amountUnit, sourceUnit] = [ne.amount_unit, ne.per_source_change_unit];
  if (typeof amountUnit !== 'string' || typeof sourceUnit !== 'string' || amountUnit.trim() === '' || !sameUnit(amountUnit, sourceUnit)) return false;
  const [from, to] = [unitOf(e.from), unitOf(e.to)];
  return to !== undefined && sameUnit(to, amountUnit) && (from === undefined || sameUnit(from, amountUnit));
}

/** Per node id, the unit its level is read in: its own `unit`, else its level's, else (the goal) its target's. */
export function nodeUnitOf(nodes: readonly unknown[]): (id: unknown) => string | undefined {
  const byId = new Map(nodes.filter(isRec).map((n) => [n.id, n] as const));
  return (id) => {
    const n = byId.get(id);
    return n === undefined ? undefined
      : [n.unit, isRec(n.observed_state) ? n.observed_state.unit : undefined, n.kind === 'goal' ? n.goal_threshold_unit : undefined,
        // RT-6 step 2: only the user's own stated reading, after every own unit; never data.unit or an Olumi reading
        // (DL 5999243055: those must not govern P5 goal testability).
        isRec(n.unit_reading) && n.unit_reading.source === 'user_stated' ? n.unit_reading.unit : undefined]
        .find((x): x is string => typeof x === 'string' && x.trim() !== '');
  };
}

/**
 * ⭐ THE ONE "rests on Olumi's guess" test on a link, read by DECISION-REPRESENTATION row 4 for the goal
 * (`target-testability.ts`, R3 #2371 5914745577) and by B6 for a limit (R3 #75 5915571955): sized only by Olumi, and not
 * a link that holds by definition. One test, so the two gates cannot disagree on the same link (AIQ 5917939324; P0
 * PARTNER 5918016361). Read it over {@link asAnalysed}'s graph: a link out of the calculation is on no path.
 */
export function olumiGuessedLink(e: Rec, unitOf: (id: unknown) => string | undefined): boolean {
  return olumiSizedLink(e) && !holdsByDefinition(e, unitOf);
}

/**
 * ⭐ The SAME test for the GOAL (DR row 4, `target-testability`), minus the one class DL ruling 5929790081 (i) licenses
 * there: Olumi's estimate the user ACCEPTED sizes a link for goal figures. A limit keeps {@link olumiGuessedLink} whole —
 * (ii): no Olumi size, accepted or not, scores a parts limit (CODEX CR #2446 5930402198).
 */
export function olumiGuessedGoalLink(e: Rec, unitOf: (id: unknown) => string | undefined): boolean {
  return olumiGuessedLink(e, unitOf) && !isAcceptedOlumiSize(e);
}

/**
 * The graph the Run computes on (P0 PARTNER #75 5916838445): a node the user kept out of the calculation
 * (`analysis_participation: 'retained_excluded'`, the exact literal `run-analysis-participation-guard.ts` acts on) and
 * every edge touching it are handed to PLoT absent, so they are on no path here either. The goal is never dropped (the
 * guard refuses that run instead), nor `keep` (B6's limited node, whose own limit is being read).
 */
export function asAnalysed<G extends { nodes: readonly unknown[]; edges?: unknown }>(graph: G, keep?: unknown): G {
  const out = new Set(graph.nodes.filter((n) => isRec(n) && n.analysis_participation === 'retained_excluded' && n.kind !== 'goal' && n.id !== keep)
    .map((n) => (n as Rec).id));
  if (out.size === 0) return graph;
  return {
    ...graph,
    nodes: graph.nodes.filter((n) => !(isRec(n) && out.has(n.id))),
    edges: Array.isArray(graph.edges) ? graph.edges.filter((e) => !(isRec(e) && (out.has(e.from) || out.has(e.to)))) : graph.edges,
  };
}

/**
 * One limit finding. B6's (`OLUMI_GUESS_LIMIT_REASON`) says WHICH input is Olumi's (AIQ #75 5916187873 (a)): a link it
 * sized on the option's path (`link`, the first such link), today's level of the limited quantity (`level`), or the one
 * point an option sets it to (`point`). The words and the one question follow the arm.
 */
export interface PlaceholderPartsFinding {
  readonly reason: PlaceholderPartsReason;
  readonly partId?: string;
  readonly arm?: 'link' | 'level' | 'point';
  readonly link?: { readonly from: string; readonly to: string };
}

/**
 * A value the user authored (`user_stated`) or admitted as their own assumption: the user's, not Olumi's guess.
 *
 * ⛔ EXCEPT OLUMI'S FIGURE THE USER ACCEPTED. The approved adoption writes the same `user_assumption` literal plus
 * the approval as `reviewed_by_user` (`isAcceptedOlumiEstimate`); crediting that pair let B6 call a limit resting on
 * Olumi's number "the user's" after a bare Accept — served `5479e15e`, guest `c708fca5` (#75 5921124922). Reads the
 * whole carrier, because the literal alone cannot tell the two writers apart (DL CR on #2412 5921764485).
 */
function usersOwn(carrier: unknown): boolean {
  if (!isRec(carrier) || isAcceptedOlumiEstimate(carrier)) return false;
  return earnsAuthorshipCredit(classifyValueSource(carrier.source)) || carrier.source === 'user_assumption';
}

const SIZED_MAGNITUDES: ReadonlySet<unknown> = new Set(['olumi_estimate', 'user_stated']);

const norm = (u: unknown): string | undefined =>
  typeof u === 'string' && u.trim().length > 0 ? u.trim().toLowerCase() : undefined;

/**
 * ⛔ MG 5936733302 (the root of R3 DEFECT 2, 5936673643): per node with a LEVEL limit, that limit's unit. A node with NO
 * unit of its own is read in it: construction sizes the links into such a node in its limit's unit ("initiatives per
 * sprint" on "Sprint initiatives tackled properly", served 799d1a5d), and a reader that looked only at the node read
 * those sized links as unsized, so the limit stayed withheld as `parts_links_placeholder` and the Agent said "placeholder".
 * A node whose level limits disagree on the unit gets none (never a guess).
 */
export function limitUnitsOf(limits: unknown): ReadonlyMap<unknown, string> {
  const out = new Map<unknown, string>();
  const ambiguous = new Set<unknown>();
  for (const c of Array.isArray(limits) ? limits : []) {
    if (!isRec(c) || typeof c.node_id !== 'string' || c.value_frame !== 'level' || norm(c.unit) === undefined) continue;
    const seen = out.get(c.node_id);
    if (seen !== undefined && norm(seen) !== norm(c.unit)) ambiguous.add(c.node_id);
    else out.set(c.node_id, c.unit as string);
  }
  for (const id of ambiguous) out.delete(id);
  return out;
}

/**
 * L1 r2 (Science 393023, 7 Oct): an ABSENT node unit is established at read time only by the user's current figures
 * on both sides. EVERY user-stated touching link must agree (incoming amount, outgoing per-source change). Estimates,
 * hypotheses and projected means never establish authority, even with a user stamp. No node or provenance is written.
 */
export function userStatedLinkUnitsOf(nodes: readonly Rec[], edges: readonly Rec[]): ReadonlyMap<unknown, string> {
  const own = nodeUnitOf(nodes);
  const natural = naturalAmountUnitsOf(nodes);
  const touching = new Map<unknown, Array<{ edge: Rec; incoming: boolean }>>();
  for (const edge of edges) {
    if (linkSizing(edge) !== 'user') continue;
    for (const [id, incoming] of [[edge.to, true], [edge.from, false]] as const) {
      const links = touching.get(id) ?? [];
      links.push({ edge, incoming });
      touching.set(id, links);
    }
  }
  const out = new Map<unknown, string>();
  for (const node of nodes) {
    if (typeof node.id !== 'string' || own(node.id) !== undefined || norm(natural.get(node.id)) !== undefined) continue;
    const links = touching.get(node.id) ?? [];
    let unit: string | undefined;
    let incoming = false;
    let outgoing = false;
    const agrees = links.every(({ edge, incoming: into }) => {
      const p = isRec(edge.provenance) ? edge.provenance : undefined;
      const effect = p !== undefined && isRec(p.natural_effect) ? p.natural_effect : undefined;
      // An estimate is not the user's figure; all touching user stamps still take part in the fail-closed check.
      if (p === undefined || p.source === 'cee_hypothesis' || p.mean_projected === true
        || (typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_'))) return false;
      const mean = isRec(edge.strength) ? edge.strength.mean : undefined;
      if (effect === undefined || !finite(mean) || mean !== effect.strength_mean || !finite(effect.amount)
        || !finite(effect.per_source_change) || effect.per_source_change === 0) return false;
      const u = into ? effect.amount_unit : effect.per_source_change_unit;
      if (typeof u !== 'string' || u.trim() === '' || (unit !== undefined && !sameUnit(unit, u))) return false;
      unit ??= u;
      incoming ||= into;
      outgoing ||= !into;
      return true;
    });
    if (agrees && incoming && outgoing && unit !== undefined) out.set(node.id, unit);
  }
  return out;
}

const NO_LIMIT_UNITS: ReadonlyMap<unknown, string> = new Map();

/**
 * Per node, the unit the sizer says a link's size in ("percentage points" only for a percentage LEVEL on 100) — or, for a
 * node with no unit of its own, its level limit's unit ({@link limitUnitsOf}).
 */
const sizerUnitsOf = (nodes: readonly Rec[], limitUnits: ReadonlyMap<unknown, string> = NO_LIMIT_UNITS, edges: readonly Rec[] = []): Map<unknown, string | undefined> => {
  const ownUnit = nodeUnitOf(nodes);
  const stated = userStatedLinkUnitsOf(nodes, edges);
  return new Map([...naturalAmountUnitsOf(nodes)].map(([id, u]) => [id,
    ownUnit(id) === undefined && limitUnits.has(id) ? norm(limitUnits.get(id)) : norm(u) ?? norm(stated.get(id))] as const));
};

/**
 * A link Olumi (or the user) sized, in the unit of the node it points at, whose size still describes the link: the
 * natural effect speaks only while the edge's mean is the β it was written for (magnitude contract, R&C 5845818897).
 */
function linkIsSized(edge: Rec, unitById: ReadonlyMap<unknown, string | undefined>): boolean {
  // Science 393023 LICENCE ruling 3 (P53x): a contradictory natural effect cannot size a projected mean.
  if (linkSizing(edge) === 'placeholder') return false;
  const p = isRec(edge.provenance) ? edge.provenance : undefined;
  if (p === undefined || !SIZED_MAGNITUDES.has(p.magnitude)) return false;
  const effect = isRec(p.natural_effect) ? p.natural_effect : undefined;
  const to = unitById.get(edge.to);
  if (effect === undefined || to === undefined || !sameUnit(effect.amount_unit, to)) return false;
  const mean = isRec(edge.strength) ? edge.strength.mean : undefined;
  return typeof mean === 'number' && mean === effect.strength_mean;
}

/**
 * ⛔ A STRENGTH THE USER STATED IS THEIRS, NOT A PLACEHOLDER (lock A PJ-A3, R3 #72 5900778834; AIQ 5900753496; MG
 * 5900810410). Paul's "price sensitivity is very high" is written as `provenance.source: 'user_specified'` with no
 * natural size, so `linkIsSized` read it as unsized and R-c dropped churn's baseline: his churn ≤ 4% limit went unscored
 * exactly when he strengthened the link into it. The P then rests on the user's own stated strength — what the limit
 * should reflect — so for R-c it counts as authored. Only R-c reads this; the goal-certainty rule keeps `sizedLinkTest`.
 */
function userStatedStrength(edge: Rec): boolean {
  const p = isRec(edge.provenance) ? edge.provenance : undefined;
  // A user-confirmed strength remains authored even when it also carries a natural figure.
  // A user stamp cannot turn an Olumi estimate or projected mean into their own strength.
  return p?.source === 'user_specified'
    && !(typeof p.magnitude === 'string' && p.magnitude.startsWith('olumi_')) && p.mean_projected !== true;
}

/**
 * THE ONE "is this link sized" test, over a graph's nodes: a link Olumi or the user sized, in the unit of the node it
 * points at, written for the mean it now holds. Shared with the goal-certainty rule (`goal-certainty.ts`), so the two
 * rulings (AI Quality 5882087383, 5882366427) read one definition of "unsized".
 */
export function sizedLinkTest(nodes: readonly Rec[], limitUnits: ReadonlyMap<unknown, string> = NO_LIMIT_UNITS, edges: readonly Rec[] = []): (edge: Rec) => boolean {
  const unitById = sizerUnitsOf(nodes, limitUnits, edges);
  const unitOf = nodeUnitOf(nodes);
  // A link that holds by definition is sized by it (never asked about: `link-size-ask.ts`; MG sweep C3).
  return (edge) => holdsByDefinition(edge, unitOf) || linkIsSized(edge, unitById);
}

/** The option sets a level on the node (a bare finite number, or `{ value }`), as PLoT reads an intervention. */
function setsLevel(v: unknown): boolean {
  return (typeof v === 'number' && Number.isFinite(v)) || (isRec(v) && typeof v.value === 'number' && Number.isFinite(v.value));
}

/**
 * Why a limit on `targetId` is withheld, or `null` when it is not (no option moves the target only through its parts,
 * or every link on each such path is sized and the target declares no identity). `options` are the options PLoT scores
 * (the run's final wire options: `{ interventions }` keyed by node id).
 */
export function targetMovedOnlyThroughPlaceholderParts(
  targetId: string,
  nodes: readonly Rec[],
  edges: readonly Rec[],
  options: ReadonlyArray<Record<string, unknown>>,
  limitUnits: ReadonlyMap<unknown, string> = NO_LIMIT_UNITS,
): PlaceholderPartsReason | null {
  return placeholderPartsFinding(targetId, nodes, edges, options, limitUnits)?.reason ?? null;
}

/** An option's id as PLoT and the stored results carry it (`option_id`, else `id`). */
export function optionIdOf(o: Record<string, unknown>): string | undefined {
  if (typeof o.option_id === 'string' && o.option_id !== '') return o.option_id;
  return typeof o.id === 'string' && o.id !== '' ? o.id : undefined;
}

/**
 * ⭐ R-c PER OPTION (AI Quality #72 5900908629, lock A PJ-A3; MG 5900810410). The options whose movement of `targetId`
 * depends on an unsized Olumi link on ANY of their paths into it (AIQ's tightening), with why. One such option withholds
 * ITS verdict on the limit, never every option's: Paul's added retention offer (an `olumi_placeholder` into churn) no
 * longer blanks the churn limit for his price options, which move churn by his own stated strength. Pure.
 */
export function placeholderMovedOptions(
  targetId: string,
  nodes: readonly Rec[],
  edges: readonly Rec[],
  options: ReadonlyArray<Record<string, unknown>>,
  limitUnits: ReadonlyMap<unknown, string> = NO_LIMIT_UNITS,
  identityEvaluations?: readonly unknown[],
): Map<string, PlaceholderPartsReason> {
  const out = new Map<string, PlaceholderPartsReason>();
  for (const o of options) {
    const id = optionIdOf(o);
    if (id === undefined || out.has(id)) continue;
    const finding = placeholderPartsFinding(targetId, nodes, edges, [o], limitUnits, identityEvaluations);
    if (finding !== null) out.set(id, finding.reason);
  }
  return out;
}

/**
 * The same predicate, with the PART an option sets whose path to the target carries the unsized link (for
 * `parts_links_placeholder`), so the withheld row can ask for that link's size (AI Quality 5882087383: "How much would a
 * price rise move monthly churn? Give a figure, or let Olumi estimate it.").
 */
/** A declared SUM whose every operand reaches it through a link that holds by definition (`holdsByDefinition`). */
function definitionalSum(target: Rec, edges: readonly Rec[], unitOf: (id: unknown) => string | undefined): boolean {
  const identity = target.nonlinear_identity as Rec;
  const operands = Array.isArray(identity.factor_ids) ? identity.factor_ids : [];
  return identity.operation === 'sum' && operands.length >= 2 && operands.every((id) => edges.some((e) => e.from === id
    && e.to === target.id && holdsByDefinition(e, unitOf)));
}

export function placeholderPartsFinding(
  targetId: string,
  allNodes: readonly Rec[],
  allEdges: readonly Rec[],
  options: ReadonlyArray<Record<string, unknown>>,
  /** Per node, its level limit's unit ({@link limitUnitsOf}): read for a node with no unit of its own. */
  limitUnits: ReadonlyMap<unknown, string> = NO_LIMIT_UNITS,
  identityEvaluations?: readonly unknown[],
): PlaceholderPartsFinding | null {
  const { nodes, edges } = asAnalysed({ nodes: allNodes, edges: allEdges }, targetId);
  const kindById = new Map(nodes.map((n) => [n.id, n.kind] as const));
  // The target's parts: every node upstream of it that is not an option or the decision (T4's walk).
  const parts = new Set<unknown>();
  const queue: unknown[] = [targetId];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const e of edges) {
      if (e.to !== at || parts.has(e.from) || e.from === targetId) continue;
      const k = kindById.get(e.from);
      if (typeof k !== 'string' || k === 'option' || k === 'decision') continue;
      parts.add(e.from);
      queue.push(e.from);
    }
  }
  const target = nodes.find((n) => n.id === targetId);
  const today = isRec(target?.observed_state) ? target.observed_state : undefined;
  // (ii) fires only on a level Olumi SUPPLIED ("Olumi's estimate of today's X", AIQ 5916187873 (a)) that is not
  // definitional: today's 0 of a quantity nothing produces yet (no migration, no downtime) is the quantity's
  // definition, not an estimate ((c); R3 5916179718). A target with no level at all is not this arm's trigger: B5's
  // own fold already says whose base an unlevelled limit has.
  const level = today?.raw_value ?? today?.value;
  const levelIsOlumis = today !== undefined && typeof level === 'number' && level !== 0 && !usersOwn(today);
  const movers = parts.size === 0 ? [] : options
    .map((o) => (isRec(o.interventions) ? o.interventions : {}))
    .filter((iv) => !setsLevel(iv[targetId]) && Object.keys(iv).some((k) => parts.has(k)));
  let guessed: { partId: string; from: string; to: string } | undefined;
  if (movers.length > 0) {
    // A product cannot be added up on links. A SUM whose every part link holds by definition (+1 per 1, one unit) IS the
    // linear combination, so its limit is scored on the parts (DL ruling (ii) 5929790081; SEMANTIC MODEL SPEC A4).
    if (target !== undefined && isRec(target.nonlinear_identity) && !definitionalSum(target, edges, nodeUnitOf(nodes))) {
      return { reason: PARTS_IDENTITY_UNMODELLED_REASON };
    }
    const unitById = sizerUnitsOf(nodes, limitUnits, edges);
    const exactOperands = exactIdentityOperandLinks(nodes, edges, identityEvaluations, 'evaluated_only');
    const unitOf = nodeUnitOf(nodes);
    const onPath = new Set<unknown>([...parts, targetId]);
    for (const iv of movers) {
      // Forward from each part this option sets, through parts only: every link walked lies on a path to the target.
      for (const partId of Object.keys(iv).filter((k) => parts.has(k))) {
        const reached = new Set<unknown>([partId]);
        const walk: unknown[] = [partId];
        while (walk.length > 0) {
          const at = walk.shift();
          for (const e of edges) {
            if (e.from !== at || !onPath.has(e.to)) continue;
            // A link that holds by definition is sized by that definition, whatever unit token the sizer would pick
            // ("%" vs "percentage points"): checked first (MG sweep C2, a percent-level total).
            if (!exactOperands.has(e) && !holdsByDefinition(e, unitOf) && !linkIsSized(e, unitById) && !userStatedStrength(e)) return { reason: PLACEHOLDER_PARTS_REASON, partId };
            if (!exactOperands.has(e) && guessed === undefined && olumiGuessedLink(e, unitOf)) guessed = { partId, from: String(e.from), to: String(e.to) };
            if (e.to !== targetId && !reached.has(e.to)) {
              reached.add(e.to);
              walk.push(e.to);
            }
          }
        }
      }
    }
    // ⛔ B6 (DL #75 5915507578 item 1; AIQ 5915438520 + ruling 5916187873; R3 5915571955): no placeholder on the way,
    // but the option's value of the target rests on Olumi's guess — (i) a link on its path Olumi sized, or (ii) the
    // target's own level is Olumi's — so its P restates the guess (served cloud r1: "downtime ≤ 2 weeks" 0.9339 /
    // 0.9995 on Olumi's weeks), and a disclosure does not make it a check.
    if (guessed !== undefined) {
      return { reason: OLUMI_GUESS_LIMIT_REASON, arm: 'link', partId: guessed.partId, link: { from: guessed.from, to: guessed.to } };
    }
    if (levelIsOlumis) return { reason: OLUMI_GUESS_LIMIT_REASON, arm: 'level' };
  }
  // ⛔ B6 (iii), an option that SETS the target to one point (AIQ 5915438520: a guessed single-point duration scores
  // 100%/0%): withheld unless the point is the user's, or the option states a range for it. (ii) An option that leaves
  // the target where it is today — sets nothing on its way, or sets today's level — has a P that is today's level
  // against the limit: withheld when that level is Olumi's (AIQ 5916187873 (c): "3% churn" vs "< 4%" is an exact 100%
  // resting on Olumi's 3%).
  for (const o of options) {
    const iv = isRec(o.interventions) ? o.interventions : {};
    const holds = !setsLevel(iv[targetId]) && !Object.keys(iv).some((k) => parts.has(k));
    if (holds) {
      if (levelIsOlumis) return { reason: OLUMI_GUESS_LIMIT_REASON, arm: 'level' };
      continue;
    }
    if (!setsLevel(iv[targetId])) continue;
    // The stored option carries the setting's owner and raw figure; the wire copy may carry a bare projected number.
    const node = nodes.find((n) => n.kind === 'option' && n.id === optionIdOf(o));
    const stored = [node?.interventions, isRec(node?.data) ? node.data.interventions : undefined]
      .map((x) => (isRec(x) ? x[targetId] : undefined)).find(isRec);
    const setting = stored ?? iv[targetId];
    if (holdsTodaysLevel(setting, target)) {
      if (levelIsOlumis) return { reason: OLUMI_GUESS_LIMIT_REASON, arm: 'level' };
      continue;
    }
    // A range lifts it only as the user stated it: the stored `interventions[T].range` with the user's `source` (TEMPORAL
    // #2382's writer; AIQ 5914222384: a range with no author is refused). The wire's `intervention_ranges` carries no
    // author, so it never does on its own.
    const theirs = isRec(setting) && (usersOwn(setting) || (isRec(setting.range) && usersOwn(setting.range)));
    if (!theirs) return { reason: OLUMI_GUESS_LIMIT_REASON, arm: 'point' };
  }
  return null;
}

/** The option sets the target at exactly today's level (the status quo's zero change). */
function holdsTodaysLevel(v: unknown, target: Rec | undefined): boolean {
  const today = isRec(target?.observed_state) ? target.observed_state : undefined;
  if (today === undefined) return false;
  const raw = isRec(v) ? v.raw_value : undefined;
  if (typeof raw === 'number' && typeof today.raw_value === 'number') return raw === today.raw_value;
  const value = typeof v === 'number' ? v : isRec(v) ? v.value : undefined;
  // A bare wire number may be on either scale (projected or raw).
  return typeof value === 'number' && (value === today.value || value === today.raw_value);
}
