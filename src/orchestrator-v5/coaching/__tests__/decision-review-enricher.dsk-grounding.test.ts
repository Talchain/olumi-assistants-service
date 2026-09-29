/**
 * 2.491 — the grounding policy is INSTALLED at the enricher's egress seam.
 *
 * ## Why this file exists separately from `dsk-grounding-policy.test.ts`
 *
 * That file proves the policy is CORRECT. It cannot prove the policy RUNS.
 * Delete the `applyDskGroundingPolicy` call from
 * `decision-review-enricher.ts` and every one of its 22 assertions stays
 * green while the product ships exactly the defect 2.491 closes — a guard
 * agreeing with itself (trap 13b) at the wiring level rather than the logic
 * level. This file is the mutant that bites for that deletion.
 *
 * ## RED-first at pristine (CEE f4b4d879) — MEASURED, and corrected
 *
 * This file imports no new module, so it RUNS at pristine. Measured there:
 * **1 of 3 cases fails**, with `AssertionError: expected undefined to be
 * 'attested'` — the FIRST verdict assertion in the batch, not the `'general'`
 * one an earlier version of this docblock recorded.
 *
 * The other two pass at pristine and are controls, not RED-first evidence:
 * the `precondition:` case (asserts the harness has DSK on) and the
 * fail-closed case (asserts nothing is marked when DSK is off — trivially
 * true when nothing marks anything anywhere). Stated so nobody reads "2
 * passed" as partial coverage of the feature.
 *
 * At pristine the enricher passes the LLM output through verbatim (F.6) and
 * no verdict is attached to any entry.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as invokeMod from '../../../cee/decision-review/invoke.js';
import type { ModelResolution } from '../../../adapters/llm/router.js';
import { enrichRunAnalysisWithDecisionReview } from '../decision-review-enricher.js';
import { loadDskBundle, _resetDskBundle } from '../../../orchestrator/dsk-loader.js';
import { config, _resetConfigCache } from '../../../config/index.js';

const MOCK_RESOLUTION: ModelResolution = {
  task: 'decision_review',
  resolved_model: 'gpt-4.1',
  resolution_source: 'task_default',
  provider: 'openai',
};

function runAnalysisFact(enrichment: Record<string, unknown>): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-a',
      leading_option_id: 'opt-1',
      summary: 'Ran analysis',
      enrichment,
    },
  } as HandlerFact;
}

function minimalEnrichment(): Record<string, unknown> {
  return {
    results: [
      { option_id: 'opt-1', option_label: 'Option A', win_probability: 0.7 },
      { option_id: 'opt-2', option_label: 'Option B', win_probability: 0.3 },
    ],
    factor_sensitivity: [{ label: 'Price', direction: 'positive', elasticity: 0.2 }],
    robustness: { level: 'stable', fragile_edges: [] },
    graph: { nodes: [], edges: [] },
  };
}

/**
 * The two live shapes, taken from the walk of 2026-08-05
 * (`PHASE0-EVIDENCE-2026-07-28/walk-dsk-raw/`): one attested prompt and one
 * that shipped with NO id whose principle paraphrases a real protocol title.
 * Both were observed on the same wire.
 */
const LIVE_ATTESTED = {
  question: 'What is the base rate for UK parcel depots needing emergency capacity expansion?',
  principle: 'Outside view and reference class forecasting',
  applies_because: 'Volume risk is the main uncertainty.',
  dsk_claim_id: 'DSK-T-002',
  evidence_strength: 'strong',
  dsk_protocol_id: 'DSK-P-002',
};
const LIVE_UNGROUNDED = {
  question: 'What would make you shift from Add Permanent Night Shift to Lease Second Depot?',
  principle: 'Consider-the-opposite',
  applies_because: 'Add Permanent Night Shift leads with a high margin.',
};
const LIVE_RESOLVABLE = {
  question: 'How would a surge in Average Daily Parcel Volume affect capacity?',
  principle: 'Pre-mortem and prospective hindsight',
  applies_because: 'Volume uncertainty is dominant.',
};
/**
 * A FABRICATED citation. Not observed on the walk, but reachable today: the
 * live V5 path validates claim ids nowhere (`performShapeCheck` is never called
 * from `invoke.ts`), so this shape would have rendered a grounding badge citing
 * a claim that does not exist.
 */
const FABRICATED = {
  question: 'What single number would change your mind fastest?',
  principle: 'Bayesian belief updating under ambiguity',
  applies_because: 'Improvised.',
  dsk_claim_id: 'DSK-T-404',
  dsk_protocol_id: 'DSK-P-404',
  evidence_strength: 'strong',
};

