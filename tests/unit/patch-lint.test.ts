/**
 * Patch Lint Unit Tests (v1.4.0 - PR D)
 *
 * Tests the patch validation logic that detects structural issues:
 * - Duplicate additions
 * - Invalid updates/removes
 * - Missing provenance
 * - Dangling edges
 */

import { describe, it, expect } from "vitest";
import { lintPatch } from "../../src/utils/patch-lint.js";
import type { GraphT } from "../../src/schemas/graph.js";

describe("Patch Lint (v1.4.0)", () => {
  const baseGraph: GraphT = {
    version: "1",
    default_seed: 42,
    nodes: [
      { id: "a", kind: "goal", label: "Goal A" },
      { id: "b", kind: "decision", label: "Decision B" },
    ],
    edges: [
      { from: "a", to: "b" },
    ],
    meta: {
      roots: [],
      leaves: [],
      suggested_positions: {},
      source: "assistant" as const,
    },
  };

  describe("Clean patches", () => {
    it("returns empty array for valid patch", () => {
      const patch = {
        adds: {
          nodes: [{ id: "c", kind: "option" as const, label: "Option C", provenance: "llm" }],
          edges: [{ from: "b", to: "c", provenance: "llm" }],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      expect(issues).toEqual([]);
    });

    it("returns empty array for empty patch", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      expect(issues).toEqual([]);
    });
  });

  describe("Duplicate node additions", () => {
    it("detects adding node that already exists", () => {
      const patch = {
        adds: {
          nodes: [{ id: "a", kind: "goal" as const, label: "Duplicate"}],
          edges: [],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].level).toBe("BLOCKER");
      expect(issues[0].note).toContain("already exists");
      expect(issues[0].target).toBe("a");
    });

    it("detects duplicate nodes within patch", () => {
      const patch = {
        adds: {
          nodes: [
            { id: "c", kind: "option" as const, label: "Option C"},
            { id: "c", kind: "option" as const, label: "Duplicate C"},
          ],
          edges: [],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const duplicateIssue = issues.find(i => i.note.includes("Duplicate node"));
      expect(duplicateIssue).toBeDefined();
      expect(duplicateIssue?.level).toBe("BLOCKER");
    });
  });

  describe("Duplicate edge additions", () => {
    it("detects adding edge that already exists", () => {
      const patch = {
        adds: {
          nodes: [],
          edges: [{ from: "a", to: "b"}],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      expect(issues.length).toBeGreaterThan(0);
      expect(issues[0].level).toBe("BLOCKER");
      expect(issues[0].note).toContain("already exists");
    });

    it("detects duplicate edges within patch", () => {
      const patch = {
        adds: {
          nodes: [{ id: "c", kind: "option" as const, label: "C"}],
          edges: [
            { from: "b", to: "c"},
            { from: "b", to: "c"},
          ],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const duplicateIssue = issues.find(i => i.note.includes("Duplicate edge"));
      expect(duplicateIssue).toBeDefined();
      expect(duplicateIssue?.level).toBe("BLOCKER");
    });
  });

  describe("Invalid edge references", () => {
    it("detects edge with non-existent source node", () => {
      const patch = {
        adds: {
          nodes: [],
          edges: [{ from: "nonexistent", to: "b"}],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const sourceIssue = issues.find(i => i.note.includes("non-existent source"));
      expect(sourceIssue).toBeDefined();
      expect(sourceIssue?.level).toBe("BLOCKER");
    });

    it("detects edge with non-existent target node", () => {
      const patch = {
        adds: {
          nodes: [],
          edges: [{ from: "a", to: "nonexistent"}],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const targetIssue = issues.find(i => i.note.includes("non-existent target"));
      expect(targetIssue).toBeDefined();
      expect(targetIssue?.level).toBe("BLOCKER");
    });

    it("allows edge between existing node and newly added node", () => {
      const patch = {
        adds: {
          nodes: [{ id: "c", kind: "option" as const, label: "C"}],
          edges: [{ from: "b", to: "c"}],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const edgeIssues = issues.filter(i => i.note.includes("non-existent"));
      expect(edgeIssues.length).toBe(0);
    });
  });

  describe("Invalid updates", () => {
    it("detects update referencing non-existent node", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [{ id: "nonexistent", label: "Updated" }],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const updateIssue = issues.find(i => i.note.includes("Update references non-existent"));
      expect(updateIssue).toBeDefined();
      expect(updateIssue?.level).toBe("BLOCKER");
    });

    it("allows update to existing node", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [{ id: "a", label: "Updated Goal" }],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const updateIssues = issues.filter(i => i.note.includes("Update references non-existent"));
      expect(updateIssues.length).toBe(0);
    });

    it("allows update to newly added node", () => {
      const patch = {
        adds: {
          nodes: [{ id: "c", kind: "option" as const, label: "C"}],
          edges: [],
        },
        updates: [{ id: "c", label: "Updated C" }],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const updateIssues = issues.filter(i => i.note.includes("Update references non-existent"));
      expect(updateIssues.length).toBe(0);
    });
  });

  describe("Invalid removals", () => {
    it("detects removing non-existent node", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [],
        removes: ["nonexistent"],
      };

      const issues = lintPatch(baseGraph, patch);
      const removeIssue = issues.find(i => i.note.includes("Remove references non-existent node"));
      expect(removeIssue).toBeDefined();
      expect(removeIssue?.level).toBe("BLOCKER");
    });

    it("detects removing non-existent edge", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [],
        removes: ["x→y"],
      };

      const issues = lintPatch(baseGraph, patch);
      const removeIssue = issues.find(i => i.note.includes("Remove references non-existent edge"));
      expect(removeIssue).toBeDefined();
      expect(removeIssue?.level).toBe("BLOCKER");
    });

    it("allows removing existing node", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [],
        removes: ["a"],
      };

      const issues = lintPatch(baseGraph, patch);
      const removeIssues = issues.filter(i => i.note.includes("Remove references non-existent"));
      expect(removeIssues.length).toBe(0);
    });

    it("allows removing existing edge", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [],
        removes: ["a→b"],
      };

      const issues = lintPatch(baseGraph, patch);
      const removeIssues = issues.filter(i => i.note.includes("Remove references non-existent"));
      expect(removeIssues.length).toBe(0);
    });
  });

  describe("Provenance requirements", () => {
    it("detects missing provenance on added nodes", () => {
      const patch = {
        adds: {
          nodes: [{ id: "c", kind: "option" as const, label: "C" }],
          edges: [],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const provIssue = issues.find(i => i.note.includes("missing provenance"));
      expect(provIssue).toBeDefined();
      expect(provIssue?.level).toBe("IMPROVEMENT");
    });

    it("detects empty provenance on added nodes", () => {
      const patch = {
        adds: {
          nodes: [{ id: "c", kind: "option" as const, label: "C", provenance: [] }],
          edges: [],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const provIssue = issues.find(i => i.note.includes("missing provenance"));
      expect(provIssue).toBeDefined();
      expect(provIssue?.level).toBe("IMPROVEMENT");
    });

    it("detects missing provenance on added edges", () => {
      const patch = {
        adds: {
          nodes: [{ id: "c", kind: "option" as const, label: "C"}],
          edges: [{ from: "b", to: "c" }],
        },
        updates: [],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      const provIssue = issues.find(i => i.note.includes("missing provenance"));
      expect(provIssue).toBeDefined();
      expect(provIssue?.level).toBe("IMPROVEMENT");
    });
  });

  describe("Dangling edge detection", () => {
    it("detects edges that will dangle after node removal", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [],
        removes: ["b"], // Remove node but not edge a→b
      };

      const issues = lintPatch(baseGraph, patch);
      const danglingIssue = issues.find(i => i.note.includes("will dangle"));
      expect(danglingIssue).toBeDefined();
      expect(danglingIssue?.level).toBe("OBSERVATION");
    });

    it("does not warn if dangling edge is also removed", () => {
      const patch = {
        adds: { nodes: [], edges: [] },
        updates: [],
        removes: ["b", "a→b"], // Remove both node and edge
      };

      const issues = lintPatch(baseGraph, patch);
      const danglingIssue = issues.find(i => i.note.includes("will dangle"));
      expect(danglingIssue).toBeUndefined();
    });
  });

  describe("Complex patches", () => {
    it("validates patch with adds, updates, and removes", () => {
      const patch = {
        adds: {
          nodes: [
            { id: "c", kind: "option" as const, label: "Option C", provenance: "llm" },
            { id: "d", kind: "outcome" as const, label: "Outcome D", provenance: "llm" },
          ],
          edges: [
            { from: "b", to: "c", provenance: "llm" },
            { from: "c", to: "d", provenance: "llm" },
          ],
        },
        updates: [{ id: "a", label: "Updated Goal A" }],
        removes: [],
      };

      const issues = lintPatch(baseGraph, patch);
      expect(issues).toEqual([]);
    });

    it("detects multiple issues in complex patch", () => {
      const patch = {
        adds: {
          nodes: [
            { id: "a", kind: "goal" as const, label: "Duplicate", provenance: "user" }, // Duplicate
            { id: "c", kind: "option" as const, label: "C" }, // Missing provenance
          ],
          edges: [
            { from: "b", to: "nonexistent", provenance: "llm" }, // Invalid target
          ],
        },
        updates: [{ id: "nonexistent", label: "Updated" }], // Invalid update
        removes: ["z"], // Invalid remove
      };

      const issues = lintPatch(baseGraph, patch);
      expect(issues.length).toBeGreaterThanOrEqual(4);
      expect(issues.filter(i => i.level === "BLOCKER").length).toBeGreaterThan(0);
      expect(issues.filter(i => i.level === "IMPROVEMENT").length).toBeGreaterThan(0);
    });
  });
});
