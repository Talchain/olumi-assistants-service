/**
 * Contract tests for the response composer (WS2).
 *
 * Two groups:
 *   (a) Strict contract — the 6 migrated actions. These enforce invariants
 *       6 and 7 from the ownership contract.
 *   (b) Transitional-exception — the 8 unmigrated actions. These pin current
 *       behaviour so regressions are caught, but they are NOT yet held to
 *       the full decision-first standard.
 *
 * Plus pipeline-level integration tests for hasPatchBlock detection.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { composeResponse } from "../../../../src/orchestrator/deterministic/response-composer.js";
import type { HandlerFact, HandlerAction } from "../../../../src/orchestrator/deterministic/response-composer.js";
import type { CoachingContext } from "../../../../src/orchestrator/deterministic/coaching-context-builder.js";

// ============================================================================
// Fixtures
// ============================================================================

function makeCoachingContext(overrides: Partial<CoachingContext> = {}): CoachingContext {
  return {
    coaching_mode: 'calibrate',
    primary_move: 'surface_assumption',
    ask_question_now: false,
    challenge_now: false,
    response_posture: 'exploratory',
    headline: null,
    tradeoff: null,
    biggest_inference: null,
    calibration_target: null,
    ai_estimated_count: 2,
    user_provided_count: 3,
    total_factor_count: 5,
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

/** Representative HandlerFact fixtures for each migrated action. */
const migratedFixtures: Record<string, { fact: HandlerFact; coaching: CoachingContext | null }> = {
  draft_created: {
    fact: {
      action: 'draft_created',
      entities_affected: [
        { id: 'opt_a', label: 'Hire Tech Lead', kind: 'option' },
        { id: 'opt_b', label: 'Hire Two Developers', kind: 'option' },
      ],
      what_changed: '2 options captured',
      stale_analysis: false,
      auto_apply: true,
      data: { option_count: 2, goal_label: 'Best hiring strategy' },
    },
    coaching: makeCoachingContext({
      tradeoff: {
        option_a: 'Hire Tech Lead',
        benefit_a: 'leadership depth',
        option_b: 'Hire Two Developers',
        benefit_b: 'delivery capacity',
      },
      biggest_inference: {
        factor_label: 'Technical Direction',
        factor_id: 'f_td',
        source: 'ai_estimated',
        reason: 'highest sensitivity among AI-estimated factors',
      },
    }),
  },
  factor_added: {
    fact: {
      action: 'factor_added',
      entities_affected: [{ id: 'f_new', label: 'Onboarding Time', kind: 'risk' }],
      what_changed: 'new risk factor',
      why_it_matters: 'Onboarding delays could push the launch window back by 2 months.',
      stale_analysis: true,
      auto_apply: false,
      data: { value_label: 'value: 6 weeks', target_label: 'Delivery Capacity' },
    },
    coaching: null,
  },
  option_added: {
    fact: {
      action: 'option_added',
      entities_affected: [{ id: 'opt_x', label: 'Contractor Team', kind: 'option' }],
      what_changed: 'new option with 3 effects',
      stale_analysis: true,
      auto_apply: false,
      data: { intervention_count: 3 },
    },
    coaching: null,
  },
  value_set: {
    fact: {
      action: 'value_set',
      entities_affected: [{ id: 'f_cost', label: 'Cost Per Developer', kind: 'factor' }],
      what_changed: 'Cost Per Developer to 150000',
      stale_analysis: true,
      auto_apply: true,
      data: { new_value: 150000, unit: 'USD' },
    },
    coaching: makeCoachingContext({
      drivers: [{
        factor_label: 'Cost Per Developer',
        factor_id: 'f_cost',
        sensitivity: 0.42,
        is_ai_estimated: true,
        confidence_band: 'medium',
      }],
    }),
  },
  analysis_complete: {
    fact: {
      action: 'analysis_complete',
      entities_affected: [],
      what_changed: 'analysis complete',
      stale_analysis: false,
      auto_apply: true,
    },
    coaching: makeCoachingContext({
      headline: {
        leading_option: 'Hire Tech Lead',
        leading_probability: 72,
        runner_up: 'Hire Two Developers',
        runner_up_probability: 28,
        win_gap: 44,
        stability_band: 'moderate',
        stability_pct: 55,
      },
    }),
  },
  analysis_started: {
    fact: {
      action: 'analysis_started',
      entities_affected: [],
      what_changed: '',
      stale_analysis: false,
      auto_apply: true,
    },
    coaching: null,
  },
};

