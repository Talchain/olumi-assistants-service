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
import {
  classifyValueSource,
  edgeReviewedByUser,
  edgeStrengthProvenance,
  reflectsAHumanAct,
} from '../../../cee/graph-readiness/obligation-provenance.js';
import { linkSizing } from '../../../cee/magnitude/link-sizing.js';
import { goalHorizonVerdict } from '../../goal-target/goal-horizon-verdict.js';
import type { CommittedTurnLedger } from '../../session/store.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | undefined => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : undefined);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.map(rec).filter((x): x is Rec => x !== undefined) : []);
const named = (n: Rec | undefined, fallback: string): string => (typeof n?.label === 'string' && n.label.trim() !== '' ? `‘${n.label.trim()}’` : fallback);

/** The stamps the construction itself writes (`admit-model.ts`, `stated-by-user.ts`): Olumi's, or the brief's own words. */
const DRAFT_VALUE_SOURCES = new Set(['brief_extraction', 'cee_inference', 'inferred', 'cee_repair']);
const DRAFT_LINK_SOURCES = new Set(['brief_extraction', 'cee_hypothesis', 'domain_knowledge']);
const DRAFT_LEVEL_SOURCES = new Set(['brief_extraction', 'cee_hypothesis']);
/** Node-existence stamps that name the user as the one who added it (`identity-proposal.ts` USER_NODE, less the brief's). */
const USER_ADDED_NODE = new Set(['user_set', 'user_specified', 'user_stated', 'user']);

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
      else if (source !== undefined && !(typeof source === 'string' && DRAFT_VALUE_SOURCES.has(source))) {
        found.push(reflectsAHumanAct(classifyValueSource(source))
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
      if (source === undefined || (typeof source === 'string' && DRAFT_LEVEL_SOURCES.has(source))) continue;
      found.push(source === 'user_specified'
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
    else if (source !== undefined && !(typeof source === 'string' && DRAFT_LINK_SOURCES.has(source))) {
      found.push(source === 'user_specified' ? `your link ${link}` : `a link ${link} whose author is not recorded`);
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
const numeric = (c: Rec): c is Rec & { value: number } => typeof c.value === 'number' && Number.isFinite(c.value);
const unitOf = (c: Rec): string => (typeof c.unit === 'string' ? c.unit.trim() : '');

/** The draft's limits (rows that are not the goal's targets), and whether the candidate keeps each at the same figure. */
export function limitsKeptBy(base: unknown, candidate: unknown): { kept: HeldRow[]; dropped: HeldRow[] } {
  const isLimit = (c: Rec) => c.role !== 'goal_target' && numeric(c) && (c.operator === '<=' || c.operator === '>=') && c.deadline_metadata == null;
  const goalIds = (raw: unknown) => new Set(recs(rec(raw)?.nodes).filter((n) => n.kind === 'goal').map((n) => n.id));
  const baseGoals = goalIds(base);
  const theirs = rowsOf(candidate).filter(isLimit);
  const kept: HeldRow[] = [];
  const dropped: HeldRow[] = [];
  for (const c of rowsOf(base).filter((r) => isLimit(r) && !baseGoals.has(r.node_id))) {
    const row = { node_id: String(c.node_id), operator: String(c.operator), value: c.value as number, unit: unitOf(c) };
    (theirs.some((t) => t.operator === row.operator && t.value === row.value && unitOf(t) === row.unit) ? kept : dropped).push(row);
  }
  return { kept, dropped };
}

/** The candidate's targets for the goal: each `goal_target` row and the goal's own row, with the comparator as stated. */
export function targetsHeldBy(candidate: unknown): { node_id: string; comparator: string; value: number; unit: string }[] {
  const goals = new Set(recs(rec(candidate)?.nodes).filter((n) => n.kind === 'goal').map((n) => n.id));
  return rowsOf(candidate)
    .filter((c) => numeric(c) && (c.role === 'goal_target' || goals.has(c.node_id)) && c.deadline_metadata == null
      && (c.value_frame === undefined || c.value_frame === 'level'))
    .map((c) => ({ node_id: String(c.node_id), comparator: String(c.operator_as_stated ?? c.operator), value: c.value as number, unit: unitOf(c) }));
}
