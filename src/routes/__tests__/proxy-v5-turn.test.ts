import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const TEST_ASSIST_KEY = "test-assist-key-abc123";
const STAGING_ORIGIN = "https://staging--olumi.netlify.app";
const PREVIEW_ORIGIN = "https://deploy-preview-42--olumi.netlify.app";
const DISALLOWED_ORIGIN = "https://evil.example.com";

const mockConfig = {
  proxy: {
    browserProxyEnabled: true,
    browserProxyAllowedOrigins: `${STAGING_ORIGIN},http://localhost:5173`,
    browserProxyTimeoutMs: 5_000, // Short for tests
  },
  auth: {
    assistApiKey: TEST_ASSIST_KEY,
    // CEE_REQUIRE_USER_JWT default OFF — the required-login front-door
    // tests below flip this per-test and restore it.
    requireUserJwt: false,
  },
};

vi.mock("../../config/index.js", () => ({ config: mockConfig }));

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

// Import after mocks
const { proxyV5TurnRoute } = await import("../proxy-v5-turn.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SAMPLE_PAYLOAD = {
  kind: "message",
  turn_id: "turn-001",
  scenario_id: "scen-001",
  message: "Should I hire a tech lead or two developers?",
  stage: "frame",
  turn_class: "frame",
};

/** Build a Fastify app with the proxy route and a mock internal CEE route. */
function buildApp(opts?: {
  /** Override the internal /orchestrate/v2/turn handler. */
  internalHandler?: (req: any, reply: any) => void;
  /** Simulate slow internal response. */
  internalDelayMs?: number;
}): FastifyInstance {
  const app = Fastify({ logger: false });

  // Register a mock /orchestrate/v2/turn route that the proxy calls via inject
  app.post("/orchestrate/v2/turn", async (request, reply) => {
    if (opts?.internalDelayMs) {
      await new Promise((r) => setTimeout(r, opts.internalDelayMs));
    }

    if (opts?.internalHandler) {
      return opts.internalHandler(request, reply);
    }

    // Default: return a successful OlumiResponse-like body
    return reply
      .code(200)
      .header("x-olumi-service", "cee")
      .header("x-olumi-service-build", "test-build-123")
      .header("x-olumi-response-hash", "abc123")
      .header("x-request-id", request.headers["x-request-id"] || "req-test")
      .send({
        blocks: [{ kind: "text", content: "Model generated." }],
        draft_graph: { nodes: [], edges: [] },
        analysis_ready: { status: "ready" },
      });
  });

  app.register(proxyV5TurnRoute);
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("POST /proxy/v5/turn", () => {
  let app: FastifyInstance;

  afterEach(async () => {
    if (app) await app.close();
  });

  // ---- Feature gate ----

  describe("when BROWSER_PROXY_ENABLED is false", () => {
    it("does not register the route → 404", async () => {
      const savedEnabled = mockConfig.proxy.browserProxyEnabled;
      mockConfig.proxy.browserProxyEnabled = false;

      const disabledApp = Fastify({ logger: false });
      await disabledApp.register(proxyV5TurnRoute);
      await disabledApp.ready();

      const res = await disabledApp.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: { origin: STAGING_ORIGIN, "content-type": "application/json" },
        payload: SAMPLE_PAYLOAD,
      });
      expect(res.statusCode).toBe(404);

      mockConfig.proxy.browserProxyEnabled = savedEnabled;
      await disabledApp.close();
    });
  });

  // ---- Origin validation ----

  describe("origin validation", () => {
    beforeEach(async () => {
      app = buildApp();
      await app.ready();
    });

    it("allowed origin succeeds", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(STAGING_ORIGIN);
    });

    it("unlisted Netlify preview origin → 403 (must be in explicit allowlist)", async () => {
      // Preview origins are no longer matched by regex. They must be listed
      // explicitly in BROWSER_PROXY_ALLOWED_ORIGINS so that global @fastify/cors
      // CORS preflight (ALLOWED_ORIGINS) and proxy validation stay in sync.
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: PREVIEW_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("PROXY_ORIGIN_REJECTED");
    });

    it("explicitly listed preview origin → 200", async () => {
      // When a preview origin is added to BROWSER_PROXY_ALLOWED_ORIGINS
      // (and ALLOWED_ORIGINS), it passes validation.
      const savedOrigins = mockConfig.proxy.browserProxyAllowedOrigins;
      mockConfig.proxy.browserProxyAllowedOrigins = `${savedOrigins},${PREVIEW_ORIGIN}`;

      const previewApp = Fastify({ logger: false });
      previewApp.post("/orchestrate/v2/turn", async (req, reply) =>
        reply.code(200).send({ blocks: [] }),
      );
      await previewApp.register(proxyV5TurnRoute);
      await previewApp.ready();

      const res = await previewApp.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: { origin: PREVIEW_ORIGIN, "content-type": "application/json" },
        payload: SAMPLE_PAYLOAD,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(PREVIEW_ORIGIN);

      mockConfig.proxy.browserProxyAllowedOrigins = savedOrigins;
      await previewApp.close();
    });

    it("disallowed origin → 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: DISALLOWED_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("PROXY_ORIGIN_REJECTED");
      expect(body.error.source).toBe("proxy");
    });

    it("missing Origin → 403", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: { "content-type": "application/json" },
        payload: SAMPLE_PAYLOAD,
      });
      expect(res.statusCode).toBe(403);
    });
  });

  // NOTE: OPTIONS preflight is handled by @fastify/cors in production (registered
  // in server.ts with preflightContinue: false). The CORS plugin intercepts OPTIONS
  // before route handlers run, so the proxy does NOT register its own OPTIONS handler.
  // Preflight is implicitly tested via server-level integration tests, not here.

  // ---- Content-Type guard ----

  describe("Content-Type validation", () => {
    beforeEach(async () => {
      app = buildApp();
      await app.ready();
    });

    it("rejects non-JSON content type", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "text/plain",
        },
        payload: "some text",
      });
      expect(res.statusCode).toBe(415);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("PROXY_UNSUPPORTED_MEDIA_TYPE");
    });

    it("includes CORS headers on 415 rejection", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "text/plain",
        },
        payload: "some text",
      });
      expect(res.statusCode).toBe(415);
      expect(res.headers["access-control-allow-origin"]).toBe(STAGING_ORIGIN);
    });
  });

  // ---- Auth header injection ----

  describe("auth header handling", () => {
    it("injects X-Olumi-Assist-Key in internal request", async () => {
      let capturedHeaders: Record<string, string | string[] | undefined> = {};

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedHeaders = req.headers;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(capturedHeaders["x-olumi-assist-key"]).toBe(TEST_ASSIST_KEY);
    });

    it("does NOT return X-Olumi-Assist-Key in response", async () => {
      app = buildApp({
        internalHandler: (_req: any, reply: any) => {
          // Simulate CEE accidentally echoing the key
          return reply
            .code(200)
            .header("x-olumi-assist-key", "should-not-appear")
            .send({ blocks: [] });
        },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(res.headers["x-olumi-assist-key"]).toBeUndefined();
    });

    it("falls back to assistApiKeys[0] when assistApiKey is not set", async () => {
      // Temporarily patch the mock config to simulate multi-key-only deployment
      const originalKey = mockConfig.auth.assistApiKey;
      const MULTI_KEY = "multi-key-first";
      delete (mockConfig.auth as any).assistApiKey;
      (mockConfig.auth as any).assistApiKeys = [MULTI_KEY, "multi-key-second"];

      let capturedHeaders: Record<string, string | string[] | undefined> = {};

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedHeaders = req.headers;
          return reply.code(200).send({ blocks: [] });
        },
      });

      // Re-import to pick up new config. We can't easily re-import, so
      // instead we just verify the proxy reads from the config at registration
      // time. Since the mock config is a reference, the module closure sees the
      // updated value. We need to re-register.
      const freshApp = Fastify({ logger: false });
      freshApp.post("/orchestrate/v2/turn", async (req, reply) => {
        capturedHeaders = req.headers;
        return reply.code(200).send({ blocks: [] });
      });
      // Re-import to pick up fresh config
      vi.resetModules();
      vi.mock("../../config/index.js", () => ({ config: mockConfig }));
      vi.mock("../../utils/telemetry.js", () => ({
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        emit: vi.fn(),
        TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
      }));
      const { proxyV5TurnRoute: freshRoute } = await import("../proxy-v5-turn.js");
      await freshRoute(freshApp);
      await freshApp.ready();

      await freshApp.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(capturedHeaders["x-olumi-assist-key"]).toBe(MULTI_KEY);

      // Restore
      (mockConfig.auth as any).assistApiKey = originalKey;
      delete (mockConfig.auth as any).assistApiKeys;
      await freshApp.close();
    });
  });

  // ---- X-User-Id forwarding ----

  describe("X-User-Id forwarding", () => {
    it("forwards X-User-Id to internal route", async () => {
      let capturedUserId: string | undefined;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedUserId = req.headers["x-user-id"] as string;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
          "x-user-id": "user-uuid-123",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(capturedUserId).toBe("user-uuid-123");
    });
  });

  // ---- Authorization forwarding + required-login front door (login 3.4 CEE-half) ----

  describe("Authorization forwarding + required-login front door", () => {
    it("forwards the browser Authorization header to the internal route (Supabase JWT seam)", async () => {
      let capturedAuthorization: string | undefined;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedAuthorization = req.headers["authorization"] as string;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
          authorization: "Bearer test-only-forged-token.abc.def",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(capturedAuthorization).toBe("Bearer test-only-forged-token.abc.def");
    });

    it("flag OFF (default): a turn with NO Authorization is forwarded unchanged (dormancy pin)", async () => {
      let internalCalled = false;

      app = buildApp({
        internalHandler: (_req: any, reply: any) => {
          internalCalled = true;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(internalCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    // ── GUEST ADMISSION (acceptance 1) ────────────────────────────────────
    // These two tests replace the pair that pinned the front-door 401. The
    // front door was a presence-and-shape check on `Authorization` ALONE: it
    // knew nothing about the scenario or its owner, and it ran before the body
    // was parsed, so a guest never reached the ownership pre-flight that would
    // have admitted them (a guest scenario has a NULL owner — ALLOW, pinned by
    // preflight-ensure-scenario-ownership.test.ts:75). Removing it is what lets
    // an unauthenticated visitor use the product. What keeps that SAFE is the
    // identity strip below, NOT this gate — see the strip suite.
    it("GUEST (acceptance 1): flag ON, NO Authorization — the turn is FORWARDED, not refused", async () => {
      mockConfig.auth.requireUserJwt = true;
      let internalCalled = false;

      app = buildApp({
        internalHandler: (_req: any, reply: any) => {
          internalCalled = true;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
          "x-request-id": "req-guest-admitted-1",
        },
        payload: SAMPLE_PAYLOAD,
      });
      mockConfig.auth.requireUserJwt = false;

      expect(internalCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it("GUEST: flag ON, a non-JWT-shaped Bearer is forwarded too (no front door left to refuse it)", async () => {
      mockConfig.auth.requireUserJwt = true;
      let internalCalled = false;

      app = buildApp({
        internalHandler: (_req: any, reply: any) => {
          internalCalled = true;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
          authorization: "Bearer not-a-jwt",
        },
        payload: SAMPLE_PAYLOAD,
      });
      mockConfig.auth.requireUserJwt = false;

      // An opaque token is not an identity claim the proxy can act on, and it
      // is no longer an identity claim it REFUSES on either. `resolveUserIdentity`
      // downstream sees no JWT candidate and the caller stays anonymous — which,
      // with the body strip, is the only thing they can be.
      expect(internalCalled).toBe(true);
      expect(res.statusCode).toBe(200);
    });

    it("flag ON: a JWT-shaped Authorization is forwarded to the internal route for verification", async () => {
      mockConfig.auth.requireUserJwt = true;
      let capturedAuthorization: string | undefined;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedAuthorization = req.headers["authorization"] as string;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
          authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged-test-signature",
        },
        payload: SAMPLE_PAYLOAD,
      });
      mockConfig.auth.requireUserJwt = false;

      expect(res.statusCode).toBe(200);
      expect(capturedAuthorization).toBe(
        "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged-test-signature",
      );
    });

    it("still injects the assist key via x-olumi-assist-key when Authorization is forwarded", async () => {
      let capturedAssistKey: string | undefined;
      let capturedAuthorization: string | undefined;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedAssistKey = req.headers["x-olumi-assist-key"] as string;
          capturedAuthorization = req.headers["authorization"] as string;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
          authorization: "Bearer test-only-forged-token.abc.def",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(capturedAssistKey).toBe(TEST_ASSIST_KEY);
      expect(capturedAuthorization).toBe("Bearer test-only-forged-token.abc.def");
    });
  });

  // ---- Client-asserted identity is stripped from every browser body ----
  //
  // THIS IS THE SUITE THAT MAKES GUEST ADMISSION SAFE. With the front door
  // removed, an anonymous caller reaches `resolveUserIdentity`, which (flag ON,
  // no JWT) returns `service_legacy` — and in every mode EXCEPT `verified`,
  // `authorizeScenarioOwnership` sets `effectiveUserId = claimedUserId`, the
  // caller-supplied body `user_id`. So without the strip, "anyone may send a
  // turn" would mean "anyone may send a turn AS ANYONE", which is strictly
  // worse than the posture we started from.
  //
  // The body `user_id` extension is the ONLY channel that can assert identity
  // here, derived rather than assumed: `parseRequestExtensions` reads
  // `body.user_id` and nothing else, and `x-user-id` — which this proxy DOES
  // forward — has no reader anywhere on the turn seam (swept with a contrast
  // control: `authorization` returns 9 readers, `x-user-id` returns none
  // outside comments and the CORS/forwarding allowlists).
  describe("client-asserted identity stripped from the proxied body", () => {
    const VICTIM_USER_ID = "3f7c1a92-5d84-4b0e-9c31-2a6f8e5d1b47";

    it("ATTACK (acceptance 3): an anonymous caller's body user_id NEVER reaches the internal turn route", async () => {
      mockConfig.auth.requireUserJwt = true;
      let capturedBody: any;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedBody = req.body;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        // The forgery: no credential of any kind, and an identity asserted in
        // the one field the ownership pre-flight would otherwise honour.
        payload: { ...SAMPLE_PAYLOAD, user_id: VICTIM_USER_ID },
      });
      mockConfig.auth.requireUserJwt = false;

      expect(res.statusCode).toBe(200);
      // Bound by IDENTITY of the field, not by a value predicate: the key must
      // be absent, so `parseRequestExtensions` yields userId === null and the
      // caller is anonymous to `preflightEnsureScenario` — which then REFUSES
      // them on any owned scenario (pinned at
      // preflight-ensure-scenario-ownership.test.ts:117) and admits them only
      // on an unowned one (:75). That composition is acceptance arms 3 and 4.
      expect(capturedBody).not.toHaveProperty("user_id");
      expect(Object.keys(capturedBody)).not.toContain("user_id");
    });

    it("the strip removes ONLY the identity field — every other turn field survives intact", async () => {
      // Without this, a mutant that discarded the whole body would satisfy the
      // attack test above while destroying the product.
      let capturedBody: any;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedBody = req.body;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: { ...SAMPLE_PAYLOAD, user_id: VICTIM_USER_ID, graph_state: { nodes: [] } },
      });

      expect(capturedBody).toEqual({
        ...SAMPLE_PAYLOAD,
        graph_state: { nodes: [] },
      });
    });

    it("a SIGNED-IN caller's body user_id is stripped too — the browser is never an identity channel", async () => {
      // Defence in depth rather than a behaviour change: in `verified` mode the
      // JWT `sub` already overrides any body `user_id`. Stripping regardless
      // means the guarantee does not DEPEND on that override still holding, so
      // a future change to the override cannot silently reopen this seam.
      mockConfig.auth.requireUserJwt = true;
      let capturedBody: any;
      let capturedAuthorization: string | undefined;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedBody = req.body;
          capturedAuthorization = req.headers["authorization"] as string;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
          authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged-test-signature",
        },
        payload: { ...SAMPLE_PAYLOAD, user_id: VICTIM_USER_ID },
      });
      mockConfig.auth.requireUserJwt = false;

      expect(res.statusCode).toBe(200);
      expect(capturedBody).not.toHaveProperty("user_id");
      // Acceptance 2's proxy half: the credential itself still crosses intact,
      // so the downstream verifier can do its job.
      expect(capturedAuthorization).toBe(
        "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged-test-signature",
      );
    });

    // The third browser rung, `/proxy/v5/turn/stop`, is stripped by the same
    // helper and its attack case is pinned END-TO-END against the real
    // ownership predicate in turn-stop-authorization.test.ts ("a FORGED body
    // user_id sent through the REAL proxy route…"), which asserts the refusal
    // and that nothing was written — a stronger binding than observing the
    // body here.
  });

  // ---- Response header propagation ----

  describe("response header propagation", () => {
    beforeEach(async () => {
      app = buildApp();
      await app.ready();
    });

    it("propagates safe CEE headers to browser", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(res.headers["x-olumi-service"]).toBe("cee");
      expect(res.headers["x-olumi-service-build"]).toBe("test-build-123");
      // x-olumi-response-hash is intentionally NOT forwarded: the proxy
      // parses and reserializes the body, making the original hash stale.
      expect(res.headers["x-olumi-response-hash"]).toBeUndefined();
      expect(res.headers["x-proxy-source"]).toBe("cee-browser-proxy");
      expect(res.headers["x-proxy-duration-ms"]).toBeDefined();
    });
  });

  // ---- Timeout handling ----

  describe("proxy timeout", () => {
    it("returns structured 504 when internal route is too slow", async () => {
      // Proxy timeout is 5_000ms (from mockConfig), internal delay is 6_000ms
      app = buildApp({ internalDelayMs: 6_000 });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(res.statusCode).toBe(504);
      const body = JSON.parse(res.body);
      expect(body.error.code).toBe("PROXY_UPSTREAM_TIMEOUT");
      expect(body.error.source).toBe("proxy");
      expect(body.error.upstream_duration_ms).toBeGreaterThan(0);
      expect(body.error.request_id).toBeDefined();
      // CORS headers still present on error
      expect(res.headers["access-control-allow-origin"]).toBe(STAGING_ORIGIN);
    }, 10_000);
  });

  // ---- Internal error handling ----

  describe("internal error", () => {
    it("propagates CEE error status to browser", async () => {
      app = buildApp({
        internalHandler: (_req: any, reply: any) => {
          return reply.code(422).send({
            schema: "error.v1",
            code: "INGRESS_VALIDATION_FAILED",
            message: "Invalid payload",
          });
        },
      });
      await app.ready();

      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });

      // Proxy passes through CEE's status code and body
      expect(res.statusCode).toBe(422);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("INGRESS_VALIDATION_FAILED");
    });
  });

  // ---- Body passthrough ----

  describe("body passthrough", () => {
    it("forwards request body to internal route unchanged (apart from the identity extension)", async () => {
      let capturedBody: any;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedBody = req.body;
          return reply.code(200).send({ blocks: [] });
        },
      });
      await app.ready();

      await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: STAGING_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(capturedBody).toMatchObject({
        kind: "message",
        turn_id: "turn-001",
        message: "Should I hire a tech lead or two developers?",
        stage: "frame",
      });
    });
  });

  // ---- Auth-posture disclosure at boot ----
  //
  // The unauthenticated-access posture was reported twice by independent
  // reviewers before anyone noticed it, because nothing in the running system
  // ever stated it. These pin that a deployment which accepts unauthenticated
  // turns SAYS SO at boot, and — just as important — that a deployment which
  // does not accept them stays quiet, so the warning keeps meaning something.

  describe("auth-posture disclosure at registration", () => {
    async function postureWarnings(): Promise<Array<[any, string]>> {
      const { log } = await import("../../utils/telemetry.js");
      return vi
        .mocked(log.warn)
        .mock.calls.filter((c) => String(c[1]).includes("AUTH POSTURE")) as Array<[any, string]>;
    }

    it("ALWAYS warns that unauthenticated turns are accepted — in BOTH flag postures", async () => {
      // This assertion changed shape with the front door's removal, and the
      // reason matters more than the assertion. The guest-acceptance warning
      // used to be gated on the flag being OFF. Now that a JWT-less turn is
      // admitted either way, a flag-gated warning would go SILENT precisely
      // when its sentence became unconditionally true — and the old negative
      // control would have certified that silence as correct. A disclosure
      // whose condition no longer matches what it discloses is a broken alarm.
      const { log } = await import("../../utils/telemetry.js");

      for (const flag of [false, true]) {
        vi.mocked(log.warn).mockClear();
        mockConfig.auth.requireUserJwt = flag;
        app = buildApp();
        await app.ready();
        await app.close();

        const guest = (await postureWarnings()).filter((c) =>
          c[1].includes("unauthenticated turns are ACCEPTED"),
        );
        expect(guest, `flag=${flag} must still disclose guest acceptance`).toHaveLength(1);
        // It must name the actual exposure, not just the flag.
        expect(guest[0][1]).toContain("Guest scenarios");
        expect(guest[0][1]).toContain("Origin is not authentication");
        expect(guest[0][0]).toMatchObject({ guest_turns_accepted: true, require_user_jwt: flag });
      }
      mockConfig.auth.requireUserJwt = false;
    });

    it("DISCRIMINATION: the JWT-verification line appears only when the gate is OFF", async () => {
      // The warning above is unconditional, so on its own it carries no
      // information about the deployment. This is the line that still does:
      // with the gate off, a presented Bearer is never parsed and every
      // SIGNED-IN user is refused on their own scenario. Without this pair a
      // route that warned unconditionally about everything would pass.
      const { log } = await import("../../utils/telemetry.js");

      vi.mocked(log.warn).mockClear();
      mockConfig.auth.requireUserJwt = false;
      app = buildApp();
      await app.ready();
      await app.close();
      const whenOff = (await postureWarnings()).filter((c) =>
        c[1].includes("user JWTs are NOT verified"),
      );
      expect(whenOff).toHaveLength(1);
      expect(whenOff[0][1]).toContain("refused on their OWN scenario");

      vi.mocked(log.warn).mockClear();
      mockConfig.auth.requireUserJwt = true;
      app = buildApp();
      await app.ready();
      mockConfig.auth.requireUserJwt = false;
      const whenOn = (await postureWarnings()).filter((c) =>
        c[1].includes("user JWTs are NOT verified"),
      );
      expect(whenOn).toHaveLength(0);
    });
  });
});
