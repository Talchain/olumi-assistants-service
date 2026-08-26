import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const mocks = vi.hoisted(() => ({
  loadPersistedGraphStrict: vi.fn(),
  loadPriorFactsQuietly: vi.fn(),
  commitDirectAnswer: vi.fn(),
  applyFactorValueEdit: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
  loadPriorFactsQuietly: mocks.loadPriorFactsQuietly,
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: mocks.commitDirectAnswer,
  computeRequestHash: vi.fn(() => 'sha256:system-event'),
}));

vi.mock('../factor-value-edit.js', () => ({
  applyFactorValueEdit: mocks.applyFactorValueEdit,
}));

import { dispatchSystemEvent } from '../dispatch.js';
import {
  ModelVersionMutationReceiptV1LocalSchema,
  OlumiResponseWithModelVersionReceiptLocalSchema,
} from '../../model-management/mutation-receipt.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const VERSION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MUTATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const BASE_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Grow revenue' },
    {
      id: 'fac_demand',
      kind: 'factor',
      label: 'Demand',
      observed_state: { value: 0.4, source: 'cee_inference' },
    },
  ],
  edges: [
    {
      from: 'fac_demand',
      to: 'goal_growth',
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
  goal_node_id: 'goal_growth',
};

const MUTATED_GRAPH = {
  ...BASE_GRAPH,
  nodes: [
    BASE_GRAPH.nodes[0],
    {
      ...BASE_GRAPH.nodes[1],
      observed_state: { value: 0.7, source: 'user_override' },
    },
  ],
};

const RECEIPT = ModelVersionMutationReceiptV1LocalSchema.parse({
  schema: 'model_version_mutation_receipt.v1',
  scenario_id: SCENARIO_ID,
  mutation_id: MUTATION_ID,
  version_id: VERSION_ID,
  sequence: 2,
  graph: MUTATED_GRAPH,
  full_hash: 'a'.repeat(64),
  hash_algorithm: 'sha256',
  identity_projection_version: 'identity.v1',
  identity_normaliser_version: '1',
  graph_schema_version: 'graph_v3',
  analysis_affecting_hash: 'b'.repeat(64),
  actor: { kind: 'unknown' },
  creation: { kind: 'committed_mutation' },
  source_turn_id: TURN_ID,
  lineage: {
    kind: 'known',
    parent_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    root_version_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  },
  undo_version_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  event_id: `model_version_created_mutation_${MUTATION_ID}`,
});

describe('system-event atomic model-version receipt egress', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadPersistedGraphStrict.mockResolvedValue(BASE_GRAPH);
    mocks.loadPriorFactsQuietly.mockResolvedValue([]);
    mocks.applyFactorValueEdit.mockResolvedValue({
      kind: 'mutated',
      response: {
        response_version: 2,
        assistant_text: 'Updated Demand.',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'analyse',
      },
      mutatedGraph: MUTATED_GRAPH,
      handlerFacts: [],
      graph: MUTATED_GRAPH,
      baseGraph: BASE_GRAPH,
    });
    mocks.commitDirectAnswer.mockImplementation(async (response) => ({
      response: { ...response, model_version_receipt: RECEIPT },
      performed: true,
      persisted_row_id: 'turn-row',
      modelVersionReceipt: {},
      graphPersisted: true,
      pendingLifecycle: {
        priorCount: 0,
        freshCount: 0,
        carriedCount: 0,
        droppedCount: 0,
      },
      persistedAnalysisGraphHash: '0123456789abcdef',
      persistedGraph: MUTATED_GRAPH,
    }));
  });

  it('returns the exact committed receipt after factor response reconstruction', async () => {
    const payload = {
      kind: 'system_event',
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      stage: 'analyse',
      event: {
        kind: 'factor_value_edit',
        target_id: 'fac_demand',
        value: 0.7,
        field: 'value',
      },
    } as unknown as SystemEventTurnPayload;

    const result = await dispatchSystemEvent({ payload, requestId: 'req-receipt' });
    const wire = OlumiResponseWithModelVersionReceiptLocalSchema.parse(result.response);

    expect(result.commitPerformed).toBe(true);
    expect(wire.model_version_receipt).toEqual(RECEIPT);
    expect(mocks.commitDirectAnswer).toHaveBeenCalledOnce();
  });
});