/** Representative HandlerFact fixtures for each unmigrated action. */
const unmigratedFixtures: Record<string, { fact: HandlerFact; coaching: CoachingContext | null }> = {
  edge_adjusted: {
    fact: {
      action: 'edge_adjusted',
      entities_affected: [{ id: 'e1', label: 'Cost->Quality', kind: 'edge' }],
      what_changed: 'strength from 0.20 to 0.75',
      stale_analysis: true,
      auto_apply: true,
    },
    coaching: null,
  },
  constraint_added: {
    fact: {
      action: 'constraint_added',
      entities_affected: [{ id: 'c1', label: 'Budget Cap', kind: 'constraint' }],
      what_changed: 'new constraint',
      stale_analysis: true,
      auto_apply: false,
    },
    coaching: null,
  },
  factor_removed: {
    fact: {
      action: 'factor_removed',
      entities_affected: [{ id: 'f1', label: 'Brand Perception', kind: 'factor' }],
      what_changed: 'removed factor',
      stale_analysis: true,
      auto_apply: true,
    },
    coaching: null,
  },
  goal_target_set: {
    fact: {
      action: 'goal_target_set',
      entities_affected: [{ id: 'g1', label: 'Revenue Growth', kind: 'goal' }],
      what_changed: 'target set',
      stale_analysis: true,
      auto_apply: false,
      data: { target: '20%' },
    },
    coaching: null,
  },
  premortem_run: {
    fact: {
      action: 'premortem_run',
      entities_affected: [],
      what_changed: 'premortem complete',
      stale_analysis: false,
      auto_apply: true,
    },
    coaching: null,
  },
  assumption_challenged: {
    fact: {
      action: 'assumption_challenged',
      entities_affected: [{ id: 'f2', label: 'Market Size', kind: 'factor' }],
      what_changed: 'challenged',
      stale_analysis: false,
      auto_apply: true,
    },
    coaching: null,
  },
  brief_generated: {
    fact: {
      action: 'brief_generated',
      entities_affected: [],
      what_changed: 'brief generated',
      stale_analysis: false,
      auto_apply: true,
    },
    coaching: null,
  },
  evidence_found: {
    fact: {
      action: 'evidence_found',
      entities_affected: [],
      what_changed: '3 pieces found',
      stale_analysis: false,
      auto_apply: true,
      data: { evidence_count: 3 },
    },
    coaching: null,
  },
};

// ============================================================================
// Helpers
// ============================================================================

function countSentences(text: string): number {
  // Split on sentence-ending punctuation followed by space or end-of-string.
  const matches = text.match(/[.!?](?:\s|$)/g);
  return matches ? matches.length : 0;
}

// ============================================================================
// (a) Strict contract — 6 migrated actions
// ============================================================================

describe("strict contract — migrated actions", () => {
  const migratedActions = Object.keys(migratedFixtures);

  describe.each(migratedActions)("%s", (action) => {
    const { fact, coaching } = migratedFixtures[action];

    for (const hasPatchBlock of [true, false]) {
      const label = hasPatchBlock ? 'hasPatchBlock=true' : 'hasPatchBlock=false';

      it(`${label}: no "Confirm to apply" or "Please confirm"`, () => {
        const text = composeResponse(fact, coaching, hasPatchBlock);
        expect(text.toLowerCase()).not.toContain('confirm to apply');
        expect(text.toLowerCase()).not.toContain('please confirm');
      });

      it(`${label}: no "Added N factors/nodes/edges/connections"`, () => {
        const text = composeResponse(fact, coaching, hasPatchBlock);
        expect(text).not.toMatch(/\bAdded\s+\d+\s+(?:factors?|nodes?|edges?|connections?)\b/i);
      });

      it(`${label}: no "Proposing to add" as sentence opener`, () => {
        const text = composeResponse(fact, coaching, hasPatchBlock);
        // Check each sentence start
        const sentences = text.split(/(?<=[.!?])\s+/);
        for (const s of sentences) {
          expect(s).not.toMatch(/^Proposing to add\b/i);
        }
      });

      it(`${label}: no em dashes`, () => {
        const text = composeResponse(fact, coaching, hasPatchBlock);
        expect(text).not.toMatch(/[\u2013\u2014]/);
      });

      it(`${label}: no node IDs (fac_, opt_, risk_, out_, goal_, dec_)`, () => {
        const text = composeResponse(fact, coaching, hasPatchBlock);
        expect(text).not.toMatch(/\b(?:fac|opt|risk|out|goal|dec)_\w+/);
      });
    }

    if (action === 'draft_created') {
      it("hasPatchBlock=true: at most 2 sentences (draft_created exception)", () => {
        const text = composeResponse(fact, coaching, true);
        expect(countSentences(text)).toBeLessThanOrEqual(2);
      });
    } else {
      it("hasPatchBlock=true: exactly 1 sentence", () => {
        const text = composeResponse(fact, coaching, true);
        expect(countSentences(text)).toBe(1);
      });
    }

    it("hasPatchBlock=false: at most 3 sentences", () => {
      const text = composeResponse(fact, coaching, false);
      expect(countSentences(text)).toBeLessThanOrEqual(3);
    });

    it("contains at least one entity label when entities_affected is non-empty (draft_created exempt: uses coaching tradeoff benefits as decision-first content)", () => {
      if (fact.entities_affected.length === 0) return;
      // draft_created entities are option labels, but the template uses
      // coaching tradeoff benefits (benefit_a, benefit_b) which are the
      // decision-relevant content. Forcing option labels into the template
      // would be model-operation framing.
      if (fact.action === 'draft_created') return;
      const text = composeResponse(fact, coaching, false);
      const hasEntity = fact.entities_affected.some(e => text.includes(e.label));
      expect(hasEntity, `Expected entity label in: "${text}"`).toBe(true);
    });

    it("hasPatchBlock=true: output contains entity label when entities_affected is non-empty (draft_created exempt)", () => {
      if (fact.entities_affected.length === 0) return;
      if (fact.action === 'draft_created') return;
      const text = composeResponse(fact, coaching, true);
      const hasEntity = fact.entities_affected.some(e => text.includes(e.label));
      expect(hasEntity, `Expected entity label in hasPatchBlock=true output: "${text}"`).toBe(true);
    });
  });
});

