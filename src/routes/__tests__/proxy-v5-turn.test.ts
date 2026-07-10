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
  },
};

vi.mock("../../config/index.js", () => ({ config: mockConfig }));

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  emit: vi.fn(),
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

  // ---- Authorization forwarding + proxy-source marker (login 3.4 CEE-half) ----

  describe("Authorization forwarding + browser-proxy marker", () => {
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

    it("stamps x-olumi-proxy-source: cee-browser-proxy on every internal request", async () => {
      let capturedProxySource: string | undefined;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedProxySource = req.headers["x-olumi-proxy-source"] as string;
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

      expect(capturedProxySource).toBe("cee-browser-proxy");
    });

    it("overrides a browser-supplied x-olumi-proxy-source with the canonical value (unspoofable)", async () => {
      let capturedProxySource: string | undefined;

      app = buildApp({
        internalHandler: (req: any, reply: any) => {
          capturedProxySource = req.headers["x-olumi-proxy-source"] as string;
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
          "x-olumi-proxy-source": "spoofed-value",
        },
        payload: SAMPLE_PAYLOAD,
      });

      expect(capturedProxySource).toBe("cee-browser-proxy");
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
    it("forwards request body to internal route unchanged", async () => {
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
});
