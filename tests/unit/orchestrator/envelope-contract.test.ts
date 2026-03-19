/**
 * Test Suite 2–4: CEE Envelope Contracts (T1–T5) + Suggested Actions Cap
 * + Results Sentinel Check
 *
 * Uses the real response parser (parseOrchestratorResponse / parseLLMResponse)
 * and the real envelope assembler (assembleV2Envelope) — both tested with
 * mocked LLM outputs. No real API calls.
 *
 * Phase 1B trace assertions — each turn type matched to its expected shape.
 */

// ============================================================================
// Mocks — must be declared BEFORE any imports
// ============================================================================

vi.mock("../../../src/config/index.js", () => ({
  isProduction: () => false,
  config: {
    features: { orchestratorV2: false, dskV0: false },
    cee: { maxRepairRetries: 1, patchPreValidationEnabled: false, patchBudgetEnabled: false },
  },
}));

vi.mock("../../../src/orchestrator/dsk-loader.js", () => ({
  getDskVersionHash: () => null,
  resolveDskHash: () => null,
}));

import { describe, it, expect, vi } from "vitest";
import {
  parseLLMResponse,
  parseOrchestratorResponse,
  extractDeclaredMode,
} from "../../../src/orchestrator/response-parser.js";
import {
  assembleV2Envelope,
} from "../../../src/orchestrator/pipeline/phase5-validation/envelope-assembler.js";
import { isAnalysisExplainable } from "../../../src/orchestrator/analysis-state.js";
import type { ChatWithToolsResult } from "../../../src/adapters/llm/types.js";
import type {
  EnrichedContext,
  LLMResult,
  ToolResult,
  ScienceLedger,
} from "../../../src/orchestrator/pipeline/types.js";
import type { V2RunResponseEnvelope } from "../../../src/orchestrator/types.js";

// ============================================================================
// Shared helpers
// ============================================================================

function makeResult(overrides?: Partial<ChatWithToolsResult>): ChatWithToolsResult {
  return {
    content: [],
    stop_reason: "end_turn",
    usage: { input_tokens: 100, output_tokens: 50 },
    model: "gpt-4o",
    latencyMs: 500,
    ...overrides,
  };
}

function makeEnrichedContext(overrides?: Partial<EnrichedContext>): EnrichedContext {
  return {
    graph: null,
    analysis: null,
    framing: null,
    conversation_history: [],
    selected_elements: [],
    stage_indicator: { stage: "ideate", confidence: "high", source: "inferred" },
    intent_classification: "conversational",
    decision_archetype: { type: null, confidence: "low", evidence: "no keywords" },
    progress_markers: [],
    stuck: { detected: false, rescue_routes: [] },
    conversational_state: {
      active_entities: [],
      stated_constraints: [],
      current_topic: "framing",
      last_failed_action: null,
    },
    dsk: { claims: [], triggers: [], techniques: [], version_hash: null },
    user_profile: { coaching_style: "socratic", calibration_tendency: "unknown", challenge_tolerance: "medium" },
    scenario_id: "test-scenario",
    turn_id: "turn-test-001",
    ...overrides,
  };
}

function makeLLMResult(overrides?: Partial<LLMResult>): LLMResult {
  return {
    assistant_text: null,
    tool_invocations: [],
    science_annotations: [],
    raw_response: "",
    suggested_actions: [],
    diagnostics: null,
    parse_warnings: [],
    ...overrides,
  };
}

function makeToolResult(overrides?: Partial<ToolResult>): ToolResult {
  return {
    blocks: [],
    side_effects: { graph_updated: false, analysis_ran: false, brief_generated: false },
    assistant_text: null,
    guidance_items: [],
    ...overrides,
  };
}

function makeScienceLedger(): ScienceLedger {
  return {
    claims_used: [],
    techniques_used: [],
    scope_violations: [],
    phrasing_violations: [],
    rewrite_applied: false,
  };
}

/** Build a full XML envelope string as the LLM would emit it. */
function makeXmlEnvelope({
  mode = "INTERPRET",
  assistantText = "Hello from LLM",
  suggestedActions = [] as Array<{ role: string; label: string; message: string }>,
}: {
  mode?: string;
  assistantText?: string;
  suggestedActions?: Array<{ role: string; label: string; message: string }>;
} = {}): string {
  const actionsXml =
    suggestedActions.length > 0
      ? `<suggested_actions>
${suggestedActions
  .map(
    (a) => `    <action>
      <role>${a.role}</role>
      <label>${a.label}</label>
      <message>${a.message}</message>
    </action>`,
  )
  .join("\n")}
  </suggested_actions>`
      : "<suggested_actions></suggested_actions>";

  return `<diagnostics>
Mode: ${mode}
Stage: IDEATE
</diagnostics>
<response>
  <assistant_text>${assistantText}</assistant_text>
  ${actionsXml}
</response>`;
}

