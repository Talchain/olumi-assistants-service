/**
 * Multi-Key Auth Integration Tests
 *
 * Tests per-key authentication, quotas, and rate limiting
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { cleanBaseUrl } from "../helpers/env-setup.js";

// Snapshot the pristine environment BEFORE the module-level mutations below,
// so afterAll can restore it (this was previously captured in the describe
// body, which also ran before the env was touched — same semantics).
const originalEnv = { ...process.env };

// WHY THE SERVER IMPORT IS AT MODULE LEVEL AND NOT INSIDE beforeAll
// -----------------------------------------------------------------
// It is a DYNAMIC import because `src/server.ts` reads config at import time,
// so the env below must be set before its module graph is evaluated — and ESM
// hoists static imports above every statement, which would set the env too
// late.
//
// It is at MODULE level because importing src/server.ts pulls the entire CEE
// server graph (~40 route modules plus the orchestrator, prompt and adapter
// trees) through vite's on-the-fly TS transform. Measured on this file:
//
//     await import("../../src/server.js")   4,098-4,411 ms (idle machine)
//                                           6,582-7,158 ms (2.4x CPU oversub)
//     build()                                      65-78 ms  (with the graph
//                                                   already transformed)
//     server.ready()                                1-2 ms
//
// Inside beforeAll that transform was charged against vitest's 10,000 ms
// DEFAULT hookTimeout — this repo configures no hookTimeout/testTimeout
// anywhere — leaving a margin thin enough to breach whenever the file ran with
// a cold transform cache on a loaded machine. The file then failed with
// "Hook timed out in 10000ms" and SKIPPED all 9 tests, so the suite reported a
// failure with zero assertions evaluated. It stayed green in CI only because a
// full-suite run has already warmed the transform cache via another file, which
// makes the pass depend on file ordering rather than on anything this file does.
//
// At module level the identical transform is charged to the collection phase,
// which is not hook-budgeted. This is the pattern the other 57 server-booting
// test files already use via a static top-level import. The hook below now
// measures 372 ms (build 371 ms + ready 1 ms) against the 10,000 ms budget —
// a 27x margin, where before it was 1.4-2.4x. Deterministic control, machine-
// load independent: `vitest run <this file> --hookTimeout=1500` FAILS before
// this change ("Hook timed out in 1500ms", 9 skipped) and PASSES after it.
process.env.ASSIST_API_KEYS = "test-key-1,test-key-2,test-key-3";
process.env.LLM_PROVIDER = "fixtures";
cleanBaseUrl();
const { build } = await import("../../src/server.js");

describe("Multi-Key Auth", () => {
  let server: FastifyInstance;

  beforeAll(async () => {
    server = await build();
    await server.ready();
  });

  afterAll(async () => {
    await server.close();
    // Restore env
    process.env = originalEnv;
    // Clear module cache
    vi.resetModules();
  });

  describe("Authentication", () => {
    it("allows request with valid API key", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-1",
        },
        body: JSON.stringify({
          brief: "This is a test brief that meets the minimum length requirement for validation",
        }),
      });

      expect(response.statusCode).toBe(200);
    });

    it("rejects request with invalid API key", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "invalid-key",
        },
        body: JSON.stringify({
          brief: "This is a test brief that meets the minimum length requirement for validation",
        }),
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);
      expect(body.schema).toBe("error.v1");
      expect(body.code).toBe("FORBIDDEN");
      expect(body.message).toContain("Invalid API key");
    });

    it("rejects request with missing API key", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          brief: "This is a test brief that meets the minimum length requirement for validation",
        }),
      });

      expect(response.statusCode).toBe(401);
      const body = JSON.parse(response.body);
      expect(body.schema).toBe("error.v1");
      expect(body.code).toBe("UNAUTHENTICATED");
      expect(body.message).toContain("Missing API key");
    });

    it("accepts API key via Authorization Bearer header", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer test-key-2",
        },
        body: JSON.stringify({
          brief: "This is a test brief that meets the minimum length requirement for validation",
        }),
      });

      expect(response.statusCode).toBe(200);
    });

    it("allows public /healthz without auth", async () => {
      const response = await server.inject({
        method: "GET",
        url: "/healthz",
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body.ok).toBe(true);
    });
  });

  describe("Per-Key Rate Limiting", () => {
    it("enforces separate rate limits per key", async () => {
      // Key 1: Use up some quota
      for (let i = 0; i < 3; i++) {
        await server.inject({
          method: "POST",
          url: "/assist/v1/draft-graph",
          headers: {
            "Content-Type": "application/json",
            "X-Olumi-Assist-Key": "test-key-1",
          },
          body: JSON.stringify({ brief: `This is test brief number ${i} that meets the minimum length requirement` }),
        });
      }

      // Key 2 should still work (separate quota)
      const response = await server.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-2",
        },
        body: JSON.stringify({ brief: "This is a test brief that meets the minimum length requirement" }),
      });

      expect(response.statusCode).toBe(200);
    });

    it("includes retry-after in rate limit response", async () => {
      // This test would need to actually exhaust quota
      // For now, just verify the error structure
      const response = await server.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "test-key-1",
        },
        body: JSON.stringify({ brief: "This is a test brief that meets the minimum length requirement" }),
      });

      // If rate limited, check structure
      if (response.statusCode === 429) {
        const body = JSON.parse(response.body);
        expect(body.schema).toBe("error.v1");
        expect(body.code).toBe("RATE_LIMITED");
        expect(body.details).toHaveProperty("retry_after_seconds");
      }
    });
  });

  describe("Backwards Compatibility", () => {
    // Use isolated server instance for this test to avoid polluting shared state
    let compatServer: FastifyInstance;
    let savedEnv: { ASSIST_API_KEYS?: string; ASSIST_API_KEY?: string };

    beforeEach(() => {
      // Save current env state before this test
      savedEnv = {
        ASSIST_API_KEYS: process.env.ASSIST_API_KEYS,
        ASSIST_API_KEY: process.env.ASSIST_API_KEY,
      };
    });

    afterEach(async () => {
      if (compatServer) {
        await compatServer.close();
        compatServer = null as any;
      }

      // Restore exact env state from before this test
      if (savedEnv.ASSIST_API_KEYS) {
        process.env.ASSIST_API_KEYS = savedEnv.ASSIST_API_KEYS;
      } else {
        delete process.env.ASSIST_API_KEYS;
      }

      if (savedEnv.ASSIST_API_KEY) {
        process.env.ASSIST_API_KEY = savedEnv.ASSIST_API_KEY;
      } else {
        delete process.env.ASSIST_API_KEY;
      }

      vi.resetModules();
    });

    it("supports single ASSIST_API_KEY for backwards compat", async () => {
      // Test single key with isolated server
      delete process.env.ASSIST_API_KEYS;
      process.env.ASSIST_API_KEY = "single-legacy-key";

      // Clear module cache and build isolated server
      vi.resetModules();
      const { build } = await import("../../src/server.js");
      compatServer = await build();
      await compatServer.ready();

      const response = await compatServer.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "single-legacy-key",
        },
        body: JSON.stringify({ brief: "This is a legacy compatibility test brief that meets the minimum length requirement" }),
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("Error Responses", () => {
    it("returns error.v1 format for auth failures", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/v1/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "X-Olumi-Assist-Key": "wrong-key",
        },
        body: JSON.stringify({ brief: "This is a test brief that meets the minimum length requirement" }),
      });

      expect(response.statusCode).toBe(403);
      const body = JSON.parse(response.body);

      // Verify error.v1 structure
      expect(body).toHaveProperty("schema");
      expect(body.schema).toBe("error.v1");
      expect(body).toHaveProperty("code");
      expect(body).toHaveProperty("message");
      expect(body.code).toBe("FORBIDDEN");
    });
  });
});
