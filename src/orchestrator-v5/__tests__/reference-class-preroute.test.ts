/**
 * ⭐ THE TURN-LEVEL ROUND TRIP — statement -> preview -> confirm -> block.
 *
 * ROADMAP 2.688 slice 1. Harness and discipline copied from
 * `calibration-consent-boundary.test.ts`: the session store's `append` is
 * the ONLY oracle for "did anything reach the user's model", because a test
 * that asserted "the reply says nothing changed" is exactly the defect that
 * file exists to prevent — the deployed build SAID nothing changed while the
 * row had already moved.
 *
 * ⭐ `throwingRoutingAdapter` FAILS THE TEST IF THE LLM IS CONSULTED. That is
 * the deterministic-guarantee assertion: the pre-route's promise cannot
 * depend on what the model decides, so the model must not be reachable at
 * all on this path.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

interface AppendWrite {
  graph?: unknown;
  handler_id?: unknown;
  handler_facts?: unknown;
  turn_class?: unknown;
}
const appendCalls: AppendWrite[] = [];
let persistedGraph: unknown = null;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: AppendWrite) => {
      appendCalls.push(write);
      if (write.graph !== undefined && write.graph !== null) persistedGraph = write.graph;
      return { id: 'mock-row-id' };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readMostRecentPendingActions: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => persistedGraph,
    loadGraphAndBriefText: async () => ({ graph: persistedGraph, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { buildReferenceClassConfirmMessage, recogniseReferenceClass } = await import(
  '../belief-elicitation/index.js'
);

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The statement a user makes after clicking the actions-menu outside-view prompt. */
const STATEMENT = "Of the 7 product launches like this I've seen, 3 hit their first-year target.";

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({ turn_id: TURN_ID, scenario_id: SCENARIO_ID, message });
}

/** Fails the test if the LLM is consulted at all. */
function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('routing adapter must NOT be called on the reference-class pre-route');
      }),
  };
}

function buildGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-launch',
        kind: 'factor',
        label: 'Launch readiness',
        observed_state: { value: 0.35, raw_value: 35, unit: '%', cap: 100 },
      },
      { id: 'o-ship', kind: 'option', label: 'Ship in Q1' },
    ],
    edges: [],
  } as unknown as GraphV3T;
}

/** Every graph write this turn made. Empty === the model is untouched. */
function graphWrites(): AppendWrite[] {
  return appendCalls.filter((c) => c.graph !== undefined && c.graph !== null);
}

beforeEach(() => {
  appendCalls.length = 0;
  persistedGraph = null;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('reference-class pre-route — the STATEMENT turn previews and commits nothing', () => {
  it('answers deterministically, with NO LLM call', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response } = await runTurnExecutor(payload(STATEMENT), 'req-rc-statement', {
      routingAdapter,
      graphState: buildGraph(),
    });
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(response.assistant_text).toContain('central estimate 44%');
    expect(response.assistant_text).toContain('between 33% and 56%');
  });

  it('⭐ THE GUARANTEE — nothing reaches the graph, asserted at the persistence boundary', async () => {
    await runTurnExecutor(payload(STATEMENT), 'req-rc-statement-boundary', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: buildGraph(),
    });
    expect(graphWrites()).toHaveLength(0);
    expect(persistedGraph).toBeNull();
  });

  it('names the class VERBATIM and says nothing has been changed', async () => {
    const { response } = await runTurnExecutor(payload(STATEMENT), 'req-rc-verbatim', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: buildGraph(),
    });
    expect(response.assistant_text).toContain("product launches like this I've seen");
    expect(response.assistant_text).toContain('Nothing has been changed.');
    expect(response.assistant_text).toContain(
      'it does not change the model unless you change it',
    );
  });

  it('offers the record + correct chips, and emits NO block on the preview turn', async () => {
    const { response } = await runTurnExecutor(payload(STATEMENT), 'req-rc-chips', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: buildGraph(),
    });
    expect(response.suggested_actions.map((a) => a.id)).toEqual([
      'chip_prompt_reference_class_record',
      'chip_prompt_reference_class_correct',
    ]);
    // I8 — nothing exists yet, so nothing is displayed as recorded.
    expect(response.blocks).toEqual([]);
  });
});