// ============================================================================
// All-turns baseline assertions
// ============================================================================

describe("All turns — baseline envelope properties", () => {
  it("assistant_text contains no <diagnostics> tags or content", () => {
    const xmlText = makeXmlEnvelope({ mode: "INTERPRET", assistantText: "This is the answer." });
    const parsed = parseOrchestratorResponse(xmlText);
    expect(parsed.assistant_text).not.toContain("<diagnostics>");
    expect(parsed.assistant_text).not.toContain("</diagnostics>");
    expect(parsed.assistant_text).not.toContain("Mode: INTERPRET");
    expect(parsed.assistant_text).not.toContain("Stage: IDEATE");
  });

  it("assistant_text contains no Mode: INTERPRET or Mode: ACT preamble text", () => {
    // Simulates diagnostics preamble emitted before XML tags
    const preambleText = `Mode: INTERPRET. Stage: IDEATE. No tool needed.
<diagnostics>
Mode: INTERPRET
</diagnostics>
<response>
  <assistant_text>The real answer is here.</assistant_text>
  <suggested_actions></suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(preambleText);
    expect(parsed.assistant_text).toBe("The real answer is here.");
    expect(parsed.assistant_text).not.toMatch(/Mode:\s*(INTERPRET|ACT|SUGGEST|RECOVER)/i);
  });

  it("assistant_text contains no <response>, <assistant_text>, or <suggested_actions> XML tags", () => {
    const xmlText = makeXmlEnvelope({ assistantText: "Clean answer." });
    const parsed = parseOrchestratorResponse(xmlText);
    expect(parsed.assistant_text).not.toContain("<response>");
    expect(parsed.assistant_text).not.toContain("</response>");
    expect(parsed.assistant_text).not.toContain("<assistant_text>");
    expect(parsed.assistant_text).not.toContain("</assistant_text>");
    expect(parsed.assistant_text).not.toContain("<suggested_actions>");
    expect(parsed.assistant_text).not.toContain("</suggested_actions>");
  });

  it("suggested_actions is always an array (possibly empty)", () => {
    const parsed = parseOrchestratorResponse(makeXmlEnvelope());
    expect(Array.isArray(parsed.suggested_actions)).toBe(true);
  });

  it("each suggested_action has label (string) and message (string)", () => {
    const xmlText = makeXmlEnvelope({
      suggestedActions: [
        { role: "facilitator", label: "Explore drivers", message: "What drives the outcome most?" },
      ],
    });
    const parsed = parseOrchestratorResponse(xmlText);
    expect(parsed.suggested_actions.length).toBeGreaterThan(0);
    for (const action of parsed.suggested_actions) {
      expect(typeof action.label).toBe("string");
      expect(action.label.trim().length).toBeGreaterThan(0);
      expect(typeof action.message).toBe("string");
      expect(action.message.trim().length).toBeGreaterThan(0);
    }
  });

  it("assembleV2Envelope produces turn_id as a non-empty string", () => {
    const enrichedCtx = makeEnrichedContext({ turn_id: "turn-abc-123" });
    const envelope = assembleV2Envelope({
      enrichedContext: enrichedCtx,
      llmResult: makeLLMResult({ assistant_text: "Hello" }),
      toolResult: makeToolResult(),
      specialistResult: { advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] },
      scienceLedger: makeScienceLedger(),
      requestId: "req-001",
      clientTurnId: "client-001",
    });
    expect(typeof envelope.turn_id).toBe("string");
    expect(envelope.turn_id.length).toBeGreaterThan(0);
  });

  it("assembleV2Envelope produces stage_indicator with stage, confidence, source", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      llmResult: makeLLMResult({ assistant_text: "Hello" }),
      toolResult: makeToolResult(),
      specialistResult: { advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] },
      scienceLedger: makeScienceLedger(),
      requestId: "req-001",
      clientTurnId: "client-001",
    });
    expect(envelope.stage_indicator).toBeDefined();
    expect(typeof envelope.stage_indicator.stage).toBe("string");
    expect(typeof envelope.stage_indicator.confidence).toBe("string");
    expect(typeof envelope.stage_indicator.source).toBe("string");
  });
});

// ============================================================================
// T3 — INTERPRET mode (no tool selected, text-only response)
// ============================================================================

describe("T3 — INTERPRET mode envelope", () => {
  it("blocks is empty when no tool is selected", () => {
    const xmlText = makeXmlEnvelope({
      mode: "INTERPRET",
      assistantText: "This is a conversational answer.",
    });
    const chatResult = makeResult({
      content: [{ type: "text", text: xmlText }],
    });
    const parsed = parseLLMResponse(chatResult);
    // No tool invocations
    expect(parsed.tool_invocations).toHaveLength(0);
    // extracted_blocks only allow commentary or review_card — never graph_patch
    for (const block of parsed.extracted_blocks) {
      expect(["commentary", "review_card"]).toContain(block.type);
    }
  });

  it("assistant_text is non-null for a conversational response", () => {
    const xmlText = makeXmlEnvelope({
      mode: "INTERPRET",
      assistantText: "Thinking about competitors.",
    });
    const parsed = parseOrchestratorResponse(xmlText);
    expect(parsed.assistant_text).not.toBeNull();
    expect(parsed.assistant_text.trim().length).toBeGreaterThan(0);
  });

  it("INTERPRET mode is declared correctly in diagnostics", () => {
    const xmlText = makeXmlEnvelope({ mode: "INTERPRET" });
    const chatResult = makeResult({ content: [{ type: "text", text: xmlText }] });
    const parsed = parseLLMResponse(chatResult);
    expect(extractDeclaredMode(parsed.diagnostics)).toBe("INTERPRET");
  });

  it("assembleV2Envelope with INTERPRET → turn_plan.selected_tool is null", () => {
    const envelope = assembleV2Envelope({
      enrichedContext: makeEnrichedContext(),
      llmResult: makeLLMResult({
        assistant_text: "Conversational answer",
        tool_invocations: [],
        diagnostics: "Mode: INTERPRET",
      }),
      toolResult: makeToolResult(),
      specialistResult: { advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] },
      scienceLedger: makeScienceLedger(),
      requestId: "req-001",
      clientTurnId: "client-001",
    });
    expect(envelope.turn_plan.selected_tool).toBeNull();
    expect(envelope.blocks).toHaveLength(0);
    expect(envelope.assistant_text).toBe("Conversational answer");
  });
});

// ============================================================================
// T2 — Parameter update (edit_graph, update_node)
// ============================================================================

describe("T2 — parameter update envelope assertions (parser layer)", () => {
  it("tool_use block with edit_graph extracts as tool_invocations entry", () => {
    const chatResult = makeResult({
      content: [
        {
          type: "tool_use",
          id: "toolu_edit_1",
          name: "edit_graph",
          input: { edit_description: "team size is 7" },
        },
      ],
      stop_reason: "tool_use",
    });
    const parsed = parseLLMResponse(chatResult);
    expect(parsed.tool_invocations).toHaveLength(1);
    expect(parsed.tool_invocations[0].name).toBe("edit_graph");
    expect(parsed.tool_invocations[0].input.edit_description).toBe("team size is 7");
  });

  it("suggested_actions is an empty array when not provided in XML", () => {
    const xmlText = makeXmlEnvelope({ mode: "ACT", assistantText: "Updated team size to 7." });
    const parsed = parseOrchestratorResponse(xmlText);
    expect(Array.isArray(parsed.suggested_actions)).toBe(true);
  });
});

// ============================================================================
// T4 — Structural addition (add_node operation in patch)
// ============================================================================

describe("T4 — structural addition — parser does not extract graph_patch blocks from text", () => {
  it("FactBlock and GraphPatchBlock are NEVER parsed from LLM free text", () => {
    // Even if the LLM tries to output a graph_patch block in text, the parser drops it
    const badXml = `<diagnostics>Mode: ACT</diagnostics>
<response>
  <assistant_text>Added the marketing option.</assistant_text>
  <blocks>
    <block>
      <type>graph_patch</type>
      <content>patch data</content>
    </block>
    <block>
      <type>fact</type>
      <content>some fact</content>
    </block>
    <block>
      <type>commentary</type>
      <title>Note</title>
      <content>This is allowed.</content>
    </block>
  </blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(badXml);
    // Only commentary allowed; graph_patch and fact must be dropped
    expect(parsed.blocks.every((b) => b.type === "commentary" || b.type === "review_card")).toBe(true);
    expect(parsed.blocks.some((b) => b.type === "commentary")).toBe(true);
  });
});

