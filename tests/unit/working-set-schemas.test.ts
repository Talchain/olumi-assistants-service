import { describe, it, expect } from "vitest";
import {
  WorkingSetRequest,
  AskResponse,
  ModelAction,
  Highlight,
  validateActionIds,
  validateHighlightIds,
  AskIntent,
  isRequestIdSafe,
  SafeRequestId,
  SAFE_REQUEST_ID_PATTERN,
  MAX_GRAPH_NODES,
  MAX_GRAPH_EDGES,
} from "../../src/schemas/working-set.js";

describe("Working Set Schemas", () => {
  // Helper to create a minimal valid graph
  const createMinimalGraph = () => ({
    nodes: [
      { id: "goal_1", kind: "goal", label: "Main Goal" },
      { id: "factor_1", kind: "factor", label: "Factor 1" },
    ],
    edges: [{ from: "factor_1", to: "goal_1", belief: 0.7 }],
  });

  // Helper to create a minimal valid market context
  const createMarketContext = () => ({
    id: "ctx_1",
    version: "1.0",
    hash: "abc123",
  });

  describe("WorkingSetRequest", () => {
    it("validates a complete valid request", () => {
      const request = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        scenario_id: "test-scenario",
        graph_schema_version: "2.2" as const,
        brief: "This is a test decision brief that is long enough",
        message: "Why is this factor important?",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(true);
    });

    it("accepts non-UUID request_id if safe charset", () => {
      const request = {
        request_id: "my-trace-id-123",
        scenario_id: "test-scenario",
        graph_schema_version: "2.2" as const,
        brief: "This is a test decision brief that is long enough",
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.request_id).toBe("my-trace-id-123");
      }
    });

    it("accepts request without request_id (optional field)", () => {
      const request = {
        scenario_id: "test-scenario",
        graph_schema_version: "2.2" as const,
        brief: "This is a test decision brief that is long enough",
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.request_id).toBeUndefined();
      }
    });

    it("rejects request_id with unsafe characters", () => {
      const request = {
        request_id: "<script>alert(1)</script>",
        scenario_id: "test-scenario",
        graph_schema_version: "2.2" as const,
        brief: "This is a test decision brief that is long enough",
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(false);
    });

    it("rejects request_id that is too long (>64 chars)", () => {
      const request = {
        request_id: "a".repeat(65),
        scenario_id: "test-scenario",
        graph_schema_version: "2.2" as const,
        brief: "This is a test decision brief that is long enough",
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(false);
    });

    it("rejects wrong graph schema version", () => {
      const request = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        scenario_id: "test-scenario",
        graph_schema_version: "1.0" as const, // Wrong version
        brief: "This is a test decision brief that is long enough",
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(false);
    });

    it("rejects empty scenario_id", () => {
      const request = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        scenario_id: "",
        graph_schema_version: "2.2" as const,
        brief: "This is a test decision brief that is long enough",
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(false);
    });

    it("rejects brief that is too short", () => {
      const request = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        scenario_id: "test",
        graph_schema_version: "2.2" as const,
        brief: "Short", // Too short (< 10 chars)
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(false);
    });

    it("accepts optional selection", () => {
      const request = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        scenario_id: "test-scenario",
        graph_schema_version: "2.2" as const,
        brief: "This is a test decision brief that is long enough",
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
        selection: {
          node_id: "factor_1",
        },
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.selection?.node_id).toBe("factor_1");
      }
    });

    it("accepts optional intent", () => {
      const request = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        scenario_id: "test-scenario",
        graph_schema_version: "2.2" as const,
        brief: "This is a test decision brief that is long enough",
        message: "Test message",
        graph_snapshot: createMinimalGraph(),
        market_context: createMarketContext(),
        intent: "repair",
      };

      const result = WorkingSetRequest.safeParse(request);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.intent).toBe("repair");
      }
    });

    describe("Graph Size Limits", () => {
      it("accepts graph at node limit", () => {
        const nodes = Array.from({ length: MAX_GRAPH_NODES }, (_, i) => ({
          id: `node_${i}`,
          kind: "factor" as const,
          label: `Node ${i}`,
        }));
        const request = {
          scenario_id: "test-scenario",
          graph_schema_version: "2.2" as const,
          brief: "This is a test decision brief that is long enough",
          message: "Test message",
          graph_snapshot: { nodes, edges: [] },
          market_context: createMarketContext(),
        };

        const result = WorkingSetRequest.safeParse(request);
        expect(result.success).toBe(true);
      });

      it("rejects graph exceeding node limit", () => {
        const nodes = Array.from({ length: MAX_GRAPH_NODES + 1 }, (_, i) => ({
          id: `node_${i}`,
          kind: "factor" as const,
          label: `Node ${i}`,
        }));
        const request = {
          scenario_id: "test-scenario",
          graph_schema_version: "2.2" as const,
          brief: "This is a test decision brief that is long enough",
          message: "Test message",
          graph_snapshot: { nodes, edges: [] },
          market_context: createMarketContext(),
        };

        const result = WorkingSetRequest.safeParse(request);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) =>
            i.message.includes(`maximum of ${MAX_GRAPH_NODES} nodes`)
          )).toBe(true);
        }
      });

      it("accepts graph at edge limit", () => {
        // Need at least 2 nodes to create edges
        const nodes = [
          { id: "node_a", kind: "factor" as const, label: "A" },
          { id: "node_b", kind: "factor" as const, label: "B" },
        ];
        const edges = Array.from({ length: MAX_GRAPH_EDGES }, (_, i) => ({
          from: "node_a",
          to: "node_b",
          // Use unique weight to distinguish edges (even though from/to is same)
          weight: i / MAX_GRAPH_EDGES,
        }));
        const request = {
          scenario_id: "test-scenario",
          graph_schema_version: "2.2" as const,
          brief: "This is a test decision brief that is long enough",
          message: "Test message",
          graph_snapshot: { nodes, edges },
          market_context: createMarketContext(),
        };

        const result = WorkingSetRequest.safeParse(request);
        expect(result.success).toBe(true);
      });

      it("rejects graph exceeding edge limit", () => {
        const nodes = [
          { id: "node_a", kind: "factor" as const, label: "A" },
          { id: "node_b", kind: "factor" as const, label: "B" },
        ];
        const edges = Array.from({ length: MAX_GRAPH_EDGES + 1 }, (_, i) => ({
          from: "node_a",
          to: "node_b",
          weight: i / (MAX_GRAPH_EDGES + 1),
        }));
        const request = {
          scenario_id: "test-scenario",
          graph_schema_version: "2.2" as const,
          brief: "This is a test decision brief that is long enough",
          message: "Test message",
          graph_snapshot: { nodes, edges },
          market_context: createMarketContext(),
        };

        const result = WorkingSetRequest.safeParse(request);
        expect(result.success).toBe(false);
        if (!result.success) {
          expect(result.error.issues.some((i) =>
            i.message.includes(`maximum of ${MAX_GRAPH_EDGES} edges`)
          )).toBe(true);
        }
      });

      it("exports constants with expected values", () => {
        expect(MAX_GRAPH_NODES).toBe(12);
        expect(MAX_GRAPH_EDGES).toBe(20);
      });
    });
  });

  describe("AskResponse", () => {
    const validAttribution = {
      provider: "cee",
      model_id: "test-model",
      timestamp: new Date().toISOString(),
      assistant_response_hash: "abc123def456",
    };

    it("validates response with model_actions", () => {
      const response = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        message: "Here's what I found",
        model_actions: [
          {
            action_id: "550e8400-e29b-41d4-a716-446655440001",
            op: "add_node" as const,
            payload: { id: "new_node", kind: "factor", label: "New Factor" },
          },
        ],
        attribution: validAttribution,
      };

      const result = AskResponse.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("validates response with highlights", () => {
      const response = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        message: "Look at these elements",
        highlights: [
          {
            type: "node" as const,
            ids: ["factor_1"],
            style: "primary" as const,
          },
        ],
        attribution: validAttribution,
      };

      const result = AskResponse.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("validates response with follow_up_question", () => {
      const response = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        message: "I need more information",
        follow_up_question: "Which factor are you referring to?",
        attribution: validAttribution,
      };

      const result = AskResponse.safeParse(response);
      expect(result.success).toBe(true);
    });

    it("rejects response without any actionable content (model-bound invariant)", () => {
      const response = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        message: "Just a message with no actions",
        attribution: validAttribution,
      };

      const result = AskResponse.safeParse(response);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.path.includes("_model_bound"))).toBe(true);
      }
    });

    it("rejects response with empty model_actions array (model-bound invariant)", () => {
      const response = {
        request_id: "550e8400-e29b-41d4-a716-446655440000",
        message: "Empty arrays don't count",
        model_actions: [],
        highlights: [],
        attribution: validAttribution,
      };

      const result = AskResponse.safeParse(response);
      expect(result.success).toBe(false);
    });
  });

  describe("ModelAction", () => {
    it("validates add_node action", () => {
      const action = {
        action_id: "550e8400-e29b-41d4-a716-446655440000",
        op: "add_node" as const,
        payload: { id: "new_factor", kind: "factor", label: "New Factor" },
        reason_code: "user_request",
      };

      const result = ModelAction.safeParse(action);
      expect(result.success).toBe(true);
    });

    it("validates update_node action with target_id", () => {
      const action = {
        action_id: "550e8400-e29b-41d4-a716-446655440000",
        op: "update_node" as const,
        target_id: "existing_node",
        payload: { label: "Updated Label" },
      };

      const result = ModelAction.safeParse(action);
      expect(result.success).toBe(true);
    });

    it("validates delete_edge action", () => {
      const action = {
        action_id: "550e8400-e29b-41d4-a716-446655440000",
        op: "delete_edge" as const,
        target_id: "from->to",
        payload: {},
      };

      const result = ModelAction.safeParse(action);
      expect(result.success).toBe(true);
    });
  });

  describe("Highlight", () => {
    it("validates node highlight", () => {
      const highlight = {
        type: "node" as const,
        ids: ["node_1", "node_2"],
        style: "primary" as const,
        label: "Important nodes",
      };

      const result = Highlight.safeParse(highlight);
      expect(result.success).toBe(true);
    });

    it("validates edge highlight", () => {
      const highlight = {
        type: "edge" as const,
        ids: ["from->to"],
        style: "warning" as const,
      };

      const result = Highlight.safeParse(highlight);
      expect(result.success).toBe(true);
    });

    it("validates path highlight", () => {
      const highlight = {
        type: "path" as const,
        ids: ["node_1", "node_2", "node_3"],
      };

      const result = Highlight.safeParse(highlight);
      expect(result.success).toBe(true);
    });

    it("rejects highlight with empty ids", () => {
      const highlight = {
        type: "node" as const,
        ids: [],
      };

      const result = Highlight.safeParse(highlight);
      expect(result.success).toBe(false);
    });
  });

  describe("AskIntent", () => {
    it("accepts all valid intents", () => {
      const validIntents = ["clarify", "explain", "ideate", "repair", "compare", "challenge"];

      for (const intent of validIntents) {
        const result = AskIntent.safeParse(intent);
        expect(result.success).toBe(true);
      }
    });

    it("rejects invalid intent", () => {
      const result = AskIntent.safeParse("invalid_intent");
      expect(result.success).toBe(false);
    });
  });

  describe("validateActionIds", () => {
    const graph = {
      nodes: [
        { id: "node_1" },
        { id: "node_2" },
      ],
      edges: [
        { from: "node_1", to: "node_2" },
      ],
    };

    it("validates actions with existing target_ids", () => {
      const actions = [
        {
          action_id: "550e8400-e29b-41d4-a716-446655440000",
          op: "update_node" as const,
          target_id: "node_1",
          payload: { label: "Updated" },
        },
      ];

      const result = validateActionIds(actions, graph);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it("rejects update_node with non-existent target_id", () => {
      const actions = [
        {
          action_id: "550e8400-e29b-41d4-a716-446655440000",
          op: "update_node" as const,
          target_id: "non_existent",
          payload: { label: "Updated" },
        },
      ];

      const result = validateActionIds(actions, graph);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('update_node: Node "non_existent" not found in graph');
    });

    it("rejects add_node with colliding id", () => {
      const actions = [
        {
          action_id: "550e8400-e29b-41d4-a716-446655440000",
          op: "add_node" as const,
          payload: { id: "node_1", kind: "factor" }, // Collides with existing
        },
      ];

      const result = validateActionIds(actions, graph);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('add_node: ID "node_1" already exists in graph');
    });

    it("rejects add_edge with non-existent source node", () => {
      const actions = [
        {
          action_id: "550e8400-e29b-41d4-a716-446655440000",
          op: "add_edge" as const,
          payload: { from: "non_existent", to: "node_1" },
        },
      ];

      const result = validateActionIds(actions, graph);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('add_edge: Source node "non_existent" does not exist');
    });

    it("allows add_edge referencing node added in same response", () => {
      const actions = [
        {
          action_id: "550e8400-e29b-41d4-a716-446655440000",
          op: "add_node" as const,
          payload: { id: "new_node", kind: "factor" },
        },
        {
          action_id: "550e8400-e29b-41d4-a716-446655440001",
          op: "add_edge" as const,
          payload: { from: "new_node", to: "node_1" },
        },
      ];

      const result = validateActionIds(actions, graph);
      expect(result.valid).toBe(true);
    });

    it("rejects duplicate add_node in same response", () => {
      const actions = [
        {
          action_id: "550e8400-e29b-41d4-a716-446655440000",
          op: "add_node" as const,
          payload: { id: "new_node", kind: "factor" },
        },
        {
          action_id: "550e8400-e29b-41d4-a716-446655440001",
          op: "add_node" as const,
          payload: { id: "new_node", kind: "factor" }, // Duplicate
        },
      ];

      const result = validateActionIds(actions, graph);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('add_node: ID "new_node" added multiple times in same response');
    });
  });

  describe("validateHighlightIds", () => {
    const graph = {
      nodes: [
        { id: "node_1" },
        { id: "node_2" },
      ],
      edges: [
        { from: "node_1", to: "node_2" },
      ],
    };

    it("validates highlights with existing node ids", () => {
      const highlights = [
        {
          type: "node" as const,
          ids: ["node_1", "node_2"],
        },
      ];

      const result = validateHighlightIds(highlights, graph);
      expect(result.valid).toBe(true);
    });

    it("rejects highlight with non-existent node", () => {
      const highlights = [
        {
          type: "node" as const,
          ids: ["node_1", "non_existent"],
        },
      ];

      const result = validateHighlightIds(highlights, graph);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Highlight references non-existent node: "non_existent"');
    });

    it("allows highlighting nodes being added", () => {
      const highlights = [
        {
          type: "node" as const,
          ids: ["new_node"],
        },
      ];

      const addedNodeIds = new Set(["new_node"]);
      const result = validateHighlightIds(highlights, graph, addedNodeIds);
      expect(result.valid).toBe(true);
    });

    it("validates path highlights", () => {
      const highlights = [
        {
          type: "path" as const,
          ids: ["node_1", "node_2"],
        },
      ];

      const result = validateHighlightIds(highlights, graph);
      expect(result.valid).toBe(true);
    });

    it("rejects path with non-existent node", () => {
      const highlights = [
        {
          type: "path" as const,
          ids: ["node_1", "non_existent", "node_2"],
        },
      ];

      const result = validateHighlightIds(highlights, graph);
      expect(result.valid).toBe(false);
    });
  });

  describe("Request ID Safety", () => {
    describe("isRequestIdSafe", () => {
      it("accepts alphanumeric IDs", () => {
        expect(isRequestIdSafe("abc123")).toBe(true);
        expect(isRequestIdSafe("ABC123")).toBe(true);
        expect(isRequestIdSafe("ABCabc123")).toBe(true);
      });

      it("accepts IDs with dots, underscores, and hyphens", () => {
        expect(isRequestIdSafe("my-trace-id-123")).toBe(true);
        expect(isRequestIdSafe("my_trace_id_123")).toBe(true);
        expect(isRequestIdSafe("my.trace.id.123")).toBe(true);
        expect(isRequestIdSafe("my-trace_id.123")).toBe(true);
      });

      it("accepts UUID format", () => {
        expect(isRequestIdSafe("550e8400-e29b-41d4-a716-446655440000")).toBe(true);
      });

      it("rejects IDs with special characters", () => {
        expect(isRequestIdSafe("<script>")).toBe(false);
        expect(isRequestIdSafe("id\nwith\nnewlines")).toBe(false);
        expect(isRequestIdSafe("id with spaces")).toBe(false);
        expect(isRequestIdSafe("id/with/slashes")).toBe(false);
        expect(isRequestIdSafe("id:with:colons")).toBe(false);
        expect(isRequestIdSafe("id@with@at")).toBe(false);
        expect(isRequestIdSafe("id;with;semicolons")).toBe(false);
      });

      it("rejects empty string", () => {
        expect(isRequestIdSafe("")).toBe(false);
      });

      it("rejects IDs longer than 64 characters", () => {
        expect(isRequestIdSafe("a".repeat(64))).toBe(true);
        expect(isRequestIdSafe("a".repeat(65))).toBe(false);
      });
    });

    describe("SafeRequestId schema", () => {
      it("validates safe request IDs", () => {
        expect(SafeRequestId.safeParse("my-trace-id-123").success).toBe(true);
        expect(SafeRequestId.safeParse("abc_def.ghi-123").success).toBe(true);
      });

      it("rejects unsafe request IDs", () => {
        expect(SafeRequestId.safeParse("<script>alert(1)</script>").success).toBe(false);
        expect(SafeRequestId.safeParse("id with spaces").success).toBe(false);
      });

      it("rejects empty string", () => {
        expect(SafeRequestId.safeParse("").success).toBe(false);
      });

      it("rejects IDs over 64 characters", () => {
        expect(SafeRequestId.safeParse("a".repeat(65)).success).toBe(false);
      });
    });

    describe("SAFE_REQUEST_ID_PATTERN", () => {
      it("matches expected pattern", () => {
        expect(SAFE_REQUEST_ID_PATTERN.test("valid-id")).toBe(true);
        expect(SAFE_REQUEST_ID_PATTERN.test("invalid id")).toBe(false);
      });
    });
  });
});
