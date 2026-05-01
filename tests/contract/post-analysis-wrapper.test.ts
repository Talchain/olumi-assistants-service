/**
 * V5 Phase 2 workstream A — post-analysis coaching wrapper acceptance
 * tests.
 *
 * Two layers:
 *  1. Pure unit coverage of `generatePostAnalysisCoaching` — pins
 *     trigger conditions, freshness branching, dedup, prefill vs
 *     executable chip-type partition, fact shape, telemetry events.
 *  2. ChatGPT-named regression cases: "What should I do?" and "How can
 *     I improve confidence?" routed as text_only direct_answer in
 *     analyse stage with a fresh run_analysis fact present must yield
 *     ≥1 chip plus a committed `post_analysis_coaching` fact.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  generatePostAnalysisCoaching,
  type PostAnalysisWrapperInput,
} from '../../src/orchestrator-v5/coaching/post-analysis-wrapper.js';
import { setTestSink } from '../../src/utils/telemetry.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

// ─── helpers ──────────────────────────────────────────────────────────────

type Event = { event: string; data: Record<string, unknown> };

let events: Event[] = [];
beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
});

function recoveredEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.post_analysis.direct_answer_recovered');
}
function skippedEvent(): Event | undefined {
  return events.find((e) => e.event === 'v5.post_analysis.direct_answer_recovery_skipped');
}

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = 'req-coaching-test';

interface FactBuilderOpts {
  reviewCards?: ReadonlyArray<Record<string, unknown>>;
  withGraphHash?: boolean;
}

function makeRunAnalysisFact(opts: FactBuilderOpts = {}): HandlerFact {
  const computedAt = '2026-05-01T00:00:00.000Z';
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      win_probabilities: { 'Option A': 0.62, 'Option B': 0.38 },
      summary: 'Ran analysis on your current scenario.',
      enrichment: {
        review_cards: opts.reviewCards ?? [],
      },
      computed_at: computedAt,
      ...(opts.withGraphHash === false
        ? {}
        : { graph_hash_at_run: 'abc123def456' }),
    },
  } as unknown as HandlerFact;
}

function makeInput(overrides: Partial<PostAnalysisWrapperInput>): PostAnalysisWrapperInput {
  return {
    stage: 'analyse',
    priorFacts: [],
    freshness: 'fresh',
    requestId: REQUEST_ID,
    scenarioId: SCENARIO_ID,
    answerText: 'Coaching prose here.',
    ...overrides,
  };
}

// ─── trigger conditions ───────────────────────────────────────────────────

describe('generatePostAnalysisCoaching — trigger conditions', () => {
  it('skips when stage is not analyse', () => {
    const result = generatePostAnalysisCoaching(makeInput({ stage: 'frame' }));
    expect(result.fired).toBe(false);
    expect(result.chips).toEqual([]);
    expect(result.fact).toBeNull();
    expect(skippedEvent()?.data).toMatchObject({ reason: 'non_analyse_stage' });
  });

  it('skips when freshness is "none"', () => {
    const result = generatePostAnalysisCoaching(makeInput({ freshness: 'none' }));
    expect(result.fired).toBe(false);
    expect(skippedEvent()?.data).toMatchObject({ reason: 'freshness_unknown' });
  });

  it('skips when freshness is "unknown"', () => {
    const result = generatePostAnalysisCoaching(makeInput({ freshness: 'unknown' }));
    expect(result.fired).toBe(false);
    expect(skippedEvent()?.data).toMatchObject({ reason: 'freshness_unknown' });
  });

  it('skips when no run_analysis fact exists', () => {
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [],
      freshness: 'fresh',
    }));
    expect(result.fired).toBe(false);
    expect(skippedEvent()?.data).toMatchObject({ reason: 'no_run_fact' });
  });

  it('skips when fresh fact has no review_cards', () => {
    const fact = makeRunAnalysisFact({ reviewCards: [] });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.fired).toBe(false);
    expect(skippedEvent()?.data).toMatchObject({ reason: 'no_review_cards' });
  });
});

// ─── stale: rerun-only ────────────────────────────────────────────────────

describe('generatePostAnalysisCoaching — stale freshness', () => {
  it('emits exactly one rerun chip with action_type=run_analysis', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{ card_id: 'card_1', card_type: 'evidence_priority', what: 'add evidence' }],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'stale',
    }));
    expect(result.fired).toBe(true);
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0]).toMatchObject({ action_type: 'run_analysis' });
    expect(result.fact).not.toBeNull();
  });

  it('does NOT mix rerun chip with coaching chips', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [
        { card_id: 'c1', card_type: 'evidence_priority', items: [{ factor_label: 'Cost' }] },
        { card_id: 'c2', card_type: 'validate', items: [{ factor_label: 'Quality' }] },
      ],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'stale',
    }));
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0].action_type).toBe('run_analysis');
  });
});

// ─── fresh: chip generation ───────────────────────────────────────────────

describe('generatePostAnalysisCoaching — fresh: chip generation', () => {
  it('maps card_type=evidence_priority → prefill chip (no action_type)', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{
        card_id: 'card_1',
        card_type: 'evidence_priority',
        items: [{ factor_label: 'Cost' }],
      }],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.fired).toBe(true);
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0]).toMatchObject({ label: 'Add evidence' });
    // Prefill chip has no action_type — UI populates composer with message.
    expect(result.chips[0].action_type).toBeUndefined();
    expect(result.chips[0].message).toContain('Cost');
  });

  it('uses items[0].suggested_evidence as message when present (specific over generic)', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{
        card_id: 'card_1',
        card_type: 'evidence_priority',
        items: [{
          factor_label: 'Cost',
          suggested_evidence: 'Find published 2024 hiring cost benchmarks.',
        }],
      }],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.chips[0].message).toBe('Find published 2024 hiring cost benchmarks.');
  });

  it('caps chip count at 3 even with many cards', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: Array.from({ length: 8 }, (_, i) => ({
        card_id: `card_${i}`,
        card_type: 'evidence_priority',
        items: [{ factor_label: `Factor ${i}` }],
      })),
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.chips).toHaveLength(3);
  });

  it('dedupes by intent + target_node_id', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [
        { card_id: 'c1', card_type: 'evidence_priority', items: [{ node_id: 'fac_cost', factor_label: 'Cost' }] },
        // Same intent + same target → deduped
        { card_id: 'c2', card_type: 'evidence_priority', items: [{ node_id: 'fac_cost', factor_label: 'Cost (alt)' }] },
        // Different target → kept
        { card_id: 'c3', card_type: 'evidence_priority', items: [{ node_id: 'fac_quality', factor_label: 'Quality' }] },
      ],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.chips).toHaveLength(2);
  });

  it('falls back to conversational prefill chip for unknown card_type with title', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{
        card_id: 'card_1',
        card_type: 'novel_unknown_type',
        title: 'Reconsider option B carefully',
      }],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0].action_type).toBeUndefined();
    expect(result.chips[0].message).toContain('Reconsider option B');
  });

  it('drops cards with no usable prose and counts them as unsupported', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [
        { card_id: 'c1', card_type: 'novel_unknown_type' /* no title, no what */ },
        { card_id: 'c2', card_type: 'evidence_priority', items: [{ factor_label: 'Cost' }] },
      ],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.chips).toHaveLength(1);
    const skipEv = events.find(
      (e) => e.event === 'v5.post_analysis.direct_answer_recovery_skipped'
        && e.data.reason === 'unsupported_chip_actions',
    );
    expect(skipEv?.data).toMatchObject({ unsupported_count: 1 });
  });
});

