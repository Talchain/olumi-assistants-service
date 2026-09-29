/**
 * ⭐⭐⭐ THE CARD THE USER LOSES, AND WHY THEY LOSE IT.
 *
 * Witnessed on a real user session, 16 Sep 2026. THREE `review_card` blocks were
 * dropped before egress in one run:
 *
 *   narrative        / lever_named  / field narrative_summary
 *   scenario_context / lookup_miss  / field edge_id
 *   scenario_context / lever_named  / field scenario_contexts
 *
 * The user asked three different questions in that session — including "What
 * updates are you recommending we actually make?" — and got the same canned
 * paragraph each time, because the narrative card, which is the one that
 * actually describes the analysis, never reached them.
 *
 * ⛔ THE GUARD IS A SPEECH-ACT RULE IMPLEMENTED AS STRING CONTAINMENT.
 * Doctrine D-U F2 bans presenting an option-set lever AS AN UNCERTAINTY to
 * resolve. `proseNamesLever` tests only whether a lever LABEL occurs anywhere in
 * the prose; mention and assertion-of-uncertainty are the same reading to it.
 * `leverLabels` is the label of EVERY factor any option intervenes on — that is,
 * exactly the quantities the narrative card exists to describe, and which the
 * served prompt instructs the model to name. One bounded occurrence drops the
 * whole card, with no rewrite path.
 *
 * ⭐ THE NARRATIVE CARD IS STRUCTURALLY INCAPABLE OF THE HARM, and that is the
 * ruling rather than a preference. Read at the candidate it builds: title
 * "How the analysis reads", `reviewCardSignals('narrative', 'info')`,
 * `target_refs: []`, and NO `action_intent` of any kind. It offers the reader no
 * affordance to "resolve" anything. A lever named there is being REPORTED, not
 * proposed as an open question.
 *
 * ⚠ THIS IS THE SECOND SURFACE SCOPED OUT OF THE SAME GUARD AND IT FOLLOWS THE
 * FIRST'S REASONING EXACTLY. `buildPreMortemCard` was scoped out by ruling
 * because a pre-mortem names the lever as a failure WATCH-POINT — coaching, not
 * steering. A narrative names it as a FINDING — reporting, not steering. Every
 * other surface in the file still receives `leverLabels`, and every other rule
 * on this path still applies, exactly as the pre-mortem ruling required.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { log } from '../../../utils/telemetry.js';
import { buildGraphNodeLookup, buildReviewCardBlocks, type BlockBuildCtx } from '../phase3-blocks.js';

const GRAPH_HASH = 'gh_a1b2c3d4e5f60001';
const CTX: BlockBuildCtx = {
  created_at: '2026-05-16T15:00:00.000Z',
  graph_hash_at_generation: GRAPH_HASH,
};

const FACTOR_SALES = { id: 'fac_sales_capacity', label: 'Sales Team Capacity', kind: 'factor' };
const FACTOR_DEMAND = { id: 'fac_market_demand', label: 'Market Demand', kind: 'factor' };
const WALK_GRAPH_NODES = [FACTOR_SALES, FACTOR_DEMAND];
const LEVERS = new Set(['fac_sales_capacity']);

function makeFact(decisionReview: Record<string, unknown>): RunAnalysisHandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: 'scen-test',
      leading_option_id: 'opt_a',
      summary: 'Ran analysis on your current scenario.',
      enrichment: { decision_review: decisionReview, graph: { nodes: WALK_GRAPH_NODES } },
      computed_at: '2026-05-16T14:59:00.000Z',
      graph_hash_at_run: GRAPH_HASH,
    },
  } as unknown as RunAnalysisHandlerFact;
}

/** The live shape: a summary that describes the analysis, naming the lever. */
const NAMES_THE_LEVER = () =>
  makeFact({
    narrative_summary:
      'Hiring ahead of demand comes out in front in most runs, and Sales Team Capacity is the strongest driver of that result.',
  });

/** Same card, naming a factor that is NOT an option-set lever. */
const NAMES_A_NON_LEVER = () =>
  makeFact({
    narrative_summary:
      'Hiring ahead of demand comes out in front in most runs, and Market Demand is the strongest driver of that result.',
  });

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
      call[0] !== null && typeof call[0] === 'object' ? (call[0] as Record<string, unknown>) : undefined,
    )
    .filter(
      (p): p is Record<string, unknown> =>
        p !== undefined && p.event === 'v5.phase3.block_dropped' && p.block_kind === kind,
    )
    .map((p) => String(p.drop_reason));
}

const narrativeOf = (fact: RunAnalysisHandlerFact) =>
  buildReviewCardBlocks(fact, buildGraphNodeLookup(fact), CTX, LEVERS).find(
    (b) => b.card_kind === 'narrative',
  );

describe('N1 — the narrative card ships when it names a lever', () => {
  it('N1a THE LIVE SHAPE: a summary naming the lever reaches the user', () => {
    const card = narrativeOf(NAMES_THE_LEVER());
    expect(card, 'this is the card the user lost in the witnessed session').toBeDefined();
    expect(card?.body).toContain('Sales Team Capacity');
  });

  it('N1b no `lever_named` drop is emitted for narrative any more', () => {
    buildReviewCardBlocks(NAMES_THE_LEVER(), buildGraphNodeLookup(NAMES_THE_LEVER()), CTX, LEVERS);
    expect(dropReasonsFor('narrative')).not.toContain('lever_named');
  });

  it('N1c CONTROL: a summary naming a NON-lever was never affected and still ships', () => {
    // Proves the change is about the guard, not about the card suddenly working.
    expect(narrativeOf(NAMES_A_NON_LEVER())?.body).toContain('Market Demand');
  });
});

describe('N2 — the scope-out is surgical, exactly as the pre-mortem ruling required', () => {
  it('N2a the card keeps its descriptive identity — no action affordance is gained', () => {
    const card = narrativeOf(NAMES_THE_LEVER()) as Record<string, any> | undefined;
    expect(card?.card_kind).toBe('narrative');
    expect(card?.title, 'a reporting surface, not a steering one').toContain('How the analysis reads');
    expect(card?.target_refs, 'it points the reader at nothing to resolve').toEqual([]);
    expect(card?.action_intent, 'and offers no affordance to resolve anything').toBeUndefined();
  });

  it('N2b an EMPTY summary is still dropped — the removal is not a hole in the path', () => {
    expect(narrativeOf(makeFact({ narrative_summary: '   ' }))).toBeUndefined();
  });

  it('N2c a missing producer still yields no card', () => {
    expect(narrativeOf(makeFact({}))).toBeUndefined();
  });
});
