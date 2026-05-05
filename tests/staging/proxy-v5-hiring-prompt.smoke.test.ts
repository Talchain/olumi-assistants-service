/**
 * Staging smoke — `/proxy/v5/turn` deployed-path test.
 *
 * Why this exists: the existing `tests/staging/golden-path-staging.test.ts`
 * calls the staging CEE base URL directly with `X-Olumi-Assist-Key`. That
 * does not exercise the browser proxy that production uses to bypass the
 * Netlify Edge ~40 s timeout on draft graph generation. This smoke posts
 * directly to the proxy host so that proxy-host outages and proxy-path
 * response-shape regressions are visible in the staging suite.
 *
 * Scope (what this test can prove):
 *   - the proxy host is reachable and replies with a V5 envelope
 *   - OPTIONS preflight is handled without crashing (regression for
 *     CEE commit c73d1469 — empty OPTIONS body broke response hashing)
 *   - the response actually came from the CEE Fastify process
 *     (asserted via `x-olumi-service: cee` and request-id echo headers)
 *   - the response carries a non-empty draft_graph and analysis_ready === ready
 *   - no service-key or token leakage in the response body
 *
 * Out of scope (deliberately):
 *   - "did the browser actually use this path and not Netlify Edge?" —
 *     that requires a real browser hitting the deployed UI URL. Tracked
 *     as a P1 follow-up in Docs/v5-testing-audit-cee.md.
 *
 * Gating (self-skipping):
 *   - RUN_STAGING_SMOKE=1
 *   - CEE_PROXY_BASE_URL          (host that exposes /proxy/v5/turn,
 *                                  e.g. https://cee-staging.onrender.com)
 *   - CEE_PROXY_ALLOWED_ORIGIN    (an origin allowlisted by
 *                                  BROWSER_PROXY_ALLOWED_ORIGINS on the
 *                                  target, e.g. https://staging--olumi.netlify.app)
 *
 * Without all three the suite skips silently. No request is made.
 */

import { randomUUID } from "node:crypto";
import { describe, it, expect } from "vitest";

const RUN_STAGING_SMOKE = process.env.RUN_STAGING_SMOKE === "1";
const CEE_PROXY_BASE_URL = process.env.CEE_PROXY_BASE_URL;
const CEE_PROXY_ALLOWED_ORIGIN = process.env.CEE_PROXY_ALLOWED_ORIGIN;

const SKIP_REASON = !RUN_STAGING_SMOKE
  ? "Skipping: RUN_STAGING_SMOKE not set"
  : !CEE_PROXY_BASE_URL
    ? "Skipping: CEE_PROXY_BASE_URL not configured"
    : !CEE_PROXY_ALLOWED_ORIGIN
      ? "Skipping: CEE_PROXY_ALLOWED_ORIGIN not configured"
      : null;

// Long enough to absorb a real V5 draft graph turn (40–60 s typical, plus
// margin). Below the proxy's BROWSER_PROXY_TIMEOUT_MS (~125 s) so internal
// failures surface as a 5xx rather than this fetch timing out.
const SMOKE_TIMEOUT_MS = 110_000;

// Preflight is handled by @fastify/cors and should be fast. Independent
// timeout keeps preflight diagnostics readable when the POST is slow.
const PREFLIGHT_TIMEOUT_MS = 15_000;

const HIRING_BRIEF =
  "Should I hire a tech lead or two developers to increase productivity?";

/** Patterns that must never appear in a response body. Synthetic and conservative. */
const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "olumi assist key header value", re: /X-Olumi-Assist-Key/i },
  { name: "supabase service_role token", re: /service_role/i },
  { name: "bearer token", re: /Bearer\s+[A-Za-z0-9._-]{20,}/i },
  { name: "anthropic api key", re: /sk-ant-[A-Za-z0-9_-]{20,}/ },
  { name: "openai api key", re: /sk-[A-Za-z0-9]{32,}/ },
  { name: "private jwt", re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9._-]+/ },
];

function proxyUrl(): string {
  return `${CEE_PROXY_BASE_URL!.replace(/\/$/, "")}/proxy/v5/turn`;
}

/** Bounded, non-leaky host token for triage logs (no path, no query, no auth). */
function hostFor(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "<invalid-url>";
  }
}

interface PreflightResult {
  status: number;
  allowOrigin: string | null;
  allowMethods: string | null;
  allowHeaders: string | null;
  elapsed_ms: number;
}

async function preflight(): Promise<PreflightResult> {
  const url = proxyUrl();
  const t0 = Date.now();
  const response = await fetch(url, {
    method: "OPTIONS",
    headers: {
      Origin: CEE_PROXY_ALLOWED_ORIGIN!,
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers":
        "content-type,accept,x-correlation-id,x-request-id",
    },
    // No body — the original OPTIONS 500 was caused by response hashing
    // crashing on empty bodies; replicate that exact shape here.
    signal: AbortSignal.timeout(PREFLIGHT_TIMEOUT_MS),
  });
  return {
    status: response.status,
    allowOrigin: response.headers.get("access-control-allow-origin"),
    allowMethods: response.headers.get("access-control-allow-methods"),
    allowHeaders: response.headers.get("access-control-allow-headers"),
    elapsed_ms: Date.now() - t0,
  };
}

interface ProxyResult {
  status: number;
  body: unknown;
  elapsed_ms: number;
  rawBytesLen: number;
  contentType: string | null;
  serviceHeader: string | null;
  serviceBuildHeader: string | null;
  requestIdHeader: string | null;
  echoedRequestId: string;
}

