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
 * Three shapes of one predicate (CURRENT-READ-v1 row 5):
 * - {@link isAgentAnswerRow} — STRICT. The chat restore (#2361) and the Agent's own memory rebuild read ONLY the
 *   Agent's answer rows: both exist only in the Agent's product, and a row without the hash fails closed. Their caps
 *   count AFTER the drop (each reads a wider raw window, then keeps the newest N answer rows).
 * - {@link conversationAsSeen} — for readers that also serve the orchestrator's own conversations, where there is no
 *   Agent and every user turn IS a `sha256:` row. When the rows include an Agent answer row, the conversation ran
 *   through the Agent and only its answer rows count; when they include none, every row counts, exactly as before.
 *   During an Agent sub-turn the Agent's claim row for the turn in flight (`agent_turn:`, written before any tool
 *   runs) is among the newest rows, so a sub-turn's own reader always sees the Agent's conversation.
 * - {@link withTextAsSeen} — the same decision, but EVERY ROW IS KEPT and only the two texts of a row the user did not
 *   see are blanked. For readers whose rows also carry structure (turn-id watermarks, row counts, handler facts): the
 *   turn context's `prior_turns` and the rolling summary.
 *
 * ⛔ NOT for fact readers. A sub-turn row is where its handler facts live — on served MRR `9fc32bf8` + `3b6369b0` all 6
 * facts (`run_analysis` ×4, `edit_graph` ×2) hang off `sha256:` rows. Claim safety (`claim-safety-read.ts`) and
 * `loadPriorFactsWithReadState` read those facts; dropping the rows would blind the leader permission. They read no
 * conversation text and are left as they are.
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

type TextRow = { readonly request_hash?: string | null; readonly user_message?: string | null; readonly assistant_message?: string | null };

/** Every row, in the order given; a row the user did not see keeps everything but its two texts (NULL). */
export function withTextAsSeen<T extends TextRow>(rows: readonly T[]): T[] {
  if (!rows.some(isAgentAnswerRow)) return [...rows];
  return rows.map((r) => (isAgentAnswerRow(r) || (r.user_message == null && r.assistant_message == null)
    ? r
    : { ...r, user_message: null, assistant_message: null }));
}
