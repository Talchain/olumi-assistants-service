/**
 * THE `lever_named` RULING — pre-mortem only.
 *
 * ─────────────────────────────────────────────────────────────────
 * The measurement that forced the question
 * ─────────────────────────────────────────────────────────────────
 * `fix-2211-lens-emission.md` §1.1–1.4 replayed `buildPreMortemCard` over the
 * walk's REAL captured wire bytes. Of the 6 classifiable turns, the producer
 * emitted a `pre_mortem` object on 4 — and the `lever_named` guard ate **2 of
 * those 4**. A 50% loss rate on the pre-mortem card, from a guard written for a
 * different surface. Attribution was WITNESSED, not assumed: a3 named
 * `Market Demand` + `Sales Team Capacity` and dropped, a5 named `Market Demand`
 * alone and survived, so the lever was `fac_sales_capacity`.
 *
 * ─────────────────────────────────────────────────────────────────
 * The ruling (orchestrator; Paul's no-recommendations doctrine as the frame)
 * ─────────────────────────────────────────────────────────────────
 * Doctrine D-U F2 exists so a factor the user CONTROLS by choosing an option is
 * never named as an UNCERTAINTY to gather evidence about, nor as a choice the
 * system steers. A pre-mortem is a different speech act: it is "imagine the
 * option you chose did not pay off, what broke?". Naming the chosen lever as
 * the thing that FAILED is a failure watch-point — coaching, not steering.
 *
 * So: **the lever ban is scoped OUT of the pre-mortem card path, and ONLY
 * that path.** Every surface where naming a lever steers a choice keeps the
 * ban unchanged — narrative, scenario_context, calibration prompts, assumption
 * checks, and the evidence surfaces (which use the structural `isLeverFactor`
 * skip, a separate mechanism this ruling does not touch).
 *
 * The scope tests below are not decoration: they are the pin that makes a
 * MUTANT which widens the ruling to any other surface go RED.
 *
 * ─────────────────────────────────────────────────────────────────
 * Second half — the two SILENT exits
 * ─────────────────────────────────────────────────────────────────
 * §1.1 also recorded that exits 1 and 2 of the builder (`pre_mortem` not a
 * record; `failure_scenario` empty after trim) `return null` with NO
 * `emitDrop`. On the walk those two exits accounted for 2 of the 6 turns —
 * i.e. the two commonest causes of "no card" were exactly the two the drop
 * dashboard could not see, so it under-counted the true drop rate by precisely
 * the producer-absent rate. That is the broken-alarm shape (CLAUDE.md trap 7):
 * a counter that reads healthy because it is blind.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { log } from '../../../utils/telemetry.js';
import {
  buildCoachingBlocks,
  buildEvidenceBlocks,
  buildFactorConfidenceLookup,
  buildGraphNodeLookup,
  buildReviewCardBlocks,
  type BlockBuildCtx,
} from '../phase3-blocks.js';

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-05-16T15:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

const FACTOR_SALES = { id: 'fac_sales_capacity', label: 'Sales Team Capacity', kind: 'factor' };
const FACTOR_DEMAND = { id: 'fac_market_demand', label: 'Market Demand', kind: 'factor' };
const EDGE_SALES_GOAL = {
  id: 'edge_sales_goal',
  label: 'Sales Team Capacity → Revenue growth',
  kind: 'edge',
};
const WALK_GRAPH_NODES = [FACTOR_SALES, FACTOR_DEMAND, EDGE_SALES_GOAL];

/** The walk's lever set: an option ("Expand Sales Team") intervenes on it. */
const LEVERS = new Set(['fac_sales_capacity']);

function makeFact(input: {
  readonly decisionReview?: Record<string, unknown>;
  readonly graphNodes?: ReadonlyArray<Record<string, unknown>>;
  readonly factorSensitivity?: ReadonlyArray<Record<string, unknown>>;
} = {}): RunAnalysisHandlerFact {
  const enrichment: Record<string, unknown> = {};
  if (input.decisionReview !== undefined) enrichment.decision_review = input.decisionReview;
  if (input.graphNodes !== undefined) enrichment.graph = { nodes: input.graphNodes };
  if (input.factorSensitivity !== undefined) enrichment.factor_sensitivity = input.factorSensitivity;
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      enrichment,
      computed_at: '2026-05-16T14:59:00.000Z',
      graph_hash_at_run: GRAPH_HASH,
    },
  } as unknown as RunAnalysisHandlerFact;
}