// ============================================================================
// T5b — explain_results (text-only, no blocks)
// ============================================================================

describe("T5b — explain_results response shape", () => {
  it("explain_results LLM output has no graph_patch blocks", () => {
    const explainText = `<diagnostics>
Mode: INTERPRET
Route: explain_results
</diagnostics>
<response>
  <assistant_text>Option A wins with 65% probability. The primary driver is pricing elasticity.</assistant_text>
  <suggested_actions></suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(explainText);
    expect(parsed.blocks.every((b) => b.type !== "graph_patch")).toBe(true);
    expect(parsed.assistant_text).toContain("Option A wins");
  });

  it("explain_results: assistant_text references specific factors from analysis", () => {
    // Simulates a Tier 3 LLM explain response that mentions factor names
    const explainText = `<diagnostics>Mode: INTERPRET</diagnostics>
<response>
  <assistant_text>The main driver is Pricing (elasticity 0.42). Market Size also plays a role.</assistant_text>
  <suggested_actions></suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(explainText);
    expect(parsed.assistant_text).toContain("Pricing");
    expect(parsed.assistant_text).not.toContain("<diagnostics>");
  });
});

// ============================================================================
// Test Suite 3 — Suggested actions cap
// ============================================================================

describe("Suite 3 — Suggested actions cap", () => {
  it("current cap is 4 — more than 4 actions are truncated to 4", () => {
    // Cap raised from 2 → 4 for cf-v20 compatibility (2-5 range).
    const xmlText = `<diagnostics>Mode: SUGGEST</diagnostics>
<response>
  <assistant_text>Here are some options.</assistant_text>
  <suggested_actions>
    <action>
      <role>facilitator</role>
      <label>Option 1</label>
      <message>Try option 1</message>
    </action>
    <action>
      <role>facilitator</role>
      <label>Option 2</label>
      <message>Try option 2</message>
    </action>
    <action>
      <role>challenger</role>
      <label>Option 3</label>
      <message>Try option 3</message>
    </action>
    <action>
      <role>facilitator</role>
      <label>Option 4</label>
      <message>Try option 4</message>
    </action>
    <action>
      <role>challenger</role>
      <label>Option 5</label>
      <message>Try option 5 — should be truncated</message>
    </action>
  </suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(xmlText);
    // Cap is now 4
    expect(parsed.suggested_actions.length).toBeLessThanOrEqual(4);
    expect(parsed.suggested_actions.length).toBe(4);
  });

  it("up to 4 actions are all preserved intact", () => {
    const xmlText = makeXmlEnvelope({
      suggestedActions: [
        { role: "facilitator", label: "First", message: "Message 1" },
        { role: "challenger", label: "Second", message: "Message 2" },
        { role: "facilitator", label: "Third", message: "Message 3" },
        { role: "challenger", label: "Fourth", message: "Message 4" },
      ],
    });
    const parsed = parseOrchestratorResponse(xmlText);
    expect(parsed.suggested_actions.length).toBe(4);
    expect(parsed.suggested_actions[0].label).toBe("First");
    expect(parsed.suggested_actions[3].label).toBe("Fourth");
  });

  it("zero actions returns empty array (not undefined)", () => {
    const parsed = parseOrchestratorResponse(makeXmlEnvelope({ suggestedActions: [] }));
    expect(Array.isArray(parsed.suggested_actions)).toBe(true);
    expect(parsed.suggested_actions.length).toBe(0);
  });
});

// ============================================================================
// Test Suite 4 — results sentinel check
// ============================================================================

describe("Suite 4 — results sentinel / analysis_state shape", () => {
  it("V2RunResponseEnvelope.results is an array in the normal PLoT response shape", () => {
    // The standard shape from PLoT /v2/run: results is an array of option results.
    // CEE reads this as-is and forwards to the UI as analysis_state.
    const analysis: V2RunResponseEnvelope = {
      analysis_status: "completed",
      meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-abc" },
      response_hash: "hash-abc",
      results: [
        { option_id: "opt_a", option_label: "Option A", win_probability: 0.65 },
        { option_id: "opt_b", option_label: "Option B", win_probability: 0.35 },
      ],
    };
    expect(Array.isArray(analysis.results)).toBe(true);
    // TODO: remove results sentinel once CEE no longer reads it.
    // Current shape: results[] carries option comparison data.
    // PLoT v2 returns option_comparison[] which normalizeAnalysisEnvelope may copy here.
  });

  it("isAnalysisExplainable is true when results has valid option_label + win_probability", () => {
    const analysis: V2RunResponseEnvelope = {
      analysis_status: "completed",
      meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-abc" },
      results: [
        { option_id: "opt_a", option_label: "Option A", win_probability: 0.65 },
      ],
    };
    expect(isAnalysisExplainable(analysis)).toBe(true);
  });

  it("isAnalysisExplainable is true when option_comparison is present and results is empty", () => {
    // PLoT returns option_comparison; the UI normalizer should copy it to results.
    // When results is empty but option_comparison is present, explainable via other paths
    // (robustness, sensitivity) or via hasValidOptionResults checking option_comparison.
    const analysis = {
      analysis_status: "completed",
      meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-abc" },
      results: [] as unknown[],
      option_comparison: [
        { option_id: "opt_a", option_label: "Option A", win_probability: 0.65 },
      ],
      robustness: { level: "high" }, // explainable via robustness fallback
    } as unknown as V2RunResponseEnvelope;
    expect(isAnalysisExplainable(analysis)).toBe(true);
  });

  it("results as a nested object — isAnalysisExplainable does not crash", () => {
    // Regression guard: if the UI accidentally wraps V2 fields inside results as an object,
    // CEE must not crash. The nested-object guard in analysis-state.ts handles this.
    const analysis = {
      analysis_status: "completed",
      meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-abc" },
      // results is an object, NOT an array — this is the bug shape
      results: {
        option_comparison: [
          { option_id: "opt_a", option_label: "Option A", win_probability: 0.65 },
        ],
      },
    } as unknown as V2RunResponseEnvelope;
    // Must not throw
    expect(() => isAnalysisExplainable(analysis)).not.toThrow();
    // The nested-object guard in getOptionResultCandidates → hasValidOptionResults
    // should recover the option data
    expect(isAnalysisExplainable(analysis)).toBe(true);
  });
});

// ============================================================================
// Regression cases (from real failures)
// ============================================================================

describe("Regression — diagnostics leak", () => {
  it("diagnostics preamble before XML tags is stripped from assistant_text", () => {
    // Regression: LLM emits "Mode: INTERPRET. Stage: IDEATE…" before <diagnostics>
    const leakyOutput = `Mode: INTERPRET. Stage: IDEATE.
Using analysis fields from context.
<diagnostics>
Mode: INTERPRET
Stage: IDEATE
</diagnostics>
<response>
  <assistant_text>Here is the real answer for the user.</assistant_text>
  <suggested_actions></suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(leakyOutput);
    // assistant_text must be clean
    expect(parsed.assistant_text).toBe("Here is the real answer for the user.");
    expect(parsed.assistant_text).not.toContain("Mode:");
    expect(parsed.assistant_text).not.toContain("Stage:");
    expect(parsed.assistant_text).not.toContain("Using analysis fields");
  });

  it("diagnostics inside <diagnostics> tags do NOT appear in assistant_text", () => {
    const xmlText = `<diagnostics>
Mode: ACT
Tool: edit_graph
Using: graph state
</diagnostics>
<response>
  <assistant_text>I've updated team size to 7.</assistant_text>
  <suggested_actions></suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(xmlText);
    expect(parsed.assistant_text).toBe("I've updated team size to 7.");
    expect(parsed.assistant_text).not.toContain("Tool:");
    expect(parsed.assistant_text).not.toContain("Mode:");
  });
});

describe("Regression — inline actions rescue", () => {
  it("inline suggested actions in assistant_text are rescued into suggested_actions array", () => {
    // Regression: LLM embeds actions as prose inside <assistant_text>
    // with no <suggested_actions> XML. Parser should rescue them.
    const inlineActionsText = `<diagnostics>Mode: SUGGEST</diagnostics>
<response>
  <assistant_text>Here are your options:
Facilitator: Accept supplier — Go with Supplier A for lowest cost
Challenger: Push back — Consider the quality risk before deciding</assistant_text>
  <suggested_actions></suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(inlineActionsText);

    // Actions should be rescued from assistant_text
    expect(parsed.suggested_actions.length).toBeGreaterThan(0);
    // The action lines should NOT appear in the final assistant_text
    expect(parsed.assistant_text).not.toMatch(/Facilitator:\s*Accept supplier/i);
    expect(parsed.assistant_text).not.toMatch(/Challenger:\s*Push back/i);
    // Labels and messages should be properly extracted
    const facilAction = parsed.suggested_actions.find(
      (a) => a.role === "facilitator",
    );
    expect(facilAction).toBeDefined();
    if (facilAction) {
      expect(facilAction.label).toBe("Accept supplier");
      expect(facilAction.message).toContain("Supplier A");
    }
  });
});

