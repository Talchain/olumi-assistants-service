
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
import { validateGraphStructure, contextNodeIds } from '../../../orchestrator/graph-structure-validator.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { buildReadyGraph } from '../../graph-management/__tests__/fixtures.js';

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
import { commitDirectAnswer } from '../../commit.js';
import { mergeAppliedGraphForPersistence } from '../edit-graph-dispatch.js';

const SCENARIO = '11111111-1111-4111-8111-111111111111';
const RISK = 'risk_feature_release_slips';
const STAMP = { option_id: 'o-a' };
const risk = { id: RISK, kind: 'risk' as const, label: 'Feature release slips' };
function orphanGraph() {
  const ready = buildReadyGraph();
  return GraphV3.parse({ ...ready, nodes: [...ready.nodes, risk] });
}
function expectUnstampedOrphan(graph: unknown) {
  const parsed = GraphV3.parse(graph);
  expect(parsed.nodes.find(n => n.id === RISK)).not.toHaveProperty('relies_on');
  expect(validateGraphStructure(parsed).violations.some(v =>
    (v.code === 'ORPHAN_NODE' || v.code === 'NO_PATH_TO_GOAL') && v.detail.includes(RISK))).toBe(true);
  // ⭐ DL ruling 21 Oct (structure class): unstamped, it is context (never a block), never a left-out precondition.
  expect(contextNodeIds(parsed as never).has(RISK)).toBe(true);
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
