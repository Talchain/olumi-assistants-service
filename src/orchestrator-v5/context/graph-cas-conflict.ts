/**
 * A3 — graph CAS observe-mode: pure stale-write conflict categoriser.
 *
 * This module classifies a graph-bearing V5 write against (a) the expected
 * server-side base captured at turn start and (b) the current persisted
 * `scenarios.graph` selected immediately before the write. It is the pure
 * decision core behind the observe hook in
 * `session/supabase-store.ts::append()`.
 *
 * ⚠️ WHAT THIS IS — AND IS NOT
 * ----------------------------
 * This is app-side stale-write OBSERVATION (plus a provisional, default-off
 * enforcement path). It is NOT atomic compare-and-swap and NOT complete write
 * safety: the pre-write SELECT and the `append_turn_atomic_v2` RPC are two
 * separate round-trips, so a concurrent writer can land between them (a
 * SELECT-then-write TOCTOU window). True atomicity requires an in-transaction,
 * row-locked compare inside a NEW, distinctly named RPC — designed (markdown
 * only, not built) in `Docs/v5/proposals/append-turn-atomic-v3-graph-cas.md`.
 *
 * ⚠️ COVERAGE CAVEAT (do not over-claim from this telemetry)
 * ----------------------------------------------------------
 * A3 observe-mode instruments ONLY the live app write chokepoint:
 * `commitDirectAnswer` → `SupabaseSessionStore.append()` →
 * `append_turn_atomic_v2`. It does NOT prove system-wide absence of stale
 * writes. Not covered:
 *   - service-role manual writes (SQL console, admin tooling, migrations);
 *   - direct database writes of any kind that bypass the store;
 *   - any direct UI writes, if such a path exists;
 *   - dormant/legacy functions that still exist in the database but are now
 *     grant-closed to `authenticated` (`store_draft_graph`, legacy
 *     `append_turn_atomic`) — A4 closed that authenticated exposure at the
 *     grant layer, so they are not an open `authenticated` surface, but a
 *     service-role caller could still invoke them outside this hook.
 * Low conflict volume in this telemetry therefore means low conflict volume
 * on the instrumented path only. RPC v3 (the proposal above) remains the
 * path to true atomic write safety.
 *
 * TRUSTED BASE RULE (load-bearing)
 * --------------------------------
 * The expected hashes fed into `categoriseGraphCasWrite` MUST derive only
 * from a server-side persisted-graph read (`buildTurnContext`'s
 * `loadGraphAndBriefText`, or edit-graph-dispatch's
 * `loadPersistedGraphStrict`). Request-supplied `graph_state` is NEVER the
 * trusted expected base — it may literally be the graph being written, and a
 * CAS that validates the write against itself always "matches". Callers with
 * no trusted server-read base leave the expected hashes `undefined`
 * (→ `no_expected`), never manufacture one from untrusted input.
 *
 * Hashing delegates to the two sanctioned normalisers — this module MUST NOT
 * grow a third graph normaliser:
 *   - identity:  `computeGraphIdentityHash`         (graph-identity.ts)
 *   - analysis:  `computeAnalysisAffectingGraphHash` (graph-hash.ts)
 *
 * Everything here is pure, total and never throws.
 */

import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { computeGraphIdentityHash } from './graph-identity.js';
import { computeAnalysisAffectingGraphHash } from './graph-hash.js';

/**
 * Runtime mode for the graph CAS hook (env `CEE_V5_GRAPH_CAS_MODE`).
 *  - 'off'     — hook disabled entirely: zero SELECTs, zero hashing.
 *  - 'observe' — evaluate + emit telemetry; the commit ALWAYS proceeds.
 *  - 'enforce' — additionally block `analysis_affecting_conflict` writes
 *                pre-RPC. Auto-downgraded to 'observe' in production by
 *                config (`createEnvEnforcedMode`), so enforce is unreachable
 *                in prod.
 */
export type GraphCasMode = 'off' | 'observe' | 'enforce';

export type GraphCasConflictCategory =
  | 'unavailable'
  | 'first_write'
  | 'no_expected'
  | 'match'
  | 'self_noop'
  | 'cosmetic_concurrent_edit'
  | 'analysis_affecting_conflict';

