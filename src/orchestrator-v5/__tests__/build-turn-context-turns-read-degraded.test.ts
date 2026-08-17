/**
 * ROADMAP 2.1264 / PR #1004 REVIEW BLOCKER — A DEGRADED **TURNS** READ MUST NOT
 * REACH THE WIRE AS `never_run`.
 *
 * ## The defect this file pins
 *
 * `fetchPriorTurns` swallows a thrown `store.readRecent` and returns `[]`.
 * `fetchPriorFacts` then short-circuits on `priorTurns.length === 0` and reports
 * `readOk: true` — because from ITS point of view there were simply no turns to
 * read facts for. So `deriveAnalysisFreshness` takes its `none` /
 * `no_successful_run_analysis_fact` arm, and the graph-less exits stamp
 * `run_state.kind = 'never_run'`.
 *
 * That is a POSITIVE CLAIM ABOUT THE USER'S HISTORY built on a read that
 * failed: "this scenario has never been analysed", asserted about a scenario
 * whose conversation could not be loaded. `turn-claim-safety.ts`'s
 * `CONTEXT_READ_FAILED_DERIVATION` docstring already states the invariant in
 * this same diff — *"It must never read `none` — a failed read that claims
 * 'this scenario has never been analysed' is the positive claim
 * `prior_facts_read_ok` exists to prevent."* That guard covers the path where
 * `buildTurnContext` THROWS; this failure is swallowed INSIDE it, so the guard
 * never sees it. Correct at its seam, defective one seam upstream.
 *
 * ## Why the assertions are shaped the way they are
 *
 * THE REAL CHAIN, NOT A HAND-BUILT DERIVATION. Every arm drives
 * `buildTurnContext` with a store whose `readRecent` genuinely rejects, and
 * feeds the context's OWN `persisted_analysis_freshness` into the REAL
 * `finaliseV5Response` as `exitFreshness` with `graph: null` — exactly what
 * `turn-claim-safety.ts:244` reads and what `exitDerivationFor` gates on a
 * graph-less exit. A derivation this file authored itself would prove only that
 * the file agrees with itself; the defect lives in what the production reader
 * PRODUCES, which is why nothing here constructs a `FreshnessDerivation`.
 *
 * BOUND BY IDENTITY (trap 19). Assertions name `run_state.kind` and
 * `run_state.cause` — the discriminated union's own discriminator and its
 * closed-enum cause — never a value predicate another state could satisfy. The
 * negative assertions are stated explicitly rather than implied by the positive
 * one, because `never_run` and `'none'` are the two specific falsehoods at
 * issue and a future refactor could satisfy "is degraded" while reintroducing
 * either.
 *
 * OPPOSITE-DIRECTION TWINS (trap 22b). A degraded read must report degraded AND
 * the two genuinely-good paths must keep their true verdicts. Arm 1 is the
 * defect; arms 2 and 3 are what a fix that hard-coded the flag `false` would
 * break — arm 2 keeps `never_run` legitimately reachable for a scenario that
 * really has never been analysed, and arm 3 keeps `complete_current` reachable
 * for one that has. One direction alone would license either half of a
 * one-door guard.
 *
 * `store_unreadable` is NOT new vocabulary: it is the published contract's own
 * word for this state (`AnalysisDegradedCauseSchema` in
 * `@talchain/schemas@0.46.0`, a closed enum of exactly
 * `store_unreadable | legacy_fact | no_graph_this_turn | refusal_unverified`).
 */

import { describe, it, expect } from 'vitest';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { buildTurnContext } from '../build-turn-context.js';
import { finaliseV5Response } from '../response-finaliser.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { SessionReadError } from '../session/store.js';
import { makeMessagePayload } from './fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { BASE_FINALISED_HEALTHY_TURN } from './__fixtures__/base-finalised-healthy-turn.js';

const BASE = makeMessagePayload({ message: 'where did we land on this?' });

/**
 * A persisted graph, so `persistedGraphHash` is a real non-null hash and the
 * `fresh` path in arm 3 is genuinely reachable. Without a graph every arm would
 * land on an `unknown` verdict for an unrelated reason and the discrimination
 * would be fake.
 */
