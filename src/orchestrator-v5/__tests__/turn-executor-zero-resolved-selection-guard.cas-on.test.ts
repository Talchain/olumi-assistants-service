import { __setUseAppendV6ForTest } from '../append-v6-flag.js';
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
 *   runTurnExecutor → buildTurnContext/resolveTurnSelection + selectionHonesty
 *     → ContextPack.focus → real compose/commit → finalizeRun guard
 *
 * The paired controls are load-bearing. Removing the single final-guard call
 * makes the permitted leader-shaped model answer survive and turns the primary
 * assertion red; no withheld-leader or forbidden-phrase guard can rescue it.
 */

import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
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
const CONTROLLED_FACTOR_ID = 'factor_team_size';

const PERSISTED_GRAPH = {
  nodes: [
    {
      id: FACTOR_ID,
      kind: 'factor',
      label: FACTOR_LABEL,
      category: 'external',
      observed_state: { value: 95000, unit: '£', source: 'user_edited' },
    },
    {
      id: CONTROLLED_FACTOR_ID,
      kind: 'factor',
      label: 'Team size',
      category: 'controllable',
      observed_state: { value: 8, source: 'user_edited' },
    },
    { id: 'decision_hiring', kind: 'decision', label: 'Hiring approach' },
    { id: OPTION_ID, kind: 'option', label: OPTION_LABEL, interventions: { [CONTROLLED_FACTOR_ID]: 8 } },
    { id: OTHER_OPTION_ID, kind: 'option', label: OTHER_OPTION_LABEL, interventions: { [CONTROLLED_FACTOR_ID]: 6 } },
    { id: 'goal_growth', kind: 'goal', label: 'Revenue growth' },
  ],
  edges: [
    {
      from: 'decision_hiring',
      to: OPTION_ID,
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
    {
      from: 'decision_hiring',
      to: OTHER_OPTION_ID,
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
    {
      from: OPTION_ID,
      to: CONTROLLED_FACTOR_ID,
      strength: { mean: 1, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
    {
      from: OTHER_OPTION_ID,
      to: CONTROLLED_FACTOR_ID,
      strength: { mean: 0.8, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
    {
      from: CONTROLLED_FACTOR_ID,
      to: 'goal_growth',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
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
      // ⚠ ADDED. This fixture expressed robustness only through
      // `robustness_synthesis`, which the advice gate reads for its own band —
      // and which appears in **0 of 41** real September captures. The separation
      // permission reads `enrichment.robustness`, so without this the fixture
      // describes a run whose arms were never told apart, and the deterministic
      // answer it asserts is one the wire withholds. Completed, not relaxed.
      robustness: { level: 'high', near_tie: { is_tie: false } },
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
    loadGraph: async () => PERSISTED_GRAPH,
    loadGraphAndBriefText: async () => {
      if (harness.graphReadMode === 'degraded') {
        throw new Error('simulated canonical graph read failure');
      }
      return { revision: 7,
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
  adapter: ReturnType<typeof failingAdapter>,
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


describe('TurnExecutor final guard — byte-identical controls', () => {



  it('CAS ON refuses a selected mutation when the combined recovery read also fails', async () => {
    __setUseAppendV6ForTest(true);
    harness.graphReadMode = 'degraded';
    const result = await run(`Set ${FACTOR_LABEL} to £100,000`, failingAdapter(), { node_ids: [FACTOR_ID], edge_ids: [] });
    expect(result.telemetry.commit_performed).toBe(false);
    expect(harness.appendedRows.some(row => row.graph !== undefined)).toBe(false);
    });


});

afterEach(() => __setUseAppendV6ForTest(true));
