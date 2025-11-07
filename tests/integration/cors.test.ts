import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import cors from "@fastify/cors";

describe("CORS integration", () => {
  let app: FastifyInstance;

  const ALLOWED_ORIGINS = [
    "https://olumi.app",
    "http://localhost:5173",
    "http://localhost:3000",
  ];

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register CORS with strict allowlist
    await app.register(cors, {
      origin: ALLOWED_ORIGINS,
    });

    // Test endpoint
    app.get("/test", async () => {
      return { ok: true };
    });

    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("allowed origins", () => {
    it("should allow requests from https://olumi.app", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "https://olumi.app",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("https://olumi.app");
    });

    it("should allow requests from http://localhost:5173", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "http://localhost:5173",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    });

    it("should allow requests from http://localhost:3000", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "http://localhost:3000",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
    });
  });

  describe("blocked origins", () => {
    it("should block requests from unauthorized domains", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "https://evil.com",
        },
      });

      // Request succeeds but CORS headers are not set
      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should block requests from similar but different domains", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "https://olumi.app.evil.com",
        },
      });

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should block requests from http://olumi.app (not https)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "http://olumi.app",
        },
      });

      // Strict match: http != https
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should block requests from localhost on different ports", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "http://localhost:8080",
        },
      });

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("preflight requests", () => {
    it("should handle OPTIONS preflight for allowed origin", async () => {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/test",
        headers: {
          origin: "https://olumi.app",
          "access-control-request-method": "POST",
        },
      });

      expect(response.statusCode).toBe(204); // No Content
      expect(response.headers["access-control-allow-origin"]).toBe("https://olumi.app");
      expect(response.headers["access-control-allow-methods"]).toBeDefined();
    });

    it("should reject OPTIONS preflight for disallowed origin", async () => {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/test",
        headers: {
          origin: "https://evil.com",
          "access-control-request-method": "POST",
        },
      });

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("no origin header", () => {
    it("should handle requests without Origin header", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({ ok: true });
    });
  });

  describe("credentials", () => {
    it("should not include access-control-allow-credentials by default", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "https://olumi.app",
        },
      });

      // CORS plugin default: credentials not enabled
      expect(response.headers["access-control-allow-credentials"]).toBeUndefined();
    });
  });

  describe("CORS security", () => {
    it("should not allow wildcard origins", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "*",
        },
      });

      expect(response.headers["access-control-allow-origin"]).not.toBe("*");
    });

    it("should enforce exact origin matching (case-sensitive)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "https://OLUMI.APP", // Uppercase
        },
      });

      // Should NOT match (case-sensitive)
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });

    it("should reject origins with extra path segments", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
        headers: {
          origin: "https://olumi.app/evil",
        },
      });

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });

  describe("POST requests", () => {
    beforeAll(async () => {
      // Add POST endpoint to test
      app.post("/api/data", async (request) => {
        return { received: request.body };
      });
    });

    it("should allow POST from allowed origin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/data",
        headers: {
          origin: "https://olumi.app",
          "content-type": "application/json",
        },
        payload: { test: "data" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["access-control-allow-origin"]).toBe("https://olumi.app");
    });

    it("should block POST from disallowed origin", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/api/data",
        headers: {
          origin: "https://evil.com",
          "content-type": "application/json",
        },
        payload: { test: "data" },
      });

      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    });
  });
});