const PERSISTED_GRAPH = {
  nodes: [
    {
      id: 'goal_1',
      kind: 'goal',
      label: 'Reach £10m ARR',
      goal_threshold_raw: 10,
      goal_threshold_unit: '£m',
    },
    { id: 'opt_hire', kind: 'option', label: 'Hire a senior engineer' },
    { id: 'opt_outsource', kind: 'option', label: 'Outsource to an agency' },
  ],
  edges: [],
};

/** The hash the production hasher computes for {@link PERSISTED_GRAPH}. */
function persistedGraphHash(): string {
  const parsed = GraphStateIngressSchema.safeParse(PERSISTED_GRAPH);
  expect(parsed.success, 'the fixture graph must parse, or every arm is vacuous').toBe(
    true,
  );
  const hash = computeAnalysisAffectingGraphHash(parsed.data as never);
  expect(typeof hash).toBe('string');
  return hash as string;
}

function runAnalysisFact(graphHashAtRun: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    turn_id: 't1',
    noop: false,
    result: {
      graph_hash_at_run: graphHashAtRun,
      computed_at: '2026-08-16T09:00:00.000Z',
      enrichment: { analysis_status: 'computed' },
    },
  } as unknown as HandlerFact;
}

/** A prior handler turn, so the facts read has a row id to work with. */
function handlerTurn() {
  return {
    id: 'db-row-uuid',
    scenario_id: BASE.scenario_id,
    user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_id: 'client-turn-uuid',
    turn_class: 'handler' as const,
    handler_id: 'run_analysis' as const,
    request_hash: 'sha256:t1',
    response_emitted: true,
    llm_calls_used: 1,
    duration_ms: 12,
    created_at: '2026-08-16T09:00:00.000+00:00',
  };
}

type FinaliserCtx = Parameters<typeof finaliseV5Response>[1];

/**
 * The graph-less exit, driven through the REAL finaliser.
 *
 * `graph: null` is what every clarify / readiness-intake / decline exit
 * declares, and it is the condition `exitDerivationFor` requires before the
 * persisted-graph derivation may describe the turn. `freshness` is deliberately
 * NOT passed — these exits have no per-turn derivation of their own, which is
 * the whole reason `exitFreshness` exists.
 */
function runStateAtGraphlessExit(
  exitFreshness: unknown,
): { kind?: unknown; cause?: unknown } {
  const body = finaliseV5Response(
    BASE_FINALISED_HEALTHY_TURN as unknown as OlumiResponse,
    { graph: null, exitFreshness } as unknown as FinaliserCtx,
  ) as unknown as Record<string, unknown>;
  const state = body.analysis_state as Record<string, unknown> | undefined;
  expect(state, 'analysis_state is stamped on EVERY exit (2.1264)').toBeDefined();
  return (state as Record<string, unknown>).run_state as { kind?: unknown; cause?: unknown };
}

