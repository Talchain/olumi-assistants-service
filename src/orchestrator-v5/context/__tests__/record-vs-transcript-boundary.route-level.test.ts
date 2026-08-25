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
 * exactly the same reason (compactGraph drops the field) — has NO such pin:
 * deleting its call-site line drops every decision constraint from the prompt
 * and leaves the whole suite green. That is the shape this file exists to stop
 * happening to `goal_target`.
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
const PRIOR_TURN = {
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
    loadGraph: async () => PERSISTED_GRAPH,
    loadGraphAndBriefText: async () => ({
      graph: PERSISTED_GRAPH,
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
async function runTurn(message: string): Promise<string> {
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter,
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
