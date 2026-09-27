/**
 * ⭐ SLICE A6b — WHICH OPTIONS THE USER NAMED, CARRIED TO THE ADD-OPTION HOLD WITHOUT A WIRE FIELD (DL CR on #2131,
 * option (a)).
 *
 * WHY. Node `provenance: 'user_set'` says the USER put the node in the model, and its readers say so in words ("you
 * set it yourself, not because I suggested it"). An option the Agent proposes and the user only approves is Olumi's
 * suggestion; an option whose name the user typed is theirs. Only the Agent's tool can tell them apart — it holds
 * THIS turn's typed words (`AgentToolContext.user_turn_text`, bound by the route, never a chip's text) — but the hold
 * is minted by route-v2's add-option chip leg, one in-process `app.inject()` away, from a chip whose `parameters` are
 * an untyped wire bag any client can send.
 *
 * HOW — the approved-adoption precedent (`agent-lane/approved-adoption-context.ts`, `stated-link-band-context.ts`):
 * the Agent's `propose_new_option` dispatches its chip turn in-process through `app.inject()`, which
 * `AsyncLocalStorage` survives. A chip parameter would be a forgeable token on a public route; this store is
 * unreachable from outside the process by construction.
 *
 * The add-option leg reads the ids ONLY when this context names the SAME scenario and the SAME turn. Anything else —
 * no context (every UI chip, the text leg), another scenario, another turn — names no option: nothing is recorded as
 * the user's, and nothing is stamped (under-claiming, never over).
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface UserNamedOptions {
  readonly scenarioId: string;
  /** The in-process chip turn's own `turn_id`. */
  readonly turnId: string;
  /** The option ids (the chip's `option_id`s) whose label THIS turn's typed words name. */
  readonly optionIds: readonly string[];
}

const store = new AsyncLocalStorage<UserNamedOptions>();

/** Run ONE in-process add-option dispatch inside the options the user named. */
export function runWithUserNamedOptions<T>(named: UserNamedOptions, fn: () => Promise<T>): Promise<T> {
  return store.run(named, fn);
}

/**
 * The option ids the user named for THIS add-option turn if — and only if — the context names this scenario and this
 * turn. Otherwise `[]`: no option is the user's.
 */
export function userNamedOptionIdsFor(scenarioId: string, turnId: string): readonly string[] {
  const s = store.getStore();
  if (s === undefined || s.scenarioId !== scenarioId || s.turnId !== turnId) return [];
  return s.optionIds;
}
