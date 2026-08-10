/**
 * F3 — the runner-up GAP statistic is removed at the enricher's egress seam.
 *
 * ## What this file is for
 *
 * `runner-up-gap-statistic.test.ts` proves the policy is CORRECT. It cannot
 * prove the policy RUNS. Delete the `redactRunnerUpGapStatistic` call from
 * `decision-review-enricher.ts` and every assertion there stays green while the
 * product ships the defect this lane closes — a guard agreeing with itself
 * (CLAUDE.md trap 13b) at the WIRING level rather than the logic level. This
 * file is the mutant that bites for that deletion, and it is modelled directly
 * on `decision-review-enricher.dsk-grounding.test.ts`, which exists for the
 * same reason one seam over.
 *
 * ## The sentence under test is a REAL CAPTURE, not an invention
 *
 * `LIVE_33PP_NARRATIVE` is the narrative the DEPLOYED build `5d69ce0` returned
 * on 10 Aug 2026, in the SAME turn response whose `assistant_text` correctly
 * said "HubSpot came out ahead in 61% of runs of this model" (PR #906's fix,
 * working). One response, two statistics, one of them the ratified-wrong one.
 * That is the defect: a gap between two win frequencies is not a difference in
 * outcome, and it inflates by construction whenever a third option collapses.
 *
 * ## RED-first at pristine (CEE f9ce8c90) — MEASURED
 *
 * This file imports no new module at the top level, so it RUNS at pristine.
 * Measured there: **2 of 3 cases fail**, both with
 * `AssertionError: expected '…33 percentage points…' not to contain
 * 'percentage points'` — the narrative and the robustness summary reach the
 * enrichment verbatim, because the decision_review subtree is a passthrough
 * (F.6) and the only semantic reader in the estate is bound to
 * `assistant_text`.
 *
 * The third case is a CONTROL, not RED-first evidence: it asserts a
 * gap-free review is returned byte-identical, which is trivially true at
 * pristine (nothing touches it). Stated so nobody reads "1 passed" as partial
 * coverage.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as invokeMod from '../../../cee/decision-review/invoke.js';
import type { ModelResolution } from '../../../adapters/llm/router.js';
import { enrichRunAnalysisWithDecisionReview } from '../decision-review-enricher.js';

const MOCK_RESOLUTION: ModelResolution = {
  task: 'decision_review',
  resolved_model: 'gpt-4.1',
  resolution_source: 'task_default',
  provider: 'openai',
};

/**
 * DEPLOYED BUILD 5d69ce0, 10 Aug 2026 — external audit capture. Append-only
 * evidence: this string records what the product ACTUALLY emitted, so it is
 * never edited to match new copy (CLAUDE.md trap 14b).
 */
const LIVE_33PP_NARRATIVE =
  'Switch to HubSpot is the stronger route on the current model, coming out ahead of ' +
  'Salesforce by a margin of 33 percentage points. The result leans heavily on the ' +
  'Sales Team Capacity assumption, which remains the least evidenced input.';

/**
 * The SECOND surface, and the reason this policy is not scoped to
 * `narrative_summary` alone: the same statistic reaches the user through
 * `robustness_explanation.summary` on the monolith contract.
 */
const LIVE_ROBUSTNESS_SUMMARY = 'The lead is 14 percentage points and holds across most runs.';

/** A review that states the RATIFIED-CORRECT statistic and nothing else. */
const CORRECT_NARRATIVE =
  'Switch to HubSpot came out ahead in 61% of runs of this model, driven by Sales Team Capacity. ' +
  'Raising conversion rate by 5 percentage points would not change that ordering.';

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
      { option_id: 'opt-1', option_label: 'Switch to HubSpot', win_probability: 0.61 },
      { option_id: 'opt-2', option_label: 'Salesforce', win_probability: 0.28 },
    ],
    factor_sensitivity: [{ label: 'Sales Team Capacity', direction: 'positive', elasticity: 0.2 }],
    robustness: { level: 'stable', fragile_edges: [] },
    graph: { nodes: [], edges: [] },
  };
}