// ============================================================================
// (b) Transitional-exception — 8 unmigrated actions (pin current behaviour)
// ============================================================================

describe("transitional-exception — unmigrated actions", () => {
  const unmigratedActions = Object.keys(unmigratedFixtures);

  describe.each(unmigratedActions)("%s", (action) => {
    const { fact, coaching } = unmigratedFixtures[action];

    it("produces non-empty text", () => {
      const text = composeResponse(fact, coaching);
      expect(text.length).toBeGreaterThan(0);
    });

    it("no em dashes", () => {
      const text = composeResponse(fact, coaching);
      expect(text).not.toMatch(/[\u2013\u2014]/);
    });

    it("no node IDs leaked", () => {
      const text = composeResponse(fact, coaching);
      expect(text).not.toMatch(/\b(?:fac|opt|risk|out|goal|dec)_\w+/);
    });

    it("no internal jargon (interventions, graph_patch)", () => {
      const text = composeResponse(fact, coaching);
      expect(text).not.toContain('interventions');
      expect(text).not.toContain('graph_patch');
    });
  });

  // Pin specific unmigrated outputs so changes are caught
  it("edge_adjusted auto_apply: 'Edge strength is now ...'", () => {
    const { fact, coaching } = unmigratedFixtures.edge_adjusted;
    const text = composeResponse(fact, coaching);
    expect(text).toBe('Edge strength is now strength from 0.20 to 0.75.');
  });

  it("constraint_added proposal: contains 'Confirm to apply' (transitional)", () => {
    const { fact, coaching } = unmigratedFixtures.constraint_added;
    const text = composeResponse(fact, coaching);
    expect(text).toContain('Confirm to apply');
    expect(text).toContain('Budget Cap');
  });

  it("factor_removed auto_apply: 'Brand Perception is no longer in the model.'", () => {
    const { fact, coaching } = unmigratedFixtures.factor_removed;
    const text = composeResponse(fact, coaching);
    expect(text).toBe('Brand Perception is no longer in the model.');
  });

  it("goal_target_set proposal: contains 'Confirm to apply' (transitional)", () => {
    const { fact, coaching } = unmigratedFixtures.goal_target_set;
    const text = composeResponse(fact, coaching);
    expect(text).toContain('Confirm to apply');
    expect(text).toContain('Revenue Growth');
  });

  it("premortem_run: static text", () => {
    const { fact, coaching } = unmigratedFixtures.premortem_run;
    const text = composeResponse(fact, coaching);
    expect(text).toBe('Here are the most likely failure paths for your leading option.');
  });

  it("assumption_challenged: references entity label", () => {
    const { fact, coaching } = unmigratedFixtures.assumption_challenged;
    const text = composeResponse(fact, coaching);
    expect(text).toContain('Market Size');
  });

  it("brief_generated: static text", () => {
    const { fact, coaching } = unmigratedFixtures.brief_generated;
    const text = composeResponse(fact, coaching);
    expect(text).toBe('Here is your decision brief, ready to share.');
  });

  it("evidence_found: count-based text", () => {
    const { fact, coaching } = unmigratedFixtures.evidence_found;
    const text = composeResponse(fact, coaching);
    expect(text).toBe('Found 3 relevant pieces of evidence.');
  });
});

// ============================================================================
// analysis_complete — orientation-only regression gate
// ============================================================================

