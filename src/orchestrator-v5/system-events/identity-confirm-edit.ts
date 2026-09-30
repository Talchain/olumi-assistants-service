/**
 * ⭐ THE USER-CONFIRMED PRODUCT — the canonical writer (DL #72 5887510885; contract Canonical 5887564539).
 *
 * "MRR = price × subscribers": the user confirms, on a displayed card, that one quantity IS the product of others. This
 * writer stores exactly that on the quantity's own node, in the carrier every reader already reads:
 *   · `nonlinear_identity = {operation: 'product', factor_ids, stated_in_brief: true}` — the user's claim, so every
 *     reader says it as fact, never as "Olumi reads …" (`productIdentityClause`);
 *   · a confirmed part the card read at TODAY's level through its one user cause, and that has no frame of its own,
 *     takes that cause's RANGE as `scale_frame` (`todaysFrameFor`; R3 5907594976: without it the Run is blocked,
 *     `IDENTITY_FRAME_MISSING`). A range only, never a level;
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
import { todaysFrameFor } from '../agent-lane/identity-proposal.js';
import { plotResolvesFrame } from '../../cee/graph-readiness/identity-frames.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { normaliseAbsenceOnly } from '../persisted-graph-projection.js';
import { stableStringify } from '../../orchestrator/context/stable-stringify.js';
import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';

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
  | 'already_carried'
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

  const carrier = { operation: 'product' as const, factor_ids: factorOrder, stated_in_brief: true };
  outcome.nonlinear_identity = carrier;
  for (const id of factorOrder) {
    const part = graph.nodes.find((n): n is Rec => isRec(n) && n.id === id);
    if (part === undefined || plotResolvesFrame(part)) continue;
    const frame = todaysFrameFor(params.persistedGraph, id);
    if (frame !== null) part.scale_frame = frame;
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
 * on a confirmed part that had no frame, exactly the `scale_frame` its one user cause gives it (`todaysFrameFor`).
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
    if (part === undefined || prior === undefined || Object.hasOwn(prior, 'scale_frame') || plotResolvesFrame(prior)) continue;
    if (Object.hasOwn(part, 'scale_frame') && part.scale_frame === todaysFrameFor(before, String(id))) delete part.scale_frame;
  }
  return isDeepStrictEqual(restored, before);
}
