import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { build } from "../../src/server.js";

describe("POST /assist/v1/ask", () => {
  let app: FastifyInstance;

  // Auth header for tests
  const authHeaders = { "X-Olumi-Assist-Key": "cee-ask-test-key" } as const;

  beforeAll(async () => {
    // Configure API key for tests
    vi.stubEnv("ASSIST_API_KEYS", "cee-ask-test-key");
    app = await build();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  // Helper to create a minimal valid request
  const createValidRequest = (overrides = {}) => ({
    request_id: "550e8400-e29b-41d4-a716-446655440000",
    scenario_id: "test-scenario-1",
    graph_schema_version: "2.2",
    brief: "We need to decide on a cloud provider for our new SaaS platform. Key factors include cost, reliability, and developer experience.",
    message: "Why is cost important for this decision?",
    graph_snapshot: {
      nodes: [
        { id: "goal_1", kind: "goal", label: "Choose Cloud Provider" },
        { id: "factor_cost", kind: "factor", label: "Cost" },
        { id: "factor_reliability", kind: "factor", label: "Reliability" },
        { id: "option_aws", kind: "option", label: "AWS" },
        { id: "option_gcp", kind: "option", label: "GCP" },
      ],
      edges: [
        { from: "factor_cost", to: "goal_1", belief: 0.8 },
        { from: "factor_reliability", to: "goal_1", belief: 0.9 },
        { from: "option_aws", to: "factor_cost", belief: 0.6 },
        { from: "option_gcp", to: "factor_cost", belief: 0.7 },
      ],
    },
    market_context: {
      id: "ctx_1",
      version: "1.0",
      hash: "abc123",
    },
    ...overrides,
  });

  describe("successful requests", () => {
    it("returns 200 with model-bound response for explain intent", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: {
          ...authHeaders,
          "X-Request-Id": "test-explain-request-id",
        },
        payload: createValidRequest({
          message: "Why is cost important?",
          intent: "explain",
          selection: { node_id: "factor_cost" },
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      // request_id should match the X-Request-Id header
      expect(body.request_id).toBe("test-explain-request-id");
      expect(body.message).toBeDefined();
      expect(body.attribution).toBeDefined();

      // Model-bound invariant: must have actions, highlights, or follow-up
      const isModelBound =
        (body.model_actions && body.model_actions.length > 0) ||
        (body.highlights && body.highlights.length > 0) ||
        !!body.follow_up_question;
      expect(isModelBound).toBe(true);
    });

    it("returns 200 with model-bound response for repair intent", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "Can you fix this model?",
          intent: "repair",
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.message).toBeDefined();
      expect(body.attribution).toBeDefined();
    });

    it("returns 200 with inferred intent when not provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "What if we considered Azure as well?",
          // No intent provided - should infer 'ideate'
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.message).toBeDefined();
    });

    it("returns 200 for compare intent", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "Can you compare AWS vs GCP?",
          intent: "compare",
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.message).toBeDefined();
      // Compare should highlight options
      if (body.highlights) {
        expect(body.highlights.some((h: any) => h.type === "node")).toBe(true);
      }
    });

    it("returns 200 for challenge intent", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "Is this assumption really valid?",
          intent: "challenge",
          selection: { node_id: "factor_cost" },
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.message).toBeDefined();
    });

    it("returns CEE headers", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest(),
      });

      expect(response.headers["x-cee-api-version"]).toBe("v1");
      expect(response.headers["x-cee-feature-version"]).toBeDefined();
      expect(response.headers["x-cee-request-id"]).toBeDefined();
    });

    it("includes attribution in response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest(),
      });

      const body = JSON.parse(response.payload);
      expect(body.attribution).toBeDefined();
      expect(body.attribution.provider).toBeDefined();
      expect(body.attribution.model_id).toBeDefined();
      expect(body.attribution.timestamp).toBeDefined();
      expect(body.attribution.assistant_response_hash).toBeDefined();
    });
  });

  describe("validation errors", () => {
    it("accepts non-UUID request_id with safe charset", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          request_id: "my-custom-trace-id",
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.request_id).toBeDefined();
    });

    it("returns 400 for request_id with unsafe characters", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          request_id: "<script>alert(1)</script>",
        }),
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe("CEE_ASK_INVALID_GRAPH");
    });

    it("returns 400 for missing required fields", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: {
          request_id: "550e8400-e29b-41d4-a716-446655440000",
          // Missing other required fields
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.payload);
      expect(body.error.code).toBe("CEE_ASK_INVALID_GRAPH");
    });

    it("returns 400 for wrong graph schema version", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          graph_schema_version: "1.0", // Wrong version
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for brief too short", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          brief: "Short", // Too short (< 10 chars)
        }),
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for invalid intent", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          intent: "invalid_intent",
        }),
      });

      expect(response.statusCode).toBe(400);
    });
  });

  describe("edge selection handling", () => {
    it("handles edge selection correctly", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "Explain this connection",
          intent: "explain",
          selection: { edge_id: "factor_cost->goal_1" },
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.message).toBeDefined();
    });
  });

  describe("conversation context", () => {
    it("accepts turns_recent for conversation history", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          turns_recent: [
            { role: "user", content: "What factors matter?" },
            { role: "assistant", content: "Cost and reliability are key factors." },
          ],
        }),
      });

      expect(response.statusCode).toBe(200);
    });

    it("accepts decision_state_summary", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          decision_state_summary: "User is evaluating cost vs reliability tradeoffs.",
        }),
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("response structure", () => {
    it("returns highlights for explain intent with selection", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "Tell me about this",
          intent: "explain",
          selection: { node_id: "factor_cost" },
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.highlights).toBeDefined();
      expect(body.highlights.length).toBeGreaterThan(0);
      expect(body.highlights[0].type).toBe("node");
      expect(body.highlights[0].ids).toContain("factor_cost");
    });

    it("returns follow_up_question when clarification needed", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "Help me", // Vague message
          intent: "clarify",
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.follow_up_question).toBeDefined();
    });

    it("may return model_actions for repair intent", async () => {
      // Create a graph with an orphan node (no edges)
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "Fix this model",
          intent: "repair",
          graph_snapshot: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Main Goal" },
              { id: "orphan_factor", kind: "factor", label: "Disconnected Factor" },
            ],
            edges: [], // No edges - orphan_factor is disconnected
          },
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      // Should detect and possibly suggest fixing the orphan
      expect(body.message).toBeDefined();
    });

    it("returns why provenance when available", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest({
          message: "Explain this node",
          intent: "explain",
          selection: { node_id: "factor_cost" },
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      if (body.why) {
        expect(Array.isArray(body.why)).toBe(true);
        expect(body.why[0]).toHaveProperty("source");
        expect(body.why[0]).toHaveProperty("confidence");
        expect(body.why[0]).toHaveProperty("note");
      }
    });
  });

  describe("X-Request-Id header handling", () => {
    it("accepts non-UUID X-Request-Id header if safe charset", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: {
          ...authHeaders,
          "X-Request-Id": "my-trace-id-123",
        },
        payload: createValidRequest(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.request_id).toBe("my-trace-id-123");

      // X-CEE-Request-ID header should match
      expect(response.headers["x-cee-request-id"]).toBe("my-trace-id-123");
    });

    it("rejects X-Request-Id header with unsafe characters and generates new ID", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: {
          ...authHeaders,
          "X-Request-Id": "<script>alert(1)</script>",
        },
        payload: createValidRequest(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      // Should NOT contain the unsafe characters
      expect(body.request_id).not.toContain("<");
      expect(body.request_id).not.toContain(">");

      // Should have generated a valid ID
      expect(body.request_id).toBeDefined();
      expect(body.request_id.length).toBeGreaterThan(0);
    });

    it("generates request_id when header not provided", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: authHeaders,
        payload: createValidRequest(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      expect(body.request_id).toBeDefined();
      expect(body.request_id.length).toBeGreaterThan(0);
    });

    it("uses X-Request-Id header over body request_id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: {
          ...authHeaders,
          "X-Request-Id": "header-trace-id",
        },
        payload: createValidRequest({
          request_id: "body-trace-id",
        }),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      // Header should take priority
      expect(body.request_id).toBe("header-trace-id");
    });
  });

  describe("response structure", () => {
    it("returns request_id at top level in success response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: {
          ...authHeaders,
          "X-Request-Id": "top-level-test-id",
        },
        payload: createValidRequest(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      // request_id should be a top-level field, not nested
      expect(body.request_id).toBe("top-level-test-id");
      expect(typeof body.request_id).toBe("string");
    });

    it("returns request_id at top level in error response", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: {
          ...authHeaders,
          "X-Request-Id": "error-test-id",
        },
        payload: {
          // Missing required fields to trigger validation error
          scenario_id: "test",
        },
      });

      expect(response.statusCode).toBe(400);

      const body = JSON.parse(response.payload);
      // request_id should be a top-level field even in error responses
      expect(body.request_id).toBe("error-test-id");
      expect(typeof body.request_id).toBe("string");
      expect(body.error).toBeDefined();
    });

    it("matches X-CEE-Request-ID header with body request_id", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/assist/v1/ask",
        headers: {
          ...authHeaders,
          "X-Request-Id": "match-test-id",
        },
        payload: createValidRequest(),
      });

      expect(response.statusCode).toBe(200);

      const body = JSON.parse(response.payload);
      const headerRequestId = response.headers["x-cee-request-id"];

      expect(body.request_id).toBe(headerRequestId);
      expect(body.request_id).toBe("match-test-id");
    });
  });
});
