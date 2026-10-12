/**
 * ⭐ B RESTATED GOAL — WHEN AN EARLY DRAFT MAY BE REPLACED BY A REVISED ONE (DL ruling (B); PL 6116779075; AIE 0244).
 *
 * Paul's marketing L20 restates the goal as two targets ("a conversion rate of over 15% and secure 20 new customers
 * within the first 3 months") on a draft whose goal is "launch % complete" and which holds neither quantity, so no
 * target row can land. The remedy offered is a REVISED DRAFT prepared by C's own construction from the stored brief and
 * the typed goal, shown as one card and written only on approval.
 *
 * ⛔ THE GATE IS "AN UNREVIEWED AI SCAFFOLD, ALL ORIGINAL HUMAN MATERIAL PRESERVED", NOT "NOTHING THE USER AUTHORED".
 * The brief's own facts, goals and limits are the user's, and the revised draft is built from that same brief, so they
 * are kept (and checked kept: {@link limitsKeptBy}). What may NOT exist is any LATER human contribution, which a
 * replacement would discard. Three existing records are read, at the offer AND again at the approval:
 *   · G1 — the model's own authorship stamps ({@link humanMaterialAfterTheDraft}): a value, review, adopted estimate,
 *     stated level, link, target, limit or attested horizon the user set after the draft. An unknown stamp refuses.
 *   · G2 — the committed-write ledger ({@link writesBesidesTheConstruction}): the construction's own registration is the
 *     ONLY committed write. Guests have no model versions, but every commit row carries `model_version_mutation_id`.
 *   · G3 — the messages ({@link messagesBesidesTheBrief}): only the brief and the typed goal exist (DL: there is no other
 *     durable record of dissent or evidence, and chip or unknown-origin rows count as messages), and the S8 durable
 *     objections reader is empty.
 * ⚠ KNOWN GAP (DL condition 2): other database sinks that write a scenario's graph (`apply_patch_and_log`,
 * `store_draft_graph`, `create_model_version*`, `restore_*`, `append_turn_atomic` v1–v4) do not set the mutation id and
 * are not proven uncalled; G1's stamps are the backstop for a human edit through any of them.
 */
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { constructionOperationId } from './build-model.js';
import { edgeReviewedByUser, edgeStrengthProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { provenanceOf } from '../../../cee/provenance/provenance-of.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import { canonicalLabel, TODAY_LEVEL, TODAY_UNIT } from '../model-primitives.js';
import { normaliseGraphForIdentity } from '../../context/graph-identity.js';
import { unitComparisonKey } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec).filter((x): x is Rec => x !== undefined) : []);
const named = (n: Rec | undefined, fallback: string): string => (typeof n?.label === 'string' && n.label.trim() !== '' ? `‘${n.label.trim()}’` : fallback);

/** The stamps the construction itself writes (`admit-model.ts`, `stated-by-user.ts`): Olumi's, or the brief's own words. */
// DRAFT-TIME membership, not authorship (DL ruling (i), 12 Oct): these sets ask whether a figure entered WITH the draft;
// provenanceOf answers whose, so they stay here, as the listed draft-time read at the link gate below does.
const DRAFT_VALUE_SOURCES = new Set(['brief_extraction', 'cee_inference', 'inferred', 'cee_repair']);
const DRAFT_LINK_SOURCES = new Set(['brief_extraction', 'cee_hypothesis', 'domain_knowledge']);
const DRAFT_LEVEL_SOURCES = new Set(['brief_extraction', 'cee_hypothesis']);
/** Node-existence stamps that name the user as the one who added it (`identity-proposal.ts` USER_NODE, less the brief's). */
const USER_ADDED_NODE = new Set(['user_set', 'user_specified', 'user_stated', 'user']);
const finite = (v: unknown): boolean => typeof v === 'number' && Number.isFinite(v);
/**
 * ⛔ A PRESENT value with no stamp is UNKNOWN authority, not "nobody's" (AIE 0452 AMEND 1): a figure held without a
 * source may be a human edit through a writer that stamps nothing. The one exception is construction's own definition,
 * written unstamped on purpose: "today is 100 % of today" (`admit-model.ts` `framedObservedState`, `model-primitives.ts`).
 */
