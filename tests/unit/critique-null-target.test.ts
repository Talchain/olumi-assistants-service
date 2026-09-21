/**
 * critique_graph — a GRAPH-WIDE finding has no target node, and the model
 * spells that as JSON `null`.
 *
 * THE LIVE DEFECT (deployed staging `52b187e7`, measured 2026-08-24):
 * `POST /assist/critique-graph` intermittently 500s with
 * `anthropic_critique_invalid_schema`. The Render log names the exact cause:
 *
 *   "first_issues":[{"path":"issues.6.target","message":"Expected string,
 *                    received null","code":"invalid_type",
 *                    "expected":"string","received":"null"}]
 *
 * `LLMCritiqueResponse.issues[].target` was `z.string().optional()` — which
 * accepts the key being ABSENT but rejects it being `null`. The model emits
 * `null` for findings that are about the graph as a whole rather than about one
 * node ("Both options converge to the same generic outcome…"), and `null` is
 * the honest answer there: there is no single target.
 *
 * THE FIX SHAPE — reuse, not a new vocabulary. `target?: string` (absent) is
 * ALREADY this estate's spelling of an untargeted critique: it is what the
 * adapter's own return type, `CritiqueIssue` (src/adapters/llm/types.ts:289)
 * and the route's `CritiqueGraphOutput` (src/schemas/assist.ts:562) all say,
 * and the published contract expresses the same concept as an absent
 * `affected_node_ids` on `EnrichmentCritiqueSchema`/`TransportedCritiqueSchema`.
 * `null` and absent therefore MEAN THE SAME THING here, so `null` is accepted
 * and NORMALISED TO ABSENT rather than given a second name.
 *
 * The rejected alternative was to compel the model to always name a target.
 * That would make the product attribute a graph-wide criticism to a node that
 * did not cause it — fabricated provenance, worse than the 500.
 *
 * WHAT THIS SPEC PINS (opposite-direction twins — closing the null case must
 * NOT open the schema to junk):
 *   1. null target  → accepted, and normalised to ABSENT (not `null`, not "")
 *   2. real target  → still accepted, and STILL CARRIES that exact string
 *   3. absent target→ still accepted (unchanged)
 *   4. junk target  → still REJECTED (number / object / array)
 *   5. junk elsewhere in the same issue → still REJECTED (short note, bad level)
 *   6. the adapter no longer throws anthropic_critique_invalid_schema on (1)
 *   7. the adapter's output still satisfies the route's CritiqueGraphOutput
 *
 * Every assertion binds to `target` BY NAME on an issue identified BY ITS NOTE,
 * never by a value predicate another issue could satisfy (trap 19).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { GraphT } from "../../src/schemas/graph.js";
import { LLMCritiqueResponse } from "../../src/adapters/llm/shared-schemas.js";
import { CritiqueGraphOutput } from "../../src/schemas/assist.js";

// ---------------------------------------------------------------------------
// SDK mock — capture the spy before vi.mock() hoists it
// ---------------------------------------------------------------------------

const mockCreate = vi.fn();
const mockStream = vi.fn();

vi.mock("@anthropic-ai/sdk", () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate, stream: mockStream };
  },
}));

// Stub the prompt loader to avoid Supabase network calls in unit tests.
vi.mock("../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("mock system prompt"),
  getSystemPromptMeta: vi.fn().mockReturnValue({
    taskId: "critique_graph",
    prompt_hash: "abc",
    source: "default",
    version: null,
    instance_id: undefined,
    cache_age_ms: undefined,
    cache_status: "test",
    use_staging_mode: false,
  }),
  buildDraftPrompt: vi.fn().mockResolvedValue({ system: "mock system", userContent: "mock user content" }),
  invalidatePromptCache: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Note text used as the IDENTITY of the graph-wide issue in every assertion. */
const GRAPH_WIDE_NOTE =
  "Both options (Premium pricing, Volume pricing) converge to the same generic outcome node.";
/** Note text used as the IDENTITY of the node-scoped issue in every assertion. */
const NODE_SCOPED_NOTE = "Edge goal_1::dec_1 lacks a provenance source and cannot be weighted.";

