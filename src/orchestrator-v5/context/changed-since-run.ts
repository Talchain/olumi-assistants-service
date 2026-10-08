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
import { z } from 'zod';

import { isNoopFact } from '../tools/fact-noop.js';
import { MUTATION_RECEIPT_FACT_TYPES } from '../mutation-receipt-fact-types.js';
import type { IdentifiedHandlerFact } from '../types/handler-fact.js';

export const CHANGED_SINCE_RUN_READ_LIMIT = 50;
// First page of Runs; when it holds no Run with an id and the store counts more, one wider read follows (buddy r2 P2).
const RUN_FACT_LOOKAHEAD = 50;
const RUN_FACT_MAX = 1000;
const MAX_NODE_IDS = 200;
const MAX_EDGES = 400;
const RUN_COMPUTED_AT = z.string().datetime();

export interface ChangedSinceRunLink {
  readonly from: string;
  readonly to: string;
}

export interface ChangedSinceRunV1 {
  readonly version: 1;
  /** The Run the marks are relative to; `null` = no Run recorded yet. */
  readonly since_run_id: string | null;
  /** The boundary Run's snapshot stamp (schemas 0.83.0; local until published). */
  readonly since_run_computed_at?: string;
  readonly node_ids: readonly string[];
  readonly links: readonly ChangedSinceRunLink[];
  readonly unattributed_changes: number;
  readonly complete: boolean;
}

export interface RunBoundary {
  readonly run_id: string;
  readonly created_at: string;
  /** The analysis-affecting hash of the graph the Run analysed (`run_analysis.result.graph_hash_at_run`). */
  readonly graph_hash_at_run?: string;
  /**
   * When the Run read its graph: `run_analysis.result.computed_at`, stamped right after the snapshot is hashed and
   * before PLoT is called (`run-analysis.ts` runComputedAt). A receipt after it and before the Run's own row is an edit
   * made WHILE the Run computed, which that Run never saw (buddy r1 P1 / r2 P1). Absent → the row time is the bound.
   */
  readonly snapshot_at?: string;
  /**
   * The same `run_analysis.result.computed_at`, as `analysis_state.run_state.computed_at` serves it (trimmed, ISO), for
   * `since_run_computed_at` only. Kept apart from `snapshot_at` so the receipt window's bound is unchanged.
   */
  readonly computed_at?: string;
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
      // A correction that moves a limit changes both nodes: mark each end (buddy r1 P2-4).
      const nodes = [...new Set([isRec(result.after) ? id(result.after.node_id) : null, isRec(result.before) ? id(result.before.node_id) : null]
        .filter((n): n is string => n !== null))];
      return nodes.length === 0 ? null : { nodes, links: [] };
    }
    case 'adjust_edge_strength': {
      const main = linkOf(result.after) ?? linkOf(result.before);
      if (main === null) return null;
      // The links the refit rescaled, and any other link the write changed (the gauge it sized; buddy r1 P2-5).
      const others = (key: string): ChangedSinceRunLink[] => isRec(result.after) && Array.isArray(result.after[key])
        ? (result.after[key] as unknown[]).map(linkOf).filter((l): l is ChangedSinceRunLink => l !== null) : [];
      return { nodes: [], links: [main, ...others('frame_refit'), ...others('also_changed_links')] };
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
 * An ISO timestamp as integer MICROseconds. Postgres stores microseconds; `Date.parse` keeps milliseconds, which made
 * a receipt 100µs after its Run read as the same instant (buddy r1 P2-2). `null` when unreadable.
 */
export function isoToMicros(iso: string): bigint | null {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:?\d{2})$/.exec(iso);
  if (m === null) return null;
  const seconds = Date.parse(`${m[1]}${m[3]}`);
  if (!Number.isFinite(seconds)) return null;
  const micros = BigInt((m[2] ?? '').padEnd(6, '0').slice(0, 6));
  return BigInt(seconds) * 1000n + micros;
}

/**
 * Project the receipts recorded after `boundary` (all of them when `null`). `facts` newest-first, as the store
 * returns them. `windowFull`: the read returned its whole limit, so older receipts may exist.
 */
