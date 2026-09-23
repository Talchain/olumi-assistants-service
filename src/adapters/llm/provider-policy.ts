/**
 * ⛔ A REQUEST-SCOPED PROVIDER POLICY, ENFORCED BEFORE NETWORK I/O.
 *
 * Paul, 23 Sep: the OpenAI PoC journey must make ZERO Anthropic calls. Release
 * Control (#63 5793252993): "request-scoped OpenAI policy propagated to every
 * generative subcall, enforced before network I/O … a hidden Anthropic call is not
 * [allowed]". Measured on served c4a6cce: the OpenAI route's analysis turn reached
 * the legacy decision_review (Claude) through an internal dispatch, with no provider
 * attribution on the wire.
 *
 * The OpenAI Agent route runs each turn inside `runWithProviderPolicy`. Every
 * Anthropic client and the Anthropic transport call `assertProviderAllowed`, so any
 * Anthropic attempt beneath that turn — including through `app.inject()` internal
 * dispatch, which `AsyncLocalStorage` survives (see
 * `cee/unified-pipeline/stage-stream-context.ts:30`) — is refused with
 * `ForbiddenProviderError` before a byte leaves the process, and is logged with its
 * task, so the refusal is also the measurement.
 *
 * Outside a policy (every Conventional request) nothing changes.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type LlmProvider = 'anthropic' | 'openai';

export interface ProviderPolicy {
  /** Providers a request under this policy may call. */
  readonly allowed: ReadonlySet<LlmProvider>;
  /** Who set the policy — for the refusal log. */
  readonly route: string;
}

export class ForbiddenProviderError extends Error {
  readonly code = 'FORBIDDEN_PROVIDER';
  constructor(readonly provider: LlmProvider, readonly route: string, readonly task?: string) {
    super(`Provider "${provider}" is not allowed on ${route}${task ? ` (task: ${task})` : ''}`);
    this.name = 'ForbiddenProviderError';
  }
}

const store = new AsyncLocalStorage<ProviderPolicy>();

export const OPENAI_ONLY = (route: string): ProviderPolicy => ({ allowed: new Set<LlmProvider>(['openai']), route });

export function runWithProviderPolicy<T>(policy: ProviderPolicy, fn: () => T): T {
  return store.run(policy, fn);
}

export function currentProviderPolicy(): ProviderPolicy | undefined {
  return store.getStore();
}

/** Throws before any network I/O when the current request's policy forbids `provider`. */
export function assertProviderAllowed(provider: LlmProvider, task?: string): void {
  const policy = store.getStore();
  if (policy === undefined || policy.allowed.has(provider)) return;
  // Logged by the caller's own error path (no logger import here: this module sits
  // beneath the adapters, and importing telemetry from it closed an import cycle).
  throw new ForbiddenProviderError(provider, policy.route, task);
}
