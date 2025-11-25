/**
 * CEE v1 Draft Graph Integration Tests
 *
 * Exercises POST /assist/v1/draft-graph using fixtures adapter
 * and verifies CEE response wrappers and per-feature rate limiting.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";

// Use fixtures provider for deterministic graphs and zero cost
vi.stubEnv("LLM_PROVIDER", "fixtures");

// Avoid calling real engine validate service
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

vi.mock("../../src/cee/structure/index.js", () => ({
  detectStructuralWarnings: vi.fn().mockReturnValue({
    warnings: [
      {
        id: "no_outcome_node",
        severity: "medium",
        node_ids: ["n1"],
        edge_ids: [],
        explanation: "ignored",
      },
    ],
    uncertainNodeIds: ["n1"],
  }),
}));

import { build } from "../../src/server.js";

describe("POST /assist/v1/draft-graph (CEE v1)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    // Allow multiple API keys so tests can use independent buckets
    vi.stubEnv(
      "ASSIST_API_KEYS",
      "cee-key-1,cee-key-2,cee-key-3,cee-key-limit,cee-telemetry-success,cee-telemetry-validation,cee-telemetry-limit"
    );
    vi.stubEnv("CEE_DRAFT_FEATURE_VERSION", "draft-model-test");
    vi.stubEnv("CEE_DRAFT_RATE_LIMIT_RPM", "2");
    vi.stubEnv("CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED", "true");
    vi.stubEnv("CEE_REFINEMENT_ENABLED", "true");

    delete process.env.BASE_URL;
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  const headersKey1 = {
    "X-Olumi-Assist-Key": "cee-key-1",
  } as const;

  const headersKey2 = {
    "X-Olumi-Assist-Key": "cee-key-2",
  } as const;

  const headersKey3 = {
    "X-Olumi-Assist-Key": "cee-key-3",
  } as const;

  const headersRate = {
    "X-Olumi-Assist-Key": "cee-key-limit",
  } as const;

  it("returns CEEDraftGraphResponseV1 for valid request with fixtures", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: headersKey1,
      payload: {
        brief: "A sufficiently long decision brief for CEE v1 draft-graph happy-path tests.",
      },
    });

    expect(res.statusCode).toBe(200);

    // Headers
    expect(res.headers["x-cee-api-version"]).toBe("v1");
    expect(res.headers["x-cee-feature-version"]).toBe("draft-model-test");
    const ceeRequestId = res.headers["x-cee-request-id"];
    expect(typeof ceeRequestId).toBe("string");
    expect((ceeRequestId as string).length).toBeGreaterThan(0);

    const body = res.json();

    // Core graph shape
    expect(body.graph).toBeDefined();
    expect(Array.isArray(body.graph.nodes)).toBe(true);
    expect(Array.isArray(body.graph.edges)).toBe(true);

    // Trace metadata
    expect(body.trace).toBeDefined();
    expect(body.trace.request_id).toBe(ceeRequestId);
    expect(body.trace.correlation_id).toBe(ceeRequestId);

    // Quality meta
    expect(body.quality).toBeDefined();
    expect(typeof body.quality.overall).toBe("number");
    expect(body.quality.overall).toBeGreaterThanOrEqual(1);
    expect(body.quality.overall).toBeLessThanOrEqual(10);
    expect(typeof body.quality.structure).toBe("number");
    expect(body.quality.structure).toBeGreaterThanOrEqual(1);
    expect(body.quality.structure).toBeLessThanOrEqual(10);
    expect(typeof body.quality.coverage).toBe("number");
    expect(body.quality.coverage).toBeGreaterThanOrEqual(1);
    expect(body.quality.coverage).toBeLessThanOrEqual(10);
    expect(typeof body.quality.causality).toBe("number");
    expect(body.quality.causality).toBeGreaterThanOrEqual(1);
    expect(body.quality.causality).toBeLessThanOrEqual(10);
    expect(typeof body.quality.safety).toBe("number");
    expect(body.quality.safety).toBeGreaterThanOrEqual(1);
    expect(body.quality.safety).toBeLessThanOrEqual(10);
    expect(body.quality.details).toBeDefined();

    // validation_issues: array present (possibly empty)
    if (body.validation_issues !== undefined) {
      expect(Array.isArray(body.validation_issues)).toBe(true);
    }

    // Archetype metadata
    expect(body.archetype).toBeDefined();
    expect(typeof body.archetype.decision_type).toBe("string");
    expect(typeof body.archetype.match).toBe("string");
  });

  it("emits draft_warnings and confidence_flags when structural warnings are enabled", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: headersKey1,
      payload: {
        brief: "A sufficiently long decision brief for CEE structural warnings tests.",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(Array.isArray(body.draft_warnings)).toBe(true);
    expect(body.draft_warnings.length).toBe(1);
    expect(body.draft_warnings[0].id).toBe("no_outcome_node");

    expect(body.confidence_flags).toBeDefined();
    const flags = body.confidence_flags as any;
    expect(Array.isArray(flags.uncertain_nodes)).toBe(true);
    expect(flags.uncertain_nodes).toContain("n1");
  });

  it("propagates seed and archetype_hint through sanitizer and finaliser", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: headersKey2,
      payload: {
        brief: "A long pricing decision brief for archetype testing in CEE v1.",
        seed: "cee-test-seed-123",
        archetype_hint: "pricing_decision",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.seed).toBe("cee-test-seed-123");
    expect(body.archetype).toBeDefined();
    expect(body.archetype.decision_type).toBe("pricing_decision");
    // With archetype framework enabled and strong pricing signals, match should be exact
    expect(body.archetype.match).toBe("exact");
  });

  it("accepts refinement fields when refinement flag is enabled", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: headersKey2,
      payload: {
        brief: "A sufficiently long decision brief for refinement tests in CEE v1.",
        previous_graph: {
          version: "1",
          default_seed: 17,
          nodes: [
            { id: "goal_1", kind: "goal", label: "Increase revenue" },
            { id: "opt_a", kind: "option", label: "Premium pricing" },
          ],
          edges: [],
          meta: { roots: ["goal_1"], leaves: ["opt_a"], suggested_positions: {}, source: "assistant" },
        },
        refinement_mode: "expand",
        refinement_instructions: "Add missing risks and outcomes.",
        preserve_nodes: ["goal_1"],
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();

    // Core CEEDraftGraphResponseV1 fields still present
    expect(body.graph).toBeDefined();
    expect(body.trace).toBeDefined();
    expect(body.quality).toBeDefined();
    // Refinement fields are input-only; response shape is unchanged
    expect(body.previous_graph).toBeUndefined();
    expect(body.refinement_mode).toBeUndefined();
  });

  it("returns CEE_VALIDATION_FAILED for invalid input", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: headersKey3,
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();

    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_VALIDATION_FAILED");
    expect(body.retryable).toBe(false);
    expect(body.trace).toBeDefined();
    expect(body.graph).toBeUndefined();
    expect(body.quality).toBeUndefined();
  });

  it("enforces per-feature rate limiting with CEE_RATE_LIMIT", async () => {
    const payload = {
      brief: "A sufficiently long decision brief for CEE rate limit testing.",
    };

    const first = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: headersRate,
      payload,
    });
    const second = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: headersRate,
      payload,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);

    const limited = await app.inject({
      method: "POST",
      url: "/assist/v1/draft-graph",
      headers: headersRate,
      payload,
    });

    expect(limited.statusCode).toBe(429);
    const body = limited.json();

    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_RATE_LIMIT");
    expect(body.retryable).toBe(true);
    expect(body.details?.retry_after_seconds).toBeGreaterThan(0);

    const retryAfter = limited.headers["retry-after"];
    expect(retryAfter).toBeDefined();
    expect(Number(retryAfter)).toBeGreaterThan(0);
  });
});
