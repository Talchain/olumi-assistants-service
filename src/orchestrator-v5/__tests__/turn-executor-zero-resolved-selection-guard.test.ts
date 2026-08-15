/**
 * Ghost-selection honesty through the real TurnExecutor.
 *
 * The prompt already tells the routing model how to disclose an unresolved
 * selection. This suite proves the deterministic final guard instead: a model
 * or advice-gate answer cannot silently adopt the analysed leader when every
 * requested selected id resolved to nothing.
 *
 * Only stores and the routing adapter are faked. The exercised chain is:
 *
 *   runTurnExecutor → buildTurnContext/resolveTurnSelection
 *     → ContextPack.focus → real compose/commit → finalizeRun guard
 *
 * The paired controls are load-bearing. Removing the single final-guard call
 * makes the permitted leader-shaped model answer survive and turns the primary
 * assertion red; no withheld-leader or forbidden-phrase guard can rescue it.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';

type GraphReadMode = 'ok_present' | 'degraded';

const harness = vi.hoisted(() => ({
  graphReadMode: 'ok_present' as GraphReadMode,
  appendedRows: [] as Array<
    Record<string, unknown> & {
      assistantMessage?: string | null;
      graph?: unknown;
      pending_actions?: readonly unknown[];
    }
  >,
  replayAppendedHistory: false,
}));

const SCENARIO_ID = '8e425d85-4fc7-4ab4-9d6e-2c77fd41dbb2';
const PRIOR_ANALYSIS_ROW_ID = '8056dbe9-26fd-4e4b-a20f-360d026fbd70';
const OPTION_ID = 'opt_local';
const OPTION_LABEL = 'Hire locally';
const OTHER_OPTION_ID = 'opt_offshore';
const OTHER_OPTION_LABEL = 'Use an offshore partner';
const FACTOR_ID = 'factor_salary';
const FACTOR_LABEL = 'Engineer salary';
const GHOST_ID = 'node_fabricated_selected_id';
const MODEL_PATH_MESSAGE = 'help me think this through';

const PERSISTED_GRAPH = {
  nodes: [
    {
      id: FACTOR_ID,
      kind: 'factor',
      label: FACTOR_LABEL,
      category: 'external',
      observed_state: { value: 95000, unit: '£', source: 'user_edited' },
    },
    { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
    { id: OTHER_OPTION_ID, kind: 'option', label: OTHER_OPTION_LABEL },
    { id: 'goal_growth', kind: 'goal', label: 'Revenue growth' },
  ],
  edges: [
    {
      from: FACTOR_ID,
      to: 'goal_growth',
      strength: { mean: -0.4, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'negative',
    },
  ],
  goal_node_id: 'goal_growth',
};

const GRAPH_HASH = computeAnalysisAffectingGraphHash(PERSISTED_GRAPH as never)!;

const PRIOR_ANALYSIS_TURN = {
  id: PRIOR_ANALYSIS_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-analysis-turn',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-analysis',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 100,
  created_at: new Date(Date.now() - 60_000).toISOString(),
  user_message: 'Run the analysis',
  assistant_message: 'Analysis complete.',
};

const RUN_ANALYSIS_FACT: Record<string, unknown> = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    scenario_id: SCENARIO_ID,
    leading_option_id: OPTION_ID,
    summary: 'Hire locally leads in the current analysis.',
    graph_hash_at_run: GRAPH_HASH,
    computed_at: new Date(Date.now() - 60_000).toISOString(),
    constraint_verdict: {
      may_name_leading_option: true,
      constraint_verdict_state: 'evaluated_feasible',
    },
    enrichment: {
      analysis_status: 'completed',
      option_comparison: [
        {
          option_id: OPTION_ID,
          option_label: OPTION_LABEL,
          win_probability: 0.62,
          outcome_mean: 0.5,
        },
        {
          option_id: OTHER_OPTION_ID,
          option_label: OTHER_OPTION_LABEL,
          win_probability: 0.38,
          outcome_mean: 0.3,
        },
      ],
      factor_sensitivity: [
        {
          factor_id: FACTOR_ID,
          factor_label: FACTOR_LABEL,
          sensitivity: 0.6,
          influence_score: 0.6,
          direction: 'negative',
        },
      ],
      robustness_synthesis: { overall_assessment: 'moderate' },
    },
    win_probabilities: { [OPTION_ID]: 0.62, [OTHER_OPTION_ID]: 0.38 },
  },
};

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({
    summarise: async () => ({ text: 'DECISION FRAME: noop.' }),
  }),
  resetRollingSummaryForTests: () => undefined,
}));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (row: (typeof harness.appendedRows)[number]) => {
      harness.appendedRows.push(row);
      return { id: `row-${randomUUID()}` };
    },
    readRecent: async (_id: string, limit = 20) => {
      const replayed = harness.replayAppendedHistory
        ? [...harness.appendedRows].reverse().map((row, index) => ({
            id: `persisted-row-${index}`,
            scenario_id: String(row['scenario_id'] ?? SCENARIO_ID),
            user_id: null,
            turn_id: String(row['turn_id'] ?? `persisted-turn-${index}`),
            turn_class: String(row['turn_class'] ?? 'direct_answer'),
            handler_id: row['handler_id'] ?? null,
            request_hash: String(row['request_hash'] ?? `persisted-request-${index}`),
            response_emitted: true,
            llm_calls_used: Number(row['llm_calls_used'] ?? 1),
            duration_ms: Number(row['duration_ms'] ?? 1),
            created_at: new Date(Date.now() - index * 1_000).toISOString(),
            user_message:
              typeof row['userMessage'] === 'string' ? row['userMessage'] : null,
            assistant_message:
              typeof row.assistantMessage === 'string' ? row.assistantMessage : null,
          }))
        : [];
      return [...replayed, PRIOR_ANALYSIS_TURN].slice(0, limit);
    },
    countTurns: async () =>
      harness.replayAppendedHistory ? harness.appendedRows.length + 1 : 1,
    readFactsFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.includes(PRIOR_ANALYSIS_ROW_ID) ? [RUN_ANALYSIS_FACT] : [],
    readFactsWithTurnFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.includes(PRIOR_ANALYSIS_ROW_ID)
        ? [
            {
              fact: RUN_ANALYSIS_FACT,
              turn_id: PRIOR_ANALYSIS_ROW_ID,
              fact_created_at: new Date(Date.now() - 60_000).toISOString(),
            },
          ]
        : [],
    readNewestAnalysisFactFor: async () => RUN_ANALYSIS_FACT,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => PERSISTED_GRAPH,
    loadGraphAndBriefText: async () => {
      if (harness.graphReadMode === 'degraded') {
        throw new Error('simulated canonical graph read failure');
      }
      return {
        graph: PERSISTED_GRAPH,
        briefText: 'Hire locally or use an offshore partner?',
      };
    },
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');
const { deriveAnswerTextFromShape } = await import('../routing/answer-shape.js');

const NOT_IN_MODEL_TEXT =
  'What you selected is not in the model I can see, so I can’t answer about it without guessing. I have not substituted a different element.';
const COULD_NOT_CHECK_TEXT =
  'I could not read the model to check what you selected, so I can’t answer about it without guessing. I have not substituted a different element.';

const LEADER_SHAPE = {
  headline: `${OPTION_LABEL} is ahead at 62%.`,
  bullets: [`${OTHER_OPTION_LABEL} is at 38%.`],
  detail: `${FACTOR_LABEL} is the strongest driver in the current analysis.`,
};

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `turn-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function textOnlyResult(text: string): ChatWithToolsResult {
  return {
    content: [{ type: 'text', text }],
    stop_reason: 'end_turn',
    usage: { input_tokens: 20, output_tokens: 20 } as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

function shapedConverseResult(): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    { type: 'text', text: 'Here is the current analysis.' },
    {
      type: 'tool_use',
      id: 'tool-use-shaped-answer',
      name: OLUMI_ACTION_TOOL_NAME,
      input: { intent_class: 'converse', answer_shape: LEADER_SHAPE },
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 20, output_tokens: 20 } as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 20,
  };
}

function resolvedAdapter(result: ChatWithToolsResult) {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(result),
  };
}

function failingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockRejectedValue(new Error('simulated provider failure')),
  };
}

type Selection = {
  readonly node_ids: readonly string[];
  readonly edge_ids: readonly string[];
};

async function run(
  message: string,
  adapter: ReturnType<typeof resolvedAdapter> | ReturnType<typeof failingAdapter>,
  selectedElements?: Selection | null,
) {
  return runTurnExecutor(payload(message), `request-${randomUUID()}`, {
    routingAdapter: adapter,
    // A degraded canonical read may still have a client graph for ordinary
    // routing. Selection resolution deliberately refuses that second authority.
    graphState: PERSISTED_GRAPH as never,
    ...(selectedElements !== undefined ? { selectedElements } : {}),
  });
}

beforeEach(() => {
  harness.graphReadMode = 'ok_present';
  harness.appendedRows.length = 0;
  harness.replayAppendedHistory = false;
  setTestSink(() => undefined);
});

afterEach(() => {
  setTestSink(null);
  vi.clearAllMocks();
});

describe('TurnExecutor final guard — every requested selection resolved to nothing', () => {
  it('kills leader-grounded model prose and drops post-rewrite answer carriers', async () => {
    const modelAnswer = deriveAnswerTextFromShape(LEADER_SHAPE);
    const control = await run(
      MODEL_PATH_MESSAGE,
      resolvedAdapter(shapedConverseResult()),
      { node_ids: [OPTION_ID], edge_ids: [] },
    );
    expect(control.response.assistant_text).toBe(modelAnswer);
    expect(control.answerShape).toEqual(LEADER_SHAPE);

    const adapter = resolvedAdapter(shapedConverseResult());
    const guarded = await run(
      MODEL_PATH_MESSAGE,
      adapter,
      { node_ids: [GHOST_ID], edge_ids: [] },
    );

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(guarded.response.assistant_text).toBe(NOT_IN_MODEL_TEXT);
    expect(guarded.response.assistant_text).not.toBe(modelAnswer);
    expect(guarded.response.assistant_text).not.toContain(OPTION_LABEL);
    expect(guarded.response.assistant_text).not.toContain('62%');
    expect(guarded.response.blocks).toEqual([]);
    expect(guarded.response.suggested_actions).toEqual([]);
    expect(guarded.response.insights).toEqual([]);
    expect(guarded.answerShape).toBeUndefined();
    expect(guarded.reasoning).toBeUndefined();
    expect(guarded.answerKind).toBe('functional');
    expect(guarded.groundedSelection).toEqual({
      element_ids: [],
      unresolved: 'not_in_model',
    });

    const persisted = harness.appendedRows.at(-1);
    expect(persisted?.assistantMessage).toBe(NOT_IN_MODEL_TEXT);
    expect(persisted?.assistantMessage).not.toContain(OPTION_LABEL);
    expect(persisted?.assistantMessage).not.toContain('62%');
    expect(persisted?.pending_actions).toEqual([]);
    expect(persisted?.graph).toBeUndefined();

    const shipped = JSON.stringify(guarded.response);
    expect(shipped).not.toContain(GHOST_ID);
    expect(shipped).not.toContain(OPTION_ID);
    expect(shipped).not.toContain(FACTOR_ID);
  });

  it('also replaces a deterministic post-analysis answer and its section directive', async () => {
    const adapter = failingAdapter();
    const result = await run(
      'What would change this result?',
      adapter,
      { node_ids: [GHOST_ID], edge_ids: [] },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.response.assistant_text).toBe(NOT_IN_MODEL_TEXT);
    expect(result.response.blocks).toEqual([]);
    expect(result.response.suggested_actions).toEqual([]);
    expect(result.answerKind).toBe('functional');
    expect(harness.appendedRows.at(-1)?.assistantMessage).toBe(NOT_IN_MODEL_TEXT);
    expect(harness.appendedRows.at(-1)?.pending_actions).toEqual([]);
    expect(harness.appendedRows.at(-1)?.graph).toBeUndefined();
  });

  it('does not persist a resumable proposal captured from the discarded answer', async () => {
    const discardedProposal = 'Would you like me to add team morale as a factor?';
    const result = await run(
      MODEL_PATH_MESSAGE,
      resolvedAdapter(textOnlyResult(discardedProposal)),
      { node_ids: [GHOST_ID], edge_ids: [] },
    );

    expect(result.response.assistant_text).toBe(NOT_IN_MODEL_TEXT);
    expect(result.response.assistant_text).not.toContain('team morale');
    expect(result.response.suggested_actions).toEqual([]);
    expect(harness.appendedRows.at(-1)?.assistantMessage).toBe(NOT_IN_MODEL_TEXT);
    expect(harness.appendedRows.at(-1)?.pending_actions).toEqual([]);
  });

  it('the next routed turn sees the refusal in history, never the discarded leader answer', async () => {
    await run(
      MODEL_PATH_MESSAGE,
      resolvedAdapter(shapedConverseResult()),
      { node_ids: [GHOST_ID], edge_ids: [] },
    );
    expect(harness.appendedRows.at(-1)?.assistantMessage).toBe(NOT_IN_MODEL_TEXT);

    harness.replayAppendedHistory = true;
    const followUpAdapter = resolvedAdapter(textOnlyResult('Let us inspect another assumption.'));
    await run('What else should I inspect?', followUpAdapter);

    expect(followUpAdapter.chatWithTools).toHaveBeenCalledTimes(1);
    const modelInput = String(
      followUpAdapter.chatWithTools.mock.calls[0]![0].messages[0]?.content ?? '',
    );
    expect(modelInput).toContain(NOT_IN_MODEL_TEXT);
    expect(modelInput).not.toContain(`${OPTION_LABEL} is ahead at 62%`);
    expect(modelInput).not.toContain(LEADER_SHAPE.detail);
  });

  it('distinguishes a degraded graph read without claiming the element is absent', async () => {
    harness.graphReadMode = 'degraded';
    const adapter = resolvedAdapter(
      textOnlyResult(`${OPTION_LABEL} leads the current result with 62%.`),
    );
    const result = await run(
      MODEL_PATH_MESSAGE,
      adapter,
      { node_ids: [GHOST_ID], edge_ids: [] },
    );

    expect(adapter.chatWithTools).toHaveBeenCalledTimes(1);
    expect(result.response.assistant_text).toBe(COULD_NOT_CHECK_TEXT);
    expect(result.response.assistant_text).not.toContain('not in the model');
    expect(result.response.assistant_text).not.toContain(OPTION_LABEL);
    expect(result.response.blocks).toEqual([]);
    expect(harness.appendedRows.at(-1)?.assistantMessage).toBe(COULD_NOT_CHECK_TEXT);
    expect(harness.appendedRows.at(-1)?.pending_actions).toEqual([]);
    expect(harness.appendedRows.at(-1)?.graph).toBeUndefined();
  });
});

describe('TurnExecutor final guard — byte-identical controls', () => {
  it('leaves no-selection, resolved-selection and mixed-selection answers unchanged', async () => {
    const original =
      'The trade-off is between local control and offshore flexibility; check the assumptions behind both.';

    const noSelection = await run(MODEL_PATH_MESSAGE, resolvedAdapter(textOnlyResult(original)));
    const resolved = await run(
      MODEL_PATH_MESSAGE,
      resolvedAdapter(textOnlyResult(original)),
      { node_ids: [OPTION_ID], edge_ids: [] },
    );
    const mixed = await run(
      MODEL_PATH_MESSAGE,
      resolvedAdapter(textOnlyResult(original)),
      { node_ids: [OPTION_ID, GHOST_ID], edge_ids: [] },
    );

    expect(noSelection.response.assistant_text).toBe(original);
    expect(JSON.stringify(resolved.response)).toBe(JSON.stringify(noSelection.response));
    expect(JSON.stringify(mixed.response)).toBe(JSON.stringify(noSelection.response));
    expect(harness.appendedRows.slice(-3).map((row) => row.assistantMessage)).toEqual([
      original,
      original,
      original,
    ]);
  });

  it('preserves a committed selected-mutation receipt when the canonical read is degraded', async () => {
    harness.graphReadMode = 'degraded';
    const adapter = failingAdapter();
    const result = await run(
      `Set ${FACTOR_LABEL} to £100,000`,
      adapter,
      { node_ids: [FACTOR_ID], edge_ids: [] },
    );

    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(result.telemetry.turn_class).toBe('handler');
    expect(result.telemetry.commit_performed).toBe(true);
    expect(result.response.blocks.find((block) => block.type === 'graph_patch')).toMatchObject({
      operation: 'set_factor_value',
      target_id: FACTOR_ID,
    });
    expect(result.response.assistant_text).not.toBe(NOT_IN_MODEL_TEXT);
    expect(result.response.assistant_text).not.toBe(COULD_NOT_CHECK_TEXT);
    expect(harness.appendedRows.at(-1)?.graph).toBeDefined();
    expect(harness.appendedRows.at(-1)?.assistantMessage).not.toBe(NOT_IN_MODEL_TEXT);
    expect(harness.appendedRows.at(-1)?.assistantMessage).not.toBe(COULD_NOT_CHECK_TEXT);
  });

  it('does not hide or reshape an existing failure response', async () => {
    const withoutSelection = await run(MODEL_PATH_MESSAGE, failingAdapter());
    const withGhostSelection = await run(
      MODEL_PATH_MESSAGE,
      failingAdapter(),
      { node_ids: [GHOST_ID], edge_ids: [] },
    );

    expect(withoutSelection.response.blocks.some((block) => block.type === 'error')).toBe(true);
    expect(JSON.stringify(withGhostSelection.response)).toBe(
      JSON.stringify(withoutSelection.response),
    );
    expect(withGhostSelection.response.assistant_text).not.toBe(NOT_IN_MODEL_TEXT);
    expect(withGhostSelection.response.assistant_text).not.toBe(COULD_NOT_CHECK_TEXT);
  });
});
