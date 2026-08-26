/**
 * FACTOR VALUE STATE — THE WIRE, PROVEN AT ROUTE LEVEL.
 *
 * ⭐⭐ WHY THIS FILE EXISTS.
 *
 * `projectFactorValueRecord` is a pure function with a SINGLE production call
 * site: one line in `turn-executor.ts`, at the `assembleContextPackWithSummary`
 * call, beside `goalTarget`. Delete that line and every routing prompt loses
 * the answer to "which factors still have no value?" — while the unit suite and
 * the prompt/pack sanction gate stay green, because both supply the value
 * themselves. That gate's own header records the same lesson: *"deleting the
 * production emission block left this gate 15/15 GREEN"*.
 *
 * A defended pure function with a dark call site is this estate's chronic
 * failure #1, and this slice exists precisely because a capability the UI had
 * never reached the model. Shipping it unpinned would repeat the defect it
 * closes, one level up.
 *
 * So this asserts the fact through the REAL chain —
 *
 *     runTurnExecutor(payload)
 *       → buildTurnContext                (loads the PERSISTED graph)
 *       → assembleContextPackWithSummary  (`factorValues` — THE WIRE)
 *       → buildUserMessage                (serialises the pack)
 *       → the bytes the routing adapter actually receives
 *
 * — reading its evidence off the LLM adapter's captured arguments.
 *
 * ⚠ THE ASSERTIONS BIND BY IDENTITY (the factor's exact label and its exact
 * value-state), never by a count another slice could satisfy: the analysis
 * slices also carry `factor_label`, and it was exactly that overlap which let
 * the live model name one factor while denying it could enumerate the others.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';

interface FactorValuesSlice {
  readonly factors: ReadonlyArray<{
    readonly label: string;
    readonly has_value: boolean;
    readonly provenance: string;
  }>;
  readonly without_value_count: number;
}

/**
 * ⚠⚠ READ THE SLICE, NEVER THE RAW PROMPT — and this is not fussiness, it is the
 * defect this file exists to prevent, caught in this file's own first draft.
 *
 * The earlier assertions here were `expect(prompt).toContain(UNVALUED_LABEL)`.
 * That PASSES with the `factorValues:` wiring DELETED, because the `graph` slice
 * carries the same label:
 *
 *     "graph": { "nodes": [ { "id": "f_support_quality",
 *                            "label": "Support quality risk", "kind": "factor" }, … ] }
 *
 * So the assertion bound by exact label — and was satisfied by A DIFFERENT
 * OBJECT (CLAUDE.md trap 19). A label is not an identity when two slices carry
 * it. That is precisely the shape of the defect this slice closes: the live
 * model could name a factor only because it arrived via ANOTHER slice.
 * Scoping every claim to `pack.factor_values` is what makes these tests
 * discriminate.
 */
function factorValuesSliceOf(prompt: string): FactorValuesSlice | undefined {
  const pack = observeSerialisedPack(prompt);
  return pack.factor_values as FactorValuesSlice | undefined;
}

const SCENARIO_ID = randomUUID();

/** The label that is VALUED — user-authored, so both axes are populated. */
const VALUED_LABEL = 'Monthly ticket volume';
/** The label that carries NO value. This is the fact the whole slice exists for. */
const UNVALUED_LABEL = 'Support quality risk';

/**
 * The PERSISTED graph the session store returns. The unvalued factor is added
 * or removed per test — the same per-arm mutation pattern the sibling
 * route-level suite uses.
 */
const PERSISTED_GRAPH: {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
} = { nodes: [], edges: [] };

function baseNodes(): Array<Record<string, unknown>> {
  return [
    { id: 'goal_margin', kind: 'goal', label: 'Protect operating margin' },
    { id: 'opt_insource', kind: 'option', label: 'Bring support in-house' },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo' },
    {
      id: 'f_ticket_volume',
      kind: 'factor',
      label: VALUED_LABEL,
      observed_state: { value: 4200, unit: 'tickets', source: 'user_edited' },
    },
  ];
}

/** The witnessed shape: NO value, yet stamped as the model's own estimate. */
function unvaluedFactorNode(): Record<string, unknown> {
  return {
    id: 'f_support_quality',
    kind: 'factor',
    label: UNVALUED_LABEL,
    observed_state: { source: 'cee_inference' },
  };
}

