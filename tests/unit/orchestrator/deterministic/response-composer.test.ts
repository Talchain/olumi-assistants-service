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
  expect(text, `"${text}" contains banned "I'll add/update/..."`).not.toMatch(/\bI['']ll\s+(?:add|update|remove|change|set)\b/i);
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
  const baseFact: HandlerFact = {
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

  it("with patch block + coaching: leads with trade-off, includes inference", () => {
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

    const text = composeResponse(baseFact, coaching, true);
    expect(text).toContain('trades leadership depth against delivery capacity');
    expect(text).toContain('Technical Direction is the biggest assumption, inferred from');
    // hasPatchBlock=true caps at 2 sentences for draft_created
    expect(text).not.toContain('How strong is the effect');
    assertNoBannedTerms(text);
  });

  it("without patch block: includes calibration target as third sentence", () => {
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

    const text = composeResponse(baseFact, coaching, false);
    expect(text).toContain('trades leadership depth against delivery capacity');
    expect(text).toContain('Technical Direction is the biggest assumption, inferred from');
    expect(text).toContain('How strong is the effect of Technical Direction on Productivity');
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
    const text = composeResponse(fact, null, true);
    expect(text).toContain('a hiring decision');
    expect(text).toContain('ready to explore');
    assertNoBannedTerms(text);
  });

  it("does not contain model-operation language", () => {
    const text = composeResponse(baseFact, null, true);
    expect(text).not.toContain('Your model captures');
    expect(text).not.toContain('option count');
    expect(text).not.toMatch(/\d+\s+approach/);
    assertNoBannedTerms(text);
  });
});

// ============================================================================
// factor_added
// ============================================================================

describe("composeResponse — factor_added", () => {
  it("with patch block: orientation only, uses significance", () => {
    const fact: HandlerFact = {
      action: 'factor_added',
      entities_affected: [{ id: 'f_new', label: 'Onboarding Time', kind: 'risk' }],
      what_changed: 'new risk factor',
      why_it_matters: 'Onboarding delays could push the launch window back by 2 months.',
      stale_analysis: false,
      auto_apply: false,
      data: { value_label: 'value: 6 weeks', target_label: 'Delivery Capacity' },
    };
    const text = composeResponse(fact, null, true);
    // Entity grounding ensures label appears even when significance doesn't mention it
    expect(text).toContain('Onboarding Time');
    expect(text).toContain('onboarding delays could push the launch window back');
    expect(text).not.toContain('Confirm to apply');
    expect(text).not.toContain('Proposing to add');
    assertNoBannedTerms(text);
  });

  it("with patch block: falls back to generic orientation when no significance", () => {
    const fact: HandlerFact = {
      action: 'factor_added',
      entities_affected: [{ id: 'f_new', label: 'Market Size', kind: 'factor' }],
      what_changed: 'new factor',
      stale_analysis: false,
      auto_apply: true,
    };
    const text = composeResponse(fact, null, true);
    expect(text).toBe('Market Size captures a factor that could shift the balance of the decision.');
    assertNoBannedTerms(text);
  });

  it("without patch block + proposal: uses 'would capture' framing, no confirm", () => {
    const fact: HandlerFact = {
      action: 'factor_added',
      entities_affected: [{ id: 'f_new', label: 'Onboarding Time', kind: 'risk' }],
      what_changed: 'new risk factor',
      stale_analysis: false,
      auto_apply: false,
      data: { value_label: 'value: 6 weeks', target_label: 'Delivery Capacity' },
    };
    const text = composeResponse(fact, null, false);
    expect(text).toContain('Onboarding Time would capture a risk factor connecting to Delivery Capacity');
    expect(text).not.toContain('Confirm to apply');
    expect(text).not.toContain('Proposing to add');
    assertNoBannedTerms(text);
  });

  it("without patch block + auto_apply: acknowledgement framing", () => {
    const fact: HandlerFact = {
      action: 'factor_added',
      entities_affected: [{ id: 'f_new', label: 'Market Size', kind: 'factor' }],
      what_changed: 'new factor',
      stale_analysis: false,
      auto_apply: true,
    };
    const text = composeResponse(fact, null, false);
    expect(text).toContain('Market Size is now in the model');
    expect(text).not.toContain('Proposing');
    assertNoBannedTerms(text);
  });

  it("pulls coaching signal when why_it_matters is absent", () => {
    const fact: HandlerFact = {
      action: 'factor_added',
      entities_affected: [{ id: 'f_new', label: 'Regulatory Risk', kind: 'risk' }],
      what_changed: 'new risk factor',
      stale_analysis: false,
      auto_apply: false,
    };
    const coaching = makeCoachingContext({
      critical_gap: { type: 'missing_factor', detail: 'The model lacks a regulatory dimension.' },
    });
    const text = composeResponse(fact, coaching, false);
    expect(text).toContain('The model lacks a regulatory dimension');
    assertNoBannedTerms(text);
  });
});

