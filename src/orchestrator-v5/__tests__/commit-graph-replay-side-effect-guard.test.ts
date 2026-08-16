import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { decisionRecordSpy, maintainSummarySpy, modelServiceSpy, saveVersionSpy } =
  vi.hoisted(() => ({
    decisionRecordSpy: vi.fn(async () => undefined),
    maintainSummarySpy: vi.fn(async () => undefined),
    modelServiceSpy: vi.fn(),
    saveVersionSpy: vi.fn(async () => ({
      status: 'ok',
      value: {
        version_id: 'version-1',
        version_number: 1,
        graph_identity_hash: 'a'.repeat(64),
        deduped: false,
        event_id: 'model_version_created_turn',
      },
    })),
  }));

vi.mock('../model-management/index.js', () => ({
  getModelManagementService: modelServiceSpy.mockImplementation(() => ({
    saveVersion: saveVersionSpy,
  })),
}));

vi.mock('../decision-records/capture.js', () => ({
  recordDecisionRecordForCommit: decisionRecordSpy,
}));

vi.mock('../rolling-summary/capture.js', () => ({
  maintainRollingSummaryForCommit: maintainSummarySpy,
}));

import { _resetConfigCache } from '../../config/index.js';
import { TelemetryEvents, setTestSink } from '../../utils/telemetry.js';
import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';
import {
  GraphAppendReplayError,
  type GraphAppendDisposition,
} from '../session/store.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ROW_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const graph = {
  nodes: [{ id: 'goal_value', kind: 'goal', label: 'Value' }],
  edges: [],
};

const analysisFact = {
  fact_type: 'run_analysis' as const,
  fact_version: 1 as const,
  noop: false as const,
  result: {
    scenario_id: SCENARIO_ID,
    leading_option_id: 'opt_a',
    win_probabilities: { 'Option A': 1 },
    summary: 'Option A currently leads.',
    graph_hash_at_run: 'abcdef0123456789',
    computed_at: '2026-08-16T00:00:00.000Z',
  },
};

const metadata = {
  scenario_id: SCENARIO_ID,
  turn_id: TURN_ID,
  turn_class: 'handler' as const,
  handler_id: 'run_analysis' as const,
  request_hash: 'sha256:test',
  llm_calls_used: 0,
  duration_ms: 42,
  handler_facts: [analysisFact],
  graph,
};

function response() {
  return composeDirectAnswerResponse({
    answerKind: 'functional',
    assistant_text: 'Analysis complete.',
    stage: 'analyse',
    suggested_actions: [
      {
        id: 'chip_action_run_analysis',
        label: 'Run analysis',
        message: 'Run analysis.',
        action_type: 'run_analysis',
      },
    ],
  });
}

const telemetryEvents: string[] = [];

async function drainFireAndForget(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  vi.clearAllMocks();
  telemetryEvents.length = 0;
  setTestSink((eventName) => telemetryEvents.push(eventName));
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
  _resetConfigCache();
});

afterEach(() => {
  setTestSink(null);
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('graph append replay is rejected before every post-insert side effect', () => {
  it.each<readonly [GraphAppendDisposition]>([
    ['byte_identical_replay'],
    ['divergent_replay'],
  ])('%s emits no receipt authority or post-insert hook', async (disposition) => {
    const store = createNoopSessionStore({
      appendId: ROW_ID,
      getScenarioOwnerBehaviour: { value: 'owner-user-id' },
    });
    vi.spyOn(store, 'append').mockResolvedValue({
      id: ROW_ID,
      graph_write_disposition: disposition,
    });

    await expect(commitDirectAnswer(response(), metadata, store)).rejects.toEqual(
      expect.objectContaining({
        name: GraphAppendReplayError.name,
        graph_write_disposition: disposition,
        rpc_code: 'GRAPH_APPEND_REPLAY',
      }),
    );
    await drainFireAndForget();

    expect(telemetryEvents).not.toContain(TelemetryEvents.PendingActionCreated);
    expect(modelServiceSpy).not.toHaveBeenCalled();
    expect(saveVersionSpy).not.toHaveBeenCalled();
    expect(decisionRecordSpy).not.toHaveBeenCalled();
    expect(maintainSummarySpy).not.toHaveBeenCalled();
  });

  it('an id without accepted_insert authority emits no post-insert hook', async () => {
    const store = createNoopSessionStore({
      appendId: ROW_ID,
      getScenarioOwnerBehaviour: { value: 'owner-user-id' },
    });
    vi.spyOn(store, 'append').mockResolvedValue({ id: ROW_ID });

    await expect(commitDirectAnswer(response(), metadata, store)).rejects.toMatchObject({
      name: 'StateCommitFailedError',
      rpc_code: 'GRAPH_APPEND_ACK_REQUIRED',
    });
    await drainFireAndForget();

    expect(telemetryEvents).not.toContain(TelemetryEvents.PendingActionCreated);
    expect(modelServiceSpy).not.toHaveBeenCalled();
    expect(saveVersionSpy).not.toHaveBeenCalled();
    expect(decisionRecordSpy).not.toHaveBeenCalled();
    expect(maintainSummarySpy).not.toHaveBeenCalled();
  });

  it('accepted_insert is the discriminating success control', async () => {
    const store = createNoopSessionStore({
      appendId: ROW_ID,
      getScenarioOwnerBehaviour: { value: 'owner-user-id' },
    });

    const committed = await commitDirectAnswer(response(), metadata, store);
    await drainFireAndForget();

    expect(committed).toMatchObject({
      performed: true,
      graphPersisted: true,
      persisted_row_id: ROW_ID,
    });
    expect(committed.persistedGraph).not.toBeNull();
    expect(committed.persistedAnalysisGraphHash).not.toBeNull();
    expect(telemetryEvents).toContain(TelemetryEvents.PendingActionCreated);
    expect(modelServiceSpy).toHaveBeenCalledOnce();
    expect(saveVersionSpy).toHaveBeenCalledOnce();
    expect(decisionRecordSpy).toHaveBeenCalledOnce();
    expect(maintainSummarySpy).toHaveBeenCalledOnce();
  });
});
