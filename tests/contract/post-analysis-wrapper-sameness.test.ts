/**
 * ROADMAP 1.16j — post-analysis chip wrapper honours the 1.20(b)
 * chip-sameness guard.
 *
 * Verified defect (11 Jul manual test edf2a4d9, VERIFICATION-2026-07-12-A1):
 * `generatePostAnalysisCoaching` mines review_cards from the latest fresh
 * run_analysis fact and appends chips, but its input carried NO
 * `recentlyOfferedChipIds`, so it bypassed the 1.20(b) sameness guard —
 * the identical chip (chip_text_839250dddbc6, card
 * ep_fac_market_timing_fac_salary_cost) was re-offered on all 6
 * post-analysis turns.
 *
 * Pins (1.20(b) convention, NOT new dedupe semantics):
 *  - a chip whose id was offered on the immediately-prior turn is
 *    suppressed (chip_id-keyed, N=1 prior-turn window — same authority
 *    set the `generateChips` guard reads);
 *  - a different review card fills the freed slot when one exists
 *    (alternative card over an identical repeat);
 *  - when EVERY candidate is suppressed, the wrapper ships an honest
 *    empty set (fired: false) and the existing
 *    `v5.chips.recently_offered_suppressed` event is the record — no
 *    Recovered event (nothing was offered), no RecoverySkipped event
 *    (the wrapper did not fail; the guard held);
 *  - the stale-path rerun chip is subject to the same guard;
 *  - omitted set → zero behaviour change (optional + additive, same as
 *    `ChipGeneratorInput.recentlyOfferedChipIds`).
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  generatePostAnalysisCoaching,
  type PostAnalysisWrapperInput,
} from '../../src/orchestrator-v5/coaching/post-analysis-wrapper.js';
import { setTestSink } from '../../src/utils/telemetry.js';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

// On the pre-fix base, PostAnalysisWrapperInput has no
// `recentlyOfferedChipIds` — the intersection keeps this file loadable on
// both sides of the fix so the RED run demonstrates today's behaviour.
type GuardedInput = PostAnalysisWrapperInput & {
  readonly recentlyOfferedChipIds?: ReadonlySet<string>;
};

// ─── telemetry capture ────────────────────────────────────────────────────

type Event = { event: string; data: Record<string, unknown> };

let events: Event[] = [];
beforeEach(() => {
  events = [];
  setTestSink((eventName, data) => events.push({ event: eventName, data }));
});
afterEach(() => {
  setTestSink(null);
});

function recoveredEvents(): Event[] {
  return events.filter((e) => e.event === 'v5.post_analysis.direct_answer_recovered');
}
function skippedEvents(): Event[] {
  return events.filter((e) => e.event === 'v5.post_analysis.direct_answer_recovery_skipped');
}
function suppressionEvents(): Event[] {
  return events.filter((e) => e.event === 'v5.chips.recently_offered_suppressed');
}

// ─── fixtures (mirrors tests/contract/post-analysis-wrapper.test.ts) ─────

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REQUEST_ID = 'req-sameness-test';

function makeRunAnalysisFact(
  reviewCards: ReadonlyArray<Record<string, unknown>>,
): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      win_probabilities: { 'Option A': 0.62, 'Option B': 0.38 },
      summary: 'Ran analysis on your current scenario.',
      enrichment: { review_cards: reviewCards },
      computed_at: '2026-05-01T00:00:00.000Z',
      graph_hash_at_run: 'abc123def456',
    },
  } as unknown as HandlerFact;
}

// Two evidence_priority cards with distinct prose → two DISTINCT
// deterministic prefill chips (chip ids hash the message text).
const CARD_A = {
  card_id: 'ep_fac_market_timing_fac_salary_cost',
  card_type: 'evidence_priority',
  title: 'Market timing evidence',
  items: [
    {
      node_id: 'fac_market_timing',
      factor_label: 'Market timing',
      suggested_evidence: 'Find salary benchmarks for comparable roles.',
    },
  ],
};
const CARD_B = {
  card_id: 'ep_fac_competitor_response',
  card_type: 'evidence_priority',
  title: 'Competitor response evidence',
  items: [
    {
      node_id: 'fac_competitor_response',
      factor_label: 'Competitor response',
      suggested_evidence: 'Look for recent competitor pricing announcements.',
    },
  ],
};

function makeInput(
  reviewCards: ReadonlyArray<Record<string, unknown>>,
  overrides: Partial<GuardedInput> = {},
): GuardedInput {
  return {
    stage: 'analyse',
    priorFacts: [makeRunAnalysisFact(reviewCards)],
    freshness: 'fresh',
    requestId: REQUEST_ID,
    scenarioId: SCENARIO_ID,
    answerText: 'Coaching prose here.',
    ...overrides,
  };
}

/** Turn-1 baseline: run the wrapper with no guard input and return the
 * single generated chip's id — the exact id a repeat offer would carry. */
