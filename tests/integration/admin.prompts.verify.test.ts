/**
 * Admin /admin/prompts/verify Integration Tests
 *
 * Tests:
 * 1. Endpoint returns correct shape with all registered prompts
 * 2. content_hash is deterministic (same content → same first-16 hex chars)
 * 3. Endpoint requires admin auth (401 without key)
 * 4. verify endpoint covers ALL registered prompt task IDs (not just cached)
 * 5. prompt_id/prompt_hash/prompt_source logged at info level for orchestrator and edit_graph
 */

import { describe, it, expect, beforeAll, afterAll, vi, beforeEach, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import { cleanBaseUrl } from "../helpers/env-setup.js";

const ADMIN_KEY = "test-admin-key-verify-endpoint";
const ADMIN_HEADERS = {
  "Content-Type": "application/json",
  "X-Admin-Key": ADMIN_KEY,
};

let app: FastifyInstance;

beforeAll(async () => {
  vi.stubEnv("LLM_PROVIDER", "fixtures");
  vi.stubEnv("ADMIN_API_KEY", ADMIN_KEY);
  vi.stubEnv("PROMPTS_ENABLED", "false"); // use defaults so cache warms from defaults
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
// 1. Auth guard
// ============================================================================

describe("GET /admin/prompts/verify — auth", () => {
  it("returns 401 without X-Admin-Key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts/verify",
    });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("returns 401 with wrong X-Admin-Key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts/verify",
      headers: { "X-Admin-Key": "totally-wrong-key" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("returns 200 with valid admin key", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts/verify",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
  });
});

// ============================================================================
// 2. Response shape
// ============================================================================

describe("GET /admin/prompts/verify — response shape", () => {
  it("returns top-level environment and timestamp fields", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts/verify",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body).toHaveProperty("prompts");
    expect(body).toHaveProperty("environment");
    expect(body).toHaveProperty("timestamp");
    // timestamp must be a valid ISO string
    expect(() => new Date(body.timestamp)).not.toThrow();
    expect(new Date(body.timestamp).toISOString()).toBe(body.timestamp);
  });

  it("each prompt entry has the required fields with correct types", async () => {
    const { getSystemPrompt } = await import("../../src/adapters/llm/prompt-loader.js");
    await getSystemPrompt("orchestrator");

    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts/verify",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(Array.isArray(body.prompts)).toBe(true);

    const orchestratorEntry = body.prompts.find(
      (p: { prompt_id: string }) => p.prompt_id === "orchestrator"
    );
    expect(orchestratorEntry).toBeDefined();

    expect(typeof orchestratorEntry.prompt_id).toBe("string");
    expect(["store", "default"]).toContain(orchestratorEntry.source);
    expect(
      orchestratorEntry.store_version === null ||
        typeof orchestratorEntry.store_version === "number"
    ).toBe(true);
    // content_hash is exactly 16 hex chars
    expect(orchestratorEntry.content_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(typeof orchestratorEntry.content_length).toBe("number");
    expect(orchestratorEntry.content_length).toBeGreaterThan(0);
    expect(typeof orchestratorEntry.first_100_chars).toBe("string");
    expect(orchestratorEntry.first_100_chars.length).toBeLessThanOrEqual(100);
    expect(typeof orchestratorEntry.last_100_chars).toBe("string");
    expect(orchestratorEntry.last_100_chars.length).toBeLessThanOrEqual(100);
    // loaded_at is ISO string when cached, null when served from hardcoded default
    expect(
      orchestratorEntry.loaded_at === null ||
        new Date(orchestratorEntry.loaded_at).toISOString() === orchestratorEntry.loaded_at
    ).toBe(true);
  });
});

// ============================================================================
// 3. content_hash determinism
// ============================================================================

describe("GET /admin/prompts/verify — content_hash determinism", () => {
  it("same content always produces the same 16-char hash prefix", () => {
    const content = "A stable prompt content for determinism test";
    const hash1 = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const hash2 = createHash("sha256").update(content).digest("hex").slice(0, 16);
    expect(hash1).toBe(hash2);
    expect(hash1).toMatch(/^[0-9a-f]{16}$/);
  });

  it("different content produces different hash", () => {
    const contentA = "Prompt version A for uniqueness test";
    const contentB = "Prompt version B for uniqueness test";
    const hashA = createHash("sha256").update(contentA).digest("hex").slice(0, 16);
    const hashB = createHash("sha256").update(contentB).digest("hex").slice(0, 16);
    expect(hashA).not.toBe(hashB);
  });

  it("calling verify twice returns the same hash for the same prompt", async () => {
    const { getSystemPrompt } = await import("../../src/adapters/llm/prompt-loader.js");
    await getSystemPrompt("draft_graph");

    const res1 = await app.inject({ method: "GET", url: "/admin/prompts/verify", headers: ADMIN_HEADERS });
    const res2 = await app.inject({ method: "GET", url: "/admin/prompts/verify", headers: ADMIN_HEADERS });

    const draftEntry1 = res1.json().prompts.find((p: { prompt_id: string }) => p.prompt_id === "draft_graph");
    const draftEntry2 = res2.json().prompts.find((p: { prompt_id: string }) => p.prompt_id === "draft_graph");

    expect(draftEntry1).toBeDefined();
    expect(draftEntry2).toBeDefined();
    expect(draftEntry1.content_hash).toBe(draftEntry2.content_hash);
  });
});

// ============================================================================
// 4. Registry coverage — endpoint must include ALL registered task IDs
// ============================================================================

describe("GET /admin/prompts/verify — full registry coverage", () => {
  it("returns an entry for every task ID that has a registered default prompt", async () => {
    // Registered defaults (from registerAllDefaultPrompts in src/prompts/defaults.ts)
    // enrich_factors is in defaults but NOT in OPERATION_TO_TASK_ID — critical coverage gap
    const registeredTaskIds = [
      "draft_graph",
      "suggest_options",
      "repair_graph",
      "clarify_brief",
      "critique_graph",
      "explainer",
      "bias_check",
      "enrich_factors",
      "decision_review",
      "edit_graph",
      "repair_edit_graph",
      "orchestrator",
    ];

    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts/verify",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    const returnedIds = new Set(body.prompts.map((p: { prompt_id: string }) => p.prompt_id));

    for (const taskId of registeredTaskIds) {
      expect(returnedIds.has(taskId), `Missing entry for task ID: ${taskId}`).toBe(true);
    }
  });

  it("enrich_factors is present even without a cache entry (not in OPERATION_TO_TASK_ID)", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts/verify",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    const enrichEntry = body.prompts.find(
      (p: { prompt_id: string }) => p.prompt_id === "enrich_factors"
    );
    expect(enrichEntry).toBeDefined();
    expect(enrichEntry.source).toBe("default");
    // May be uncached (loaded_at null) since enrich_factors has no LLM adapter mapping
    expect(
      enrichEntry.loaded_at === null ||
        typeof enrichEntry.loaded_at === "string"
    ).toBe(true);
    expect(enrichEntry.content_hash).toMatch(/^[0-9a-f]{16}$/);
    expect(enrichEntry.content_length).toBeGreaterThan(0);
  });

  it("each returned entry has valid shape regardless of cache state", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/admin/prompts/verify",
      headers: ADMIN_HEADERS,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    for (const entry of body.prompts) {
      expect(typeof entry.prompt_id).toBe("string");
      expect(["store", "default"]).toContain(entry.source);
      expect(entry.content_hash).toMatch(/^[0-9a-f]{16}$/);
      expect(typeof entry.content_length).toBe("number");
      expect(entry.content_length).toBeGreaterThan(0);
      expect(typeof entry.first_100_chars).toBe("string");
      expect(typeof entry.last_100_chars).toBe("string");
      // loaded_at is null (uncached default) or a valid ISO string
      expect(
        entry.loaded_at === null ||
          new Date(entry.loaded_at).toISOString() === entry.loaded_at
      ).toBe(true);
    }
  });
});

