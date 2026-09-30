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

import { naturalAmountUnitsOf } from '../../cee/magnitude/frame-defaulted-links.js';
import { classifyValueSource, earnsAuthorshipCredit } from '../../cee/graph-readiness/obligation-provenance.js';

type Rec = Record<string, unknown>;

const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

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
 * (`user_specified`). The ONE test DECISION-REPRESENTATION row 4's check (2) reads for the goal (`target-testability.ts`,
 * R3 #2371 5914745577) and B6 reads for a limit (R3 #75 5915571955), so the two cannot disagree on "Olumi's guess".
 */
export function olumiSizedLink(e: Rec): boolean {
  const p = isRec(e.provenance) ? e.provenance : undefined;
  return p?.source !== 'user_specified'
    && ((typeof p?.magnitude === 'string' && p.magnitude.startsWith('olumi_')) || e.defaulted === true);
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

/** A value stamp the user authored (`user_stated`) or admitted as their own assumption: the user's, not Olumi's guess. */
function usersOwn(stamp: unknown): boolean {
  return earnsAuthorshipCredit(classifyValueSource(stamp)) || stamp === 'user_assumption';
}

const SIZED_MAGNITUDES: ReadonlySet<unknown> = new Set(['olumi_estimate', 'user_stated']);

const norm = (u: unknown): string | undefined =>
  typeof u === 'string' && u.trim().length > 0 ? u.trim().toLowerCase() : undefined;

/** Per node, the unit the sizer says a link's size in ("percentage points" only for a percentage LEVEL on 100). */
const sizerUnitsOf = (nodes: readonly Rec[]): Map<unknown, string | undefined> =>
  new Map([...naturalAmountUnitsOf(nodes)].map(([id, u]) => [id, norm(u)] as const));

/**
 * A link Olumi (or the user) sized, in the unit of the node it points at, whose size still describes the link: the
 * natural effect speaks only while the edge's mean is the β it was written for (magnitude contract, R&C 5845818897).
 */
function linkIsSized(edge: Rec, unitById: ReadonlyMap<unknown, string | undefined>): boolean {
  const p = isRec(edge.provenance) ? edge.provenance : undefined;
  if (p === undefined || !SIZED_MAGNITUDES.has(p.magnitude)) return false;
  const effect = isRec(p.natural_effect) ? p.natural_effect : undefined;
  const to = unitById.get(edge.to);
  if (effect === undefined || to === undefined || norm(effect.amount_unit) !== to) return false;
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
  return p?.source === 'user_specified';
}

/**
 * THE ONE "is this link sized" test, over a graph's nodes: a link Olumi or the user sized, in the unit of the node it
 * points at, written for the mean it now holds. Shared with the goal-certainty rule (`goal-certainty.ts`), so the two
 * rulings (AI Quality 5882087383, 5882366427) read one definition of "unsized".
 */
export function sizedLinkTest(nodes: readonly Rec[]): (edge: Rec) => boolean {
  const unitById = sizerUnitsOf(nodes);
  return (edge) => linkIsSized(edge, unitById);
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
): PlaceholderPartsReason | null {
  return placeholderPartsFinding(targetId, nodes, edges, options)?.reason ?? null;
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
): Map<string, PlaceholderPartsReason> {
  const out = new Map<string, PlaceholderPartsReason>();
  for (const o of options) {
    const id = optionIdOf(o);
    if (id === undefined || out.has(id)) continue;
    const finding = placeholderPartsFinding(targetId, nodes, edges, [o]);
    if (finding !== null) out.set(id, finding.reason);
  }
  return out;
}

/**
 * The same predicate, with the PART an option sets whose path to the target carries the unsized link (for
 * `parts_links_placeholder`), so the withheld row can ask for that link's size (AI Quality 5882087383: "How much would a
 * price rise move monthly churn? Give a figure, or let Olumi estimate it.").
 */
export function placeholderPartsFinding(
  targetId: string,
  nodes: readonly Rec[],
  edges: readonly Rec[],
  options: ReadonlyArray<Record<string, unknown>>,
): PlaceholderPartsFinding | null {
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
  const levelIsOlumis = today !== undefined && typeof level === 'number' && level !== 0 && !usersOwn(today.source);
  const movers = parts.size === 0 ? [] : options
    .map((o) => (isRec(o.interventions) ? o.interventions : {}))
    .filter((iv) => !setsLevel(iv[targetId]) && Object.keys(iv).some((k) => parts.has(k)));
  let guessed: { partId: string; from: string; to: string } | undefined;
  if (movers.length > 0) {
    if (target !== undefined && isRec(target.nonlinear_identity)) return { reason: PARTS_IDENTITY_UNMODELLED_REASON };
    const unitById = sizerUnitsOf(nodes);
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
            if (!linkIsSized(e, unitById) && !userStatedStrength(e)) return { reason: PLACEHOLDER_PARTS_REASON, partId };
            if (guessed === undefined && olumiSizedLink(e)) guessed = { partId, from: String(e.from), to: String(e.to) };
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
    const ranges = [o.intervention_ranges, node?.intervention_ranges].map((x) => (isRec(x) ? x[targetId] : undefined));
    const theirs = (isRec(setting) && (usersOwn(setting.source) || isRec(setting.range))) || ranges.some(isRec);
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
