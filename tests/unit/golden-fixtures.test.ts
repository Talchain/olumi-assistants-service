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

interface GoldenFixture {
  name: string;
  description?: string;
  brief: string;
  endpoint?: string; // default: 'draft_graph'
  recorded_response?: {
    graph: GraphT;
    validation?: { passed: boolean; errors: string[]; warnings: string[] };
    repairs?: unknown[];
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

  fixtures.forEach(({ path, data: fixture }) => {
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
      if (fixture.assertions.has_goal_node) {
        it("has goal node", () => {
          const hasGoal = response!.graph.nodes.some((n) => n.kind === "goal");
          expect(hasGoal).toBe(true);
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
      if (fixture.assertions.validation_passes) {
        it("validation passes", () => {
          expect(response!.validation).toBeDefined();
          expect(response!.validation!.passed).toBe(true);
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
    });
  });
});
