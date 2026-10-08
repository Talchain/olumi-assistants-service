/**
 * ⭐ THE USER-CONFIRMED PRODUCT — the canonical writer (DL #72 5887510885; contract Canonical 5887564539).
 *
 * "MRR = price × subscribers": the user confirms, on a displayed card, that one quantity IS the product of others. This
 * writer stores exactly that on the quantity's own node, in the carrier every reader already reads:
 *   · `nonlinear_identity = {operation: 'product', factor_ids, stated_in_brief: true}` — the user's claim, so every
 *     reader says it as fact, never as "Olumi reads …" (`productIdentityClause`);
 *   · a confirmed part the card read at TODAY's level through its one user cause takes, where it has none of its own,
 *     that cause's RANGE as `scale_frame` and the card's own figure as its TODAY level, stamped with the cause's user
 *     source (`todaysLevelFor`; R3 5907594976 + CR 5908327529: without both the Run is blocked, `IDENTITY_FRAME_MISSING`
 *     then ISL's `identity_operand_missing`; AIQ 5908364515). The later count stays the Run's;
 *   · nothing else on the graph moves (the door's scope guard, `identityConfirmPostimageIsScoped`).
 * The carrier is an analysis input (`computeAnalysisAffectingGraphHash` hashes it as stored), so the write moves the
 * analysis revision: the prior Run reads stale and a new Run is required. No schemas release: the carrier is CEE's
 * declared `NodeV3.nonlinear_identity`, PLoT and ISL already read it, and the receipt is the existing `edit_graph` fact.
 *
 * IT RECORDS ONLY WHAT CONSTRUCTION WOULD ADMIT. The declaration is judged by `admitStoredProductDeclaration` — the
 * construction rule (`markProductIdentities`) on the stored graph — so a card can never record a product the drafter's
 * own admission would have refused. A different carrier already on the node is never overwritten.
 *
 * IN-PROCESS by design, the link-effect writer's shape: Runtime's approval-card path calls it through the level door's
 * `identity_confirm`, which commits `mutatedGraph` + `handlerFacts` on the one CAS-guarded append. Pure: the stored graph
 * is never mutated.
 */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { EditGraphHandlerFactSchema } from '@talchain/schemas/orchestrator';

import { admitStoredProductDeclaration, type StoredProductDeclarationRefusal } from '../agent-lane/admit-model.js';
import { proposeProductIdentity, todaysLevelFor } from '../agent-lane/identity-proposal.js';
import { identityConfirmBaseIsWritable } from './editable-graph.js';
import { LEVEL_WRITER_KINDS } from '../coaching/identity-not-evaluated-ask.js';
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { plotResolvesFrame } from '../../cee/graph-readiness/identity-frames.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { normaliseAbsenceOnly } from '../persisted-graph-projection.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { identityConflictsWithScope } from '../agent-lane/goal-scope.js';
import type { GoalScope } from '../../schemas/goal-scope.js';