const holdsAValue = (os: Rec): boolean => finite(os.value) || finite(os.raw_value);
const isTodayDefinition = (os: Rec): boolean => os.unit === TODAY_UNIT && os.raw_value === TODAY_LEVEL;

/**
 * G1. Every later human contribution the model's own stamps record, in plain words (empty = none recorded). A stamp this
 * reader cannot place is UNKNOWN authority and is listed too: unknown state never permits a replacement.
 */
export function humanMaterialAfterTheDraft(raw: unknown): string[] {
  const g = rec(raw);
  const nodes = recs(g?.nodes);
  const byId = new Map(nodes.filter((n) => typeof n.id === 'string').map((n) => [n.id as string, n]));
  const found: string[] = [];
  for (const n of nodes) {
    const os = rec(n.observed_state) ?? rec(rec(n.data)?.observed_state);
    if (os !== undefined) {
      const source = os.source;
      if (rec(os.reviewed_by_user) !== undefined) found.push(`your review of the value for ${named(n, 'a factor')}`);
      else if (source === undefined) {
        if (holdsAValue(os) && !isTodayDefinition(os)) found.push(`a value for ${named(n, 'a factor')} whose author is not recorded`);
      } else if (!(typeof source === 'string' && DRAFT_VALUE_SOURCES.has(source))) {
        found.push(provenanceOf({ value: os }).origin === 'human'
          ? `your figure for ${named(n, 'a factor')}` : `a value for ${named(n, 'a factor')} whose author is not recorded`);
      }
    }
    if (typeof n.provenance === 'string' && USER_ADDED_NODE.has(n.provenance)) found.push(`${named(n, 'a part of the model')}, which you added`);
    if (n.kind === 'goal' && n.threshold_source !== undefined && n.threshold_source !== null && n.threshold_source !== 'brief_extraction') {
      found.push(n.threshold_source === 'user' ? `your target for ${named(n, 'the goal')}` : `a target for ${named(n, 'the goal')} whose author is not recorded`);
    }
    const levels = rec(n.interventions) ?? rec(rec(n.data)?.interventions);
    for (const [factorId, level] of Object.entries(levels ?? {})) {
      const source = rec(level)?.source;
      if (typeof source === 'string' && DRAFT_LEVEL_SOURCES.has(source)) continue;
      found.push(provenanceOf({ setting: level, target: byId.get(factorId) }).origin === 'human'
        ? `your level for ${named(n, 'an option')} on ${named(byId.get(factorId), 'a factor')}`
        : `a level for ${named(n, 'an option')} whose author is not recorded`);
    }
  }
  if (goalHorizonVerdict(raw) === 'steady_attested') found.push('your judgement that the goal holds steady over its horizon');
  for (const e of recs(g?.edges)) {
    const p = rec(e.provenance);
    const source = p?.source;
    const link = `${named(byId.get(String(e.from)), 'a factor')} → ${named(byId.get(String(e.to)), 'a factor')}`;
    const sizing = linkSizing(e);
    if (edgeReviewedByUser(e) || sizing === 'olumi_accepted') found.push(`your review of the link ${link}`);
    else if (!(typeof source === 'string' && DRAFT_LINK_SOURCES.has(source))) {
      found.push(provenanceOf({ link: e }).origin === 'human' ? `your link ${link}` : `a link ${link} whose author is not recorded`);
    } else if (source !== 'brief_extraction' && (sizing === 'user' || edgeStrengthProvenance(e) === 'user_stated')) {
      found.push(`your size for the link ${link}`);
    }
  }
  for (const c of recs(g?.goal_constraints)) {
    if (c.provenance === 'user') found.push(`your limit or target on ${named(byId.get(String(c.node_id)), 'the model')}`);
  }
  return found;
}

/** G2. The committed writes other than the construction's own registration (`build-model.ts`'s create-only register). */
export function writesBesidesTheConstruction(ledger: CommittedTurnLedger, scenarioId: string, brief: string): string[] {
  if (!ledger.complete) return ['more saved history than this check reads'];
  const construction = registrationTurnId(scenarioId, constructionOperationId(scenarioId, brief));
  if (!ledger.write_turn_ids.includes(construction)) return ['no saved record that this draft is the one built from your brief'];
  const later = ledger.write_turn_ids.filter((id) => id !== construction);
  return later.length === 0 ? [] : [`${later.length} saved change${later.length === 1 ? '' : 's'} since the draft`];
}

