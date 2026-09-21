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
  resolveDecomposeFallbackBudget,
  DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS,
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
      // ROADMAP 2.228 F1 — the one flip row above is a real pair read from the
      // live top-level shape, so: no attested no-flips, no scale refusals.
      flip_threshold_source: 'top_level',
      flip_no_effect_count: 0,
      flip_scale_refused_count: 0,
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
// Cancellation + shared deadline (Codex r2 blocker 3)
// ============================================================================

describe('invokeDecomposedDecisionReview — cancellation (Codex r2 blocker 3)', () => {
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

  it('client abort mid-fan-out aborts all four sub-requests and never launches the fallback', async () => {
    const seenSignals: (AbortSignal | undefined)[] = [];
    chatWithAnthropicMock.mockImplementation((args: { signal?: AbortSignal }) => {
      seenSignals.push(args.signal);
      return new Promise((resolve, reject) => {
        if (args.signal?.aborted) return reject(new Error('request aborted'));
        args.signal?.addEventListener('abort', () => reject(new Error('request aborted')), { once: true });
        // Escape hatch so a regression (signal not forwarded) fails the
        // assertions below instead of hanging the suite forever.
        setTimeout(() => reject(new Error('no-signal-escape')), 2_000);
      });
    });
    const client = new AbortController();
    const promise = invokeDecomposedDecisionReview(baseInput(), {
      requestId: 'r', timeoutMs: 15_000, signal: client.signal,
    });
    await vi.waitFor(() => expect(chatWithAnthropicMock).toHaveBeenCalledTimes(4));
    client.abort();
    await expect(promise).rejects.toThrow(/abort/i);
    // Every sub-request received the abort signal and was cancelled — no
    // orphaned paid calls left running after the client hung up.
    expect(seenSignals).toHaveLength(4);
    for (const s of seenSignals) {
      expect(s).toBeDefined();
      expect(s!.aborted).toBe(true);
    }
    // And no fallback was billed for a response nobody is waiting for.
    expect(invokeMonolithMock).not.toHaveBeenCalled();
  });

  it('the first fatal sub-call failure cancels the sibling requests instead of waiting them out', async () => {
    const siblingOutcomes: string[] = [];
    chatWithAnthropicMock.mockImplementation((args: { system: string; signal?: AbortSignal }) => {
      if (args.system.includes('biggest evidence gaps')) {
        // R2 fails fatally, immediately.
        return Promise.reject(new Error('haiku exploded'));
      }
      return new Promise((resolve, reject) => {
        args.signal?.addEventListener(
          'abort',
          () => { siblingOutcomes.push('aborted'); reject(new Error('request aborted')); },
          { once: true },
        );
        // A straggler that would otherwise run to completion (and be paid for).
        setTimeout(() => {
          siblingOutcomes.push('ran-to-completion');
          resolve({
            content: JSON.stringify(goodR1()),
            usage: { input_tokens: 1, output_tokens: 1 },
            model: DEFAULT_DECOMPOSE_MODEL,
            latencyMs: 5,
          });
        }, 300);
      });
    });
    const res = await invokeDecomposedDecisionReview(baseInput(), { requestId: 'r', timeoutMs: 15_000 });
    expect(invokeMonolithMock).toHaveBeenCalledTimes(1);
    expect((res.output as Record<string, unknown>).narrative_summary).toBe('MONOLITH');
    // The three siblings were cancelled the moment the fatal failure landed —
    // none of them ran to completion after the fallback decision was made.
    expect(siblingOutcomes).toEqual(['aborted', 'aborted', 'aborted']);
  });

  it('an already-aborted signal fires no sub-calls and no fallback', async () => {
    const client = new AbortController();
    client.abort();
    await expect(
      invokeDecomposedDecisionReview(baseInput(), { requestId: 'r', timeoutMs: 15_000, signal: client.signal }),
    ).rejects.toThrow(/abort/i);
    expect(chatWithAnthropicMock).not.toHaveBeenCalled();
    expect(invokeMonolithMock).not.toHaveBeenCalled();
  });

  it('resolveDecomposeFallbackBudget: remaining-time clock with a disclosed floor', () => {
    // Plenty left: fallback gets exactly what remains.
    expect(resolveDecomposeFallbackBudget(15_000, 1_000)).toEqual({ timeoutMs: 14_000, floorEngaged: false });
    // Near-exhausted: floored at the minimum viable window, disclosed.
    expect(resolveDecomposeFallbackBudget(15_000, 14_000)).toEqual({
      timeoutMs: DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS,
      floorEngaged: true,
    });
    // Overrun: never negative, still the floor.
    expect(resolveDecomposeFallbackBudget(15_000, 20_000)).toEqual({
      timeoutMs: DECOMPOSE_FALLBACK_MIN_TIMEOUT_MS,
      floorEngaged: true,
    });
    // Small original budget: the floor is capped at the original budget —
    // the fallback never gets MORE than the caller ever allowed.
    expect(resolveDecomposeFallbackBudget(5_000, 4_900)).toEqual({ timeoutMs: 5_000, floorEngaged: true });
  });

  it('the fallback inherits the REMAINING shared budget, not a fresh full clock', async () => {
    chatWithAnthropicMock.mockImplementation(
      () => new Promise((_resolve, reject) => { setTimeout(() => reject(new Error('slice failed')), 25); }),
    );
    await invokeDecomposedDecisionReview(baseInput(), { requestId: 'r', timeoutMs: 15_000 });
    expect(invokeMonolithMock).toHaveBeenCalledTimes(1);
    const fbOptions = invokeMonolithMock.mock.calls[0]![1] as { timeoutMs: number };
    // ≥25ms elapsed in the fan-out — the fallback gets what REMAINS of the one
    // shared deadline (floored at a sane minimum), never the original budget
    // stacked on top of the time already spent.
    expect(fbOptions.timeoutMs).toBeLessThanOrEqual(15_000 - 20);
    expect(fbOptions.timeoutMs).toBeGreaterThanOrEqual(8_000);
  });
});

