/**
 * Golden Fixtures Test Runner
 *
 * Data-driven tests for known graph patterns using recorded LLM responses.
 * Ensures regressions don't reoccur for previously fixed issues.
 *
 * Test Modes:
 * - 'replay' (default, CI): Use recorded_response, mock LLM
 * - 'live': Call real LLM (manual/nightly only)
 * - 'record': Call real LLM, update recorded_response in fixture
 *
 * @module tests/unit/golden-fixtures.test
 */

import { describe, it, expect, beforeAll } from "vitest";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import type { GraphT, NodeT, EdgeT } from "../../src/schemas/graph.js";

// ============================================================================
// Types
// ============================================================================

interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  path?: string;
  context?: Record<string, unknown>;
}

interface QualityMetrics {
  model_quality_band?: string;
  has_same_lever_options?: boolean;
  has_goal_number_as_factor?: boolean;
  option_distinctiveness_score?: number;
  factor_coverage_score?: number;
}

interface DraftWarning {
  id: string;
  severity: "low" | "medium" | "high" | "blocker";
  node_ids?: string[];
  affected_edge_ids?: string[];
  explanation?: string;
  fix_hint?: string;
}

interface ValidationAttemptRecord {
  attempt: number;
  passed: boolean;
  rules_checked: number;
  failed_rules: string[];
  repairs_triggered: boolean;
  repair_types: string[];
  retry_triggered: boolean;
  latency_ms: number;
  timestamp: string;
}

interface ValidationTracking {
  attempts: number;
  passed: boolean;
  total_rules_checked: number;
  failed_rules: string[];
  repairs_triggered: boolean;
  repair_types: string[];
  retry_triggered: boolean;
  attempt_records: ValidationAttemptRecord[];
  total_latency_ms: number;
}

interface Observability {
  validation?: ValidationTracking;
}

interface GoldenFixture {
  name: string;
  description?: string;
  brief: string;
  endpoint?: string; // default: 'draft_graph'
  recorded_response?: {
    graph: GraphT;
    validation?: {
      passed: boolean;
      errors: (string | ValidationIssue)[];
      warnings: (string | ValidationIssue)[];
      info?: (string | ValidationIssue)[];
    };
    repairs?: unknown[];
    quality_metrics?: QualityMetrics;
    draft_warnings?: DraftWarning[];
    _observability?: Observability;
  };
  assertions: Record<string, unknown>;
}

// ============================================================================
// Test Mode
// ============================================================================

const TEST_MODE = process.env.GOLDEN_FIXTURE_MODE ?? "replay";

// ============================================================================
// Fixture Loading
// ============================================================================

const FIXTURES_DIR = join(__dirname, "../fixtures/golden");

function loadFixtures(): Array<{ path: string; data: GoldenFixture }> {
  try {
    const files = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith(".json"));
    return files.map((f) => ({
      path: join(FIXTURES_DIR, f),
      data: JSON.parse(readFileSync(join(FIXTURES_DIR, f), "utf-8")) as GoldenFixture,
    }));
  } catch {
    // Directory might not exist yet
    return [];
  }
}

// ============================================================================
// Helper Functions
// ============================================================================

function isStructuralEdge(edge: EdgeT, graph: GraphT): boolean {
  const nodeMap = new Map(graph.nodes.map((n) => [n.id, n]));
  const fromNode = nodeMap.get(edge.from);
  const toNode = nodeMap.get(edge.to);

  if (!fromNode || !toNode) return false;

  return (
    (fromNode.kind === "decision" && toNode.kind === "option") ||
    (fromNode.kind === "option" && toNode.kind === "factor")
  );
}

function countNodesByKind(nodes: NodeT[], kind: string): number {
  return nodes.filter((n) => n.kind === kind).length;
}

// ============================================================================
// Tests
// ============================================================================