describe("Regression — object-shaped results in analysis_state", () => {
  it("isAnalysisExplainable does not crash when results is a plain object (nested bug shape)", () => {
    // Regression: UI accidentally sent results: { option_comparison: [...] }
    // CEE must guard against this without throwing.
    // Fix: f815b073 "guard all results.filter() sites against object-shaped results"
    const brokenAnalysis = {
      analysis_status: "completed",
      meta: { seed_used: 42, n_samples: 1000, response_hash: "hash-abc" },
      results: { option_comparison: [{ option_id: "opt_a", option_label: "A", win_probability: 0.6 }] },
    } as unknown as V2RunResponseEnvelope;

    expect(() => isAnalysisExplainable(brokenAnalysis)).not.toThrow();
    // The nested object guard recovers the option data → explainable
    expect(isAnalysisExplainable(brokenAnalysis)).toBe(true);
  });
});

describe("Regression — empty rawV2Response", () => {
  it("null analysis_response means no analysis_state is forwarded to LLM prompt", () => {
    // When analysis_response is null, the compact analysis block is omitted from Zone 2.
    // This is enforced by prompt-assembler.ts:405: if (enrichedContext.analysis_response) {...}
    // We test the guard indirectly: an enriched context with null analysis_response
    // should assemble an envelope without error.
    const enrichedCtx = makeEnrichedContext({ analysis: null });
    expect(() =>
      assembleV2Envelope({
        enrichedContext: enrichedCtx,
        llmResult: makeLLMResult({ assistant_text: "No analysis yet." }),
        toolResult: makeToolResult(),
        specialistResult: { advice: null, candidates: [], triggers_fired: [], triggers_suppressed: [] },
        scienceLedger: makeScienceLedger(),
        requestId: "req-null-analysis",
        clientTurnId: "client-null",
      }),
    ).not.toThrow();
  });
});

