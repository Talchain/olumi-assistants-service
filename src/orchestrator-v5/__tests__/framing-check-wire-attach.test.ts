/**
 * ⭐ TRACK 3 — THE WIRING PROOF. `framing_check` reaches the wire.
 *
 * WHY A SECOND SUITE. This estate's chronic failure #1 is building something
 * and never plugging it in — 42 roadmap items have been working code no user
 * could reach. A green unit suite for a block BUILDER says nothing about
 * whether the composer calls it. So this file goes through
 * `composeToolCallResponse`, the same entry the live turn path uses, and
 * asserts the block is in `response.blocks`.
 *
 * AND THE HALF THAT WOULD HAVE SHIPPED DARK. `coaching_kind: 'strengthen'` is
 * in compose.ts's `LEADER_PRESUMING_COACHING_KINDS`, because every LENS
 * SUGGESTION is `strengthen` and a lens is chosen over a leading option. The
 * framing card shares the kind and presumes nothing — so without the
 * `signal_code`-bound exemption in `presumesLeadingOption` it would have been
 * suppressed on exactly the WITHHELD turns where "is this the question you
 * meant to ask?" is worth most, and suppressed SILENTLY: the card would simply
 * never appear, and no assertion keyed on the permitted arm would notice.
 *
 * THE DISCRIMINATING PAIR (trap 19 — a single assertion proves sensitivity to
 * SOMETHING, a pair proves sensitivity to the NAMED thing):
 *   - on a WITHHELD turn the framing card SHIPS while the leader-presuming
 *     review cards are dropped in the same response — so the suppression is
 *     demonstrably live and the framing card demonstrably escaped it;
 *   - a framing card whose own body ASSERTS a leader is dropped on that same
 *     withheld turn — so the exemption is a content test, not a hole.
 */

import { describe, expect, it } from 'vitest';
import { BlockSchema } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { composeToolCallResponse } from '../compose.js';
import { GUIDANCE_SIGNAL_CODES } from '../compose/guidance-signals.js';

const GRAPH_HASH = 'gh_framing_wire_0001';
const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const GOAL_LABEL = 'Move every customer onto annual billing';
const CONCERN = 'The goal names an action to take rather than the outcome the team wants.';
const REFRAME = 'Make revenue predictable enough to plan hiring a quarter ahead';

interface Opts {
  readonly framingCheck?: Record<string, unknown> | null;
  readonly mayNameLeader?: boolean;
}

function makeFact({ framingCheck = null, mayNameLeader = true }: Opts): HandlerFact {
  const decisionReview: Record<string, unknown> = {
    produced_at: '2026-09-18T09:00:00.000Z',
    narrative_summary: 'Annual billing leads on predictability.',
    story_headlines: { opt_a: 'Annual billing leads' },
    robustness_explanation: {
      summary: 'The lead holds across most scenarios.',
      primary_risk: 'Churn sensitivity could compress it.',
      stability_factors: [],
      fragility_factors: [],
    },
    readiness_rationale: 'Model is ready.',
    evidence_enhancements: {},
    scenario_contexts: {},
    flip_thresholds: [],
    bias_findings: [],
    key_assumptions: [],
    decision_quality_prompts: [],
  };
  if (framingCheck !== null) decisionReview.framing_check = framingCheck;

  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      win_probabilities: { opt_a: 0.7 },
      graph_hash_at_run: GRAPH_HASH,
      computed_at: '2026-09-18T09:00:00.000Z',
      enrichment: {
        graph: {
          nodes: [
            { id: 'goal_annual', label: GOAL_LABEL, kind: 'goal' },
            { id: 'fac_churn', label: 'Churn risk', kind: 'factor' },
          ],
        },
        __cee_claim_safety: {
          may_name_leading_option: mayNameLeader,
          constraint_verdict_state: mayNameLeader ? 'evaluated_feasible' : 'evaluated_infeasible',
        },
        factor_sensitivity: [{ factor_id: 'fac_churn', confidence: 0.2 }],
        option_comparison: [
          {
            option_id: 'opt_a',
            option_label: 'Annual billing',
            status: 'computed',
            outcome: { mean: 0.05, p10: -0.1, p50: 0.05, p90: 0.2 },
            win_probability: 0.7,
          },
        ],
        decision_review: decisionReview,
      },
    },
  } as unknown as HandlerFact;
}

function compose(opts: Opts) {
  return composeToolCallResponse({
    answerKind: 'functional',
    orientation: '',
    confirmation: 'Ran analysis on your current scenario.',
    coaching: null,
    stage: 'analyse',
    handlerFacts: [makeFact(opts)],
  });
}