/** The a3 shape: producer present, failure prose NAMES the lever factor. */
function a3Fact(): RunAnalysisHandlerFact {
  return makeFact({
    decisionReview: {
      pre_mortem: {
        failure_scenario:
          'Twelve months on, growth has stalled because Sales Team Capacity never scaled the way the plan assumed.',
      },
    },
    graphNodes: WALK_GRAPH_NODES,
  });
}

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

function dropReasonsFor(kind: string): string[] {
  const calls = warnSpy.mock.calls as unknown as ReadonlyArray<readonly unknown[]>;
  return calls
    .map((call): Record<string, unknown> | undefined =>
      call[0] !== null && typeof call[0] === 'object'
        ? (call[0] as Record<string, unknown>)
        : undefined,
    )
    .filter(
      (payload): payload is Record<string, unknown> =>
        payload !== undefined &&
        payload.event === 'v5.phase3.block_dropped' &&
        payload.block_kind === kind,
    )
    .map((payload) => String(payload.drop_reason));
}

describe('pre_mortem — the lever_named ruling', () => {
  it('RED-FIRST: the walk a3 shape (producer present, lever named) SHIPS the card', () => {
    const fact = a3Fact();
    const card = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS).find(
      (b) => b.card_kind === 'pre_mortem',
    );

    expect(card).toBeDefined();
    // A pre-mortem naming the lever as a FAILURE WATCH-POINT is coaching.
    expect(card?.body).toContain('Sales Team Capacity');
  });

  it('the shipped card still carries the hypothetical frame and its graph anchor', () => {
    // The ruling scopes out ONE guard. Every other rule on this path — BIND
    // (hypothetical frame) and ANCHOR (grounded in the user's model) — must
    // still hold, or the ruling has quietly widened into "ship anything".
    const fact = a3Fact();
    const card = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS).find(
      (b) => b.card_kind === 'pre_mortem',
    );

    expect(card?.body.toLowerCase()).toMatch(/^(?:imagine|suppose|picture|what if|if\b)/);
    expect(card?.card_kind).toBe('pre_mortem');
  });

  it('no `lever_named` drop is emitted for pre_mortem any more', () => {
    const fact = a3Fact();
    buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS);
    expect(dropReasonsFor('pre_mortem')).not.toContain('lever_named');
  });

  it('an unanchored lever-naming pre-mortem is STILL dropped (context_unanchored survives)', () => {
    // Lever naming no longer drops; naming NOTHING in the user's model still
    // does. Proves the removal was surgical, not a hole in the path.
    const fact = makeFact({
      decisionReview: {
        pre_mortem: { failure_scenario: 'Things went wrong for reasons nobody wrote down.' },
      },
      graphNodes: WALK_GRAPH_NODES,
    });
    const card = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS).find(
      (b) => b.card_kind === 'pre_mortem',
    );

    expect(card).toBeUndefined();
    expect(dropReasonsFor('pre_mortem')).toContain('context_unanchored');
  });
});

describe('pre_mortem — the two SILENT exits now emit drop telemetry', () => {
  it('RED-FIRST: producer emitted no pre_mortem object → `producer_absent` drop', () => {
    // The walk's a2/a6 turns. Previously a bare `return null`: the dashboard
    // could not see the single commonest cause of a missing card.
    const fact = makeFact({
      decisionReview: { narrative_summary: 'Some other coaching.' },
      graphNodes: WALK_GRAPH_NODES,
    });
    buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS);

    expect(dropReasonsFor('pre_mortem')).toContain('producer_absent');
  });

  it('RED-FIRST: empty / whitespace failure_scenario → `failure_scenario_empty` drop', () => {
    const fact = makeFact({
      decisionReview: { pre_mortem: { failure_scenario: '   ' } },
      graphNodes: WALK_GRAPH_NODES,
    });
    buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS);

    expect(dropReasonsFor('pre_mortem')).toContain('failure_scenario_empty');
  });

  it('a shipped card emits NO pre_mortem drop at all (the counter is not now over-counting)', () => {
    const fact = a3Fact();
    buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS);
    expect(dropReasonsFor('pre_mortem')).toEqual([]);
  });
});

