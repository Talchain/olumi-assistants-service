/**
 * V4 edit_graph adapter — hardening layer unit tests (pure helpers).
 *
 * Validates the deterministic guards applied BEFORE/AFTER the V2 handler call:
 *   - messageImpliesStructuralEdit regex (routing bias)
 *   - snapshotOptionInterventionCounts
 *   - validateEdgeEndpoints (strips add_edge with unknown endpoints)
 *   - sanitiseNodeIdsInText
 *   - detectCalibrationOnlyArtefact (honesty guard)
 *   - findOrphans (on fully-applied preview)
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import {
  messageImpliesStructuralEdit,
  snapshotOptionInterventionCounts,
  validateEdgeEndpoints,
  sanitiseNodeIdsInText,
  detectCalibrationOnlyArtefact,
  findOrphans,
} from "../../../../../src/orchestrator/deterministic/actions/edit-graph.js";
import type { GraphV3T } from "../../../../../src/schemas/cee-v3.js";
import type { PatchOperation } from "../../../../../src/orchestrator/types.js";

describe("messageImpliesStructuralEdit", () => {
  it.each([
    ['connect A to B', true],
    ['please disconnect them', true],
    ['fix the missing connection', true],
    ['wire the factors together', true],
    ['rewire the edge', true],
    ['add a connection between X and Y', true],
    ['remove that connection', true],
    ["it isn't connected", true],
    ['this factor is not connected to the goal', true],
    ['there is a missing connection', true],
  ])('returns true for structural intent: %s', (message, expected) => {
    expect(messageImpliesStructuralEdit(message)).toBe(expected);
  });

  it.each([
    ['rename the option', false],           // rename excluded per correction
    ['set churn rate to 10%', false],
    ['what is the strongest driver', false],
    ['', false],
    [null, false],
    [undefined, false],
  ])('returns false for non-structural: %s', (message, expected) => {
    expect(messageImpliesStructuralEdit(message as string | null | undefined)).toBe(expected);
  });
});

describe("snapshotOptionInterventionCounts", () => {
  it("counts inbound edges per option", () => {
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', label: 'A' },
        { id: 'opt_b', kind: 'option', label: 'B' },
        { id: 'fac_x', kind: 'factor', label: 'X' },
      ],
      edges: [
        { from: 'fac_x', to: 'opt_a' },
        { from: 'fac_x', to: 'opt_b' },
        { from: 'fac_x', to: 'opt_b' },
      ],
    } as unknown as GraphV3T;
    const counts = snapshotOptionInterventionCounts(graph);
    expect(counts.get('opt_a')).toBe(1);
    expect(counts.get('opt_b')).toBe(2);
  });

  it("returns empty map for null graph", () => {
    expect(snapshotOptionInterventionCounts(null).size).toBe(0);
  });
});

describe("validateEdgeEndpoints", () => {
  const baseGraph = {
    nodes: [
      { id: 'fac_a', kind: 'factor', label: 'A' },
      { id: 'fac_b', kind: 'factor', label: 'B' },
    ],
    edges: [],
  } as unknown as GraphV3T;

  it("keeps add_edge with known endpoints", () => {
    const ops: PatchOperation[] = [
      { op: 'add_edge', path: 'fac_a->fac_b', value: { from: 'fac_a', to: 'fac_b' } },
    ];
    const { kept, stripped } = validateEdgeEndpoints(baseGraph, ops);
    expect(kept).toHaveLength(1);
    expect(stripped).toHaveLength(0);
  });

  it("strips add_edge with unknown endpoints", () => {
    const ops: PatchOperation[] = [
      { op: 'add_edge', path: 'fac_a->ghost', value: { from: 'fac_a', to: 'fac_ghost' } },
    ];
    const { kept, stripped } = validateEdgeEndpoints(baseGraph, ops);
    expect(kept).toHaveLength(0);
    expect(stripped).toHaveLength(1);
  });

  it("allows edges to add_node ids created earlier in the same patch", () => {
    const ops: PatchOperation[] = [
      { op: 'add_node', path: 'fac_c', value: { id: 'fac_c', kind: 'factor', label: 'C' } },
      { op: 'add_edge', path: 'fac_a->fac_c', value: { from: 'fac_a', to: 'fac_c' } },
    ];
    const { kept, stripped } = validateEdgeEndpoints(baseGraph, ops);
    expect(kept).toHaveLength(2);
    expect(stripped).toHaveLength(0);
  });

  it("passes non-edge ops through unchanged", () => {
    const ops: PatchOperation[] = [
      { op: 'update_node', path: 'fac_a', value: {} },
      { op: 'remove_edge', path: 'fac_a->fac_b' },
    ];
    const { kept, stripped } = validateEdgeEndpoints(baseGraph, ops);
    expect(kept).toHaveLength(2);
    expect(stripped).toHaveLength(0);
  });
});

describe("sanitiseNodeIdsInText", () => {
  const graph = {
    nodes: [
      { id: 'fac_runway_months', kind: 'factor', label: 'Runway (months)' },
      { id: 'opt_hire_aggressively', kind: 'option', label: 'Hire Aggressively' },
    ],
    edges: [],
  } as unknown as GraphV3T;

  it("replaces a known node id with its label", () => {
    const out = sanitiseNodeIdsInText(
      "I updated fac_runway_months to 12.",
      graph,
    );
    expect(out).toBe("I updated Runway (months) to 12.");
  });

  it("replaces multiple ids in one string", () => {
    const out = sanitiseNodeIdsInText(
      "I connected opt_hire_aggressively to fac_runway_months.",
      graph,
    );
    expect(out).toBe("I connected Hire Aggressively to Runway (months).");
  });

  it("replaces unknown ids with 'that element'", () => {
    const out = sanitiseNodeIdsInText(
      "I removed fac_ghost_factor.",
      graph,
    );
    expect(out).toBe("I removed that element.");
  });

  it("returns text unchanged when no ids present", () => {
    expect(sanitiseNodeIdsInText("Nothing to sanitise.", graph)).toBe("Nothing to sanitise.");
  });
});

describe("detectCalibrationOnlyArtefact", () => {
  it("detects structural language with update_edge-only operations", () => {
    expect(
      detectCalibrationOnlyArtefact(
        "I've connected the two factors.",
        [{ op: 'update_edge', path: 'a->b', value: { strength: { mean: 0.5 } } }],
      ),
    ).toBe(true);
  });

  it("does not trigger when operations include a structural op", () => {
    expect(
      detectCalibrationOnlyArtefact(
        "I've connected the two factors.",
        [
          { op: 'update_edge', path: 'a->b', value: {} },
          { op: 'add_edge', path: 'a->c', value: { from: 'a', to: 'c' } },
        ],
      ),
    ).toBe(false);
  });

  it("does not trigger for calibration text", () => {
    expect(
      detectCalibrationOnlyArtefact(
        "I adjusted the strength.",
        [{ op: 'update_edge', path: 'a->b', value: {} }],
      ),
    ).toBe(false);
  });

  it("returns false for empty operations", () => {
    expect(detectCalibrationOnlyArtefact("added a link", [])).toBe(false);
  });
});

describe("findOrphans", () => {
  it("flags newly-added nodes with no incident edge", () => {
    const applied = {
      nodes: [
        { id: 'fac_a', kind: 'factor', label: 'A' },
        { id: 'fac_b_new', kind: 'factor', label: 'B' },
      ],
      edges: [],
    } as unknown as GraphV3T;
    expect(findOrphans(applied, ['fac_b_new'])).toEqual(['fac_b_new']);
  });

  it("does not flag new nodes that have incident edges", () => {
    const applied = {
      nodes: [
        { id: 'fac_a', kind: 'factor', label: 'A' },
        { id: 'fac_b_new', kind: 'factor', label: 'B' },
      ],
      edges: [{ from: 'fac_a', to: 'fac_b_new' }],
    } as unknown as GraphV3T;
    expect(findOrphans(applied, ['fac_b_new'])).toEqual([]);
  });

  it("returns empty for empty added list", () => {
    const applied = { nodes: [], edges: [] } as unknown as GraphV3T;
    expect(findOrphans(applied, [])).toEqual([]);
  });
});