// ============================================================================
// option_added
// ============================================================================

describe("composeResponse — option_added", () => {
  it("with patch block: short orientation", () => {
    const fact: HandlerFact = {
      action: 'option_added',
      entities_affected: [{ id: 'opt_x', label: 'Contractor Team', kind: 'option' }],
      what_changed: 'new option with 3 effects',
      stale_analysis: false,
      auto_apply: false,
      data: { intervention_count: 3 },
    };
    const text = composeResponse(fact, null, true);
    expect(text).toBe('Contractor Team adds a different path to your decision.');
    assertNoBannedTerms(text);
  });

  it("without patch block + proposal: includes effect count, no confirm", () => {
    const fact: HandlerFact = {
      action: 'option_added',
      entities_affected: [{ id: 'opt_x', label: 'Contractor Team', kind: 'option' }],
      what_changed: 'new option with 3 effects',
      stale_analysis: false,
      auto_apply: false,
      data: { intervention_count: 3 },
    };
    const text = composeResponse(fact, null, false);
    expect(text).toContain('Contractor Team would add a different path with 3 effects');
    expect(text).not.toContain('Confirm to apply');
    expect(text).not.toContain('Proposing to add');
    assertNoBannedTerms(text);
  });

  it("without patch block + auto_apply: acknowledgement framing", () => {
    const fact: HandlerFact = {
      action: 'option_added',
      entities_affected: [{ id: 'opt_x', label: 'In-House Build', kind: 'option' }],
      what_changed: 'new option',
      stale_analysis: false,
      auto_apply: true,
    };
    const text = composeResponse(fact, null, false);
    expect(text).toBe('In-House Build is now captured as an option.');
    assertNoBannedTerms(text);
  });
});

// ============================================================================
// value_set
// ============================================================================

