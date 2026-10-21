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
import { commitDirectAnswer } from '../../commit.js';

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

  it('⭐ Track 3 Q2-02: today\'s level set on the goal, with its unit, is written once, moves the analysed hash, and reopens equal', async () => {
    const out = await send({ kind: 'factor_value_edit', target_id: 'g', value: 0.6, raw_value: 75, unit: 'units', base_graph_hash: BASE });
    expect(out.commitPerformed, JSON.stringify(out.response)).toBe(true);
    expect(append).toHaveBeenCalledTimes(1);
    const saved = written();
    expect((saved.living_model as typeof KNOWN_ANSWER).aims[0]!.target).toMatchObject({ current: 75, current_source: 'user', current_unit: null, unit: 'units' });
    expect(out.response.graph_hash, 'the level reaches the engine graph, so the analysed hash moves').not.toBe(BASE.slice(0, (out.response.graph_hash as string).length));
    // Cold reopen: the graph regenerated from the saved living model is the graph that was committed.
    expect(mapLivingModel(saved.living_model as typeof KNOWN_ANSWER).graph.nodes).toEqual(saved.nodes);
  });

  it('⭐ Track 3 Q2-02 shape through the door: a goal with no target unit keeps the level\'s "%" (Codex note on #3570)', async () => {
    const lm: typeof KNOWN_ANSWER = structuredClone(KNOWN_ANSWER);
    lm.aims[0]!.target = { ...lm.aims[0]!.target!, unit: null, current: null, current_unit: null };
    const graph: Rec = { ...mapLivingModel(lm).graph, living_model: lm };
    loadGraph.mockResolvedValue(graph);
    const out = await send({ kind: 'factor_value_edit', target_id: 'g', value: 0.3, raw_value: 30, unit: '%',
      base_graph_hash: computeExpectedGraphCasHashes(graph).expectedGraphAnalysisHash! });
    expect(out.commitPerformed, JSON.stringify(out.response)).toBe(true);
    expect((written().living_model as typeof KNOWN_ANSWER).aims[0]!.target).toMatchObject({ current: 30, current_source: 'user', current_unit: '%' });
  });

  it('a gesture this slice cannot apply is refused, said plainly, and nothing is written', async () => {
    const out = await send({ kind: 'structural_add', node_id: 'o', node_kind: 'outcome', label: 'Churn', base_graph_hash: BASE });
    expect(out.commitPerformed).toBe(false);
    expect(out.response.blocks).toEqual([expect.objectContaining({ error_code: 'FEATURE_NOT_ENABLED', details: { reason: 'core_kind_not_in_slice', retryable: false } })]);
    expect(out.response.assistant_text).toContain("haven't changed the model");
    expect(append).not.toHaveBeenCalled();
  });

  // ⭐ Codex r5 on #3522 (A1): a range the canvas sets, and a risk added, renamed or deleted, were refused on core. Each now
  // changes the living model through the same one-write door, in the person's name.
  it('⭐ a range the person sets is the factor\'s own low and high (a range, not a figure), theirs, written once', async () => {
    const out = await send({ kind: 'prior_range_edit', target_id: 'f', range_min: 0.2, range_max: 0.8, distribution: 'uniform', base_graph_hash: BASE });
    expect(out.commitPerformed, JSON.stringify(out.response)).toBe(true);
    expect(append).toHaveBeenCalledTimes(1);
    expect((written().living_model as typeof KNOWN_ANSWER).factors.find((f) => f.id === 'f')).toMatchObject({ value: null, low: 0.2, high: 0.8, source: 'user', quote: null });
  });

  it('NEGATIVE: an inverted range, another distribution, or an item that is not a factor changes nothing', async () => {
    for (const [event, reason] of [
      [{ kind: 'prior_range_edit', target_id: 'f', range_min: 0.8, range_max: 0.2 }, 'core_range_inverted'],
      [{ kind: 'prior_range_edit', target_id: 'f', range_min: 0.2, range_max: 0.8, distribution: 'normal' }, 'core_distribution_not_in_slice'],
      [{ kind: 'prior_range_edit', target_id: 'g', range_min: 0.2, range_max: 0.8 }, 'core_not_in_model'],
    ] as const) {
      const out = await send({ ...event, base_graph_hash: BASE });
      expect(out.response.blocks, reason).toEqual([expect.objectContaining({ details: { reason, retryable: false } })]);
    }
    expect(append).not.toHaveBeenCalled();
  });

  it('⭐ an option taken out of the comparison stays in the model and on the board, theirs as before; out → removed moves no hash but is written', async () => {
    const out = await send({ kind: 'option_status_edit', option_node_id: 'push', expected_status: 'feasible', status: 'infeasible', base_graph_hash: BASE });
    expect(out.commitPerformed, JSON.stringify(out.response)).toBe(true);
    expect(append).toHaveBeenCalledTimes(1);
    const excluded = written();
    expect((excluded.living_model as typeof KNOWN_ANSWER).options.find((o) => o.id === 'push')).toMatchObject({ status: 'infeasible', source: 'user', quote: 'push f to 1' });
    expect((excluded.nodes as Rec[]).find((n) => n.id === 'push')).toMatchObject({ option_status: 'infeasible', analysis_participation: 'retained_excluded' });
    const base = computeExpectedGraphCasHashes(excluded).expectedGraphAnalysisHash!;
    expect(base).not.toBe(BASE);
    loadGraph.mockResolvedValue(excluded);
    append.mockClear();
    const removed = await send({ kind: 'option_status_edit', option_node_id: 'push', expected_status: 'infeasible', status: 'removed', base_graph_hash: base });
    expect(removed.commitPerformed, JSON.stringify(removed.response)).toBe(true);
    expect((written().living_model as typeof KNOWN_ANSWER).options.find((o) => o.id === 'push')!.status).toBe('removed');
    expect(computeExpectedGraphCasHashes(written()).expectedGraphAnalysisHash).toBe(base);
  });

  it('NEGATIVE: a status that moved since it was read, a status it already has, or an item that is not an option changes nothing', async () => {
    for (const [event, reason] of [
      [{ option_node_id: 'push', expected_status: 'infeasible', status: 'removed' }, 'core_status_moved'],
      [{ option_node_id: 'push', expected_status: 'feasible', status: 'feasible' }, 'core_no_change'],
      [{ option_node_id: 'f', expected_status: 'feasible', status: 'infeasible' }, 'core_not_in_model'],
    ] as const) {
      const out = await send({ kind: 'option_status_edit', ...event, base_graph_hash: BASE });
      expect(out.response.blocks, reason).toEqual([expect.objectContaining({ details: { reason, retryable: false } })]);
    }
    expect(append).not.toHaveBeenCalled();
  });

  it('⭐ a risk is added (no chance yet, never guessed), renamed and deleted like a factor, each written once', async () => {
    const added = await send({ kind: 'structural_add', node_id: 'r', node_kind: 'risk', label: 'Supplier delay', base_graph_hash: BASE });
    expect(added.commitPerformed, JSON.stringify(added.response)).toBe(true);
    const withRisk = written();
    expect((withRisk.living_model as typeof KNOWN_ANSWER).risks).toEqual([{ id: 'r', label: 'Supplier delay', occurrence: { low: null, high: null },
      horizon_months: null, mitigations: [], source: 'user', party: null, quote: null }]);
    loadGraph.mockResolvedValue(withRisk);
    const base = computeExpectedGraphCasHashes(withRisk).expectedGraphAnalysisHash!;
    append.mockClear();
    const renamed = await send({ kind: 'structural_rename', node_id: 'r', label: 'Key supplier fails', expected_label: 'Supplier delay', base_graph_hash: base });
    expect(renamed.commitPerformed, JSON.stringify(renamed.response)).toBe(true);
    expect((written().living_model as typeof KNOWN_ANSWER).risks[0]!.label).toBe('Key supplier fails');
    append.mockClear();
    const deleted = await send({ kind: 'structural_delete', removed_node_ids: ['r'], removed_edges: [], base_graph_hash: base });
    expect(deleted.commitPerformed, JSON.stringify(deleted.response)).toBe(true);
    expect((written().living_model as typeof KNOWN_ANSWER).risks).toEqual([]);
  });

  // A delete of an edge Olumi draws from no stored link (here the option's setting) was acknowledged and committed, then the
  // edge was redrawn on regeneration: a false "saved". It is refused by name, and nothing is written.
  it('deleting an edge Olumi draws from no stored link is refused by name, and nothing is written', async () => {
    const out = await send({ kind: 'structural_delete', removed_node_ids: [], removed_edges: [{ from: 'push', to: 'f' }], base_graph_hash: BASE });
    expect(out.commitPerformed).toBe(false);
    expect(out.response.blocks).toEqual([expect.objectContaining({ details: { reason: 'core_link_is_generated', retryable: false } })]);
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
    const out = await send({ kind: 'structural_add', node_id: 'o', node_kind: 'outcome', label: 'Churn', base_graph_hash: BASE });
    expect(JSON.stringify(out.response)).not.toContain('core_kind_not_in_slice');
    if (append.mock.calls.length > 0) expect(written().living_model).toBeUndefined();
  });

  it('Buddy R1: a legacy replacement with no caller baseline still meets the one-write rule (the commit\'s own stored read)', async () => {
    const legacy = mapLivingModel(KNOWN_ANSWER).graph;
    const err = await commitDirectAnswer({ response_version: 2, assistant_text: '', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'evaluate' } as never, {
      scenario_id: SCENARIO, turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', turn_class: 'direct_answer', handler_id: null, request_hash: 'h',
      llm_calls_used: 0, duration_ms: 0, handler_facts: [], graph: legacy,
    } as never, withScenarioRevision(store) as never).then(() => null, (e: unknown) => e);
    expect(String((err as { message?: unknown } | null)?.message)).toContain('CORE_SCENARIO_LEGACY_WRITE');
    expect(append).not.toHaveBeenCalled();
  });

  it('Buddy R1: when that stored read fails, the write is unclassified and refused, never written as legacy', async () => {
    loadGraph.mockRejectedValue(new Error('db blip'));
    const err = await commitDirectAnswer({ response_version: 2, assistant_text: '', blocks: [], suggested_actions: [], insights: [], stage_indicator: 'evaluate' } as never, {
      scenario_id: SCENARIO, turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', turn_class: 'direct_answer', handler_id: null, request_hash: 'h',
      llm_calls_used: 0, duration_ms: 0, handler_facts: [], graph: mapLivingModel(KNOWN_ANSWER).graph,
    } as never, withScenarioRevision(store) as never).then(() => null, (e: unknown) => e);
    expect((err as { name?: unknown } | null)?.name).toBe('StateCommitFailedError');
    expect(append).not.toHaveBeenCalled();
  });
});
