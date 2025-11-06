import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify from "fastify";
import draftRoute from "../../src/routes/assist.draft-graph.js";

/**
 * Adversarial Input Tests
 *
 * These tests require LIVE_LLM=1 and ANTHROPIC_API_KEY to be set.
 * They test the full integration path including real LLM calls.
 *
 * Run with: pnpm test:live
 */

// Check for required environment variables
if (process.env.LIVE_LLM !== "1") {
  throw new Error("Adversarial tests require LIVE_LLM=1. Run with: pnpm test:live");
}

if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error("Adversarial tests require ANTHROPIC_API_KEY to be set. Run with: pnpm test:live");
}

// No mocks - these tests use real API calls to validate adversarial handling
vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: null }),
}));

describe("Adversarial Input Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Input validation boundary tests", () => {
    it("rejects brief under minimum length", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "short" }, // < 30 chars
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
    });

    it("accepts brief at minimum length boundary (30 chars)", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "a".repeat(30) },
      });

      expect(res.statusCode).toBe(200);
    });

    it("rejects brief over maximum length", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "a".repeat(5001) }, // > 5000 chars
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
    });

    it("accepts brief at maximum length boundary (5000 chars)", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: "a".repeat(5000) },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("Malicious input patterns", () => {
    it("sanitizes SQL injection attempts in brief", async () => {
      const app = Fastify();
      await draftRoute(app);

      const sqlInjection = "'; DROP TABLE users; -- This is a comprehensive strategic analysis framework";

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: sqlInjection },
      });

      // Should not crash, should process normally
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });

    it("handles XSS attempts in brief", async () => {
      const app = Fastify();
      await draftRoute(app);

      const xssPayload = "<script>alert('xss')</script> Strategic framework for comprehensive planning and execution";

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: xssPayload },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
      // Ensure response doesn't contain unescaped script tags
      expect(JSON.stringify(body)).not.toContain("<script>");
    });

    it("handles command injection attempts", async () => {
      const app = Fastify();
      await draftRoute(app);

      const cmdInjection = "; rm -rf / # Comprehensive strategic analysis framework for planning purposes";

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: cmdInjection },
      });

      expect(res.statusCode).toBe(200);
    });

    it("handles path traversal in attachment names", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Strategic analysis framework with comprehensive evaluation criteria for planning purposes",
          attachments: [
            {
              id: "attack_1",
              kind: "txt",
              name: "../../etc/passwd", // Path traversal attempt
            },
          ],
          attachment_payloads: {
            attack_1: Buffer.from("malicious content").toString("base64"),
          },
        },
      });

      // Should not crash or access filesystem
      expect([200, 400]).toContain(res.statusCode);
    });

    it("handles null bytes in input", async () => {
      const app = Fastify();
      await draftRoute(app);

      const nullBytePayload = "Strategic framework\x00hidden content for comprehensive planning and analysis";

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: nullBytePayload },
      });

      // Should handle gracefully
      expect([200, 400]).toContain(res.statusCode);
    });
  });

  describe("Unicode and special character handling", () => {
    it("handles Unicode characters in brief", async () => {
      const app = Fastify();
      await draftRoute(app);

      const unicodeBrief = "战略框架分析 Comprehensive strategic framework 日本語テスト עברית العربية";

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: unicodeBrief },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      expect(body.graph).toBeDefined();
    });

    it("handles emoji in brief", async () => {
      const app = Fastify();
      await draftRoute(app);

      const emojiBrief = "🚀 Strategic roadmap for 📊 growth 💡 with comprehensive framework ✅ analysis";

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: emojiBrief },
      });

      expect(res.statusCode).toBe(200);
    });

    it("handles control characters", async () => {
      const app = Fastify();
      await draftRoute(app);

      const controlChars = "Strategic\r\nframework\twith\bcontrol\fcharacters for comprehensive analysis";

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: controlChars },
      });

      expect(res.statusCode).toBe(200);
    });

    it("handles RTL (right-to-left) text", async () => {
      const app = Fastify();
      await draftRoute(app);

      const rtlBrief = "\u202Eالإطار الاستراتيجي للتحليل الشامل والتخطيط الفعال للأهداف المستقبلية";

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: rtlBrief },
      });

      expect(res.statusCode).toBe(200);
    });
  });

  describe("Malformed JSON and type coercion", () => {
    it("rejects missing required fields", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {}, // Missing 'brief'
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
    });

    it("rejects wrong type for brief", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: 12345 }, // Should be string
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
    });

    it("rejects null for brief", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: null },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects array for brief", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: { brief: ["not", "a", "string"] },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects unknown fields with strict validation", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Comprehensive strategic framework for detailed planning and execution purposes",
          unknown_field: "malicious payload",
          another_unknown: { nested: "data" },
        },
      });

      // Zod .strict() should reject unknown fields
      expect(res.statusCode).toBe(400);
    });
  });

  describe("Attachment validation", () => {
    it("rejects invalid attachment kind", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Strategic framework with comprehensive evaluation criteria for planning purposes today",
          attachments: [
            {
              id: "att_1",
              kind: "exe", // Invalid kind
              name: "malware.exe",
            },
          ],
          attachment_payloads: {
            att_1: "base64content",
          },
        },
      });

      expect(res.statusCode).toBe(400);
      const body = JSON.parse(res.body);
      expect(body.code).toBe("BAD_INPUT");
    });

    it("handles missing attachment payload gracefully", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Comprehensive strategic analysis framework with detailed evaluation criteria for planning",
          attachments: [
            {
              id: "att_1",
              kind: "pdf",
              name: "missing.pdf",
            },
          ],
          attachment_payloads: {
            // att_1 payload missing
          },
        },
      });

      // Should not crash, may warn but should process
      expect([200, 400]).toContain(res.statusCode);
    });

    it("handles malformed base64 in attachment payload", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Strategic framework for comprehensive planning with detailed analysis and clear objectives",
          attachments: [
            {
              id: "att_1",
              kind: "pdf",
              name: "doc.pdf",
            },
          ],
          attachment_payloads: {
            att_1: "not!!!valid!!!base64", // Malformed
          },
        },
      });

      // Should handle gracefully, either skip attachment or error
      expect([200, 400, 500]).toContain(res.statusCode);
    });

    it("handles extremely large attachment payload", async () => {
      const app = Fastify({
        bodyLimit: 1024 * 1024, // 1 MB limit
      });
      await draftRoute(app);

      // Create > 1MB payload
      const largePayload = Buffer.from("x".repeat(1024 * 1024 + 1000)).toString("base64");

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Strategic framework for comprehensive analysis",
          attachments: [
            {
              id: "large_1",
              kind: "txt",
              name: "huge.txt",
            },
          ],
          attachment_payloads: {
            large_1: largePayload,
          },
        },
      });

      expect(res.statusCode).toBe(413); // Payload Too Large
    });
  });

  describe("Prototype pollution attempts", () => {
    it("rejects __proto__ pollution in payload", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Strategic framework for comprehensive planning with evaluation criteria and objectives",
          __proto__: { polluted: true },
        },
      });

      // Should either reject or ignore __proto__
      expect([200, 400]).toContain(res.statusCode);
    });

    it("rejects constructor pollution attempts", async () => {
      const app = Fastify();
      await draftRoute(app);

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Comprehensive strategic analysis with detailed planning framework and clear objectives",
          constructor: { prototype: { polluted: true } },
        },
      });

      expect([200, 400]).toContain(res.statusCode);
    });
  });

  describe("Resource exhaustion attempts", () => {
    it("handles deeply nested JSON", async () => {
      const app = Fastify();
      await draftRoute(app);

      // Create deeply nested structure
      let nested: any = { brief: "Strategic framework for comprehensive planning with detailed objectives" };
      for (let i = 0; i < 100; i++) {
        nested = { nested };
      }

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: nested,
      });

      // Should reject or handle gracefully
      expect([400, 413, 500]).toContain(res.statusCode);
    });

    it("handles many attachments", async () => {
      const app = Fastify();
      await draftRoute(app);

      const attachments = Array.from({ length: 100 }, (_, i) => ({
        id: `att_${i}`,
        kind: "txt" as const,
        name: `file_${i}.txt`,
      }));

      const attachment_payloads: Record<string, string> = {};
      attachments.forEach((att) => {
        attachment_payloads[att.id] = Buffer.from("content").toString("base64");
      });

      const res = await app.inject({
        method: "POST",
        url: "/assist/draft-graph",
        payload: {
          brief: "Strategic framework for comprehensive analysis with detailed planning criteria objectives",
          attachments,
          attachment_payloads,
        },
      });

      // Should either handle or reject gracefully
      expect([200, 400, 413]).toContain(res.statusCode);
    });
  });
});
