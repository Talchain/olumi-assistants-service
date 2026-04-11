/**
 * Tests for the response composer (WS2).
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("../../../../src/utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
}));

import { composeResponse } from "../../../../src/orchestrator/deterministic/response-composer.js";
import type { HandlerFact } from "../../../../src/orchestrator/deterministic/response-composer.js";
import type { CoachingContext } from "../../../../src/orchestrator/deterministic/coaching-context-builder.js";

// ============================================================================
// Minimal coaching context fixture
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

// ============================================================================
// Banned term / em dash enforcement
// ============================================================================

function assertNoBannedTerms(text: string) {
  // Completion-framing words are banned anywhere in the sentence,
  // case-insensitive. Checking only at sentence-start previously let
  // "X added" through as an acknowledgement, but the brief bans the
  // term entirely from composer templates.
  expect(text, `"${text}" contains banned "I'll add/update/..."`).not.toMatch(/\bI['’]ll\s+(?:add|update|remove|change|set)\b/i);
  expect(text, `"${text}" contains banned "Updated"`).not.toMatch(/\bUpdated\b/i);
  expect(text, `"${text}" contains banned "Added"`).not.toMatch(/\bAdded\b/i);
  expect(text, `"${text}" contains banned "Done"`).not.toMatch(/\bDone\b/i);
  expect(text, `"${text}" contains banned "Applied"`).not.toMatch(/\bApplied\b/i);
  expect(text).not.toContain('interventions');
  expect(text).not.toContain('graph_patch');
  // No em or en dashes
  expect(text).not.toMatch(/[\u2013\u2014]/);
}

// ============================================================================
// draft_created
// ============================================================================

describe("composeResponse — draft_created", () => {
  it("renders option count + goal + tradeoff + inference + calibration", () => {
    const fact: HandlerFact = {
      action: 'draft_created',
      entities_affected: [
        { id: 'opt_a', label: 'Hire Tech Lead', kind: 'option' },
        { id: 'opt_b', label: 'Hire Two Developers', kind: 'option' },
      ],
      what_changed: '2 options captured',
      stale_analysis: false,
      auto_apply: true,
      data: { option_count: 2, goal_label: 'Best hiring strategy' },
    };
    const coaching = makeCoachingContext({
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
      calibration_target: {
        source_label: 'Technical Direction',
        target_label: 'Productivity',
        factor_id: 'f_td',
      },
    });

    const text = composeResponse(fact, coaching);
    expect(text).toContain('2 approaches to Best hiring strategy');
    expect(text).toContain('Hire Tech Lead offers leadership depth');
    expect(text).toContain('Hire Two Developers offers delivery capacity');
    // At most 3 sentences — composer caps at 3.
    const sentences = text.match(/[.!?]/g) ?? [];
    expect(sentences.length).toBeLessThanOrEqual(6); // allow 3 sentences with internal punctuation
    assertNoBannedTerms(text);
  });

  it("falls back cleanly when coaching context is null", () => {
    const fact: HandlerFact = {
      action: 'draft_created',
      entities_affected: [],
      what_changed: '1 option captured',
      stale_analysis: false,
      auto_apply: true,
      data: { option_count: 1, goal_label: 'a hiring decision' },
    };
    const text = composeResponse(fact, null);
    expect(text).toContain('1 approach');
    expect(text).toContain('a hiring decision');
    assertNoBannedTerms(text);
  });

  it("matches snapshot for the canonical IDEATE draft", () => {
    const fact: HandlerFact = {
      action: 'draft_created',
      entities_affected: [
        { id: 'opt_a', label: 'Hire Tech Lead', kind: 'option' },
        { id: 'opt_b', label: 'Hire Two Developers', kind: 'option' },
      ],
      what_changed: '2 options captured',
      stale_analysis: false,
      auto_apply: true,
      data: { option_count: 2, goal_label: 'Best hiring strategy' },
    };
    const coaching = makeCoachingContext({
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
    });
    expect(composeResponse(fact, coaching)).toMatchSnapshot();
  });
});

// ============================================================================
// factor_added
// ============================================================================

describe("composeResponse — factor_added", () => {
  it("uses proposal language for auto_apply=false", () => {
    const fact: HandlerFact = {
      action: 'factor_added',
      entities_affected: [{ id: 'f_new', label: 'Onboarding Time', kind: 'risk' }],
      what_changed: 'new risk factor',
      stale_analysis: false,
      auto_apply: false,
      data: { value_label: 'value: 6 weeks', target_label: 'Delivery Capacity' },
    };
    const text = composeResponse(fact, null);
    expect(text).toContain('Proposing to add Onboarding Time');
    expect(text).toContain('risk factor');
    expect(text).toContain('connecting to Delivery Capacity');
    assertNoBannedTerms(text);
  });

  it("uses acknowledgement for auto_apply=true", () => {
    const fact: HandlerFact = {
      action: 'factor_added',
      entities_affected: [{ id: 'f_new', label: 'Market Size', kind: 'factor' }],
      what_changed: 'new factor',
      stale_analysis: false,
      auto_apply: true,
    };
    const text = composeResponse(fact, null);
    // Auto-apply framing must acknowledge the state without using banned
    // completion verbs ("Added", "Updated", "Done", "Applied").
    expect(text).toContain('Market Size is now in the model');
    expect(text).not.toContain('Proposing');
    assertNoBannedTerms(text);
  });
});

// ============================================================================
// option_added
// ============================================================================

describe("composeResponse — option_added", () => {
  it("uses proposal language with intervention count", () => {
    const fact: HandlerFact = {
      action: 'option_added',
      entities_affected: [{ id: 'opt_x', label: 'Contractor Team', kind: 'option' }],
      what_changed: 'new option with 3 effects',
      stale_analysis: false,
      auto_apply: false,
      data: { intervention_count: 3 },
    };
    const text = composeResponse(fact, null);
    expect(text).toContain('Proposing to add Contractor Team');
    expect(text).toContain('3 effects');
    assertNoBannedTerms(text);
  });
});

// ============================================================================
// value_set
// ============================================================================

describe("composeResponse — value_set", () => {
  it("uses acknowledgement framing for auto_apply=true", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_cost', label: 'Advertising Spend', kind: 'factor' }],
      what_changed: 'Advertising Spend to 100000 USD',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 100000, unit: 'USD' },
    };
    const text = composeResponse(fact, null);
    expect(text).toBe('Advertising Spend set to 100000 USD.');
    assertNoBannedTerms(text);
  });

  it("adds coaching annotation when factor is top driver", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_cost', label: 'Cost Per Developer', kind: 'factor' }],
      what_changed: 'Cost Per Developer to 150000',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 150000, unit: 'USD' },
    };
    const coaching = makeCoachingContext({
      drivers: [
        {
          factor_label: 'Cost Per Developer',
          factor_id: 'f_cost',
          sensitivity: 0.42,
          is_ai_estimated: true,
          confidence_band: 'medium',
        },
      ],
    });
    const text = composeResponse(fact, coaching);
    expect(text).toContain('Cost Per Developer set to 150000 USD.');
    expect(text).toContain('most sensitive');
    assertNoBannedTerms(text);
  });
});

// ============================================================================
// analysis_complete
// ============================================================================

describe("composeResponse — analysis_complete", () => {
  it("uses headline from coaching context", () => {
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
      drivers: [
        {
          factor_label: 'Cost Per Developer',
          factor_id: 'f_cost',
          sensitivity: 0.42,
          is_ai_estimated: true,
          confidence_band: 'medium',
        },
      ],
      cta: { guidance: 'Calibrate the cost estimate to strengthen the result.', readiness: 'ready_with_caveats' },
    });
    const text = composeResponse(fact, coaching);
    expect(text).toContain('Hire Tech Lead leads at 72%');
    expect(text).toContain('Cost Per Developer drives 42% of the outcome');
    expect(text).toContain('Calibrate the cost estimate');
    assertNoBannedTerms(text);
  });

  it("falls back to what_changed when no coaching headline", () => {
    const fact: HandlerFact = {
      action: 'analysis_complete',
      entities_affected: [],
      what_changed: 'Option A leads in 65% of simulations.',
      stale_analysis: false,
      auto_apply: true,
    };
    const text = composeResponse(fact, null);
    expect(text).toBe('Option A leads in 65% of simulations.');
    assertNoBannedTerms(text);
  });

  it("matches snapshot for analysis_complete with headline", () => {
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
      drivers: [
        {
          factor_label: 'Cost Per Developer',
          factor_id: 'f_cost',
          sensitivity: 0.42,
          is_ai_estimated: true,
          confidence_band: 'medium',
        },
      ],
      cta: { guidance: 'Calibrate the cost estimate to strengthen the result.', readiness: 'ready_with_caveats' },
    });
    expect(composeResponse(fact, coaching)).toMatchSnapshot();
  });
});

// ============================================================================
// Banned term sweep
// ============================================================================

describe("composeResponse — banned term sweep", () => {
  const actions: HandlerFact['action'][] = [
    'draft_created',
    'factor_added',
    'option_added',
    'value_set',
    'edge_adjusted',
    'constraint_added',
    'factor_removed',
    'goal_target_set',
    'analysis_started',
    'analysis_complete',
    'premortem_run',
    'assumption_challenged',
    'brief_generated',
    'evidence_found',
  ];

  for (const action of actions) {
    it(`${action} output contains no banned terms`, () => {
      const fact: HandlerFact = {
        action,
        entities_affected: [{ id: 'x1', label: 'Example', kind: 'factor' }],
        what_changed: 'something changed',
        stale_analysis: false,
        auto_apply: action !== 'factor_added' && action !== 'option_added',
        data: { option_count: 1, goal_label: 'a decision', new_value: 42, unit: 'USD', evidence_count: 2 },
      };
      const text = composeResponse(fact, null);
      assertNoBannedTerms(text);
    });
  }
});
