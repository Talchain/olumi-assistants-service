/**
 * FIX-r1 item 1. RED rows were added before changing the writer code at
 * 8fb1959217ed31484eb66aef67a1220f805f012b; execution is left to the author.
 * At that head add stripping does not touch update_node, off/shadow skip the
 * governing referee, and the replacement apply port has no stamp screen.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { LLMAdapter } from '../../../adapters/llm/types.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { ConversationContext, PatchOperation } from '../../../orchestrator/types.js';
import { validateGraphStructure } from '../../../orchestrator/graph-structure-validator.js';
import { _resetConfigCache } from '../../../config/index.js';
import { buildReadyGraph } from '../../graph-management/__tests__/fixtures.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import type { CommitMetadata } from '../../commit.js';
import { createApplyOperations, modelRevisionOf, type ApplyOperationsStore } from '../../apply-operations.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

const { persisted } = vi.hoisted(() => ({ persisted: { graph: null as unknown } }));
vi.mock('../../../orchestrator/tools/edit-graph.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../orchestrator/tools/edit-graph.js')>()),
  handleEditGraph: vi.fn(),
}));
vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:rc3-stamp'),
}));
vi.mock('../../../adapters/llm/router.js', () => ({ getAdapter: vi.fn().mockReturnValue({ name: 'mock' }) }));
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  // B-FIX1: the combined read follows the existing graph double.
  loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
  loadPersistedGraphStrict: vi.fn(async () => persisted.graph),
  loadMostRecentPendingActions: vi.fn(async () => []),
  buildTurnContext: vi.fn(async () => ({ prior_facts: [], prior_turns: [], most_recent_pending_actions: [] })),
}));
vi.mock('../../../adapters/llm/prompt-loader.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../adapters/llm/prompt-loader.js')>()),
  getSystemPromptSnapshot: vi.fn().mockResolvedValue({ content: 'Edit the model.', meta: { source: 'default', prompt_version: 'v2' } }),
}));

import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { dispatchEditGraph, mergeAppliedGraphForPersistence } from '../edit-graph-dispatch.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const TURN = '22222222-2222-4222-8222-222222222222';
const RISK = 'risk_feature_release_slips';
const STAMP = { option_id: 'o-a' };
const risk = { id: RISK, kind: 'risk' as const, label: 'Feature release slips' };
function orphanGraph() {
  const ready = buildReadyGraph();
  return GraphV3.parse({ ...ready, nodes: [...ready.nodes, risk] });
}
const genericWrites: Array<[string, PatchOperation]> = [
  ['whole', { op: 'update_node', path: RISK, value: { relies_on: STAMP, label: 'Feature release slips (reviewed)' } }],
  ['slash', { op: 'update_node', path: RISK, value: { 'relies_on/option_id': STAMP.option_id } }],
  ['dot', { op: 'update_node', path: RISK, value: { 'relies_on.option_id': STAMP.option_id } }],
  ['nested-merge', { op: 'update_node', path: RISK, value: { observed_state: { value: 0.5, relies_on: STAMP } } }],
];
function setMode(mode: string) {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', mode);
  _resetConfigCache();
}
function expectUnstampedOrphan(graph: unknown) {
  const parsed = GraphV3.parse(graph);
  expect(parsed.nodes.find(n => n.id === RISK)).not.toHaveProperty('relies_on');
  expect(validateGraphStructure(parsed).violations.some(v =>
    (v.code === 'ORPHAN_NODE' || v.code === 'NO_PATH_TO_GOAL') && v.detail.includes(RISK))).toBe(true);
  expect(resolveRunAdmission(parsed).willProceed).toBe(false);
}
beforeEach(() => {
  vi.clearAllMocks();
  persisted.graph = orphanGraph();
  vi.mocked(commitDirectAnswer).mockImplementation(async (response, metadata) => {
    if (metadata.graph !== undefined) persisted.graph = metadata.graph;
    return { response, performed: true, persisted_row_id: 'rc3-row', modelVersionReceipt: null,
      graphPersisted: metadata.graph !== undefined } as never;
  });
});
afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

describe('rc3-generic-stamp-ownership', () => {
  it.each(['off', 'shadow', 'live'])('rc3-update-stamp-%s: dispatch refuses the forged stamp; stored orphan still blocks readiness', async (mode) => {
    setMode(mode);
    const before = orphanGraph();
    vi.mocked(handleEditGraph).mockResolvedValue({
      blocks: [], assistantText: 'Updated the risk.', latencyMs: 0, wasRejected: false,
      operations: [genericWrites[0]![1]],
      appliedGraph: GraphV3.parse({ ...before, nodes: before.nodes.map(n => n.id === RISK ? { ...n, relies_on: STAMP } : n) }),
      appliedChanges: { summary: 'Updated the risk.', changes: [{ label: risk.label, description: 'Updated.', element_ref: RISK }], rerun_recommended: false },
    });
    const result = await dispatchEditGraph({
      payload: { kind: 'message', scenario_id: SCENARIO, turn_id: TURN, stage: 'analyse', message: 'Rename Feature release slips to Feature release slips reviewed', turn_class: 'frame', source: 'composer' },
      requestId: 'rc3-stamp-dispatch', request: {} as FastifyRequest,
      graphState: before as GraphStateIngress, analysisState: null,
    });
    expect(result.graph).toBeNull();
    expect(vi.mocked(commitDirectAnswer).mock.calls.at(-1)?.[1].graph).toBeUndefined();
    expectUnstampedOrphan(persisted.graph);
  });

  it.each(genericWrites)('rc3-local-fallback-%s: the real edit handler refuses every update spelling before local apply', async (_name, operation) => {
    const actual = await vi.importActual<typeof import('../../../orchestrator/tools/edit-graph.js')>('../../../orchestrator/tools/edit-graph.js');
    const before = orphanGraph();
    const context = { graph: before, messages: [], scenario_id: SCENARIO, framing: { stage: 'evaluate' }, analysis_response: null } as ConversationContext;
    const chat = vi.fn(() => { throw new Error('pre-composed operations must not call the model'); });
    const result = await actual.handleEditGraph(context, 'Rename Feature release slips', { name: 'mock', model: 'mock', chat } as unknown as LLMAdapter,
      'rc3-local', TURN, { preComposedOperations: [operation] });
    expect(chat).not.toHaveBeenCalled();
    expect(result.wasRejected).toBe(true);
    expect(result.appliedGraph).toBeNull();
    expectUnstampedOrphan(before);
  });

  it.each(['whole', 'pointer', 'nested-merge', 'add'])('rc3-apply-port-%s: generic consent cannot author the server stamp', async (variant) => {
    const before = orphanGraph();
    const operation = variant === 'pointer'
      ? { op: 'update_node', path: `/nodes/${RISK}/relies_on/option_id`, value: STAMP.option_id }
      : variant === 'nested-merge' ? genericWrites[3]![1]
      : variant === 'add' ? { op: 'add_node', path: 'risk_fake', value: { id: 'risk_fake', kind: 'risk', label: 'Fake precondition', relies_on: STAMP } }
      : genericWrites[0]![1];
    const store = { loadGraph: vi.fn(async () => persisted.graph), readRecent: vi.fn(async () => [{
      id: 'rc3-row', scenario_id: SCENARIO, turn_id: TURN,
      request_hash: (vi.mocked(commitDirectAnswer).mock.calls.at(-1)?.[1] as CommitMetadata | undefined)?.request_hash,
    }]) } as unknown as ApplyOperationsStore;
    const outcome = await createApplyOperations({ scenarioId: SCENARIO, requestId: 'rc3-port', store })({
      proposalId: 'rc3-proposal', idempotencyKey: TURN, modelRevision: modelRevisionOf(before)!,
      operations: [{ kind: 'edit_graph', summary: 'Update the risk', detail: { operations: [operation] } }],
    });
    expect(outcome.ok).toBe(false);
    expect(commitDirectAnswer).not.toHaveBeenCalled();
    expectUnstampedOrphan(persisted.graph);
  });

  it('rc3-merge-stamp: persistence merge cannot introduce a stamp absent from the stored node', () => {
    const before = orphanGraph();
    const appliedGraph = GraphV3.parse({ ...before, nodes: before.nodes.map(n => n.id === RISK ? { ...n, relies_on: STAMP } : n) });
    expect(() => mergeAppliedGraphForPersistence({ appliedGraph, persistedBase: before,
      ingressBase: before as GraphStateIngress, scenarioId: SCENARIO, requestId: 'rc3-merge' })).toThrow(/precondition/i);
    expectUnstampedOrphan(before);
  });

  it('rc3-merge-stamp-control: an unrelated generic edit preserves an existing server stamp', () => {
    const before = orphanGraph();
    const stamped = GraphV3.parse({ ...before, nodes: before.nodes.map(n => n.id === RISK ? { ...n, relies_on: STAMP } : n) });
    const appliedGraph = GraphV3.parse({ ...stamped, nodes: stamped.nodes.map(n => n.id === RISK ? { ...n, label: 'Release timing risk' } : n) });
    const merged = mergeAppliedGraphForPersistence({ appliedGraph, persistedBase: stamped,
      ingressBase: stamped as GraphStateIngress, scenarioId: SCENARIO, requestId: 'rc3-merge-control' });
    expect(GraphV3.parse(merged).nodes.find(n => n.id === RISK)?.relies_on).toEqual(STAMP);
  });
});