describe('reference-class pre-route — the CONFIRM turn records and emits the exercise', () => {
  it('⭐ ROUND TRIP — replaying the chip emits the outside_view ExerciseBlock', async () => {
    // The confirm message is the one the PREVIEW turn actually minted, not a
    // hand-authored string: a fixture the lane wrote itself would encode the
    // lane's model of the producer rather than the producer (trap 16).
    const preview = await runTurnExecutor(payload(STATEMENT), 'req-rc-preview', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: buildGraph(),
    });
    const chip = preview.response.suggested_actions.find(
      (a) => a.id === 'chip_prompt_reference_class_record',
    );
    expect(chip).toBeDefined();

    const routingAdapter = throwingRoutingAdapter();
    const { response } = await runTurnExecutor(payload(chip!.message), 'req-rc-confirm', {
      routingAdapter,
      graphState: buildGraph(),
    });
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();

    expect(response.blocks).toHaveLength(1);
    const block = response.blocks[0] as Record<string, unknown>;
    // Bound by IDENTITY (trap 19): the block type and kind, not "a block".
    expect(block.type).toBe('exercise');
    expect(block.exercise_kind).toBe('outside_view');
    expect(String(block.reference_class)).toContain('central estimate 44%');
    expect(String(block.reference_class)).toContain("product launches like this I've seen");
    expect((block.dsk_provenance as Record<string, unknown>).protocol_id).toBe('DSK-P-002');
  });

  it('the confirm turn STILL writes nothing to the graph (display + context only)', async () => {
    const confirmMessage = buildReferenceClassConfirmMessage({
      class_description: "product launches like this I've seen",
      outcome_description: 'hit their first-year target',
      observed_k: 3,
      observed_n: 7,
    });
    // Guard the fixture's own precondition (trap 13b, third face): if this
    // message stopped parsing as a confirm, the assertions below would pass
    // by taking a completely different path.
    expect(recogniseReferenceClass(confirmMessage).kind).toBe('confirm');

    await runTurnExecutor(payload(confirmMessage), 'req-rc-confirm-boundary', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: buildGraph(),
    });
    expect(graphWrites()).toHaveLength(0);
    expect(persistedGraph).toBeNull();
  });

  it('the recorded acknowledgement drops the preview commitment sentence', async () => {
    const confirmMessage = buildReferenceClassConfirmMessage({
      class_description: 'campaigns',
      outcome_description: 'landed',
      observed_k: 9,
      observed_n: 12,
    });
    const { response } = await runTurnExecutor(payload(confirmMessage), 'req-rc-recorded', {
      routingAdapter: throwingRoutingAdapter(),
      graphState: buildGraph(),
    });
    expect(response.assistant_text).not.toContain('Nothing has been changed.');
    expect(response.assistant_text).toContain('it does not change the model unless you change it');
  });
});

describe('reference-class pre-route — refusals and non-interference', () => {
  it('K > N asks, offers no chip, and emits no block', async () => {
    const { response } = await runTurnExecutor(
      payload('9 out of 3 similar projects succeeded'),
      'req-rc-clarify',
      { routingAdapter: throwingRoutingAdapter(), graphState: buildGraph() },
    );
    expect(response.assistant_text.toLowerCase()).toContain('how many');
    expect(response.suggested_actions).toEqual([]);
    expect(response.blocks).toEqual([]);
    expect(graphWrites()).toHaveLength(0);
  });

  it('⭐ POSITIVE CONTROL (trap 13) — the harness CAN see a graph write land', async () => {
    // Without this, every "nothing was written" assertion above could be
    // passing because the mock never receives a write at all.
    const routingAdapter = {
      chatWithTools: vi
        .fn<
          (args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>
        >()
        .mockImplementation(async () => {
          throw new Error('unused');
        }),
    };
    await runTurnExecutor(payload('Set Launch readiness to 60%.'), 'req-rc-control', {
      routingAdapter,
      graphState: buildGraph(),
    });
    expect(graphWrites().length).toBeGreaterThan(0);
  });

  it('the calibration pre-route still owns its own territory (no hijack)', async () => {
    const routingAdapter = throwingRoutingAdapter();
    const { response } = await runTurnExecutor(
      payload('Set Launch readiness to pretty likely.'),
      'req-rc-calibration-untouched',
      { routingAdapter, graphState: buildGraph() },
    );
    // Calibration's deterministic answer, unchanged: 70%, no LLM call.
    expect(routingAdapter.chatWithTools).not.toHaveBeenCalled();
    expect(response.assistant_text).toContain('70%');
    expect(response.assistant_text).not.toContain('central estimate');
  });
});