function mockReviewOutput(output: Record<string, unknown>): void {
  vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue({
    output,
    raw: '{}',
    model: 'gpt-4.1',
    provider: 'openai',
    llm_latency_ms: 200,
    input_tokens: 100,
    output_tokens: 200,
    prompt_version: 'v1',
    resolution: MOCK_RESOLUTION,
  } as never);
}

async function enrichAndReadReview(
  output: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  mockReviewOutput(output);
  const out = await enrichRunAnalysisWithDecisionReview({
    handlerFacts: [runAnalysisFact(minimalEnrichment())],
    requestId: 'req-f3',
    scenarioId: 'scen-a',
    signal: new AbortController().signal,
    brief: 'Should we switch our CRM from Salesforce to HubSpot this quarter?',
  });
  const patched = out[0];
  if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
  const enrichment = patched.result.enrichment as Record<string, unknown>;
  const dr = enrichment.decision_review as Record<string, unknown> | undefined;
  if (dr === undefined) throw new Error('decision_review was not attached');
  return dr;
}

describe('enricher installs the runner-up gap-statistic policy (F3)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('strips the deployed 33-percentage-point gap sentence from narrative_summary', async () => {
    // Precondition, pinned in-test (trap 13b): the fixture must genuinely carry
    // the statistic, or the assertion below is a tautology.
    expect(LIVE_33PP_NARRATIVE).toContain('33 percentage points');

    const dr = await enrichAndReadReview({
      narrative_summary: LIVE_33PP_NARRATIVE,
      story_headlines: {},
      robustness_explanation: { summary: 'Stable across runs.' },
      readiness_rationale: 'Evidence is thin on one factor.',
      evidence_enhancements: {},
      bias_findings: [],
      key_assumptions: [],
      decision_quality_prompts: [],
    });

    const narrative = dr.narrative_summary as string;
    expect(narrative).not.toContain('33 percentage points');
    expect(narrative).not.toContain('by a margin of');
    // The surviving sentence is UNTOUCHED — surgery, not demolition.
    expect(narrative).toContain('Sales Team Capacity assumption');
    // And the narrative is never emptied: an emptied field would compose no
    // review_card at all (phase3-blocks `buildNarrativeCard`).
    expect(narrative.trim().length).toBeGreaterThan(0);
  });

  it('covers the second surface too — robustness_explanation.summary', async () => {
    expect(LIVE_ROBUSTNESS_SUMMARY).toContain('14 percentage points');

    const dr = await enrichAndReadReview({
      narrative_summary: CORRECT_NARRATIVE,
      story_headlines: {},
      robustness_explanation: { summary: LIVE_ROBUSTNESS_SUMMARY },
      readiness_rationale: 'Evidence is thin on one factor.',
      evidence_enhancements: {},
      bias_findings: [],
      key_assumptions: [],
      decision_quality_prompts: [],
    });

    const robustness = dr.robustness_explanation as Record<string, unknown>;
    expect(robustness.summary as string).not.toContain('14 percentage points');
  });

  it('CONTROL: a review that states the leader\'s own win probability is untouched', async () => {
    const dr = await enrichAndReadReview({
      narrative_summary: CORRECT_NARRATIVE,
      story_headlines: { 'opt-1': 'Fastest route to a working pipeline' },
      robustness_explanation: { summary: 'Stable across runs.' },
      readiness_rationale: 'Evidence is thin on one factor.',
      evidence_enhancements: {},
      bias_findings: [],
      key_assumptions: ['Migration cost is bounded'],
      decision_quality_prompts: [],
    });

    // Byte-identical, including the LEGITIMATE factor-context "5 percentage
    // points" in sentence two — the opposite-direction twin at the seam.
    expect(dr.narrative_summary).toBe(CORRECT_NARRATIVE);
    expect((dr.robustness_explanation as Record<string, unknown>).summary).toBe(
      'Stable across runs.',
    );
    expect((dr.story_headlines as Record<string, unknown>)['opt-1']).toBe(
      'Fastest route to a working pipeline',
    );
  });
});
