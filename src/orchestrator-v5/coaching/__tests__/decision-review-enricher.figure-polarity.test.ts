/**
 * NARRATED FIGURES KEEP THEIR MEANING — the enricher's egress seam (the LIVE
 * path) must never ship a "holds" figure the run did not supply.
 *
 * ## Why this is the file that matters
 *
 * `performShapeCheck` is NOT called on the live V5 path (`invoke.ts` never calls
 * it; see `dsk-grounding-policy.ts` and `winner-naming-egress-guard.ts`). So a
 * shape-check fix alone would leave Paul's defect shipping. The live path's
 * repair mechanism is the per-sentence egress surgery the runner-up gap policy
 * already uses at this seam; this file proves the polarity rule RUNS there,
 * which a unit test of the rule cannot (trap 13b at the wiring level).
 *
 * ## The input is Paul's run, the sentence is the served prompt's own template
 *
 * Scenario `58af9704`, 23 Sep 2026: no `robustness.recommendation_stability`
 * (PLoT stopped sending it on 7 Jul) and `fragile_edges[0].switch_probability =
 * 0.6968`. The served prompt (`Prompts/canonical/decision_review.txt:461-465`)
 * tells the model to write "the ordering holds in about 71% of variations";
 * the review wrote it with 70, the flip probability. The capture's full prose
 * is not in this repo, so the sentence below is that template with Paul's
 * figure — stated rather than passed off as a verbatim capture.
 *
 * ## RED-first at staging `c3e3f187` — MEASURED
 *
 * This file imports no new module, so it runs at the base. There the two
 * RED-FIRST cases fail on `expected '…holds in about 70%…' not to contain
 * 'holds in about 70%'`: the decision_review subtree is a verbatim passthrough
 * and nothing on this path asks what a percentage means.
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

const HOLDS_70 = 'Across the model, the ordering holds in about 70% of variations.';
const PRIMARY_RISK_SENTENCE = 'The main risk is the link from Scope to Delivery date.';

function runAnalysisFact(enrichment: Record<string, unknown>): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-58af9704',
      leading_option_id: 'opt_scope',
      summary: 'Ran analysis',
      enrichment,
    },
  } as HandlerFact;
}

/** PLoT V2 envelope shape, the fields of Paul's run that matter. */
function paulsRunEnrichment(robustnessExtra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    option_comparison: [
      { option_id: 'opt_scope', option_label: 'Reduce scope', win_probability: 0.52 },
      { option_id: 'opt_contractor', option_label: 'Hire a contractor', win_probability: 0.33 },
      { option_id: 'opt_sq', option_label: 'Status quo', win_probability: 0.15 },
    ],
    factor_sensitivity: [],
    robustness: {
      level: 'low',
      is_robust: false,
      fragile_edges: [
        {
          edge_id: 'fac_scope->out_delivery',
          from_id: 'fac_scope',
          to_id: 'out_delivery',
          from_label: 'Scope',
          to_label: 'Delivery date',
          switch_probability: 0.6968,
        },
      ],
      ...robustnessExtra,
    },
    graph: { nodes: [], edges: [] },
  };
}

function reviewWith(narrative: string, robustnessSummary: string): Record<string, unknown> {
  return {
    narrative_summary: narrative,
    story_headlines: { opt_scope: 'Protects the delivery date' },
    robustness_explanation: { summary: robustnessSummary },
    readiness_rationale: 'Evidence on scope is thin.',
    evidence_enhancements: {},
    bias_findings: [],
    key_assumptions: [],
    decision_quality_prompts: [],
  };
}

async function enrichAndReadReview(
  enrichment: Record<string, unknown>,
  output: Record<string, unknown>,
): Promise<Record<string, unknown>> {
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
  const out = await enrichRunAnalysisWithDecisionReview({
    handlerFacts: [runAnalysisFact(enrichment)],
    requestId: 'req-58af9704',
    scenarioId: 'scen-58af9704',
    signal: new AbortController().signal,
    brief: 'Should we reduce scope to hit the delivery date?',
  });
  const patched = out[0];
  if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
  const dr = (patched.result.enrichment as Record<string, unknown>).decision_review as
    | Record<string, unknown>
    | undefined;
  if (dr === undefined) throw new Error('decision_review was not attached');
  return dr;
}

describe('enricher egress — narrated figures keep their meaning', () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it('RED-FIRST: stability ABSENT — "holds in about 70%" never reaches the user (narrative_summary)', async () => {
    // Precondition (trap 13b): the run really carries no stability, and 0.6968 is a FLIP probability.
    const enrichment = paulsRunEnrichment();
    expect((enrichment.robustness as Record<string, unknown>).recommendation_stability).toBeUndefined();

    const dr = await enrichAndReadReview(
      enrichment,
      reviewWith(`${HOLDS_70} ${PRIMARY_RISK_SENTENCE}`, 'The result is sensitive to the Scope link.'),
    );

    const narrative = dr.narrative_summary as string;
    expect(narrative).not.toContain('holds in about 70%');
    expect(narrative).not.toMatch(/\b70%/);
    expect(narrative).toContain(
      'This run does not report how often the ordering holds, so no figure is given for it.',
    );
    // Surgery, not demolition: the primary-risk sentence survives verbatim.
    expect(narrative).toContain(PRIMARY_RISK_SENTENCE);
  });

  it('RED-FIRST: the same claim in robustness_explanation.summary is repaired too', async () => {
    const dr = await enrichAndReadReview(
      paulsRunEnrichment(),
      reviewWith('Reduce scope scored highest against your goal in 52% of runs.', HOLDS_70),
    );
    const summary = (dr.robustness_explanation as Record<string, unknown>).summary as string;
    expect(summary).not.toContain('70%');
    expect(summary.trim().length).toBeGreaterThan(0);
  });

  it('CONTRAST: stability PRESENT at 0.71 — "holds in about 71%" passes byte-identical', async () => {
    const narrative = `Across the model, the ordering holds in about 71% of variations. ${PRIMARY_RISK_SENTENCE}`;
    const dr = await enrichAndReadReview(
      paulsRunEnrichment({ recommendation_stability: 0.71 }),
      reviewWith(narrative, 'The result is sensitive to the Scope link.'),
    );
    expect(dr.narrative_summary).toBe(narrative);
  });

  it('CONTRAST: "could flip in about 70%" grounded in switch_probability 0.6968 passes byte-identical', async () => {
    const narrative = `The ordering could flip in about 70% of variations of the Scope link. ${PRIMARY_RISK_SENTENCE}`;
    const dr = await enrichAndReadReview(
      paulsRunEnrichment(),
      reviewWith(narrative, 'The result is sensitive to the Scope link.'),
    );
    expect(dr.narrative_summary).toBe(narrative);
  });
});
