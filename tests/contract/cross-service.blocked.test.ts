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

import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import * as ceeV3Schema from "../../src/schemas/cee-v3.js";
import { ZodError, ZodIssue } from "zod";

// v5-maintenance: same superseded soft-gate contract as
// tests/integration/blocked-response.contract.test.ts. runStageBoundary
// now fails closed on V3 validation errors (502 earlyReturn) rather than
// populating ctx.finalResponse with a degraded flag.
// TODO: ISSUE-9001 — v5-maintenance: superseded by fail-closed migration
describe.skip("Cross-Service Blocked Response Contract [v5-maintenance: superseded by fail-closed]", () => {
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

      // Mock V3 schema validation to fail (IDs like "999-invalid" are valid
      // after canonical regex relaxation in be2f0945)
      const fakeIssues: ZodIssue[] = [
        { code: "custom", path: ["nodes", 0, "id"], message: "Simulated V3 validation failure" },
      ];
      const parseSpy = vi.spyOn(ceeV3Schema.CEEGraphResponseV3, "safeParse").mockReturnValue({
        success: false,
        error: new ZodError(fakeIssues),
      } as any);

      // Dynamic import to avoid circular dependency
      const { runStageBoundary } = await import("../../src/cee/unified-pipeline/stages/boundary.js");

      const ctx: any = {
        requestId: "cross-service-contract-validation",
        input: { brief: "Test brief" },
        opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
        ceeResponse: {
          graph: {
            nodes: [
              { id: "goal_1", kind: "goal", label: "Test" },
            ],
            edges: [],
          },
          goal_node_id: "goal_1",
          options: [],
          causal_claims: [],
          meta: { source: "assistant" },
        },
        pipelineOutcome: {
          graph_drafted: false,
          graph_structurally_valid: false,
          deterministic_sweep_violations: 0,
          verification_status: 'skipped',
          validation_status: 'skipped',
          enrichment_status: 'skipped',
          coaching_status: 'partial',
          warnings: [],
          rescue_score: 0,
          factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
          edge_strength_unique_count: 0,
          llm_repair: { triggered: false, outcome: 'skipped', fallback_reason: null, attempts: 0 },
          repair_provenance: [],
        },
      };

      await runStageBoundary(ctx);

      const actualResponse = ctx.finalResponse;

      // Verify actual output — soft gate (Track 1) preserves graph
      expect(actualResponse).toBeDefined();

      // Soft gate: graph data passes through, degradation warning recorded
      expect(ctx.pipelineOutcome.warnings.length).toBeGreaterThan(0);
      expect(ctx.pipelineOutcome.warnings[0].stage).toBe("boundary_v3_validation");
      expect(ctx.pipelineOutcome.warnings[0].degraded).toBe(true);

      // Required fields for orchestration (PLoT) — soft gate preserves graph
      expect(actualResponse.analysis_ready).toBeDefined();
      expect(actualResponse.analysis_ready?.status).not.toBe("blocked");
      expect(actualResponse.analysis_ready?.goal_node_id).toBeDefined();
      expect(typeof actualResponse.analysis_ready?.goal_node_id).toBe("string");

      // Response is defined (V3 transform produces its own structure)
      expect(actualResponse).toBeDefined();

      // JSON serialization safety
      let jsonString: string;
      expect(() => {
        jsonString = JSON.stringify(actualResponse);
      }).not.toThrow();

      expect(jsonString!).not.toContain('"undefined"');
      expect(jsonString!).not.toContain(':undefined');

      // Safe property access (no crashes)
      expect(() => {
        const _status = actualResponse?.analysis_ready?.status;
      }).not.toThrow();

      parseSpy.mockRestore();
    });
  });
});

