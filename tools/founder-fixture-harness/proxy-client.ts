/**
 * HTTP for the founder-fixture harness — the BROWSER's seam, not the
 * service-to-service one.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS NOT `../v5-journey-replay/client.ts`, AND WHY THAT IS NOT A FORK.
 *
 * That client posts `/orchestrate/v2/turn` with `X-Olumi-Assist-Key`. It is the
 * right client for a service-level regression replay and the wrong one here.
 * The fixture is a claim about what A USER EXPERIENCES, and a user's browser
 * posts `/proxy/v5/turn` — a DIFFERENT route with a DIFFERENT admission model:
 *
 *   - it is declared public in `src/plugins/auth.ts` (`isPublicRoute`), so it
 *     takes no credential from the caller;
 *   - its only gate is the `Origin` allowlist, and `proxy-v5-turn.ts`'s own
 *     header says out loud that "Non-browser callers can forge the Origin
 *     header, so origin validation is a browser defence — not a substitute for
 *     server-side auth";
 *   - it strips `user_id` unconditionally, so this harness is structurally
 *     incapable of running as anyone but an anonymous guest;
 *   - it injects the service key internally and forwards to
 *     `/orchestrate/v2/turn` via `app.inject()`, so the same orchestrator runs.
 *
 * Everything that is genuinely shared IS shared: `sanitiseError` and the
 * redactor from `../v5-journey-replay/redact.js`, `getHealthz` and
 * `evaluateDeployGate` from that harness's client and index, `classifyResponse`
 * / `hasErrorEnvelope` from its classifier, and the wire accessors from
 * `../golden-journey-harness/observation.js`. Only the route contract is new.
 *
 * ⚠ CONSEQUENCE WORTH STATING: this harness holds NO SECRET. There is no key
 * to leak into the evidence pack. That is a property of the seam, not of the
 * harness's care, so `sanitiseError` is still used for error-shape parity in
 * case a future caller adds one.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { createHash } from 'node:crypto';

import { sanitiseError } from '../v5-journey-replay/redact.js';
import type { TurnResponse } from '../v5-journey-replay/types.js';

/** The browser's turn route. Derived from `src/routes/proxy-v5-turn.ts`. */
export const PROXY_TURN_PATH = '/proxy/v5/turn';

/**
 * The composer envelope, `kind: 'message'`.
 *
 * `turn_class` is hardcoded `'frame'` because THE UI HARDCODES IT on every
 * turn (`src/canvas/hooks/useConversation.ts`, whose own comment says the other
 * members are unreachable placeholders that raise `UnhandledTurnClassError`).
 * Sending anything else would be measuring a path no user reaches.
 *
 * `source: 'composer'` because all eleven scripted turns are typed text.
 */
export interface ProxyTurnPayload {
  readonly kind: 'message';
  readonly turn_id: string;
  readonly scenario_id: string;
  readonly stage: 'frame' | 'analyse' | 'decide' | 'review';
  readonly turn_class: 'frame';
  readonly source: 'composer';
  readonly message: string;
}

export interface ProxyTurnResult {
  readonly status: number;
  readonly body: TurnResponse;
  readonly elapsed_ms: number;
  /** The exact bytes handed to fetch — hashed by `assertSentBrief`. */
  readonly serialisedBody: string;
}

export function buildProxyHeaders(origin: string): Record<string, string> {
  return {
    'content-type': 'application/json',
    accept: 'application/json',
    // The ONLY gate on this route. Forgeable by construction, and the route's
    // own header says so — we send the canonical browser origin so the harness
    // exercises the same admission a real user does.
    origin,
  };
}

/**
 * POST one turn to the browser proxy.
 *
 * The default timeout is deliberately above CEE's own budgets — the route's
 * `BROWSER_PROXY_TIMEOUT_MS` defaults to 125 000 ms and `ROUTE_TIMEOUT_MS` is
 * 135 000 ms. A harness that timed out FIRST would manufacture a transport
 * error where the service was about to answer, and record it as a product
 * failure.
 */
export async function postProxyTurn(
  baseUrl: string,
  origin: string,
  payload: ProxyTurnPayload,
  timeoutMs = 140_000,
): Promise<ProxyTurnResult> {
  const url = `${baseUrl.replace(/\/$/, '')}${PROXY_TURN_PATH}`;
  const serialisedBody = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const start = Date.now();
  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: buildProxyHeaders(origin),
        body: serialisedBody,
        signal: controller.signal,
      });
    } catch (err) {
      throw sanitiseError(err, undefined);
    }
    const elapsed = Date.now() - start;
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
      // Fingerprint rather than echo — same contract as the replay client.
      body = {
        __body_parse_failed: true,
        __body_length: raw.length,
        __body_content_type:
          typeof res.headers?.get === 'function' ? (res.headers.get('content-type') ?? '') : '',
        __body_sha256_prefix: createHash('sha256').update(raw).digest('hex').slice(0, 8),
      };
    }
    return { status: res.status, body, elapsed_ms: elapsed, serialisedBody };
  } finally {
    clearTimeout(timer);
  }
}

export interface UiVersion {
  readonly commit: string;
  readonly short?: string;
  readonly timestamp?: string;
}

/**
 * Derive the DEPLOYED UI SHA at run time from `/version.json`.
 *
 * ⚠ A 200 PROVES NOTHING HERE, and this is measured, not assumed: the staging
 * host is a Netlify SPA whose fallback serves `index.html` for ANY path, so a
 * fabricated `/version-FABRICATED.json` also returns 200. The contrast control
 * was run (2026-09-05) and confirmed it. The only sound assertion is on the
 * SHAPE: a parsed JSON object whose `commit` is 40 hex characters. Anything
 * else is reported as "could not establish", never guessed.
 */
export async function getUiVersion(
  uiBaseUrl: string,
  timeoutMs = 20_000,
): Promise<{ ok: true; version: UiVersion } | { ok: false; reason: string }> {
  const url = `${uiBaseUrl.replace(/\/$/, '')}/version.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(url, { method: 'GET', signal: controller.signal });
    } catch (err) {
      return { ok: false, reason: `unreachable: ${String(sanitiseError(err, undefined))}` };
    }
    const text = await res.text().catch(() => '');
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      return {
        ok: false,
        reason:
          `HTTP ${res.status} but the body is not JSON (${text.length} bytes). ` +
          'The SPA fallback serves index.html for any path, so this is an absent version.json, not a version.',
      };
    }
    const commit = (parsed as { commit?: unknown } | null)?.commit;
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/i.test(commit)) {
      return {
        ok: false,
        reason: `version.json parsed but \`commit\` is not a 40-hex SHA: ${JSON.stringify(commit)}`,
      };
    }
    const rec = parsed as Record<string, unknown>;
    return {
      ok: true,
      version: {
        commit: commit.toLowerCase(),
        short: typeof rec.short === 'string' ? rec.short : undefined,
        timestamp: typeof rec.timestamp === 'string' ? rec.timestamp : undefined,
      },
    };
  } finally {
    clearTimeout(timer);
  }
}
