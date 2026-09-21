/**
 * ISL Counterfactual Client — the reachable transport seam for the
 * what-if (counterfactual) lens.
 *
 * ## Why a dedicated client (transport finding, 23 Jul)
 *
 * CEE's only direct-ISL transport is `ISLClient` (`./client.ts`), whose
 * methods hit the `/isl/v1/*` route family with the `X-ISL-API-Key` header.
 * The counterfactual endpoint is a DIFFERENT route family
 * (`POST /api/v1/causal/counterfactual`) with a DIFFERENT auth header
 * (`X-API-Key`, validated by the ISL producer's APIKeyAuthMiddleware). CEE's
 * PLoT client proxies neither counterfactual nor causal routes.
 *
 * So the reachable seam — WITHOUT inventing a new transport — is a small
 * dedicated client that REUSES the existing ISL config (`ISL_BASE_URL` /
 * `ISL_API_KEY`, via `config.isl`) but targets the counterfactual route with
 * the correct auth header. It mirrors `ISLClient`'s fetch + timeout pattern;
 * it does not add a new networking layer.
 *
 * ## Fail-loud contract (honesty rail — binding)
 *
 * This client NEVER throws a fabricated or defaulted value and NEVER returns a
 * partial/synthetic prediction. Every non-success path — no client configured,
 * timeout, network error, non-2xx, or a 2xx body that does not validate against
 * the typed `CounterfactualResponseSchema` — returns a typed
 * `{ ok: false, reason }`. The caller (the lens) maps ANY `ok:false` to
 * "emit nothing" so the base `what_would_flip` answer is byte-preserved. A
 * 422 (e.g. the do∩observe overlap the ISL hardening rejects) is surfaced as a
 * typed `invalid_input` reason, never as an error apology.
 *
 * The success payload is the ISL response AFTER it validates against the
 * vendored `@talchain/schemas` typed contract (0.22.0 / ROADMAP 1.181). An
 * unparsable 2xx is a fail-loud `unparsable`, not a "best effort" read.
 */

import { CounterfactualResponseSchema, type CounterfactualResponse } from '@talchain/schemas/boundary';

import { logger } from '../../utils/simple-logger.js';
import { parseTimeout } from './config.js';
import { config } from '../../config/index.js';

/**
 * A structural causal model as ISL's counterfactual endpoint requires it.
 * `equations` are arithmetic expression strings ISL evaluates verbatim;
 * `distributions` are priors for the exogenous (root) variables. This is a
 * CEE-local outbound request type (the typed schemas package types the
 * RESPONSE, not the request).
 */
export interface CounterfactualStructuralModel {
  readonly variables: readonly string[];
  readonly equations: Readonly<Record<string, string>>;
  readonly distributions: Readonly<
    Record<string, { readonly type: 'normal' | 'uniform' | 'beta' | 'exponential'; readonly parameters: Readonly<Record<string, number>> }>
  >;
}

/**
 * The full counterfactual request body posted to
 * `POST /api/v1/causal/counterfactual`.
 */
export interface CounterfactualRequestBody {
  readonly model: CounterfactualStructuralModel;
  readonly intervention: Readonly<Record<string, number>>;
  readonly outcome: string;
  readonly context?: Readonly<Record<string, number>>;
}

/**
 * Typed, never-throwing result of a counterfactual call.
 *
 * `reason` is deliberately coarse and maps 1:1 to a fail-loud disposition:
 *  - `no_client`   — ISL not configured (ISL_BASE_URL unset). Latent lens.
 *  - `invalid_input` — ISL 400/422 (malformed model / do∩observe overlap /
 *    undefined outcome var). Honest limitation, never an apology.
 *  - `non_2xx`     — any other non-success HTTP status.
 *  - `timeout`     — the per-attempt or caller abort fired.
 *  - `network`     — fetch-level failure (DNS, refused, reset).
 *  - `unparsable`  — a 2xx body that failed the typed response schema.
 */
export type CounterfactualResult =
  | { readonly ok: true; readonly response: CounterfactualResponse }
  | {
      readonly ok: false;
      readonly reason: 'no_client' | 'invalid_input' | 'non_2xx' | 'timeout' | 'network' | 'unparsable';
      readonly status?: number;
      readonly message?: string;
    };

export interface CounterfactualClientOpts {
  /** Turn-level AbortSignal — cancels the ISL request when the turn aborts. */
  readonly signal?: AbortSignal;
}

export interface CounterfactualClient {
  getCounterfactual(
    request: CounterfactualRequestBody,
    requestId: string,
    opts?: CounterfactualClientOpts,
  ): Promise<CounterfactualResult>;
}

