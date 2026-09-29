import { describe, it, expect } from "vitest";
import {
  redactGraphForShare,
  redactBrief,
  calculateRedactedSize,
  SHARE_SIZE_LIMITS,
} from "../../src/utils/share-redaction.js";
import type { GraphT } from "../../src/schemas/graph.js";

describe("share-redaction", () => {
  describe("redactGraphForShare()", () => {
    it("should preserve graph structure", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "q1", kind: "goal", label: "Should we launch?" },
          { id: "o1", kind: "option", label: "Yes", body: "Launch now" },
        ],
        edges: [{ from: "q1", to: "o1" }],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const redacted = redactGraphForShare(graph);

      expect(redacted.version).toBe("1");
      expect(redacted.nodes).toHaveLength(2);
      expect(redacted.edges).toHaveLength(1);
      expect(redacted.nodes[0].id).toBe("q1");
      expect(redacted.nodes[0].kind).toBe("goal");
    });

    it("should redact emails from labels", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "q1", kind: "goal", label: "Contact john@example.com" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const redacted = redactGraphForShare(graph);

      expect(redacted.nodes[0].label).toBe("Contact [EMAIL]");
    });

    it("should redact phone numbers", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "q1", kind: "goal", label: "Call 07123 456 789" },
          { id: "q2", kind: "goal", label: "US: (555) 123-4567" },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const redacted = redactGraphForShare(graph);

      expect(redacted.nodes[0].label).toBe("Call [PHONE]");
      expect(redacted.nodes[1].label).toBe("US: [PHONE]");
    });

    it("should redact potential API keys", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          {
            id: "q1",
            kind: "goal",
            label: "Key: sk_test_1234567890abcdefghijklmnopqrstuvwxyz",
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const redacted = redactGraphForShare(graph);

      expect(redacted.nodes[0].label).toBe("Key: [KEY]");
    });

    it("should redact hex tokens", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          {
            id: "q1",
            kind: "goal",
            label: "Token: 0123456789abcdef0123456789abcdef",
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const redacted = redactGraphForShare(graph);

      expect(redacted.nodes[0].label).toBe("Token: [TOKEN]");
    });

    it("should redact body fields", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          {
            id: "o1",
            kind: "option",
            label: "Contact",
            body: "Email alice@company.com for details",
          },
        ],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const redacted = redactGraphForShare(graph);

      expect(redacted.nodes[0].body).toBe("Email [EMAIL] for details");
    });

    it("should not modify graphs without PII", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [
          { id: "q1", kind: "goal", label: "Should we expand?" },
          { id: "o1", kind: "option", label: "Yes" },
          { id: "o2", kind: "option", label: "No" },
        ],
        edges: [
          { from: "q1", to: "o1" },
          { from: "q1", to: "o2" },
        ],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const redacted = redactGraphForShare(graph);

      expect(redacted).toEqual(graph);
    });
  });

  describe("redactBrief()", () => {
    it("should redact emails", () => {
      expect(redactBrief("Contact team@startup.io")).toBe("Contact [EMAIL]");
    });

    it("should redact multiple PII types", () => {
      const brief = "Call 07123456789 or email john@example.com with key sk_test_abc123";
      const redacted = redactBrief(brief);

      expect(redacted).toContain("[PHONE]");
      expect(redacted).toContain("[EMAIL]");
      expect(redacted).toContain("[KEY]");
    });
  });

  describe("calculateRedactedSize()", () => {
    it("should calculate size of redacted content", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "q1", kind: "goal", label: "Test" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const size = calculateRedactedSize(graph);

      expect(size).toBeGreaterThan(0);
      expect(size).toBeLessThan(1000); // Reasonable for small graph
    });

    it("should include brief in size calculation", () => {
      const graph: GraphT = {
        version: "1",
        default_seed: 17,
        nodes: [{ id: "q1", kind: "goal", label: "Test" }],
        edges: [],
        meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
      };

      const sizeWithoutBrief = calculateRedactedSize(graph);
      const sizeWithBrief = calculateRedactedSize(graph, "This is a brief description");

      expect(sizeWithBrief).toBeGreaterThan(sizeWithoutBrief);
    });
  });

  describe("SHARE_SIZE_LIMITS", () => {
    it("should export size limits", () => {
      expect(SHARE_SIZE_LIMITS.MAX_GRAPH_SIZE).toBe(50_000);
      expect(SHARE_SIZE_LIMITS.MAX_NODES).toBe(50);
      expect(SHARE_SIZE_LIMITS.MAX_EDGES).toBe(200);
    });
  });
});