describe('enricher installs the DSK grounding policy (2.491)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    // `DSK_ENABLED` defaults to FALSE (config/index.ts:581) and vitest.setup.ts
    // does not set it, so both the loader and the policy short-circuit without
    // this. Pinned as an explicit precondition below rather than assumed —
    // otherwise every assertion here would fail loudly for the wrong reason.
    vi.stubEnv('DSK_ENABLED', 'true');
    _resetConfigCache();
    _resetDskBundle();
    loadDskBundle();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    _resetConfigCache();
    _resetDskBundle();
  });

  it('precondition: DSK is enabled and the bundle is loaded in this harness', () => {
    // Without this, "no verdict was attached" would be indistinguishable from
    // "the policy was never installed" — the exact confusion this file exists
    // to resolve.
    expect(config.features.dskEnabled).toBe(true);
  });

  it('fail-closed control: with DSK DISABLED nothing is marked, and that is correct', async () => {
    vi.unstubAllEnvs();
    _resetConfigCache();
    _resetDskBundle();
    expect(config.features.dskEnabled).toBe(false);

    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: {
        narrative_summary: 'option A wins',
        story_headlines: ['A ahead'],
        robustness_explanation: 'stable',
        readiness_rationale: 'good',
        evidence_enhancements: [],
        bias_findings: [],
        key_assumptions: [],
        decision_quality_prompts: [LIVE_UNGROUNDED],
      },
      raw: '{}',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 200,
      input_tokens: 100,
      output_tokens: 200,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    } as never);

    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact(minimalEnrichment())],
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: new AbortController().signal,
      brief: 'Decision brief about depot capacity',
    });
    const patched = out[0];
    if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
    const dqps = (
      (patched.result.enrichment as Record<string, unknown>).decision_review as Record<string, unknown>
    ).decision_quality_prompts as Record<string, unknown>[];

    // With no bundle we can neither attest nor honestly disclaim.
    expect(dqps[0].dsk_grounding).toBeUndefined();
    expect(dqps[0].question).toBe(LIVE_UNGROUNDED.question);
  });

  it('attaches a verdict to every decision_quality_prompt on the way out', async () => {
    // Precondition (trap 13b): these fixtures must genuinely differ in the
    // property under test, or the assertions below prove nothing.
    expect('dsk_claim_id' in LIVE_UNGROUNDED).toBe(false);
    expect('dsk_claim_id' in LIVE_RESOLVABLE).toBe(false);
    expect(LIVE_ATTESTED.dsk_claim_id).toBe('DSK-T-002');

    vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
      output: {
        narrative_summary: 'option A wins',
        story_headlines: ['A ahead'],
        robustness_explanation: 'stable',
        readiness_rationale: 'good',
        evidence_enhancements: [],
        bias_findings: [],
        key_assumptions: ['price is elastic'],
        decision_quality_prompts: [LIVE_ATTESTED, LIVE_UNGROUNDED, LIVE_RESOLVABLE, FABRICATED],
      },
      raw: '{}',
      model: 'gpt-4.1',
      provider: 'openai',
      llm_latency_ms: 200,
      input_tokens: 100,
      output_tokens: 200,
      prompt_version: 'v1',
      resolution: MOCK_RESOLUTION,
    } as never);

    const out = await enrichRunAnalysisWithDecisionReview({
      handlerFacts: [runAnalysisFact(minimalEnrichment())],
      requestId: 'req-1',
      scenarioId: 'scen-a',
      signal: new AbortController().signal,
      brief: 'Decision brief about depot capacity',
    });

    const patched = out[0];
    if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
    const dr = (patched.result.enrichment as Record<string, unknown>)
      .decision_review as Record<string, unknown>;
    const dqps = dr.decision_quality_prompts as Record<string, unknown>[];

    // Bound by IDENTITY (trap 19): located by exact question text, never by a
    // predicate another prompt could satisfy.
    const attested = dqps.find((p) => p.question === LIVE_ATTESTED.question)!;
    const ungrounded = dqps.find((p) => p.question === LIVE_UNGROUNDED.question)!;
    const resolvable = dqps.find((p) => p.question === LIVE_RESOLVABLE.question)!;

    // POSITIVE CONTROL — the harness sees the attested arm render correctly,
    // so "the general arm is marked" is not an assertion about an empty tree.
    expect(attested.dsk_grounding).toBe('attested');
    expect(attested.dsk_claim_id).toBe('DSK-T-002');

    // The defect, closed: the ungrounded prompt is now POSITIVELY marked.
    expect(ungrounded.dsk_grounding).toBe('general');
    expect(ungrounded.dsk_claim_id).toBeUndefined(); // and never fabricated

    // And the dropped-citation case is recovered from the bundle, not disclaimed.
    expect(resolvable.dsk_grounding).toBe('resolved');
    expect(resolvable.dsk_claim_id).toBe('DSK-T-001');
    expect(resolvable.dsk_protocol_id).toBe('DSK-P-001');

    // A FABRICATED citation is stripped on the live path — the boundary that
    // `shape-check.ts` was believed to provide and does not reach here.
    const fabricated = dqps.find((p) => p.question === FABRICATED.question)!;
    expect(fabricated.dsk_grounding).toBe('general');
    expect(fabricated.dsk_claim_id).toBeUndefined();
    expect(fabricated.dsk_protocol_id).toBeUndefined();
    expect(fabricated.evidence_strength).toBeUndefined();
    // …and the question itself still reaches the user: we strip the false
    // claim, we do not delete the coaching.
    expect(fabricated.question).toBe(FABRICATED.question);

    // The rest of the F.6 verbatim contract is untouched.
    expect(dr.narrative_summary).toBe('option A wins');
    expect(ungrounded.applies_because).toBe(LIVE_UNGROUNDED.applies_because);
  });
});