/**
 * A RECORDED-SHAPE response: exactly the payload class that 500s on deployed
 * `52b187e7` — a graph-wide issue carrying `target: null` alongside an ordinary
 * node-scoped issue that carries a real target. Both must survive.
 */
const CRITIQUE_JSON_WITH_NULL_TARGET = JSON.stringify({
  issues: [
    { level: "IMPROVEMENT", note: GRAPH_WIDE_NOTE, target: null },
    { level: "OBSERVATION", note: NODE_SCOPED_NOTE, target: "goal_1::dec_1::0" },
  ],
  suggested_fixes: ["Give each option its own outcome node"],
  overall_quality: "fair",
});

function makeResponse(content: object[]) {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    content,
    model: "claude-sonnet-5",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

const MINIMAL_GRAPH = {
  nodes: [
    { id: "goal_1", kind: "goal", label: "Grow ARR by 25%" },
    { id: "dec_1", kind: "decision", label: "Choose a pricing strategy" },
  ],
  edges: [{ from: "goal_1", to: "dec_1" }],
} as unknown as GraphT;

/** Build a one-issue critique payload with `target` set to an arbitrary value. */
function issueWithTarget(target: unknown): unknown {
  return {
    issues: [{ level: "IMPROVEMENT", note: GRAPH_WIDE_NOTE, target }],
    suggested_fixes: [],
    overall_quality: "fair",
  };
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("critique_graph — graph-wide findings carry no target (null ≡ absent)", () => {
  describe("LLMCritiqueResponse — the schema that produced the live 500", () => {
    it("ACCEPTS target: null and NORMALISES it to absent", () => {
      const parsed = LLMCritiqueResponse.safeParse(issueWithTarget(null));
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;

      const issue = parsed.data.issues.find((i) => i.note === GRAPH_WIDE_NOTE);
      expect(issue, "the graph-wide issue must survive parsing").toBeDefined();
      // Normalisation, not mere acceptance: `null` must not reach a consumer.
      expect(issue!.target).toBeUndefined();
      expect(issue!.target).not.toBeNull();
      // And it must serialise as a genuinely ABSENT key, exactly as an omitted
      // target does today — the estate's existing spelling of "no target".
      expect(Object.prototype.hasOwnProperty.call(JSON.parse(JSON.stringify(issue!)), "target")).toBe(
        false,
      );
    });

    it("TWIN: still accepts a real target AND still carries that exact string", () => {
      const parsed = LLMCritiqueResponse.safeParse(issueWithTarget("goal_1::dec_1::0"));
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      const issue = parsed.data.issues.find((i) => i.note === GRAPH_WIDE_NOTE);
      expect(issue!.target).toBe("goal_1::dec_1::0");
    });

    it("TWIN: still accepts an ABSENT target (behaviour unchanged)", () => {
      const parsed = LLMCritiqueResponse.safeParse({
        issues: [{ level: "IMPROVEMENT", note: GRAPH_WIDE_NOTE }],
        suggested_fixes: [],
      });
      expect(parsed.success).toBe(true);
      if (!parsed.success) return;
      expect(parsed.data.issues.find((i) => i.note === GRAPH_WIDE_NOTE)!.target).toBeUndefined();
    });

    it.each([
      ["a number", 42],
      ["an object", { node: "dec_1" }],
      ["an array", ["dec_1"]],
      ["a boolean", true],
    ])("TWIN: still REJECTS a malformed target — %s", (_label, bad) => {
      const parsed = LLMCritiqueResponse.safeParse(issueWithTarget(bad));
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      // Bind the rejection to the `target` field by name, not to "some error".
      expect(parsed.error.issues.some((i) => i.path.join(".") === "issues.0.target")).toBe(true);
    });

    it("TWIN: junk ELSEWHERE in the same issue is still rejected even when target is null", () => {
      const tooShortNote = LLMCritiqueResponse.safeParse({
        issues: [{ level: "IMPROVEMENT", note: "short", target: null }],
        suggested_fixes: [],
      });
      expect(tooShortNote.success).toBe(false);
      if (!tooShortNote.success) {
        expect(tooShortNote.error.issues.some((i) => i.path.join(".") === "issues.0.note")).toBe(true);
      }

      const badLevel = LLMCritiqueResponse.safeParse({
        issues: [{ level: "CATASTROPHE", note: GRAPH_WIDE_NOTE, target: null }],
        suggested_fixes: [],
      });
      expect(badLevel.success).toBe(false);
      if (!badLevel.success) {
        expect(badLevel.error.issues.some((i) => i.path.join(".") === "issues.0.level")).toBe(true);
      }
    });

    it("TWIN: a null NOTE is still rejected — nullability is scoped to `target` alone", () => {
      const parsed = LLMCritiqueResponse.safeParse({
        issues: [{ level: "IMPROVEMENT", note: null, target: "dec_1" }],
        suggested_fixes: [],
      });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;
      expect(parsed.error.issues.some((i) => i.path.join(".") === "issues.0.note")).toBe(true);
    });
  });

  describe("critiqueGraphWithAnthropic — the throw site of the live 500", () => {
    beforeEach(() => {
      vi.resetModules();
      mockCreate.mockReset();
      mockStream.mockReset();
      vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
      vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "false");
    });

    afterEach(() => {
      vi.unstubAllEnvs();
      vi.restoreAllMocks();
    });

    it("no longer throws anthropic_critique_invalid_schema on a null-target issue", async () => {
      mockCreate.mockResolvedValue(
        makeResponse([{ type: "text", text: CRITIQUE_JSON_WITH_NULL_TARGET }]),
      );
      const { critiqueGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

      const result = await critiqueGraphWithAnthropic({
        graph: MINIMAL_GRAPH,
        model: "claude-sonnet-5",
      });

      // Identity-bound: find each issue by its NOTE, then assert ITS target.
      const graphWide = result.issues.find((i) => i.note === GRAPH_WIDE_NOTE);
      const nodeScoped = result.issues.find((i) => i.note === NODE_SCOPED_NOTE);
      expect(graphWide, "graph-wide issue must be returned, not dropped").toBeDefined();
      expect(nodeScoped, "node-scoped issue must be returned, not dropped").toBeDefined();
      expect(graphWide!.target).toBeUndefined();
      expect(nodeScoped!.target).toBe("goal_1::dec_1::0");
    });

    it("the adapter's result still satisfies the route contract CritiqueGraphOutput", async () => {
      mockCreate.mockResolvedValue(
        makeResponse([{ type: "text", text: CRITIQUE_JSON_WITH_NULL_TARGET }]),
      );
      const { critiqueGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

      const result = await critiqueGraphWithAnthropic({
        graph: MINIMAL_GRAPH,
        model: "claude-sonnet-5",
      });

      const out = CritiqueGraphOutput.safeParse({
        issues: result.issues,
        suggested_fixes: result.suggested_fixes,
        overall_quality: result.overall_quality,
      });
      expect(out.success).toBe(true);
      if (!out.success) return;
      const graphWide = out.data.issues.find((i) => i.note === GRAPH_WIDE_NOTE);
      expect(graphWide!.target).toBeUndefined();
      // The wire the UI receives: `target` simply absent, exactly as for an
      // issue the model chose to omit it on.
      const wire = JSON.parse(JSON.stringify(out.data)) as {
        issues: Array<Record<string, unknown>>;
      };
      const wireIssue = wire.issues.find((i) => i.note === GRAPH_WIDE_NOTE)!;
      expect(Object.prototype.hasOwnProperty.call(wireIssue, "target")).toBe(false);
    });

    it("CONTROL: a genuinely malformed response is STILL rejected with anthropic_critique_invalid_schema", async () => {
      mockCreate.mockResolvedValue(
        makeResponse([
          {
            type: "text",
            text: JSON.stringify({
              issues: [{ level: "IMPROVEMENT", note: GRAPH_WIDE_NOTE, target: 42 }],
              suggested_fixes: [],
            }),
          },
        ]),
      );
      const { critiqueGraphWithAnthropic } = await import("../../src/adapters/llm/anthropic.js");

      await expect(
        critiqueGraphWithAnthropic({ graph: MINIMAL_GRAPH, model: "claude-sonnet-5" }),
      ).rejects.toThrow("anthropic_critique_invalid_schema");
    });
  });
});