const PRIOR_TURN: Record<string, unknown> & { user_message: string | null } = {
  id: 'dddddddd-7a15-4ddd-8ddd-dddddddddddd',
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
  user_message: 'We are weighing bringing support in-house.',
  assistant_message: 'Understood — what is holding the decision in place?',
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
      briefText: 'Should we bring customer support in-house?',
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../../turn-executor.js');

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

async function promptFor(message: string): Promise<string> {
  setTestSink(() => undefined);
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter,
  });
  expect(
    calls.length,
    'the routing adapter was never called — the turn short-circuited before the prompt was built',
  ).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user, 'no user message reached the routing adapter').toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

const THE_QUESTION = 'Which factors still have no value?';

beforeEach(() => {
  PERSISTED_GRAPH.nodes = baseNodes();
  PERSISTED_GRAPH.edges = [];
});

afterEach(() => {
  vi.restoreAllMocks();
  setTestSink(() => undefined);
});

describe('route-level — factor value state reaches the routing prompt', () => {
  /**
   * ⚠⚠ THE PRECONDITION. Without this the discriminator below could pass on a
   * prompt that carries neither arm, and the suite would be green over a cut
   * wire. Assert the slice is THERE before asserting what it says.
   */
  it('POSITIVE CONTROL — the slice itself reaches the prompt', async () => {
    PERSISTED_GRAPH.nodes = [...baseNodes(), unvaluedFactorNode()];
    const prompt = await promptFor(THE_QUESTION);
    expect(prompt).toContain('factor_values');
    expect(prompt).toContain('without_value_count');
  });

  it('THE WIRE: a persisted valueless factor arrives IN THE SLICE, with its value-state', async () => {
    PERSISTED_GRAPH.nodes = [...baseNodes(), unvaluedFactorNode()];
    const slice = factorValuesSliceOf(await promptFor(THE_QUESTION));
    expect(slice, 'factor_values is absent from the serialised pack').toBeDefined();
    const byLabel = new Map(slice!.factors.map((f) => [f.label, f]));
    // The fact the user asked for: this factor, and that it has NO value.
    expect(byLabel.get(UNVALUED_LABEL)).toEqual({
      label: UNVALUED_LABEL,
      has_value: false,
      provenance: 'ai_drafted',
    });
    expect(byLabel.get(VALUED_LABEL)?.has_value).toBe(true);
    expect(slice!.without_value_count).toBe(1);
  });

  /**
   * ⭐ THE DISCRIMINATOR. The same question and the same transcript over two
   * graphs that differ only in the unvalued factor must produce DIFFERENT
   * prompts. A slice that renders identically either way is carrying nothing,
   * however present its key is.
   */
  it('THE DISCRIMINATOR: valued-only vs valueless graphs produce DIFFERENT SLICES', async () => {
    PERSISTED_GRAPH.nodes = baseNodes();
    const without = factorValuesSliceOf(await promptFor(THE_QUESTION));
    PERSISTED_GRAPH.nodes = [...baseNodes(), unvaluedFactorNode()];
    const with_ = factorValuesSliceOf(await promptFor(THE_QUESTION));

    expect(without, 'factor_values absent on the valued-only arm').toBeDefined();
    expect(with_, 'factor_values absent on the valueless arm').toBeDefined();
    // ⚠ Compared INSIDE the slice. Comparing whole prompts passes with the
    // wiring cut, because the `graph` slice differs between the two arms too.
    expect(without!.without_value_count).toBe(0);
    expect(with_!.without_value_count).toBe(1);
    expect(without!.factors.map((f) => f.label)).not.toContain(UNVALUED_LABEL);
    expect(with_!.factors.map((f) => f.label)).toContain(UNVALUED_LABEL);
  });

  /**
   * HONEST AT ZERO, ON THE WIRE. "Every factor has a value" must be SAYABLE —
   * the whole defect was "none missing" and "I cannot see" sharing one token.
   */
  it('a fully-valued graph still carries the slice, with a zero count', async () => {
    PERSISTED_GRAPH.nodes = baseNodes();
    const prompt = await promptFor(THE_QUESTION);
    expect(prompt).toContain('factor_values');
    // The pack is pretty-printed into the prompt, so match the field tolerantly
    // rather than pinning a spacing the serialiser owns.
    expect(prompt).toMatch(/"without_value_count":\s*0\b/);
    expect(prompt).not.toContain(UNVALUED_LABEL);
  });
});
