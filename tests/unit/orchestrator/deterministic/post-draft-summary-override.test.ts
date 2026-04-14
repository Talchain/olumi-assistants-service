/**
 * Tests for the post-draft summary override (Fix 2).
 *
 * Verifies that pipeline-v4 replaces `block.data.summary` on the graph_patch
 * block when the existing summary is degraded (empty, count-jargon, or the
 * generic fallback), using the deterministic CoachingContext. Preserves any
 * substantive LLM-authored summary.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { __test_only } from "../../../../src/orchestrator/deterministic/pipeline-v4.js";
import type { ActionResult } from "../../../../src/orchestrator/deterministic/types.js";
import type { CoachingContext } from "../../../../src/orchestrator/deterministic/coaching-context-builder.js";
import type { GraphV3T } from "../../../../src/orchestrator/types.js";

const { maybeOverridePatchSummary, buildCoachingSummary, COUNT_JARGON_RE, extractAnalysisReadyStatusFromResult } = __test_only;

function makeGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g1', kind: 'goal', label: 'Hire for a new feature' },
      { id: 'o1', kind: 'option', label: 'Tech Lead' },
      { id: 'o2', kind: 'option', label: 'Two Developers' },
      { id: 'o3', kind: 'option', label: 'Status Quo' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

function makeActionResultWithSummary(summary: string, graph: GraphV3T | undefined = makeGraph()): ActionResult {
  return {
    blocks: [
      {
        block_type: 'graph_patch',
        block_id: 'b1',
        turn_id: 't1',
        timestamp: '2026-04-14T00:00:00Z',
        data: {
          patch_type: 'full_draft',
          operations: [],
          status: 'proposed',
          auto_apply: true,
          summary,
          ...(graph ? { applied_graph: graph } : {}),
        },
      },
    ],
    assistantText: null,
    guidance_items: [],
    applied_graph: graph,
    fact: {
      action: 'draft_created',
      entities_affected: [],
      what_changed: '',
      stale_analysis: false,
      auto_apply: true,
    },
  } as unknown as ActionResult;
}

function makeCoaching(overrides: Partial<CoachingContext> = {}): CoachingContext {
  return {
    coaching_mode: 'orient',
    primary_move: 'surface_assumption',
    ask_question_now: false,
    challenge_now: false,
    response_posture: 'exploratory',
    headline: null,
    tradeoff: null,
    biggest_inference: null,
    calibration_target: null,
    ai_estimated_count: 0,
    user_provided_count: 0,
    total_factor_count: 0,
    drivers: [],
    top_fragile: null,
    triggered_plays: [],
    cta: null,
    risk_factor_count: 0,
    option_mechanism_overlap: false,
    critical_gap: null,
    prediction_state: 'none',
    chip_inputs: {
      stage: 'ideate',
      has_analysis: false,
      analysis_fresh: false,
      top_uncalibrated_factor: null,
      has_risk_factors: false,
      option_mechanism_overlap: false,
      stability_band: null,
      dominant_factor_label: null,
    },
    ...overrides,
  } as CoachingContext;
}

describe("COUNT_JARGON_RE", () => {
  it("matches patch-machinery count-jargon (factors / nodes / edges / connections)", () => {
    expect(COUNT_JARGON_RE.test('Added 5 factors, 3 options, and 24 connections.')).toBe(true);
    expect(COUNT_JARGON_RE.test('Added 24 connections.')).toBe(true);
    expect(COUNT_JARGON_RE.test('Updated 2 nodes and 3 edges.')).toBe(true);
  });

  it("does NOT match option/goal/outcome/risk/constraint counts — spec-scoped to patch-machinery nouns", () => {
    // These nouns are part of the decision domain; the override must not
    // rewrite summaries that mention them without also leaking patch terms.
    expect(COUNT_JARGON_RE.test('Created 2 goals and 1 option.')).toBe(false);
    expect(COUNT_JARGON_RE.test('Decision with 3 options.')).toBe(false);
    expect(COUNT_JARGON_RE.test('Hire for a new feature: Tech Lead or Two Developers.')).toBe(false);
  });
});

describe("maybeOverridePatchSummary — overwrite conditions", () => {
  it("replaces count-jargon summary with coaching-derived text when tradeoff available", () => {
    const actionResult = makeActionResultWithSummary('Added 5 factors, 3 options, and 24 connections.');
    const coaching = makeCoaching({
      tradeoff: {
        option_a: 'Tech Lead',
        benefit_a: 'senior ownership',
        option_b: 'Two Developers',
        benefit_b: 'raw capacity',
      },
    });
    maybeOverridePatchSummary(actionResult, coaching);
    const block = actionResult.blocks[0];
    expect(block.block_type).toBe('graph_patch');
    if (block.block_type !== 'graph_patch') return;
    expect(block.data.summary).toContain('trades senior ownership against raw capacity');
    expect(block.data.summary).toContain('Hire for a new feature');
    expect(block.data.summary).not.toMatch(/\d+\s+factors/);
  });

  it("replaces count-jargon summary with goal + options framing when no tradeoff", () => {
    const actionResult = makeActionResultWithSummary('Added 5 factors, 3 options, and 24 connections.');
    maybeOverridePatchSummary(actionResult, null);
    const block = actionResult.blocks[0];
    if (block.block_type !== 'graph_patch') return;
    expect(block.data.summary).toContain('Hire for a new feature');
    expect(block.data.summary).toContain('Tech Lead');
    expect(block.data.summary).not.toMatch(/\d+\s+factors/);
  });

  it("replaces empty summary with decision-framed text", () => {
    const actionResult = makeActionResultWithSummary('');
    maybeOverridePatchSummary(actionResult, null);
    const block = actionResult.blocks[0];
    if (block.block_type !== 'graph_patch') return;
    expect(block.data.summary && block.data.summary.length).toBeGreaterThan(0);
    expect(block.data.summary).toContain('Hire for a new feature');
  });

  it("replaces generic 'Review the proposed model.' fallback", () => {
    const actionResult = makeActionResultWithSummary('Review the proposed model.');
    maybeOverridePatchSummary(actionResult, null);
    const block = actionResult.blocks[0];
    if (block.block_type !== 'graph_patch') return;
    expect(block.data.summary).not.toBe('Review the proposed model.');
    expect(block.data.summary).toContain('Tech Lead');
  });

  it("does NOT replace 'Created a new decision model.' — spec-scoped to 'Review the proposed model.'", () => {
    // Pattern A correction: only 'Review the proposed model.' is in the
    // generic-fallback allowlist for overwrite. Legacy strings from the
    // edit/accepted paths are preserved untouched.
    const actionResult = makeActionResultWithSummary('Created a new decision model.');
    maybeOverridePatchSummary(actionResult, null);
    const block = actionResult.blocks[0];
    if (block.block_type !== 'graph_patch') return;
    expect(block.data.summary).toBe('Created a new decision model.');
  });

  it("does NOT replace 'Applied graph changes.' fallback", () => {
    const actionResult = makeActionResultWithSummary('Applied graph changes.');
    maybeOverridePatchSummary(actionResult, null);
    const block = actionResult.blocks[0];
    if (block.block_type !== 'graph_patch') return;
    expect(block.data.summary).toBe('Applied graph changes.');
  });

  it("does NOT replace option/goal count strings (non-patch-machinery nouns)", () => {
    const actionResult = makeActionResultWithSummary('Created 2 goals and 1 option.');
    maybeOverridePatchSummary(actionResult, null);
    const block = actionResult.blocks[0];
    if (block.block_type !== 'graph_patch') return;
    expect(block.data.summary).toBe('Created 2 goals and 1 option.');
  });

  it("preserves substantive LLM coaching summary — no overwrite", () => {
    const existing = 'Your hiring decision depends on how much senior ownership you need versus raw throughput.';
    const actionResult = makeActionResultWithSummary(existing);
    maybeOverridePatchSummary(actionResult, makeCoaching({
      tradeoff: {
        option_a: 'a', benefit_a: 'X', option_b: 'b', benefit_b: 'Y',
      },
    }));
    const block = actionResult.blocks[0];
    if (block.block_type !== 'graph_patch') return;
    expect(block.data.summary).toBe(existing);
  });

  it("does nothing when the block is not a graph_patch block", () => {
    const actionResult = {
      blocks: [],
      assistantText: null,
      guidance_items: [],
    } as unknown as ActionResult;
    maybeOverridePatchSummary(actionResult, makeCoaching());
    expect(actionResult.blocks).toEqual([]);
  });
});

describe("buildCoachingSummary — standalone", () => {
  it("returns tradeoff-based sentence when coaching context has tradeoff", () => {
    const coaching = makeCoaching({
      tradeoff: {
        option_a: 'Tech Lead',
        benefit_a: 'senior leadership',
        option_b: 'Two Developers',
        benefit_b: 'throughput',
      },
    });
    const text = buildCoachingSummary(coaching, 'Hire for a new feature', ['Tech Lead', 'Two Developers']);
    expect(text).toBe('Your Hire for a new feature trades senior leadership against throughput.');
  });

  it("returns goal: options list when no tradeoff", () => {
    const text = buildCoachingSummary(null, 'Hire for a new feature', ['Tech Lead', 'Two Developers', 'Status Quo']);
    expect(text).toBe('Hire for a new feature: Tech Lead, Two Developers, or Status Quo.');
  });

  it("returns options-only sentence when goal label missing", () => {
    const text = buildCoachingSummary(null, null, ['A', 'B']);
    expect(text).toBe('A decision model comparing A or B.');
  });

  it("returns null when neither goal nor options available", () => {
    expect(buildCoachingSummary(null, null, [])).toBeNull();
  });
});

describe("extractAnalysisReadyStatusFromResult", () => {
  it("returns the status when present on graph_patch block", () => {
    const actionResult = {
      blocks: [
        {
          block_type: 'graph_patch',
          block_id: 'b1',
          turn_id: 't1',
          timestamp: '2026-04-14T00:00:00Z',
          data: {
            patch_type: 'full_draft',
            operations: [],
            status: 'proposed',
            analysis_ready: {
              options: [],
              goal_node_id: 'g1',
              status: 'needs_encoding',
            },
          },
        },
      ],
    } as unknown as ActionResult;
    expect(extractAnalysisReadyStatusFromResult(actionResult)).toBe('needs_encoding');
  });

  it("returns null when no graph_patch block", () => {
    const actionResult = { blocks: [] } as unknown as ActionResult;
    expect(extractAnalysisReadyStatusFromResult(actionResult)).toBeNull();
  });

  it("returns null when actionResult is null", () => {
    expect(extractAnalysisReadyStatusFromResult(null)).toBeNull();
  });
});