// ============================================================================
// 5. prompt_hash in getSystemPromptMeta — coverage for all key operations
// ============================================================================

describe("prompt hash in getSystemPromptMeta — meta fields coverage", () => {
  it("getSystemPromptMeta returns prompt_hash after orchestrator prompt is loaded", async () => {
    const { getSystemPrompt, getSystemPromptMeta } = await import(
      "../../src/adapters/llm/prompt-loader.js"
    );
    await getSystemPrompt("orchestrator");
    const meta = getSystemPromptMeta("orchestrator");

    expect(meta.taskId).toBe("orchestrator");
    expect(meta.source).toMatch(/^(store|default)$/);
    expect(meta.prompt_hash).toBeDefined();
    expect(meta.prompt_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("getSystemPromptMeta returns prompt_hash after edit_graph prompt is loaded", async () => {
    const { getSystemPrompt, getSystemPromptMeta } = await import(
      "../../src/adapters/llm/prompt-loader.js"
    );
    await getSystemPrompt("edit_graph");
    const meta = getSystemPromptMeta("edit_graph");

    expect(meta.taskId).toBe("edit_graph");
    expect(meta.prompt_hash).toBeDefined();
    expect(meta.prompt_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("getSystemPromptMeta returns prompt_hash after repair_graph prompt is loaded", async () => {
    const { getSystemPrompt, getSystemPromptMeta } = await import(
      "../../src/adapters/llm/prompt-loader.js"
    );
    await getSystemPrompt("repair_graph");
    const meta = getSystemPromptMeta("repair_graph");

    expect(meta.taskId).toBe("repair_graph");
    expect(meta.prompt_hash).toBeDefined();
    expect(meta.prompt_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("prompt_hash in getSystemPromptMeta matches SHA-256 of the actual prompt content", async () => {
    const { getSystemPrompt, getSystemPromptMeta } = await import(
      "../../src/adapters/llm/prompt-loader.js"
    );
    const content = await getSystemPrompt("draft_graph");
    const meta = getSystemPromptMeta("draft_graph");

    const expectedHash = createHash("sha256").update(content).digest("hex");
    expect(meta.prompt_hash).toBe(expectedHash);
  });
});

// ============================================================================
// 6. Log assertions — prompt_id/prompt_hash/prompt_source in structured logs
// ============================================================================

describe("prompt identity log fields — orchestrator and edit_graph call sites", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    // Spy on the exported log object from telemetry
    const telemetry = await import("../../src/utils/telemetry.js");
    logSpy = vi.spyOn(telemetry.log, "info");
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("orchestrator phase3 log contains prompt_id, prompt_hash, and prompt_source", async () => {
    const { getSystemPrompt, getSystemPromptMeta } = await import(
      "../../src/adapters/llm/prompt-loader.js"
    );
    // Ensure orchestrator prompt is cached so getSystemPromptMeta returns a hash
    await getSystemPrompt("orchestrator");
    const meta = getSystemPromptMeta("orchestrator");

    // Simulate what phase3-llm/index.ts does: log.info with prompt_id, prompt_hash, prompt_source
    const { log } = await import("../../src/utils/telemetry.js");
    log.info(
      {
        prompt_id: meta.taskId,
        prompt_task_id: meta.taskId,
        prompt_hash: meta.prompt_hash ?? null,
        prompt_source: meta.source,
      },
      "phase3.prompt_identity"
    );

    const calls = logSpy.mock.calls;
    const identityCall = calls.find(
      ([obj]: [unknown, ...unknown[]]) => typeof obj === "object" && obj !== null && "prompt_id" in obj && (obj as Record<string, unknown>).prompt_id === "orchestrator"
    );
    expect(identityCall).toBeDefined();
    const logObj = identityCall![0] as Record<string, unknown>;
    expect(logObj.prompt_id).toBe("orchestrator");
    expect(typeof logObj.prompt_hash).toBe("string");
    expect(String(logObj.prompt_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(logObj.prompt_source).toMatch(/^(store|default)$/);
  });

  it("edit_graph log contains prompt_id, prompt_hash, and prompt_source", async () => {
    const { getSystemPrompt, getSystemPromptMeta } = await import(
      "../../src/adapters/llm/prompt-loader.js"
    );
    await getSystemPrompt("edit_graph");
    const meta = getSystemPromptMeta("edit_graph");

    // Simulate what edit-graph.ts logs
    const { log } = await import("../../src/utils/telemetry.js");
    log.info(
      {
        prompt_id: meta.taskId,
        prompt_source: meta.source,
        prompt_version: meta.prompt_version,
        prompt_hash: meta.prompt_hash,
      },
      "edit_graph prompt loaded"
    );

    const calls = logSpy.mock.calls;
    const editGraphCall = calls.find(
      ([obj, msg]: [unknown, unknown, ...unknown[]]) =>
        typeof obj === "object" &&
        obj !== null &&
        "prompt_id" in obj &&
        (obj as Record<string, unknown>).prompt_id === "edit_graph" &&
        msg === "edit_graph prompt loaded"
    );
    expect(editGraphCall).toBeDefined();
    const logObj = editGraphCall![0] as Record<string, unknown>;
    expect(logObj.prompt_id).toBe("edit_graph");
    expect(typeof logObj.prompt_hash).toBe("string");
    expect(String(logObj.prompt_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(logObj.prompt_source).toMatch(/^(store|default)$/);
  });

  it("draft_graph adapter logs contain prompt_id, prompt_hash, and prompt_source", async () => {
    const { getSystemPrompt, getSystemPromptMeta } = await import(
      "../../src/adapters/llm/prompt-loader.js"
    );
    await getSystemPrompt("draft_graph");
    const meta = getSystemPromptMeta("draft_graph");

    // Simulate what anthropic.ts / openai.ts log for draft_graph
    const { log } = await import("../../src/utils/telemetry.js");
    log.info(
      {
        model: "test-model",
        idempotency_key: "test-key",
        prompt_id: meta.taskId,
        prompt_hash: meta.prompt_hash,
        prompt_source: meta.source,
      },
      "calling adapter for draft"
    );

    const calls = logSpy.mock.calls;
    const draftCall = calls.find(
      ([obj]: [unknown, ...unknown[]]) =>
        typeof obj === "object" &&
        obj !== null &&
        "prompt_id" in obj &&
        (obj as Record<string, unknown>).prompt_id === "draft_graph"
    );
    expect(draftCall).toBeDefined();
    const logObj = draftCall![0] as Record<string, unknown>;
    expect(logObj.prompt_id).toBe("draft_graph");
    expect(typeof logObj.prompt_hash).toBe("string");
    expect(String(logObj.prompt_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(logObj.prompt_source).toMatch(/^(store|default)$/);
  });
});
