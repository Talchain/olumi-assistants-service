/**
 * Tests for route-boundary shape validation (C.1 + Brief C system events).
 * Verifies that graph, analysis_response, and system_event schemas reject malformed inputs at the Zod level.
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// Re-create the schemas locally to test them in isolation
// (matches the schemas in src/orchestrator/route.ts)

const GraphSchema = z.object({
  nodes: z.array(z.object({ id: z.string(), kind: z.string() }).passthrough()),
  edges: z.array(z.object({ from: z.string(), to: z.string() }).passthrough()),
}).passthrough().nullable();

const AnalysisResponseSchema = z.object({
  analysis_status: z.string(),
}).passthrough().nullable();

const AnalysisStateSchema = z.object({
  meta: z.object({
    response_hash: z.string().min(1),
    seed_used: z.number().optional(),
    n_samples: z.number().optional(),
  }).passthrough(),
  results: z.array(z.unknown()).optional(),
  analysis_status: z.string().optional(),
  fact_objects: z.array(z.unknown()).optional(),
  review_cards: z.array(z.unknown()).optional(),
  response_hash: z.string().optional(),
  option_comparison: z.array(z.unknown()).optional(),
}).passthrough().refine(
  (val) => val.results || val.option_comparison,
  { message: 'analysis_state must include results or option_comparison' },
).nullable();

const ToolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.unknown()),
});

const ConversationMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().nullable().optional().transform((v) => v ?? ''),
  tool_calls: z.array(ToolCallSchema).optional(),
  assistant_tool_calls: z.array(ToolCallSchema).optional(),
}).transform((message) => ({
  role: message.role,
  content: message.content,
  ...(message.tool_calls
    ? { tool_calls: message.tool_calls }
    : message.assistant_tool_calls
      ? { tool_calls: message.assistant_tool_calls }
      : {}),
}));

// ── SystemEventSchema (from route.ts) ──────────────────────────────────────
const SystemEventBase = {
  timestamp: z.string(),
  event_id: z.string().min(1),
};

const SystemEventSchema = z.discriminatedUnion('event_type', [
  z.object({
    event_type: z.literal('patch_accepted'),
    ...SystemEventBase,
    details: z.object({
      patch_id: z.string().min(1).optional(),
      block_id: z.string().min(1).optional(),
      operations: z.array(z.record(z.unknown())),
      applied_graph_hash: z.string().optional(),
    }).superRefine((val, ctx) => {
      if (!val.patch_id && !val.block_id) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['details'],
          message: 'At least one of patch_id or block_id must be provided',
        });
      }
    }),
  }),
  z.object({
    event_type: z.literal('patch_dismissed'),
    ...SystemEventBase,
    details: z.object({
      patch_id: z.string().optional(),
      block_id: z.string().optional(),
      reason: z.string().optional(),
    }),
  }),
  z.object({
    event_type: z.literal('direct_graph_edit'),
    ...SystemEventBase,
    details: z.object({
      changed_node_ids: z.array(z.string()),
      changed_edge_ids: z.array(z.string()),
      operations: z.array(z.enum(['add', 'update', 'remove'])),
    }),
  }),
  z.object({
    event_type: z.literal('direct_analysis_run'),
    ...SystemEventBase,
    details: z.object({}).passthrough(),
  }),
  z.object({
    event_type: z.literal('feedback_submitted'),
    ...SystemEventBase,
    details: z.object({
      turn_id: z.string(),
      rating: z.enum(['up', 'down']),
      comment: z.string().optional(),
    }),
  }),
]);

describe("Route-Boundary Shape Validation (C.1)", () => {
  describe("GraphSchema", () => {
    it("accepts valid graph with nodes and edges", () => {
      const result = GraphSchema.safeParse({
        nodes: [
          { id: "goal_1", kind: "goal", label: "Revenue" },
          { id: "factor_1", kind: "factor", label: "Price" },
        ],
        edges: [
          { from: "factor_1", to: "goal_1", strength: { mean: 0.5, std: 0.1 } },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("accepts null graph (nullable)", () => {
      const result = GraphSchema.safeParse(null);
      expect(result.success).toBe(true);
    });

    it("rejects graph with nodes as string instead of array", () => {
      const result = GraphSchema.safeParse({
        nodes: "not an array",
        edges: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects graph with edges as string instead of array", () => {
      const result = GraphSchema.safeParse({
        nodes: [],
        edges: "not an array",
      });
      expect(result.success).toBe(false);
    });

    it("rejects graph with missing nodes", () => {
      const result = GraphSchema.safeParse({ edges: [] });
      expect(result.success).toBe(false);
    });

    it("rejects node without id", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ kind: "factor", label: "Price" }],
        edges: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects node without kind", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "factor_1", label: "Price" }],
        edges: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects edge without from", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "a", kind: "factor" }],
        edges: [{ to: "a" }],
      });
      expect(result.success).toBe(false);
    });

    it("rejects edge without to", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "a", kind: "factor" }],
        edges: [{ from: "a" }],
      });
      expect(result.success).toBe(false);
    });

    it("passes through extra fields on graph (passthrough)", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "goal_1", kind: "goal" }],
        edges: [],
        goal_node_id: "goal_1",
        version: "v3",
        extra_metadata: { foo: "bar" },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).goal_node_id).toBe("goal_1");
      }
    });

    it("passes through extra fields on nodes (passthrough)", () => {
      const result = GraphSchema.safeParse({
        nodes: [{ id: "n1", kind: "factor", label: "X", custom: true }],
        edges: [],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data!.nodes[0] as any).custom).toBe(true);
      }
    });
  });

  describe("AnalysisResponseSchema", () => {
    it("accepts valid analysis_response with analysis_status", () => {
      const result = AnalysisResponseSchema.safeParse({
        analysis_status: "completed",
        results: [{ option_id: "a", win_probability: 0.6 }],
      });
      expect(result.success).toBe(true);
    });

    it("accepts null analysis_response (nullable)", () => {
      const result = AnalysisResponseSchema.safeParse(null);
      expect(result.success).toBe(true);
    });

    it("rejects analysis_response missing analysis_status", () => {
      const result = AnalysisResponseSchema.safeParse({
        results: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects analysis_response with non-string analysis_status", () => {
      const result = AnalysisResponseSchema.safeParse({
        analysis_status: 42,
      });
      expect(result.success).toBe(false);
    });

    it("passes through extra fields (passthrough)", () => {
      const result = AnalysisResponseSchema.safeParse({
        analysis_status: "completed",
        results: [],
        robustness: { level: "high" },
        custom_field: "extra",
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).custom_field).toBe("extra");
      }
    });
  });

  describe("AnalysisStateSchema", () => {
    it("accepts top-level analysis_state with the minimum Path A shape", () => {
      const result = AnalysisStateSchema.safeParse({
        analysis_status: "completed",
        meta: { response_hash: "rh-1", seed_used: 1, n_samples: 1000 },
        results: [],
      });
      expect(result.success).toBe(true);
    });

    it("rejects top-level analysis_state when meta is missing", () => {
      const result = AnalysisStateSchema.safeParse({
        analysis_status: "completed",
        results: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects top-level analysis_state when meta.response_hash is missing", () => {
      const result = AnalysisStateSchema.safeParse({
        analysis_status: "completed",
        meta: { seed_used: 1, n_samples: 1000 },
        results: [],
      });
      expect(result.success).toBe(false);
    });

    it("rejects top-level analysis_state when both results and option_comparison are missing", () => {
      const result = AnalysisStateSchema.safeParse({
        analysis_status: "completed",
        meta: { response_hash: "rh-1" },
      });
      expect(result.success).toBe(false);
    });

    it("accepts analysis_state with option_comparison instead of results (UI/PLoT v2 shape)", () => {
      const result = AnalysisStateSchema.safeParse({
        analysis_status: "computed",
        meta: { response_hash: "test" },
        option_comparison: [
          { option_id: "opt_1", option_label: "A", win_probability: 0.65 },
        ],
      });
      expect(result.success).toBe(true);
    });

    it("option_comparison-only analysis_state produces non-null analysis_response (feeds has_analysis: true)", async () => {
      // Import the real schema and normalizer to prove end-to-end data flow
      const { TurnRequestSchema } = await import("../../../src/orchestrator/route-schemas.js");
      const { normalizeContext } = await import("../../../src/orchestrator/request-normalization.js");

      const payload = {
        message: "What does the analysis show?",
        scenario_id: "test-scenario",
        client_turn_id: "test-turn-001",
        analysis_state: {
          analysis_status: "computed",
          meta: { response_hash: "test" },
          option_comparison: [
            { option_id: "opt_1", option_label: "A", win_probability: 0.65 },
          ],
        },
      };

      // Step 1: Zod accepts the payload
      const parsed = TurnRequestSchema.safeParse(payload);
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      // Step 2: normalizeContext maps analysis_state to analysis_response (non-null)
      const context = normalizeContext(parsed.data);
      expect(context.analysis_response).not.toBeNull();
      expect((context.analysis_response as Record<string, unknown>).option_comparison).toEqual([
        { option_id: "opt_1", option_label: "A", win_probability: 0.65 },
      ]);
    });

    it("accepts analysis_state with results but no option_comparison", () => {
      const result = AnalysisStateSchema.safeParse({
        meta: { response_hash: "rh-1" },
        results: [{ option_id: "opt_1" }],
      });
      expect(result.success).toBe(true);
    });
  });

  describe("ConversationMessageSchema", () => {
    it("accepts assistant_tool_calls as an ingress alias and normalises to tool_calls", () => {
      const result = ConversationMessageSchema.safeParse({
        role: "assistant",
        content: null,
        assistant_tool_calls: [{ name: "edit_graph", input: { edit_description: "Reduce it by 10%" } }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool_calls).toEqual([{ name: "edit_graph", input: { edit_description: "Reduce it by 10%" } }]);
        expect((result.data as Record<string, unknown>).assistant_tool_calls).toBeUndefined();
        expect(result.data.content).toBe("");
      }
    });

    it("prefers canonical tool_calls when both tool_calls and assistant_tool_calls are present", () => {
      const result = ConversationMessageSchema.safeParse({
        role: "assistant",
        content: "ok",
        tool_calls: [{ name: "edit_graph", input: { edit_description: "canonical" } }],
        assistant_tool_calls: [{ name: "edit_graph", input: { edit_description: "alias" } }],
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.tool_calls).toEqual([{ name: "edit_graph", input: { edit_description: "canonical" } }]);
      }
    });
  });

  // ── FramingSchema (A.4 type-tightening) ──────────────────────────────────

  describe("FramingSchema — string constraints and limits", () => {
    const FramingSchema = z.object({
      stage: z.enum(['frame', 'ideate', 'evaluate', 'decide', 'optimise']),
      goal: z.string().optional(),
      constraints: z.array(z.string().max(200)).max(20).optional(),
      options: z.array(z.string().max(200)).max(20).optional(),
    }).nullable();

    it("accepts valid framing with string options and constraints", () => {
      const result = FramingSchema.safeParse({
        stage: "evaluate",
        goal: "Maximise revenue",
        options: ["Launch now", "Delay 6 months"],
        constraints: ["Budget < $500k"],
      });
      expect(result.success).toBe(true);
    });

    it("rejects framing with more than 20 options", () => {
      const result = FramingSchema.safeParse({
        stage: "evaluate",
        options: Array.from({ length: 21 }, (_, i) => `Option ${i}`),
      });
      expect(result.success).toBe(false);
    });

    it("rejects framing with more than 20 constraints", () => {
      const result = FramingSchema.safeParse({
        stage: "evaluate",
        constraints: Array.from({ length: 21 }, (_, i) => `Constraint ${i}`),
      });
      expect(result.success).toBe(false);
    });

    it("rejects framing with an option string exceeding 200 chars", () => {
      const result = FramingSchema.safeParse({
        stage: "ideate",
        options: ["a".repeat(201)],
      });
      expect(result.success).toBe(false);
    });

    it("rejects framing with a constraint string exceeding 200 chars", () => {
      const result = FramingSchema.safeParse({
        stage: "ideate",
        constraints: ["b".repeat(201)],
      });
      expect(result.success).toBe(false);
    });

    it("accepts framing with exactly 20 options (boundary)", () => {
      const result = FramingSchema.safeParse({
        stage: "ideate",
        options: Array.from({ length: 20 }, (_, i) => `Option ${i}`),
      });
      expect(result.success).toBe(true);
    });

    it("accepts framing with an option string of exactly 200 chars (boundary)", () => {
      const result = FramingSchema.safeParse({
        stage: "ideate",
        options: ["a".repeat(200)],
      });
      expect(result.success).toBe(true);
    });

    it("accepts null framing (nullable)", () => {
      const result = FramingSchema.safeParse(null);
      expect(result.success).toBe(true);
    });
  });

  // ── SystemEventSchema (Brief C) ─────────────────────────────────────────

  describe("SystemEventSchema — discriminated union validation", () => {
    const VALID_BASE = { timestamp: '2026-03-03T00:00:00Z', event_id: 'evt-1' };

    it("accepts valid patch_accepted", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_accepted',
        ...VALID_BASE,
        details: { patch_id: 'p1', operations: [] },
      });
      expect(result.success).toBe(true);
    });

    it("accepts patch_accepted with only block_id (no patch_id)", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_accepted',
        ...VALID_BASE,
        details: { block_id: 'blk-1', operations: [] },
      });
      expect(result.success).toBe(true);
    });

    // Task 2: patch_accepted identifier requirement tests

    it("rejects patch_accepted with both patch_id and block_id absent", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_accepted',
        ...VALID_BASE,
        details: { operations: [] },
      });
      expect(result.success).toBe(false);
    });

    it("rejects patch_accepted with patch_id: '' and block_id: '' (empty strings)", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_accepted',
        ...VALID_BASE,
        details: { patch_id: '', block_id: '', operations: [] },
      });
      expect(result.success).toBe(false);
    });

    it("accepts patch_accepted with only patch_id", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_accepted',
        ...VALID_BASE,
        details: { patch_id: 'p1', operations: [] },
      });
      expect(result.success).toBe(true);
    });

    it("accepts patch_accepted with only block_id — patch_id populated by normalisation", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_accepted',
        ...VALID_BASE,
        details: { block_id: 'blk-1', operations: [] },
      });
      expect(result.success).toBe(true);
    });

    it("accepts patch_accepted with both patch_id and block_id — patch_id takes precedence", () => {
      // Validation passes; normalisation in route.ts leaves patch_id unchanged when both present.
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_accepted',
        ...VALID_BASE,
        details: { patch_id: 'p1', block_id: 'blk-1', operations: [] },
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid patch_dismissed", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_dismissed',
        ...VALID_BASE,
        details: { patch_id: 'p1' },
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid direct_graph_edit", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'direct_graph_edit',
        ...VALID_BASE,
        details: { changed_node_ids: ['n1'], changed_edge_ids: [], operations: ['add'] },
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid direct_analysis_run with empty details", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'direct_analysis_run',
        ...VALID_BASE,
        details: {},
      });
      expect(result.success).toBe(true);
    });

    it("accepts direct_analysis_run with unexpected fields in details (passthrough)", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'direct_analysis_run',
        ...VALID_BASE,
        details: { unexpected_field: 'oops' },
      });
      expect(result.success).toBe(true);
    });

    it("accepts valid feedback_submitted", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'feedback_submitted',
        ...VALID_BASE,
        details: { turn_id: 't1', rating: 'up' },
      });
      expect(result.success).toBe(true);
    });

    it("rejects unknown event_type", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'totally_unknown_event',
        ...VALID_BASE,
        details: {},
      });
      expect(result.success).toBe(false);
    });

    it("rejects missing event_id", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_dismissed',
        timestamp: '2026-03-03T00:00:00Z',
        details: { patch_id: 'p1' },
        // event_id missing
      });
      expect(result.success).toBe(false);
    });

    it("rejects empty event_id string", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'patch_dismissed',
        ...VALID_BASE,
        event_id: '',  // empty — fails .min(1)
        details: { patch_id: 'p1' },
      });
      expect(result.success).toBe(false);
    });

    it("rejects malformed details for feedback_submitted (missing turn_id)", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'feedback_submitted',
        ...VALID_BASE,
        details: { rating: 'up' }, // missing turn_id
      });
      expect(result.success).toBe(false);
    });

    it("rejects invalid rating value for feedback_submitted", () => {
      const result = SystemEventSchema.safeParse({
        event_type: 'feedback_submitted',
        ...VALID_BASE,
        details: { turn_id: 't1', rating: 'meh' }, // invalid rating
      });
      expect(result.success).toBe(false);
    });
  });
});
