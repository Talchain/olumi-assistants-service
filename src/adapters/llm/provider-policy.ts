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
 * Every guarded attempt under a policy — allowed or refused — is appended to the
 * policy's `calls` ledger, so the route can put `CALL SITE | PROVIDER | MODEL |
 * PURPOSE | OUTCOME` for the whole turn on the wire (`_agent.provider_calls`). The
 * purity proof is then read off the response, not reconstructed from logs.
 *
 * Outside a policy (every Conventional request) nothing changes and nothing is recorded.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type LlmProvider = 'anthropic' | 'openai';

export interface ProviderPolicy {
  /** Providers a request under this policy may call. */
  readonly allowed: ReadonlySet<LlmProvider>;
  /** Who set the policy — for the refusal log. */
  readonly route: string;
  /** Every guarded generative attempt made under this policy, in order. */
  readonly calls: GenerativeCall[];
  /**
   * Set when an attempt was NOT recorded because the ledger was full. Enforcement is
   * unaffected (a refusal past the cap still throws), but "no anthropic row" then no
   * longer proves "no anthropic attempt", so the wire must say so (review of #1749).
   */
  truncated: boolean;
}

export interface GenerativeCall {
  /** The guarded choke point, e.g. `agent-v1-turn.callModel`, `anthropic.client`. */
  readonly site: string;
  readonly provider: LlmProvider;
  /** The model requested, or `unknown` where the choke point cannot see it. */
  readonly model: string;
  readonly purpose: string;
  readonly outcome: 'allowed' | 'refused_before_network';
}

/** Bounds the ledger; a turn makes a handful of calls, so hitting this is itself a finding. */
export const MAX_RECORDED_CALLS = 50;

export class ForbiddenProviderError extends Error {
  readonly code = 'FORBIDDEN_PROVIDER';
  constructor(readonly provider: LlmProvider, readonly route: string, readonly task?: string) {
    super(`Provider "${provider}" is not allowed on ${route}${task ? ` (task: ${task})` : ''}`);
    this.name = 'ForbiddenProviderError';
  }
}

const store = new AsyncLocalStorage<ProviderPolicy>();

export const OPENAI_ONLY = (route: string): ProviderPolicy => ({ allowed: new Set<LlmProvider>(['openai']), route, calls: [], truncated: false });

export function runWithProviderPolicy<T>(policy: ProviderPolicy, fn: () => T): T {
  return store.run(policy, fn);
}

export function currentProviderPolicy(): ProviderPolicy | undefined {
  return store.getStore();
}

/**
 * Throws before any network I/O when the current request's policy forbids `provider`,
 * and records the attempt either way. Call it at the last point before the request
 * leaves the process.
 */
export function assertProviderAllowed(
  provider: LlmProvider,
  site?: string,
  detail?: { readonly model?: string; readonly purpose?: string },
): void {
  const policy = store.getStore();
  if (policy === undefined) return;
  const allowed = policy.allowed.has(provider);
  if (policy.calls.length < MAX_RECORDED_CALLS) {
    policy.calls.push({
      site: site ?? 'unspecified',
      provider,
      model: detail?.model ?? 'unknown',
      purpose: detail?.purpose ?? site ?? 'unspecified',
      outcome: allowed ? 'allowed' : 'refused_before_network',
    });
  } else {
    policy.truncated = true;
  }
  if (allowed) return;
  // Logged by the caller's own error path (no logger import here: this module sits
  // beneath the adapters, and importing telemetry from it closed an import cycle).
  throw new ForbiddenProviderError(provider, policy.route, site);
}

/**
 * Whether the current request may use `provider` — for a caller deciding NOT TO
 * START optional work (a background enricher) rather than attempt it and be
 * refused. Records nothing: no attempt is made. Outside a policy, always true.
 */
export function isProviderAllowed(provider: LlmProvider): boolean {
  const policy = store.getStore();
  return policy === undefined || policy.allowed.has(provider);
}

/** Whether the current request's ledger dropped an attempt at the cap. False outside a policy. */
export function providerLedgerTruncated(): boolean {
  return store.getStore()?.truncated === true;
}

/** The current request's ledger, or `[]` outside a policy. A copy — the wire must not alias it. */
export function recordedProviderCalls(): GenerativeCall[] {
  return [...(store.getStore()?.calls ?? [])];
}
