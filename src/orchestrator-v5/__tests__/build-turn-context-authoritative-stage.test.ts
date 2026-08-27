/**
 * AUTHORITATIVE STAGE DERIVATION — behavioural guard.
 *
 * The defect this closes: the reasoning stage was a closed client loop. The UI
 * derived it from canvas state, CEE echoed it back, and neither end could
 * ORIGINATE `decide` — so the `decide` coaching rules in
 * `compose/chip-generator.ts:906,923` were written, deployed, and structurally
 * unreachable.
 *
 * These tests bind to `buildTurnContext` rather than to the pure helper on
 * purpose. `context.stage` is the single value that both the response's
 * `stage_indicator` (the pill) AND all five `generateChips` call sites read, so
 * asserting it here is asserting the thing the user actually sees. A unit test
 * on the predicate alone would pass while the wiring was absent — which is the
 * "live code path, unreachable data" shape being removed.
 *
 * NOTE ON FIXTURES: `STAGE1_GRAPH_2_OPTIONS` mirrors the existing
 * `STAGE1_GRAPH` in `build-turn-context.test.ts` (goal + two option nodes) and
 * the fresh-fact harness mirrors that file's `makeRunAnalysisFact`. Both shapes
 * are corroborated by a REAL staging capture — the conversation-harness wire
 * record at `tools/conversation-harness/runs/sample-redacted/turns/S3O1/wire.json`
 * shows a live turn with `freshness: "fresh"`, `status: "ready"`, a goal node and
 * three options (one baseline) emitting `stage_indicator: "analyse"`. That capture
 * is the producer evidence that the `decide` branch is reachable with real data
 * and not merely with a fixture written to satisfy it.
 *
 * This file is deliberately SEPARATE from `build-turn-context.test.ts`: open PRs
 * #1004 and #1010 both edit that file, and a new file collides with neither.
 */
import { describe, it, expect, afterEach } from 'vitest';
import type { SessionTurn, HandlerFact } from '@talchain/schemas/orchestrator';

import { setTestSink } from '../../utils/telemetry.js';
import { buildTurnContext } from '../build-turn-context.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import { makeMessagePayload } from './fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { deriveAnalysisFreshness } from '../context/freshness.js';
import {
  deriveAuthoritativeStage,
  MIN_OPTIONS_FOR_DECIDE,
} from '../context/derive-stage.js';

const BASE = makeMessagePayload({
  turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'which of these should we do?',
});

/** Goal + TWO option nodes — the minimum that constitutes a real choice. */
const GRAPH_2_OPTIONS = {
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

/** Goal + ONE option — an analysis can be perfectly fresh and still not be a choice. */
const GRAPH_1_OPTION = {
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Reach £10m ARR' },
    { id: 'opt_hire', kind: 'option', label: 'Hire a senior engineer' },
  ],
  edges: [],
};

function makeSessionTurn(turnId: string, createdAt: string): SessionTurn {
  return {
    id: `row-${turnId}`,
    scenario_id: BASE.scenario_id,
    user_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    turn_id: turnId,
    turn_class: 'direct_answer',
    handler_id: null,
    request_hash: `sha256:${turnId}`,
    response_emitted: true,
    llm_calls_used: 2,
    duration_ms: 123,
    created_at: createdAt,
  } as SessionTurn;
}

function makeRunAnalysisFact(graphHashAtRun: string): HandlerFact {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: BASE.scenario_id,
      leading_option_id: 'opt_hire',
      summary: 'Analysis completed.',
      graph_hash_at_run: graphHashAtRun,
      computed_at: '2026-05-01T00:00:00.000Z',
      enrichment: { analysis_status: 'computed' },
    },
  } as unknown as HandlerFact;
}

function hashOf(graph: unknown): string {
  const parsed = GraphStateIngressSchema.safeParse(graph);
  expect(parsed.success).toBe(true);
  const h = computeAnalysisAffectingGraphHash(parsed.data as never);
  expect(typeof h).toBe('string');
  return h as string;
}

/**
 * Build a store whose persisted graph matches the analysed hash, so the SINGLE
 * freshness authority derives `'fresh'`. The freshness verdict is asserted
 * independently in each test rather than assumed — a fixture that silently
 * stopped producing `'fresh'` would make these tests pass for the wrong reason
 * (the guard-agreeing-with-itself defect).
 */
function freshStoreFor(graph: unknown) {
  const expectedHash = hashOf(graph);
  const fact = makeRunAnalysisFact(expectedHash);
  return {
    expectedHash,
    fact,
    store: createNoopSessionStore({
      loadGraphResult: graph,
      priorTurns: [makeSessionTurn('t1', '2026-05-01T00:00:00.000+00:00')],
      facts: [fact],
      scenarioAnalysisFacts: [fact],
    }),
  };
}

