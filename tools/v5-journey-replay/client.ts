/**
 * V5 alpha hardening Phase 3 — tier-A HTTP client for /orchestrate/v2/turn.
 *
 * Standalone fetch wrapper — no UI dependency. Mirrors the payload shape
 * that route-v2.ts expects on the `message` ingress path (POST /turn).
 *
 * Authentication: when `apiKey` is provided, sent as `X-Olumi-Assist-Key`
 * (primary contract in `src/plugins/auth.ts`). The harness-side env var
 * is `OLUMI_REPLAY_API_KEY`; the service-side var is `ASSIST_API_KEY` —
 * intentionally decoupled.
 *
 * Leakage defense: fetch rejections are re-thrown via `sanitiseError` so
 * undici/stack traces cannot surface the header value. See `redact.ts`
 * for the full three-layer contract.
 */

import { createHash } from 'node:crypto';

import { sanitiseError } from './redact.js';
import type { HealthzBody, HealthzResult, TurnResponse } from './types.js';

/**
 * Mirrors `MessageTurnPayloadSchema` from `@talchain/schemas/boundary`
 * (v0.8.1). The service-side Zod validator rejects with HTTP 422
 * INGRESS_CONTRACT_VIOLATION on any shape drift; see the schema source
 * at `node_modules/@talchain/schemas/dist/boundary/turn-payload.js`.
 *
 * We only model the `kind: 'message'` branch here — the replay drives
 * user-text turns and chip-click turns (both carried as messages with
 * `source: 'chip_click'`). The `kind: 'system_event'` branch is unused.
 */
export interface TurnPayload {
  readonly kind: 'message';
  readonly turn_id: string;
  readonly scenario_id: string;
  readonly stage: 'frame' | 'analyse' | 'decide' | 'review';
  readonly message: string;
  readonly turn_class: 'frame' | 'clarify' | 'propose' | 'decide' | 'review';
  readonly source: 'composer' | 'chip' | 'chip_click' | 'retry';
  readonly chip?: {
    readonly action_type?:
      | 'run_analysis'
      | 'set_factor_value'
      | 'add_constraint'
      | 'adjust_edge_strength'
      | 'explain_result'
      | 'compare_options'
      | 'what_would_flip';
    readonly parameters?: Record<string, unknown>;
  };
  readonly retry_of?: string;
}

export interface FetchResult {
  readonly status: number;
  readonly body: TurnResponse;
  readonly elapsed_ms: number;
}

function buildAuthHeaders(apiKey: string | undefined): Record<string, string> {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (apiKey) {
    // `X-Olumi-Assist-Key` is the primary auth contract per
    // `src/plugins/auth.ts`. Do not send the key via any other header.
    headers['x-olumi-assist-key'] = apiKey;
  }
  return headers;
}

export async function postTurn(
  baseUrl: string,
  payload: TurnPayload,
  timeoutMs = 60_000,
  apiKey?: string,
): Promise<FetchResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/orchestrate/v2/turn`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(apiKey),
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      // Re-throw with redacted message+stack so undici internals cannot
      // leak the auth header value through `Error.stack`.
      throw sanitiseError(err, apiKey);
    }
    const elapsed = Date.now() - start;
    // Read text first so we can fall back without locking the body
    // stream. `Response.json()` consumes the stream — calling text()
    // afterward throws.
    let raw = '';
    try {
      raw = await res.text();
    } catch {
      raw = '';
    }
    let body: TurnResponse;
    try {
      body = JSON.parse(raw) as TurnResponse;
    } catch {
      // Non-JSON / empty body (e.g. proxy error page). Surface a
      // FINGERPRINT (length + content-type + sha256 prefix) so the
      // evidence pack can triage without echoing potentially-sensitive
      // raw bytes into committed markdown.
      const contentType =
        typeof res.headers?.get === 'function' ? (res.headers.get('content-type') ?? '') : '';
      const sha256Prefix = createHash('sha256').update(raw).digest('hex').slice(0, 8);
      body = {
        __body_parse_failed: true,
        __body_length: raw.length,
        __body_content_type: contentType,
        __body_sha256_prefix: sha256Prefix,
      };
    }
    return { status: res.status, body, elapsed_ms: elapsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the public `/healthz` endpoint. Used for deploy confirmation
 * (Phase 2) and as the reachability probe in preflight (Phase 3). No
 * auth header — the route is public.
 */
export async function getHealthz(
  baseUrl: string,
  timeoutMs = 10_000,
): Promise<HealthzResult> {
  const url = `${baseUrl.replace(/\/$/, '')}/healthz`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', signal: controller.signal });
    } catch (err) {
      // Healthz does not carry a secret, but use sanitiseError so the
      // error shape matches postTurn.
      throw sanitiseError(err, undefined);
    }
    const elapsed = Date.now() - start;
    let body: HealthzBody | undefined;
    try {
      body = (await res.json()) as HealthzBody;
    } catch {
      body = undefined;
    }
    return { status: res.status, body, elapsed_ms: elapsed };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Authenticated preflight probe. Sends a minimal body to
 * `/orchestrate/v2/turn` to confirm the auth header is accepted. A 400 /
 * 422 response means auth succeeded and body was rejected (expected). A
 * 401 / 403 is a halt signal; do not burn the replay.
 */
export async function preflightAuth(
  baseUrl: string,
  apiKey: string | undefined,
  timeoutMs = 10_000,
): Promise<{ status: number; elapsed_ms: number; body: TurnResponse | undefined }> {
  const url = `${baseUrl.replace(/\/$/, '')}/orchestrate/v2/turn`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: buildAuthHeaders(apiKey),
        body: JSON.stringify({}),
        signal: controller.signal,
      });
    } catch (err) {
      throw sanitiseError(err, apiKey);
    }
    const elapsed = Date.now() - start;
    let body: TurnResponse | undefined;
    try {
      body = (await res.json()) as TurnResponse;
    } catch {
      body = undefined;
    }
    return { status: res.status, elapsed_ms: elapsed, body };
  } finally {
    clearTimeout(timer);
  }
}
