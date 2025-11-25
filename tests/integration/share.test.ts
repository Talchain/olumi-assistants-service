import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { build } from "../../src/server.js";
import type { FastifyInstance } from "fastify";

describe("Share Integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Enable share feature
    vi.stubEnv("SHARE_REVIEW_ENABLED", "1");
    vi.stubEnv("SHARE_SECRET", "test-secret-key");
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ASSIST_API_KEYS", "test-key-share");

    delete process.env.BASE_URL;
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    vi.stubEnv("SHARE_REVIEW_ENABLED", "1");
  });

  it("should create share with valid graph", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/assist/share",
      headers: {
        "X-Olumi-Assist-Key": "test-key-share",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "q1", kind: "goal", label: "Should we launch?" },
            { id: "o1", kind: "option", label: "Yes" },
          ],
          edges: [{ from: "q1", to: "o1" }],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        brief: "Product launch decision",
        ttl_hours: 24,
      },
    });

    expect(response.statusCode).toBe(201);
    const body = response.json();
    expect(body.schema).toBe("share.v1");
    expect(body.share_id).toBeTruthy();
    expect(body.url).toContain("/assist/share/");
    expect(body.expires_at).toBeTruthy();
  });

  it("should retrieve shared content", async () => {
    // Create share
    const createResponse = await app.inject({
      method: "POST",
      url: "/assist/share",
      headers: {
        "X-Olumi-Assist-Key": "test-key-share",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "q1", kind: "goal", label: "Test question" }],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      },
    });

    const { url } = createResponse.json();
    const token = url.split("/assist/share/")[1];

    // Retrieve share
    const getResponse = await app.inject({
      method: "GET",
      url: `/assist/share/${token}`,
    });

    expect(getResponse.statusCode).toBe(200);
    const body = getResponse.json();
    expect(body.schema).toBe("share-content.v1");
    expect(body.graph).toBeTruthy();
    expect(body.graph.nodes).toHaveLength(1);
    expect(body.access_count).toBe(1);
  });

  it("should increment access count on multiple retrievals", async () => {
    // Create share
    const createResponse = await app.inject({
      method: "POST",
      url: "/assist/share",
      headers: {
        "X-Olumi-Assist-Key": "test-key-share",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "q1", kind: "goal", label: "Test" }],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      },
    });

    const { url } = createResponse.json();
    const token = url.split("/assist/share/")[1];

    // First access
    const getResponse1 = await app.inject({
      method: "GET",
      url: `/assist/share/${token}`,
    });
    expect(getResponse1.json().access_count).toBe(1);

    // Second access
    const getResponse2 = await app.inject({
      method: "GET",
      url: `/assist/share/${token}`,
    });
    expect(getResponse2.json().access_count).toBe(2);
  });

  it("should redact PII from shared graph", async () => {
    // Create share with PII
    const createResponse = await app.inject({
      method: "POST",
      url: "/assist/share",
      headers: {
        "X-Olumi-Assist-Key": "test-key-share",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "q1", kind: "goal", label: "Contact john@example.com" }],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
        brief: "Call 07123456789",
      },
    });

    const { url } = createResponse.json();
    const token = url.split("/assist/share/")[1];

    // Retrieve and check redaction
    const getResponse = await app.inject({
      method: "GET",
      url: `/assist/share/${token}`,
    });

    const body = getResponse.json();
    expect(body.graph.nodes[0].label).toBe("Contact [EMAIL]");
    expect(body.brief).toBe("Call [PHONE]");
  });

  it("should revoke share", async () => {
    // Create share
    const createResponse = await app.inject({
      method: "POST",
      url: "/assist/share",
      headers: {
        "X-Olumi-Assist-Key": "test-key-share",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "q1", kind: "goal", label: "Test" }],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      },
    });

    const { url } = createResponse.json();
    const token = url.split("/assist/share/")[1];

    // Revoke share
    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/assist/share/${token}`,
    });

    expect(deleteResponse.statusCode).toBe(200);
    const deleteBody = deleteResponse.json();
    expect(deleteBody.revoked).toBe(true);

    // Try to retrieve revoked share
    const getResponse = await app.inject({
      method: "GET",
      url: `/assist/share/${token}`,
    });

    expect(getResponse.statusCode).toBe(410);
  });

  it("should reject graph exceeding node limit", async () => {
    const nodes = Array.from({ length: 51 }, (_, i) => ({
      id: `n${i}`,
      kind: "goal" as const,
      label: `Node ${i}`,
    }));

    const response = await app.inject({
      method: "POST",
      url: "/assist/share",
      headers: {
        "X-Olumi-Assist-Key": "test-key-share",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes,
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain("too large");
    expect(body.message).toContain("nodes");
  });

  it("should reject graph exceeding edge limit", async () => {
    // Create 20 nodes with 201 edges (exceeds MAX_EDGES=200 but not MAX_NODES=50)
    const nodes = Array.from({ length: 20 }, (_, i) => ({
      id: `n${i}`,
      kind: "goal" as const,
      label: `Node ${i}`,
    }));

    // Create 201 edges by connecting nodes to each other
    const edges = Array.from({ length: 201 }, (_, i) => ({
      from: `n${Math.floor(i / 10)}`,
      to: `n${(i % 10) + 10}`,
    }));

    const response = await app.inject({
      method: "POST",
      url: "/assist/share",
      headers: {
        "X-Olumi-Assist-Key": "test-key-share",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes,
          edges,
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json();
    expect(body.message).toContain("too large");
    expect(body.message).toContain("edges");
  });

  it("should return 404 when feature disabled", async () => {
    vi.stubEnv("SHARE_REVIEW_ENABLED", "0");

    const response = await app.inject({
      method: "POST",
      url: "/assist/share",
      headers: {
        "X-Olumi-Assist-Key": "test-key-share",
      },
      payload: {
        graph: {
          version: "1",
          default_seed: 17,
          nodes: [{ id: "q1", kind: "goal", label: "Test" }],
          edges: [],
          meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
        },
      },
    });

    expect(response.statusCode).toBe(404);
    expect(response.json().message).toContain("not enabled");
  });

  it("should return 410 for invalid token", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/assist/share/invalid-token",
    });

    expect(response.statusCode).toBe(410);
  });

  it("should return 404 for non-existent share", async () => {
    const response = await app.inject({
      method: "DELETE",
      url: "/assist/share/invalid-token",
    });

    expect(response.statusCode).toBe(404);
  });
});
