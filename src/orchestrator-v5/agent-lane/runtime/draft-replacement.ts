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
import { RETAINED_LIMIT_QUESTION, RETAINED_LIMIT_QUANTITY_QUESTION, unresolvedRetainedLimits, retainedLimitWithheldLine } from '../../../graph/retained-limit.js';
import { GOAL_RECORD_PRECEDENCE, readGoalRecord } from '../../goal-target/goal-record.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { constructionOperationId } from './build-model.js';
import { edgeReviewedByUser, edgeStrengthProvenance } from '../../../cee/graph-readiness/obligation-provenance.js';
import { provenanceOf } from '../../../cee/provenance/provenance-of.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import type { CommittedTurnLedger } from '../../session/store.js';
import { canonicalLabel, TODAY_LEVEL, TODAY_UNIT } from '../model-primitives.js';
import { normaliseGraphForIdentity } from '../../context/graph-identity.js';
import { unitPhraseHead, unitPhraseTail } from '../unit-conflict.js';
import { ratePeriodOf } from '../../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

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
const goalIdsOf = (raw: unknown): Set<string> => new Set(recs(rec(raw)?.nodes)
  .filter((n) => n.kind === 'goal' && typeof n.id === 'string')
  .flatMap((n) => {
    const goal = readGoalRecord(raw, n.id as string);
    return goal === null ? [] : [goal.goal_id];
  }));
/** The quantity a row (or a target) is ON, by the lane's canonical label of its node (or the row's own label). */
const quantityOf = (raw: unknown, c: Rec): string | null => {
  const n = recs(rec(raw)?.nodes).find((x) => x.id === c.node_id);
  const label = typeof n?.label === 'string' ? n.label : typeof c.label === 'string' ? c.label : null;
  return label === null || label.trim() === '' ? null : canonicalLabel(label);
};
const numeric = (c: Rec): c is Rec & { value: number } => typeof c.value === 'number' && Number.isFinite(c.value);
const unitOf = (c: Rec): string => (typeof c.unit === 'string' ? c.unit.trim() : '');

/**
 * Match quantity, stated comparator, figure and frame; the caller supplies the existing figure formatter to
 * recognise unit spelling. Never infer quantity equivalence from a shared figure. Unmatched rows are carried
 * verbatim, together with their node if absent. The result is prepared before the card and its hash are built.
 * A conflicting node/row identity cannot safely carry an unchanged row and is reported, never overwritten.
 */
export function limitsKeptBy(base: unknown, candidate: unknown, figure = (value: number, unit: string) => `${value} ${unit}`) {
  const limitsOf = (raw: unknown) => rowsOf(raw).filter((c) => c.role !== 'goal_target' && !goalIdsOf(raw).has(String(c.node_id))
    && numeric(c) && ['<=', '>=', '<', '>'].includes(String(c.operator)) && c.deadline_metadata == null);
  const rowOf = (c: Rec): HeldRow => ({ node_id: String(c.node_id), operator: String(c.operator_as_stated ?? c.operator),
    value: c.value as number, unit: unitOf(c) });
  const theirs = limitsOf(candidate);
  const kept: HeldRow[] = [];
  const dropped: HeldRow[] = [];
  const carried: HeldRow[] = [];
  const uncertain: { previous: HeldRow; proposed: HeldRow[] }[] = [];
  const nodes = [...recs(rec(candidate)?.nodes)];
  const rows = [...rowsOf(candidate)];
  /** The rows carried from the earlier draft, by identity: they keep their own origin (`targetsStoredInferred`). */
  const carriedRows = new Set<Rec>();
  let conflict = false;
  for (const c of limitsOf(base)) {
    const row = rowOf(c);
    const quantity = quantityOf(base, c);
    const sameFigure = (t: Rec) => String(t.operator_as_stated ?? t.operator) === row.operator
      && t.value === row.value && figure(row.value, unitOf(t)) === figure(row.value, row.unit)
      && (t.value_frame ?? 'level') === (c.value_frame ?? 'level');
    if (theirs.some((t) => quantity !== null && quantityOf(candidate, t) === quantity && sameFigure(t))) {
      kept.push(row);
      continue;
    }
    /**
     * ⛔ THE SAME ROW, RE-SPELLED WITHOUT ITS PERIOD (served marketing-2992, 13 Oct 23:04Z): the redraft wrote the budget's
     * `GBP/year` as `£` on the SAME constraint id, so it was neither kept nor carriable (the id collides) and the whole card
     * was refused. That row is carried UNCHANGED, the earlier row replacing the candidate's, only when the identity, the
     * quantity, the stated comparator, the value and the frame are the same, the earlier unit is the currency over ONE period
     * (`ratePeriodOf`, and nothing else after the currency: not "GBP/customer", a scaled unit or "GBP MRR/year"; Codex buddy),
     * the candidate's unit has nothing after its currency, and the two figures say the same amount. `sameFigure` is NOT
     * loosened: "£" never stands for a yearly limit by itself, and any other same-id difference still refuses.
     */
    const sameId = theirs.find((t) => t.constraint_id === c.constraint_id);
    const head = unitPhraseHead(row.unit);
    if (sameId !== undefined && quantity !== null && quantityOf(candidate, sameId) === quantity && head !== null
      && String(sameId.operator_as_stated ?? sameId.operator) === row.operator && sameId.value === row.value
      && (sameId.value_frame ?? 'level') === (c.value_frame ?? 'level')
      && ratePeriodOf(row.unit) !== null && unitPhraseTail(row.unit).split(' ').filter((w) => w !== '' && w !== 'per').length === 1
      && unitPhraseTail(unitOf(sameId)) === ''
      && figure(row.value, unitOf(sameId)) === figure(row.value, head)) {
      const respelled = structuredClone(c);
      rows[rows.indexOf(sameId)] = respelled;
      carriedRows.add(respelled);
      kept.push(row);
      continue;
    }
    dropped.push(row);
    const proposedRows = theirs.filter(sameFigure);
    const proposed = proposedRows.map(rowOf);
    if (proposed.length > 0) uncertain.push({ previous: row, proposed });
    else carried.push(row);
    const node = recs(rec(base)?.nodes).find((n) => n.id === c.node_id);
    const existing = nodes.find((n) => n.id === c.node_id);
    if (node === undefined || (existing !== undefined && quantityOf(candidate, c) !== quantity)
      || rows.some((r) => r.constraint_id === c.constraint_id)) {
      conflict = true;
      continue;
    }
    if (existing === undefined) nodes.push(structuredClone(node));
    const marker = { state: 'unscored', reason: 'retained_limit_equivalence_unresolved',
      previous_constraint_id: c.constraint_id, proposed_constraint_ids: proposedRows.map((r) => r.constraint_id),
      question: RETAINED_LIMIT_QUESTION };
    const carriedRow: Rec = { ...structuredClone(c), ...(proposedRows.length > 0
      ? { retained_unresolved_limit: { ...marker, role: 'original' } }
      : existing === undefined ? { retained_unresolved_limit: { ...marker, role: 'original',
        reason: 'retained_limit_quantity_unresolved', question: RETAINED_LIMIT_QUANTITY_QUESTION } } : {}) };
    rows.push(carriedRow);
    carriedRows.add(carriedRow);
    // An isolated proposed interpretation is retained for this SAME unanswered question, not made a causal factor.
    // Connected proposed quantities remain independently modelled; only the isolated question carrier is unscored.
    for (const proposedRow of proposedRows) {
      const linked = recs(rec(candidate)?.edges).some((e) => e.from === proposedRow.node_id || e.to === proposedRow.node_id);
      const set = [...nodes, ...recs(rec(candidate)?.options)].some((n) =>
        Object.prototype.hasOwnProperty.call(rec(n.interventions) ?? {}, String(proposedRow.node_id)));
      if (!linked && !set) {
        const index = rows.indexOf(proposedRow);
        rows[index] = { ...proposedRow, retained_unresolved_limit: { ...marker, role: 'proposed' } };
      }
    }
  }
  // The revised draft's own targets are stored `inferred` (`targetsStoredInferred`); its carried limits keep their origin.
  const replacement = { ...rec(candidate), nodes: goalTargetStampsInferred(nodes, candidate),
    goal_constraints: targetsStoredInferred(rows, candidate, carriedRows) };
  // The card's limits are the candidate's own rows as they stand after the carry (a re-spelled row says its earlier unit).
  const candidateLimitIds = new Set(theirs.map((t) => t.constraint_id));
  return { kept, dropped, carried, uncertain, conflict, limits: limitsOf(replacement).filter((r) => candidateLimitIds.has(r.constraint_id)).map(rowOf),
    ...(unresolvedRetainedLimits(replacement).length > 0 ? { withheld: retainedLimitWithheldLine(replacement) } : {}), replacement };
}