// ─── fact + telemetry ─────────────────────────────────────────────────────

describe('generatePostAnalysisCoaching — fact + telemetry', () => {
  it('builds post_analysis_coaching fact with hashed answer + chip ids + selected card ids', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [
        { card_id: 'rc_1', card_type: 'evidence_priority', items: [{ factor_label: 'Cost' }] },
      ],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
      answerText: 'Some coaching prose.',
    }));
    expect(result.fact).not.toBeNull();
    const factResult = (result.fact as { result: Record<string, unknown> }).result;
    expect(factResult.answer_text_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(factResult.selected_review_card_ids).toEqual(['rc_1']);
    expect(factResult.generated_chip_ids).toEqual(result.chips.map((c) => c.id));
    expect(factResult.freshness_at_response).toBe('fresh');
    expect(factResult.invalidates).toEqual([]);
  });

  it('emits PostAnalysisDirectAnswerRecovered when fired with chips', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{ card_id: 'rc_1', card_type: 'evidence_priority', items: [{ factor_label: 'Cost' }] }],
    });
    generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(recoveredEvent()).toBeDefined();
    expect(recoveredEvent()!.data).toMatchObject({
      request_id: REQUEST_ID,
      session_id: SCENARIO_ID,
      chip_count: 1,
      selected_card_count: 1,
    });
  });
});

// ─── ChatGPT-named regression cases ───────────────────────────────────────

describe('generatePostAnalysisCoaching — ChatGPT-named regressions', () => {
  /**
   * Both prompts target the same pre-Phase-2 bug: an analyse-stage
   * direct_answer with a fresh run_analysis fact yielded zero chips.
   * The wrapper closes that gap. These cases pin the contract for the
   * two specific user prompts ChatGPT named in feedback.
   */
  const FRESH_FACT = makeRunAnalysisFact({
    reviewCards: [
      {
        card_id: 'rc_evidence_cost',
        card_type: 'evidence_priority',
        items: [{
          node_id: 'fac_cost',
          factor_label: 'Hiring Cost',
          suggested_evidence: 'Find 2024 senior-engineer salary benchmarks.',
        }],
      },
      {
        card_id: 'rc_validate_quality',
        card_type: 'validate',
        items: [{ node_id: 'fac_quality', factor_label: 'Code Quality' }],
      },
    ],
  });

  it('"What should I do?" → ≥1 chip + post_analysis_coaching fact', () => {
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [FRESH_FACT],
      freshness: 'fresh',
      answerText: 'Given the analysis, the best next step depends on...',
    }));

    expect(result.fired).toBe(true);
    expect(result.chips.length).toBeGreaterThanOrEqual(1);
    expect(result.fact).not.toBeNull();
    expect((result.fact as { fact_type: string }).fact_type).toBe('post_analysis_coaching');
    expect(recoveredEvent()).toBeDefined();
  });

  it('"How can I improve confidence?" → ≥1 chip + post_analysis_coaching fact', () => {
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [FRESH_FACT],
      freshness: 'fresh',
      answerText: 'You can tighten the analysis by adding evidence on...',
    }));

    expect(result.fired).toBe(true);
    expect(result.chips.length).toBeGreaterThanOrEqual(1);
    expect(result.fact).not.toBeNull();
    expect((result.fact as { fact_type: string }).fact_type).toBe('post_analysis_coaching');
    // Different answer text → different hash → distinct fact from prior turn
    const factResult = (result.fact as { result: Record<string, unknown> }).result;
    expect(factResult.answer_text_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
