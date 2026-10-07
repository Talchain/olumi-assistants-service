/**
 * P48 (audit #27) — WHAT CHANGED IN THE MODEL SINCE THE LAST RUN, BY ID, for the canvas's "changed" mark.
 *
 * `recent-changes.ts` answers the same question for the LLM and drops every identifier by contract. A mark needs
 * the identifier, so this is its sibling over the SAME durable class: the applied, non-noop mutation receipts
 * (`MUTATION_RECEIPT_FACT_TYPES`, partitioned against every fact type by the recent-changes conformance test)
 * recorded AFTER the newest Run. A newer Run moves the boundary, so the marks clear by construction; a reload
 * recomputes them from the same persisted facts, so they survive it.
 *
 * Contract (`changed_since_run`, version 1):
 *   - ids only: node ids, and links as `{from, to}` (CEE edges carry no id of their own);
 *   - an added or changed element is marked; a removed one has nothing on the canvas to mark and is dropped;
 *   - `unattributed_changes` counts applied changes whose receipt names no id (an `edit_graph` receipt before
 *     schemas carries `affected_entities[].id`, or a shape this module does not recognise). A consumer MUST NOT
 *     present the marks as complete while it is above 0;
 *   - `complete: false` when the read window may not reach back to the Run (every row read was after it).
 *
 * Pure apart from `readChangedSinceRun`, which never throws: on any failure the caller omits the key.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { isNoopFact } from '../tools/fact-noop.js';
import { MUTATION_RECEIPT_FACT_TYPES } from '../mutation-receipt-fact-types.js';
import type { IdentifiedHandlerFact } from '../types/handler-fact.js';

export const CHANGED_SINCE_RUN_READ_LIMIT = 50;
const RUN_FACT_LOOKAHEAD = 5;
const MAX_NODE_IDS = 200;
const MAX_EDGES = 400;

export interface ChangedSinceRunLink {
  readonly from: string;
  readonly to: string;
}

export interface ChangedSinceRunV1 {
  readonly version: 1;
  /** The Run the marks are relative to; `null` = no Run recorded yet. */
  readonly since_run_id: string | null;
  readonly node_ids: readonly string[];
  readonly links: readonly ChangedSinceRunLink[];
  readonly unattributed_changes: number;
  readonly complete: boolean;
}

export interface RunBoundary {
  readonly run_id: string;
  readonly created_at: string;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : null);

function linkOf(v: unknown): ChangedSinceRunLink | null {
  if (!isRec(v)) return null;
  const from = id(v.from);
  const to = id(v.to);
  return from !== null && to !== null ? { from, to } : null;
}

/** The ids one applied receipt names, or `null` when it names none this module can trust. */
export function idsOfReceipt(fact: HandlerFact): { nodes: string[]; links: ChangedSinceRunLink[] } | null {
  const result = (fact as { result?: unknown }).result;
  if (!isRec(result)) return null;
  switch (fact.fact_type) {
    case 'set_factor_value': {
      const node = id(result.target_id);
      return node === null ? null : { nodes: [node], links: [] };
    }
    case 'add_constraint': {
      // The limit sits on its target node (GoalConstraint.node_id); the constraint id is not a canvas element.
      const node = id((isRec(result.after) ? result.after : {}).node_id) ?? id((isRec(result.before) ? result.before : {}).node_id);
      return node === null ? null : { nodes: [node], links: [] };
    }
    case 'adjust_edge_strength': {
      const main = linkOf(result.after) ?? linkOf(result.before);
      if (main === null) return null;
      const refit = isRec(result.after) && Array.isArray(result.after.frame_refit)
        ? result.after.frame_refit.map(linkOf).filter((l): l is ChangedSinceRunLink => l !== null) : [];
      return { nodes: [], links: [main, ...refit] };
    }
    case 'edit_graph': {
      // Forward-compatible: `affected_entities[].id` (and `from`/`to` for a link) arrive with the schemas field.
      // Until then an edit_graph receipt names labels only, and is counted as unattributed — never matched by label.
      const entities = Array.isArray(result.affected_entities) ? result.affected_entities : [];
      const nodes: string[] = [];
      const links: ChangedSinceRunLink[] = [];
      for (const e of entities) {
        if (!isRec(e)) return null;
        if (e.kind === 'edge') {
          const l = linkOf(e);
          if (l === null) return null;
          links.push(l);
        } else {
          const n = id(e.id);
          if (n === null) return null;
          nodes.push(n);
        }
      }
      return nodes.length + links.length > 0 ? { nodes, links } : null;
    }
    default:
      return null;
  }
}

