/**
 * Stage Policy Tests
 *
 * Verifies the per-stage tool allowlist and guard function behaviour.
 */

import { describe, it, expect } from "vitest";
import { isToolAllowedAtStage, STAGE_TOOL_POLICY } from "../../../src/orchestrator/tools/stage-policy.js";

// ============================================================================
// Policy table shape
// ============================================================================

describe("STAGE_TOOL_POLICY — allowed sets", () => {
  it("frame: draft_graph and research_topic only", () => {
    const s = STAGE_TOOL_POLICY.frame;
    expect(s.has('draft_graph')).toBe(true);
    expect(s.has('research_topic')).toBe(true);
    expect(s.has('edit_graph')).toBe(false);
    expect(s.has('run_analysis')).toBe(false);
    expect(s.has('explain_results')).toBe(false);
    expect(s.has('generate_brief')).toBe(false);
  });

  it("ideate: edit_graph, research_topic, draft_graph — no run_analysis or explain_results", () => {
    const s = STAGE_TOOL_POLICY.ideate;
    expect(s.has('edit_graph')).toBe(true);
    expect(s.has('research_topic')).toBe(true);
    expect(s.has('draft_graph')).toBe(true);
    expect(s.has('run_analysis')).toBe(false);
    expect(s.has('explain_results')).toBe(false);
    expect(s.has('generate_brief')).toBe(false);
  });

  it("evaluate: run_analysis, explain_results, generate_brief, edit_graph — no draft_graph or research_topic", () => {
    const s = STAGE_TOOL_POLICY.evaluate;
    expect(s.has('run_analysis')).toBe(true);
    expect(s.has('explain_results')).toBe(true);
    expect(s.has('generate_brief')).toBe(true);
    expect(s.has('edit_graph')).toBe(true);
    expect(s.has('draft_graph')).toBe(false);
    expect(s.has('research_topic')).toBe(false);
  });

  it("decide: generate_brief and explain_results only — no edit_graph", () => {
    const s = STAGE_TOOL_POLICY.decide;
    expect(s.has('generate_brief')).toBe(true);
    expect(s.has('explain_results')).toBe(true);
    expect(s.has('edit_graph')).toBe(false);
    expect(s.has('run_analysis')).toBe(false);
    expect(s.has('draft_graph')).toBe(false);
    expect(s.has('research_topic')).toBe(false);
  });

  it("optimise: edit_graph, run_analysis, explain_results, generate_brief", () => {
    const s = STAGE_TOOL_POLICY.optimise;
    expect(s.has('edit_graph')).toBe(true);
    expect(s.has('run_analysis')).toBe(true);
    expect(s.has('explain_results')).toBe(true);
    expect(s.has('generate_brief')).toBe(true);
  });
});

// ============================================================================
// isToolAllowedAtStage guard
// ============================================================================

describe("isToolAllowedAtStage", () => {
  // Bypass tools always pass regardless of stage
  it("run_exercise bypasses policy on all stages", () => {
    for (const stage of ['frame', 'ideate', 'evaluate', 'decide', 'optimise'] as const) {
      expect(isToolAllowedAtStage('run_exercise', stage).allowed).toBe(true);
    }
  });

  it("undo_patch bypasses policy on all stages", () => {
    for (const stage of ['frame', 'ideate', 'evaluate', 'decide', 'optimise'] as const) {
      expect(isToolAllowedAtStage('undo_patch', stage).allowed).toBe(true);
    }
  });

  // Unknown stage → permissive fallback
  it("unknown stage returns allowed: true", () => {
    expect(isToolAllowedAtStage('edit_graph', 'unknown_stage').allowed).toBe(true);
    expect(isToolAllowedAtStage('run_analysis', 'pending').allowed).toBe(true);
  });

  // frame
  it("frame: draft_graph allowed without explicit intent check", () => {
    expect(isToolAllowedAtStage('draft_graph', 'frame').allowed).toBe(true);
  });

  it("frame: edit_graph blocked", () => {
    const r = isToolAllowedAtStage('edit_graph', 'frame');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('frame');
  });

  it("frame: run_analysis blocked", () => {
    expect(isToolAllowedAtStage('run_analysis', 'frame').allowed).toBe(false);
  });

  it("frame: research_topic requires explicit research intent", () => {
    expect(isToolAllowedAtStage('research_topic', 'frame', 'research the market size').allowed).toBe(true);
    expect(isToolAllowedAtStage('research_topic', 'frame', 'what should I do?').allowed).toBe(false);
  });

  // ideate
  it("ideate: edit_graph allowed", () => {
    expect(isToolAllowedAtStage('edit_graph', 'ideate').allowed).toBe(true);
  });

  it("ideate: run_analysis blocked", () => {
    expect(isToolAllowedAtStage('run_analysis', 'ideate').allowed).toBe(false);
  });

  it("ideate: explain_results blocked", () => {
    expect(isToolAllowedAtStage('explain_results', 'ideate').allowed).toBe(false);
  });

  it("ideate: draft_graph requires explicit rebuild intent", () => {
    expect(isToolAllowedAtStage('draft_graph', 'ideate', 'start over').allowed).toBe(true);
    expect(isToolAllowedAtStage('draft_graph', 'ideate', 'add a factor').allowed).toBe(false);
  });

  // evaluate
  it("evaluate: run_analysis allowed", () => {
    expect(isToolAllowedAtStage('run_analysis', 'evaluate').allowed).toBe(true);
  });

  it("evaluate: edit_graph allowed", () => {
    expect(isToolAllowedAtStage('edit_graph', 'evaluate').allowed).toBe(true);
  });

  it("evaluate: draft_graph blocked", () => {
    expect(isToolAllowedAtStage('draft_graph', 'evaluate').allowed).toBe(false);
  });

  it("evaluate: research_topic blocked", () => {
    expect(isToolAllowedAtStage('research_topic', 'evaluate').allowed).toBe(false);
  });

  // decide
  it("decide: generate_brief allowed", () => {
    expect(isToolAllowedAtStage('generate_brief', 'decide').allowed).toBe(true);
  });

  it("decide: explain_results allowed", () => {
    expect(isToolAllowedAtStage('explain_results', 'decide').allowed).toBe(true);
  });

  it("decide: edit_graph blocked", () => {
    const r = isToolAllowedAtStage('edit_graph', 'decide');
    expect(r.allowed).toBe(false);
    expect(r.reason).toContain('decide');
  });

  it("decide: run_analysis blocked", () => {
    expect(isToolAllowedAtStage('run_analysis', 'decide').allowed).toBe(false);
  });

  it("decide: draft_graph blocked", () => {
    expect(isToolAllowedAtStage('draft_graph', 'decide').allowed).toBe(false);
  });

  it("decide: research_topic blocked", () => {
    expect(isToolAllowedAtStage('research_topic', 'decide').allowed).toBe(false);
  });

  // optimise
  it("optimise: edit_graph allowed", () => {
    expect(isToolAllowedAtStage('edit_graph', 'optimise').allowed).toBe(true);
  });

  it("optimise: run_analysis allowed", () => {
    expect(isToolAllowedAtStage('run_analysis', 'optimise').allowed).toBe(true);
  });
});
