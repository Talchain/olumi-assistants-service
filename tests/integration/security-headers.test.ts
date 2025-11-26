import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Fastify, { FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";

describe("Security headers integration", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify({ logger: false });

    // Register helmet with the same config as server.ts
    await app.register(helmet, {
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginOpenerPolicy: false,
      crossOriginResourcePolicy: { policy: "cross-origin" },
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
      },
    });

    app.get("/test", async () => {
      return { ok: true };
    });

    await app.listen({ port: 0 });
  });

  afterAll(async () => {
    await app.close();
  });

  describe("X-Content-Type-Options", () => {
    it("should set X-Content-Type-Options: nosniff", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-content-type-options"]).toBe("nosniff");
    });
  });

  describe("X-Frame-Options", () => {
    it("should set X-Frame-Options to prevent clickjacking", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-frame-options"]).toBe("SAMEORIGIN");
    });
  });

  describe("Strict-Transport-Security (HSTS)", () => {
    it("should set HSTS header with correct max-age", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      const hsts = response.headers["strict-transport-security"];
      expect(hsts).toContain("max-age=31536000");
      expect(hsts).toContain("includeSubDomains");
    });
  });

  describe("X-DNS-Prefetch-Control", () => {
    it("should set X-DNS-Prefetch-Control: off", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-dns-prefetch-control"]).toBe("off");
    });
  });

  describe("X-Download-Options", () => {
    it("should set X-Download-Options: noopen", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-download-options"]).toBe("noopen");
    });
  });

  describe("Cross-Origin-Resource-Policy", () => {
    it("should set Cross-Origin-Resource-Policy: cross-origin for API access", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    });
  });

  describe("Disabled headers for API", () => {
    it("should NOT set Content-Security-Policy (disabled for API)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["content-security-policy"]).toBeUndefined();
    });

    it("should NOT set Cross-Origin-Embedder-Policy (disabled for API)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cross-origin-embedder-policy"]).toBeUndefined();
    });

    it("should NOT set Cross-Origin-Opener-Policy (disabled for API)", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/test",
      });

      expect(response.statusCode).toBe(200);
      expect(response.headers["cross-origin-opener-policy"]).toBeUndefined();
    });
  });
});
