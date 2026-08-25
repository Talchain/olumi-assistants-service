/**
 * THE SUCCESS-TARGET RECORD — THE WIRE, PROVEN AT ROUTE LEVEL.
 *
 * ⭐⭐ WHY THIS FILE EXISTS.
 *
 * `projectGoalTarget` has its own unit coverage and `buildUserMessage` has its
 * own prompt coverage, and BOTH can be fully green while the capability is
 * DARK — if the one line in `turn-executor.ts` that passes `goalTarget` into
 * the assembler is missing, wrong, or never reached. A defended pure function
 * with a dark call site is this estate's chronic failure #1.
 *
 * The sibling repair `compactedConstraints` — threaded three lines away, for
 * exactly the same reason (compactGraph drops the field) — had NO such pin when
 * this file was written: deleting its call-site line dropped every decision
 * constraint from the prompt and left the whole suite green. That is the shape
 * this file exists to stop happening to `goal_target`.
 *
 * ⚠ UPDATED 2026-08-25: that sibling is now pinned too, by
 * `decision-constraints-wire.route-level.test.ts` in this directory. The
 * paragraph above is kept because it records WHY this file exists, but it is no
 * longer a live statement about `compactedConstraints`.
 *
 * So this asserts the fact through the REAL chain —
 *
 *     runTurnExecutor(payload)
 *       → buildTurnContext (loads the PERSISTED graph)
 *       → compactGraphForContextPack (derives goalTarget from the raw graph)
 *       → assembleContextPackWithSummary (projects `goal_target`)
 *       → buildUserMessage (serialises it + appends GOAL_TARGET_INSTRUCTION)
 *       → the bytes the routing adapter actually receives
 *
 * — and reads its evidence off the LLM adapter's captured arguments. Nothing
 * here inspects an intermediate object.
 *
 * THE DISCRIMINATOR IS THE POINT. The same question is asked twice against the
 * same conversation — once with the target genuinely recorded, once not — and
 * the two prompts must DIFFER in the record they carry. A guard that returned
 * the same answer for both would be decoration.
 *
 * SCOPE, STATED HONESTLY (status ladder). This proves what the model RECEIVES.
 * It does NOT prove what the model ANSWERS — that needs a wire/journey witness
 * against the deployed build. Rung reached here: TESTED.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { GOAL_TARGET_INSTRUCTION } from '../../routing/route-with-tool-use.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';

const SCENARIO_ID = randomUUID();

/** The goal node's id. Every assertion binds the record to THIS. */
const GOAL_ID = 'goal_csat';
/** The value the user only ever SAID. Recorded in no test unless stated. */
const MENTIONED_VALUE = 85;
const USER_SAID_IT = 'Keep CSAT at or above 85% — that is how we will judge success.';

/**
 * The PERSISTED graph the session store returns. The goal node's
 * `goal_threshold_raw` is the ONE thing that varies between the two arms —
 * mutated per test and reset in `beforeEach`, the same pattern the sibling
 * route-level suite uses for its stale-analysis control.
 */
const PERSISTED_GRAPH: {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
} = {
  nodes: [
    { id: GOAL_ID, kind: 'goal', label: 'Maintain customer satisfaction' },
    { id: 'opt_four_day', kind: 'option', label: 'Four-day week' },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo' },
    {
      id: 'f_load',
      kind: 'factor',
      label: 'Workload per person',
      observed_state: { value: 40, unit: 'hours', source: 'user_edited' },
    },
  ],
  edges: [{ from: 'f_load', to: GOAL_ID, strength: { mean: 0.4, std: 0.1 } }],
};

/** The prior turn in which the user MENTIONED the figure and nothing saved it. */
const PRIOR_TURN_ROW_ID = 'cccccccc-7a15-4ccc-8ccc-cccccccccccc';
const PRIOR_TURN: Record<string, unknown> & { user_message: string | null; assistant_message: string } = {
  id: PRIOR_TURN_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-frame',
  turn_class: 'frame',
  handler_id: null,
  request_hash: 'sha256:prior-frame',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
  user_message: USER_SAID_IT,
  assistant_message: 'Understood — what options are you weighing?',
};

/** What the ASSISTANT said in the prior turn. Mutated by the assistant-voice
 *  test and reset in `beforeEach` — `assistant_message` is on the pack
 *  (assembler `projectConversation`) exactly as `user_message` is, so a fix
 *  that only guarded the user's voice would leave the same hole open. */
const DEFAULT_ASSISTANT_MESSAGE = 'Understood — what options are you weighing?';

/** Drives the REAL no-graph path: the store returns nothing for this scenario.
 *  Reset in `beforeEach`. */
let SUPPRESS_PERSISTED_GRAPH = false;