// ============================================================================
// SCOPE PIN — the ruling is pre-mortem ONLY. A mutant that widens it to any
// other surface must turn these RED.
// ============================================================================
describe('the lever ban is UNCHANGED on every other surface', () => {
  it('narrative naming the lever is still dropped', () => {
    const fact = makeFact({
      decisionReview: {
        narrative_summary: 'The outcome hinges on Sales Team Capacity, which stays deeply uncertain.',
      },
      graphNodes: WALK_GRAPH_NODES,
    });
    expect(
      buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS).find(
        (b) => b.card_kind === 'narrative',
      ),
    ).toBeUndefined();
    expect(dropReasonsFor('narrative')).toContain('lever_named');
  });

  it('scenario_context naming the lever is still skipped', () => {
    const fact = makeFact({
      decisionReview: {
        scenario_contexts: {
          edge_sales_goal: {
            trigger_description: 'If Sales Team Capacity spikes',
            consequence: 'the launch slips badly.',
          },
        },
      },
      graphNodes: WALK_GRAPH_NODES,
    });
    expect(
      buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS).find(
        (b) => b.card_kind === 'scenario_context',
      ),
    ).toBeUndefined();
  });

  it('calibration prompts naming the lever are still dropped; non-lever prompts ship', () => {
    const fact = makeFact({
      decisionReview: {
        decision_quality_prompts: [
          { question: 'How confident are you about Sales Team Capacity?', principle: 'Calibration' },
          { question: 'Have you considered the base rate?', principle: 'Base rates' },
        ],
      },
      graphNodes: WALK_GRAPH_NODES,
    });
    const bodies = buildCoachingBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS)
      .filter((b) => b.coaching_kind === 'calibration_prompt')
      .map((b) => b.body);
    expect(bodies).toEqual(['Have you considered the base rate?']);
  });

  it('assumption checks naming the lever are still dropped', () => {
    const fact = makeFact({
      decisionReview: {
        key_assumptions: [
          'Sales Team Capacity can be doubled within two quarters.',
          'Market Demand estimates are uncertain.',
        ],
      },
      graphNodes: WALK_GRAPH_NODES,
    });
    const bodies = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS)
      .filter((b) => b.card_kind === 'assumption')
      .map((b) => b.body);
    expect(bodies).toEqual(['Market Demand estimates are uncertain.']);
  });

  it('the EVIDENCE surface still skips lever factors (structural isLeverFactor — untouched)', () => {
    const fact = makeFact({
      decisionReview: {
        evidence_enhancements: {
          fac_sales_capacity: {
            specific_action: 'Pull historical ramp rates for new reps.',
            rationale: 'Ramp speed is the largest variance driver here.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first, then look at data.',
          },
          fac_market_demand: {
            specific_action: 'Pull the last four quarters of demand data.',
            rationale: 'Demand is the second-largest variance driver here.',
            evidence_type: 'internal_data',
            decision_hygiene: 'Estimate first, then look at data.',
          },
        },
      },
      graphNodes: WALK_GRAPH_NODES,
      factorSensitivity: [
        { factor_id: 'fac_sales_capacity', confidence: 0.2 },
        { factor_id: 'fac_market_demand', confidence: 0.6 },
      ],
    });
    const blocks = buildEvidenceBlocks(
      fact,
      buildGraphNodeLookup(fact),
      buildFactorConfidenceLookup(fact),
      CTX,
      LEVERS,
    );
    expect(blocks.map((b) => b.factor_ref.id)).toEqual(['fac_market_demand']);
  });
});