export interface IdentityWithdrawalReading {
  outcome_id: string;
  factor_ids: string[];
  stated_in_brief: boolean;
  words: string;
  reading_token: string;
}
export function identityWithdrawalFor(goal: Record<string, unknown>, scope: GoalScope): IdentityWithdrawalReading | undefined {
  if (!identityConflictsWithScope(goal, scope)) return undefined;
  const held = goal.nonlinear_identity as { factor_ids: string[]; stated_in_brief: boolean };
  const reading = { outcome_id: String(goal.id), factor_ids: [...held.factor_ids], stated_in_brief: held.stated_in_brief,
    words: `Withdraw ${held.stated_in_brief ? 'your confirmed' : "Olumi's inferred"} product reading of ${String(goal.label)}; retain both operand values.` };
  return { ...reading, reading_token: createHash('sha256').update(stableStringify(reading)).digest('hex') };
}
/** Used inside the existing approved atomic writer. No graph append and no numerical repair here. */
export function applyIdentityWithdrawalToGoal(goal: Record<string, unknown>, scope: GoalScope, approved: IdentityWithdrawalReading): Record<string, unknown> | null {
  const now = identityWithdrawalFor(goal, scope);
  if (!now || now.reading_token !== approved.reading_token || !isDeepStrictEqual(now, approved)) return null;
  const { nonlinear_identity: _identity, ...without } = goal;
  return without;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The reading the approval card SHOWED: which quantity is the product of which, in the card's own words. */
export interface IdentityConfirmReading {
  readonly outcome_id: string;
  /** In the order the card named them. */
  readonly factor_ids: readonly string[];
  /** The card's displayed sentence (1..400), bound into the token so other words cannot approve it. */
  readonly words: string;
}

export interface ApplyIdentityConfirmEditParams extends IdentityConfirmReading {
  /** The STORED graph (strict server-side read) — never a client copy. */
  readonly persistedGraph: unknown;
  /** The wire analysis hash (`computeAnalysisAffectingGraphHash`) the card was issued against; moved ⇒ `superseded`. */
  readonly expected_graph_hash: string;
  /** `identityConfirmReadingToken` of the reading the user APPROVED; absent or different ⇒ `reading_not_confirmed`. */
  readonly reading_token: string;
}

export type IdentityConfirmRefusal =
  | 'words_invalid'
  | 'reading_not_confirmed'
  | 'invalid_graph'
  | 'superseded'
  | 'outcome_not_found'
  | 'carrier_conflict'
  | 'goal_scope_conflict'
  | 'already_carried'
  | 'operand_level_missing'
  | Exclude<StoredProductDeclarationRefusal, 'invalid_graph'>;

export type IdentityConfirmEditResult =
  | {
      readonly kind: 'mutated';
      /** The stored graph with the one carrier written (a copy; the input is untouched). */
      readonly mutatedGraph: unknown;
      /** The same graph through the strict parse — the gate every writer passes. */
      readonly graph: GraphV3T;
      readonly handlerFacts: readonly HandlerFact[];
    }
  | { readonly kind: 'refused'; readonly reason: IdentityConfirmRefusal; readonly detail?: string };

const WORDS_MAX = 400;

/**
 * ⭐ A PRODUCT IS RECORDED ONLY ON THE APPROVAL OF A DISPLAYED READING (the link-effect rule, AIQ 5885290014). The card
 * shows {outcome, factors, words}; its caller passes this token of THAT reading and the writer recomputes it over what it
 * is asked to write. No card shown ⇒ no token; a card with other words or other factors ⇒ the wrong one: nothing written.
 */
export function identityConfirmReadingToken(reading: IdentityConfirmReading): string {
  const bound = { outcome_id: reading.outcome_id, operation: 'product', factor_ids: [...reading.factor_ids], words: reading.words };
  return `identity:${createHash('sha256').update(stableStringify(bound)).digest('hex')}`;
}

/** What the Yes writes on a confirmed part read at today's level: only what it lacks (a range, a level). One rule for the
 * writer and its scope guard. */
function todaysWrite(part: Rec, today: { raw: number; unit: string; source: string; frame: number }): { scale_frame?: number; observed_state?: Rec } {
  const out: { scale_frame?: number; observed_state?: Rec } = {};
  if (!plotResolvesFrame(part)) out.scale_frame = today.frame;
  const os = isRec(part.observed_state) ? part.observed_state : undefined;
  if (typeof os?.value !== 'number') {
    const cap = typeof os?.cap === 'number' && os.cap > 0 ? os.cap : typeof part.scale_frame === 'number' && part.scale_frame > 0 ? part.scale_frame : today.frame;
    out.observed_state = { value: today.raw / cap, raw_value: today.raw, unit: today.unit, source: today.source };
  }
  return out;
}

/**
 * ⛔ NO YES OVER A PART WITH NO LEVEL (DL blocker, Paul's golden brief B1, scenario 828d87ac, 8 Oct): the card offered
 * "Olumi reads ‘MRR’ as ‘Pro plan price’ × ‘Pro paying subscribers’" while ‘Pro paying subscribers’ (an outcome the drafter
 * left level-less) had no figure; the Yes recorded it as the user's, and both Runs refused `identity_operand_missing` (ISL
 * multiplies a product only over every part's level today). The parts this writer cannot give a level today: no level of
 * their own, and none read through the user's figure on a levelled cause (`todaysLevelFor`, the level `todaysWrite` would
 * write). ONE predicate for the writer and every door that offers the card, so the card is never offered where its Yes
 * would be refused. By label, in factor order. Pure.
 */
export function identityPartsWithoutLevel(persistedGraph: unknown, factorIds: readonly string[]): { readonly id: string; readonly label: string; readonly kind: string }[] {
  if (!isRec(persistedGraph) || !Array.isArray(persistedGraph.nodes)) return [];
  const out: { id: string; label: string; kind: string }[] = [];
  for (const id of new Set(factorIds)) {
    const part = persistedGraph.nodes.find((n): n is Rec => isRec(n) && n.id === id);
    if (part === undefined) continue;
    const os = isRec(part.observed_state) ? part.observed_state : undefined;
    // ⛔ ONLY THE USER'S FIGURE IS A LEVEL HERE (DL correction, 8 Oct; Paul's 2 Oct brief §9 check 1: "With unknown
    // subscribers, do not invent that result"; Science §(p): an Olumi estimate needs a basis). B1 9f32a4b4's 250 is the
    // drafter's, with no basis (levels carry no basis field yet), so it is MISSING: the reading never computes from it.
    const owner = classifyValueSource(os?.source);
    const usersLevel = typeof os?.value === 'number' && Number.isFinite(os.value) && (owner === 'user_stated' || owner === 'user_ratified');
    // Today's level read through the user's figure counts only where the part has NO value of its own: that is the only
    // case `todaysWrite` writes it (#2851 buddy r1 P1-2: an Olumi value with no raw figure passed here and was kept).
    // An EXACT copy of that figure is the user's figure too (AIQ 5906371639, served bdc4ff54: Olumi's 1,500 copied from the
    // user's 1,500 'Current paying subscribers'); any other value of its own is not (buddy r1 P1-2).
    const ownValue = typeof os?.value === 'number' && Number.isFinite(os.value);
    const today = todaysLevelFor(persistedGraph, id);
    if (usersLevel || (today !== null && (!ownValue || os?.raw_value === today.raw))) continue;
    out.push({ id, label: typeof part.label === 'string' && part.label.trim() !== '' ? part.label.trim() : id, kind: String(part.kind) });
  }
  return out;
}

/**
 * What is said INSTEAD of the card: the missing figures asked first, never approximated (the words of
 * `composeIdentityNotEvaluatedAsk`'s `identity_operand_missing`). A part no control can record a level on
 * (`LEVEL_WRITER_KINDS`: a factor only) is never asked for, since an answer could not be saved: the limit is said instead.
 */
export function identityPartLevelAsk(goalLabel: string, formula: readonly string[], missing: readonly { readonly label: string; readonly kind: string }[]): string {
  const q = (l: string): string => `‘${l}’`;
  const and = (xs: readonly string[]): string => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
  const as = `${q(goalLabel)} as ${formula.map(q).join(' × ')}`;
  const askable = missing.filter((m) => LEVEL_WRITER_KINDS.includes(m.kind));
  if (askable.length === missing.length) {
    const one = missing.length === 1;
    return `To work out ${as}, I need ${and(missing.map((m) => q(m.label)))}: what ${one ? 'is it' : 'are they'} today?`;
  }
  const unsaid = missing.filter((m) => !LEVEL_WRITER_KINDS.includes(m.kind));
  const one = unsaid.length === 1;
  return `Olumi can’t work out ${as} yet: ${and(unsaid.map((m) => q(m.label)))} ${one ? 'has' : 'have'} no figure in the model, `
    + `and Olumi can’t record one for ${one ? 'it' : 'them'} yet, so there is nothing for you to confirm.`;
}

/**
 * Whether the STORED model holds a reading whose card may be offered: one to confirm, a base its writer can record, and
 * every part with a level (`identityPartsWithoutLevel`). The re-offer's predicate (`readingWaiting`), the same as the Run hint's.
 */
export function identityCardOfferable(storedGraph: unknown): boolean {
  const card = proposeProductIdentity(storedGraph);
  return card !== null && identityConfirmBaseIsWritable(storedGraph) && identityPartsWithoutLevel(storedGraph, card.factor_ids).length === 0;
}

const refuse = (reason: IdentityConfirmRefusal, detail?: string): IdentityConfirmEditResult =>
  ({ kind: 'refused', reason, ...(detail !== undefined ? { detail } : {}) });

export function applyIdentityConfirmEdit(params: ApplyIdentityConfirmEditParams): IdentityConfirmEditResult {
  const { outcome_id, factor_ids, words } = params;
  if (typeof words !== 'string' || words.trim() === '' || words.length > WORDS_MAX) return refuse('words_invalid');
  if (typeof params.reading_token !== 'string'
    || params.reading_token !== identityConfirmReadingToken({ outcome_id, factor_ids, words })) {
    return refuse('reading_not_confirmed');
  }
  if (!isRec(params.persistedGraph) || !Array.isArray(params.persistedGraph.nodes) || !Array.isArray(params.persistedGraph.edges)) {
    return refuse('invalid_graph');
  }
  // ── REVISION-SAFE: the analysis revision is the one the card was issued against ──────────────────────────────────
  const hashBefore = computeAnalysisAffectingGraphHash(params.persistedGraph as never);
  if (hashBefore !== params.expected_graph_hash) return refuse('superseded');

  const graph = structuredClone(params.persistedGraph) as Rec & { nodes: unknown[]; edges: unknown[] };
  const outcome = graph.nodes.find((n): n is Rec => isRec(n) && n.id === outcome_id);
  if (outcome === undefined) return refuse('outcome_not_found');
  const distinct = [...new Set(factor_ids)];
  if (identityConflictsWithScope({ ...outcome, nonlinear_identity: { operation: 'product', factor_ids: distinct } })) {
    return refuse('goal_scope_conflict', 'This product covers a component of the total goal. Correct its scope before confirming an identity.');
  }

  // ── NEVER OVER ANOTHER CARRIER. Olumi's own reading of the SAME product is what the card confirms (it becomes the
  // user's); anything else on the node — a sum, another product, a malformed value — is refused, never replaced.
  let factorOrder = distinct;
  if (outcome.nonlinear_identity !== undefined) {
    const held = outcome.nonlinear_identity;
    const sameProduct = isRec(held) && held.operation === 'product' && Array.isArray(held.factor_ids)
      && held.factor_ids.length === distinct.length && distinct.every((id) => (held.factor_ids as unknown[]).includes(id));
    if (!sameProduct) return refuse('carrier_conflict');
    if (held.stated_in_brief === true) return refuse('already_carried');
    factorOrder = [...(held.factor_ids as string[])];
  }

  // ── THE CONSTRUCTION RULE, on the stored graph ─────────────────────────────────────────────────────────────────────
  const admitted = admitStoredProductDeclaration(params.persistedGraph, { outcome_id, factor_ids: distinct });
  if (!admitted.ok) return admitted.reason === 'invalid_graph' ? refuse('invalid_graph') : refuse(admitted.reason, admitted.detail);
  const unlevelled = identityPartsWithoutLevel(params.persistedGraph, factorOrder);
  if (unlevelled.length > 0) {
    const labelOf = (id: string): string => {
      const n = graph.nodes.find((x): x is Rec => isRec(x) && x.id === id);
      return typeof n?.label === 'string' && n.label.trim() !== '' ? n.label.trim() : id;
    };
    return refuse('operand_level_missing', identityPartLevelAsk(labelOf(outcome_id), factorOrder.map(labelOf), unlevelled));
  }

  const carrier = { operation: 'product' as const, factor_ids: factorOrder, stated_in_brief: true };
  outcome.nonlinear_identity = carrier;
  for (const id of factorOrder) {
    const part = graph.nodes.find((n): n is Rec => isRec(n) && n.id === id);
    const today = part === undefined ? null : todaysLevelFor(params.persistedGraph, id);
    if (part === undefined || today === null) continue;
    const expected = todaysWrite(part, today);
    if (expected.scale_frame !== undefined) part.scale_frame = expected.scale_frame;
    if (expected.observed_state !== undefined) part.observed_state = expected.observed_state;
  }

  const parsed = GraphV3.safeParse(graph);
  if (!parsed.success) return refuse('invalid_graph');
  // `NodeV3.nonlinear_identity` is `.catch(undefined)`: a carrier the strict parse dropped was not written.
  if (!isDeepStrictEqual(parsed.data.nodes.find((n) => n.id === outcome_id)?.nonlinear_identity, carrier)) return refuse('invalid_graph');

  const hashAfter = computeAnalysisAffectingGraphHash(graph as never) || null;
  const label = typeof outcome.label === 'string' && outcome.label.trim() !== '' ? outcome.label.trim() : 'this quantity';
  const summary = `Confirmed how "${label}" is calculated`;
  const kind = outcome.kind === 'goal' || outcome.kind === 'outcome' || outcome.kind === 'factor' ? outcome.kind : 'goal';
  const fact = EditGraphHandlerFactSchema.parse({
    fact_type: 'edit_graph',
    fact_version: 1,
    noop: false,
    result: {
      edit_kind: 'structural',
      status: 'applied',
      operations_count: 1,
      affected_entities: [{ kind, label: label.slice(0, 120) }],
      graph_hash_before: hashBefore || null,
      graph_hash_after: hashAfter,
      safe_summary: summary.length <= 80 ? summary : 'Confirmed how this quantity is calculated',
      impact: 'high',
      rerun_recommended: true,
    },
  });
  return { kind: 'mutated', mutatedGraph: graph, graph: parsed.data, handlerFacts: [fact as HandlerFact] };
}

/**
 * ⛔ ONLY THE ONE CARRIER MAY CHANGE: no other node, no other member of this node, no edge, no top-level field — and,
 * on a confirmed part read at today's level, exactly the range and today level it lacked (`todaysWrite`).
 */
export function identityConfirmPostimageIsScoped(storedBefore: unknown, after: unknown, outcomeId: string): boolean {
  const before = normaliseAbsenceOnly(storedBefore);
  if (!isRec(before) || !isRec(after) || !Array.isArray(before.nodes) || !Array.isArray(after.nodes)) return false;
  if (after.nodes.length !== before.nodes.length) return false;
  const restored = structuredClone(after) as Rec & { nodes: unknown[] };
  const at = restored.nodes.findIndex((n) => isRec(n) && n.id === outcomeId);
  const was = (before.nodes as unknown[]).find((n) => isRec(n) && n.id === outcomeId);
  if (at < 0 || !isRec(was)) return false;
  const now = restored.nodes[at] as Rec;
  if (Object.hasOwn(was, 'nonlinear_identity')) now.nonlinear_identity = structuredClone(was.nonlinear_identity);
  else delete now.nonlinear_identity;
  const confirmed = isRec(after.nodes.find((n) => isRec(n) && n.id === outcomeId)) ? (after.nodes.find((n) => isRec(n) && n.id === outcomeId) as Rec).nonlinear_identity : undefined;
  for (const id of isRec(confirmed) && Array.isArray(confirmed.factor_ids) ? confirmed.factor_ids : []) {
    const part = restored.nodes.find((n): n is Rec => isRec(n) && n.id === id);
    const prior = (before.nodes as unknown[]).find((n): n is Rec => isRec(n) && n.id === id);
    const today = part === undefined || prior === undefined ? null : todaysLevelFor(before, String(id));
    if (part === undefined || prior === undefined || today === null) continue;
    const expected = todaysWrite(prior, today);
    if (expected.scale_frame !== undefined && part.scale_frame === expected.scale_frame) {
      if (Object.hasOwn(prior, 'scale_frame')) part.scale_frame = structuredClone(prior.scale_frame); else delete part.scale_frame;
    }
    if (expected.observed_state !== undefined && isDeepStrictEqual(part.observed_state, expected.observed_state)) {
      if (Object.hasOwn(prior, 'observed_state')) part.observed_state = structuredClone(prior.observed_state); else delete part.observed_state;
    }
  }
  return isDeepStrictEqual(restored, before);
}