export function projectChangedSinceRun(
  facts: readonly IdentifiedHandlerFact[],
  boundary: RunBoundary | null,
  windowFull: boolean,
  /** The analysis-affecting hash of the graph as it stands now (the same projection `graph_hash_at_run` uses). */
  currentGraphHash?: string | null,
): ChangedSinceRunV1 {
  // A receipt is since the Run when it is later than the Run's snapshot and was not written in the Run's own append
  // (one transaction, one `now()`: an edit made in the Run's turn is in what it analysed or is refused with it).
  const runRowAt = boundary === null ? null : isoToMicros(boundary.created_at);
  const snapshotAt = boundary?.snapshot_at === undefined ? null : isoToMicros(boundary.snapshot_at);
  const since = runRowAt === null ? null : snapshotAt !== null && snapshotAt < runRowAt ? snapshotAt : runRowAt;
  const nodes = new Set<string>();
  const links = new Map<string, ChangedSinceRunLink>();
  let unattributed = 0;
  let reachedBoundary = false;
  for (const entry of facts) {
    const at = isoToMicros(entry.fact_created_at);
    if (since !== null && (at === null || at <= since)) { reachedBoundary = true; break; }
    if (at === runRowAt) continue;
    const fact = entry.fact;
    if (!MUTATION_RECEIPT_FACT_TYPES.has(fact.fact_type) || isNoopFact(fact)) continue;
    const ids = idsOfReceipt(fact);
    if (ids === null) { unattributed += 1; continue; }
    for (const n of ids.nodes) nodes.add(n);
    for (const l of ids.links) links.set(`${l.from}\u0000${l.to}`, l);
  }
  const nodeIds = [...nodes];
  const linkList = [...links.values()];
  // The graph moved since the Run but no receipt names any change (a write that records no receipt, or one between
  // the graph read and the snapshot stamp): say the marks are not the whole story rather than "nothing changed".
  const hashMovedUnplaced = boundary?.graph_hash_at_run !== undefined && typeof currentGraphHash === 'string'
    && currentGraphHash !== boundary.graph_hash_at_run && nodes.size === 0 && links.size === 0 && unattributed === 0;
  const overCap = nodeIds.length > MAX_NODE_IDS || linkList.length > MAX_EDGES;
  const sinceRunId = boundary?.run_id ?? null;
  return {
    version: 1,
    since_run_id: sinceRunId,
    ...(sinceRunId !== null && boundary?.computed_at !== undefined ? { since_run_computed_at: boundary.computed_at } : {}),
    node_ids: nodeIds.slice(0, MAX_NODE_IDS),
    links: linkList.slice(0, MAX_EDGES),
    unattributed_changes: unattributed,
    complete: !overCap && (reachedBoundary || !windowFull) && !hashMovedUnplaced,
  };
}

/** The newest Run with an id, from the store's own validated Run page. */
export function newestRunBoundary(runFacts: readonly IdentifiedHandlerFact[]): RunBoundary | null {
  for (const entry of runFacts) {
    if (entry.fact.fact_type !== 'run_analysis') continue;
    const result = (entry.fact as { result?: { run_id?: unknown; graph_hash_at_run?: unknown; computed_at?: unknown } }).result;
    const snapshotAt = typeof result?.computed_at === 'string' && isoToMicros(result.computed_at) !== null ? result.computed_at : undefined;
    // Match the analysis-state composer's trim; datetime validation preserves the remaining bytes.
    const stamp = typeof result?.computed_at === 'string' ? RUN_COMPUTED_AT.safeParse(result.computed_at.trim()) : undefined;
    const runId = id(result?.run_id);
    const hash = typeof result?.graph_hash_at_run === 'string' && result.graph_hash_at_run.length > 0 ? result.graph_hash_at_run : undefined;
    if (runId !== null) {
      return { run_id: runId, created_at: entry.fact_created_at, ...(hash !== undefined ? { graph_hash_at_run: hash } : {}),
        ...(snapshotAt !== undefined ? { snapshot_at: snapshotAt } : {}),
        ...(stamp?.success === true ? { computed_at: stamp.data } : {}) };
    }
  }
  return null;
}

/**
 * The two durable reads this needs, named structurally: the SessionStore surface stays inside its declared
 * integration points (`scripts/validate-state-write-invariant.sh`), and the route hands its store in.
 */
export interface ChangedSinceRunReads {
  readScenarioRunAnalysisFactsFor?(scenarioId: string, limit: number): Promise<{ readonly facts: readonly IdentifiedHandlerFact[]; readonly total_count: number }>;
  readRecentAppliedMutationFactsFor?(scenarioId: string, limit: number): Promise<readonly IdentifiedHandlerFact[]>;
}

/** Read and project. Never throws: `undefined` = could not answer (the caller omits the key, never sends empty). */
export async function readChangedSinceRun(store: ChangedSinceRunReads, scenarioId: string, currentGraphHash?: string | null): Promise<ChangedSinceRunV1 | undefined> {
  if (typeof store.readScenarioRunAnalysisFactsFor !== 'function' || typeof store.readRecentAppliedMutationFactsFor !== 'function') {
    return undefined;
  }
  try {
    const [runPage, receipts] = await Promise.all([
      store.readScenarioRunAnalysisFactsFor(scenarioId, RUN_FACT_LOOKAHEAD),
      store.readRecentAppliedMutationFactsFor(scenarioId, CHANGED_SINCE_RUN_READ_LIMIT),
    ]);
    let boundary = newestRunBoundary(runPage.facts);
    if (boundary === null && runPage.total_count > runPage.facts.length) {
      const wider = await store.readScenarioRunAnalysisFactsFor(scenarioId, Math.min(runPage.total_count, RUN_FACT_MAX));
      boundary = newestRunBoundary(wider.facts);
    }
    // A Run page that holds Runs but none with an id is an older Run we cannot place: say nothing rather than mark
    // every receipt ever recorded.
    if (boundary === null && runPage.facts.length > 0) return undefined;
    return projectChangedSinceRun(receipts, boundary, receipts.length >= CHANGED_SINCE_RUN_READ_LIMIT, currentGraphHash);
  } catch {
    return undefined;
  }
}