/**
 * Project the receipts recorded after `boundary` (all of them when `null`). `facts` newest-first, as the store
 * returns them. `windowFull`: the read returned its whole limit, so older receipts may exist.
 */
export function projectChangedSinceRun(
  facts: readonly IdentifiedHandlerFact[],
  boundary: RunBoundary | null,
  windowFull: boolean,
): ChangedSinceRunV1 {
  const since = boundary === null ? null : Date.parse(boundary.created_at);
  const nodes = new Set<string>();
  const links = new Map<string, ChangedSinceRunLink>();
  let unattributed = 0;
  let reachedBoundary = false;
  for (const entry of facts) {
    const at = Date.parse(entry.fact_created_at);
    if (since !== null && (!Number.isFinite(at) || at <= since)) { reachedBoundary = true; break; }
    const fact = entry.fact;
    if (!MUTATION_RECEIPT_FACT_TYPES.has(fact.fact_type) || isNoopFact(fact)) continue;
    const ids = idsOfReceipt(fact);
    if (ids === null) { unattributed += 1; continue; }
    for (const n of ids.nodes) nodes.add(n);
    for (const l of ids.links) links.set(`${l.from}\u0000${l.to}`, l);
  }
  const nodeIds = [...nodes];
  const linkList = [...links.values()];
  const overCap = nodeIds.length > MAX_NODE_IDS || linkList.length > MAX_EDGES;
  return {
    version: 1,
    since_run_id: boundary?.run_id ?? null,
    node_ids: nodeIds.slice(0, MAX_NODE_IDS),
    links: linkList.slice(0, MAX_EDGES),
    unattributed_changes: unattributed,
    complete: !overCap && (reachedBoundary || !windowFull),
  };
}

/** The newest Run with an id, from the store's own validated Run page. */
export function newestRunBoundary(runFacts: readonly IdentifiedHandlerFact[]): RunBoundary | null {
  for (const entry of runFacts) {
    if (entry.fact.fact_type !== 'run_analysis') continue;
    const runId = id((entry.fact as { result?: { run_id?: unknown } }).result?.run_id);
    if (runId !== null) return { run_id: runId, created_at: entry.fact_created_at };
  }
  return null;
}

/**
 * The two durable reads this needs, named structurally: the SessionStore surface stays inside its declared
 * integration points (`scripts/validate-state-write-invariant.sh`), and the route hands its store in.
 */
export interface ChangedSinceRunReads {
  readScenarioRunAnalysisFactsFor?(scenarioId: string, limit: number): Promise<{ readonly facts: readonly IdentifiedHandlerFact[] }>;
  readRecentAppliedMutationFactsFor?(scenarioId: string, limit: number): Promise<readonly IdentifiedHandlerFact[]>;
}

/** Read and project. Never throws: `undefined` = could not answer (the caller omits the key, never sends empty). */
export async function readChangedSinceRun(store: ChangedSinceRunReads, scenarioId: string): Promise<ChangedSinceRunV1 | undefined> {
  if (typeof store.readScenarioRunAnalysisFactsFor !== 'function' || typeof store.readRecentAppliedMutationFactsFor !== 'function') {
    return undefined;
  }
  try {
    const [runPage, receipts] = await Promise.all([
      store.readScenarioRunAnalysisFactsFor(scenarioId, RUN_FACT_LOOKAHEAD),
      store.readRecentAppliedMutationFactsFor(scenarioId, CHANGED_SINCE_RUN_READ_LIMIT),
    ]);
    const boundary = newestRunBoundary(runPage.facts);
    // A Run page that holds Runs but none with an id is an older Run we cannot place: say nothing rather than mark
    // every receipt ever recorded.
    if (boundary === null && runPage.facts.length > 0) return undefined;
    return projectChangedSinceRun(receipts, boundary, receipts.length >= CHANGED_SINCE_RUN_READ_LIMIT);
  } catch {
    return undefined;
  }
}
