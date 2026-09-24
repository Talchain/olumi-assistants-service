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
  /**
   * What the provider said this call cost, attached AFTER the response by
   * {@link recordProviderUsage}. Absent on a refusal (no network happened) and on
   * any caller that has not been wired yet.
   */
  usage?: ProviderUsage;
}

/**
 * ⭐ WHAT A CALL COST, SO CACHING CAN BE MEASURED RATHER THAN ASSUMED.
 *
 * The goal names caching as a lever and there was no way to tell whether it works:
 * the ledger carried `site/provider/model/purpose/outcome` and nothing else, and
 * the agent lane's transport already receives a `usage` object from the provider
 * and discards it (`usage` occurs twice in `agent-v1-turn.ts` and nothing consumes
 * it). Measured on served 3f412be over six briefs: no token or cache field appears
 * anywhere in a turn payload. A first turn makes 4-6 provider calls each carrying
 * the same ~1,437-token instruction prefix byte for byte, so whether that prefix is
 * being cached is the single biggest open question on the "fast" axis — and it is
 * currently unanswerable.
 *
 * ⚠ `raw` IS THE AUTHORITY; the derived numbers are BEST-EFFORT AND UNVERIFIED.
 * I did not have a captured provider `usage` object to derive the key names from,
 * and inventing the schema from memory then testing my own invention would prove
 * nothing about the wire. So the provider's object is carried verbatim (clipped)
 * and the derived fields are a convenience over key names that MAY be wrong.
 *
 * To verify: read one real row off the wire and compare. The Responses API is
 * expected to report input/output counts with a nested cached count, and the
 * Chat Completions shape differs; {@link normaliseProviderUsage} tries several
 * spellings for that reason and is deliberately tolerant of finding none.
 */
export interface ProviderUsage {
  /** The provider's own object, verbatim and clipped. The authority. */
  readonly raw: Readonly<Record<string, unknown>>;
  /** Best-effort, unverified: prompt/input tokens. */
  readonly input_tokens?: number;
  /** Best-effort, unverified: completion/output tokens. */
  readonly output_tokens?: number;
  /** Best-effort, unverified: the cached portion of the input. The caching signal. */
  readonly cached_input_tokens?: number;
}

/** Bounds one `raw` object so a ledger on the wire cannot be inflated by a provider. */
const MAX_RAW_USAGE_KEYS = 24;

const numberAt = (o: Record<string, unknown>, path: readonly string[]): number | undefined => {
  let cur: unknown = o;
  for (const key of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === 'number' && Number.isFinite(cur) ? cur : undefined;
};

const firstNumber = (o: Record<string, unknown>, paths: readonly (readonly string[])[]): number | undefined => {
  for (const path of paths) {
    const found = numberAt(o, path);
    if (found !== undefined) return found;
  }
  return undefined;
};

/**
 * Normalise a provider usage object. Returns `undefined` for anything that is not
 * a plain object, so a malformed payload records nothing rather than a shape that
 * reads as measured. Never throws: this sits on a response path and must not turn
 * a successful call into a failed one.
 */
export function normaliseProviderUsage(raw: unknown): ProviderUsage | undefined {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const clipped: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o).slice(0, MAX_RAW_USAGE_KEYS)) {
    clipped[k] = v === null || typeof v !== 'object' || Array.isArray(v) ? v : { ...(v as object) };
  }
  const input = firstNumber(o, [['input_tokens'], ['prompt_tokens']]);
  const output = firstNumber(o, [['output_tokens'], ['completion_tokens']]);
  const cached = firstNumber(o, [
    ['input_tokens_details', 'cached_tokens'],
    ['prompt_tokens_details', 'cached_tokens'],
    ['cached_tokens'],
  ]);
  return Object.freeze({
    raw: Object.freeze(clipped),
    ...(input !== undefined ? { input_tokens: input } : {}),
    ...(output !== undefined ? { output_tokens: output } : {}),
    ...(cached !== undefined ? { cached_input_tokens: cached } : {}),
  });
}

/**
 * Attach usage to a call already in the ledger, by the handle
 * {@link assertProviderAllowed} returned.
 *
 * ⛔ BY HANDLE, NOT "THE MOST RECENT CALL". A turn can have more than one
 * provider call in flight (a fast path's interpretation beside a loop hop), and
 * attaching to the last row would credit one call's tokens to another — the
 * quietest possible way to make a caching measurement wrong. A handle cannot
 * drift. Out-of-range or refused handles are ignored.
 */
export function recordProviderUsage(handle: ProviderCallHandle, raw: unknown): void {
  if (handle === undefined) return;
  const policy = store.getStore();
  const call = policy?.calls[handle];
  if (call === undefined || call.outcome !== 'allowed') return;
  const usage = normaliseProviderUsage(raw);
  if (usage !== undefined) call.usage = usage;
}

/**
 * Identifies one recorded call. `undefined` when nothing was recorded — outside a
 * policy, or past the ledger cap — so a caller can pass it on unconditionally.
 */
export type ProviderCallHandle = number | undefined;

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
): ProviderCallHandle {
  const policy = store.getStore();
  if (policy === undefined) return undefined;
  const allowed = policy.allowed.has(provider);
  let handle: ProviderCallHandle;
  if (policy.calls.length < MAX_RECORDED_CALLS) {
    handle = policy.calls.length;
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
  if (allowed) return handle;
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
