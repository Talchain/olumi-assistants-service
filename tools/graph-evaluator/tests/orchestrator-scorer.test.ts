import { describe, it, expect } from "vitest";
import { scoreOrchestrator } from "../src/orchestrator-scorer.js";
import type { OrchestratorFixture } from "../src/types.js";

// =============================================================================
// Fixture factory
// =============================================================================

function makeFixture(overrides: Partial<OrchestratorFixture["expected"]> = {}): OrchestratorFixture {
  return {
    id: "test",
    name: "Test",
    description: "Test",
    stage: "evaluate",
    user_message: "Test message",
    expected: {
      expected_tool: null,
      expects_coaching: false,
      min_actions: 0,
      max_actions: 2,
      banned_terms_checked: true,
      expects_uncertainty_language: false,
      ...overrides,
    },
  };
}

const PERFECT_RESPONSE = `<diagnostics>
Route: no tool. Post-analysis conversational response.
Using: canonical_state fields.
Stage: EVALUATE.
</diagnostics>
<response>
  <assistant_text>The analysis suggests Option A leads, driven primarily by its effect on demand volume through the pricing pathway.</assistant_text>
  <blocks></blocks>
  <suggested_actions>
    <action>
      <role>facilitator</role>
      <label>Explore drivers</label>
      <message>What are the most sensitive factors?</message>
    </action>
  </suggested_actions>
</response>`;

// =============================================================================
// Tests
// =============================================================================

describe("scoreOrchestrator", () => {
  it("returns 0 for null input", () => {
    const result = scoreOrchestrator(makeFixture(), null);
    expect(result.overall).toBe(0);
    expect(result.valid_envelope).toBe(false);
  });

  it("returns 0 for empty string", () => {
    const result = scoreOrchestrator(makeFixture(), "");
    expect(result.overall).toBe(0);
  });

  it("scores a well-formed response highly", () => {
    const fixture = makeFixture();
    const result = scoreOrchestrator(fixture, PERFECT_RESPONSE);
    expect(result.valid_envelope).toBe(true);
    expect(result.diagnostics_present).toBe(true);
    expect(result.assistant_text_present).toBe(true);
    expect(result.blocks_tag_present).toBe(true);
    expect(result.actions_tag_present).toBe(true);
    expect(result.xml_well_formed).toBe(true);
    expect(result.no_banned_terms).toBe(true);
    expect(result.overall).toBeGreaterThan(0.9);
  });

  it("fails valid_envelope when diagnostics missing", () => {
    const raw = `<response>
  <assistant_text>Hello</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.diagnostics_present).toBe(false);
    expect(result.valid_envelope).toBe(false);
  });

  it("detects banned terms in user-facing text", () => {
    const raw = `<diagnostics>No tool.</diagnostics>
<response>
  <assistant_text>The elasticity of this factor shows high canonical_state values.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ banned_terms_checked: true });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.no_banned_terms).toBe(false);
  });

  it("allows banned terms in diagnostics (not user-facing)", () => {
    const raw = `<diagnostics>Using canonical_state fields. Checking elasticity triggers.</diagnostics>
<response>
  <assistant_text>The analysis suggests this factor is highly influential.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ banned_terms_checked: true });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.no_banned_terms).toBe(true);
  });

  it("detects tool selection in diagnostics", () => {
    const raw = `<diagnostics>Route: explain_results. Tool: explain_results.</diagnostics>
<response>
  <assistant_text>Here is the explanation.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ expected_tool: "explain_results" });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.tool_selection_correct).toBe(true);
  });

  it("fails tool selection when wrong tool mentioned", () => {
    const raw = `<diagnostics>Route: no tool. Conversational response.</diagnostics>
<response>
  <assistant_text>Let me help.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ expected_tool: "draft_graph" });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.tool_selection_correct).toBe(false);
  });

  it("checks uncertainty language", () => {
    const raw = `<diagnostics>Post-analysis.</diagnostics>
<response>
  <assistant_text>The analysis suggests Option A leads based on current assumptions.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ expects_uncertainty_language: true });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.uncertainty_language).toBe(true);
  });

  it("fails uncertainty language when using absolutes", () => {
    const raw = `<diagnostics>Post-analysis.</diagnostics>
<response>
  <assistant_text>Option A is definitely the best choice and is guaranteed to succeed.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ expects_uncertainty_language: true });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.uncertainty_language).toBe(false);
  });

  it("validates block types", () => {
    const raw = `<diagnostics>Post-analysis.</diagnostics>
<response>
  <assistant_text>Analysis complete.</assistant_text>
  <blocks>
    <block>
      <type>review_card</type>
      <tone>facilitator</tone>
      <title>Key finding</title>
      <content>Important observation.</content>
    </block>
  </blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.block_types_valid).toBe(true);
  });

  it("fails invalid block types", () => {
    const raw = `<diagnostics>Post-analysis.</diagnostics>
<response>
  <assistant_text>Analysis complete.</assistant_text>
  <blocks>
    <block>
      <type>fact_block</type>
      <content>Some fact.</content>
    </block>
  </blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const result = scoreOrchestrator(makeFixture(), raw);
    expect(result.block_types_valid).toBe(false);
  });

  it("validates suggested actions count against hardcoded max (5)", () => {
    const raw = `<diagnostics>Framing.</diagnostics>
<response>
  <assistant_text>Let's explore.</assistant_text>
  <blocks></blocks>
  <suggested_actions>
    <action><role>facilitator</role><label>Option A</label><message>Go with A</message></action>
    <action><role>challenger</role><label>Option B</label><message>Go with B</message></action>
    <action><role>facilitator</role><label>Option C</label><message>Go with C</message></action>
    <action><role>scientist</role><label>Option D</label><message>Go with D</message></action>
    <action><role>facilitator</role><label>Option E</label><message>Go with E</message></action>
    <action><role>challenger</role><label>Option F</label><message>Go with F</message></action>
  </suggested_actions>
</response>`;
    const fixture = makeFixture({ max_actions: 5 });
    const result = scoreOrchestrator(fixture, raw);
    // 6 actions exceeds the hardcoded ACTIONS_MAX of 5
    expect(result.suggested_actions_valid).toBe(false);
  });

  it("checks coaching correctness when coaching expected", () => {
    const raw = `<diagnostics>Coaching play triggered.</diagnostics>
<response>
  <assistant_text>One thing stands out.</assistant_text>
  <blocks>
    <block>
      <type>review_card</type>
      <tone>facilitator</tone>
      <title>Key risk</title>
      <content>Concentration risk detected.</content>
    </block>
  </blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ expects_coaching: true });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.coaching_correct).toBe(true);
  });

  it("fails coaching when review_card expected but missing", () => {
    const raw = `<diagnostics>Post-analysis.</diagnostics>
<response>
  <assistant_text>Everything looks fine.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ expects_coaching: true });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.coaching_correct).toBe(false);
  });

  it("checks forbidden phrases", () => {
    const raw = `<diagnostics>Route.</diagnostics>
<response>
  <assistant_text>It's definitely going to work out.</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ forbidden_phrases: ["definitely"] });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.no_forbidden_phrases).toBe(false);
  });

  it("checks must_contain substrings", () => {
    const raw = `<diagnostics>Framing.</diagnostics>
<response>
  <assistant_text>What is your primary goal? What options are you considering?</assistant_text>
  <blocks></blocks>
  <suggested_actions></suggested_actions>
</response>`;
    const fixture = makeFixture({ must_contain: ["goal", "option"] });
    const result = scoreOrchestrator(fixture, raw);
    expect(result.must_contain_met).toBe(true);
  });
});