describe("composeResponse — value_set", () => {
  it("with patch block + top driver: decision-significance lead", () => {
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
    const text = composeResponse(fact, coaching, true);
    expect(text).toBe('At 150000 USD, Cost Per Developer is the factor the outcome is most sensitive to.');
    assertNoBannedTerms(text);
  });

  it("with patch block + no driver: short calibration sentence", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_cost', label: 'Advertising Spend', kind: 'factor' }],
      what_changed: 'Advertising Spend to 100000 USD',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 100000, unit: 'USD' },
    };
    const text = composeResponse(fact, null, true);
    expect(text).toBe('Advertising Spend calibrated to 100000 USD.');
    assertNoBannedTerms(text);
  });

  it("without patch block + auto_apply: set to framing", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_cost', label: 'Advertising Spend', kind: 'factor' }],
      what_changed: 'Advertising Spend to 100000 USD',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 100000, unit: 'USD' },
    };
    const text = composeResponse(fact, null, false);
    expect(text).toBe('Advertising Spend set to 100000 USD.');
    assertNoBannedTerms(text);
  });

  it("without patch block + auto_apply + top driver: adds coaching annotation", () => {
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
    const text = composeResponse(fact, coaching, false);
    expect(text).toContain('Cost Per Developer set to 150000 USD.');
    expect(text).toContain('most sensitive');
    assertNoBannedTerms(text);
  });

  it("without patch block + proposal: uses why_it_matters when present", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_sal', label: 'Salary', kind: 'factor' }],
      what_changed: 'Salary to 85000 GBP',
      why_it_matters: 'make the two-developer path significantly more expensive',
      stale_analysis: false,
      auto_apply: false,
      data: { new_value: 85000, unit: 'GBP' },
    };
    const text = composeResponse(fact, null, false);
    expect(text).toContain('Salary at 85000 GBP would make the two-developer path significantly more expensive');
    expect(text).not.toContain('Confirm to apply');
    assertNoBannedTerms(text);
  });

  it("with patch block + why_it_matters: single sentence, lowercased splice", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_sal', label: 'Salary', kind: 'factor' }],
      what_changed: 'Salary to 85000 GBP',
      why_it_matters: 'Makes the two-developer path significantly more expensive.',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 85000, unit: 'GBP' },
    };
    const text = composeResponse(fact, null, true);
    // Should be 1 sentence with lowercased splice
    expect(text).toBe('Salary at 85000 GBP makes the two-developer path significantly more expensive.');
    expect(text).not.toContain('Makes');  // Capital M should be lowered
    assertNoBannedTerms(text);
  });

  it("without patch block + proposal + capitalised why: lowercases into sentence", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_sal', label: 'Salary', kind: 'factor' }],
      what_changed: 'Salary to 85000 GBP',
      why_it_matters: 'Shift the balance toward the tech lead option',
      stale_analysis: false,
      auto_apply: false,
      data: { new_value: 85000, unit: 'GBP' },
    };
    const text = composeResponse(fact, null, false);
    expect(text).toContain('Salary at 85000 GBP would shift the balance toward the tech lead option');
    assertNoBannedTerms(text);
  });

  it("without patch block + proposal + no why: uses generic decision framing", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_sal', label: 'Salary', kind: 'factor' }],
      what_changed: 'Salary to 85000 GBP',
      stale_analysis: false,
      auto_apply: false,
      data: { new_value: 85000, unit: 'GBP' },
    };
    const text = composeResponse(fact, null, false);
    expect(text).toBe('Salary at 85000 GBP would shift the balance of the decision.');
    expect(text).not.toContain('Confirm to apply');
    assertNoBannedTerms(text);
  });

  // ── display_value: qualitative band for unitless 0-1 factors ──────────────
  // Fix 1 wiring — handler emits fact.data.display_value, composer prefers it
  // over the raw numeric so the user reads "is low" instead of "calibrated to 0.25".

  it("display_value qualitative (patch block, no driver): reads naturally with 'is'", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_sen', label: 'Existing Team Seniority', kind: 'factor' }],
      what_changed: 'Existing Team Seniority to low',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 0.25, display_value: 'low' },
    };
    const text = composeResponse(fact, null, true);
    expect(text).toBe('Existing Team Seniority is low.');
    expect(text).not.toContain('0.25');
    expect(text).not.toContain('calibrated to');
    assertNoBannedTerms(text);
  });

  it("display_value qualitative (no patch block, auto_apply): uses 'is low' framing", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_sen', label: 'Existing Team Seniority', kind: 'factor' }],
      what_changed: 'Existing Team Seniority to low',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 0.25, display_value: 'low' },
    };
    const text = composeResponse(fact, null, false);
    expect(text).toBe('Existing Team Seniority is low.');
    expect(text).not.toContain('set to 0.25');
    assertNoBannedTerms(text);
  });

  it("display_value qualitative + top driver: inlines sensitivity framing", () => {
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_sen', label: 'Existing Team Seniority', kind: 'factor' }],
      what_changed: 'Existing Team Seniority to high',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 0.8, display_value: 'high' },
    };
    const coaching = makeCoachingContext({
      drivers: [
        {
          factor_label: 'Existing Team Seniority',
          factor_id: 'f_sen',
          sensitivity: 0.5,
          is_ai_estimated: false,
          confidence_band: 'medium',
        },
      ],
    });
    const text = composeResponse(fact, coaching, true);
    expect(text).toBe('Existing Team Seniority is high, the factor the outcome is most sensitive to.');
    expect(text).not.toContain('0.8');
    assertNoBannedTerms(text);
  });

  it("display_value with real unit (numeric): unchanged legacy behaviour", () => {
    // When the handler emits a numeric+unit display_value (e.g. "£75,000"),
    // the composer uses "at" framing, not "is" framing — the value has a
    // scale so "is" would read oddly.
    const fact: HandlerFact = {
      action: 'value_set',
      entities_affected: [{ id: 'f_sal', label: 'Salary', kind: 'factor' }],
      what_changed: 'Salary to 75000 GBP',
      stale_analysis: false,
      auto_apply: true,
      data: { new_value: 75000, unit: 'GBP', display_value: '75000 GBP' },
    };
    const text = composeResponse(fact, null, true);
    // Falls back to 'at' framing because display_value isn't a qualitative band.
    expect(text).toBe('Salary calibrated to 75000 GBP.');
    assertNoBannedTerms(text);
  });
});

// ============================================================================
// analysis_complete
// ============================================================================

describe("composeResponse — analysis_complete", () => {
  it("produces single orientation sentence from headline", () => {
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
    // Single orientation sentence — results blocks carry driver/CTA detail
    expect(text).toBe('Hire Tech Lead leads at 72%.');
    expect(text).not.toContain('Cost Per Developer drives');
    expect(text).not.toContain('Calibrate the cost estimate');
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
});

// ============================================================================
// Banned term sweep (all 14 actions)
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