function framingCards(blocks: readonly unknown[]) {
  return blocks.filter(
    (b) =>
      (b as { type?: unknown }).type === 'coaching' &&
      (b as { signal_code?: unknown }).signal_code === GUIDANCE_SIGNAL_CODES.FRAMING_CHECK,
  ) as Array<{ body: string; title: string; priority_rank: number; coaching_kind: string }>;
}

const FULL_FRAMING = { addresses_goal: false, concern: CONCERN, suggested_reframe: REFRAME };

describe('TRACK 3 wiring — the composer emits the framing card', () => {
  it('positive control: with framing_check present, exactly one framing card is on the wire', () => {
    const cards = framingCards(compose({ framingCheck: FULL_FRAMING }).blocks);
    expect(cards).toHaveLength(1);
    expect(cards[0]!.coaching_kind).toBe('strengthen');
  });

  it('contrast: the SAME fact without framing_check emits none — so the assertion above is not blind', () => {
    expect(framingCards(compose({}).blocks)).toHaveLength(0);
  });

  it('the card carries the team’s goal, the concern and the reframe all the way to the wire', () => {
    const body = framingCards(compose({ framingCheck: FULL_FRAMING }).blocks)[0]!.body;
    expect(body).toContain(`You framed this as “${GOAL_LABEL}”.`);
    expect(body).toContain(CONCERN);
    expect(body).toContain(REFRAME);
  });

  it('every composed block still validates against the wire BlockSchema', () => {
    for (const block of compose({ framingCheck: FULL_FRAMING }).blocks) {
      const parsed = BlockSchema.safeParse(block);
      if (!parsed.success) {
        throw new Error(
          `Block failed BlockSchema (type=${(block as { type?: unknown }).type}): ` +
            JSON.stringify(parsed.error.flatten()),
        );
      }
    }
  });

  it('it is the FIRST phase-3 card in composed order, and ranks ahead of every other phase-3 block', () => {
    const blocks = compose({ framingCheck: FULL_FRAMING }).blocks;
    const ranked = blocks
      .map((b) => (b as { priority_rank?: unknown }).priority_rank)
      .filter((r): r is number => typeof r === 'number');
    expect(ranked.length, 'other ranked phase-3 blocks must exist, or this proves nothing')
      .toBeGreaterThan(1);
    expect(Math.min(...ranked)).toBe(5);
    const firstRankedIndex = blocks.findIndex(
      (b) => typeof (b as { priority_rank?: unknown }).priority_rank === 'number',
    );
    expect((blocks[firstRankedIndex] as { signal_code?: unknown }).signal_code).toBe(
      GUIDANCE_SIGNAL_CODES.FRAMING_CHECK,
    );
  });
});

describe('TRACK 3 wiring — the WITHHELD turn, where the card is worth most', () => {
  it('DISCRIMINATING PAIR ①: on a withheld turn the framing card ships while leader-presuming cards are dropped in the same response', () => {
    const blocks = compose({ framingCheck: FULL_FRAMING, mayNameLeader: false }).blocks;
    // The framing card survived.
    expect(framingCards(blocks)).toHaveLength(1);
    // …and the suppression it survived is demonstrably live in the same run:
    // the narrative review card (LEADER_PRESUMING_CARD_KINDS) is gone.
    const narrative = blocks.filter(
      (b) =>
        (b as { type?: unknown }).type === 'review_card' &&
        (b as { card_kind?: unknown }).card_kind === 'narrative',
    );
    expect(narrative, 'the withheld arm must actually be suppressing something').toHaveLength(0);
    // Control: on the permitted arm that same card IS emitted, so its absence
    // above is the filter's doing and not a fixture that never built it.
    const permitted = compose({ framingCheck: FULL_FRAMING }).blocks.filter(
      (b) =>
        (b as { type?: unknown }).type === 'review_card' &&
        (b as { card_kind?: unknown }).card_kind === 'narrative',
    );
    expect(permitted.length).toBeGreaterThan(0);
  });

  it('DISCRIMINATING PAIR ②: a framing card whose OWN body asserts a leader is dropped on a withheld turn — the exemption is a content test, not a hole', () => {
    const blocks = compose({
      framingCheck: {
        addresses_goal: false,
        concern: 'Annual billing leads by a clear margin, so the goal may be mis-stated.',
      },
      mayNameLeader: false,
    }).blocks;
    expect(framingCards(blocks)).toHaveLength(0);
    // Control: the identical payload on a PERMITTED turn does ship, so the drop
    // above is the claim-safety test firing and not a builder-level rejection.
    const permitted = framingCards(
      compose({
        framingCheck: {
          addresses_goal: false,
          concern: 'Annual billing leads by a clear margin, so the goal may be mis-stated.',
        },
      }).blocks,
    );
    expect(permitted).toHaveLength(1);
  });
});
