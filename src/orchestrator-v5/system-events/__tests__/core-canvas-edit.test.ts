/**
 * THIN CORE: a canvas gesture on a core scenario changes its living model, and the graph committed is the one regenerated
 * from it (one core write); a gesture this slice cannot apply, or one made on a moved model, changes nothing; a legacy
 * scenario keeps its existing writers. The REAL dispatch and commit, over a store double. SYNTHETIC model.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';
import { withScenarioRevision } from '../../../../tests/utils/revision-store-double.js';
import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
import { mapLivingModel } from '../../path-b/living-model/mapper.js';
import { KNOWN_ANSWER } from '../../path-b/living-model/__tests__/fixtures.js';

const append = vi.fn();
const loadGraph = vi.fn();
const readMostRecentPendingActions = vi.fn();
const readCommittedTurn = vi.fn();
const store = { append, loadGraph, readMostRecentPendingActions, readCommittedTurn };
vi.mock('../../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../session/index.js')>()),
  getSessionStore: () => withScenarioRevision(store),
}));

import { dispatchSystemEvent } from '../dispatch.js';

type Rec = Record<string, any>;
const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const CORE: Rec = { ...mapLivingModel(KNOWN_ANSWER).graph, living_model: KNOWN_ANSWER };
const BASE = computeExpectedGraphCasHashes(CORE).expectedGraphAnalysisHash!;
const send = (event: Rec, coreScenarioCheck = true) => dispatchSystemEvent({ requestId: 'req-1', coreScenarioCheck, payload: {
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', scenario_id: SCENARIO, stage: 'evaluate', kind: 'system_event', event,
} as unknown as SystemEventTurnPayload });
const written = (): Rec => (append.mock.calls[0]![0] as Rec).graph;

beforeEach(() => {
  vi.resetAllMocks();
  loadGraph.mockResolvedValue(CORE);
  append.mockResolvedValue({ id: 'turn-1', revision: 8 });
  readMostRecentPendingActions.mockResolvedValue([]);
  readCommittedTurn.mockResolvedValue(null);
});

describe('a canvas gesture on a core scenario', () => {
  it('changes the living model and commits the graph regenerated from it, once', async () => {
    const out = await send({ kind: 'option_intervention_edit', option_id: 'push', factor_id: 'f', value: 0.8, base_graph_hash: BASE });
    expect(out.commitPerformed, JSON.stringify(out.response)).toBe(true);
    expect(append).toHaveBeenCalledTimes(1);
    const push = (written().living_model as typeof KNOWN_ANSWER).options.find((o) => o.id === 'push')!;
    expect(push.settings).toEqual([{ factor_id: 'f', value: 0.8, low: null, high: null, unit: null, source: 'user', party: null, quote: null }]);
    expect((written().nodes as Rec[]).find((n) => n.id === 'push')!.interventions.f).toMatchObject({ value: 0.8, raw_value: 0.8, source: 'user_edited' });
    expect(out.response.draft_graph).toBeDefined();
  });

  it('a gesture this slice cannot apply is refused, said plainly, and nothing is written', async () => {
    const out = await send({ kind: 'structural_add', node_id: 'r', node_kind: 'risk', label: 'Supplier delay', base_graph_hash: BASE });
    expect(out.commitPerformed).toBe(false);
    expect(out.response.blocks).toEqual([expect.objectContaining({ error_code: 'FEATURE_NOT_ENABLED', details: { reason: 'core_kind_not_in_slice', retryable: false } })]);
    expect(out.response.assistant_text).toContain("haven't changed the model");
    expect(append).not.toHaveBeenCalled();
  });

  it('a gesture made on a model that has since moved is a conflict: refresh, nothing written', async () => {
    const out = await send({ kind: 'option_intervention_edit', option_id: 'push', factor_id: 'f', value: 0.8, base_graph_hash: 'f'.repeat(16) });
    expect(out.commitPerformed).toBe(false);
    expect(out.graphConflict).toMatchObject({ recovery_action: 'refresh_and_reconfirm' });
    expect(append).not.toHaveBeenCalled();
  });

  it('from outside the core lane, a gesture on a core scenario meets the one-write rule: nothing is written', async () => {
    const out = await send({ kind: 'option_intervention_edit', option_id: 'push', factor_id: 'f', value: 0.8, base_graph_hash: BASE }, false)
      .catch((err: unknown) => ({ thrown: String(err) }));
    expect(JSON.stringify(out)).not.toContain('"commitPerformed":true');
    expect(append).not.toHaveBeenCalled();
  });

  it('CONTROL: a scenario without a living model never takes the core path', async () => {
    loadGraph.mockResolvedValue(mapLivingModel(KNOWN_ANSWER).graph);
    const out = await send({ kind: 'structural_add', node_id: 'r', node_kind: 'risk', label: 'Supplier delay', base_graph_hash: BASE });
    expect(JSON.stringify(out.response)).not.toContain('core_kind_not_in_slice');
    if (append.mock.calls.length > 0) expect(written().living_model).toBeUndefined();
  });
});