const COUNTERFACTUAL_PATH = '/api/v1/causal/counterfactual';

class CounterfactualClientImpl implements CounterfactualClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly timeoutMs: number,
  ) {}

  async getCounterfactual(
    request: CounterfactualRequestBody,
    requestId: string,
    opts?: CounterfactualClientOpts,
  ): Promise<CounterfactualResult> {
    const url = `${this.baseUrl}${COUNTERFACTUAL_PATH}`;
    const startedAt = Date.now();

    // Per-attempt timeout controller combined with the caller's turn signal so
    // a turn abort actually cancels the in-flight ISL request (AbortSignal.any
    // is Node >= 20; the engines pin is >= 20).
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const fetchSignal = opts?.signal
      ? AbortSignal.any([controller.signal, opts.signal])
      : controller.signal;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-Request-Id': requestId,
    };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request),
        signal: fetchSignal,
      });
      clearTimeout(timer);
      const elapsedMs = Date.now() - startedAt;

      if (!response.ok) {
        // 400 / 422 are ISL's deterministic "this what-if cannot be computed"
        // rejections (malformed model, undefined outcome var, do∩observe
        // overlap). Surface as an honest limitation reason, never an apology.
        const message = await safeErrorMessage(response);
        const reason = response.status === 400 || response.status === 422 ? 'invalid_input' : 'non_2xx';
        logger.info({
          event: 'isl.counterfactual.non_2xx',
          request_id: requestId,
          status: response.status,
          reason,
          elapsed_ms: elapsedMs,
        });
        return { ok: false, reason, status: response.status, message };
      }

      const raw: unknown = await response.json().catch(() => null);
      const parsed = CounterfactualResponseSchema.safeParse(raw);
      if (!parsed.success) {
        // A 2xx that does not validate against the typed contract is fail-loud
        // — never a best-effort read of a wrong-shaped body.
        logger.warn({
          event: 'isl.counterfactual.unparsable',
          request_id: requestId,
          elapsed_ms: elapsedMs,
          issue_count: parsed.error.issues.length,
        });
        return { ok: false, reason: 'unparsable' };
      }

      logger.info({
        event: 'isl.counterfactual.success',
        request_id: requestId,
        elapsed_ms: elapsedMs,
      });
      return { ok: true, response: parsed.data };
    } catch (error) {
      clearTimeout(timer);
      const elapsedMs = Date.now() - startedAt;
      // Caller (turn) abort vs per-attempt timeout both surface as `timeout`
      // for the lens's purposes (emit nothing either way); everything else is a
      // network failure. Neither ever yields a value.
      if (error instanceof Error && (error.name === 'AbortError' || controller.signal.aborted || opts?.signal?.aborted)) {
        logger.info({ event: 'isl.counterfactual.timeout', request_id: requestId, elapsed_ms: elapsedMs });
        return { ok: false, reason: 'timeout' };
      }
      logger.warn({
        event: 'isl.counterfactual.network_error',
        request_id: requestId,
        elapsed_ms: elapsedMs,
        error: error instanceof Error ? error.message : String(error),
      });
      return { ok: false, reason: 'network' };
    }
  }
}

async function safeErrorMessage(response: Response): Promise<string | undefined> {
  try {
    const body = (await response.json()) as { detail?: unknown; message?: unknown } | null;
    const detail = body?.detail ?? body?.message;
    return typeof detail === 'string' ? detail : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Construct a counterfactual client from explicit settings. The direct factory
 * (used by `createCounterfactualClient` and by tests) — keeps the transport
 * testable without the config singleton.
 */
export function makeCounterfactualClient(
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs: number,
): CounterfactualClient {
  return new CounterfactualClientImpl(baseUrl, apiKey, timeoutMs);
}

/**
 * Create a counterfactual client from centralised ISL config, or `null` when
 * ISL is not configured (`ISL_BASE_URL` unset). A `null` client is the honest
 * "latent lens" state: the transport is not reachable, so the lens emits
 * nothing. This mirrors `createISLClient()`'s null-when-unconfigured contract.
 */
export function createCounterfactualClient(): CounterfactualClient | null {
  const baseUrl = config.isl.baseUrl;
  if (!baseUrl) {
    logger.debug({ event: 'isl.counterfactual.disabled', reason: 'ISL_BASE_URL not configured' });
    return null;
  }
  return makeCounterfactualClient(baseUrl, config.isl.apiKey, parseTimeout(config.isl.timeoutMs, 5000));
}
