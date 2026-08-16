/**
 * AI Harness capability 1 — full flag-ON turn-flow integration proof.
 *
 * Drives the REAL `runTurnExecutor` end-to-end (mocked session store, throwing
 * vs passthrough routing adapter, telemetry sink) to prove the flagged
 * post-analysis loop works through the whole turn, not just at the gate seam:
 *
 *   - Flag ON + fresh analysis whose thin projection is blank → the advice gate
 *     relaxes to the grounded `canonical_rich` answer, the LLM is NOT called,
 *     and the response carries safe-now content (no held science, no false
 *     success). Telemetry: matched=true, copy_source/routing_path=canonical_rich,
 *     loop_enabled=true, deterministic=true.
 *   - Flag OFF, same turn → the gate falls through `data_unavailable_for_class`
 *     (the lived defect): loop_enabled=false, no canonical_rich answer.
 *
 * Harness mirrors `turn-executor-post-analysis-advice-ownership.integration.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import {
  HELD_SCIENCE_VOCABULARY_PATTERN,
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../compose/forbidden-user-facing-phrases.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import {
  CAP1_SCENARIO_ID as SCENARIO_ID,
  PARTIAL_GRAPH,
  PRIOR_RA_TURN,
  makeBlankProjectionFreshFact,
} from './coaching-fixtures.js';
import { makeMessagePayload } from './fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

const mockState: {
  priorTurns: Array<Record<string, unknown>>;
  priorFacts: Array<Record<string, unknown>>;
  persistedGraph: unknown | null;
} = { priorTurns: [], priorFacts: [], persistedGraph: null };

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => mockState.priorTurns,
    readFactsFor: async () => mockState.priorFacts,
    invalidateScoped: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => mockState.persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: mockState.persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function mkPayload(message: string): MessageTurnPayload {
  return makeMessagePayload({
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    stage: 'analyse',
  });
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('Routing adapter must NOT be called on the deterministic canonical_rich path');
      }),
  };
}


/**
 * ROADMAP 2.640 — a graph whose canonical recovery is needs_encoding, a
 * family whose attested remedy lives in the Options section. The active
 * readiness producer no longer reconstructs a blocker from option count or
 * absent goal threshold, so the fixture must carry the exact whole-status
 * discriminator the gesture claims to remedy.
 */
const ENCODING_GRAPH = {
  ...PARTIAL_GRAPH,
  nodes: PARTIAL_GRAPH.nodes
    .filter((n) => n.id !== 'fac_delivery_risk')
    .map((n) => n.id === 'opt_hire'
      ? {
          ...n,
          status: 'needs_encoding' as const,
          raw_interventions: { fac_capacity: 'high' },
        }
      : n),
  edges: PARTIAL_GRAPH.edges.filter((e) => e.from !== 'fac_delivery_risk'),
};
const ENCODING_GRAPH_HASH = computeAnalysisAffectingGraphHash(ENCODING_GRAPH as never)!;

/** The same fresh fact, re-hashed for ENCODING_GRAPH so freshness stays 'fresh'. */
function encodingFreshFact(): Record<string, unknown> {
  const fact = makeBlankProjectionFreshFact();
  const result = fact.result as Record<string, unknown>;
  return { ...fact, result: { ...result, graph_hash_at_run: ENCODING_GRAPH_HASH } };
}

type Event = { event: string; data: Record<string, unknown> };
let events: Event[] = [];


