/**
 * V5 Phase 2 workstream A — post-analysis coaching wrapper acceptance
 * tests.
 *
 * Pins:
 *  - Trigger conditions and skip-telemetry policy (silent for trivial
 *    non-trigger paths, diagnostic for expected-fire-but-blocked).
 *  - Stale freshness yields rerun-only chip.
 *  - Fresh freshness mines review_cards with multi-item scan.
 *  - Defensive prose sanitisation of card-derived chip text.
 *  - Recovery state travels on telemetry, NOT on a persisted fact
 *    (P0 fix — strict-parse of HandlerFactSchema would poison the
 *    fact chain).
 *  - ChatGPT-named regression cases ("What should I do?", "How can I
 *    improve confidence?") yield ≥1 chip + Recovered telemetry.
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
function skippedEvents(): Event[] {
  return events.filter((e) => e.event === 'v5.post_analysis.direct_answer_recovery_skipped');
}

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = 'req-coaching-test';

interface FactBuilderOpts {
  reviewCards?: ReadonlyArray<Record<string, unknown>>;
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
      graph_hash_at_run: 'abc123def456',
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

// ─── trigger conditions + telemetry policy ────────────────────────────────

describe('generatePostAnalysisCoaching — silent non-trigger paths', () => {
  it('skips silently when stage is not analyse (no telemetry noise)', () => {
    const result = generatePostAnalysisCoaching(makeInput({ stage: 'frame' }));
    expect(result.fired).toBe(false);
    expect(result.chips).toEqual([]);
    expect(result.skipReason).toBe('non_analyse_stage');
    // Every direct_answer turn passes through here — telemetry would
    // dwarf the diagnostic signal. Silent.
    expect(skippedEvents()).toHaveLength(0);
  });

  it('skips silently when freshness is "none" (pre-analysis turn)', () => {
    const result = generatePostAnalysisCoaching(makeInput({ freshness: 'none' }));
    expect(result.fired).toBe(false);
    expect(result.skipReason).toBe('freshness_unknown');
    expect(skippedEvents()).toHaveLength(0);
  });

  it('skips silently when freshness is "unknown"', () => {
    const result = generatePostAnalysisCoaching(makeInput({ freshness: 'unknown' }));
    expect(result.fired).toBe(false);
    expect(skippedEvents()).toHaveLength(0);
  });
});

describe('generatePostAnalysisCoaching — diagnostic skip paths', () => {
  it('emits telemetry when no run_analysis fact exists (expected-fire blocked)', () => {
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [],
      freshness: 'fresh',
    }));
    expect(result.fired).toBe(false);
    expect(skippedEvents()).toHaveLength(1);
    expect(skippedEvents()[0].data).toMatchObject({ reason: 'no_run_fact' });
  });

  it('emits telemetry when fresh fact has no review_cards', () => {
    const fact = makeRunAnalysisFact({ reviewCards: [] });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.fired).toBe(false);
    expect(skippedEvents()[0].data).toMatchObject({ reason: 'no_review_cards' });
  });
});

// ─── no-fact-persistence pin (P0) ─────────────────────────────────────────

describe('generatePostAnalysisCoaching — does NOT emit a persisted fact', () => {
  it('result has no `fact` field; recovery state lives on telemetry', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{ card_id: 'rc1', card_type: 'evidence_priority', items: [{ factor_label: 'Cost' }] }],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
      answerText: 'What should I do?',
    }));
    expect(result.fired).toBe(true);
    // No `fact` field on the result type — recovery state is telemetry only.
    expect((result as Record<string, unknown>).fact).toBeUndefined();

    // The recovery telemetry carries the fact-equivalent payload so ops
    // can reconstruct what happened without reading the ledger.
    const ev = recoveredEvent();
    expect(ev).toBeDefined();
    expect(ev!.data).toMatchObject({
      chip_count: 1,
      selected_card_count: 1,
      selected_review_card_ids: ['rc1'],
      freshness_at_response: 'fresh',
    });
    expect(ev!.data.answer_text_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(Array.isArray(ev!.data.generated_chip_ids)).toBe(true);
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

// ─── fresh: chip generation + multi-item scan ─────────────────────────────

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
    expect(result.chips[0].action_type).toBeUndefined();
    expect(result.chips[0].message).toContain('Cost');
  });

  it('uses suggested_evidence as message when present (specific over generic)', () => {
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

  it('scans ALL items[] for suggested_evidence — picks first usable', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{
        card_id: 'card_1',
        card_type: 'evidence_priority',
        items: [
          { factor_label: 'Cost' /* no suggested_evidence on items[0] */ },
          { factor_label: 'Quality', suggested_evidence: 'Survey current customers about quality.' },
          { factor_label: 'Speed', suggested_evidence: 'Benchmark competitor rollout times.' },
        ],
      }],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    // First item has no suggested_evidence; second item's wins.
    expect(result.chips[0].message).toBe('Survey current customers about quality.');
  });

  it('scans ALL items[] for node_id when items[0] lacks one', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [
        { card_id: 'c1', card_type: 'evidence_priority', items: [
          { factor_label: 'A' /* no node_id */ },
          { node_id: 'fac_target', factor_label: 'B' },
        ]},
        { card_id: 'c2', card_type: 'evidence_priority', items: [
          { factor_label: 'C' /* no node_id */ },
          { node_id: 'fac_target', factor_label: 'D' },
        ]},
      ],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    // Both cards' second-item node_id is 'fac_target' → dedupe collapses them.
    expect(result.chips).toHaveLength(1);
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
    const skipEv = skippedEvents().find((e) => e.data.reason === 'unsupported_chip_actions');
    expect(skipEv?.data).toMatchObject({ unsupported_count: 1 });
  });
});

