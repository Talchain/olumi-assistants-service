/**
 * THE WIRING TEST — does the prose/fact seam actually fire on the live path?
 *
 * This estate's first chronic failure is building more than it plugs in: 42
 * roadmap items have been working code no user could reach. A unit suite that
 * proves `checkProseFactAgreement` is correct proves nothing about whether it
 * runs. So this file drives `enrichRunAnalysisWithDecisionReview` — the
 * production entry point — with the VERBATIM 2026-09-03 capture and asserts
 * on the ATTACHED enrichment, i.e. the bytes that get persisted and that every
 * downstream surface reads.
 *
 * It binds by IDENTITY throughout (the exact edge keys, the exact request id
 * on the telemetry event), never by a value predicate another object could
 * satisfy.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import * as invokeMod from '../../../cee/decision-review/invoke.js';
import type { ModelResolution } from '../../../adapters/llm/router.js';
import { enrichRunAnalysisWithDecisionReview } from '../decision-review-enricher.js';
import { TelemetryEvents, setTestSink } from '../../../utils/telemetry.js';
import { VOI_SUPERLATIVE_REPLACEMENT } from '../../../cee/decision-review/prose-fact-agreement.js';

const CAPTURE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'cee',
      'decision-review',
      '__tests__',
      'fixtures',
      'live-decision-review-2026-09-03.json',
    ),
    'utf8',
  ),
) as { enrichment: Record<string, unknown>; decision_review_output: Record<string, unknown> };

const MOCK_RESOLUTION: ModelResolution = {
  task: 'decision_review',
  resolved_model: 'gpt-4.1',
  resolution_source: 'task_default',
  provider: 'openai',
};

const SALES_TO_RUNWAY = '919d7f50->428612e0';
const CAC_TO_GOAL = 'bbbbd8f2->552bd1c0';

/**
 * The captured enrichment, plus the `results` array the enricher needs to
 * resolve a winner. The producer's own subtrees are untouched — only the
 * winner-selection source is supplied, because the capture's
 * `option_comparison` is trimmed out of the fixture.
 */
function liveEnrichment(): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(CAPTURE.enrichment)) as Record<string, unknown>),
    results: [
      { option_id: '94b13741', option_label: 'Continue With Founder-Led Sales', win_probability: 0.6262 },
      { option_id: '05f973ef', option_label: 'Hire a Dedicated Sales Team', win_probability: 0.3705 },
    ],
  };
}

function liveReview(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(CAPTURE.decision_review_output)) as Record<string, unknown>;
}

function invokeResult(output: Record<string, unknown>) {
  return {
    output,
    raw: '{}',
    model: 'gpt-4.1',
    provider: 'openai',
    llm_latency_ms: 40,
    input_tokens: 10,
    output_tokens: 20,
    prompt_version: 'v1',
    prompt_hash: 'sha256:fixturehash',
    prompt_source: 'default' as const,
    resolution: MOCK_RESOLUTION,
  };
}

function runAnalysisFact(enrichment: Record<string, unknown>): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-live',
      leading_option_id: '94b13741',
      summary: 'Ran analysis',
      enrichment,
    },
  };
}

async function enrich(review: Record<string, unknown>, requestId: string) {
  vi.spyOn(invokeMod, 'invokeDecisionReview').mockResolvedValue(invokeResult(review));
  const facts: readonly HandlerFact[] = [runAnalysisFact(liveEnrichment())];
  const out = await enrichRunAnalysisWithDecisionReview({
    handlerFacts: facts,
    requestId,
    scenarioId: 'scen-live',
    signal: new AbortController().signal,
    brief: 'We are at £8k MRR and want to reach £30k within 18 months.',
  });
  expect(out).not.toBe(facts);
  const patched = out[0];
  if (patched.fact_type !== 'run_analysis') throw new Error('narrowing');
  const attached = (patched.result.enrichment as Record<string, unknown>)
    .decision_review as Record<string, unknown>;
  expect(attached).toBeDefined();
  return attached;
}

