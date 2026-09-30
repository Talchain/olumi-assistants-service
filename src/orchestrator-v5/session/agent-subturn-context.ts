/**
 * ⛔ THE AGENT'S INTERNAL SUB-TURNS ARE NOT THE CONVERSATION (Canvas #75 5910906799; MG root cause 5910983526).
 *
 * The Agent's tools reach the product through in-process `app.inject()` calls (`/orchestrate/v2/turn`, the register
 * route, …). Each such call that commits a turn wrote a `v5_conversation_turns` row with conversation text: the
 * request's `message` as `user_message` (for the run tool, the MODEL's own `reason`), and the handler's text as
 * `assistant_message`. The user saw neither — they typed their own words and read the Agent's answer, which the Agent
 * route writes as its OWN row. Served MRR `3b6369b0` 01:44:03: "The user asked to run the analysis after confirming how
 * MRR is calculated." restored in the user's voice, and "… scored highest in 100% of runs" beside the Agent's real reply.
 * Both readers of those columns took it as conversation: the signed-in restore (#2352) and the Agent's own
 * `historyFromDurableTurns` after every redeploy.
 *
 * So a row written INSIDE one of the Agent's dispatches keeps every column except the two conversation texts, which are
 * NULL (`persist-graph-write.ts`, the one floor every turn row passes). Nothing else about the row changes: its turn id,
 * class, handler, pending actions, coaching state and graph are the sub-turn's own.
 *
 * HOW — the approved-adoption precedent (`stated-link-band-context.ts`): `AsyncLocalStorage` survives `app.inject()`,
 * and is unreachable from outside the process, where a header would be a forgeable token on a public route. The mark
 * names ONE scenario; a write for any other scenario inside the same dispatch keeps its texts.
 *
 * Rows the user DID see are outside every mark: the Agent route's own claim and answer rows (written by the outer
 * request, not inside a dispatch), a board edit the route forwards from the canvas (its narration comes straight back
 * to the user; forwarded with an unmarked dispatch), and any turn posted to `/orchestrate/v2/turn` directly.
 *
 * Rows stored before this change are not rewritten.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

interface AgentSubturn {
  readonly scenarioId: string;
}

const store = new AsyncLocalStorage<AgentSubturn>();

/** Run ONE of the Agent's in-process dispatches for `scenarioId` as a sub-turn. */
export function runAsAgentSubturn<T>(scenarioId: string, fn: () => Promise<T>): Promise<T> {
  return store.run({ scenarioId }, fn);
}

/** True only inside an Agent dispatch for THIS scenario. */
export function isAgentSubturnFor(scenarioId: string): boolean {
  const s = store.getStore();
  return s !== undefined && s.scenarioId === scenarioId;
}

/** The turn write as it is stored: inside an Agent sub-turn for its scenario, without conversation text. */
export function withoutAgentSubturnText<W extends { readonly scenario_id: string; readonly userMessage?: string; readonly assistantMessage?: string }>(
  write: W,
): W {
  if (!isAgentSubturnFor(write.scenario_id)) return write;
  if (write.userMessage === undefined && write.assistantMessage === undefined) return write;
  const { userMessage: _user, assistantMessage: _assistant, ...rest } = write;
  return rest as W;
}