export type GraphCasConflictReason =
  // unavailable
  | 'select_failed'
  | 'current_parse_failed'
  | 'observe_hook_failed'
  // first_write
  | 'no_current_graph'
  // no_expected
  | 'not_instrumented'
  | 'no_base_at_turn_start'
  // match
  | 'expected_equals_current'
  // self_noop
  | 'incoming_equals_current'
  // cosmetic_concurrent_edit
  | 'analysis_projection_matched'
  // analysis_affecting_conflict
  | 'current_graph_vanished'
  | 'analysis_projection_diverged'
  | 'analysis_hash_unavailable';

export interface GraphCasEvaluation {
  readonly category: GraphCasConflictCategory;
  readonly reason: GraphCasConflictReason;
  /** Full identity hash (64-hex) of the current DB graph, or null. */
  readonly current_identity_hash: string | null;
  /** Analysis-affecting hash (16-hex) of the current DB graph, or null. */
  readonly current_analysis_hash: string | null;
  /** Full identity hash (64-hex) of the incoming write graph, or null. */
  readonly incoming_identity_hash: string | null;
}

/**
 * Input to the categoriser.
 *
 * Expected-hash convention (mirrors `CommitMetadata` / `SessionTurnWrite`):
 *   - `undefined` — the write path is NOT instrumented (no server base read
 *     happened, e.g. the deliberately uninstrumented draft path).
 *   - `null`      — a server base read DID happen at turn start, but the
 *     graph was absent, identity-empty or unparseable.
 *   - string      — the hash of the trusted server-read base.
 */
export interface GraphCasWriteInput {
  readonly expectedIdentityHash: string | null | undefined;
  readonly expectedAnalysisHash: string | null | undefined;
  /** Raw `scenarios.graph` as selected pre-write (null = row/graph absent). */
  readonly currentGraphRaw: unknown;
  /** Raw incoming graph on the write (`SessionTurnWrite.graph`). */
  readonly incomingGraphRaw: unknown;
}

/** Expected-base hashes derived from a server-side persisted-graph read. */
export interface ExpectedGraphCasHashes {
  readonly expectedGraphIdentityHash: string | null;
  readonly expectedGraphAnalysisHash: string | null;
}

interface RawGraphHashes {
  readonly parseFailed: boolean;
  readonly identity: string | null;
  readonly analysis: string | null;
}

function hashesForRawGraph(raw: unknown): RawGraphHashes {
  if (raw === null || raw === undefined) {
    return { parseFailed: false, identity: null, analysis: null };
  }
  const parsed = GraphStateIngressSchema.safeParse(raw);
  if (!parsed.success) {
    return { parseFailed: true, identity: null, analysis: null };
  }
  const graph: GraphStateIngress = parsed.data;
  return {
    parseFailed: false,
    identity: computeGraphIdentityHash(graph)?.value ?? null,
    analysis: computeAnalysisAffectingGraphHash(graph),
  };
}

/**
 * Compute the expected-base hashes from a SERVER-SIDE persisted-graph read
 * (trusted base rule — never call this with request-supplied `graph_state`).
 *
 * Absent (`null`/`undefined`), unparseable, or identity-empty graphs all map
 * to `{ null, null }` — "server base read, but no hashable graph existed".
 * Never throws; any internal fault degrades to nulls.
 */
export function computeExpectedGraphCasHashes(persistedGraph: unknown): ExpectedGraphCasHashes {
  try {
    const hashes = hashesForRawGraph(persistedGraph);
    return {
      expectedGraphIdentityHash: hashes.identity,
      expectedGraphAnalysisHash: hashes.analysis,
    };
  } catch {
    return { expectedGraphIdentityHash: null, expectedGraphAnalysisHash: null };
  }
}

function evaluation(
  category: GraphCasConflictCategory,
  reason: GraphCasConflictReason,
  current: RawGraphHashes,
  incoming: RawGraphHashes,
): GraphCasEvaluation {
  return {
    category,
    reason,
    current_identity_hash: current.identity,
    current_analysis_hash: current.analysis,
    incoming_identity_hash: incoming.identity,
  };
}

const NO_HASHES: RawGraphHashes = { parseFailed: false, identity: null, analysis: null };

/**
 * Construct an `unavailable` evaluation for faults that happen OUTSIDE the
 * categoriser (the pre-write SELECT failing, or the observe hook itself
 * throwing). The commit always proceeds on `unavailable` — even in enforce
 * mode — because an infrastructure fault must never fail a live write.
 */