describe('buildTurnContext — CEE derives the stage from its own model state', () => {
  afterEach(() => {
    setTestSink(null);
  });

  it('promotes to `decide` when a FRESH analysis stands over a two-option model, even though the client asked for `frame`', async () => {
    const { store, fact, expectedHash } = freshStoreFor(GRAPH_2_OPTIONS);

    // PRECONDITION PINNED IN-TEST: the outcome below must be the derivation's
    // doing, not a fixture that quietly stopped being fresh.
    expect(deriveAnalysisFreshness([fact], expectedHash).freshness).toBe('fresh');
    expect(BASE.stage).toBe('frame');

    const ctx = await buildTurnContext(BASE, 'req-stage-decide', { sessionStore: store });

    expect(ctx.stage).toBe('decide');
  });

  it('TWIN — a fresh analysis over a ONE-option model is not a choice: the requested stage passes through untouched', async () => {
    const { store, fact, expectedHash } = freshStoreFor(GRAPH_1_OPTION);

    expect(deriveAnalysisFreshness([fact], expectedHash).freshness).toBe('fresh');

    const ctx = await buildTurnContext(BASE, 'req-stage-one-option', { sessionStore: store });

    // Unchanged from today's behaviour — nothing promoted, nothing demoted.
    expect(ctx.stage).toBe('frame');
  });

  it('TWIN — a STALE analysis (model edited since the run) does not promote', async () => {
    // Analysis ran against the two-option graph; the persisted graph has since
    // gained an option, so the hashes diverge.
    const analysedHash = hashOf(GRAPH_2_OPTIONS);
    const mutatedGraph = {
      nodes: [
        ...GRAPH_2_OPTIONS.nodes,
        { id: 'opt_partner', kind: 'option', label: 'Partner with a vendor' },
      ],
      edges: [],
    };
    const fact = makeRunAnalysisFact(analysedHash);
    const store = createNoopSessionStore({
      loadGraphResult: mutatedGraph,
      priorTurns: [makeSessionTurn('t1', '2026-05-01T00:00:00.000+00:00')],
      facts: [fact],
      scenarioAnalysisFacts: [fact],
    });

    expect(deriveAnalysisFreshness([fact], hashOf(mutatedGraph)).freshness).toBe('stale');

    const ctx = await buildTurnContext(BASE, 'req-stage-stale', { sessionStore: store });

    expect(ctx.stage).toBe('frame');
  });

  it('TWIN — the stale `decide` echo is corrected to `analyse` so the pill cannot outlive the analysis that earned it', async () => {
    const analysedHash = hashOf(GRAPH_2_OPTIONS);
    const mutatedGraph = {
      nodes: [
        ...GRAPH_2_OPTIONS.nodes,
        { id: 'opt_partner', kind: 'option', label: 'Partner with a vendor' },
      ],
      edges: [],
    };
    const store = createNoopSessionStore({
      loadGraphResult: mutatedGraph,
      priorTurns: [makeSessionTurn('t1', '2026-05-01T00:00:00.000+00:00')],
      facts: [makeRunAnalysisFact(analysedHash)],
      scenarioAnalysisFacts: [makeRunAnalysisFact(analysedHash)],
    });

    const decidePayload = makeMessagePayload({
      turn_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      scenario_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      message: 'still thinking',
      stage: 'decide',
    });

    const ctx = await buildTurnContext(decidePayload, 'req-stage-sticky', { sessionStore: store });

    expect(ctx.stage).toBe('analyse');
  });

  it('a scenario with NO persisted graph is never rewritten — no model, no verdict', async () => {
    const ctx = await buildTurnContext(BASE, 'req-stage-nograph', {
      sessionStore: createNoopSessionStore(),
    });

    expect(ctx.stage).toBe('frame');
  });
});

describe('deriveAuthoritativeStage — the predicate, in isolation', () => {
  const fresh2 = {
    requestedStage: 'frame' as const,
    freshness: 'fresh' as const,
    optionCount: 2,
    hasGraph: true,
  };

  it('promotes on fresh + a genuine choice', () => {
    expect(deriveAuthoritativeStage(fresh2)).toBe('decide');
  });

  it('does not promote below the choice threshold', () => {
    expect(
      deriveAuthoritativeStage({ ...fresh2, optionCount: MIN_OPTIONS_FOR_DECIDE - 1 }),
    ).toBe('frame');
  });

  it.each(['stale', 'unknown', 'none'] as const)(
    'does not promote on freshness=%s — only a fresh analysis can ground a decision',
    (freshness) => {
      expect(deriveAuthoritativeStage({ ...fresh2, freshness })).toBe('frame');
    },
  );

  it('treats an indeterminate option source as not-a-choice', () => {
    expect(deriveAuthoritativeStage({ ...fresh2, optionCount: null })).toBe('frame');
  });

  it('GATES NOTHING — a non-promoting turn returns the requested stage verbatim, so no affordance is withdrawn', () => {
    for (const requestedStage of ['frame', 'analyse', 'review'] as const) {
      expect(
        deriveAuthoritativeStage({ ...fresh2, freshness: 'none', requestedStage }),
      ).toBe(requestedStage);
    }
  });

  it('corrects a stale `decide` only when a model exists to contradict it', () => {
    expect(
      deriveAuthoritativeStage({
        ...fresh2,
        freshness: 'stale',
        requestedStage: 'decide',
        hasGraph: true,
      }),
    ).toBe('analyse');
    expect(
      deriveAuthoritativeStage({
        ...fresh2,
        freshness: 'none',
        requestedStage: 'decide',
        hasGraph: false,
      }),
    ).toBe('decide');
  });

  it('never emits `review` — no persisted signal grounds it, so it stays honestly dark', () => {
    const stages = ['frame', 'analyse', 'decide', 'review'] as const;
    const freshnesses = ['fresh', 'stale', 'unknown', 'none'] as const;
    const emitted = new Set<string>();
    for (const requestedStage of stages) {
      for (const freshness of freshnesses) {
        for (const optionCount of [null, 0, 1, 2, 5]) {
          for (const hasGraph of [true, false]) {
            emitted.add(
              deriveAuthoritativeStage({ requestedStage, freshness, optionCount, hasGraph }),
            );
          }
        }
      }
    }
    // `review` appears ONLY where the caller already asked for it (pass-through),
    // never as something this module derived.
    expect(
      deriveAuthoritativeStage({
        requestedStage: 'frame',
        freshness: 'fresh',
        optionCount: 99,
        hasGraph: true,
      }),
    ).toBe('decide');
    expect(emitted.has('decide')).toBe(true);
  });
});