// ─── defensive sanitisation (P1) ──────────────────────────────────────────

describe('generatePostAnalysisCoaching — defensive prose sanitisation', () => {
  it('suppresses chip when title carries an entity-id leak', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{
        card_id: 'card_1',
        card_type: 'novel_unknown_type',
        // Bad input: surfaces a raw factor id token in user-visible prose.
        title: "Node 'fac_hiring_cost' needs review.",
      }],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    expect(result.fired).toBe(false); // no chip → no fire
    expect(skippedEvents().some((e) => e.data.reason === 'no_review_cards')).toBe(true);
  });

  it('suppresses suggested_evidence when it leaks an entity id', () => {
    const fact = makeRunAnalysisFact({
      reviewCards: [{
        card_id: 'card_1',
        card_type: 'evidence_priority',
        items: [{
          factor_label: 'Cost',
          suggested_evidence: 'Compare opt_a vs opt_b on cost.',
        }],
      }],
    });
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [fact],
      freshness: 'fresh',
    }));
    // The leaky suggested_evidence is suppressed; falls back to the
    // deterministic phrasing keyed on factor_label.
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0].message).not.toContain('opt_a');
    expect(result.chips[0].message).toContain('Cost');
  });
});

// ─── ChatGPT-named regression cases ───────────────────────────────────────

describe('generatePostAnalysisCoaching — ChatGPT-named regressions', () => {
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

  it('"What should I do?" → ≥1 chip + Recovered telemetry', () => {
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [FRESH_FACT],
      freshness: 'fresh',
      answerText: 'Given the analysis, the best next step depends on...',
    }));

    expect(result.fired).toBe(true);
    expect(result.chips.length).toBeGreaterThanOrEqual(1);
    const ev = recoveredEvent();
    expect(ev).toBeDefined();
    expect(ev!.data.freshness_at_response).toBe('fresh');
  });

  it('"How can I improve confidence?" → ≥1 chip + Recovered telemetry', () => {
    const result = generatePostAnalysisCoaching(makeInput({
      priorFacts: [FRESH_FACT],
      freshness: 'fresh',
      answerText: 'You can tighten the analysis by adding evidence on...',
    }));

    expect(result.fired).toBe(true);
    expect(result.chips.length).toBeGreaterThanOrEqual(1);
    expect(recoveredEvent()).toBeDefined();
  });
});