/**
 * G3. The messages besides the brief (first) and the turns this offer already bound (`allowed`, in order), whatever
 * their origin; this request's own turn is not yet a message. Empty = only the brief and the bound turns exist.
 */
export function messagesBesidesTheBrief(
  ledger: CommittedTurnLedger, brief: string, allowed: readonly string[], currentTurnId: string | undefined,
): string[] {
  if (!ledger.complete) return ['more conversation than this check reads'];
  const turns = ledger.user_message_turn_ids.filter((id) => id !== currentTurnId);
  if (turns.length === 0 || ledger.first_user_message !== brief.trim()) return ['no saved record that your first message is this brief'];
  const rest = turns.slice(1);
  const extra = rest.filter((id) => !allowed.includes(id)).length;
  if (extra > 0) return [`${extra} other message${extra === 1 ? '' : 's'} since your brief`];
  return rest.length === allowed.length && rest.every((id, i) => id === allowed[i]) ? [] : ['a message this offer was made on is missing'];
}

/**
 * The revised draft's input: the stored brief, then the goal the user typed, each verbatim and in that order. Nothing
 * else (no chip, assistant or unknown-origin text) is made part of what construction reads as the user's words.
 */
export function revisedDraftBrief(storedBrief: string, typedGoal: string): string {
  return `${storedBrief.trim()}\n\n${typedGoal.trim()}`;
}

export interface HeldRow { readonly node_id: string; readonly operator: string; readonly value: number; readonly unit: string }
const rowsOf = (raw: unknown): Rec[] => recs(rec(raw)?.goal_constraints);
/** The quantity a row (or a target) is ON, by the lane's canonical label of its node (or the row's own label). */
const quantityOf = (raw: unknown, c: Rec): string | null => {
  const n = recs(rec(raw)?.nodes).find((x) => x.id === c.node_id);
  const label = typeof n?.label === 'string' ? n.label : typeof c.label === 'string' ? c.label : null;
  return label === null || label.trim() === '' ? null : canonicalLabel(label);
};
const numeric = (c: Rec): c is Rec & { value: number } => typeof c.value === 'number' && Number.isFinite(c.value);
const unitOf = (c: Rec): string => (typeof c.unit === 'string' ? c.unit.trim() : '');
/** A limit: a row that is not one of the goal's targets, with a figure, an inequality and no deadline. */
const isLimitRow = (c: Rec): boolean => c.role !== 'goal_target' && numeric(c) && (c.operator === '<=' || c.operator === '>=') && c.deadline_metadata == null;

/**
 * The draft's limits (rows that are not the goal's targets), and whether the candidate keeps each: the SAME quantity (its
 * node's canonical label; AIE 0452 AMEND 2: "<= 25%" on another node is not the founder-time limit), comparator, figure,
 * unit and frame. A limit whose quantity cannot be named is dropped (unresolved identity refuses).
 */
export function limitsKeptBy(base: unknown, candidate: unknown): { kept: HeldRow[]; dropped: HeldRow[] } {
  const isLimit = isLimitRow;
  const goalIds = (raw: unknown) => new Set(recs(rec(raw)?.nodes).filter((n) => n.kind === 'goal').map((n) => n.id));
  const baseGoals = goalIds(base);
  const theirs = rowsOf(candidate).filter(isLimit);
  const kept: HeldRow[] = [];
  const dropped: HeldRow[] = [];
  for (const c of rowsOf(base).filter((r) => isLimit(r) && !baseGoals.has(r.node_id))) {
    const row = { node_id: String(c.node_id), operator: String(c.operator), value: c.value as number, unit: unitOf(c) };
    const quantity = quantityOf(base, c);
    const same = (t: Rec) => quantity !== null && quantityOf(candidate, t) === quantity && t.operator === row.operator
      && t.value === row.value && unitOf(t) === row.unit && (t.value_frame ?? 'level') === (c.value_frame ?? 'level');
    (theirs.some(same) ? kept : dropped).push(row);
  }
  return { kept, dropped };
}

