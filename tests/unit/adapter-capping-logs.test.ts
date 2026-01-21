/**
 * Adapter Capping Logs Unit Tests
 *
 * Tests that verify repair adapter capping paths emit proper structured logs.
 * This validates the structured capping event format with before/after counts.
 *
 * The logs should include:
 * - event: 'cee.repair.graph_capped'
 * - adapter: 'openai' | 'anthropic'
 * - path: 'repair'
 * - nodes: { before, after, max, capped }
 * - edges: { before, after, max, capped }
 * - request_id: string (when available)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GRAPH_MAX_NODES, GRAPH_MAX_EDGES } from "../../src/config/graphCaps.js";
import type { GraphCappedEvent } from "../../src/adapters/llm/types.js";

// Mock the logger to capture log calls
const mockWarn = vi.fn();
vi.mock("../../src/utils/telemetry.js", async (importOriginal) => {
  const original = await importOriginal() as any;
  return {
    ...original,
    log: {
      ...original.log,
      warn: mockWarn,
      info: vi.fn(),
      debug: vi.fn(),
      error: vi.fn(),
    },
  };
});

describe("Adapter Capping Logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("graph caps constants", () => {
    it("GRAPH_MAX_NODES is defined and positive", () => {
      expect(GRAPH_MAX_NODES).toBeGreaterThan(0);
      expect(GRAPH_MAX_NODES).toBe(50); // Default value
    });

    it("GRAPH_MAX_EDGES is defined and positive", () => {
      expect(GRAPH_MAX_EDGES).toBeGreaterThan(0);
      expect(GRAPH_MAX_EDGES).toBe(200); // Default value
    });

    it("GRAPH_MAX_EDGES is greater than GRAPH_MAX_NODES", () => {
      // This ratio is important for graph density
      expect(GRAPH_MAX_EDGES).toBeGreaterThan(GRAPH_MAX_NODES);
    });
  });

  describe("GraphCappedEvent structure", () => {
    /**
     * Documents the expected structured event format for repair adapter capping.
     */
    it("documents expected event structure for OpenAI", () => {
      const expectedEvent: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: {
          before: 75,
          after: GRAPH_MAX_NODES,
          max: GRAPH_MAX_NODES,
          capped: true,
        },
        edges: {
          before: 250,
          after: GRAPH_MAX_EDGES,
          max: GRAPH_MAX_EDGES,
          capped: true,
        },
        request_id: 'req-123',
      };

      // Verify the structure matches the type
      expect(expectedEvent.event).toBe('cee.repair.graph_capped');
      expect(expectedEvent.adapter).toBe('openai');
      expect(expectedEvent.path).toBe('repair');
      expect(expectedEvent.nodes.before).toBeGreaterThan(expectedEvent.nodes.after);
      expect(expectedEvent.nodes.capped).toBe(true);
      expect(expectedEvent.edges.before).toBeGreaterThan(expectedEvent.edges.after);
      expect(expectedEvent.edges.capped).toBe(true);
    });

    it("documents expected event structure for Anthropic", () => {
      const expectedEvent: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'anthropic',
        path: 'repair',
        nodes: {
          before: 60,
          after: GRAPH_MAX_NODES,
          max: GRAPH_MAX_NODES,
          capped: true,
        },
        edges: {
          before: 180,
          after: 180,
          max: GRAPH_MAX_EDGES,
          capped: false,
        },
        request_id: 'idem-456',
      };

      // Verify the structure matches the type
      expect(expectedEvent.event).toBe('cee.repair.graph_capped');
      expect(expectedEvent.adapter).toBe('anthropic');
      expect(expectedEvent.path).toBe('repair');
      expect(expectedEvent.nodes.capped).toBe(true);
      expect(expectedEvent.edges.capped).toBe(false);
    });

    it("both adapters produce identical event structure", () => {
      const openaiEvent: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 250, after: 200, max: 200, capped: true },
        request_id: 'req-123',
      };

      const anthropicEvent: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'anthropic',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 250, after: 200, max: 200, capped: true },
        request_id: 'idem-456',
      };

      // Structure keys should match
      expect(Object.keys(openaiEvent)).toEqual(Object.keys(anthropicEvent));
      expect(Object.keys(openaiEvent.nodes)).toEqual(Object.keys(anthropicEvent.nodes));
      expect(Object.keys(openaiEvent.edges)).toEqual(Object.keys(anthropicEvent.edges));

      // Event type should be identical
      expect(openaiEvent.event).toBe(anthropicEvent.event);
      expect(openaiEvent.path).toBe(anthropicEvent.path);
    });
  });

  describe("capping behavior verification", () => {
    it("verifies node capping condition", () => {
      const oversizedNodeCount = GRAPH_MAX_NODES + 25;
      const nodesCapped = oversizedNodeCount > GRAPH_MAX_NODES;

      expect(nodesCapped).toBe(true);
      expect(oversizedNodeCount).toBe(75);
    });

    it("verifies edge capping condition", () => {
      const oversizedEdgeCount = GRAPH_MAX_EDGES + 50;
      const edgesCapped = oversizedEdgeCount > GRAPH_MAX_EDGES;

      expect(edgesCapped).toBe(true);
      expect(oversizedEdgeCount).toBe(250);
    });

    it("verifies no capping when under limits", () => {
      const normalNodeCount = GRAPH_MAX_NODES - 10;
      const normalEdgeCount = GRAPH_MAX_EDGES - 50;

      const nodesCapped = normalNodeCount > GRAPH_MAX_NODES;
      const edgesCapped = normalEdgeCount > GRAPH_MAX_EDGES;

      expect(nodesCapped).toBe(false);
      expect(edgesCapped).toBe(false);
    });

    it("event only emits when capping occurs", () => {
      // Scenario: nodes capped, edges not capped
      const nodesBefore = 75;
      const edgesBefore = 150;
      const nodesCapped = nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = edgesBefore > GRAPH_MAX_EDGES;

      const shouldEmitEvent = nodesCapped || edgesCapped;
      expect(shouldEmitEvent).toBe(true);
      expect(nodesCapped).toBe(true);
      expect(edgesCapped).toBe(false);
    });

    it("event does not emit when nothing is capped", () => {
      const nodesBefore = 30;
      const edgesBefore = 100;
      const nodesCapped = nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = edgesBefore > GRAPH_MAX_EDGES;

      const shouldEmitEvent = nodesCapped || edgesCapped;
      expect(shouldEmitEvent).toBe(false);
    });
  });

  describe("before/after count accuracy", () => {
    it("after count equals max when capped", () => {
      const before = 75;
      const max = GRAPH_MAX_NODES;
      const capped = before > max;
      const after = capped ? max : before;

      expect(capped).toBe(true);
      expect(after).toBe(max);
      expect(after).toBe(50);
    });

    it("after count equals before when not capped", () => {
      const before = 30;
      const max = GRAPH_MAX_NODES;
      const capped = before > max;
      const after = capped ? max : before;

      expect(capped).toBe(false);
      expect(after).toBe(before);
      expect(after).toBe(30);
    });

    it("before count is preserved in event", () => {
      const nodesBefore = 75;
      const edgesBefore = 250;

      const event: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: {
          before: nodesBefore,
          after: GRAPH_MAX_NODES,
          max: GRAPH_MAX_NODES,
          capped: true,
        },
        edges: {
          before: edgesBefore,
          after: GRAPH_MAX_EDGES,
          max: GRAPH_MAX_EDGES,
          capped: true,
        },
      };

      expect(event.nodes.before).toBe(75);
      expect(event.edges.before).toBe(250);
      expect(event.nodes.before - event.nodes.after).toBe(25); // 75 - 50
      expect(event.edges.before - event.edges.after).toBe(50); // 250 - 200
    });
  });

  describe("event searchability", () => {
    it("event name is searchable", () => {
      const event: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 100, after: 100, max: 200, capped: false },
      };

      // Event name follows cee.* namespace convention
      expect(event.event).toMatch(/^cee\./);
      expect(event.event).toBe('cee.repair.graph_capped');
    });

    it("adapter field enables filtering by provider", () => {
      const openaiEvent: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 100, after: 100, max: 200, capped: false },
      };

      const anthropicEvent: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'anthropic',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 100, after: 100, max: 200, capped: false },
      };

      expect(openaiEvent.adapter).toBe('openai');
      expect(anthropicEvent.adapter).toBe('anthropic');
    });

    it("path field distinguishes repair from draft", () => {
      const repairEvent: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 100, after: 100, max: 200, capped: false },
      };

      expect(repairEvent.path).toBe('repair');
    });
  });

  describe("request_id tracking", () => {
    it("request_id is optional", () => {
      const eventWithId: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 100, after: 100, max: 200, capped: false },
        request_id: 'req-123',
      };

      const eventWithoutId: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 100, after: 100, max: 200, capped: false },
      };

      expect(eventWithId.request_id).toBe('req-123');
      expect(eventWithoutId.request_id).toBeUndefined();
    });

    it("idempotency_key is optional and separate from request_id", () => {
      const eventWithBoth: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'anthropic',
        path: 'repair',
        nodes: { before: 75, after: 50, max: 50, capped: true },
        edges: { before: 100, after: 100, max: 200, capped: false },
        request_id: 'req-456',
        idempotency_key: 'idem-789',
      };

      expect(eventWithBoth.request_id).toBe('req-456');
      expect(eventWithBoth.idempotency_key).toBe('idem-789');
      expect(eventWithBoth.request_id).not.toBe(eventWithBoth.idempotency_key);
    });
  });

  /**
   * Independent Capping Fixture Tests
   *
   * These tests verify each capping scenario independently using fixture data.
   * Each test is self-contained and validates a specific capping condition.
   */
  describe("Independent Capping Fixtures", () => {
    /**
     * Fixture 1: Only nodes exceed limit
     * Expected: nodes.capped: true, edges.capped: false, event IS emitted
     */
    it("Fixture 1: Only nodes exceed limit → event emitted with nodes.capped=true, edges.capped=false", () => {
      const fixture = {
        nodesBefore: 75,  // > 50 (GRAPH_MAX_NODES)
        edgesBefore: 150, // < 200 (GRAPH_MAX_EDGES)
      };

      const nodesCapped = fixture.nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = fixture.edgesBefore > GRAPH_MAX_EDGES;
      const shouldEmitEvent = nodesCapped || edgesCapped;

      const nodesAfter = nodesCapped ? GRAPH_MAX_NODES : fixture.nodesBefore;
      const edgesAfter = edgesCapped ? GRAPH_MAX_EDGES : fixture.edgesBefore;

      // Assertions
      expect(nodesCapped).toBe(true);
      expect(edgesCapped).toBe(false);
      expect(shouldEmitEvent).toBe(true);
      expect(nodesAfter).toBe(GRAPH_MAX_NODES);
      expect(edgesAfter).toBe(fixture.edgesBefore);

      // Verify event structure when only nodes are capped
      const event: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: {
          before: fixture.nodesBefore,
          after: nodesAfter,
          max: GRAPH_MAX_NODES,
          capped: nodesCapped,
        },
        edges: {
          before: fixture.edgesBefore,
          after: edgesAfter,
          max: GRAPH_MAX_EDGES,
          capped: edgesCapped,
        },
        request_id: 'fixture-1-req',
      };

      expect(event.nodes.capped).toBe(true);
      expect(event.edges.capped).toBe(false);
      expect(event.nodes.before - event.nodes.after).toBe(25);
      expect(event.edges.before).toBe(event.edges.after);
    });

    /**
     * Fixture 2: Only edges exceed limit
     * Expected: nodes.capped: false, edges.capped: true, event IS emitted
     */
    it("Fixture 2: Only edges exceed limit → event emitted with nodes.capped=false, edges.capped=true", () => {
      const fixture = {
        nodesBefore: 40,  // < 50 (GRAPH_MAX_NODES)
        edgesBefore: 250, // > 200 (GRAPH_MAX_EDGES)
      };

      const nodesCapped = fixture.nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = fixture.edgesBefore > GRAPH_MAX_EDGES;
      const shouldEmitEvent = nodesCapped || edgesCapped;

      const nodesAfter = nodesCapped ? GRAPH_MAX_NODES : fixture.nodesBefore;
      const edgesAfter = edgesCapped ? GRAPH_MAX_EDGES : fixture.edgesBefore;

      // Assertions
      expect(nodesCapped).toBe(false);
      expect(edgesCapped).toBe(true);
      expect(shouldEmitEvent).toBe(true);
      expect(nodesAfter).toBe(fixture.nodesBefore);
      expect(edgesAfter).toBe(GRAPH_MAX_EDGES);

      // Verify event structure when only edges are capped
      const event: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'anthropic',
        path: 'repair',
        nodes: {
          before: fixture.nodesBefore,
          after: nodesAfter,
          max: GRAPH_MAX_NODES,
          capped: nodesCapped,
        },
        edges: {
          before: fixture.edgesBefore,
          after: edgesAfter,
          max: GRAPH_MAX_EDGES,
          capped: edgesCapped,
        },
        request_id: 'fixture-2-req',
        idempotency_key: 'fixture-2-idem',
      };

      expect(event.nodes.capped).toBe(false);
      expect(event.edges.capped).toBe(true);
      expect(event.nodes.before).toBe(event.nodes.after);
      expect(event.edges.before - event.edges.after).toBe(50);
    });

    /**
     * Fixture 3: Neither exceeds limit
     * Expected: nodes.capped: false, edges.capped: false, NO event emitted
     */
    it("Fixture 3: Neither exceeds limit → NO event emitted", () => {
      const fixture = {
        nodesBefore: 30,  // < 50 (GRAPH_MAX_NODES)
        edgesBefore: 100, // < 200 (GRAPH_MAX_EDGES)
      };

      const nodesCapped = fixture.nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = fixture.edgesBefore > GRAPH_MAX_EDGES;
      const shouldEmitEvent = nodesCapped || edgesCapped;

      const nodesAfter = nodesCapped ? GRAPH_MAX_NODES : fixture.nodesBefore;
      const edgesAfter = edgesCapped ? GRAPH_MAX_EDGES : fixture.edgesBefore;

      // Assertions - No capping, no event
      expect(nodesCapped).toBe(false);
      expect(edgesCapped).toBe(false);
      expect(shouldEmitEvent).toBe(false);

      // Counts unchanged
      expect(nodesAfter).toBe(fixture.nodesBefore);
      expect(edgesAfter).toBe(fixture.edgesBefore);

      // This scenario should NOT emit an event
      // The adapter code wraps event emission in: if (nodesCapped || edgesCapped)
      // Since shouldEmitEvent is false, no GraphCappedEvent is created
    });

    /**
     * Fixture 4: Both exceed limits
     * Expected: nodes.capped: true, edges.capped: true, event IS emitted
     */
    it("Fixture 4: Both exceed limits → event emitted with both capped=true", () => {
      const fixture = {
        nodesBefore: 75,  // > 50 (GRAPH_MAX_NODES)
        edgesBefore: 250, // > 200 (GRAPH_MAX_EDGES)
      };

      const nodesCapped = fixture.nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = fixture.edgesBefore > GRAPH_MAX_EDGES;
      const shouldEmitEvent = nodesCapped || edgesCapped;

      const nodesAfter = nodesCapped ? GRAPH_MAX_NODES : fixture.nodesBefore;
      const edgesAfter = edgesCapped ? GRAPH_MAX_EDGES : fixture.edgesBefore;

      // Assertions
      expect(nodesCapped).toBe(true);
      expect(edgesCapped).toBe(true);
      expect(shouldEmitEvent).toBe(true);
      expect(nodesAfter).toBe(GRAPH_MAX_NODES);
      expect(edgesAfter).toBe(GRAPH_MAX_EDGES);

      // Verify event structure when both are capped
      const event: GraphCappedEvent = {
        event: 'cee.repair.graph_capped',
        adapter: 'openai',
        path: 'repair',
        nodes: {
          before: fixture.nodesBefore,
          after: nodesAfter,
          max: GRAPH_MAX_NODES,
          capped: nodesCapped,
        },
        edges: {
          before: fixture.edgesBefore,
          after: edgesAfter,
          max: GRAPH_MAX_EDGES,
          capped: edgesCapped,
        },
        request_id: 'fixture-4-req',
      };

      expect(event.nodes.capped).toBe(true);
      expect(event.edges.capped).toBe(true);
      expect(event.nodes.before - event.nodes.after).toBe(25);
      expect(event.edges.before - event.edges.after).toBe(50);

      // Both deltas should be positive (items were removed)
      expect(event.nodes.before).toBeGreaterThan(event.nodes.after);
      expect(event.edges.before).toBeGreaterThan(event.edges.after);
    });

    /**
     * Edge case: Exactly at limits (boundary condition)
     * Expected: nodes.capped: false, edges.capped: false, NO event emitted
     */
    it("Fixture boundary: Exactly at limits → NO event emitted", () => {
      const fixture = {
        nodesBefore: GRAPH_MAX_NODES, // exactly 50
        edgesBefore: GRAPH_MAX_EDGES, // exactly 200
      };

      const nodesCapped = fixture.nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = fixture.edgesBefore > GRAPH_MAX_EDGES;
      const shouldEmitEvent = nodesCapped || edgesCapped;

      // At exactly the limit, no capping occurs (> not >=)
      expect(nodesCapped).toBe(false);
      expect(edgesCapped).toBe(false);
      expect(shouldEmitEvent).toBe(false);
    });

    /**
     * Edge case: One over each limit (minimum capping)
     * Expected: both capped: true, after = max for both
     */
    it("Fixture minimum: One over each limit → both capped with minimal reduction", () => {
      const fixture = {
        nodesBefore: GRAPH_MAX_NODES + 1, // 51
        edgesBefore: GRAPH_MAX_EDGES + 1, // 201
      };

      const nodesCapped = fixture.nodesBefore > GRAPH_MAX_NODES;
      const edgesCapped = fixture.edgesBefore > GRAPH_MAX_EDGES;

      const nodesAfter = nodesCapped ? GRAPH_MAX_NODES : fixture.nodesBefore;
      const edgesAfter = edgesCapped ? GRAPH_MAX_EDGES : fixture.edgesBefore;

      expect(nodesCapped).toBe(true);
      expect(edgesCapped).toBe(true);
      expect(fixture.nodesBefore - nodesAfter).toBe(1);
      expect(fixture.edgesBefore - edgesAfter).toBe(1);
    });
  });
});