vi.mock('../../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit = 20) => [PRIOR_TURN].slice(0, limit),
    countTurns: async () => 1,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readNewestAnalysisFactFor: async () => null,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => (SUPPRESS_PERSISTED_GRAPH ? null : PERSISTED_GRAPH),
    loadGraphAndBriefText: async () => ({
      graph: SUPPRESS_PERSISTED_GRAPH ? null : PERSISTED_GRAPH,
      briefText: 'Should we move to a four-day week?',
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../../turn-executor.js');

/** The question that produced the witnessed fabrication. */
const THE_QUESTION = 'Quote the success measure on the model, or say it is unset.';

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function textOnlyAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: ChatWithToolsArgs[];
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push(args);
        return {
          content: [{ type: 'text', text: 'Here is what the model carries.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
          model: 'claude-sonnet-4-6',
          latencyMs: 25,
        };
      },
    },
  };
}

/** The exact user message the routing adapter received. */
async function runTurn(
  message: string,
  clientGraphState?: unknown,
): Promise<string> {
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter,
    // The CLIENT-supplied `graph_state` wire field. Distinct from the persisted
    // graph the store returns, which is the whole point of the divergent arm.
    ...(clientGraphState === undefined
      ? {}
      : { graphState: clientGraphState as never }),
  });
  expect(calls.length).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user).toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

function goalNode(): Record<string, unknown> {
  const n = PERSISTED_GRAPH.nodes.find((x) => x.id === GOAL_ID);
  expect(n, 'the goal node vanished from the fixture').toBeDefined();
  return n!;
}

beforeEach(() => {
  // Reset to the WITNESSED state: a bare goal node carrying no target.
  const n = goalNode();
  delete n.goal_threshold_raw;
  delete n.goal_threshold_unit;
  SUPPRESS_PERSISTED_GRAPH = false;
  PRIOR_TURN.assistant_message = DEFAULT_ASSISTANT_MESSAGE;
  PRIOR_TURN.user_message = USER_SAID_IT;
  setTestSink(() => undefined);
});
afterEach(() => {
  setTestSink(null);
  vi.clearAllMocks();
});

describe('route-level — the success-target record reaches the routing prompt', () => {
  it('THE WITNESSED SEQUENCE: mentioned in conversation, unrecorded → the prompt says UNSET', async () => {
    const prompt = await runTurn(THE_QUESTION);
    const pack = observeSerialisedPack(prompt);

    // Bound by IDENTITY (the key + the exact status literal). If the
    // turn-executor wire is cut this is `undefined` and the test fails with
    // the message below rather than silently passing on a shape check.
    expect(
      pack.goal_target,
      'no `goal_target` reached the prompt — the turn-executor wire is cut, and the model is back to answering from the transcript',
    ).toEqual({ status: 'unset' });

    // The instruction that makes the fact operative must travel with it.
    expect(prompt).toContain(GOAL_TARGET_INSTRUCTION);
  });

  it('the transcript still carries what the user said — the fix does not silence the conversation', async () => {
    const prompt = await runTurn(THE_QUESTION);

    // Doctrine: safety must not reduce Olumi to an empty dead end. The model
    // must still be able to say "you mentioned 85% — shall I record it?".
    expect(prompt).toContain(USER_SAID_IT);
  });

  it('OPPOSITE-DIRECTION TWIN: a genuinely recorded target arrives with its value and unit', async () => {
    const n = goalNode();
    n.goal_threshold_raw = MENTIONED_VALUE;
    n.goal_threshold_unit = '%';

    const prompt = await runTurn(THE_QUESTION);
    const pack = observeSerialisedPack(prompt);

    expect(pack.goal_target).toEqual({ status: 'set', value: MENTIONED_VALUE, unit: '%' });
  });

  it('THE DISCRIMINATOR: the two arms produce DIFFERENT records from the same conversation', async () => {
    const unsetPrompt = await runTurn(THE_QUESTION);
    const unsetRecord = observeSerialisedPack(unsetPrompt).goal_target;

    const n = goalNode();
    n.goal_threshold_raw = MENTIONED_VALUE;
    n.goal_threshold_unit = '%';
    const setPrompt = await runTurn(THE_QUESTION);
    const setRecord = observeSerialisedPack(setPrompt).goal_target;

    // Sameness across inputs that ought to differ is evidence about the
    // instrument, not the world. Both arms carry the SAME transcript, so if
    // these agreed, the record would be reading the conversation — or reading
    // nothing — and the pin would prove neither.
    expect(unsetRecord).not.toEqual(setRecord);
    expect(unsetRecord).toEqual({ status: 'unset' });
    expect(setRecord).toEqual({ status: 'set', value: MENTIONED_VALUE, unit: '%' });
  });
});

/**
 * THE DIVERGENT ARM — the client payload as a contaminating source.
 *
 * Found in review. The first draft of this fix derived `goal_target` from
 * `graphStateForTurn`, which is REQUEST-FIRST (`turn-executor.ts:2004`), so a
 * stale or forged client `graph_state` carrying `goal_threshold_raw` produced
 * `{status:'set'}` — under an instruction telling the model the block is "read
 * from the saved model itself". That is the witnessed defect's OWN class, with
 * the client payload standing in for the transcript.
 *
 * `graph_state` is a supported wire field (boundary/request-extensions.ts), so
 * this is reachable input, not a contrived one.
 */
