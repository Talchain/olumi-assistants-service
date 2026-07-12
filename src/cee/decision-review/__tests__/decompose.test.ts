/**
 * ROADMAP 1.77 (B1) — decomposed decision_review composer + consistency check.
 *
 * These tests prove the 07-REVIEW mandatory revisions (RED-first — each was
 * written to fail against a stub before the composer/consistency logic existed):
 *
 *  R1 (composed-consistency + monolith fallback): the NEW cross-fragment check
 *     catches a wrong-winner headline, a missing option headline, and an
 *     ungrounded number, and forces a fallback to the monolith; payload-orphan
 *     keys are repaired, not fatal.
 *  R4 (dedicated flag, default off): CEE_DECISION_REVIEW_DECOMPOSE defaults
 *     false, so the enricher keeps invoking the gpt-4.1 monolith.
 *  R5 (downstream contract preservation): a consistent composed output
 *     satisfies the SAME performShapeCheck the monolith output must satisfy,
 *     and carries the identical block-shape fields the composer/consumers read.
 *  Orchestration: 4 good fragments → composed shipped (monolith NOT called);
 *     any missing fragment or fatal inconsistency → monolith fallback; the
 *     returned result shape is the identical DecisionReviewInvokeResult.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- Mocks for the orchestration tests (pure-function tests use no mocks) ---
const chatWithAnthropicMock = vi.fn();
vi.mock('../../../adapters/llm/anthropic.js', () => ({
  chatWithAnthropic: (...args: unknown[]) => chatWithAnthropicMock(...args),
}));

const invokeMonolithMock = vi.fn();
vi.mock('../invoke.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../invoke.js')>();
  return {
    ...actual,
    invokeDecisionReview: (...args: unknown[]) => invokeMonolithMock(...args),
  };
});

import {
  buildSlices,
  composeFragments,
  checkComposedConsistency,
  invokeDecomposedDecisionReview,
  DEFAULT_DECOMPOSE_MODEL,
} from '../decompose.js';
import { performShapeCheck } from '../shape-check.js';
import type { DecisionReviewInvokeInput } from '../invoke.js';
import { config, _resetConfigCache } from '../../../config/index.js';

// ============================================================================
// Fixtures — one coherent, fully-grounded analysed state
// ============================================================================

function baseInput(): DecisionReviewInvokeInput {
  return {
    brief: 'We must decide whether to raise our price. We have spent months on this already.',
    brief_hash: 'hash',
    graph: { nodes: [], edges: [] },
    isl_results: {
      option_comparison: [
        { option_id: 'opt-1', option_label: 'Option A', win_probability: 0.7, outcome: { mean: 100, p10: 80, p90: 120 } },
        { option_id: 'opt-2', option_label: 'Option B', win_probability: 0.3, outcome: { mean: 90, p10: 70, p90: 110 } },
      ],
      factor_sensitivity: [
        { factor_id: 'fac-1', factor_label: 'Demand', elasticity: 0.5, confidence: 0.6 },
      ],
      fragile_edges: [
        { edge_id: 'edge-1', from_label: 'Price', to_label: 'Demand', switch_probability: 0.2, alternative_winner_id: 'opt-2', alternative_winner_label: 'Option B' },
      ],
      robustness: { recommendation_stability: 0.71, overall_confidence: 0.6 },
    },
    deterministic_coaching: {
      readiness: 'ready',
      headline_type: 'clear_winner',
      evidence_gaps: [{ factor_id: 'fac-1', factor_label: 'Demand', voi: 0.8, confidence: 0.4 }],
      model_critiques: [],
    },
    winner: { id: 'opt-1', label: 'Option A', win_probability: 0.7, outcome_mean: 100 },
    runner_up: { id: 'opt-2', label: 'Option B', win_probability: 0.3, outcome_mean: 90 },
    flip_threshold_data: [
      { factor_id: 'fac-1', factor_label: 'Demand', current_value: 100, flip_value: 150, direction: 'increase', unit: 'units' },
    ],
    _meta: {
      input_shape_version: 'v5-normalised',
      flip_threshold_count: 1,
      factor_sensitivity_count: 1,
      fragile_edge_count: 1,
      model_critique_count: 0,
      evidence_gaps_dropped_count: 0,
      model_critiques_dropped_count: 0,
      model_critiques_capped_count: 0,
      has_deterministic_coaching: true,
      margin: 0.4,
      robustness_level: null,
    },
  };
}

// Grounded fragments (numbers all appear in baseInput within ±10%).
function goodR1(): Record<string, unknown> {
  return {
    narrative_summary:
      'Option A leads, driven by Demand, with a lead of about 40 percentage points, and the result looks stable at around 71%.',
    story_headlines: {
      'opt-1': 'Leads on demand strength and stability',
      'opt-2': 'Would take the lead if demand softened',
    },
    readiness_rationale: 'The evidence supports proceeding; the key driver Demand is well understood.',
  };
}
function goodR2(): Record<string, unknown> {
  return {
    evidence_enhancements: {
      'fac-1': {
        specific_action: 'Commission a short customer survey on demand',
        rationale: 'Demand most strongly moves the outcome for Option A',
        evidence_type: 'customer_research',
        decision_hygiene: 'Estimate the answer before looking at the survey',
      },
    },
    key_assumptions: [
      'Edge strengths assume current market conditions hold',
      'The brief assumes the competitor timeline is predictable',
    ],
  };
}
function goodR3(): Record<string, unknown> {
  return {
    robustness_explanation: {
      summary: 'The result is fairly stable, holding at about 71%.',
      primary_risk: 'The link from Price to Demand',
      stability_factors: ['A consistent demand signal'],
      fragility_factors: ['Price to Demand could weaken'],
    },
    scenario_contexts: {
      'edge-1': {
        trigger_description: 'If Price rises and Demand falls',
        consequence: 'then Option B overtakes Option A',
      },
    },
    flip_thresholds: [
      {
        factor_id: 'fac-1',
        factor_label: 'Demand',
        current_display: '100 units',
        flip_display: '150 units',
        narrative: 'If Demand moves from 100 to 150 units, the result changes.',
      },
    ],
    pre_mortem: {
      failure_scenario: 'It failed because demand softened and Price lost its pull on Demand',
      warning_signs: ['Falling demand'],
      mitigation: 'Track demand each planning cycle',
      grounded_in: ['edge-1'],
      review_trigger: 'Reconvene before launch',
    },
  };
}
function goodR4(): Record<string, unknown> {
  return {
    bias_findings: [],
    decision_quality_prompts: [
      { question: 'What would make you switch?', principle: 'Disconfirmation', applies_because: 'Option A leads clearly' },
    ],
  };
}

function ctxFor(input = baseInput()) {
  return buildSlices(input).ctx;
}

// ============================================================================
// buildSlices — right-sized slices, one per call
// ============================================================================

describe('buildSlices — each call gets only its slice', () => {
  it('gives R1 the option comparison + driver/stability hints but not the raw critique/evidence arrays', () => {
    const { slices } = buildSlices(baseInput());
    expect(slices.r1).toContain('OPTION_COMPARISON');
    expect(slices.r1).toContain('DRIVER_HINT');
    expect(slices.r1).toContain('STABILITY_HINT');
    expect(slices.r1).not.toContain('MODEL_CRITIQUES');
    expect(slices.r1).not.toContain('FRAGILE_EDGES');
  });
  it('gives R2 the evidence gaps, R3 the fragile edges + flips, R4 the critiques — partitioned', () => {
    const { slices } = buildSlices(baseInput());
    expect(slices.r2).toContain('EVIDENCE_GAPS');
    expect(slices.r2).not.toContain('FRAGILE_EDGES');
    expect(slices.r3).toContain('FRAGILE_EDGES');
    expect(slices.r3).toContain('FLIP_THRESHOLD_DATA');
    expect(slices.r4).toContain('MODEL_CRITIQUES');
    expect(slices.r4).toContain('CALIBRATION');
  });
});

// ============================================================================
// composeFragments — assemble the four owned slices
// ============================================================================

describe('composeFragments — deterministic assembly', () => {
  it('assembles all owned keys across the four fragments', () => {
    const c = composeFragments(goodR1(), goodR2(), goodR3(), goodR4());
    expect(c.narrative_summary).toContain('Option A');
    expect(Object.keys(c.story_headlines as object)).toEqual(['opt-1', 'opt-2']);
    expect(c.evidence_enhancements).toHaveProperty('fac-1');
    expect(c.key_assumptions).toHaveLength(2);
    expect(c.robustness_explanation).toHaveProperty('primary_risk');
    expect(c.scenario_contexts).toHaveProperty('edge-1');
    expect(c.flip_thresholds).toHaveLength(1);
    expect(c.pre_mortem).toBeDefined();
    expect(c.decision_quality_prompts).toHaveLength(1);
  });
  it('degrades a missing fragment to safe empties and omits optional keys', () => {
    const c = composeFragments(goodR1(), null, null, null);
    expect(c.evidence_enhancements).toEqual({});
    expect(c.key_assumptions).toEqual([]);
    expect(c.robustness_explanation).toMatchObject({ summary: '', stability_factors: [] });
    expect(c.scenario_contexts).toEqual({});
    expect(c.flip_thresholds).toEqual([]);
    expect(c.bias_findings).toEqual([]);
    expect('pre_mortem' in c).toBe(false);
    expect('framing_check' in c).toBe(false);
  });
});

// ============================================================================
// checkComposedConsistency — the NEW cross-fragment guard (07-REVIEW R1)
// ============================================================================

describe('checkComposedConsistency — the #1 decomposition risk', () => {
  it('passes a coherent, grounded composition', () => {
    const composed = composeFragments(goodR1(), goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(true);
    expect(res.fatal).toEqual([]);
  });

  it('FATAL: a wrong-winner headline (narrative names the runner-up, not the winner)', () => {
    const r1 = goodR1();
    r1.narrative_summary = 'Option B is the clear leader here and should be chosen.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/winning option|wrong-winner/i);
  });

  it('FATAL: story_headlines missing a real option', () => {
    const r1 = goodR1();
    r1.story_headlines = { 'opt-1': 'Leads on strength' }; // opt-2 missing
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/missing option "opt-2"/);
  });

  it('FATAL: an ungrounded number in the headline (a % that disagrees with the payload)', () => {
    const r1 = goodR1();
    // 250 sits in a genuine gap of the fixture's grounding corpus (no input
    // value nor its ±10% / decimal-percentage equivalents land near it).
    r1.narrative_summary = 'Option A leads by a decisive 250 percentage points.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/UNGROUNDED_NUMBER/);
  });

  it('REPAIRABLE (not fatal): drops payload-orphan evidence/scenario/flip keys', () => {
    const r2 = goodR2();
    (r2.evidence_enhancements as Record<string, unknown>)['fac-ghost'] = {
      specific_action: 'x', rationale: 'y', evidence_type: 'internal_data', decision_hygiene: 'z',
    };
    const r3 = goodR3();
    (r3.scenario_contexts as Record<string, unknown>)['edge-ghost'] = {
      trigger_description: 'if', consequence: 'then Option B overtakes Option A',
    };
    const composed = composeFragments(goodR1(), r2, r3, goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(true);
    expect(Object.keys((res.output.evidence_enhancements as object))).toEqual(['fac-1']);
    expect(Object.keys((res.output.scenario_contexts as object))).toEqual(['edge-1']);
    expect(res.repaired.join(' ')).toMatch(/orphan/);
  });

  it('REPAIRABLE: truncates flip_thresholds beyond the shape ceiling of 2', () => {
    const r3 = goodR3();
    r3.flip_thresholds = [
      { factor_id: 'fac-1', factor_label: 'Demand', current_display: '100 units', flip_display: '150 units', narrative: 'a' },
      { factor_id: 'fac-1', factor_label: 'Demand', current_display: '100 units', flip_display: '150 units', narrative: 'b' },
      { factor_id: 'fac-1', factor_label: 'Demand', current_display: '100 units', flip_display: '150 units', narrative: 'c' },
    ];
    const composed = composeFragments(goodR1(), goodR2(), r3, goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(true);
    expect((res.output.flip_thresholds as unknown[]).length).toBe(2);
  });

  it('FATAL: a missing required field (R3 failed → empty robustness leaves shape valid but R1 loss is fatal)', () => {
    // R1 failed entirely: narrative empty, story_headlines empty → shape invalid.
    const composed = composeFragments(null, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/shape:|missing option/i);
  });
});

// ============================================================================
// Downstream-contract preservation (07-REVIEW R5)
// ============================================================================

describe('downstream contract preservation', () => {
  it('a consistent composed output satisfies the same performShapeCheck the monolith must', () => {
    const composed = composeFragments(goodR1(), goodR2(), goodR3(), goodR4());
    const { output } = checkComposedConsistency(composed, ctxFor());
    const shape = performShapeCheck(output, ctxFor().reviewInput);
    expect(shape.valid).toBe(true);
    // Same block-shape fields the compose.ts Phase-3 rebuild reads.
    for (const key of [
      'narrative_summary', 'story_headlines', 'robustness_explanation', 'readiness_rationale',
      'evidence_enhancements', 'bias_findings', 'key_assumptions', 'decision_quality_prompts',
    ]) {
      expect(output).toHaveProperty(key);
    }
  });
});

// ============================================================================
// invokeDecomposedDecisionReview — orchestration + monolith fallback
// ============================================================================

function mockChatByPrompt(fragments: {
  r1: Record<string, unknown> | 'BAD' | null;
  r2: Record<string, unknown> | 'BAD' | null;
  r3: Record<string, unknown> | 'BAD' | null;
  r4: Record<string, unknown> | 'BAD' | null;
}) {
  chatWithAnthropicMock.mockImplementation(async (args: { system: string }) => {
    const sys = args.system;
    let frag: Record<string, unknown> | 'BAD' | null;
    if (sys.includes('HEADLINE VERDICT')) frag = fragments.r1;
    else if (sys.includes('biggest evidence gaps')) frag = fragments.r2;
    else if (sys.includes('how solid the result is')) frag = fragments.r3;
    else frag = fragments.r4;
    const content = frag === 'BAD' ? 'sorry, I cannot produce JSON here' : JSON.stringify(frag ?? {});
    return { content, usage: { input_tokens: 300, output_tokens: 120 }, model: DEFAULT_DECOMPOSE_MODEL, latencyMs: 900 };
  });
}

describe('invokeDecomposedDecisionReview — orchestration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetConfigCache();
    invokeMonolithMock.mockResolvedValue({
      output: { narrative_summary: 'MONOLITH', produced_at: 'x' },
      raw: '{}', model: 'gpt-4.1', provider: 'openai', llm_latency_ms: 1, input_tokens: 1, output_tokens: 1,
      prompt_version: 'v11',
      resolution: { task: 'decision_review', resolved_model: 'gpt-4.1', resolution_source: 'task_default', provider: 'openai' },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('4 good fragments → ships the COMPOSED review, does NOT call the monolith', async () => {
    mockChatByPrompt({ r1: goodR1(), r2: goodR2(), r3: goodR3(), r4: goodR4() });
    const res = await invokeDecomposedDecisionReview(baseInput(), { requestId: 'r', timeoutMs: 15000 });
    expect(chatWithAnthropicMock).toHaveBeenCalledTimes(4);
    expect(invokeMonolithMock).not.toHaveBeenCalled();
    expect(res.model).toBe(DEFAULT_DECOMPOSE_MODEL);
    expect(res.provider).toBe('anthropic');
    expect((res.output as Record<string, unknown>).narrative_summary).toContain('Option A');
    // Identical DecisionReviewInvokeResult shape (R5).
    for (const k of ['output', 'raw', 'model', 'provider', 'llm_latency_ms', 'input_tokens', 'output_tokens', 'prompt_version', 'resolution']) {
      expect(res).toHaveProperty(k);
    }
    expect(res.resolution.resolved_model).toBe(DEFAULT_DECOMPOSE_MODEL);
    expect(res.input_tokens).toBe(1200); // 4 × 300 summed
  });

  it('a missing (unparseable) fragment → FALLS BACK to the monolith', async () => {
    mockChatByPrompt({ r1: goodR1(), r2: 'BAD', r3: goodR3(), r4: goodR4() });
    const res = await invokeDecomposedDecisionReview(baseInput(), { requestId: 'r', timeoutMs: 15000 });
    expect(invokeMonolithMock).toHaveBeenCalledTimes(1);
    expect((res.output as Record<string, unknown>).narrative_summary).toBe('MONOLITH');
    expect(res.model).toBe('gpt-4.1');
  });

  it('a self-contradictory composition (wrong winner) → FALLS BACK to the monolith', async () => {
    const badR1 = goodR1();
    badR1.narrative_summary = 'Option B is clearly the best choice here.';
    mockChatByPrompt({ r1: badR1, r2: goodR2(), r3: goodR3(), r4: goodR4() });
    const res = await invokeDecomposedDecisionReview(baseInput(), { requestId: 'r', timeoutMs: 15000 });
    expect(invokeMonolithMock).toHaveBeenCalledTimes(1);
    expect((res.output as Record<string, unknown>).narrative_summary).toBe('MONOLITH');
  });
});

// ============================================================================
// Config flag — dedicated, default OFF (07-REVIEW R4)
// ============================================================================

describe('CEE_DECISION_REVIEW_DECOMPOSE flag', () => {
  beforeEach(() => _resetConfigCache());
  afterEach(() => {
    vi.unstubAllEnvs();
    _resetConfigCache();
  });

  it('defaults OFF — the monolith keeps serving live', () => {
    expect(config.cee.decisionReviewDecompose).toBe(false);
  });

  it('resolves the haiku default model when no override is set', () => {
    expect(config.cee.models.decision_review_haiku).toBeUndefined();
    expect(DEFAULT_DECOMPOSE_MODEL).toBe('claude-haiku-4-5');
  });

  it('reads CEE_DECISION_REVIEW_DECOMPOSE=true when set', () => {
    vi.stubEnv('CEE_DECISION_REVIEW_DECOMPOSE', 'true');
    _resetConfigCache();
    expect(config.cee.decisionReviewDecompose).toBe(true);
  });
});