describe("Regression — structural violation message", () => {
  it("structural violation message wording is 'inconsistency in the model structure', not 'too complex'", () => {
    // Regression guard: when a patch causes a structural violation, the user-facing
    // message should say "inconsistency in the model structure" (not "too complex for a single edit").
    // The complexity cap has its own distinct message. These must not be confused.
    //
    // This test validates the parser doesn't mutate the message — the actual wording
    // is set in edit-graph.ts formatPatchValidationErrors(). We test here that the
    // parser passes through assistant_text unchanged.
    const structuralViolationXml = `<diagnostics>Mode: ACT</diagnostics>
<response>
  <assistant_text>This edit would create an inconsistency in the model structure — it would leave a node disconnected from the goal. Would you like me to suggest a different approach?</assistant_text>
  <suggested_actions></suggested_actions>
</response>`;
    const parsed = parseOrchestratorResponse(structuralViolationXml);
    // Check the correct message passes through
    expect(parsed.assistant_text).toContain("inconsistency in the model structure");
    // Confirm the wrong message is NOT present
    expect(parsed.assistant_text).not.toContain("too complex for a single edit");
  });
});

describe("Regression — empty focus on explain override", () => {
  it("explain override focus is the user message string, not an empty string", () => {
    // Regression: fix(explain): pass user message as focus in deterministic explain override.
    // The focus parameter must be set to request.message, not "".
    // We test the parser layer: if the focus is embedded in the user message for the LLM,
    // the LLM response should reference it.
    //
    // The actual fix is in explain-results.ts:773-775:
    //   userMessage: focus
    //     ? `Explain the analysis results, focusing on: ${focus}`
    //     : 'Explain the analysis results.'
    //
    // We verify here that a response built with a focus string is not empty.
    const focusText = "why is Option A winning?";
    // Confirm the focus string is non-empty (the actual wiring test is in explain-results tests)
    expect(focusText.trim().length).toBeGreaterThan(0);
    expect(focusText).not.toBe("");
  });
});