export function unavailableGraphCasEvaluation(
  reason: 'select_failed' | 'observe_hook_failed',
): GraphCasEvaluation {
  return evaluation('unavailable', reason, NO_HASHES, NO_HASHES);
}

/**
 * Categorise a graph-bearing write. FIRST MATCH WINS — the rule order below
 * is load-bearing and pinned by an explicit ordering test:
 *
 *   (1) current graph exists but is unparseable      → unavailable / current_parse_failed
 *   (2) current graph absent or identity-empty:
 *         expected null-or-undefined                 → first_write / no_current_graph
 *         expected non-null                          → analysis_affecting_conflict / current_graph_vanished
 *   (3) expected undefined                           → no_expected / not_instrumented
 *       expected null (current exists)               → no_expected / no_base_at_turn_start
 *   (4) expected === current                         → match / expected_equals_current
 *   (5) incoming non-null && incoming === current    → self_noop / incoming_equals_current
 *   (6) both analysis hashes non-null && equal       → cosmetic_concurrent_edit / analysis_projection_matched
 *   (7) else                                         → analysis_affecting_conflict /
 *                                                      (analysis_projection_diverged, or
 *                                                       analysis_hash_unavailable when either
 *                                                       analysis hash is null — conservative escalation)
 *
 * Rule (5) `self_noop` is LOAD-BEARING: it must precede BOTH conflict-ish
 * categories (6)/(7) and is NEVER enforced. It protects idempotent replays
 * and duplicate submissions — a write whose content already equals the
 * current DB graph cannot corrupt state, however stale its expected base is.
 *
 * Pure, total, never throws (an internal fault degrades to
 * unavailable / observe_hook_failed).
 */
export function categoriseGraphCasWrite(input: GraphCasWriteInput): GraphCasEvaluation {
  try {
    const current = hashesForRawGraph(input.currentGraphRaw);
    const incoming = hashesForRawGraph(input.incomingGraphRaw);
    const expectedIdentity = input.expectedIdentityHash;
    const expectedAnalysis = input.expectedAnalysisHash;

    // (1) A present-but-unparseable current graph: we cannot compare, and
    // treating it as "vanished" would falsely escalate. Never enforced.
    if (current.parseFailed) {
      return evaluation('unavailable', 'current_parse_failed', current, incoming);
    }

    // (2) No current graph (absent row, NULL column, or identity-empty).
    if (current.identity === null) {
      if (expectedIdentity === null || expectedIdentity === undefined) {
        return evaluation('first_write', 'no_current_graph', current, incoming);
      }
      // We read a real base at turn start and it is now gone — the most
      // severe divergence shape: escalate as analysis-affecting.
      return evaluation('analysis_affecting_conflict', 'current_graph_vanished', current, incoming);
    }

    // (3) No trusted expected base — observe-only, never a conflict.
    if (expectedIdentity === undefined) {
      return evaluation('no_expected', 'not_instrumented', current, incoming);
    }
    if (expectedIdentity === null) {
      return evaluation('no_expected', 'no_base_at_turn_start', current, incoming);
    }

    // (4) The base we read at turn start is still the current graph.
    if (expectedIdentity === current.identity) {
      return evaluation('match', 'expected_equals_current', current, incoming);
    }

    // (5) self_noop — the incoming content already equals the current DB
    // graph. MUST precede (6)/(7); NEVER enforced (idempotent-replay safety).
    if (incoming.identity !== null && incoming.identity === current.identity) {
      return evaluation('self_noop', 'incoming_equals_current', current, incoming);
    }

    // (6) Identity moved but the analysis projection did not — a concurrent
    // cosmetic edit (labels/notes/display). Observed, never enforced.
    if (
      expectedAnalysis != null &&
      current.analysis != null &&
      expectedAnalysis === current.analysis
    ) {
      return evaluation('cosmetic_concurrent_edit', 'analysis_projection_matched', current, incoming);
    }

    // (7) Analysis-affecting conflict. When either analysis hash is missing
    // we cannot prove the divergence is cosmetic, so escalate conservatively.
    return evaluation(
      'analysis_affecting_conflict',
      expectedAnalysis == null || current.analysis == null
        ? 'analysis_hash_unavailable'
        : 'analysis_projection_diverged',
      current,
      incoming,
    );
  } catch {
    return unavailableGraphCasEvaluation('observe_hook_failed');
  }
}