async function postProxy(): Promise<ProxyResult> {
  const url = proxyUrl();
  const requestId = randomUUID();
  const body = {
    kind: "message",
    turn_id: randomUUID(),
    scenario_id: randomUUID(),
    message: HIRING_BRIEF,
    stage: "frame",
    turn_class: "frame",
    generate_model: true,
  };

  const t0 = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: CEE_PROXY_ALLOWED_ORIGIN!,
      "X-Request-Id": requestId,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SMOKE_TIMEOUT_MS),
  });
  const elapsed_ms = Date.now() - t0;
  const contentType = response.headers.get("content-type");
  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Non-JSON: leave parsed null; surfaced via assertion below.
  }
  return {
    status: response.status,
    body: parsed,
    elapsed_ms,
    rawBytesLen: text.length,
    contentType,
    serviceHeader: response.headers.get("x-olumi-service"),
    serviceBuildHeader: response.headers.get("x-olumi-service-build"),
    requestIdHeader: response.headers.get("x-request-id"),
    echoedRequestId: requestId,
  };
}

describe.skipIf(SKIP_REASON !== null)("staging proxy v5 hiring-prompt smoke", () => {
  if (SKIP_REASON !== null) {
    // eslint-disable-next-line no-console
    console.log(`[proxy-v5-hiring-prompt] ${SKIP_REASON}`);
  }

  it(
    "OPTIONS /proxy/v5/turn handles empty-body preflight without 500",
    { timeout: PREFLIGHT_TIMEOUT_MS + 5_000 },
    async () => {
      const url = proxyUrl();
      const result = await preflight();

      // eslint-disable-next-line no-console
      console.log(
        `[proxy-v5-hiring-prompt] OPTIONS host=${hostFor(url)} ` +
          `status=${result.status} elapsed_ms=${result.elapsed_ms} ` +
          `allow_origin=${result.allowOrigin ?? "none"} ` +
          `allow_methods=${result.allowMethods ?? "none"}`,
      );

      // Catches the OPTIONS 500 regression directly (CEE c73d1469).
      expect(
        result.status,
        `OPTIONS preflight returned ${result.status}; the 500 regression was c73d1469`,
      ).toBeLessThan(500);
      // CORS gate.
      expect(result.allowOrigin, "no Access-Control-Allow-Origin returned").not.toBeNull();
      expect(result.allowOrigin).toBe(CEE_PROXY_ALLOWED_ORIGIN!);
      expect((result.allowMethods ?? "").toUpperCase()).toContain("POST");
    },
  );

  it(
    "POST /proxy/v5/turn returns a V5 draft graph and analysis-ready envelope",
    { timeout: SMOKE_TIMEOUT_MS + 10_000 },
    async () => {
      const url = proxyUrl();
      const result = await postProxy();

      // Bounded, non-leaky log (host only, no path, no query, no auth).
      // eslint-disable-next-line no-console
      console.log(
        `[proxy-v5-hiring-prompt] POST host=${hostFor(url)} ` +
          `status=${result.status} elapsed_ms=${result.elapsed_ms} ` +
          `bytes=${result.rawBytesLen} content_type=${result.contentType ?? "none"} ` +
          `service=${result.serviceHeader ?? "none"} ` +
          `service_build=${result.serviceBuildHeader ?? "none"}`,
      );

      expect(result.status, `non-200 from proxy; bytes=${result.rawBytesLen}`).toBe(200);
      expect(result.contentType ?? "").toMatch(/application\/json/);
      expect(result.body).not.toBeNull();

      // Proves the response came from the CEE Fastify process — the proxy
      // forwards `x-olumi-service` and `x-olumi-service-build` from the
      // internal app.inject() call. Their presence is the closest header-
      // level evidence that this hit the proxy path, not Netlify Edge.
      expect(
        result.serviceHeader,
        "missing x-olumi-service — response did not come from CEE",
      ).toBe("cee");
      expect(result.serviceBuildHeader, "missing x-olumi-service-build").not.toBeNull();
      // Request-id round-trip: the proxy forwards x-request-id from the
      // internal handler. A missing or mismatched value means the response
      // pipeline lost or rewrote it.
      expect(result.requestIdHeader, "missing x-request-id echo").not.toBeNull();

      const envelope = result.body as Record<string, unknown>;
      expect(envelope, "envelope is an object").toBeTypeOf("object");

      // draft_graph present, shaped and non-empty.
      const draftGraph = envelope.draft_graph as
        | { nodes?: unknown; edges?: unknown }
        | undefined;
      expect(draftGraph, "envelope.draft_graph present").toBeDefined();
      expect(Array.isArray(draftGraph?.nodes), "draft_graph.nodes is an array").toBe(true);
      expect(Array.isArray(draftGraph?.edges), "draft_graph.edges is an array").toBe(true);
      // Non-empty: a successful hiring brief should yield at least an
      // option/factor/decision triple. Empty arrays are degenerate success.
      expect(
        (draftGraph!.nodes as unknown[]).length,
        "draft_graph.nodes is empty — degenerate success",
      ).toBeGreaterThan(0);
      expect(
        (draftGraph!.edges as unknown[]).length,
        "draft_graph.edges is empty — degenerate success",
      ).toBeGreaterThan(0);

      // analysis_ready.status === "ready"
      const analysisReady = envelope.analysis_ready as
        | { status?: unknown }
        | undefined;
      expect(analysisReady, "envelope.analysis_ready present").toBeDefined();
      expect(analysisReady?.status).toBe("ready");

      // No secret patterns in the response body text.
      const serialised = JSON.stringify(envelope);
      for (const { name, re } of SECRET_PATTERNS) {
        expect(re.test(serialised), `response leaked: ${name}`).toBe(false);
      }
    },
  );
});