describe('AI Harness cap-1 — full flag-ON turn-flow integration', () => {
  beforeEach(() => {
    events = [];
    mockState.priorTurns = [PRIOR_RA_TURN];
    mockState.priorFacts = [makeBlankProjectionFreshFact()];
    mockState.persistedGraph = PARTIAL_GRAPH;
    setTestSink((eventName, data) => events.push({ event: eventName, data }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    setTestSink(null);
  });

  function adviceEvent(): Record<string, unknown> | undefined {
    return events.find((e) => e.event === 'v5.post_analysis_advice_gate')?.data;
  }

  it('flag ON + blank projection + fresh usable state → deterministic canonical_rich answer, no LLM', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(mkPayload('How can we improve this?'), 'req-loop-on', {
      routingAdapter: adapter,
      graphState: PARTIAL_GRAPH as never,
    });

    // No LLM call — the deterministic grounded path handled the turn.
    expect(adapter.chatWithTools).not.toHaveBeenCalled();

    const ev = adviceEvent();
    expect(ev, 'advice-gate telemetry should fire').toBeDefined();
    expect(ev!.matched).toBe(true);
    expect(ev!.copy_source).toBe('canonical_rich');
    expect(ev!.routing_path).toBe('canonical_rich');
    expect(ev!.loop_enabled).toBe(true);
    expect(ev!.deterministic).toBe(true);

    // The wire answer is grounded safe-now content, honest, no held science.
    const text = (result.response as { assistant_text?: string }).assistant_text ?? '';
    expect(text).toMatch(/still open|threshold|connected|options/i);
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
    expect(text).not.toMatch(HELD_SCIENCE_VOCABULARY_PATTERN);
  });

  // =========================================================================
  // ROADMAP 2.640 §3.4 — THE WIRING HOP, pinned through the REAL turn executor.
  //
  // The builder and the gate field are both unit-covered in
  // `compose/__tests__/ui-directive-gate-remedy.test.ts`. What THIS test exists
  // to catch is the hop between them and the user: a directive that is built
  // and then never attached to the response is working code nobody can reach,
  // and no unit test on either side can see that gap.
  // =========================================================================
  it('a blocked-model question ships the answer AND the section that fixes it', async () => {
    // PARTIAL_GRAPH's canonical mapping recovery is deliberately UNMAPPED, so
    // it is the wrong fixture for proving the wiring. ENCODING_GRAPH carries
    // exact needs_encoding, whose attested surface is Options.
    //
    // The fact's hash is recomputed for THIS graph: the gate only fires on
    // `freshness === 'fresh'`, and a stale hash would silently take the turn
    // down a different path.
    mockState.persistedGraph = ENCODING_GRAPH;
    mockState.priorFacts = [encodingFreshFact()];

    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(
      mkPayload("What's blocking the analysis?"),
      'req-gate-remedy',
      { routingAdapter: adapter, graphState: ENCODING_GRAPH as never },
    );

    // Precondition pinned IN-TEST (trap 13b): if the gate stopped matching this
    // message, or stopped classifying it `readiness`, every assertion below
    // would describe a state the product never reaches. Assert it rather than
    // guarding on it — a guard would go vacuously green.
    const ev = adviceEvent();
    expect(ev, 'advice-gate telemetry should fire').toBeDefined();
    expect(ev!.matched).toBe(true);
    expect(ev!.advice_class).toBe('readiness');

    const blocks =
      (result.response as { blocks?: Array<Record<string, unknown>> }).blocks ?? [];
    const directives = blocks.filter((b) => b.type === 'ui_directive');

    // N=1 — one gesture on the turn, not zero and not two.
    expect(directives).toHaveLength(1);
    expect(directives[0].verb).toBe('open_section');
    // Bind by identity to the gate authoring path, so a ladder directive
    // arriving here by some other route could not satisfy this test.
    expect(directives[0].source).toBe('gate');
    expect(directives[0].ui_target).toMatchObject({ kind: 'model_section' });

    // The gesture is ADDITIVE: the user is still told what is wrong, in words.
    const text = (result.response as { assistant_text?: string }).assistant_text ?? '';
    expect(text.length).toBeGreaterThan(0);
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
  });

  // (former "flag OFF → falls through data_unavailable_for_class" pin removed
  // 2026-07-20 with the flag — O-7 wave 2: CEE_POST_ANALYSIS_LOOP_ENABLED
  // deleted, live-true on staging; the fall-through-to-LLM branch for
  // blank-projection-with-usable-state no longer exists. The flag-ON pins in
  // this file are the make-unconditional mutation checks: re-gate the
  // canonicalState/recentChanges threading behind a default-false config
  // read and they go RED.)
});
