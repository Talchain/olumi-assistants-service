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

    it("Netlify preview origin matches pattern", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn",
        headers: {
          origin: PREVIEW_ORIGIN,
          "content-type": "application/json",
        },
        payload: SAMPLE_PAYLOAD,
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers["access-control-allow-origin"]).toBe(PREVIEW_ORIGIN);
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

  // ---- CORS preflight ----

  describe("OPTIONS preflight", () => {
    beforeEach(async () => {
      app = buildApp();
      await app.ready();
    });

    it("returns 204 with CORS headers for allowed origin", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/proxy/v5/turn",
        headers: { origin: STAGING_ORIGIN },
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers["access-control-allow-origin"]).toBe(STAGING_ORIGIN);
      expect(res.headers["access-control-allow-methods"]).toContain("POST");
    });

    it("returns 403 for disallowed origin", async () => {
      const res = await app.inject({
        method: "OPTIONS",
        url: "/proxy/v5/turn",
        headers: { origin: DISALLOWED_ORIGIN },
      });
      expect(res.statusCode).toBe(403);
    });
  });

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
      expect(res.headers["x-olumi-response-hash"]).toBe("abc123");
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
