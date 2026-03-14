/**
 * Zone 2 deduplication test.
 *
 * Verifies that when a decision_continuity block is present, the prompt assembler
 * does not duplicate stage/goal/options/constraints in the raw text output.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Minimal stubs for prompt-loader ──────────────────────────────────────────
vi.mock("../../../../src/adapters/llm/prompt-loader.js", () => ({
  getSystemPrompt: vi.fn().mockResolvedValue("STATIC_ZONE1"),
  getSystemPromptMeta: vi.fn().mockReturnValue({ prompt_id: "test", version: "1" }),
}));

import { assembleV2SystemPrompt as _assembleV2SystemPrompt } from "../../../../src/orchestrator/pipeline/phase3-llm/prompt-assembler.js";
import type { EnrichedContext } from "../../../../src/orchestrator/pipeline/types.js";

// Wrapper: tests use the .text property of the new AssembledSystemPrompt return type
const assembleV2SystemPrompt = async (...args: Parameters<typeof _assembleV2SystemPrompt>): Promise<string> =>
  (await _assembleV2SystemPrompt(...args)).text;

// ============================================================================
// Fixtures
// ============================================================================

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    graph: null,
    analysis: null,
    framing: { stage: "evaluate", goal: "Achieve MRR Target", constraints: ["Budget < £10k"], options: ["Option A"] },
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "evaluate", confidence: "high", source: "explicit_event" },
    intent_classification: "explain",
    decision_archetype: { type: null, confidence: "low", evidence: "" },
    progress_markers: [],
    stuck: { detected: false, rescue_routes: [] },
    conversational_state: {
      active_entities: [],
      stated_constraints: [],
      current_topic: { topic: null },
      last_failed_action: null,
    },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: "socratic", calibration_tendency: "unknown", challenge_tolerance: "medium" },
    scenario_id: "test-scenario",
    turn_id: "test-turn",
    decision_continuity: {
      goal: "Achieve MRR Target",
      options: ["Option A"],
      constraints: ["Budget < £10k"],
      stage: "evaluate",
      graph_version: null,
      analysis_status: "none",
      top_drivers: [],
      top_uncertainties: [],
      last_patch_summary: null,
      active_proposal: null,
      assumption_count: 0,
    },
    ...overrides,
  } as unknown as EnrichedContext;
}

// ============================================================================
// Tests
// ============================================================================

describe("assembleV2SystemPrompt — Zone 2 deduplication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("includes <decision_state> block when decision_continuity is present", async () => {
    const ctx = makeEnrichedContext();
    const prompt = await assembleV2SystemPrompt(ctx);
    expect(prompt).toContain("<decision_state>");
    expect(prompt).toContain("</decision_state>");
  });

  it("does not duplicate goal text when decision_continuity is present", async () => {
    const ctx = makeEnrichedContext();
    const prompt = await assembleV2SystemPrompt(ctx);
    // "Decision goal:" line should NOT appear — it's in decision_state instead
    expect(prompt).not.toContain("Decision goal:");
  });

  it("does not duplicate stage line when decision_continuity is present", async () => {
    const ctx = makeEnrichedContext();
    const prompt = await assembleV2SystemPrompt(ctx);
    // "Current stage:" standalone line should NOT appear
    expect(prompt).not.toContain("Current stage:");
  });

  it("does not duplicate Options as a standalone framing line when decision_continuity is present", async () => {
    const ctx = makeEnrichedContext();
    const prompt = await assembleV2SystemPrompt(ctx);
    // The framing "Options: ..." line should appear exactly once — only inside <decision_state>
    // not also as a standalone Zone 2 framing line outside the block.
    const optionsLineCount = prompt.split("\n").filter(
      (line) => line.startsWith("Options:"),
    ).length;
    // Should appear at most once (inside decision_state), not twice (decision_state + framing)
    expect(optionsLineCount).toBeLessThanOrEqual(1);
  });

  it("still includes stage confidence line (not duplicated by decision_state)", async () => {
    const ctx = makeEnrichedContext();
    const prompt = await assembleV2SystemPrompt(ctx);
    expect(prompt).toContain("Stage confidence:");
  });

  it("includes stage/goal/options/constraints when decision_continuity absent", async () => {
    const ctx = makeEnrichedContext({ decision_continuity: undefined });
    const prompt = await assembleV2SystemPrompt(ctx);
    expect(prompt).toContain("Current stage:");
    expect(prompt).toContain("Decision goal:");
  });

  it("includes referenced_entity blocks when entities are present", async () => {
    const ctx = makeEnrichedContext({
      referenced_entities: [
        {
          id: "churn",
          label: "Churn Rate",
          kind: "factor",
          value: 0.05,
          source: "assumption",
          edges: [{ connected_label: "Revenue", strength: 0.7 }],
        },
      ],
    });
    const prompt = await assembleV2SystemPrompt(ctx);
    expect(prompt).toContain('<referenced_entity>');
    expect(prompt).toContain("Churn Rate");
    expect(prompt).toContain("</referenced_entity>");
  });

  it("does not include referenced_entity blocks when no entities matched", async () => {
    const ctx = makeEnrichedContext({ referenced_entities: undefined });
    const prompt = await assembleV2SystemPrompt(ctx);
    expect(prompt).not.toContain("<referenced_entity");
  });

  it("does not duplicate full option labels when compact graph is also present", async () => {
    // When graph_compact is present, decision_state should emit a count reference ("Options: N (see graph below)")
    // not the full option label list — the compact graph block already lists the labels.
    const ctx = makeEnrichedContext({
      graph_compact: {
        nodes: [
          { id: "opt_a", kind: "option", label: "Increase Prices", source: "user" },
          { id: "opt_b", kind: "option", label: "Status Quo", source: "user" },
        ],
        edges: [],
        _node_count: 2,
        _edge_count: 0,
      },
      decision_continuity: {
        goal: "Achieve MRR Target",
        options: ["Increase Prices", "Status Quo"],
        constraints: [],
        stage: "evaluate",
        graph_version: null,
        analysis_status: "none",
        top_drivers: [],
        top_uncertainties: [],
        last_patch_summary: null,
        active_proposal: null,
        assumption_count: 0,
      },
    });
    const prompt = await assembleV2SystemPrompt(ctx);

    // The compact graph block lists the full option labels
    expect(prompt).toContain("Increase Prices");
    expect(prompt).toContain("Status Quo");

    // decision_state must NOT repeat the full labels — only a count reference
    const decisionStateMatch = prompt.match(/<decision_state>([\s\S]*?)<\/decision_state>/);
    expect(decisionStateMatch).not.toBeNull();
    const decisionStateBlock = decisionStateMatch![1];
    expect(decisionStateBlock).not.toContain("Increase Prices");
    expect(decisionStateBlock).not.toContain("Status Quo");
    // Instead it should contain the count-only reference (labels already in graph block)
    expect(decisionStateBlock).toContain("2 options");
  });
});
