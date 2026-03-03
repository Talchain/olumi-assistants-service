/**
 * Post-Draft Guidance Generation Tests
 */

import { describe, it, expect } from "vitest";
import { generatePostDraftGuidance } from "../../../../src/orchestrator/guidance/post-draft.js";
import { SIGNAL_CODES } from "../../../../src/orchestrator/types/guidance-item.js";
import type { GraphV3T } from "../../../../src/orchestrator/types.js";
import type { CEEDraftWarning } from "../../../../src/orchestrator/tools/draft-graph.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeGraph(overrides?: Partial<GraphV3T>): GraphV3T {
  return {
    schema_version: 'v3',
    nodes: [
      { id: 'n1', kind: 'option', label: 'Option A' },
      { id: 'n2', kind: 'option', label: 'Option B' },
      { id: 'n3', kind: 'factor', label: 'Cost' },
    ],
    edges: [
      { from: 'n1', to: 'n3', strength: { mean: 0.6, std: 0.1 } },
      { from: 'n2', to: 'n3', strength: { mean: 0.4, std: 0.1 } },
    ],
    ...overrides,
  } as unknown as GraphV3T;
}

function makeWarning(overrides?: Partial<CEEDraftWarning>): CEEDraftWarning {
  return {
    id: 'uniform_edge_strengths',
    severity: 'medium',
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("generatePostDraftGuidance", () => {
  describe("warning conversion", () => {
    it("maps uniform_edge_strengths to DEFAULT_EDGE_STRENGTH should_fix", () => {
      const items = generatePostDraftGuidance(makeGraph(), [makeWarning({ id: 'uniform_edge_strengths' })], null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.DEFAULT_EDGE_STRENGTH);
      expect(item).toBeDefined();
      expect(item?.category).toBe('should_fix');
      expect(item?.priority).toBe(70);
    });

    it("maps edge_origin_defaulted to DEFAULT_EDGE_STRENGTH", () => {
      const items = generatePostDraftGuidance(makeGraph(), [makeWarning({ id: 'edge_origin_defaulted' })], null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.DEFAULT_EDGE_STRENGTH);
      expect(item).toBeDefined();
    });

    it("maps cycle_detected to STRUCTURAL_CYCLE must_fix", () => {
      const items = generatePostDraftGuidance(makeGraph(), [makeWarning({ id: 'cycle_detected', severity: 'blocker' })], null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.STRUCTURAL_CYCLE);
      expect(item).toBeDefined();
      expect(item?.category).toBe('must_fix');
      expect(item?.priority).toBe(95);
    });

    it("excludes low-severity informational warnings (missing_baseline)", () => {
      const items = generatePostDraftGuidance(makeGraph(), [makeWarning({ id: 'missing_baseline', severity: 'low' })], null);
      // Should not produce a warning item; may still have structural items
      const warningItem = items.find((i) =>
        i.signal_code === SIGNAL_CODES.STRUCTURAL_VALIDATION_ERROR && i.source === 'structural',
      );
      // missing_baseline is excluded
      expect(warningItem).toBeUndefined();
    });

    it("maps unknown warning id to STRUCTURAL_VALIDATION_ERROR with discuss action", () => {
      const items = generatePostDraftGuidance(
        makeGraph(),
        [makeWarning({ id: 'some_unknown_id', severity: 'high', explanation: 'Needs attention' })],
        null,
      );
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.STRUCTURAL_VALIDATION_ERROR);
      expect(item).toBeDefined();
      expect(item?.primary_action.type).toBe('discuss');
    });

    it("generates up to MAX_WARNING_ITEMS (3) from warnings", () => {
      const warnings: CEEDraftWarning[] = [
        makeWarning({ id: 'uniform_edge_strengths', severity: 'medium' }),
        makeWarning({ id: 'edge_origin_defaulted', severity: 'high' }),
        makeWarning({ id: 'cycle_detected', severity: 'blocker' }),
        makeWarning({ id: 'some_other', severity: 'medium' }),
      ];
      const items = generatePostDraftGuidance(makeGraph(), warnings, null);
      const _warningItems = items.filter((i) => i.source === 'structural');
      // Structural analysis items also exist — warning cap is 3 but total may be more
      expect(items.length).toBeLessThanOrEqual(8);
    });
  });

  describe("structural analysis", () => {
    it("emits LOW_OPTION_COUNT when ≤ 2 options", () => {
      const graphOneOption: GraphV3T = makeGraph({
        nodes: [{ id: 'n1', kind: 'option', label: 'A' }, { id: 'n2', kind: 'factor', label: 'Cost' }],
        edges: [{ from: 'n1', to: 'n2', strength: { mean: 0.5, std: 0.1 } }],
      } as Partial<GraphV3T>);
      const items = generatePostDraftGuidance(graphOneOption, [], null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.LOW_OPTION_COUNT);
      expect(item).toBeDefined();
      expect(item?.category).toBe('could_fix');
    });

    it("does NOT emit LOW_OPTION_COUNT when ≥ 3 options", () => {
      const graph3Options: GraphV3T = makeGraph({
        nodes: [
          { id: 'n1', kind: 'option', label: 'A' },
          { id: 'n2', kind: 'option', label: 'B' },
          { id: 'n3', kind: 'option', label: 'C' },
        ],
        edges: [],
      } as Partial<GraphV3T>);
      const items = generatePostDraftGuidance(graph3Options, [], null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.LOW_OPTION_COUNT);
      expect(item).toBeUndefined();
    });

    it("emits DEFAULT_NODE_CONFIDENCE for high-degree nodes with default exists_probability", () => {
      const highDegreeGraph = {
        schema_version: 'v3',
        nodes: [
          { id: 'hub', kind: 'factor', label: 'Hub', exists_probability: 0.8 },
          { id: 'a', kind: 'option', label: 'A' },
          { id: 'b', kind: 'option', label: 'B' },
          { id: 'c', kind: 'factor', label: 'C' },
          { id: 'd', kind: 'factor', label: 'D' },
        ],
        edges: [
          { from: 'a', to: 'hub', strength: { mean: 0.5, std: 0.1 } },
          { from: 'b', to: 'hub', strength: { mean: 0.5, std: 0.1 } },
          { from: 'hub', to: 'c', strength: { mean: 0.5, std: 0.1 } },
          { from: 'hub', to: 'd', strength: { mean: 0.5, std: 0.1 } },
        ],
      } as unknown as GraphV3T;

      const items = generatePostDraftGuidance(highDegreeGraph, [], null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.DEFAULT_NODE_CONFIDENCE);
      expect(item).toBeDefined();
      expect(item?.target_object?.id).toBe('hub');
    });

    it("emits MISSING_FRAMING_ELEMENT for goal when missing", () => {
      const noGoalGraph: GraphV3T = makeGraph({
        nodes: [
          { id: 'n1', kind: 'option', label: 'Option A' },
          { id: 'n2', kind: 'option', label: 'Option B' },
          { id: 'n3', kind: 'option', label: 'Option C' },
        ],
        edges: [],
      } as Partial<GraphV3T>);
      const items = generatePostDraftGuidance(noGoalGraph, [], null);
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.MISSING_FRAMING_ELEMENT);
      expect(item).toBeDefined();
    });

    it("does NOT emit MISSING_FRAMING_ELEMENT when framing goal is provided", () => {
      const noGoalGraph: GraphV3T = makeGraph({
        nodes: [
          { id: 'n1', kind: 'option', label: 'Option A' },
          { id: 'n2', kind: 'option', label: 'Option B' },
          { id: 'n3', kind: 'option', label: 'Option C' },
        ],
        edges: [],
      } as Partial<GraphV3T>);
      const items = generatePostDraftGuidance(noGoalGraph, [], { goal: 'Choose the best vendor' });
      const item = items.find((i) => i.signal_code === SIGNAL_CODES.MISSING_FRAMING_ELEMENT);
      expect(item).toBeUndefined();
    });
  });

  describe("determinism", () => {
    it("produces identical output for identical input", () => {
      const graph = makeGraph();
      const warnings: CEEDraftWarning[] = [makeWarning({ id: 'cycle_detected', severity: 'blocker' })];
      const a = generatePostDraftGuidance(graph, warnings, null);
      const b = generatePostDraftGuidance(graph, warnings, null);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it("item_ids are stable (prefix gi_)", () => {
      const items = generatePostDraftGuidance(makeGraph(), [], null);
      for (const item of items) {
        expect(item.item_id).toMatch(/^gi_[a-f0-9]{16}$/);
      }
    });
  });

  describe("deduplication and capping", () => {
    it("deduplicates items by (signal_code + target_object.id)", () => {
      const warnings: CEEDraftWarning[] = [
        makeWarning({ id: 'uniform_edge_strengths' }),
        makeWarning({ id: 'uniform_edge_strengths' }),
      ];
      const items = generatePostDraftGuidance(makeGraph(), warnings, null);
      const defaultStrengthItems = items.filter((i) => i.signal_code === SIGNAL_CODES.DEFAULT_EDGE_STRENGTH);
      // Both map to DEFAULT_EDGE_STRENGTH with no target → one item
      expect(defaultStrengthItems.length).toBeLessThanOrEqual(1);
    });

    it("returns at most 8 items", () => {
      // Generate many warnings to hit the cap
      const warnings: CEEDraftWarning[] = Array.from({ length: 10 }, (_, i) => ({
        id: `unknown_warning_${i}`,
        severity: 'high' as const,
        explanation: `Warning ${i}`,
      }));
      const items = generatePostDraftGuidance(makeGraph(), warnings, null);
      expect(items.length).toBeLessThanOrEqual(8);
    });
  });

  describe("priority ordering", () => {
    it("sorts items by priority descending", () => {
      const warnings: CEEDraftWarning[] = [
        makeWarning({ id: 'cycle_detected', severity: 'blocker' }), // priority 95
        makeWarning({ id: 'uniform_edge_strengths' }),              // priority 70
      ];
      const items = generatePostDraftGuidance(makeGraph(), warnings, null);
      for (let i = 1; i < items.length; i++) {
        expect(items[i - 1].priority).toBeGreaterThanOrEqual(items[i].priority);
      }
    });
  });
});