/**
 * ⭐ APPROVING AN AI REINTERPRETATION IS NOT AUTHORSHIP (Codex CHECK-3020-45e7c1e3 item 2; DL #3020 r2 (a), 14 Oct): the
 * revised draft's drafter re-reads the user's goal, and its `explicit` on a target is its own claim. Relabelled ‘Partner
 * sign-ups’, Paul's "20 new customers" was stored `explicit` on another entity. So every target row the candidate holds (each
 * `goal_target` row and the goal's own row, the rows `targetsHeldBy` reads, in any frame) is stored `inferred` until a
 * verifier proves the user's own words state it. The rows carried from the earlier draft are limits (`limitsKeptBy`) and keep
 * their origin; the user's typed goal stays the source on the operation. Applied to the replacement `limitsKeptBy` returns.
 */
function targetsStoredInferred(rows: readonly Rec[], candidate: unknown, carried: ReadonlySet<Rec>): Rec[] {
  const goals = goalIdsOf(candidate);
  return rows.map((c) => (!carried.has(c) && (c.role === 'goal_target' || goals.has(String(c.node_id))) && c.provenance === 'explicit'
    ? { ...c, provenance: 'inferred' } : c));
}

/**
 * The same rule on the candidate's GOAL node (#3020 r2 buddy): its target source (the goal record's `source` field) is the host's
 * attestation that the brief wrote the drafter's figure (`holdStatedGoalAttributes`), which checks the figure, never which
 * quantity it is on, so "20 new customers" attested a goal relabelled ‘Partner sign-ups’. Any source but a definitional one is
 * removed (not attested, as when nothing grounds it); a definitional one is not authorship and is kept. The goal's figure,
 * comparator and period stay, so the Run reads the same target. Carried nodes are the earlier draft's limit nodes, never a goal.
 */
function goalTargetStampsInferred(nodes: readonly Rec[], candidate: unknown): Rec[] {
  const goals = goalIdsOf(candidate);
  const [field] = GOAL_RECORD_PRECEDENCE.source;
  return nodes.map((n) => {
    if (!goals.has(String(n.id)) || n[field] === undefined || n[field] === 'definitional') return n;
    const { [field]: _userSource, ...rest } = n;
    return rest;
  });
}

/** The candidate's targets for the goal: each `goal_target` row and the goal's own row, with the comparator as stated. */
export function targetsHeldBy(candidate: unknown): { node_id: string; quantity: string | null; comparator: string; value: number; unit: string }[] {
  const goals = goalIdsOf(candidate);
  return rowsOf(candidate)
    .filter((c) => numeric(c) && (c.role === 'goal_target' || goals.has(String(c.node_id))) && c.deadline_metadata == null
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
