import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  redactPII,
  redactObject,
  detectPII,
  getRedactionMode,
  type PIIGuardConfig,
} from "../../src/utils/pii-guard.js";

describe("PII Guard", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  describe("redactPII()", () => {
    describe("standard mode", () => {
      const config: PIIGuardConfig = { mode: "standard" };

      it("should redact email addresses", () => {
        const text = "Contact john.doe@example.com for details";
        expect(redactPII(text, config)).toBe("Contact [EMAIL] for details");
      });

      it("should redact multiple emails", () => {
        const text = "Email alice@company.com or bob@startup.io";
        const redacted = redactPII(text, config);
        expect(redacted).toBe("Email [EMAIL] or [EMAIL]");
      });

      it("should redact US phone numbers", () => {
        const text = "Call (555) 123-4567 or 555-987-6543";
        const redacted = redactPII(text, config);
        expect(redacted).toContain("[PHONE]");
      });

      it("should redact UK phone numbers", () => {
        const text = "UK mobile: 07123 456 789";
        expect(redactPII(text, config)).toBe("UK mobile: [PHONE]");
      });

      it("should redact API keys", () => {
        const text = "Use key sk_test_1234567890abcdef";
        expect(redactPII(text, config)).toBe("Use key [KEY]");
      });

      it("should redact bearer tokens", () => {
        const text = "Authorization: Bearer abc123def456";
        expect(redactPII(text, config)).toBe("Authorization: Bearer [TOKEN]");
      });

      it("should redact JWTs", () => {
        const text = "Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJhZG1pbiJ9.wP9Hv_3VGuqPr3DW4Taz8yqbLe1JDrIgIKDO";
        const redacted = redactPII(text, config);
        expect(redacted).toBe("Token: [JWT]");
      });

      it("should redact long hex tokens", () => {
        const text = "Session: 0123456789abcdef0123456789abcdef";
        expect(redactPII(text, config)).toBe("Session: [TOKEN]");
      });

      it("should redact credit card numbers", () => {
        const text = "Card: 4532 1234 5678 9010";
        expect(redactPII(text, config)).toBe("Card: [CARD]");
      });

      it("should redact SSNs", () => {
        const text = "SSN: 123-45-6789";
        expect(redactPII(text, config)).toBe("SSN: [SSN]");
      });

      it("should redact URLs with auth", () => {
        const text = "Connect to https://user:pass@api.example.com";
        expect(redactPII(text, config)).toBe("Connect to [URL_WITH_AUTH]");
      });

      it("should not redact regular URLs in standard mode", () => {
        const text = "Visit https://example.com for info";
        expect(redactPII(text, config)).toBe(text);
      });

      it("should not redact IP addresses in standard mode", () => {
        const text = "Server at 192.168.1.1";
        expect(redactPII(text, config)).toBe(text);
      });

      it("should handle text with no PII", () => {
        const text = "This is a normal sentence with no sensitive data.";
        expect(redactPII(text, config)).toBe(text);
      });

      it("should handle multiple PII types", () => {
        const text = "Email john@example.com, call 555-123-4567, key sk_test_abc123";
        const redacted = redactPII(text, config);
        expect(redacted).toContain("[EMAIL]");
        expect(redacted).toContain("[PHONE]");
        expect(redacted).toContain("[KEY]");
      });
    });

    describe("strict mode", () => {
      const config: PIIGuardConfig = { mode: "strict" };

      it("should redact all URLs", () => {
        const text = "Visit https://example.com/path?query=value";
        expect(redactPII(text, config)).toBe("Visit [URL]");
      });

      it("should redact IP addresses", () => {
        const text = "Server at 192.168.1.1 and 10.0.0.1";
        const redacted = redactPII(text, config);
        expect(redacted).toBe("Server at [IP] and [IP]");
      });

      it("should redact file paths", () => {
        const text = "Log at /var/log/app.log or C:\\Users\\John\\file.txt";
        const redacted = redactPII(text, config);
        expect(redacted).toContain("[PATH]");
      });

      it("should redact potential names", () => {
        const text = "I met John Smith and Jane Doe yesterday";
        const redacted = redactPII(text, config);
        expect(redacted).toContain("[NAME]");
        expect(redacted.split("[NAME]").length - 1).toBe(2); // Should have 2 name redactions
      });

      it("should NOT redact technical class names", () => {
        const text = "The UserController and DataProvider handle requests";
        const redacted = redactPII(text, config);
        // Should not redact class-like patterns ending with common suffixes
        expect(redacted).toBe(text);
      });

      it("should redact actual person names but not technical terms", () => {
        const text = "Contact Alice Johnson, not the DataProvider class";
        const redacted = redactPII(text, config);
        // Should redact "Alice Johnson" but not "DataProvider"
        expect(redacted).toContain("[NAME]");
        expect(redacted).toContain("DataProvider");
      });

      it("should apply all standard redactions", () => {
        const text = "Email alice@company.com, call 555-123-4567";
        const redacted = redactPII(text, config);
        expect(redacted).toContain("[EMAIL]");
        expect(redacted).toContain("[PHONE]");
      });
    });

    describe("off mode", () => {
      const config: PIIGuardConfig = { mode: "off" };

      it("should not redact any PII", () => {
        const text = "Email john@example.com, call 555-1234, key sk_test_abc";
        expect(redactPII(text, config)).toBe(text);
      });
    });
  });

  describe("redactObject()", () => {
    const config: PIIGuardConfig = { mode: "standard" };

    it("should redact strings", () => {
      const obj = "Email: john@example.com";
      expect(redactObject(obj, config)).toBe("Email: [EMAIL]");
    });

    it("should preserve numbers and booleans", () => {
      expect(redactObject(42, config)).toBe(42);
      expect(redactObject(true, config)).toBe(true);
    });

    it("should handle null and undefined", () => {
      expect(redactObject(null, config)).toBe(null);
      expect(redactObject(undefined, config)).toBe(undefined);
    });

    it("should redact arrays", () => {
      const arr = ["john@example.com", "Call 555-123-4567", "Normal text"];
      const redacted = redactObject(arr, config);
      expect(redacted).toEqual(["[EMAIL]", "Call [PHONE]", "Normal text"]);
    });

    it("should redact nested objects", () => {
      const obj = {
        user: {
          email: "alice@company.com",
          phone: "555-123-4567",
          name: "Alice",
        },
        metadata: {
          key: "sk_test_abc123",
        },
      };

      const redacted = redactObject(obj, config);
      expect(redacted.user.email).toBe("[EMAIL]");
      expect(redacted.user.phone).toBe("[PHONE]");
      expect(redacted.metadata.key).toBe("[KEY]");
    });

    it("should preserve object keys by default", () => {
      const obj = {
        "user@example.com": "value",
        "normalKey": "john@example.com",
      };

      const redacted = redactObject(obj, config) as Record<string, string>;
      expect(redacted["user@example.com"]).toBe("value");
      expect(redacted["normalKey"]).toBe("[EMAIL]");
    });

    it("should redact object keys when explicitly enabled", () => {
      const obj = {
        "user@example.com": "value",
        "normalKey": "john@example.com",
      };

      const redacted = redactObject(obj, { ...config, redactKeys: true }) as Record<string, string>;
      expect(redacted["[EMAIL]"]).toBe("value");
      expect(redacted["normalKey"]).toBe("[EMAIL]");
    });

    it("should handle deeply nested structures", () => {
      const obj = {
        level1: {
          level2: {
            level3: {
              secret: "sk_test_abc123",
              email: "deep@nested.com",
            },
          },
        },
      };

      const redacted = redactObject(obj, config);
      expect(redacted.level1.level2.level3.secret).toBe("[KEY]");
      expect(redacted.level1.level2.level3.email).toBe("[EMAIL]");
    });

    it("should not modify with off mode", () => {
      const obj = { email: "john@example.com", phone: "555-1234" };
      const redacted = redactObject(obj, { mode: "off" });
      expect(redacted).toEqual(obj);
    });
  });

  describe("detectPII()", () => {
    const config: PIIGuardConfig = { mode: "standard" };

    it("should detect emails", () => {
      const text = "Contact john@example.com for help";
      const matches = detectPII(text, config);
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("email");
      expect(matches[0].original).toBe("john@example.com");
      expect(matches[0].redacted).toBe("[EMAIL]");
    });

    it("should detect bearer tokens", () => {
      const text = "Authorization: Bearer abc123def456";
      const matches = detectPII(text, config);
      expect(matches).toHaveLength(1);
      expect(matches[0].type).toBe("bearer_token");
      expect(matches[0].original).toContain("Bearer");
      expect(matches[0].redacted).toBe("Bearer [TOKEN]");
    });

    it("should detect URLs with authentication", () => {
      const text = "Connect to https://user:pass@api.example.com";
      const matches = detectPII(text, config);
      expect(matches.length).toBeGreaterThanOrEqual(1);
      const urlWithAuthMatch = matches.find((m) => m.type === "url_with_auth");
      expect(urlWithAuthMatch).toBeDefined();
      expect(urlWithAuthMatch?.redacted).toBe("[URL_WITH_AUTH]");
    });

    it("should detect multiple PII types", () => {
      const text = "Email alice@company.com, call 555-123-4567, key sk_test_abc123";
      const matches = detectPII(text, config);
      expect(matches.length).toBeGreaterThanOrEqual(3);

      const types = matches.map((m) => m.type);
      expect(types).toContain("email");
      expect(types).toContain("phone");
      expect(types).toContain("api_key");
    });

    it("should include position information", () => {
      const text = "Email: john@example.com";
      const matches = detectPII(text, config);
      expect(matches[0].start).toBe(7);
      expect(matches[0].end).toBe(23); // start + length (16 chars)
    });

    it("should return empty array for clean text", () => {
      const text = "This is a normal sentence";
      expect(detectPII(text, config)).toEqual([]);
    });

    it("should detect more patterns in strict mode", () => {
      const text = "Visit https://example.com at 192.168.1.1";
      const standardMatches = detectPII(text, { mode: "standard" });
      const strictMatches = detectPII(text, { mode: "strict" });
      expect(strictMatches.length).toBeGreaterThan(standardMatches.length);
    });

    it("should return empty array in off mode", () => {
      const text = "Email john@example.com, call 555-1234";
      expect(detectPII(text, { mode: "off" })).toEqual([]);
    });
  });

  describe("getRedactionMode()", () => {
    it("should return standard by default", () => {
      expect(getRedactionMode()).toBe("standard");
    });

    it("should read from PII_REDACTION_MODE env var", () => {
      vi.stubEnv("PII_REDACTION_MODE", "strict");
      expect(getRedactionMode()).toBe("strict");
    });

    it("should handle off mode", () => {
      vi.stubEnv("PII_REDACTION_MODE", "off");
      expect(getRedactionMode()).toBe("off");
    });

    it("should default to standard for invalid values", () => {
      vi.stubEnv("PII_REDACTION_MODE", "invalid");
      expect(getRedactionMode()).toBe("standard");
    });

    it("should be case insensitive", () => {
      vi.stubEnv("PII_REDACTION_MODE", "STRICT");
      expect(getRedactionMode()).toBe("strict");
    });
  });
});
