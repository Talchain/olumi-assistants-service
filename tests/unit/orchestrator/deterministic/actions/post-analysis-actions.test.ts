/**
 * Unit tests for the three post-analysis deterministic actions.
 *
 * Contracts pinned here:
 *   Fix 3 (explain_result): no duplicate winner line across assistantText /
 *     block sections / block narrative.
 *   Fix 4 (compare_options): always emits a narrative when >= 2 results;
 *     assistantText names a concrete differentiator.
 *   Fix 5 (what_would_flip): assistantText names the top 1-2 factors when
 *     top_drivers is non-empty; generic header only when zero drivers.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { explainResultAction } from "../../../../../src/orchestrator/deterministic/actions/explain-result.js";
import { compareOptionsAction } from "../../../../../src/orchestrator/deterministic/actions/compare-options.js";
import { whatWouldFlipAction } from "../../../../../src/orchestrator/deterministic/actions/what-would-flip.js";
import type {
  DeterministicTurnContext,
  AnalysisSummary,
  DeterministicCommentaryBlockData,
} from "../../../../../src/orchestrator/deterministic/types.js";

// ─────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────

function makeAnalysisSummary(overrides: Partial<AnalysisSummary> = {}): AnalysisSummary {
  return {
    winner: 'Hire Tech Lead',
    winner_probability: 0.9,
    runner_up: 'Contract',
    runner_up_probability: 0.1,
    robustness_band: 'moderate',
    top_drivers: [
      { label: 'Ramp time', factor_id: 'fac_ramp', sensitivity: 1.5, direction: 'down' },
      { label: 'Contractor cost', factor_id: 'fac_cost', sensitivity: 0.9, direction: 'up' },
      { label: 'Team capacity', factor_id: 'fac_cap', sensitivity: 0.5, direction: 'up' },
    ],
    fragile_edge_count: 2,
    fragile_edges: [
      { label: 'Ramp time → Launch readiness', switch_probability: 0.45 },
      { label: 'Salary → Runway', switch_probability: 0.3 },
    ],
    factor_sensitivity: [
      { label: 'Ramp time', influence_percent: 45, confidence_band: 'moderate', influence_rank: 1 },
      { label: 'Contractor cost', influence_percent: 30, confidence_band: 'high', influence_rank: 2 },
      { label: 'Team capacity', influence_percent: 15, confidence_band: 'moderate', influence_rank: 3 },
    ],
    edge_e_values: [],
    conditional_winners: [],
    inference_warnings: [],
    constraints_met: true,
    constraint_tensions: [],
    ...overrides,
  };
}

function makeTurnContext(overrides: Partial<DeterministicTurnContext> = {}): DeterministicTurnContext {
  return {
    stage: 'evaluate',
    entities: {
      nodes: new Map([
        ['fac_ramp', { id: 'fac_ramp', label: 'Ramp time', type: 'factor', value: 6, unit: 'weeks' } as unknown as never],
        ['fac_cost', { id: 'fac_cost', label: 'Contractor cost', type: 'factor', value: 160, unit: '$/h' } as unknown as never],
        ['fac_cap', { id: 'fac_cap', label: 'Team capacity', type: 'factor', value: 4, unit: 'people' } as unknown as never],
      ]),
      edges: [],
      option_ids: ['opt_hire', 'opt_contract'],
      goal_id: 'goal_1',
    },
    graph_summary: {
      node_count: 5,
      edge_count: 4,
      option_count: 2,
      option_labels: ['Hire Tech Lead', 'Contract'],
      goal_label: 'Ship on time',
      missing_structural: [],
    },
    analysis_summary: makeAnalysisSummary(),
    capabilities: {
      can_run_analysis: false,
      can_explain_results: true,
      can_edit_graph: false,
      can_compare_options: true,
      can_challenge: false,
      can_generate_artefact: false,
    },
    blockers: [],
    signals: { high_uncertainty_factors: [], dominant_factor: null, close_call: false, default_value_count: 0, weak_edges: [] },
    conversation: { turn_count: 1, last_user_intent: null, recent_actions_taken: [], recent_actions_declined: [], pending_confirmation: null },
    eligible_actions: ['explain_result', 'compare_options', 'what_would_flip'],
    disambiguation_hints: [],
    graph: null,
    analysis: {
      results: [
        { option_id: 'opt_hire', option_label: 'Hire Tech Lead', win_probability: 0.9 },
        { option_id: 'opt_contract', option_label: 'Contract', win_probability: 0.1 },
      ],
      robustness: { level: 'moderate', fragile_edges: [] },
    } as unknown as never,
    conversational_state: null,
    scenario_id: 'test',
    turn_id: 'turn-1',
    analysis_inputs: null,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Fix 3: explain_result — no duplicate winner line
// ─────────────────────────────────────────────────────────────────────────

describe("explain_result action (Fix 3)", () => {
  it("winner line appears in assistantText only — not in sections, not in narrative", async () => {
    const ctx = makeTurnContext();
    const result = await explainResultAction.execute({}, ctx);

    // assistantText carries the headline
    expect(result.assistantText).toBeDefined();
    expect(result.assistantText).toContain('Hire Tech Lead');
    expect(result.assistantText).toContain('90%');

    expect(result.blocks.length).toBe(1);
    const block = result.blocks[0];
    expect(block.block_type).toBe('commentary');
    const data = block.data as DeterministicCommentaryBlockData;

    // narrative is intentionally empty (sections-only rendering)
    expect(data.narrative).toBe('');

    // sections must not include a "Recommendation" heading that restates the winner
    const sections = data.sections ?? [];
    const headings = sections.map((s) => s.heading);
    expect(headings).not.toContain('Recommendation');

    // None of the section contents/items should contain the winner name (which
    // would be a duplication with assistantText). We tolerate the winner name
    // in items like "Ramp time (influence 45%)" since driver labels are
    // distinct from option labels; the winner's OPTION label must not appear.
    for (const section of sections) {
      if (section.content) {
        expect(section.content).not.toContain('Hire Tech Lead');
      }
      for (const item of section.items ?? []) {
        expect(item).not.toContain('Hire Tech Lead');
      }
    }
  });

  it("still produces Stability / Key drivers sections when data is present", async () => {
    const ctx = makeTurnContext();
    const result = await explainResultAction.execute({}, ctx);
    const data = result.blocks[0].data as DeterministicCommentaryBlockData;
    const headings = (data.sections ?? []).map((s) => s.heading);
    expect(headings).toContain('Stability');
    expect(headings).toContain('Key drivers');
  });

  it("falls back to a generic assistantText when no winner exists", async () => {
    const ctx = makeTurnContext({ analysis_summary: makeAnalysisSummary({ winner: null, winner_probability: null }) });
    const result = await explainResultAction.execute({}, ctx);
    expect(result.assistantText).toBe('Analysis results are ready.');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Fix 4: compare_options — narrative non-empty, names a differentiator
// ─────────────────────────────────────────────────────────────────────────

describe("compare_options action (Fix 4)", () => {
  it("narrative is non-empty when results.length >= 2", async () => {
    const ctx = makeTurnContext();
    const result = await compareOptionsAction.execute({}, ctx);
    expect(result.blocks.length).toBe(1);
    const data = result.blocks[0].data as { options: unknown[]; narrative: string };
    expect(data.narrative.length).toBeGreaterThan(0);
  });

  it("narrative names winner, runner-up, and margin", async () => {
    const ctx = makeTurnContext();
    const result = await compareOptionsAction.execute({}, ctx);
    const data = result.blocks[0].data as { narrative: string };
    expect(data.narrative).toContain('Hire Tech Lead');
    expect(data.narrative).toContain('Contract');
    // Margin is 80 points
    expect(data.narrative).toMatch(/\b8\d\b|\b90\b/);
  });

  it("narrative names at least one concrete differentiator when drivers exist", async () => {
    const ctx = makeTurnContext();
    const result = await compareOptionsAction.execute({}, ctx);
    const data = result.blocks[0].data as { narrative: string };
    expect(data.narrative.toLowerCase()).toContain('ramp time');
  });

  it("assistantText names the top differentiator when drivers exist", async () => {
    const ctx = makeTurnContext();
    const result = await compareOptionsAction.execute({}, ctx);
    expect(result.assistantText).toBeDefined();
    expect(result.assistantText!).toContain('Ramp time');
    expect(result.assistantText!).toContain('Hire Tech Lead');
    expect(result.assistantText!).toContain('Contract');
  });

  it("narrative still populated when drivers are empty but fragile edges exist", async () => {
    const ctx = makeTurnContext({
      analysis_summary: {
        ...makeAnalysisSummary(),
        top_drivers: [],
        factor_sensitivity: [],
        fragile_edge_count: 3,
      },
    });
    const result = await compareOptionsAction.execute({}, ctx);
    const data = result.blocks[0].data as { narrative: string };
    expect(data.narrative.length).toBeGreaterThan(0);
    expect(data.narrative.toLowerCase()).toContain('fragile');
  });

  it("narrative still populated when both drivers and fragile edges are empty (structural cue)", async () => {
    const ctx = makeTurnContext({
      analysis_summary: {
        ...makeAnalysisSummary(),
        top_drivers: [],
        factor_sensitivity: [],
        fragile_edge_count: 0,
      },
    });
    const result = await compareOptionsAction.execute({}, ctx);
    const data = result.blocks[0].data as { narrative: string };
    expect(data.narrative.length).toBeGreaterThan(0);
    // Narrative still mentions winner + runner-up
    expect(data.narrative).toContain('Hire Tech Lead');
    expect(data.narrative).toContain('Contract');
  });

  it("returns error assistantText when results are empty", async () => {
    const ctx = makeTurnContext({
      analysis: { results: [] } as unknown as never,
    });
    const result = await compareOptionsAction.execute({}, ctx);
    expect(result.blocks.length).toBe(0);
    expect(result.assistantText).toContain('No analysis results');
  });

  it("returns guidance assistantText when only one result", async () => {
    const ctx = makeTurnContext({
      analysis: {
        results: [{ option_id: 'opt_hire', option_label: 'Hire Tech Lead', win_probability: 0.9 }],
      } as unknown as never,
    });
    const result = await compareOptionsAction.execute({}, ctx);
    expect(result.blocks.length).toBe(0);
    expect(result.assistantText).toContain('at least two');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Fix 5: what_would_flip — assistantText names top factors
// ─────────────────────────────────────────────────────────────────────────

describe("what_would_flip action (Fix 5)", () => {
  it("assistantText names the top driver by label when drivers exist", async () => {
    const ctx = makeTurnContext();
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.assistantText).toBeDefined();
    expect(result.assistantText!).toContain('Ramp time');
  });

  it("assistantText names up to two driver labels when >= 2 drivers exist", async () => {
    const ctx = makeTurnContext();
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.assistantText!).toContain('Ramp time');
    expect(result.assistantText!).toContain('Contractor cost');
  });

  it("assistantText includes the current winner when drivers exist", async () => {
    const ctx = makeTurnContext();
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.assistantText!).toContain('Hire Tech Lead');
  });

  it("assistantText falls back to generic copy only when zero drivers exist", async () => {
    const ctx = makeTurnContext({
      analysis_summary: {
        ...makeAnalysisSummary(),
        top_drivers: [],
      },
    });
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.assistantText).toBeDefined();
    // Zero-driver branch returns a generic header; does not name a driver
    expect(result.assistantText!.toLowerCase()).toContain('no single driver');
  });

  it("still emits a FlipAnalysisBlock when drivers are present", async () => {
    const ctx = makeTurnContext();
    const result = await whatWouldFlipAction.execute({}, ctx);
    expect(result.blocks.length).toBe(1);
    expect(result.blocks[0].block_type).toBe('flip_analysis');
  });

  it("includes current value in assistantText when the entity has a value", async () => {
    const ctx = makeTurnContext();
    const result = await whatWouldFlipAction.execute({}, ctx);
    // fac_ramp has value 6, unit 'weeks' in the mocked entities
    expect(result.assistantText!.toLowerCase()).toContain('currently 6');
  });
});