describe('route-level — the record is read from the PERSISTED graph, never the client payload', () => {
  /** A client graph claiming a target the saved model does not carry. */
  function forgedClientGraph(): Record<string, unknown> {
    return {
      nodes: [
        {
          id: GOAL_ID,
          kind: 'goal',
          label: 'Maintain customer satisfaction',
          goal_threshold_raw: MENTIONED_VALUE,
          goal_threshold_unit: '%',
        },
        { id: 'opt_four_day', kind: 'option', label: 'Four-day week' },
      ],
      edges: [],
    };
  }

  it('a client graph claiming a target does NOT make the record say set', async () => {
    // Persisted goal node is bare (beforeEach). Client says 85%.
    const prompt = await runTurn(THE_QUESTION, forgedClientGraph());
    const pack = observeSerialisedPack(prompt);

    expect(
      pack.goal_target,
      'the record followed the CLIENT graph — a stale or forged graph_state is being reported to the model as saved state',
    ).toEqual({ status: 'unset' });
  });

  it('POSITIVE CONTROL — the same client graph DOES reach the model as the graph it reasons over', async () => {
    // Without this the test above would pass just as happily if `graphState`
    // were being ignored entirely, proving nothing about authority ORDER.
    const prompt = await runTurn(THE_QUESTION, forgedClientGraph());
    const pack = observeSerialisedPack(prompt);
    const graph = pack.graph as { nodes?: Array<{ id?: string }> } | undefined;

    expect(graph?.nodes?.some((n) => n.id === GOAL_ID)).toBe(true);
    // And the client graph is genuinely the one in play: it carries only two
    // nodes, where the persisted fixture carries four.
    expect(graph?.nodes?.length).toBe(2);
  });

  it('when the persisted graph DOES carry a target, the record says set (authority order, not blanket distrust)', async () => {
    const n = goalNode();
    n.goal_threshold_raw = 250000;

    // Client graph claims something DIFFERENT — the persisted one must win.
    const prompt = await runTurn(THE_QUESTION, forgedClientGraph());
    const pack = observeSerialisedPack(prompt);

    expect(pack.goal_target).toEqual({ status: 'set', value: 250000 });
  });
});

/**
 * THE TWO STATES WHERE RECORD AND TRANSCRIPT ACTIVELY DISAGREE.
 *
 * Both were correct by the instruction's wording and neither was tested — and
 * these are the whole point of the change, so wording is not enough.
 */
describe('route-level — record and transcript disagree', () => {
  it('SET BUT DIFFERENT: the record carries its own value, not the one mentioned', async () => {
    const n = goalNode();
    n.goal_threshold_raw = 92; // saved
    n.goal_threshold_unit = '%';
    // The transcript still says 85% (beforeEach).

    const prompt = await runTurn(THE_QUESTION);
    const pack = observeSerialisedPack(prompt);

    // Bound by IDENTITY to the recorded value. A test asserting merely
    // "status === set" would pass on the transcript's number too.
    expect(pack.goal_target).toEqual({ status: 'set', value: 92, unit: '%' });
    // The mentioned-but-not-recorded number is still visible to the model, so
    // it can reconcile the two for the user rather than silently overwrite.
    expect(prompt).toContain(USER_SAID_IT);
  });

  it('MENTIONED BY THE ASSISTANT: the record still says unset', async () => {
    // The prior turn's ASSISTANT message names the figure and the USER never
    // does. `assistant_message` is projected onto the pack exactly as
    // `user_message` is, so a fix that guarded only the user's voice would
    // leave this hole open — and an assistant quoting its own earlier
    // fabrication is precisely how the witnessed defect compounded.
    PRIOR_TURN.user_message = 'What should we do about the four-day week?';
    PRIOR_TURN.assistant_message =
      'Your success measure is 85% CSAT, so I will judge the options against that.';

    const prompt = await runTurn(THE_QUESTION);
    const pack = observeSerialisedPack(prompt);

    expect(pack.goal_target).toEqual({ status: 'unset' });
    // Positive control: the assistant's sentence really is in the prompt, so
    // the assertion above is about authority, not about an absent input.
    expect(prompt).toContain('Your success measure is 85% CSAT');
  });

  it('UNKNOWN STAYS UNKNOWN: no persisted graph and no client graph -> no claim at all', async () => {
    // The REAL no-graph path, driven through the store. The unit-level version
    // of this assertion passed for the wrong reason (it omitted the input
    // rather than exercising the projector) and a mutant that downgraded
    // UNKNOWN to "unset" survived it.
    SUPPRESS_PERSISTED_GRAPH = true;

    const prompt = await runTurn(THE_QUESTION);
    const pack = observeSerialisedPack(prompt);

    expect(pack).not.toHaveProperty('goal_target');
    // Positive control: the turn really did run and the transcript really is
    // present, so the absence above is a decision and not an empty prompt.
    expect(prompt).toContain(USER_SAID_IT);
  });
});