// v5-maintenance regression: replace-in-kind coverage for the current
// fail-closed cross-service contract. The superseded soft-gate tests
// above are kept as archive; these tests guard the live 502 +
// CEE_EGRESS_CONTRACT_VIOLATION shape that downstream services (PLoT,
// UI) must consume. If the fail-closed envelope shape drifts
// (reason, error code, details.boundary/validator/direction), these
// assertions catch it.
describe("Cross-Service Blocked Response Contract — fail-closed envelope shape", () => {
  it("502 earlyReturn body is a CEEErrorResponseV1 with typed cross-service fields", async () => {
    // Dynamic import keeps the failing path's module graph isolated from
    // the fixture-based tests above.
    const { runStageBoundary } = await import("../../src/cee/unified-pipeline/stages/boundary.js");
    const { _resetConfigCache } = await import("../../src/config/index.js");

    _resetConfigCache();

    const fakeIssues: ZodIssue[] = [
      { code: "custom", path: ["nodes", 0, "id"], message: "cross-service fail-closed guard" },
    ];
    const parseSpy = vi.spyOn(ceeV3Schema.CEEGraphResponseV3, "safeParse").mockReturnValue({
      success: false,
      error: new ZodError(fakeIssues),
    } as ReturnType<typeof ceeV3Schema.CEEGraphResponseV3.safeParse>);

    const ctx = {
      requestId: "cross-service-fail-closed-1",
      input: { brief: "Test brief" },
      opts: { schemaVersion: "v3", strictMode: false, includeDebug: false },
      ceeResponse: {
        graph: { nodes: [{ id: "goal_1", kind: "goal", label: "Test" }], edges: [] },
        goal_node_id: "goal_1",
        options: [],
        causal_claims: [],
      },
      pipelineOutcome: {
        graph_drafted: false,
        graph_structurally_valid: false,
        deterministic_sweep_violations: 0,
        verification_status: 'skipped' as const,
        validation_status: 'skipped' as const,
        enrichment_status: 'skipped' as const,
        coaching_status: 'partial' as const,
        warnings: [] as Array<{ stage: string; error: string; degraded: boolean; blocked?: boolean }>,
        rescue_score: 0,
        factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
        edge_strength_unique_count: 0,
        llm_repair: { triggered: false, outcome: 'skipped' as const, fallback_reason: null, attempts: 0 },
        repair_provenance: [] as Array<{ rule: string; code: string; node_or_edge_id: string; field: string; before: unknown; after: unknown; source: string }>,
      },
    };

    await runStageBoundary(ctx as unknown as Parameters<typeof runStageBoundary>[0]);

    // Contract for downstream consumers:
    //   - HTTP status 502 (upstream contract violation).
    //   - body.schema === 'cee.error.v1' (schema marker clients key on).
    //   - body.code === 'CEE_EGRESS_CONTRACT_VIOLATION' (typed enum).
    //   - body.source === 'cee'.
    //   - body.retryable === false.
    //   - body.reason === 'egress_contract_violation' (typed reason).
    //   - body.details.{validator,boundary,direction} name the gate that
    //     fired so cross-service telemetry can correlate.
    //   - JSON-serialises cleanly (downstream services parse this body).
    const earlyReturn = (ctx as unknown as { earlyReturn?: { statusCode: number; body: unknown } }).earlyReturn;
    expect(earlyReturn).toBeDefined();
    expect(earlyReturn?.statusCode).toBe(502);

    const body = earlyReturn!.body as Record<string, unknown>;
    expect(body.schema).toBe("cee.error.v1");
    expect(body.code).toBe("CEE_EGRESS_CONTRACT_VIOLATION");
    expect(body.source).toBe("cee");
    expect(body.retryable).toBe(false);
    expect(body.reason).toBe("egress_contract_violation");

    const details = body.details as Record<string, unknown>;
    expect(details.validator).toBe("zod_v3");
    expect(details.boundary).toBe("B1");
    expect(details.direction).toBe("response");

    // Downstream-safety: the envelope JSON-serialises without circular
    // references or undefined keys.
    let jsonString = "";
    expect(() => {
      jsonString = JSON.stringify(earlyReturn!.body);
    }).not.toThrow();
    expect(jsonString).not.toContain(":undefined");

    parseSpy.mockRestore();
  });
});
