import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  redactAttachments,
  redactCsvData,
  truncateQuotes,
  redactHeaders,
  safeLog,
  redactTelemetryEvent,
  redactLogMessage,
} from "../../src/utils/redaction.js";
import { asTestData } from "../helpers/test-types.js";

describe("redaction utilities", () => {
  describe("redactAttachments", () => {
    it("should redact base64 content with hash prefix", () => {
      const input = {
        attachments: [
          {
            filename: "test.pdf",
            mime_type: "application/pdf",
            content: "SGVsbG8gV29ybGQh", // "Hello World!" in base64
          },
        ],
      };

      const result = asTestData(redactAttachments(input));
      expect(result.attachments[0].content).toMatch(/^\[REDACTED\]:[a-f0-9]{8}$/);
      expect(result.attachments[0].filename).toBe("test.pdf");
      expect(result.attachments[0].mime_type).toBe("application/pdf");
    });

    it("should handle multiple attachments", () => {
      const input = {
        attachments: [
          { filename: "doc1.txt", content: "YWJjZGVm" },
          { filename: "doc2.txt", content: "Z2hpamtsbW5v" },
        ],
      };

      const result = asTestData(redactAttachments(input));
      expect(result.attachments).toHaveLength(2);
      expect(result.attachments[0].content).toMatch(/^\[REDACTED\]:/);
      expect(result.attachments[1].content).toMatch(/^\[REDACTED\]:/);
    });

    it("should preserve structure for non-attachment fields", () => {
      const input = {
        brief: "Test brief",
        other_field: "value",
        attachments: [{ filename: "test.txt", content: "base64data" }],
      };

      const result = asTestData(redactAttachments(input));
      expect(result.brief).toBe("Test brief");
      expect(result.other_field).toBe("value");
    });

    it("should handle missing attachments gracefully", () => {
      const input = { brief: "No attachments" };
      const result = asTestData(redactAttachments(input));
      expect(result).toEqual(input);
    });
  });

  describe("redactCsvData", () => {
    it("should remove rows field", () => {
      const input = {
        csv_data: {
          rows: [
            { name: "Alice", revenue: 10000 },
            { name: "Bob", revenue: 15000 },
          ],
          statistics: {
            revenue: { count: 2, mean: 12500 },
          },
        },
      };

      const result = asTestData(redactCsvData(input));
      expect(result.csv_data.rows).toBeUndefined();
      expect(result.csv_data.statistics).toBeDefined();
    });

    it("should keep safe statistics fields", () => {
      const input = {
        stats: {
          revenue: {
            count: 100,
            mean: 50000,
            median: 48000,
            p50: 48000,
            p90: 75000,
            p95: 85000,
            p99: 95000,
            min: 1000,
            max: 100000,
            std: 15000,
            variance: 225000000,
          },
        },
      };

      const result = asTestData(redactCsvData(input));
      expect(result.stats.revenue.count).toBe(100);
      expect(result.stats.revenue.mean).toBe(50000);
      expect(result.stats.revenue.p95).toBe(85000);
    });

    it("should remove unsafe fields (data, values, raw_data)", () => {
      const input = {
        analysis: {
          data: [1, 2, 3, 4, 5],
          values: ["a", "b", "c"],
          raw_data: "sensitive",
          count: 5,
        },
      };

      const result = asTestData(redactCsvData(input));
      expect(result.analysis.data).toBeUndefined();
      expect(result.analysis.values).toBeUndefined();
      expect(result.analysis.raw_data).toBeUndefined();
      expect(result.analysis.count).toBe(5);
    });

    it("should handle nested structures", () => {
      const input = {
        level1: {
          level2: {
            rows: ["should be removed"],
            count: 10,
          },
        },
      };

      const result = asTestData(redactCsvData(input));
      expect(result.level1.level2.rows).toBeUndefined();
      expect(result.level1.level2.count).toBe(10);
    });
  });

  describe("truncateQuotes", () => {
    it("should truncate quotes longer than 100 characters", () => {
      const longQuote = "a".repeat(150);
      const input = {
        citation: {
          quote: longQuote,
        },
      };

      const result = asTestData(truncateQuotes(input));
      expect(result.citation.quote).toHaveLength(103); // 100 + "..."
      expect(result.citation.quote).toMatch(/...$/);
    });

    it("should preserve quotes under 100 characters", () => {
      const shortQuote = "This is a short quote.";
      const input = {
        citation: {
          quote: shortQuote,
        },
      };

      const result = asTestData(truncateQuotes(input));
      expect(result.citation.quote).toBe(shortQuote);
    });

    it("should handle nested quote fields", () => {
      const input = {
        rationales: [
          { quote: "a".repeat(150) },
          { quote: "Short quote" },
          { quote: "b".repeat(200) },
        ],
      };

      const result = asTestData(truncateQuotes(input));
      expect(result.rationales[0].quote).toHaveLength(103);
      expect(result.rationales[0].quote).toMatch(/...$/);
      expect(result.rationales[1].quote).toBe("Short quote");
      expect(result.rationales[2].quote).toHaveLength(103);
    });

    it("should handle missing quote fields", () => {
      const input = {
        citation: {
          source: "document.pdf",
          location: "page 1",
        },
      };

      const result = asTestData(truncateQuotes(input));
      expect(result.citation.source).toBe("document.pdf");
      expect(result.citation.quote).toBeUndefined();
    });
  });

  describe("redactHeaders", () => {
    it("should remove authorization headers", () => {
      const headers = {
        authorization: "Bearer secret-token",
        "content-type": "application/json",
        "user-agent": "curl/7.68.0",
      };

      const result = asTestData(redactHeaders(headers));
      expect(result.authorization).toBeUndefined();
      expect(result["content-type"]).toBe("application/json");
      expect(result["user-agent"]).toBe("curl/7.68.0");
    });

    it("should remove x-api-key headers", () => {
      const headers = {
        "x-api-key": "secret-key-12345",
        "x-request-id": "req-123",
      };

      const result = asTestData(redactHeaders(headers));
      expect(result["x-api-key"]).toBeUndefined();
      expect(result["x-request-id"]).toBe("req-123");
    });

    it("should remove cookie headers", () => {
      const headers = {
        cookie: "session=abc123; user=admin",
        "set-cookie": "new_session=xyz789",
        accept: "application/json",
      };

      const result = asTestData(redactHeaders(headers));
      expect(result.cookie).toBeUndefined();
      expect(result["set-cookie"]).toBeUndefined();
      expect(result.accept).toBe("application/json");
    });
  });

  describe("safeLog", () => {
    it("should apply all redactions and add redacted flag", () => {
      const input = {
        request_id: "req-123",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: {
          brief: "Test brief",
          attachments: [
            {
              filename: "doc.pdf",
              content: "base64content",
            },
          ],
        },
        csv_data: {
          rows: [{ name: "Alice" }],
          statistics: { count: 1 },
        },
        rationales: [
          {
            quote: "a".repeat(150),
          },
        ],
      };

      const result = asTestData(safeLog(input));

      // Check redacted flag
      expect(result.redacted).toBe(true);

      // Check headers redacted
      expect(result.headers.authorization).toBeUndefined();

      // Check attachments redacted
      expect(result.body.attachments[0].content).toMatch(/^\[REDACTED\]:/);

      // Check CSV data redacted
      expect(result.csv_data.rows).toBeUndefined();
      expect(result.csv_data.statistics).toBeDefined();

      // Check quotes truncated
      expect(result.rationales[0].quote).toHaveLength(103);
    });

    it("should deep clone input to avoid mutations", () => {
      const input = {
        data: "original",
      };

      const result = asTestData(safeLog(input));
      result.data = "modified";

      // Original should be unchanged
      expect(input.data).toBe("original");
    });

    it("should handle null and undefined gracefully", () => {
      expect(safeLog(null)).toEqual({ redacted: true });
      expect(safeLog(undefined)).toEqual({ redacted: true });
    });

    it("should handle arrays at top level", () => {
      const input = [
        { quote: "a".repeat(150) },
        { quote: "Short" },
      ];

      const result = asTestData(safeLog(input));
      expect(Array.isArray(result)).toBe(true);
      expect(result[0].quote).toHaveLength(103);
      expect(result[1].quote).toBe("Short");
    });
  });

  describe("redactTelemetryEvent", () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should preserve object keys while redacting values", () => {
      const event = {
        event_type: "test.event",
        user_email: "john@example.com",
        phone: "555-123-4567",
        api_key: "sk_test_abc123",
        metadata: {
          contact: "alice@company.com",
        },
      };

      const result = asTestData(redactTelemetryEvent(event));

      // Keys should be preserved
      expect(result.event_type).toBeDefined();
      expect(result.user_email).toBeDefined();
      expect(result.phone).toBeDefined();
      expect(result.api_key).toBeDefined();
      expect(result.metadata).toBeDefined();
      expect(result.metadata.contact).toBeDefined();

      // Values should be redacted
      expect(result.user_email).toBe("[EMAIL]");
      expect(result.phone).toBe("[PHONE]");
      expect(result.api_key).toBe("[KEY]");
      expect(result.metadata.contact).toBe("[EMAIL]");
      expect(result.event_type).toBe("test.event"); // No PII, unchanged

      // Metadata should be added
      expect(result.pii_redacted).toBe(true);
      expect(result.redaction_mode).toBe("standard");
    });

    it("should handle strict mode", () => {
      vi.stubEnv("PII_REDACTION_MODE", "strict");

      const event = {
        event_type: "test.event",
        server_ip: "192.168.1.1",
        url: "https://example.com/path",
      };

      const result = asTestData(redactTelemetryEvent(event));

      // Strict mode should redact IPs and URLs
      expect(result.server_ip).toBe("[IP]");
      expect(result.url).toBe("[URL]");
      expect(result.redaction_mode).toBe("strict");
    });

    it("should skip redaction when mode is off", () => {
      vi.stubEnv("PII_REDACTION_MODE", "off");

      const event = {
        user_email: "john@example.com",
        phone: "555-123-4567",
      };

      const result = asTestData(redactTelemetryEvent(event));

      // No redaction should occur
      expect(result.user_email).toBe("john@example.com");
      expect(result.phone).toBe("555-123-4567");
      expect(result.pii_redacted).toBeUndefined();
      expect(result.redaction_mode).toBeUndefined();
    });

    it("should handle nested objects and arrays", () => {
      const event = {
        users: [
          { name: "Alice", email: "alice@company.com" },
          { name: "Bob", email: "bob@startup.io" },
        ],
        config: {
          admin: {
            email: "admin@example.com",
          },
        },
      };

      const result = asTestData(redactTelemetryEvent(event));

      // Structure preserved, values redacted
      expect(result.users).toHaveLength(2);
      expect(result.users[0].email).toBe("[EMAIL]");
      expect(result.users[1].email).toBe("[EMAIL]");
      expect(result.config.admin.email).toBe("[EMAIL]");
    });
  });

  describe("redactLogMessage", () => {
    beforeEach(() => {
      vi.unstubAllEnvs();
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("should redact PII from log messages", () => {
      const message = "User john@example.com called from 555-123-4567";
      const result = redactLogMessage(message);
      expect(result).toBe("User [EMAIL] called from [PHONE]");
    });

    it("should handle multiple PII types", () => {
      const message = "API key sk_test_abc123, email alice@company.com, token Bearer xyz789";
      const result = redactLogMessage(message);
      expect(result).toContain("[KEY]");
      expect(result).toContain("[EMAIL]");
      expect(result).toContain("Bearer [TOKEN]");
    });

    it("should respect redaction mode from environment", () => {
      vi.stubEnv("PII_REDACTION_MODE", "off");
      const message = "User john@example.com called";
      const result = redactLogMessage(message);
      expect(result).toBe(message); // No redaction
    });
  });
});
