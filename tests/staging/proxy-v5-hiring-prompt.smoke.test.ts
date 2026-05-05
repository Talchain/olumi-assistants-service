/**
 * Staging smoke — `/proxy/v5/turn` hiring-prompt deployed-path test.
 *
 * Why this exists: the existing `tests/staging/golden-path-staging.test.ts` calls
 * the staging CEE base URL directly with `X-Olumi-Assist-Key`. That bypasses
 * the browser proxy that production uses to avoid the Netlify Edge ~40 s timeout
 * on draft graph generation. This smoke explicitly exercises the proxy path.
 *
 * It catches:
 *   - Netlify Edge timeout regressions on the draft graph turn
 *   - `/proxy/v5/turn` route-resolution regressions
 *   - service-key echo or other secret leakage from the proxy response
 *   - non-200 transport failures masked by Edge buffering
 *
 * Gating (self-skipping):
 *   - RUN_STAGING_SMOKE=1
 *   - CEE_PROXY_BASE_URL          (staging public host that exposes /proxy/v5/turn,
 *                                  e.g. https://cee-staging.onrender.com)
 *   - CEE_PROXY_ALLOWED_ORIGIN    (an origin allowlisted by
 *                                  BROWSER_PROXY_ALLOWED_ORIGINS on the target,
 *                                  e.g. https://staging--olumi.netlify.app)
 *
 * Without all three, the suite skips silently. No request is made.
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

// Long enough to absorb a real V5 draft graph turn (40–60 s typical, plus margin).
// Below the proxy's BROWSER_PROXY_TIMEOUT_MS (~125 s) so internal failures
// surface as a 5xx rather than this fetch timing out.
const SMOKE_TIMEOUT_MS = 110_000;

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

interface ProxyResult {
  status: number;
  body: unknown;
  elapsed_ms: number;
  rawBytesLen: number;
  contentType: string | null;
}

async function postProxy(): Promise<ProxyResult> {
  const url = `${CEE_PROXY_BASE_URL!.replace(/\/$/, "")}/proxy/v5/turn`;
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
      "X-Request-Id": randomUUID(),
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
    // Non-JSON: leave parsed null, surface in assertion failure
  }
  return {
    status: response.status,
    body: parsed,
    elapsed_ms,
    rawBytesLen: text.length,
    contentType,
  };
}

describe.skipIf(SKIP_REASON !== null)("staging proxy v5 hiring-prompt smoke", () => {
  if (SKIP_REASON !== null) {
    // eslint-disable-next-line no-console
    console.log(`[proxy-v5-hiring-prompt] ${SKIP_REASON}`);
  }

  it(
    "POST /proxy/v5/turn returns a V5 draft graph and analysis-ready envelope",
    { timeout: SMOKE_TIMEOUT_MS + 10_000 },
    async () => {
      const result = await postProxy();

      // Bounded, non-leaky log.
      // eslint-disable-next-line no-console
      console.log(
        `[proxy-v5-hiring-prompt] status=${result.status} ` +
          `elapsed_ms=${result.elapsed_ms} bytes=${result.rawBytesLen} ` +
          `content_type=${result.contentType ?? "none"}`,
      );

      expect(result.status, `non-200 from proxy; bytes=${result.rawBytesLen}`).toBe(200);
      expect(result.contentType ?? "").toMatch(/application\/json/);
      expect(result.body).not.toBeNull();

      const envelope = result.body as Record<string, unknown>;
      expect(envelope, "envelope is an object").toBeTypeOf("object");

      // draft_graph present and minimally shaped.
      const draftGraph = envelope.draft_graph as
        | { nodes?: unknown; edges?: unknown }
        | undefined;
      expect(draftGraph, "envelope.draft_graph present").toBeDefined();
      expect(Array.isArray(draftGraph?.nodes), "draft_graph.nodes is an array").toBe(true);
      expect(Array.isArray(draftGraph?.edges), "draft_graph.edges is an array").toBe(true);

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