// ============================================================================
// Authoritative-intersect grounding — empty is NEVER open (Codex r2)
// ============================================================================

describe('checkComposedConsistency — empty authoritative set means empty allowed set', () => {
  it('with NO authoritative evidence gaps, fragment evidence keys are dropped, not passed through', () => {
    const base = baseInput();
    const input = { ...base, deterministic_coaching: { ...base.deterministic_coaching, evidence_gaps: [] } };
    const { ctx } = buildSlices(input);
    const composed = composeFragments(goodR1(), goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctx);
    expect(res.output.evidence_enhancements).toEqual({});
    expect(res.repaired.join(' ')).toMatch(/orphan factor_id "fac-1"/);
  });

  it('with NO authoritative fragile edges, fragment scenario keys are dropped, not passed through', () => {
    const base = baseInput();
    const input = { ...base, isl_results: { ...base.isl_results, fragile_edges: [] } };
    const { ctx } = buildSlices(input);
    const composed = composeFragments(goodR1(), goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctx);
    expect(res.output.scenario_contexts).toEqual({});
    expect(res.repaired.join(' ')).toMatch(/orphan edge_id "edge-1"/);
  });

  it('with NO authoritative flip data, fragment flip_thresholds are dropped, not passed through', () => {
    const { flip_threshold_data: _dropped, ...input } = baseInput();
    const { ctx } = buildSlices(input);
    const composed = composeFragments(goodR1(), goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctx);
    expect(res.output.flip_thresholds).toEqual([]);
    expect(res.repaired.join(' ')).toMatch(/flip_thresholds dropped/);
  });

  it('with NO authoritative options, fragment story_headline keys are dropped, not passed through', () => {
    const base = baseInput();
    const input = { ...base, isl_results: { ...base.isl_results, option_comparison: [] } };
    const { ctx } = buildSlices(input);
    const composed = composeFragments(goodR1(), goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctx);
    expect(res.output.story_headlines).toEqual({});
    expect(res.repaired.join(' ')).toMatch(/orphan option_id/);
  });
});

// ============================================================================
// Winner SEMANTICS — win-cue + option-name, negation-aware (not bare substring)
// ============================================================================

describe('checkComposedConsistency — winner semantics (PQ6 port)', () => {
  it('FATAL: a narrative that NAMES the winner but crowns the runner-up (substring presence is not enough)', () => {
    const r1 = goodR1();
    // The old substring check passes this: "Option A" IS present. But the
    // win-cue sentence crowns Option B — a wrong-winner claim.
    r1.narrative_summary =
      'Option B is the clear leader and should be chosen. Option A remains a credible alternative.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/wrong-winner/i);
  });

  it('consistent: a NEGATED lead sentence about the runner-up does not false-fire', () => {
    const r1 = goodR1();
    r1.narrative_summary =
      'Option B is not the leader here. Option A leads on demand strength and stability.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(true);
    expect(res.fatal).toEqual([]);
  });

  it('consistent: a lead sentence naming BOTH options is skipped (conservative rule)', () => {
    const r1 = goodR1();
    r1.narrative_summary = 'Option A leads Option B on every dimension that matters.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(true);
    expect(res.fatal).toEqual([]);
  });
});