/**
 * ⭐ BATCH F (DL GO (a), 12 Oct; run 4 marketing, scenario 35ecad67, CEE a770ce49): THE DRAFT'S LIMITS ARE CARRIED INTO THE
 * REVISED DRAFT BY CONSTRUCTION. The drafter re-expresses the brief afresh: run 4's limits came back as "GBP/year" for "£/year"
 * and as "Founder marketing time" for "Founder time on campaign", so the strict keeper (`limitsKeptBy`, AIE 0452 AMEND 2)
 * called both dropped and the card was never offered. For each base limit, its counterpart is the candidate's limit on the
 * SAME quantity with the same comparator, figure, frame and unit key (`unitComparisonKey`: £ is GBP, never a conversion), else
 * the ONE candidate limit with those when the base holds no other limit with them (the quantity's label drifted). The
 * counterpart's row becomes the base row's own bytes: the limit is the user's (author and provenance kept). The node stays the
 * revised draft's own, as its card says ("Not carried: Olumi's earlier estimates and links, which are drafted afresh"; the
 * draft gate guarantees the base node holds no later human material): its category, scale and estimate were derived for THIS
 * structure (the base node's bytes made the L20 draft's founder time an unreachable controllable factor, and run 4's budget is
 * an identity formula over the base's own factors). Where the label drifted, that node takes the base's id and name, so ONE
 * concept remains, and every reference to the old id is re-pointed (links, rows, option settings and their `target_match`,
 * identity formulas). The comparator compared is the one STATED (`operator_as_stated`). No counterpart, two, an id already
 * taken, or the old id still named anywhere: nothing is carried for that limit, and the keeper still refuses. Pure: the
 * candidate is copied, never edited.
 */
export function carryDraftLimits(base: unknown, candidate: unknown): unknown {
  const b = rec(base);
  if (b === undefined || rec(candidate) === undefined) return candidate;
  const baseGoals = new Set(recs(b.nodes).filter((n) => n.kind === 'goal').map((n) => n.id));
  const baseLimits = rowsOf(b).filter((r) => isLimitRow(r) && !baseGoals.has(r.node_id));
  let out = candidate as Rec;
  for (const row of baseLimits) out = carryOneLimit(b, out, row, baseLimits) ?? out;
  return out;
}

const limitKey = (c: Rec): string => [c.operator_as_stated ?? c.operator, c.value, c.value_frame ?? 'level', unitComparisonKey(unitOf(c)) ?? unitOf(c)].join('\u0000');

function carryOneLimit(base: Rec, cand: Rec, row: Rec, baseLimits: readonly Rec[]): Rec | null {
  const id = String(row.node_id);
  const baseNode = recs(base.nodes).find((n) => n.id === id);
  const quantity = quantityOf(base, row);
  if (baseNode === undefined || quantity === null) return null;
  const key = limitKey(row);
  const sameKey = rowsOf(cand).filter((t) => isLimitRow(t) && limitKey(t) === key);
  const sameQuantity = sameKey.filter((t) => quantityOf(cand, t) === quantity);
  const counterpart = sameQuantity.length === 1 ? sameQuantity[0]
    : sameQuantity.length === 0 && sameKey.length === 1 && baseLimits.filter((r) => limitKey(r) === key).length === 1 ? sameKey[0] : undefined;
  if (counterpart === undefined) return null;
  const oldId = String(counterpart.node_id);
  const g = structuredClone(cand) as Rec;
  if (oldId !== id && recs(g.nodes).some((n) => n.id === id)) return null;
  (g.goal_constraints as unknown[])[(cand.goal_constraints as unknown[]).indexOf(counterpart)] = structuredClone(row);
  const nodes = g.nodes as Rec[];
  const at = nodes.findIndex((n) => n.id === oldId);
  if (at < 0) return null;
  if (quantityOf(cand, counterpart) !== quantity) nodes[at] = { ...nodes[at], label: baseNode.label };
  if (oldId !== id) {
    nodes[at] = { ...nodes[at], id };
    repointNode(g, oldId, id);
    if (namesAny(g, new Set([oldId]))) return null;
  }
  return limitsKeptBy({ nodes: base.nodes, goal_constraints: [row] }, g).dropped.length === 0 ? g : null;
}