describe('buildTurnContext — a degraded prior_turns read may not claim never_run', () => {
  it('ARM 1 (the defect): readRecent THROWS ⇒ unknown_degraded / store_unreadable, never never_run', async () => {
    const store = {
      ...createNoopSessionStore({ loadGraphResult: PERSISTED_GRAPH }),
      readRecent: async () => {
        throw new SessionReadError('DB offline', { code: '57P03' });
      },
    };
    const ctx = await buildTurnContext(BASE, 'req-turns-degraded', {
      sessionStore: store,
    });

    // PRECONDITION, pinned in-test (trap 13b): this really is the ambiguous
    // empty. Without it a later refactor that made prior_turns non-empty would
    // leave the assertions below passing about a different situation entirely.
    expect(ctx.prior_turns).toEqual([]);
    expect(ctx.prior_facts).toEqual([]);

    // The source flag: an empty prior_facts caused by a failed TURNS read is
    // ignorance, not genuine emptiness. This is the line the fix changes.
    expect(ctx.prior_facts_read_ok).toBe(false);

    // The context's own derivation — the object `turn-claim-safety.ts:244`
    // reads and carries to the exit.
    expect(ctx.persisted_analysis_freshness.freshness).toBe('unknown');
    expect(ctx.persisted_analysis_freshness.reason).toBe('derivation_failed');
    // The two specific falsehoods, asserted explicitly.
    expect(ctx.persisted_analysis_freshness.freshness).not.toBe('none');
    expect(ctx.persisted_analysis_freshness.reason).not.toBe(
      'no_successful_run_analysis_fact',
    );

    // …and what a CONSUMER receives at a graph-less exit.
    const runState = runStateAtGraphlessExit(ctx.persisted_analysis_freshness);
    expect(runState.kind).toBe('unknown_degraded');
    expect(runState.cause).toBe('store_unreadable');
    expect(runState.kind).not.toBe('never_run');
  });

  it('ARM 2 (twin): readRecent SUCCEEDS with no turns ⇒ never_run stays legitimately reachable', async () => {
    // The discriminating twin for a fix that hard-coded the flag `false`. A
    // scenario that genuinely has never been analysed must still be able to say
    // so — suppressing `never_run` everywhere would trade a false claim for a
    // permanent inability to make a true one.
    const ctx = await buildTurnContext(BASE, 'req-turns-empty', {
      sessionStore: createNoopSessionStore({ loadGraphResult: PERSISTED_GRAPH }),
    });

    expect(ctx.prior_turns).toEqual([]);
    expect(ctx.prior_facts).toEqual([]);
    expect(ctx.prior_facts_read_ok).toBe(true);
    expect(ctx.persisted_analysis_freshness.freshness).toBe('none');
    expect(ctx.persisted_analysis_freshness.reason).toBe(
      'no_successful_run_analysis_fact',
    );

    const runState = runStateAtGraphlessExit(ctx.persisted_analysis_freshness);
    expect(runState.kind).toBe('never_run');
  });

  it('ARM 3 (twin): a readable analysis is still complete_current — the fix degrades nothing good', async () => {
    // The other direction of the same door. If the conjunction were wired to
    // report degraded whenever ANY read returned nothing, a scenario with a
    // perfectly good current analysis would be demoted to cannot-confirm —
    // which is the P3 harm (a less-true emission replacing a truthful one) in
    // the opposite direction from arm 1.
    const hash = persistedGraphHash();
    const store = createNoopSessionStore({
      loadGraphResult: PERSISTED_GRAPH,
      priorTurns: [handlerTurn() as never],
      facts: [runAnalysisFact(hash)],
    });
    const ctx = await buildTurnContext(BASE, 'req-turns-healthy', {
      sessionStore: store,
    });

    expect(ctx.prior_facts_read_ok).toBe(true);
    expect(ctx.persisted_analysis_freshness.freshness).toBe('fresh');

    const runState = runStateAtGraphlessExit(ctx.persisted_analysis_freshness);
    expect(runState.kind).toBe('complete_current');
  });

  it('ARM 4 (twin): NO session store at all is genuine emptiness, not a failed read', async () => {
    // The third empty, and the one `fetchPriorTurns` answers for separately.
    // Added because a mutant flipping the `!store` early return to
    // `readOk: false` SURVIVED the first battery — and a survivor is a claim
    // either way, so it was adjudicated rather than assumed (trap 13c): the
    // no-store path is reachable with no injected store and observably reports
    // `true` / `'none'`, so the mutant was NOT equivalent, merely unpinned.
    //
    // The distinction it protects: "there is no store to read" is a fact about
    // this deployment, not an unreadable store. Reporting it as
    // `store_unreadable` would make every store-less turn claim an
    // infrastructure failure, and it deliberately mirrors what `fetchPriorFacts`
    // reports for its own `!store` early return — one answer for one idea.
    const ctx = await buildTurnContext(BASE, 'req-no-store', {});

    expect(ctx.prior_turns).toEqual([]);
    expect(ctx.prior_facts).toEqual([]);
    expect(ctx.prior_facts_read_ok).toBe(true);
    expect(ctx.persisted_analysis_freshness.reason).not.toBe('derivation_failed');
  });
});
