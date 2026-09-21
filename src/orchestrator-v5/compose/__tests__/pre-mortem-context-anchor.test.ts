/**
 * DGAI #342(1) — the pre-mortem review card's failure prose is re-surfaced
 * VERBATIM by downstream surfaces (the DGAI Decision-overview panel promotes
 * the top-ranked interrogative block body into "Olumi's framing question").
 * Standalone, un-framed failure prose reads as a statement that the decision
 * ALREADY failed:
 *
 *   "This failed because market urgency was misunderstood—what early
 *    signals would you have missed?"
 *
 * Fix under test (canned-never-a-substitute doctrine):
 *   1. BIND: the emitted body must stand alone — it carries an explicit
 *      hypothetical pre-mortem frame ("Imagine this decision has failed:")
 *      unless the LLM prose already opens hypothetically.
 *   2. ANCHOR: the card ships only when it is anchored to the user's model —
 *      either grounded_in resolves to at least one real node, or the failure
 *      prose names a graph node label. A fully context-free canned question
 *      is DROPPED, not decorated.
 */

import { describe, expect, it } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import {
  buildGraphNodeLookup,
  buildReviewCardBlocks,
  type BlockBuildCtx,
} from '../phase3-blocks.js';

const CTX: BlockBuildCtx = {
  created_at: '2026-07-15T21:00:00.000Z',
  graph_hash_at_generation: 'gh_a1b2c3d4e5f60341',
};

const GRAPH_NODES = [
  { id: 'fac_mtp', label: 'Market Timing Pressure', kind: 'factor' },
  { id: 'fac_tlc', label: 'Technical Leadership Capacity', kind: 'factor' },
  { id: 'opt_cofounder', label: 'Bring On Technical Co-Founder', kind: 'option' },
];

function makeFact(preMortem: Record<string, unknown>): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-341',
      leading_option_id: 'opt_cofounder',
      summary: 'Ran analysis on your current scenario.',
      enrichment: {
        decision_review: { pre_mortem: preMortem },
        graph: { nodes: GRAPH_NODES },
      },
      graph_hash_at_run: 'gh_a1b2c3d4e5f60341',
      computed_at: '2026-07-15T20:59:00.000Z',
    },
  } as unknown as RunAnalysisHandlerFact;
}

function buildPreMortem(preMortem: Record<string, unknown>) {
  const fact = makeFact(preMortem);
  const blocks = buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX);
  return blocks.find((b) => b.card_kind === 'pre_mortem');
}

// The live #342 string, verbatim (em dash included — LLM-authored prose).
const LIVE_CONTEXT_FREE_QUESTION =
  'This failed because market urgency was misunderstood—what early signals would you have missed?';

describe('DGAI #342(1) — pre-mortem card must be anchored and stand alone', () => {
  it('DROPS the card when the failure prose names no graph node and grounded_in is absent (the live context-free case)', () => {
    const pm = buildPreMortem({
      failure_scenario: LIVE_CONTEXT_FREE_QUESTION,
    });
    expect(pm).toBeUndefined();
  });

  it('emits with the hypothetical frame when anchored via grounded_in', () => {
    const pm = buildPreMortem({
      failure_scenario: LIVE_CONTEXT_FREE_QUESTION,
      grounded_in: ['fac_mtp'],
    });
    expect(pm).toBeDefined();
    expect(pm?.body).toBe(
      `Imagine this decision has failed: ${LIVE_CONTEXT_FREE_QUESTION}`,
    );
    expect(pm?.target_refs).toHaveLength(1);
    expect(pm?.target_refs[0]?.label).toBe('Market Timing Pressure');
  });

  it('emits with the hypothetical frame when the prose itself names a graph node label', () => {
    const pm = buildPreMortem({
      failure_scenario:
        'This failed because Market Timing Pressure was misread—what early signals would you have missed?',
    });
    expect(pm).toBeDefined();
    expect(pm?.body).toMatch(/^Imagine this decision has failed: /);
    expect(pm?.body).toContain('Market Timing Pressure');
  });

  it('does not double-frame prose that already opens hypothetically', () => {
    const pm = buildPreMortem({
      failure_scenario:
        'Imagine the launch slipped because Market Timing Pressure was misread.',
    });
    expect(pm).toBeDefined();
    expect(pm?.body).toBe(
      'Imagine the launch slipped because Market Timing Pressure was misread.',
    );
  });

  it('keeps the P1.2 drop: grounded_in provided but every entry misses lookup', () => {
    const pm = buildPreMortem({
      failure_scenario: LIVE_CONTEXT_FREE_QUESTION,
      grounded_in: ['fac_ghost'],
    });
    expect(pm).toBeUndefined();
  });
});