describe('prose/fact agreement is wired into the live decision_review path', () => {
  let events: Array<{ name: string; data: Record<string, unknown> }>;

  beforeEach(() => {
    vi.restoreAllMocks();
    events = [];
    setTestSink((name, data) => events.push({ name, data }));
  });
  afterEach(() => {
    setTestSink(null);
    vi.restoreAllMocks();
  });

  function proseFactEvents(requestId: string) {
    return events.filter(
      (e) =>
        e.name === TelemetryEvents.V5DecisionReviewProseFactViolation &&
        e.data.request_id === requestId,
    );
  }

  it('strips both inverted counterfactuals from the ATTACHED enrichment', async () => {
    const review = liveReview();
    // PRECONDITION PINNED IN-TEST: the payload we are about to send really
    // does carry the two inverted claims. Without this the assertion below
    // could pass because the fixture stopped containing them.
    expect(Object.keys(review.scenario_contexts as Record<string, unknown>)).toEqual([
      SALES_TO_RUNWAY,
      CAC_TO_GOAL,
    ]);

    const attached = await enrich(review, 'req-pf-directional');
    expect(Object.keys(attached.scenario_contexts as Record<string, unknown>)).toEqual([]);
  });

  it('keeps the rest of the review — this is a redaction, not a drop', async () => {
    const review = liveReview();
    const attached = await enrich(review, 'req-pf-keeps');
    expect(attached.narrative_summary).toBe(review.narrative_summary);
    expect(attached.story_headlines).toEqual(review.story_headlines);
    expect(attached.evidence_enhancements).toEqual(review.evidence_enhancements);
    expect(attached.robustness_explanation).toEqual(review.robustness_explanation);
    expect(attached.decision_quality_prompts).toEqual(review.decision_quality_prompts);
  });

  it('emits one bounded telemetry event naming the rule and the counts', async () => {
    await enrich(liveReview(), 'req-pf-telemetry');
    const fired = proseFactEvents('req-pf-telemetry');
    expect(fired).toHaveLength(1);
    expect(fired[0].data.reason).toBe('directional_claim_contradicts_flip_fact');
    expect(fired[0].data.redacted_contradicted).toBe(2);
    expect(fired[0].data.redacted_ungrounded).toBe(0);
    expect(fired[0].data.unclassified_kept).toBe(0);
    expect(fired[0].data.voi_fields_redacted).toBe(0);
    // R-004: nothing on the event may carry prose or an id from the model's
    // output. Asserted by inspection of every value, not by a field list that
    // would go stale as fields are added.
    for (const [key, value] of Object.entries(fired[0].data)) {
      if (key === 'request_id' || key === 'scenario_id') continue;
      if (typeof value !== 'string') continue;
      expect(value).not.toContain('Sales');
      expect(value).not.toContain('919d7f50');
      expect(value).not.toContain('overtakes');
    }
  });

  it('leaves a DIRECTIONALLY CORRECT counterfactual in place — the twin', async () => {
    // Same edge, same producer fact, the trigger written the way the fact
    // actually points. Without this, "it strips the inverted ones" is
    // satisfied by a seam that strips everything.
    const review = liveReview();
    (review.scenario_contexts as Record<string, Record<string, string>>)[SALES_TO_RUNWAY]
      .trigger_description =
      'If Sales Headcount Investment drives runway depletion risk less than forecast,';
    const attached = await enrich(review, 'req-pf-twin');
    expect(Object.keys(attached.scenario_contexts as Record<string, unknown>)).toEqual([
      SALES_TO_RUNWAY,
    ]);
    const fired = proseFactEvents('req-pf-twin');
    expect(fired).toHaveLength(1);
    expect(fired[0].data.redacted_contradicted).toBe(1);
  });

  it('is silent when every claim agrees with the producer', async () => {
    const review = liveReview();
    const scenarios = review.scenario_contexts as Record<string, Record<string, string>>;
    scenarios[SALES_TO_RUNWAY].trigger_description =
      'If Sales Headcount Investment drives runway depletion risk less than forecast,';
    scenarios[CAC_TO_GOAL].trigger_description =
      'If Customer Acquisition Cost weighs on the goal less than forecast,';
    const attached = await enrich(review, 'req-pf-clean');
    expect(Object.keys(attached.scenario_contexts as Record<string, unknown>)).toEqual([
      SALES_TO_RUNWAY,
      CAC_TO_GOAL,
    ]);
    expect(proseFactEvents('req-pf-clean')).toHaveLength(0);
  });

  it('replaces an unlicensed value-of-information superlative on the live path', async () => {
    const review = liveReview();
    review.readiness_rationale =
      'Validating it (even informally) is the single highest-value check before acting on this result.';
    const attached = await enrich(review, 'req-pf-voi');
    expect(attached.readiness_rationale).toBe(VOI_SUPERLATIVE_REPLACEMENT);
    const fired = proseFactEvents('req-pf-voi');
    expect(fired[0].data.voi_fields_redacted).toBe(1);
    expect(fired[0].data.reasons).toContain('voi_superlative_without_voi_evidence');
  });

  it('leaves the influence sentence alone on the live path — the twin', async () => {
    const review = liveReview();
    const influence =
      'How well you understand your ideal customer has the biggest influence on the outcome.';
    review.readiness_rationale = influence;
    const attached = await enrich(review, 'req-pf-voi-twin');
    expect(attached.readiness_rationale).toBe(influence);
    expect(proseFactEvents('req-pf-voi-twin')[0].data.voi_fields_redacted).toBe(0);
  });
});
