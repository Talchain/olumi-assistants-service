import { describe, it, expect } from "vitest";
import { generateLayout, hasClientPositions } from "../../src/layout/deterministic.js";

describe("Deterministic Layout (v1.4.0)", () => {
  describe("Determinism", () => {
    it("generates identical layouts for identical graphs", () => {
      const graph = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option 1" },
          { id: "c", kind: "option" as const, label: "Option 2" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      };

      const layout1 = generateLayout(graph);
      const layout2 = generateLayout(graph);

      expect(layout1).toEqual(layout2);
    });

    it("generates same layout regardless of node order", () => {
      const graph1 = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option 1" },
          { id: "c", kind: "option" as const, label: "Option 2" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      };

      const graph2 = {
        nodes: [
          { id: "c", kind: "option" as const, label: "Option 2" },
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option 1" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
        ],
      };

      const layout1 = generateLayout(graph1);
      const layout2 = generateLayout(graph2);

      expect(layout1).toEqual(layout2);
    });

    it("generates different layouts for different graphs", () => {
      const graph1 = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option 1" },
        ],
        edges: [{ from: "a", to: "b" }],
      };

      const graph2 = {
        nodes: [
          { id: "x", kind: "decision" as const, label: "Decision" },
          { id: "y", kind: "option" as const, label: "Option 1" },
        ],
        edges: [{ from: "x", to: "y" }],
      };

      const layout1 = generateLayout(graph1);
      const layout2 = generateLayout(graph2);

      // Different node IDs should produce different layouts (different positions)
      expect(layout1).not.toEqual(layout2);
    });
  });

  describe("Grid snapping", () => {
    it("snaps all coordinates to 24px grid", () => {
      const graph = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option 1" },
          { id: "c", kind: "option" as const, label: "Option 2" },
          { id: "d", kind: "outcome" as const, label: "Outcome" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "a", to: "c" },
          { from: "b", to: "d" },
        ],
      };

      const layout = generateLayout(graph);

      for (const nodeId of Object.keys(layout)) {
        const pos = layout[nodeId];
        expect(pos.x % 24).toBe(0);
        expect(pos.y % 24).toBe(0);
      }
    });

    it("respects custom grid size", () => {
      const graph = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option 1" },
        ],
        edges: [{ from: "a", to: "b" }],
      };

      const layout = generateLayout(graph, { gridSize: 48 });

      for (const nodeId of Object.keys(layout)) {
        const pos = layout[nodeId];
        expect(pos.x % 48).toBe(0);
        expect(pos.y % 48).toBe(0);
      }
    });
  });

  describe("DAG layering", () => {
    it("arranges nodes in vertical layers based on topology", () => {
      const graph = {
        nodes: [
          { id: "root", kind: "decision" as const, label: "Root" },
          { id: "child1", kind: "option" as const, label: "Child 1" },
          { id: "child2", kind: "option" as const, label: "Child 2" },
          { id: "grandchild", kind: "outcome" as const, label: "Grandchild" },
        ],
        edges: [
          { from: "root", to: "child1" },
          { from: "root", to: "child2" },
          { from: "child1", to: "grandchild" },
        ],
      };

      const layout = generateLayout(graph);

      // Root should be at layer 0 (y=0)
      expect(layout.root.y).toBe(0);

      // Children should be at layer 1 (y=120 with default spacing)
      expect(layout.child1.y).toBe(120);
      expect(layout.child2.y).toBe(120);

      // Grandchild should be at layer 2 (y=240)
      expect(layout.grandchild.y).toBe(240);
    });

    it("handles multiple roots correctly", () => {
      const graph = {
        nodes: [
          { id: "root1", kind: "decision" as const, label: "Root 1" },
          { id: "root2", kind: "decision" as const, label: "Root 2" },
          { id: "child", kind: "option" as const, label: "Child" },
        ],
        edges: [
          { from: "root1", to: "child" },
          { from: "root2", to: "child" },
        ],
      };

      const layout = generateLayout(graph);

      // Both roots at layer 0
      expect(layout.root1.y).toBe(0);
      expect(layout.root2.y).toBe(0);

      // Child at layer 1
      expect(layout.child.y).toBe(120);
    });
  });

  describe("Special cases", () => {
    it("handles empty graph", () => {
      const graph = { nodes: [], edges: [] };
      const layout = generateLayout(graph);
      expect(layout).toEqual({});
    });

    it("handles single node", () => {
      const graph = {
        nodes: [{ id: "a", kind: "decision" as const, label: "Decision" }],
        edges: [],
      };

      const layout = generateLayout(graph);

      expect(layout.a).toBeDefined();
      expect(layout.a.x).toBe(600); // Centered at canvas width/2 = 1200/2
      expect(layout.a.y).toBe(120); // First layer
      expect(layout.a.x % 24).toBe(0);
      expect(layout.a.y % 24).toBe(0);
    });

    it("handles disconnected nodes", () => {
      const graph = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision A" },
          { id: "b", kind: "decision" as const, label: "Decision B" },
          { id: "c", kind: "decision" as const, label: "Decision C" },
        ],
        edges: [],
      };

      const layout = generateLayout(graph);

      // All nodes should be positioned
      expect(layout.a).toBeDefined();
      expect(layout.b).toBeDefined();
      expect(layout.c).toBeDefined();

      // All at same layer (no edges)
      expect(layout.a.y).toBe(layout.b.y);
      expect(layout.b.y).toBe(layout.c.y);
    });

    it("handles cycles gracefully", () => {
      const graph = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "A" },
          { id: "b", kind: "option" as const, label: "B" },
          { id: "c", kind: "outcome" as const, label: "C" },
        ],
        edges: [
          { from: "a", to: "b" },
          { from: "b", to: "c" },
          { from: "c", to: "a" }, // Cycle
        ],
      };

      const layout = generateLayout(graph);

      // Should not crash and should position all nodes
      expect(layout.a).toBeDefined();
      expect(layout.b).toBeDefined();
      expect(layout.c).toBeDefined();

      // All coordinates should be grid-snapped
      expect(layout.a.x % 24).toBe(0);
      expect(layout.b.x % 24).toBe(0);
      expect(layout.c.x % 24).toBe(0);
    });
  });

  describe("No overlaps", () => {
    it("spreads nodes horizontally within layers", () => {
      const graph = {
        nodes: [
          { id: "root", kind: "decision" as const, label: "Root" },
          { id: "a", kind: "option" as const, label: "Option A" },
          { id: "b", kind: "option" as const, label: "Option B" },
          { id: "c", kind: "option" as const, label: "Option C" },
        ],
        edges: [
          { from: "root", to: "a" },
          { from: "root", to: "b" },
          { from: "root", to: "c" },
        ],
      };

      const layout = generateLayout(graph);

      // Children should have different x coordinates
      const xCoords = [layout.a.x, layout.b.x, layout.c.x].sort((a, b) => a - b);
      expect(xCoords[0]).not.toBe(xCoords[1]);
      expect(xCoords[1]).not.toBe(xCoords[2]);

      // All at same y (same layer)
      expect(layout.a.y).toBe(layout.b.y);
      expect(layout.b.y).toBe(layout.c.y);
    });
  });

  describe("Client positions detection", () => {
    it("detects when client has provided positions", () => {
      const graph = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option" },
        ],
        edges: [{ from: "a", to: "b" }],
        meta: {
          suggested_positions: {
            a: { x: 100, y: 200 },
            b: { x: 300, y: 400 },
          },
        },
      };

      expect(hasClientPositions(graph)).toBe(true);
    });

    it("returns false when no positions provided", () => {
      const graph = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option" },
        ],
        edges: [{ from: "a", to: "b" }],
      };

      expect(hasClientPositions(graph)).toBe(false);
    });

    it("returns false when meta exists but suggested_positions is empty", () => {
      const graph = {
        nodes: [
          { id: "a", kind: "decision" as const, label: "Decision" },
          { id: "b", kind: "option" as const, label: "Option" },
        ],
        edges: [{ from: "a", to: "b" }],
        meta: {
          suggested_positions: {},
        },
      };

      expect(hasClientPositions(graph)).toBe(false);
    });
  });

  describe("Layout snapshot", () => {
    it("produces consistent layout for reference graph", () => {
      const graph = {
        nodes: [
          { id: "decision", kind: "decision" as const, label: "Expand internationally?" },
          { id: "opt1", kind: "option" as const, label: "Expand" },
          { id: "opt2", kind: "option" as const, label: "Stay domestic" },
          { id: "out1", kind: "outcome" as const, label: "Revenue growth" },
          { id: "risk1", kind: "risk" as const, label: "Regulatory risk" },
        ],
        edges: [
          { from: "decision", to: "opt1" },
          { from: "decision", to: "opt2" },
          { from: "opt1", to: "out1" },
          { from: "opt1", to: "risk1" },
        ],
      };

      const layout = generateLayout(graph);

      // Snapshot for regression testing
      expect(layout).toMatchInlineSnapshot(`
        {
          "decision": {
            "x": 600,
            "y": 0,
          },
          "opt1": {
            "x": 480,
            "y": 120,
          },
          "opt2": {
            "x": 720,
            "y": 120,
          },
          "out1": {
            "x": 480,
            "y": 240,
          },
          "risk1": {
            "x": 720,
            "y": 240,
          },
        }
      `);
    });
  });
});
