import { describe, it, expect } from "vitest";

import type { GraphV1 } from "../../src/contracts/plot/engine.js";
import {
  EdgeDirectionValidator,
  hasCorrectEdgeDirection,
  getEdgeDirectionViolations,
} from "../../src/cee/verification/validators/edge-direction-validator.js";

function makeGraph(partial: Partial<GraphV1>): GraphV1 {
  return {
    version: "1",
    default_seed: 17,
    nodes: [],
    edges: [],
    meta: { roots: [], leaves: [], suggested_positions: {}, source: "assistant" },
    ...(partial as any),
  } as GraphV1;
}

describe("EdgeDirectionValidator", () => {
  describe("validate()", () => {
    it("skips when payload has no graph", async () => {
      const validator = new EdgeDirectionValidator();

      const result = await validator.validate({} as any);

      expect(result.valid).toBe(true);
      expect(result.stage).toBe("edge_direction");
      expect(result.skipped).toBe(true);
    });

    it("skips when graph has no nodes", async () => {
      const graph = makeGraph({ nodes: [], edges: [] });
      const validator = new EdgeDirectionValidator();

      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.skipped).toBe(true);
    });

    it("skips when graph has no goal nodes", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "dec_1", kind: "decision" } as any,
          { id: "opt_1", kind: "option" } as any,
        ],
        edges: [{ from: "dec_1", to: "opt_1" } as any],
      });
      const validator = new EdgeDirectionValidator();

      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.skipped).toBe(true);
      expect(result.message).toMatch(/No goal nodes found/);
    });

    it("passes when edges have correct causal direction (goal is sink)", async () => {
      // Correct: decision → option → outcome → goal
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "dec_1", kind: "decision" } as any,
          { id: "opt_1", kind: "option" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [
          { from: "dec_1", to: "opt_1" } as any,
          { from: "opt_1", to: "out_1" } as any,
          { from: "out_1", to: "goal_1" } as any,
        ],
      });

      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.stage).toBe("edge_direction");
      expect(result.skipped).not.toBe(true);
      expect(result.severity).toBeUndefined();
      expect(result.code).toBeUndefined();
    });

    it("warns when goal has outgoing edges", async () => {
      // Wrong: goal → decision (goal should be sink)
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "dec_1", kind: "decision" } as any,
        ],
        edges: [{ from: "goal_1", to: "dec_1" } as any],
      });

      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.severity).toBe("warning");
      expect(result.code).toBe("EDGE_DIRECTION_VIOLATION");
      expect(result.message).toMatch(/goal outgoing/);

      const details = result.details as any;
      expect(details.goal_outgoing_count).toBe(1);
      expect(details.violations[0].violation_type).toBe("goal_has_outgoing");
    });

    it("warns when goal has multiple outgoing edges", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "dec_1", kind: "decision" } as any,
          { id: "opt_1", kind: "option" } as any,
        ],
        edges: [
          { from: "goal_1", to: "dec_1" } as any,
          { from: "goal_1", to: "opt_1" } as any,
        ],
      });

      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.severity).toBe("warning");

      const details = result.details as any;
      expect(details.goal_outgoing_count).toBe(2);
    });

    it("warns on outcome → option (wrong direction)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "opt_1", kind: "option" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [
          { from: "out_1", to: "opt_1" } as any, // Wrong!
          { from: "opt_1", to: "goal_1" } as any,
        ],
      });

      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.severity).toBe("warning");

      const details = result.details as any;
      expect(details.wrong_direction_count).toBe(1);
      expect(details.violations[0].violation_type).toBe("wrong_direction");
      expect(details.violations[0].reason).toMatch(/Outcomes don't cause options/);
    });

    it("warns on outcome → decision (wrong direction)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "dec_1", kind: "decision" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [{ from: "out_1", to: "dec_1" } as any],
      });

      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.severity).toBe("warning");
      const details = result.details as any;
      expect(details.violations[0].reason).toMatch(/Outcomes don't cause decisions/);
    });

    it("allows correct patterns: factor → option", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "factor_1", kind: "factor" } as any,
          { id: "opt_1", kind: "option" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [
          { from: "factor_1", to: "opt_1" } as any, // Correct
          { from: "opt_1", to: "out_1" } as any,
          { from: "out_1", to: "goal_1" } as any,
        ],
      });

      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.severity).toBeUndefined();
    });

    it("allows risk → goal (negative influence)", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "risk_1", kind: "risk" } as any,
        ],
        edges: [{ from: "risk_1", to: "goal_1" } as any],
      });

      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.severity).toBeUndefined();
    });

    it("allows action → outcome", async () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "action_1", kind: "action" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [
          { from: "action_1", to: "out_1" } as any,
          { from: "out_1", to: "goal_1" } as any,
        ],
      });

      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      expect(result.valid).toBe(true);
      expect(result.severity).toBeUndefined();
    });

    it("caps violations at 10 in details", async () => {
      const nodes = [{ id: "goal_1", kind: "goal" } as any];
      const edges: any[] = [];

      // Create 15 goal outgoing edges
      for (let i = 1; i <= 15; i++) {
        nodes.push({ id: `dec_${i}`, kind: "decision" } as any);
        edges.push({ from: "goal_1", to: `dec_${i}` } as any);
      }

      const graph = makeGraph({ nodes, edges });
      const validator = new EdgeDirectionValidator();
      const result = await validator.validate({ graph } as any);

      const details = result.details as any;
      expect(details.violations.length).toBe(10);
      expect(details.total_violations).toBe(15);
    });
  });

  describe("hasCorrectEdgeDirection()", () => {
    it("returns true for correct graph", () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "opt_1", kind: "option" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [
          { from: "opt_1", to: "out_1" } as any,
          { from: "out_1", to: "goal_1" } as any,
        ],
      });

      expect(hasCorrectEdgeDirection(graph)).toBe(true);
    });

    it("returns false when goal has outgoing edges", () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "dec_1", kind: "decision" } as any,
        ],
        edges: [{ from: "goal_1", to: "dec_1" } as any],
      });

      expect(hasCorrectEdgeDirection(graph)).toBe(false);
    });

    it("returns false for outcome → option", () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "opt_1", kind: "option" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [{ from: "out_1", to: "opt_1" } as any],
      });

      expect(hasCorrectEdgeDirection(graph)).toBe(false);
    });

    it("returns true for empty graph", () => {
      const graph = makeGraph({ nodes: [], edges: [] });
      expect(hasCorrectEdgeDirection(graph)).toBe(true);
    });
  });

  describe("getEdgeDirectionViolations()", () => {
    it("returns empty array for correct graph", () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [{ from: "out_1", to: "goal_1" } as any],
      });

      const violations = getEdgeDirectionViolations(graph);
      expect(violations).toHaveLength(0);
    });

    it("returns violations for goal outgoing", () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "dec_1", kind: "decision" } as any,
        ],
        edges: [{ from: "goal_1", to: "dec_1" } as any],
      });

      const violations = getEdgeDirectionViolations(graph);
      expect(violations).toHaveLength(1);
      expect(violations[0].violation_type).toBe("goal_has_outgoing");
      expect(violations[0].edge_from).toBe("goal_1");
      expect(violations[0].edge_to).toBe("dec_1");
    });

    it("returns all violation types", () => {
      const graph = makeGraph({
        nodes: [
          { id: "goal_1", kind: "goal" } as any,
          { id: "dec_1", kind: "decision" } as any,
          { id: "opt_1", kind: "option" } as any,
          { id: "out_1", kind: "outcome" } as any,
        ],
        edges: [
          { from: "goal_1", to: "dec_1" } as any, // goal outgoing
          { from: "out_1", to: "opt_1" } as any,  // wrong direction
        ],
      });

      const violations = getEdgeDirectionViolations(graph);
      expect(violations).toHaveLength(2);

      const types = violations.map(v => v.violation_type);
      expect(types).toContain("goal_has_outgoing");
      expect(types).toContain("wrong_direction");
    });
  });
});
