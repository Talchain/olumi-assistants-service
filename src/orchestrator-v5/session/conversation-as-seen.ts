/**
 * ⛔ THE CONVERSATION AS THE USER SAW IT — one predicate for every reader of `v5_conversation_turns` text (Canvas #75
 * 5910906799; root cause MG 5910983526; restore #2361; DL 5911353017; AIQ 5911326118; P0 SHARED DATA contract row 5).
 *
 * The table holds more than the conversation. The Agent's tools reach the product through in-process turns
 * (`/orchestrate/v2/turn`), and each commits its own row: served MRR `3b6369b0` 01:44:03 stored the MODEL's tool reason
 * as `user_message` ("The user asked to run the analysis after confirming how MRR is calculated.") and the HANDLER's
 * text as `assistant_message` ("… scored highest in 100% of runs"). The user typed "Run the analysis" and read the
 * Agent's answer — the Agent route's OWN row.
 *
 * Every Agent answer row carries the route's own request hash, `agent_turn:` (`agentTurnRequestHash`,
 * `agent-v1-turn.ts`); the turn executor's rows carry `sha256:`, a registration `graph_registration:`. The hash is
 * already stored on every row, so this reads rows written before the fix exactly as it reads new ones.
 *
 * Two readers, two strengths:
 * - {@link isAgentAnswerRow} — STRICT. The chat restore (#2361) and the Agent's own memory rebuild read ONLY the
 *   Agent's answer rows: both exist only in the Agent's product, and a row without the hash fails closed.
 * - {@link conversationAsSeen} — for readers that also serve the orchestrator's own conversations, where there is no
 *   Agent and every user turn IS a `sha256:` row. When the rows include an Agent answer row, the conversation ran
 *   through the Agent and only its answer rows count; when they include none, every row counts, exactly as before.
 *   During an Agent sub-turn the Agent's claim row for the turn in flight (`agent_turn:`, written before any tool
 *   runs) is among the newest rows, so a sub-turn's own reader always sees the Agent's conversation.
 */

/** The request-hash prefix of every row the Agent route writes (claim and answer). */
export const AGENT_ANSWER_REQUEST_HASH_PREFIX = 'agent_turn:';

/** True only for a row the Agent route wrote. A row with no hash is not one. */
export function isAgentAnswerRow(row: { readonly request_hash?: string | null }): boolean {
  return typeof row.request_hash === 'string' && row.request_hash.startsWith(AGENT_ANSWER_REQUEST_HASH_PREFIX);
}

/** The rows the user saw, in the order given: the Agent's answer rows when there are any, otherwise every row. */
export function conversationAsSeen<T extends { readonly request_hash?: string | null }>(rows: readonly T[]): T[] {
  return rows.some(isAgentAnswerRow) ? rows.filter(isAgentAnswerRow) : [...rows];
}