describe("Golden Fixtures", () => {
  const fixtures = loadFixtures();

  if (fixtures.length === 0) {
    it("should have at least one golden fixture", () => {
      throw new Error("No golden fixtures found in tests/fixtures/golden/");
    });
    return;
  }

  fixtures.forEach(({ path: _path, data: fixture }) => {
    describe(fixture.name, () => {
      let response: GoldenFixture["recorded_response"];

      beforeAll(() => {
        if (TEST_MODE === "replay") {
          // Use recorded response (CI-safe)
          if (!fixture.recorded_response) {
            throw new Error(
              `Fixture ${fixture.name} missing recorded_response for replay mode`
            );
          }
          response = fixture.recorded_response;
        } else {
          // Live or record mode would call real LLM - not implemented for unit tests
          // In production, this would be an integration test
          response = fixture.recorded_response;
        }
      });

      // ========================================================================
      // Assertion: no_factor_value_nodes
      // ========================================================================
      if (fixture.assertions.no_factor_value_nodes) {
        it("has no factor_value_* nodes", () => {
          const badNodes = response!.graph.nodes.filter((n) =>
            n.id.startsWith("factor_value")
          );
          expect(badNodes).toHaveLength(0);
        });
      }

      // ========================================================================
      // Assertion: has_decision_node
      // ========================================================================
      if (fixture.assertions.has_decision_node) {
        it("has decision node", () => {
          const hasDecision = response!.graph.nodes.some(
            (n) => n.kind === "decision"
          );
          expect(hasDecision).toBe(true);
        });
      }

      // ========================================================================
      // Assertion: has_goal_node
      // ========================================================================
      if (fixture.assertions.has_goal_node === true) {
        it("has goal node", () => {
          const hasGoal = response!.graph.nodes.some((n) => n.kind === "goal");
          expect(hasGoal).toBe(true);
        });
      } else if (fixture.assertions.has_goal_node === false) {
        it("has no goal node", () => {
          const hasGoal = response!.graph.nodes.some((n) => n.kind === "goal");
          expect(hasGoal).toBe(false);
        });
      }

      // ========================================================================
      // Assertion: option_count_gte
      // ========================================================================
      if (typeof fixture.assertions.option_count_gte === "number") {
        const minOptions = fixture.assertions.option_count_gte as number;
        it(`has >= ${minOptions} options`, () => {
          const optionCount = countNodesByKind(response!.graph.nodes, "option");
          expect(optionCount).toBeGreaterThanOrEqual(minOptions);
        });
      }

      // ========================================================================
      // Assertion: factor_count_gte
      // ========================================================================
      if (typeof fixture.assertions.factor_count_gte === "number") {
        const minFactors = fixture.assertions.factor_count_gte as number;
        it(`has >= ${minFactors} factors`, () => {
          const factorCount = countNodesByKind(response!.graph.nodes, "factor");
          expect(factorCount).toBeGreaterThanOrEqual(minFactors);
        });
      }

      // ========================================================================
      // Assertion: risk_count_gte
      // ========================================================================
      if (typeof fixture.assertions.risk_count_gte === "number") {
        const minRisks = fixture.assertions.risk_count_gte as number;
        it(`has >= ${minRisks} risk nodes`, () => {
          const riskCount = countNodesByKind(response!.graph.nodes, "risk");
          expect(riskCount).toBeGreaterThanOrEqual(minRisks);
        });
      }

      // ========================================================================
      // Assertion: validation_passes
      // ========================================================================
      if (fixture.assertions.validation_passes === true) {
        it("validation passes", () => {
          expect(response!.validation).toBeDefined();
          expect(response!.validation!.passed).toBe(true);
        });
      } else if (fixture.assertions.validation_passes === false) {
        it("validation fails", () => {
          expect(response!.validation).toBeDefined();
          expect(response!.validation!.passed).toBe(false);
        });
      }

      // ========================================================================
      // Assertion: structural_edges_canonical
      // ========================================================================
      if (fixture.assertions.structural_edges_canonical) {
        it("structural edges are canonical (post-repair)", () => {
          const structuralEdges = response!.graph.edges.filter((e) =>
            isStructuralEdge(e, response!.graph)
          );

          for (const edge of structuralEdges) {
            // After T2 repairs, all structural edges should be exactly canonical
            expect(edge.strength_std).toBe(0.01);
            expect(edge.belief_exists).toBe(1.0);
            expect(edge.strength_mean).toBe(1.0);
            // effect_direction may be undefined on some edges; when present, must be "positive"
            if (edge.effect_direction !== undefined) {
              expect(edge.effect_direction).toBe("positive");
            }
          }
        });
      }

      // ========================================================================
      // Assertion: goal_node_contains
      // ========================================================================
      if (Array.isArray(fixture.assertions.goal_node_contains)) {
        const expectedTexts = fixture.assertions.goal_node_contains as string[];
        it("goal node contains expected text", () => {
          const goal = response!.graph.nodes.find((n) => n.kind === "goal");
          expect(goal).toBeDefined();

          for (const text of expectedTexts) {
            expect(goal?.label?.toLowerCase()).toContain(text.toLowerCase());
          }
        });
      }

      // ========================================================================
      // Assertion: goal_contains_currency
      // ========================================================================
      if (fixture.assertions.goal_contains_currency) {
        it("goal node contains currency symbol", () => {
          const goal = response!.graph.nodes.find((n) => n.kind === "goal");
          expect(goal).toBeDefined();

          const hasCurrency = /[$£€]/.test(goal?.label ?? "");
          expect(hasCurrency).toBe(true);
        });
      }

      // ========================================================================
      // Assertion: validation_error_count (exact)
      // ========================================================================
      if (typeof fixture.assertions.validation_error_count === "number") {
        const expectedCount = fixture.assertions.validation_error_count;
        it(`has exactly ${expectedCount} validation errors`, () => {
          expect(response!.validation).toBeDefined();
          expect(response!.validation!.errors).toHaveLength(expectedCount);
        });
      }

      // ========================================================================
      // Assertion: validation_warning_count (exact)
      // ========================================================================
      if (typeof fixture.assertions.validation_warning_count === "number") {
        const expectedCount = fixture.assertions.validation_warning_count;
        it(`has exactly ${expectedCount} validation warnings`, () => {
          expect(response!.validation).toBeDefined();
          expect(response!.validation!.warnings).toHaveLength(expectedCount);
        });
      }

      // ========================================================================
      // Assertion: validation_error_count_gte
      // ========================================================================
      if (typeof fixture.assertions.validation_error_count_gte === "number") {
        const minErrors = fixture.assertions.validation_error_count_gte;
        it(`has >= ${minErrors} validation errors`, () => {
          expect(response!.validation).toBeDefined();
          expect(response!.validation!.errors.length).toBeGreaterThanOrEqual(minErrors);
        });
      }

      // ========================================================================
      // Assertion: validation_warning_count_gte
      // ========================================================================
      if (typeof fixture.assertions.validation_warning_count_gte === "number") {
        const minWarnings = fixture.assertions.validation_warning_count_gte;
        it(`has >= ${minWarnings} validation warnings`, () => {
          expect(response!.validation).toBeDefined();
          expect(response!.validation!.warnings.length).toBeGreaterThanOrEqual(minWarnings);
        });
      }

      // ========================================================================
      // Assertion: validation_has_error_codes
      // ========================================================================
      if (Array.isArray(fixture.assertions.validation_has_error_codes)) {
        const expectedCodes = fixture.assertions.validation_has_error_codes as string[];
        it("has expected validation error codes", () => {
          expect(response!.validation).toBeDefined();
          const errorCodes = response!.validation!.errors.map((e) =>
            typeof e === "string" ? e : e.code
          );
          for (const code of expectedCodes) {
            expect(errorCodes).toContain(code);
          }
        });
      }

      // ========================================================================
      // Assertion: validation_has_warning_codes
      // ========================================================================
      if (Array.isArray(fixture.assertions.validation_has_warning_codes)) {
        const expectedCodes = fixture.assertions.validation_has_warning_codes as string[];
        it("has expected validation warning codes", () => {
          expect(response!.validation).toBeDefined();
          const warningCodes = response!.validation!.warnings.map((w) =>
            typeof w === "string" ? w : w.code
          );
          for (const code of expectedCodes) {
            expect(warningCodes).toContain(code);
          }
        });
      }

      // ========================================================================
      // Assertion: quality_band_in
      // ========================================================================
      if (Array.isArray(fixture.assertions.quality_band_in)) {
        const allowedBands = fixture.assertions.quality_band_in as string[];
        it(`model quality band is one of [${allowedBands.join(", ")}]`, () => {
          expect(response!.quality_metrics).toBeDefined();
          expect(allowedBands).toContain(response!.quality_metrics!.model_quality_band);
        });
      }

      // ========================================================================
      // Assertion: has_same_lever_options
      // ========================================================================
      if (typeof fixture.assertions.has_same_lever_options === "boolean") {
        const expected = fixture.assertions.has_same_lever_options;
        it(`has_same_lever_options is ${expected}`, () => {
          expect(response!.quality_metrics).toBeDefined();
          expect(response!.quality_metrics!.has_same_lever_options).toBe(expected);
        });
      }

      // ========================================================================
      // Assertion: draft_warnings_has
      // ========================================================================
      if (Array.isArray(fixture.assertions.draft_warnings_has)) {
        const expectedWarnings = fixture.assertions.draft_warnings_has as Array<{
          id: string;
          severity: string;
        }>;
        it("has expected draft warnings with correct severities", () => {
          expect(response!.draft_warnings).toBeDefined();
          const draftWarnings = response!.draft_warnings!;

          for (const expected of expectedWarnings) {
            const found = draftWarnings.find((w) => w.id === expected.id);
            expect(found).toBeDefined();
            expect(found?.severity).toBe(expected.severity);
          }
        });
      }

      // ========================================================================
      // Assertion: observability_has_attempt_records
      // ========================================================================
      if (fixture.assertions.observability_has_attempt_records === true) {
        it("has observability attempt_records", () => {
          expect(response!._observability).toBeDefined();
          expect(response!._observability!.validation).toBeDefined();
          expect(response!._observability!.validation!.attempt_records).toBeDefined();
          expect(Array.isArray(response!._observability!.validation!.attempt_records)).toBe(true);
          expect(response!._observability!.validation!.attempt_records.length).toBeGreaterThan(0);
        });
      }

      // ========================================================================
      // Assertion: observability_attempt_count_gte
      // ========================================================================
      if (typeof fixture.assertions.observability_attempt_count_gte === "number") {
        const minAttempts = fixture.assertions.observability_attempt_count_gte;
        it(`has >= ${minAttempts} validation attempts`, () => {
          expect(response!._observability).toBeDefined();
          expect(response!._observability!.validation).toBeDefined();
          expect(response!._observability!.validation!.attempts).toBeGreaterThanOrEqual(minAttempts);
        });
      }

      // ========================================================================
      // Assertion: observability_repairs_triggered
      // ========================================================================
      if (typeof fixture.assertions.observability_repairs_triggered === "boolean") {
        const expected = fixture.assertions.observability_repairs_triggered;
        it(`repairs_triggered is ${expected}`, () => {
          expect(response!._observability).toBeDefined();
          expect(response!._observability!.validation).toBeDefined();
          expect(response!._observability!.validation!.repairs_triggered).toBe(expected);
        });
      }

      // ========================================================================
      // Assertion: observability_attempt_record_shape
      // ========================================================================
      if (fixture.assertions.observability_attempt_record_shape) {
        const shape = fixture.assertions.observability_attempt_record_shape as {
          index: number;
          required_keys: string[];
          expected?: Record<string, unknown>;
        };
        it(`attempt_record[${shape.index}] has expected shape and values`, () => {
          expect(response!._observability).toBeDefined();
          expect(response!._observability!.validation).toBeDefined();
          const records = response!._observability!.validation!.attempt_records;
          expect(records).toBeDefined();
          expect(records.length).toBeGreaterThan(shape.index);

          const record = records[shape.index] as Record<string, unknown>;
          for (const key of shape.required_keys) {
            expect(record).toHaveProperty(key);
          }

          if (shape.expected) {
            for (const [key, value] of Object.entries(shape.expected)) {
              expect(record[key]).toBe(value);
            }
          }
        });
      }
    });
  });
});