describe("analysis_complete — orientation-only (no results-block duplication)", () => {
  it("produces exactly 1 sentence even with full coaching context", () => {
    const fact: HandlerFact = {
      action: 'analysis_complete',
      entities_affected: [],
      what_changed: 'analysis complete',
      stale_analysis: false,
      auto_apply: true,
    };
    const coaching = makeCoachingContext({
      headline: {
        leading_option: 'Hire Tech Lead',
        leading_probability: 72,
        runner_up: 'Hire Two Developers',
        runner_up_probability: 28,
        win_gap: 44,
        stability_band: 'moderate',
        stability_pct: 55,
      },
      drivers: [{
        factor_label: 'Cost Per Developer',
        factor_id: 'f_cost',
        sensitivity: 0.42,
        is_ai_estimated: true,
        confidence_band: 'medium',
      }],
      cta: { guidance: 'Calibrate the cost estimate.', readiness: 'ready_with_caveats' },
    });
    const text = composeResponse(fact, coaching);
    expect(countSentences(text)).toBe(1);
    expect(text).toBe('Hire Tech Lead leads at 72%.');
  });

  it("does not restate driver percentage or CTA guidance", () => {
    const fact: HandlerFact = {
      action: 'analysis_complete',
      entities_affected: [],
      what_changed: 'analysis complete',
      stale_analysis: false,
      auto_apply: true,
    };
    const coaching = makeCoachingContext({
      headline: {
        leading_option: 'Expand Internationally',
        leading_probability: 58,
        runner_up: 'Focus Domestic',
        runner_up_probability: 42,
        win_gap: 16,
        stability_band: 'tight',
        stability_pct: 40,
      },
      drivers: [{
        factor_label: 'Market Size',
        factor_id: 'f_ms',
        sensitivity: 0.65,
        is_ai_estimated: false,
        confidence_band: 'high',
      }],
      cta: { guidance: 'Consider adding regulatory risk.', readiness: 'ready' },
    });
    const text = composeResponse(fact, coaching);
    expect(text).not.toContain('Market Size drives');
    expect(text).not.toContain('65%');
    expect(text).not.toContain('regulatory risk');
    expect(text).not.toContain('Calibrate');
  });
});

// ============================================================================
// (c) Pipeline-level integration tests — hasPatchBlock detection
// ============================================================================

describe("pipeline hasPatchBlock detection", () => {
  it("draft handler path: blocks contain graph_patch → orientation-only output", () => {
    // Simulate draft_graph ActionResult: blocks already contain graph_patch
    const actionResult = {
      blocks: [{ block_type: 'graph_patch' as const, data: {} }],
      operations: undefined,
      fact: migratedFixtures.draft_created.fact,
    };

    // Reproduce pipeline detection logic
    const hasPatchBlock =
      (actionResult.blocks ?? []).some(b => b.block_type === 'graph_patch')
      || ((actionResult.operations?.length ?? 0) > 0);

    expect(hasPatchBlock).toBe(true);

    const text = composeResponse(
      actionResult.fact,
      migratedFixtures.draft_created.coaching,
      hasPatchBlock,
    );
    // Draft orientation: trades X against Y (max 2 sentences)
    expect(countSentences(text)).toBeLessThanOrEqual(2);
    expect(text).toContain('trades');
    expect(text).not.toMatch(/\bAdded\s+\d+/i);
    expect(text.toLowerCase()).not.toContain('confirm to apply');
  });

  it("edit-action path: operations non-empty, no blocks → orientation-only output", () => {
    // Simulate add-factor ActionResult: operations populated, blocks empty
    const actionResult = {
      blocks: [] as Array<{ block_type: string }>,
      operations: [{ op: 'add_node', path: '/nodes/f_new', value: {} }],
      fact: migratedFixtures.factor_added.fact,
    };

    // Reproduce pipeline detection logic
    const hasPatchBlock =
      (actionResult.blocks ?? []).some(b => b.block_type === 'graph_patch')
      || ((actionResult.operations?.length ?? 0) > 0);

    expect(hasPatchBlock).toBe(true);

    const text = composeResponse(
      actionResult.fact,
      migratedFixtures.factor_added.coaching,
      hasPatchBlock,
    );
    // Orientation only: 1 sentence
    expect(countSentences(text)).toBe(1);
    expect(text.toLowerCase()).not.toContain('confirm to apply');
    expect(text).not.toMatch(/^Proposing to add\b/i);
  });

  it("no patch, no operations → hasPatchBlock=false, full template", () => {
    const actionResult = {
      blocks: [] as Array<{ block_type: string }>,
      operations: undefined,
      fact: migratedFixtures.value_set.fact,
    };

    const hasPatchBlock =
      (actionResult.blocks ?? []).some(b => b.block_type === 'graph_patch')
      || ((actionResult.operations?.length ?? 0) > 0);

    expect(hasPatchBlock).toBe(false);

    const text = composeResponse(
      actionResult.fact,
      migratedFixtures.value_set.coaching,
      hasPatchBlock,
    );
    // Full template: "set to" framing with driver annotation
    expect(text).toContain('set to');
    expect(text).toContain('most sensitive');
  });
});