function firstTurnChipId(card: Record<string, unknown>): string {
  const first = generatePostAnalysisCoaching(makeInput([card]));
  expect(first.fired).toBe(true);
  expect(first.chips).toHaveLength(1);
  events = []; // isolate turn-2 telemetry
  return first.chips[0]!.id;
}

// ─── the 1.16j defect ─────────────────────────────────────────────────────

describe('post-analysis wrapper — 1.20(b) chip-sameness guard (1.16j)', () => {
  it('suppresses a chip offered on the immediately-prior turn (honest empty set with a single card)', () => {
    const chipId = firstTurnChipId(CARD_A);

    // Turn 2: same fresh fact, same single card — but the chip was JUST
    // offered. Pre-fix behaviour (the 11 Jul defect): identical chip
    // re-offered. Post-fix: honest empty set.
    const second = generatePostAnalysisCoaching(
      makeInput([CARD_A], { recentlyOfferedChipIds: new Set([chipId]) }),
    );

    expect(second.chips).toEqual([]);
    expect(second.fired).toBe(false);

    // The existing guard's event is the record of what happened…
    const suppressed = suppressionEvents();
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.data.suppressed_ids).toEqual([chipId]);
    expect(suppressed[0]!.data.survived_count).toBe(0);
    // …and nothing was "recovered" or "skipped" — the guard held.
    expect(recoveredEvents()).toHaveLength(0);
    expect(skippedEvents()).toHaveLength(0);
  });

  it('offers an alternative card over an identical repeat when one exists', () => {
    const chipIdA = firstTurnChipId(CARD_A);

    const second = generatePostAnalysisCoaching(
      makeInput([CARD_A, CARD_B], { recentlyOfferedChipIds: new Set([chipIdA]) }),
    );

    expect(second.fired).toBe(true);
    const ids = second.chips.map((c) => c.id);
    expect(ids).not.toContain(chipIdA);
    expect(second.chips.length).toBeGreaterThanOrEqual(1);
    // The survivor is CARD_B's chip, and the Recovered event reports
    // exactly what was actually offered.
    const recovered = recoveredEvents();
    expect(recovered).toHaveLength(1);
    expect(recovered[0]!.data.generated_chip_ids).toEqual(ids);
    // Suppression is still recorded via the existing guard event.
    const suppressed = suppressionEvents();
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.data.suppressed_ids).toEqual([chipIdA]);
  });

  it('a recently-offered id that matches NO generated chip leaves the output identical (no over-suppression)', () => {
    const plain = generatePostAnalysisCoaching(makeInput([CARD_A]));
    events = [];
    const guarded = generatePostAnalysisCoaching(
      makeInput([CARD_A], {
        recentlyOfferedChipIds: new Set(['chip_action_explain_results']),
      }),
    );

    expect(guarded.fired).toBe(true);
    expect(guarded.chips).toEqual(plain.chips);
    expect(suppressionEvents()).toHaveLength(0);
    expect(recoveredEvents()).toHaveLength(1);
  });

  it('stale path: the rerun chip is subject to the same guard', () => {
    const stalePlain = generatePostAnalysisCoaching(
      makeInput([], { freshness: 'stale' }),
    );
    expect(stalePlain.fired).toBe(true);
    expect(stalePlain.chips).toHaveLength(1);
    const rerunChipId = stalePlain.chips[0]!.id;
    events = [];

    const staleGuarded = generatePostAnalysisCoaching(
      makeInput([], {
        freshness: 'stale',
        recentlyOfferedChipIds: new Set([rerunChipId]),
      }),
    );
    expect(staleGuarded.chips).toEqual([]);
    expect(staleGuarded.fired).toBe(false);
    const suppressed = suppressionEvents();
    expect(suppressed).toHaveLength(1);
    expect(suppressed[0]!.data.suppressed_ids).toEqual([rerunChipId]);
  });

  it('omitted set → zero behaviour change (optional + additive, matches ChipGeneratorInput convention)', () => {
    const result = generatePostAnalysisCoaching(makeInput([CARD_A]));
    expect(result.fired).toBe(true);
    expect(result.chips).toHaveLength(1);
    expect(recoveredEvents()).toHaveLength(1);
    expect(suppressionEvents()).toHaveLength(0);
  });
});