/** Every place a candidate names a node: links, rows, option settings and their `target_match`, identity formulas. */
function repointNode(g: Rec, from: string, to: string): void {
  for (const e of recs(g.edges)) { if (e.from === from) e.from = to; if (e.to === from) e.to = to; }
  for (const r of recs(g.goal_constraints)) if (r.node_id === from) r.node_id = to;
  for (const n of recs(g.nodes)) {
    const settings = rec(n.interventions);
    if (settings !== undefined) {
      if (Object.prototype.hasOwnProperty.call(settings, from)) {
        n.interventions = Object.fromEntries(Object.entries(settings).map(([k, v]) => [k === from ? to : k, v]));
      }
      for (const v of Object.values(rec(n.interventions) ?? {})) {
        const match = rec(rec(v)?.target_match);
        if (match?.node_id === from) match.node_id = to;
      }
    }
    const identity = rec(n.nonlinear_identity);
    if (identity !== undefined && Array.isArray(identity.factor_ids)) identity.factor_ids = identity.factor_ids.map((x: unknown) => (x === from ? to : x));
  }
}

/** True when `value` names any of `ids`, as a string anywhere in it or as a key. */
function namesAny(value: unknown, ids: ReadonlySet<string>): boolean {
  if (typeof value === 'string') return ids.has(value);
  if (Array.isArray(value)) return value.some((v) => namesAny(v, ids));
  if (value !== null && typeof value === 'object') {
    return Object.entries(value as Rec).some(([k, v]) => ids.has(k) || namesAny(v, ids));
  }
  return false;
}

/** The candidate's targets for the goal: each `goal_target` row and the goal's own row, with the comparator as stated. */
export function targetsHeldBy(candidate: unknown): { node_id: string; quantity: string | null; comparator: string; value: number; unit: string }[] {
  const goals = new Set(recs(rec(candidate)?.nodes).filter((n) => n.kind === 'goal').map((n) => n.id));
  return rowsOf(candidate)
    .filter((c) => numeric(c) && (c.role === 'goal_target' || goals.has(c.node_id)) && c.deadline_metadata == null
      && (c.value_frame === undefined || c.value_frame === 'level'))
    .map((c) => ({ node_id: String(c.node_id), quantity: quantityOf(candidate, c), comparator: String(c.operator_as_stated ?? c.operator), value: c.value as number, unit: unitOf(c) }));
}

/**
 * ⛔ THE STORED GRAPH HOLDS THE WHOLE APPROVED CANDIDATE (AIE B34 6119577581: the read-back matching the registration's
 * acknowledgement proves only that the acknowledged graph was read back). Through the canonical identity normaliser
 * (`normaliseGraphForIdentity`), every component the candidate carries — each node, link, option, limit and target, and
 * each of their fields — is held UNCHANGED in the stored graph, and no node, link or row is added beside them. The register
 * route may only ADD fields of its own (its stable `ref` on each node: measured on the REAL route for Paul's L20 candidate,
 * `assist.v1.scenario-graph-register.revised-draft-held.test.ts`). A component omitted or changed BEFORE the
 * acknowledgement fails here even when the read-back agrees with that acknowledgement.
 */
export function approvedGraphHeld(candidate: unknown, stored: unknown): boolean {
  const a = normaliseGraphForIdentity(candidate as never)?.graph;
  const b = normaliseGraphForIdentity(stored as never)?.graph;
  return a !== undefined && b !== undefined && heldUnchanged(a, b);
}

const entityKey = (x: unknown): string | undefined => {
  const k = rec(x)?.id ?? rec(x)?.constraint_id;
  return typeof k === 'string' ? k : undefined;
};
/** `a` held in `b`: the same members (by id where every member has one), each field of `a` equal in `b`; `b` may add fields only. */
function heldUnchanged(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    const keys = a.map(entityKey);
    if (keys.every((k) => k !== undefined) && new Set(keys).size === keys.length) {
      const byKey = new Map(b.map((x) => [entityKey(x), x] as const));
      return a.every((x, i) => byKey.has(keys[i]) && heldUnchanged(x, byKey.get(keys[i])));
    }
    return a.every((x, i) => heldUnchanged(x, b[i]));
  }
  if (a !== null && typeof a === 'object') {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return false;
    return Object.entries(a as Record<string, unknown>)
      .every(([k, v]) => Object.prototype.hasOwnProperty.call(b, k) && heldUnchanged(v, (b as Record<string, unknown>)[k]));
  }
  return a === b;
}
