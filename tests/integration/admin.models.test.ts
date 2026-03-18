/**
 * Admin Model Routing & Dashboard Integration Tests
 *
 * Covers:
 * - GET /admin/models/routing — auth, response shape, all tasks present
 * - GET /admin/models/routing — provider-mismatch scenario (LLM_PROVIDER=anthropic)
 * - GET /admin/dashboard — serves HTML (IP-only gate, no admin key needed for the page itself)
 * - GET /admin/dashboard/env — auth, response shape, feature flags present
 * - Read-only key (ADMIN_API_KEY_READ only) — routes registered and accessible
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { cleanBaseUrl } from "../helpers/env-setup.js";
import { TASK_MODEL_DEFAULTS } from "../../src/config/model-routing.js";

const ADMIN_KEY = "test-admin-key-models";
const ADMIN_HEADERS = { "X-Admin-Key": ADMIN_KEY };

let app: FastifyInstance;

beforeAll(async () => {
  vi.stubEnv("LLM_PROVIDER", "fixtures");
  vi.stubEnv("ADMIN_API_KEY", ADMIN_KEY);
  vi.stubEnv("PROMPTS_ENABLED", "true");
  vi.stubEnv("PROMPTS_STORE_TYPE", "file");
  vi.stubEnv("PROMPTS_STORE_PATH", ":memory:");
  vi.stubEnv("PROMPTS_BACKUP_ENABLED", "false");
  vi.stubEnv("ASSIST_API_KEY", "test-assist-key");
  cleanBaseUrl();

  const { build } = await import("../../src/server.js");
  app = await build();
  await app.ready();
});

afterAll(async () => {
  await app.close();
  vi.unstubAllEnvs();
});

// ============================================================================
// GET /admin/models/routing
// ============================================================================

describe("GET /admin/models/routing", () => {
  it("rejects without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/models/routing",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 200 with valid admin key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns all CeeTask entries", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.tasks)).toBe(true);

    const expectedTasks = Object.keys(TASK_MODEL_DEFAULTS);
    const returnedTasks = body.tasks.map((t: { task: string }) => t.task);
    for (const task of expectedTasks) {
      expect(returnedTasks).toContain(task);
    }
  });

  it("each task entry has required fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    const body = res.json();
    for (const entry of body.tasks) {
      expect(entry).toHaveProperty("task");
      expect(entry).toHaveProperty("model");
      expect(entry).toHaveProperty("provider");
      expect(entry).toHaveProperty("source");
      expect(["env_override", "default"]).toContain(entry.source);
      expect(typeof entry.model).toBe("string");
      expect(entry.model.length).toBeGreaterThan(0);
    }
  });

  it("includes default_provider and timestamp", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    const body = res.json();
    expect(body).toHaveProperty("default_provider");
    expect(body).toHaveProperty("timestamp");
    expect(typeof body.timestamp).toBe("string");
    // timestamp should be a valid ISO date
    expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
  });

  it("reflects CEE_MODEL_* env override as env_override source", async () => {
    vi.stubEnv("CEE_MODEL_ORCHESTRATOR", "claude-sonnet-4-6");
    // Need a fresh app to pick up the new env
    vi.resetModules();
    cleanBaseUrl();
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ADMIN_API_KEY", ADMIN_KEY);
    vi.stubEnv("PROMPTS_ENABLED", "true");
    vi.stubEnv("PROMPTS_STORE_TYPE", "file");
    vi.stubEnv("PROMPTS_STORE_PATH", ":memory:");
    vi.stubEnv("PROMPTS_BACKUP_ENABLED", "false");
    vi.stubEnv("ASSIST_API_KEY", "test-assist-key");

    const { build: build2 } = await import("../../src/server.js");
    const app2 = await build2();
    await app2.ready();

    try {
      const res = await app2.inject({
        method: "GET",
        url: "/admin/models/routing",
        headers: ADMIN_HEADERS,
      });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      const orch = body.tasks.find((t: { task: string }) => t.task === "orchestrator");
      expect(orch).toBeDefined();
      expect(orch.model).toBe("claude-sonnet-4-6");
      expect(orch.source).toBe("env_override");
    } finally {
      await app2.close();
      delete process.env["CEE_MODEL_ORCHESTRATOR"];
    }
  });
});

// ============================================================================
// GET /admin/dashboard — HTML page (IP-only gate)
// ============================================================================

describe("GET /admin/dashboard", () => {
  it("returns 200 with HTML content-type", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toContain("text/html");
  });

  it("response contains Alpine.js dashboard script", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard",
    });
    expect(res.body).toContain("alpinejs");
    expect(res.body).toContain("dashboard()");
  });

  it("has security headers", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard",
    });
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["content-security-policy"]).toBeDefined();
  });
});

// ============================================================================
// GET /admin/dashboard/env — Environment info
// ============================================================================

describe("GET /admin/dashboard/env", () => {
  it("rejects without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/env",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 200 with valid admin key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/env",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
  });

  it("returns node_env, feature_flags array, and timestamp", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/env",
      headers: ADMIN_HEADERS,
    });
    const body = res.json();
    expect(body).toHaveProperty("node_env");
    expect(Array.isArray(body.feature_flags)).toBe(true);
    expect(body).toHaveProperty("timestamp");
  });

  it("feature_flags includes all four expected flags", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/env",
      headers: ADMIN_HEADERS,
    });
    const body = res.json();
    const flagNames = body.feature_flags.map((f: { name: string }) => f.name);
    expect(flagNames).toContain("CEE_ORCHESTRATOR_ENABLED");
    expect(flagNames).toContain("DSK_ENABLED");
    expect(flagNames).toContain("ANTHROPIC_PROMPT_CACHE_ENABLED");
    expect(flagNames).toContain("CEE_ZONE2_REGISTRY_ENABLED");

    // Each flag has name and enabled (boolean)
    for (const flag of body.feature_flags) {
      expect(typeof flag.name).toBe("string");
      expect(typeof flag.enabled).toBe("boolean");
    }
  });
});

// ============================================================================
// Cache-Control headers
// ============================================================================

describe("Cache-Control headers on admin endpoints", () => {
  it("/admin/models/routing has Cache-Control: no-store", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("/admin/dashboard has Cache-Control: no-store", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard",
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("/admin/dashboard/env has Cache-Control: no-store", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/dashboard/env",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

// ============================================================================
// Provider-mismatch scenario: LLM_PROVIDER=anthropic with OpenAI task defaults
// ============================================================================

describe("GET /admin/models/routing — provider-mismatch (LLM_PROVIDER=anthropic)", () => {
  let appAnthropicProvider: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    cleanBaseUrl();
    vi.stubEnv("LLM_PROVIDER", "anthropic");
    vi.stubEnv("ADMIN_API_KEY", ADMIN_KEY);
    vi.stubEnv("PROMPTS_ENABLED", "true");
    vi.stubEnv("PROMPTS_STORE_TYPE", "file");
    vi.stubEnv("PROMPTS_STORE_PATH", ":memory:");
    vi.stubEnv("PROMPTS_BACKUP_ENABLED", "false");
    vi.stubEnv("ASSIST_API_KEY", "test-assist-key");

    const { build } = await import("../../src/server.js");
    appAnthropicProvider = await build();
    await appAnthropicProvider.ready();
  });

  afterAll(async () => {
    await appAnthropicProvider.close();
    vi.unstubAllEnvs();
  });

  it("returns 200", async () => {
    const res = await appAnthropicProvider.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
  });

  it("reports default_provider as anthropic", async () => {
    const res = await appAnthropicProvider.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    const body = res.json();
    expect(body.default_provider).toBe("anthropic");
  });

  it("OpenAI task defaults are reported as provider_mismatch with null model", async () => {
    const res = await appAnthropicProvider.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    const body = res.json();

    // draft_graph defaults to gpt-4.1 (openai) — should be skipped when provider=anthropic
    const draftRow = body.tasks.find((t: { task: string }) => t.task === "draft_graph");
    expect(draftRow).toBeDefined();
    expect(draftRow.source).toBe("provider_mismatch");
    expect(draftRow.model).toBeNull();
    expect(typeof draftRow.resolution_note).toBe("string");
    expect(draftRow.resolution_note.length).toBeGreaterThan(0);
  });

  it("bias_check (anthropic default) is still resolved when provider=anthropic", async () => {
    const res = await appAnthropicProvider.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: ADMIN_HEADERS,
    });
    const body = res.json();

    // bias_check defaults to claude-sonnet-4-20250514 (anthropic) — should resolve
    const biasRow = body.tasks.find((t: { task: string }) => t.task === "bias_check");
    expect(biasRow).toBeDefined();
    expect(biasRow.source).toBe("default");
    expect(typeof biasRow.model).toBe("string");
    expect(biasRow.model).not.toBeNull();
    expect(biasRow.provider).toBe("anthropic");
  });
});

// ============================================================================
// Read-only key (ADMIN_API_KEY_READ only) — routes registered and accessible
// ============================================================================

describe("Read-only key deployment (ADMIN_API_KEY_READ only)", () => {
  const READ_KEY = "test-read-only-key-models";
  let appReadOnly: FastifyInstance;

  beforeAll(async () => {
    vi.resetModules();
    cleanBaseUrl();
    // Only set the read key — no full ADMIN_API_KEY
    vi.stubEnv("LLM_PROVIDER", "fixtures");
    vi.stubEnv("ADMIN_API_KEY_READ", READ_KEY);
    vi.stubEnv("PROMPTS_ENABLED", "true");
    vi.stubEnv("PROMPTS_STORE_TYPE", "file");
    vi.stubEnv("PROMPTS_STORE_PATH", ":memory:");
    vi.stubEnv("PROMPTS_BACKUP_ENABLED", "false");
    vi.stubEnv("ASSIST_API_KEY", "test-assist-key");

    const { build } = await import("../../src/server.js");
    appReadOnly = await build();
    await appReadOnly.ready();
  });

  afterAll(async () => {
    await appReadOnly.close();
    vi.unstubAllEnvs();
  });

  it("/admin/models/routing is registered and accepts the read-only key", async () => {
    const res = await appReadOnly.inject({
      method: "GET",
      url: "/admin/models/routing",
      headers: { "X-Admin-Key": READ_KEY },
    });
    // Should be 200, not 404 (routes registered) or 401 (key accepted)
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.tasks)).toBe(true);
  });

  it("/admin/dashboard/env is registered and accepts the read-only key", async () => {
    const res = await appReadOnly.inject({
      method: "GET",
      url: "/admin/dashboard/env",
      headers: { "X-Admin-Key": READ_KEY },
    });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json().feature_flags)).toBe(true);
  });

  it("/admin/models/routing still rejects missing key", async () => {
    const res = await appReadOnly.inject({
      method: "GET",
      url: "/admin/models/routing",
    });
    expect(res.statusCode).toBe(401);
  });
});
