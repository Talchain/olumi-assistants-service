/**
 * ⭐ THE SERVER-INTERNAL IDENTITY OF AN APPROVED ADOPTION — so the one value writer can tell
 * "the user adopted Olumi's proposed figure" from "the user typed this figure".
 *
 * WHY (review of #1851, B2; RC #63 5825007295): an approval of Olumi's proposed values that
 * carries NO option levels takes the single-kind `set_factor_value` path — the
 * `factor_value_edit` writer, built for the inspector, which stamps the user's-own-figure
 * source (`USER_EDIT_SOURCE`). Served on `caf7d1a` (pricing S2p, a values-only approval):
 * both of Olumi's figures were stored as the user's own, counted by the admission census
 * as user-stated, able to license a leader.
 *
 * HOW, WITHOUT A WIRE FIELD: the Agent capability applies a VERIFIED, server-held proposal
 * (`proposals.authorise` has already checked scenario, user and base revision) and dispatches
 * each write in-process through `app.inject()`. `AsyncLocalStorage` survives that dispatch —
 * MEASURED in this repo, not assumed (`cee/unified-pipeline/stage-stream-context.ts:30`), and
 * already load-bearing for the provider policy (`adapters/llm/provider-policy.ts:13-15`). A
 * header would be a forgeable token on a public route; an async-context store is unreachable
 * from outside the process by construction.
 *
 * The writer stamps `user_assumption` ONLY when this context names the SAME scenario, the SAME
 * target and the SAME value the write carries. Anything else — no context (a direct system
 * event, the UI inspector), another target, another value — keeps the writer's stamp.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export interface ApprovedAdoption {
  readonly scenarioId: string;
  readonly proposalId: string;
  readonly targetId: string;
  /** The approved figure, in the factor's own units — what the proposal stored. */
  readonly rawValue: number;
}

/** The contract's literal for a value the user adopted rather than authored (0.55 `OBSERVED_STATE_SOURCE_LITERALS`). */
export const APPROVED_ADOPTION_SOURCE = 'user_assumption' as const;

const store = new AsyncLocalStorage<ApprovedAdoption>();

/** Run ONE verified approved write inside its adoption identity. */
export function runWithApprovedAdoption<T>(adoption: ApprovedAdoption, fn: () => Promise<T>): Promise<T> {
  return store.run(adoption, fn);
}

/**
 * The stamp for THIS write if — and only if — it is the approved adoption the context names:
 * same scenario, same target, same value. Otherwise `undefined` (the writer keeps its own stamp).
 */
export function approvedAdoptionSourceFor(
  scenarioId: string,
  targetId: string,
  rawValue: unknown,
): typeof APPROVED_ADOPTION_SOURCE | undefined {
  const a = store.getStore();
  if (a === undefined) return undefined;
  if (a.scenarioId !== scenarioId || a.targetId !== targetId) return undefined;
  if (typeof rawValue !== 'number' || !Number.isFinite(rawValue) || rawValue !== a.rawValue) return undefined;
  return APPROVED_ADOPTION_SOURCE;
}
