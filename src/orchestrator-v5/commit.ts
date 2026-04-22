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
 * Shape: deliberately preserves the `commitDirectAnswer` name so the diff
 * against turn-executor.ts stays surgical. The function now also handles
 * `clarify` (the schema enum narrows this safely).
 */

import { createHash } from 'node:crypto';

import type { OlumiResponse, OrchestratorTurnPayload } from '@talchain/schemas/boundary';
import type { ConversationTurnClass, HandlerFact, V5ActionType } from '@talchain/schemas/orchestrator';

import { log } from '../utils/telemetry.js';
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
   * When present, store_draft_graph is called before appending the turn row.
   * Persistence failure is non-fatal — the turn is still committed and the
   * caller receives graphPersisted=false so it can set stage_indicator
   * appropriately.
   */
  readonly graphToStore?: { scenarioId: string; graph: unknown } | undefined;
}

export interface CommitResult {
  readonly response: OlumiResponse;
  readonly performed: true;
  readonly persisted_row_id: string;
  /**
   * True when graphToStore was provided and store_draft_graph succeeded.
   * False when graphToStore was absent or persistence threw (non-fatal).
   */
  readonly graphPersisted: boolean;
}

/**
 * Slice B commit: persist the turn via the session store, return the
 * unchanged response. Throws `StateCommitFailedError` on RPC failure;
 * TurnExecutor's existing catch handles the mapping to `STATE_COMMIT_FAILED`.
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

  // Persist graph before appending the turn row so the caller can read
  // graphPersisted to decide stage_indicator before the response is sent.
  let graphPersisted = false;
  if (metadata.graphToStore) {
    const { scenarioId, graph } = metadata.graphToStore;
    try {
      await store.storeDraftGraph(scenarioId, graph);
      log.info(
        { scenario_id: scenarioId, node_count: (graph as { nodes?: unknown[] }).nodes?.length ?? 0 },
        'V5 commit: draft graph persisted to scenarios table',
      );
      graphPersisted = true;
    } catch (err) {
      log.error(
        {
          scenario_id: scenarioId,
          err: err instanceof Error ? { name: err.name, message: err.message } : { message: String(err) },
        },
        'V5 commit: draft graph persistence failed — stage_indicator will remain at frame',
      );
    }
  }

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
  });

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
