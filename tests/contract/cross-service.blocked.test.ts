/**
 * Cross-Service Blocked Response Contract Tests
 *
 * PURPOSE:
 * These tests validate the **shape contract** that CEE blocked responses must satisfy
 * for safe consumption by downstream services (PLoT orchestration, UI rendering).
 * They do NOT test actual PLoT parsing logic — that's for integration tests in Stream C/D.
 * Instead, they verify that CEE produces responses matching the documented contract.
 *
 * WHAT THIS VALIDATES:
 * - CEE blocked responses from runStageBoundary match fixture contract
 * - JSON serialization safety (no circular refs, no undefined)
 * - Safe property access patterns (no undefined crashes)
 * - Required fields for PLoT orchestration (status, blockers, options)
 * - Required fields for UI rendering (graph, nodes, edges, meta)
 * - Canonical shape enforcement (graph: null explicit, never omitted)
 *
 * WHAT THIS DOES NOT VALIDATE:
 * - Actual PLoT parser logic (tested in PLoT integration tests)
 * - Downstream orchestration behavior (tested in Stream C/D)
 * - UI rendering logic (tested in frontend tests)
 *
 * Tests are organized into fixture-based contract tests (fast) and boundary output
 * validation (ensures actual CEE output conforms to fixture contract).
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

describe("Cross-Service Blocked Response Contract", () => {
  const fixturePath = join(__dirname, "../fixtures/cross-service/blocked-response.fixture.json");
  const fixture = JSON.parse(readFileSync(fixturePath, "utf-8"));
  const blockedResponse = fixture.cee_output;

  describe("JSON serialization safety", () => {
    it("serializes to valid JSON without errors", () => {
      let jsonString: string;
      expect(() => {
        jsonString = JSON.stringify(blockedResponse);
      }).not.toThrow();

      // Verify we can deserialize it back
      let parsed: any;
      expect(() => {
        parsed = JSON.parse(jsonString!);
      }).not.toThrow();

      expect(parsed).toBeDefined();
    });

    it("has no undefined values that would break JSON.stringify", () => {
      const jsonString = JSON.stringify(blockedResponse);
      // undefined values are omitted in JSON, so check they don't appear as "undefined" strings
      expect(jsonString).not.toContain('"undefined"');
      expect(jsonString).not.toContain(':undefined');
    });
  });

  describe("Safe property access (no undefined errors)", () => {
    it("allows safe status checking without crashes", () => {
      // Common downstream consumption patterns
      expect(() => {
        const isBlocked = blockedResponse?.analysis_ready?.status === "blocked";
        expect(isBlocked).toBe(true);
      }).not.toThrow();
    });

    it("allows safe blocker access without crashes", () => {
      expect(() => {
        const hasBlockers = Array.isArray(blockedResponse?.analysis_ready?.blockers) &&
          blockedResponse.analysis_ready.blockers.length > 0;
        expect(hasBlockers).toBe(true);
      }).not.toThrow();
    });

    it("allows safe graph access without crashes", () => {
      expect(() => {
        const hasGraph = blockedResponse?.graph !== null && blockedResponse?.graph !== undefined;
        expect(hasGraph).toBe(false); // Blocked responses have null graph
      }).not.toThrow();
    });

    it("allows safe meta access without crashes", () => {
      expect(() => {
        const source = blockedResponse?.meta?.source;
        expect(source).toBeDefined();
      }).not.toThrow();
    });
  });

  describe("Required fields for PLoT orchestration", () => {
    it("has analysis_ready.status field", () => {
      expect(blockedResponse.analysis_ready).toBeDefined();
      expect(blockedResponse.analysis_ready.status).toBe("blocked");
    });

    it("has analysis_ready.blockers array with at least one blocker", () => {
      expect(Array.isArray(blockedResponse.analysis_ready.blockers)).toBe(true);
      expect(blockedResponse.analysis_ready.blockers.length).toBeGreaterThan(0);
    });

    it("has blocker with required fields (code, severity, message)", () => {
      const blocker = blockedResponse.analysis_ready.blockers[0];
      expect(blocker.code).toBeDefined();
      expect(typeof blocker.code).toBe("string");
      expect(blocker.severity).toBeDefined();
      expect(blocker.severity).toBe("error");
      expect(blocker.message).toBeDefined();
      expect(typeof blocker.message).toBe("string");
    });

    it("has analysis_ready.goal_node_id field (may be empty string)", () => {
      expect(blockedResponse.analysis_ready.goal_node_id).toBeDefined();
      expect(typeof blockedResponse.analysis_ready.goal_node_id).toBe("string");
    });

    it("has analysis_ready.options array (empty for blocked)", () => {
      expect(Array.isArray(blockedResponse.analysis_ready.options)).toBe(true);
      expect(blockedResponse.analysis_ready.options).toEqual([]);
    });
  });

  describe("Required fields for UI rendering", () => {
    it("has graph field (null for blocked responses)", () => {
      expect(blockedResponse).toHaveProperty("graph");
      expect(blockedResponse.graph).toBeNull();
    });

    it("has nodes array (empty for blocked responses)", () => {
      expect(Array.isArray(blockedResponse.nodes)).toBe(true);
      expect(blockedResponse.nodes).toEqual([]);
    });

    it("has edges array (empty for blocked responses)", () => {
      expect(Array.isArray(blockedResponse.edges)).toBe(true);
      expect(blockedResponse.edges).toEqual([]);
    });

    it("has options array (empty for blocked responses)", () => {
      expect(Array.isArray(blockedResponse.options)).toBe(true);
      expect(blockedResponse.options).toEqual([]);
    });

    it("has meta object with source field", () => {
      expect(blockedResponse.meta).toBeDefined();
      expect(blockedResponse.meta.source).toBeDefined();
      expect(["assistant", "user", "imported"]).toContain(blockedResponse.meta.source);
    });

    it("has trace object for observability", () => {
      expect(blockedResponse.trace).toBeDefined();
      expect(blockedResponse.trace.request_id).toBeDefined();
    });
  });

  describe("Canonical shape enforcement", () => {
    it("returns graph: null explicitly (not omitted)", () => {
      // Verify graph is present in the object (not omitted)
      expect(Object.prototype.hasOwnProperty.call(blockedResponse, "graph")).toBe(true);
      // Verify it's explicitly null
      expect(blockedResponse.graph).toBeNull();
    });

    it("serializes graph: null to JSON (not omitted)", () => {
      const jsonString = JSON.stringify(blockedResponse);
      // Verify "graph":null appears in serialized JSON
      expect(jsonString).toContain('"graph":null');
    });
  });

  describe("Fixture assertions", () => {
    it("passes all fixture-defined assertions", () => {
      const { assertions } = fixture;

      // PLoT accepts this response
      expect(assertions.plot_accepts).toBe(true);

      // UI can safely serialize this response
      expect(assertions.ui_safe_serialization).toBe(true);

      // No undefined access errors
      expect(assertions.no_undefined_access).toBe(true);
    });
  });

  describe("Boundary output conforms to fixture contract", () => {
    it("runStageBoundary blocked output matches cross-service fixture contract", async () => {
      // This test validates that actual boundary stage output conforms to the
      // cross-service fixture contract, preventing regression in blocked response shape.

      // Dynamic import to avoid circular dependency
      const { runStageBoundary } = await import("../../src/cee/unified-pipeline/stages/boundary.js");

      // Create invalid V3 response to trigger blocked status
      const ctx: any = {
        requestId: "cross-service-contract-validation",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "999-invalid", kind: "goal", label: "Test" }, // Invalid: ID starts with number
            ],
            edges: [],
          },
          goal_node_id: "999-invalid",
          options: [],
          causal_claims: [],
          meta: { source: "assistant" },
        },
      };

      await runStageBoundary(ctx);

      const actualBlockedResponse = ctx.finalResponse;

      // Verify actual output matches fixture contract shape
      expect(actualBlockedResponse).toBeDefined();

      // Required fields for orchestration (PLoT)
      expect(actualBlockedResponse.analysis_ready?.status).toBe("blocked");
      expect(actualBlockedResponse.analysis_ready?.goal_node_id).toBeDefined();
      expect(typeof actualBlockedResponse.analysis_ready?.goal_node_id).toBe("string");
      expect(Array.isArray(actualBlockedResponse.analysis_ready?.options)).toBe(true);
      expect(actualBlockedResponse.analysis_ready?.options).toEqual([]);
      expect(Array.isArray(actualBlockedResponse.analysis_ready?.blockers)).toBe(true);
      expect(actualBlockedResponse.analysis_ready?.blockers.length).toBeGreaterThan(0);

      const blocker = actualBlockedResponse.analysis_ready?.blockers[0];
      expect(blocker?.code).toBeDefined();
      expect(typeof blocker?.code).toBe("string");
      expect(blocker?.severity).toBe("error");
      expect(blocker?.message).toBeDefined();
      expect(typeof blocker?.message).toBe("string");

      // Required fields for UI rendering
      expect(Object.prototype.hasOwnProperty.call(actualBlockedResponse, "graph")).toBe(true);
      expect(actualBlockedResponse.graph).toBeNull(); // CANONICAL: explicit null
      expect(Array.isArray(actualBlockedResponse.nodes)).toBe(true);
      expect(actualBlockedResponse.nodes).toEqual([]);
      expect(Array.isArray(actualBlockedResponse.edges)).toBe(true);
      expect(actualBlockedResponse.edges).toEqual([]);
      expect(actualBlockedResponse.meta).toBeDefined();
      expect(actualBlockedResponse.meta?.source).toBeDefined();

      // JSON serialization safety
      let jsonString: string;
      expect(() => {
        jsonString = JSON.stringify(actualBlockedResponse);
      }).not.toThrow();

      expect(jsonString!).toContain('"graph":null'); // Canonical shape in serialized JSON
      expect(jsonString!).not.toContain('"undefined"');
      expect(jsonString!).not.toContain(':undefined');

      // Safe property access (no crashes)
      expect(() => {
        const isBlocked = actualBlockedResponse?.analysis_ready?.status === "blocked";
        expect(isBlocked).toBe(true);
      }).not.toThrow();
    });
  });
});
