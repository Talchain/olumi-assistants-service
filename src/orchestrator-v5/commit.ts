/**
 * V5 commit stage — slice B.
 *
 * A1 shipped this as a pure no-op per Paul's constraint 11. Slice B wires
 * persistence: on success the RPC `append_turn_atomic` records the turn in
 * `v5_conversation_turns`; on failure a `StateCommitFailedError` is thrown
 * and the TurnExecutor catch at turn-executor.ts:223-232 maps it to the
 * `STATE_COMMIT_FAILED` wire code.
 *
 * Idempotency: `turn_id` is client-generated. The RPC enforces
 * `UNIQUE (scenario_id, turn_id)` with `ON CONFLICT DO NOTHING`, so two
 * concurrent calls with identical `(scenario_id, turn_id)` each return the
 * same row id and neither raises. TurnExecutor currently uses `request_id`
 * as `turn_id`; request_id is a UUID per turn, so cross-turn collisions
 * don't occur. A retry of the same request (same request_id) is idempotent
 * by construction.
 *
 * Graph atomicity: when CommitMetadata.graph is provided, it is passed to
 * append_turn_atomic as p_graph. The RPC writes scenarios.graph and inserts
 * the turn row in the same PL/pgSQL transaction — both succeed or both roll
 * back. This eliminates the split-state risk of two separate RPC calls.
 *
 * Shape: deliberately preserves the `commitDirectAnswer` name so the diff
 * against turn-executor.ts stays surgical. The function now also handles
 * `clarify` (the schema enum narrows this safely).
 */

import { createHash } from 'node:crypto';

import type { OlumiResponse, OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { ConversationTurnClass, HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';

import { getSessionStore } from './session/index.js';
import type { SessionStore } from './session/store.js';

export interface CommitMetadata {
  readonly scenario_id: string;
  readonly turn_id: string;
  readonly turn_class: ConversationTurnClass;
  readonly handler_id: V5ActionType | null;
  readonly request_hash: string;
  readonly llm_calls_used: number;
  readonly duration_ms: number;
  readonly handler_facts: readonly HandlerFact[];
  /**
   * Draft graph to persist atomically with the turn insert via
   * append_turn_atomic(p_graph). Both the graph write and the turn row commit
   * or roll back together. Omit for non-draft turns — the RPC leaves
   * scenarios.graph unchanged when p_graph is null.
   */
  readonly graph?: unknown;
}

export interface CommitResult {
  readonly response: OlumiResponse;
  readonly performed: true;
  readonly persisted_row_id: string;
  /**
   * True when CommitMetadata.graph was provided and the atomic commit
   * succeeded (both graph and turn row written). False when graph was absent.
   * On commit failure, commitDirectAnswer throws rather than returning false
   * here — the caller's catch block handles that path.
   */
  readonly graphPersisted: boolean;
}

/**
 * Slice B commit: persist the turn via the session store, return the
 * unchanged response. Throws `StateCommitFailedError` on RPC failure;
 * TurnExecutor's existing catch handles the mapping to `STATE_COMMIT_FAILED`.
 *
 * When metadata.graph is provided, the graph is written atomically with the
 * turn row via append_turn_atomic(p_graph). On success, graphPersisted=true
 * is returned so the caller can set stage_indicator='analyse'. On RPC failure
 * the whole call throws (StateCommitFailedError) — there is no partial state.
 */
export async function commitDirectAnswer(
  response: OlumiResponse,
  metadata: CommitMetadata,
  sessionStore?: SessionStore,
): Promise<CommitResult> {
  if (!response) {
    throw new Error('commitDirectAnswer called with falsy response — invariant violation');
  }

  const store = sessionStore ?? getSessionStore();

  const { id: persistedRowId } = await store.append({
    scenario_id: metadata.scenario_id,
    turn_id: metadata.turn_id,
    turn_class: metadata.turn_class,
    handler_id: metadata.handler_id,
    request_hash: metadata.request_hash,
    response_emitted: true,
    llm_calls_used: metadata.llm_calls_used,
    duration_ms: metadata.duration_ms,
    handler_facts: metadata.handler_facts,
    graph: metadata.graph,
  });

  const graphPersisted = metadata.graph !== undefined;
  return { response, performed: true, persisted_row_id: persistedRowId, graphPersisted };
}

/**
 * Compute a stable per-request hash for the `request_hash` column. The
 * column has a non-empty-string invariant at the schema level; the value is
 * informational — the idempotency key is `(scenario_id, turn_id)`, not the
 * hash. We cover the user-visible payload fields so two distinct messages
 * on the same scenario produce different hashes, useful for post-mortem
 * debugging.
 */
export function computeRequestHash(payload: OrchestratorTurnPayload): string {
  // v0.7.0 union: message-kind carries `.message`; system-event carries `.event`.
  // Both variants hash the variant-specific distinguishing fields so two
  // genuinely different turns produce distinct hashes (hash is informational,
  // not the idempotency key — that's `(scenario_id, turn_id)`).
  const variant =
    payload.kind === 'message'
      ? { kind: 'message' as const, message: payload.message }
      : { kind: 'system_event' as const, event: payload.event };
  const canonical = JSON.stringify({
    scenario_id: payload.scenario_id,
    stage: payload.stage,
    ...variant,
  });
  const digest = createHash('sha256').update(canonical).digest('hex').slice(0, 32);
  return `sha256:${digest}`;
}
