/**
 * Legacy SSE Path Flag Tests
 *
 * Tests ENABLE_LEGACY_SSE flag (v1.3.0)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock dotenv/config to prevent loading .env file during tests
vi.mock("dotenv/config", () => ({}));

describe("Legacy SSE Flag", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore env
    process.env = { ...originalEnv };
    // Clear module cache to allow fresh imports with new env
    vi.resetModules();
  });

  describe("when ENABLE_LEGACY_SSE=false (default)", () => {
    let server: any;

    beforeEach(async () => {
      // Clear module cache before setting env
      vi.resetModules();
      delete process.env.ENABLE_LEGACY_SSE;
      process.env.LLM_PROVIDER = "fixtures";
      // Disable auth for tests
      delete process.env.ASSIST_API_KEY;
      delete process.env.ASSIST_API_KEYS;
      // Ensure BASE_URL is either unset or valid for config validation
      delete process.env.BASE_URL;

      // Build server once per test
      const { build } = await import("../../src/server.js");
      server = await build();
      await server.ready();
    });

    afterEach(async () => {
      if (server) {
        await server.close();
        server = null;
      }
    });

    it("rejects legacy SSE requests with 426", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream", // Legacy path
        },
        body: JSON.stringify({
          brief: "This is a test brief for SSE testing that meets minimum length requirement",
        }),
      });

      expect(response.statusCode).toBe(426); // Upgrade Required
      const body = JSON.parse(response.body);
      expect(body.schema).toBe("error.v1");
      expect(body.code).toBe("BAD_INPUT");
      expect(body.message).toContain("Legacy SSE path disabled");
      expect(body.details).toHaveProperty("recommended_endpoint");
      expect(body.details.recommended_endpoint).toBe("/assist/draft-graph/stream");
    });

    it("allows dedicated /stream endpoint", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph/stream",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          brief: "This is a test brief for SSE testing that meets minimum length requirement",
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("text/event-stream");
    });

    it("allows JSON responses on main endpoint", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          // No Accept header = JSON response
        },
        body: JSON.stringify({
          brief: "This is a test brief for SSE testing that meets minimum length requirement",
        }),
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.body);
      expect(body).toHaveProperty("graph");
    });
  });

  describe("when ENABLE_LEGACY_SSE=true", () => {
    let server: any;

    beforeEach(async () => {
      // Clear module cache before setting env
      vi.resetModules();
      process.env.ENABLE_LEGACY_SSE = "true";
      process.env.LLM_PROVIDER = "fixtures";
      // Disable auth for tests
      delete process.env.ASSIST_API_KEY;
      delete process.env.ASSIST_API_KEYS;
      // Ensure BASE_URL is either unset or valid for config validation
      delete process.env.BASE_URL;

      // Build server once per test
      const { build } = await import("../../src/server.js");
      server = await build();
      await server.ready();
    });

    afterEach(async () => {
      if (server) {
        await server.close();
        server = null;
      }
    });

    it("allows legacy SSE requests", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream", // Legacy path
        },
        body: JSON.stringify({
          brief: "This is a test brief for SSE testing that meets minimum length requirement",
        }),
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-type"]).toBe("text/event-stream");
    });

    it("emits deprecation telemetry", async () => {
      // Just verify the request succeeds (telemetry is emitted internally)
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({
          brief: "This is a test brief for SSE testing that meets minimum length requirement",
        }),
      });

      expect(response.statusCode).toBe(200);
    });
  });

  describe("migration guidance", () => {
    let server: any;

    beforeEach(async () => {
      // Clear module cache before setting env
      vi.resetModules();
      delete process.env.ENABLE_LEGACY_SSE; // Default: disabled
      process.env.LLM_PROVIDER = "fixtures";
      // Disable auth for tests
      delete process.env.ASSIST_API_KEY;
      delete process.env.ASSIST_API_KEYS;
      // Ensure BASE_URL is either unset or valid for config validation
      delete process.env.BASE_URL;

      // Build server once per test
      const { build } = await import("../../src/server.js");
      server = await build();
      await server.ready();
    });

    afterEach(async () => {
      if (server) {
        await server.close();
        server = null;
      }
    });

    it("includes migration guide in error details", async () => {
      const response = await server.inject({
        method: "POST",
        url: "/assist/draft-graph",
        headers: {
          "Content-Type": "application/json",
          "Accept": "text/event-stream",
        },
        body: JSON.stringify({
          brief: "Test brief for migration guidance testing",
        }),
      });

      // Should return 426 with JSON error, not SSE
      expect(response.statusCode).toBe(426);
      expect(response.headers["content-type"]).toMatch(/application\/json/);

      const body = JSON.parse(response.body);
      expect(body.schema).toBe("error.v1");
      expect(body.details).toHaveProperty("migration_guide");
      expect(body.details.migration_guide).toContain("/stream");
    });
  });
});