// ============================================================================
// Winner SEMANTICS — WIN_CUE false-positive fix (M5, Codex r2 pre-merge review)
// ============================================================================
//
// The wrong-winner FATAL fired on legitimate per-dimension / historical /
// attention sentences that merely MENTION the runner-up alongside a win-cue
// verb, even when Option A is correctly crowned overall. Each spurious fatal
// burned a paid monolith fallback on a coherent review. The FATAL is now
// restricted to OVERALL-crowning claims. RED-first: against the pre-fix WIN_CUE
// every one of these four narratives fired a wrong-winner fatal.
describe('checkComposedConsistency — WIN_CUE false-positive fix (M5)', () => {
  // Each narrative crowns the true winner (Option A) OVERALL, then mentions the
  // runner-up (Option B) in a NON-crowning per-dimension / historical /
  // attention clause. None of these is a wrong-winner claim.
  const nonCrowningNarratives: Array<[string, string]> = [
    ['per-dimension win (on)', 'Option A is the stronger overall choice and should be chosen. Option B wins on cost.'],
    // Round-4 MAJOR-B: dropping bare `in`/`at` from DIMENSION in round-3 re-opened
    // this class as a false FATAL. RED against round-3.
    ['per-dimension win (in)', 'Option A is the stronger overall choice and should be chosen. Option B wins in cost.'],
    ['per-dimension win (at)', 'Option A is the stronger overall choice and should be chosen. Option B is ahead at speed.'],
    ['action recommendation', 'Option A leads overall and should be chosen. We recommend validating Option B pricing assumptions.'],
    ['historical framing', 'Option A is the clear leader and should be chosen. Option B was ahead in early estimates.'],
    ['attention / objection', 'Option A is recommended overall. The strongest objection concerns Option B costs.'],
  ];

  for (const [label, narrative] of nonCrowningNarratives) {
    it(`consistent: ${label} sentence about the runner-up does not false-fire`, () => {
      const r1 = goodR1();
      r1.narrative_summary = narrative;
      const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
      const res = checkComposedConsistency(composed, ctxFor());
      expect(res.fatal.join(' ')).not.toMatch(/wrong-winner/i);
      expect(res.consistent).toBe(true);
    });
  }

  it('FATAL still fires on a genuine OVERALL crowning of the runner-up (check not gutted)', () => {
    const r1 = goodR1();
    r1.narrative_summary = 'Option B is the better choice overall and should be chosen.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/wrong-winner/i);
  });

  // Round-3 review MAJOR-2: the disqualifiers over-suppressed present-tense
  // crownings. RED against the pre-fix cues (`estimates` in HISTORICAL and the
  // bare `for`/`in` prepositions in DIMENSION suppressed these wrong-winner
  // crownings). Narrative names the CORRECT winner (Option A) in one sentence so
  // the presence check passes, then CROWNS the runner-up in another.
  it('FATAL: an estimates-based present-tense crowning of the runner-up still fires', () => {
    const r1 = goodR1();
    r1.narrative_summary =
      'Option A is the recommended overall choice. The estimates favour Option B; it should be chosen.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/wrong-winner/i);
  });

  it('FATAL: a preposition-containing overall crowning of the runner-up still fires', () => {
    const r1 = goodR1();
    r1.narrative_summary =
      'Option A leads on the evidence. Overall, Option B is the better choice for us and should be chosen.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/wrong-winner/i);
  });

  // Round-4 MAJOR-B: the DIMENSION noun-gate must NOT suppress an overall
  // crowning that merely contains "in <determiner>" — "leads in this decision"
  // is a verdict, not a per-dimension mention.
  it('FATAL: an overall crowning containing "in this decision" still fires (noun-gate not over-broad)', () => {
    const r1 = goodR1();
    r1.narrative_summary =
      'Option A is the recommended overall choice. Option B leads in this decision and should be chosen.';
    const composed = composeFragments(r1, goodR2(), goodR3(), goodR4());
    const res = checkComposedConsistency(composed, ctxFor());
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/wrong-winner/i);
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

// ============================================================================
// Winner NAMING — inflection tolerance (measured false-positive, 2026-07-18)
// ============================================================================
//
// Found by the R6 measurement rig (tools/b1-measure), not by review: over N=5
// paired live runs against a realistic 4-option/5-factor/15-edge decision, the
// composed review fell back to the monolith 5/5 times, and the DOMINANT
// violation on every run was
//   "narrative_summary does not name the winning option".
//
// The narratives were CORRECT. The authoritative winner label was
// "Raise prices by 8 percent"; haiku wrote the grammatically natural gerund
// "Raising prices by 8 percent leads narrowly, ...". The old check asked
// `narrative.includes(label)` — an exact substring match — so a single letter
// of verb inflection (Raise -> Raising) rejected a coherent, correctly-crowned,
// fully-grounded review and burned a paid gpt-4.1 fallback on it.
//
// That is a FALSE POSITIVE in the R1 consistency check, and it is what made the
// measured fallback rate 100% (vs the <10% the rerun criteria require). These
// tests pin the tolerant behaviour. RED-first: every `toBe(true)` case below
// fails against the exact-substring implementation.
//
// The tolerance is DERIVED from the label (stem-prefix on its own tokens), not
// a hand-maintained synonym list — CLAUDE.md trap 12 (a mirror a human must
// remember to sync WILL drift silently, and the drift reads as green).

function inflectionInput(): DecisionReviewInvokeInput {
  const base = baseInput();
  return {
    ...base,
    isl_results: {
      ...base.isl_results,
      option_comparison: [
        { option_id: 'opt-1', option_label: 'Raise prices by 8 percent', win_probability: 0.7, outcome: { mean: 100, p10: 80, p90: 120 } },
        { option_id: 'opt-2', option_label: 'Raise prices by 15 percent', win_probability: 0.3, outcome: { mean: 90, p10: 70, p90: 110 } },
      ],
    },
    winner: { id: 'opt-1', label: 'Raise prices by 8 percent', win_probability: 0.7, outcome_mean: 100 },
    runner_up: { id: 'opt-2', label: 'Raise prices by 15 percent', win_probability: 0.3, outcome_mean: 90 },
  } as DecisionReviewInvokeInput;
}

function inflectionComposition(narrative: string): Record<string, unknown> {
  const r1 = goodR1();
  r1.narrative_summary = narrative;
  r1.story_headlines = { 'opt-1': 'Leads on demand strength', 'opt-2': 'Would lead if demand softened' };
  return composeFragments(r1, goodR2(), goodR3(), goodR4());
}

describe('checkComposedConsistency — winner naming tolerates inflection (measured false-positive)', () => {
  const ctx = () => buildSlices(inflectionInput()).ctx;

  it('consistent: the VERBATIM narrative haiku produced in the live measurement (gerund form)', () => {
    // Reproduced byte-for-byte from tools/b1-measure/diagnose.ts run 0.
    const res = checkComposedConsistency(
      inflectionComposition(
        'Raising prices by 8 percent leads narrowly, with a 22 percentage point advantage over a 15 percent rise, driven primarily by how strongly customer demand responds to price changes.',
      ),
      ctx(),
    );
    expect(res.fatal.join(' ')).not.toMatch(/does not name the winning option/i);
  });

  it('consistent: other natural inflections of the same label still count as naming it', () => {
    for (const narrative of [
      'We raise prices by 8 percent — that option leads on the numbers.',
      'The choice to raising prices by 8 percent is ahead.',
      'Raised prices by 8 percent leads the field.',
    ]) {
      const res = checkComposedConsistency(inflectionComposition(narrative), ctx());
      expect(res.fatal.join(' ')).not.toMatch(/does not name the winning option/i);
    }
  });

  it('FATAL still fires when the narrative genuinely names NO option', () => {
    const res = checkComposedConsistency(
      inflectionComposition('The analysis is close and the result depends on assumptions that remain untested.'),
      ctx(),
    );
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/does not name the winning option/i);
  });

  it('FATAL still fires when the narrative names only the OTHER option — numerals must match exactly', () => {
    // "Raise prices by 15 percent" differs from the winner ONLY in the numeral.
    // Stem-prefix tolerance must NOT collapse 8 and 15 into a match, or the
    // wrong-winner net loses the very distinction it exists to draw.
    const res = checkComposedConsistency(
      inflectionComposition('Raising prices by 15 percent is the stronger route on these numbers.'),
      ctx(),
    );
    expect(res.consistent).toBe(false);
    expect(res.fatal.join(' ')).toMatch(/does not name the winning option|wrong-winner/i);
  });

  it('the WRONG-WINNER semantic check also sees through inflection (both sites share one predicate)', () => {
    // Before the fix the semantic check ALSO matched labels by exact substring,
    // so an inflected crowning of the runner-up was invisible to it. A tolerant
    // presence check plus a strict semantic check would be worse than either:
    // the review would ship, uncaught. Both sites must use the same predicate.
    const res = checkComposedConsistency(
      inflectionComposition(
        'Raising prices by 8 percent is mentioned in passing. Raising prices by 15 percent is the clear leader and should be chosen.',
      ),
      ctx(),
    );
    expect(res.consistent).toBe(false);
    // Assert on the SEMANTIC check's distinctive wording ("crowns X but the
    // authoritative winner is Y"), not the generic /wrong-winner/ substring —
    // the presence check's own message also contains "wrong-winner", so a loose
    // matcher here would pass on the presence check alone and prove nothing
    // about the semantic one.
    expect(res.fatal.join(' ')).toMatch(/crowns "Raise prices by 15 percent"/i);
  });
});
