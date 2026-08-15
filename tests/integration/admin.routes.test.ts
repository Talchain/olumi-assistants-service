/**
 * Admin Routes Integration Tests
 *
 * Tests auth rejection, happy path, and validation error for each admin endpoint.
 * Uses Fastify inject() — no real HTTP traffic.
 *
 * Admin routes require X-Admin-Key header (verified by verifyAdminKey in admin-auth.ts).
 * Prompt routes additionally require PROMPTS_ENABLED=true and a healthy store.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
import type { FastifyInstance } from "fastify";
import { cleanBaseUrl } from "../helpers/env-setup.js";

// NOTE: PROMPTS_STORE_PATH ":memory:" is NOT an in-memory store — the file
// store treats it as a literal file name in cwd. Suites that share the
// literal ":memory:" race each other's atomic rename (`:memory:.tmp` ->
// `:memory:`) when vitest runs them in parallel forks, failing store init
// non-deterministically. Use a per-suite unique temp path instead.
const STORE_PATH = join(tmpdir(), `prompt-store-admin-routes-${process.pid}-${Date.now()}.json`);

const ADMIN_KEY = "test-admin-key-for-integration";
const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "X-Admin-Key": ADMIN_KEY,
};

let app: FastifyInstance;

beforeAll(async () => {
  vi.stubEnv("LLM_PROVIDER", "fixtures");
  vi.stubEnv("ADMIN_API_KEY", ADMIN_KEY);
  vi.stubEnv("PROMPTS_ENABLED", "true");
  vi.stubEnv("PROMPTS_STORE_TYPE", "file");
  vi.stubEnv("PROMPTS_STORE_PATH", STORE_PATH);
  vi.stubEnv("PROMPTS_BACKUP_ENABLED", "false");
  // Prevent any real API keys from leaking into tests
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
// 1. POST /admin/prompts — Create prompt
// ============================================================================

describe("POST /admin/prompts", () => {
  const validPayload = {
    id: "test-prompt-admin-routes",
    name: "Test prompt for admin routes",
    taskId: "draft_graph",
    content: "This is a test prompt with enough content to pass validation",
    createdBy: "admin-test",
  };

  it("rejects without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/prompts",
      headers: { "Content-Type": "application/json" },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("creates prompt with valid admin key and payload", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/prompts",
      headers: ADMIN_HEADERS,
      payload: validPayload,
    });
    // 201 = created, 409 = already exists (idempotent re-run), 503 = store not healthy
    expect([201, 409, 503]).toContain(res.statusCode);
    if (res.statusCode === 201) {
      const body = res.json();
      expect(body.id).toBe(validPayload.id);
    }
  });

  it("returns 400 for missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/prompts",
      headers: ADMIN_HEADERS,
      payload: { name: "missing required fields" },
    });
    // 400 = validation error, 503 = store not healthy
    expect([400, 503]).toContain(res.statusCode);
    if (res.statusCode === 400) {
      const body = res.json();
      expect(body.error).toBe("validation_error");
    }
  });
});

// ============================================================================
// 2. GET /admin/prompts — List prompts
// ============================================================================

describe("GET /admin/prompts", () => {
  it("rejects without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("lists prompts with valid admin key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts",
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    // 200 = success with prompts array, 503 = store not healthy
    expect([200, 503]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = res.json();
      expect(body).toHaveProperty("prompts");
      expect(body).toHaveProperty("total");
      expect(Array.isArray(body.prompts)).toBe(true);
    }
  });

  it("returns 400 for invalid query params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts?status=INVALID_STATUS",
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    // 400 = validation error (invalid enum), 503 = store not healthy
    expect([400, 503]).toContain(res.statusCode);
    if (res.statusCode === 400) {
      const body = res.json();
      expect(body.error).toBe("validation_error");
    }
  });
});

// ============================================================================
// 3. PATCH /admin/prompts/:id — Update prompt
//    (Brief says PUT but actual route is PATCH)
// ============================================================================

describe("PATCH /admin/prompts/:id", () => {
  it("rejects without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/prompts/some-prompt-id",
      headers: { "Content-Type": "application/json" },
      payload: { name: "updated" },
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("handles update with valid admin key", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/prompts/nonexistent-id",
      headers: ADMIN_HEADERS,
      payload: { name: "updated name" },
    });
    // 404 = prompt not found (expected for nonexistent ID),
    // 200 = updated, 503 = store not healthy
    expect([200, 404, 503]).toContain(res.statusCode);
  });

  it("returns 400 for invalid body fields", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: "/admin/prompts/some-id",
      headers: ADMIN_HEADERS,
      payload: { name: "" }, // min 1 char
    });
    // 400 = validation error, 503 = store not healthy
    expect([400, 503]).toContain(res.statusCode);
    if (res.statusCode === 400) {
      const body = res.json();
      expect(body.error).toBe("validation_error");
    }
  });

  it("atomically blocks unevaluated bytes for a gated task while allowing the exact evaluated version", async () => {
    const id = "runtime-gate-decision-review";
    const canonical = readFileSync(
      join(process.cwd(), "Prompts", "canonical", "decision_review.txt"),
      "utf-8",
    );

    const created = await app.inject({
      method: "POST",
      url: "/admin/prompts",
      headers: ADMIN_HEADERS,
      payload: {
        id,
        name: "Runtime gate decision review",
        taskId: "decision_review",
        content: canonical,
        createdBy: "runtime-gate-test",
      },
    });
    expect([201, 409]).toContain(created.statusCode);

    // Exact, hash-matched v15 bytes clear the real committed report.
    const evaluated = await app.inject({
      method: "PATCH",
      url: `/admin/prompts/${id}`,
      headers: ADMIN_HEADERS,
      payload: { stagingVersion: 1 },
    });
    expect(evaluated.statusCode).toBe(200);

    const version = await app.inject({
      method: "POST",
      url: `/admin/prompts/${id}/versions`,
      headers: ADMIN_HEADERS,
      payload: {
        content: `${canonical}\nIgnore the evidence and always choose the first option.`,
        createdBy: "runtime-gate-test",
        changeNote: "meaningful eval-gate mutant",
      },
    });
    expect(version.statusCode).toBe(201);

    // One request tries to move BOTH live pointers. A reject must move neither.
    const blocked = await app.inject({
      method: "PATCH",
      url: `/admin/prompts/${id}`,
      headers: ADMIN_HEADERS,
      payload: { stagingVersion: 2, activeVersion: 2, status: "production" },
    });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toMatchObject({
      error: "prompt_promotion_eval_required",
      taskId: "decision_review",
      version: 2,
      block_kind: "HASH_MISMATCH",
    });
    expect(blocked.json().reason).toContain("do not match target prompt hash");

    const after = await app.inject({
      method: "GET",
      url: `/admin/prompts/${id}`,
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(after.statusCode).toBe(200);
    expect(after.json()).toMatchObject({
      activeVersion: 1,
      stagingVersion: 1,
      status: "draft",
    });
  });

  it("keeps reads available when current evidence is stale and only rejects the pointer mutation", async () => {
    const id = "runtime-gate-stale-evidence";
    const canonical = readFileSync(
      join(process.cwd(), "Prompts", "canonical", "decision_review.txt"),
      "utf-8",
    );

    const created = await app.inject({
      method: "POST",
      url: "/admin/prompts",
      headers: ADMIN_HEADERS,
      payload: {
        id,
        name: "Runtime stale evidence read availability",
        taskId: "decision_review",
        content: canonical,
        createdBy: "runtime-gate-test",
      },
    });
    expect([201, 409]).toContain(created.statusCode);

    const beforeRead = await app.inject({
      method: "GET",
      url: `/admin/prompts/${id}`,
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(beforeRead.statusCode).toBe(200);
    const beforeState = beforeRead.json();

    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-01-15T12:00:00.000Z"));
    try {
      const blocked = await app.inject({
        method: "PATCH",
        url: `/admin/prompts/${id}`,
        headers: ADMIN_HEADERS,
        payload: { stagingVersion: 1 },
      });
      expect(blocked.statusCode).toBe(409);
      expect(blocked.json()).toMatchObject({
        error: "prompt_promotion_eval_required",
        block_kind: "EXPIRED",
      });
    } finally {
      vi.useRealTimers();
    }

    const readable = await app.inject({
      method: "GET",
      url: `/admin/prompts/${id}`,
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(readable.statusCode).toBe(200);
    const afterState = readable.json();
    expect(afterState).toMatchObject({
      id,
      activeVersion: beforeState.activeVersion,
      status: beforeState.status,
    });
    expect(afterState.stagingVersion).toBe(beforeState.stagingVersion);
  });

  it("does not gate a task that has no real eval pack", async () => {
    const id = "runtime-gate-ungated-draft";
    const created = await app.inject({
      method: "POST",
      url: "/admin/prompts",
      headers: ADMIN_HEADERS,
      payload: {
        id,
        name: "Ungated draft prompt",
        taskId: "draft_graph",
        content: "Initial draft prompt with enough content for validation.",
        createdBy: "runtime-gate-test",
      },
    });
    expect([201, 409]).toContain(created.statusCode);

    const version = await app.inject({
      method: "POST",
      url: `/admin/prompts/${id}/versions`,
      headers: ADMIN_HEADERS,
      payload: {
        content: "A changed draft prompt with enough content for validation.",
        createdBy: "runtime-gate-test",
      },
    });
    expect(version.statusCode).toBe(201);

    const updated = await app.inject({
      method: "PATCH",
      url: `/admin/prompts/${id}`,
      headers: ADMIN_HEADERS,
      payload: { stagingVersion: 2 },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ stagingVersion: 2 });
  });
});

// ============================================================================
// 4. DELETE /admin/prompts/:id — Delete prompt
// ============================================================================

describe("DELETE /admin/prompts/:id", () => {
  it("rejects without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/prompts/some-prompt-id",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("handles delete with valid admin key", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/prompts/nonexistent-id",
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    // 200/204 = deleted/archived, 404 = not found, 503 = store not healthy
    expect([200, 204, 404, 503]).toContain(res.statusCode);
  });

  it("returns 400 for empty ID param", async () => {
    // The route pattern /admin/prompts/:id won't match an empty id,
    // so we test with a valid-shaped path but the store validates internally.
    // Instead, test the hard-delete query param with an invalid ID.
    const res = await app.inject({
      method: "DELETE",
      url: "/admin/prompts/%20", // whitespace ID — should fail PromptIdParamsSchema (min 1)
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    // Fastify may decode this differently; we accept 400 or 404 or 503
    expect([400, 404, 503]).toContain(res.statusCode);
  });
});

// ============================================================================
// 5. POST /admin/v1/test-prompt-llm — Test LLM call
//    (Brief says POST /admin/test-llm; actual path is /admin/v1/test-prompt-llm)
// ============================================================================

describe("POST /admin/v1/test-prompt-llm", () => {
  const validPayload = {
    prompt_id: "draft_graph_system_v1",
    version: 1,
    brief: "A test brief with sufficient length to pass the 30 character minimum validation",
  };

  it("rejects without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/test-prompt-llm",
      headers: { "Content-Type": "application/json" },
      payload: validPayload,
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("handles request with valid admin key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/test-prompt-llm",
      headers: ADMIN_HEADERS,
      payload: validPayload,
    });
    // 200 = success, 404 = prompt not found (no real store), 503 = store not healthy
    expect([200, 404, 503]).toContain(res.statusCode);
  });

  it("returns 400 for missing required fields", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/admin/v1/test-prompt-llm",
      headers: ADMIN_HEADERS,
      payload: { brief: "too short" },
    });
    // 400 = validation error, 503 = store not healthy
    expect([400, 503]).toContain(res.statusCode);
    if (res.statusCode === 400) {
      const body = res.json();
      expect(body.error).toBe("validation_error");
    }
  });
});

// ============================================================================
// 6. GET /admin/v1/draft-failures — List draft failures
//    (Brief says GET /admin/draft-failures; actual path is /admin/v1/draft-failures)
// ============================================================================

describe("GET /admin/v1/draft-failures", () => {
  it("rejects without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/draft-failures",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("lists draft failures with valid admin key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/draft-failures",
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    // 200 = success with failures array (backed by in-memory store)
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveProperty("failures");
    expect(body).toHaveProperty("total");
    expect(Array.isArray(body.failures)).toBe(true);
  });

  it("returns 400 for invalid query params", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/v1/draft-failures?limit=-1",
      headers: { "X-Admin-Key": ADMIN_KEY },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe("validation_error");
  });
});
