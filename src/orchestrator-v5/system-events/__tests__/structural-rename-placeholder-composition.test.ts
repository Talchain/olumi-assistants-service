/**
 * #1281 + #1273 composition: a generic decision-label marker must not survive
 * an authoritative user rename.
 *
 * This deliberately crosses the real semantic transitions rather than testing
 * a hand-built renamed node in isolation:
 *
 * records -> draft projector -> V1/V3 lift -> persisted GraphV3 read
 *         -> real structural_rename dispatcher -> commit projection/readback
 *         -> returned draft_graph + JSON reload.
 *
 * The store is the only mocked boundary. Its mock serialises the graph handed
 * to `commitDirectAnswer`, projects it exactly as the commit chokepoint does,
 * and returns those bytes as the commit receipt. The rename adapter and
 * dispatcher are production code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const mocks = vi.hoisted(() => ({
  loadPersistedGraphStrict: vi.fn(),
  loadMostRecentPendingActionsIntegrityStrict: vi.fn(),
  commitDirectAnswer: vi.fn(),
  committedGraphs: [] as unknown[],
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
  loadMostRecentPendingActionsIntegrityStrict:
    mocks.loadMostRecentPendingActionsIntegrityStrict,
}));

vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  commitDirectAnswer: mocks.commitDirectAnswer,
}));

import { projectRecordsToGraph } from '../../../cee/draft/records/projector.js';
import type { DraftRecordSet } from '../../../cee/draft/records/grammar.js';
import { projectGraphAndOptionsToV3 } from '../../../cee/transforms/schema-v3.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { dispatchSystemEvent } from '../dispatch.js';

const SCENARIO_ID = '11111111-1111-4111-8111-111111111111';
const TURN_ID = '22222222-2222-4222-8222-222222222222';

function jsonReload<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Build the same generic Question node #1281 now emits on a real draft. */
function persistedDraft(): GraphV3T {
  const brief = 'Our burn rate is too high and the team is stretched thin.';
  const records: DraftRecordSet = {
    stated_items: [
      { kind: 'goal', source_quote: 'Our burn rate is too high' },
      { kind: 'option', source_quote: 'cut contractor spend' },
      { kind: 'option', source_quote: 'slow down hiring' },
    ],
    claims: [{ claim_kind: 'outcome', label: 'Monthly Burn', basis: [0] }],
  };
  const v1 = projectRecordsToGraph(records, brief).graph;
  const projection = projectGraphAndOptionsToV3(v1, { brief });
  const graph = {
    ...projection.graph,
    goal_node_id: projection.goal_node_id,
    options: projection.options,
  };

  // Counterparts make over-broad cleanup observable. A derived label retains
  // its own authority; an unclassified legacy label is not promoted to one.
  graph.nodes.push(
    {
      id: 'derived_counterpart',
      kind: 'factor',
      label: 'Derived retention risk',
      provenance: 'ai_inferred',
      label_authored: true,
    },
    {
      id: 'unknown_counterpart',
      kind: 'factor',
      label: 'Legacy uncertainty',
    },
  );

  return GraphV3.parse(
    jsonReload(
      projectGraphForPersistence(graph, {
        scenarioId: SCENARIO_ID,
        turnId: 'draft-turn',
        turnClass: 'handler',
        source: 'draft_graph',
      }),
    ),
  );
}

function placeholderNode(graph: GraphV3T): Record<string, unknown> {
  const node = graph.nodes.find((candidate) => candidate.label_placeholder === true);
  if (node === undefined) throw new Error('real draft did not produce its placeholder node');
  return node as Record<string, unknown>;
}

function nodeById(graph: GraphV3T, id: string): Record<string, unknown> {
  const node = graph.nodes.find((candidate) => candidate.id === id);
  if (node === undefined) throw new Error(`node ${id} missing after reload`);
  return node as Record<string, unknown>;
}

async function rename(
  persistedGraph: GraphV3T,
  newLabel: string,
): Promise<Awaited<ReturnType<typeof dispatchSystemEvent>>> {
  const target = placeholderNode(persistedGraph);
  const baseGraphHash = computeAnalysisAffectingGraphHash(persistedGraph);
  if (baseGraphHash === null) throw new Error('persisted draft is not hashable');
  const payload = {
    kind: 'system_event',
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame',
    event: {
      kind: 'structural_rename',
      node_id: target.id,
      label: newLabel,
      expected_label: target.label,
      base_graph_hash: baseGraphHash,
    },
  } as unknown as SystemEventTurnPayload;
  return dispatchSystemEvent({ payload, requestId: 'req-placeholder-composition' });
}

describe('structural_rename placeholder authority composition', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.committedGraphs.length = 0;
    mocks.loadMostRecentPendingActionsIntegrityStrict.mockResolvedValue([]);
    mocks.commitDirectAnswer.mockImplementation(async (response: unknown, metadata: unknown) => {
      const meta = metadata as {
        graph: unknown;
        scenario_id: string;
        turn_id: string;
        turn_class: string;
      };
      const projected = projectGraphForPersistence(jsonReload(meta.graph), {
        scenarioId: meta.scenario_id,
        turnId: meta.turn_id,
        turnClass: meta.turn_class,
        source: 'commitDirectAnswer',
      });
      const stored = GraphV3.parse(jsonReload(projected));
      const hash = computeAnalysisAffectingGraphHash(stored);
      if (hash === null) throw new Error('committed graph is not hashable');
      mocks.committedGraphs.push(stored);
      return {
        response,
        performed: true,
        persisted_row_id: 'turn-row',
        graphPersisted: true,
        pendingLifecycle: {
          priorCount: 0,
          freshCount: 0,
          carriedCount: 0,
          droppedCount: 0,
        },
        persistedAnalysisGraphHash: hash,
        persistedGraph: stored,
      };
    });
  });

  it('clears a real draft placeholder before commit, returned graph and reload', async () => {
    const initial = persistedDraft();
    const targetBefore = placeholderNode(initial);
    expect(targetBefore).toMatchObject({
      kind: 'decision',
      label: 'Question',
      provenance: 'ai_inferred',
      label_placeholder: true,
    });
    mocks.loadPersistedGraphStrict.mockResolvedValue(initial);

    const result = await rename(initial, 'Should we reduce contractor spend?');

    expect(result.commitPerformed).toBe(true);
    expect(mocks.commitDirectAnswer).toHaveBeenCalledOnce();
    const reload = GraphV3.parse(jsonReload(mocks.committedGraphs[0]));
    const renamed = nodeById(reload, String(targetBefore.id));
    expect(renamed.label).toBe('Should we reduce contractor spend?');
    expect(renamed.provenance).toBe('user_set');
    expect('label_authored' in renamed).toBe(false);
    expect('label_placeholder' in renamed).toBe(false);

    const returnedNode = result.response.draft_graph?.nodes.find(
      (node) => (node as Record<string, unknown>).id === targetBefore.id,
    ) as Record<string, unknown> | undefined;
    expect(returnedNode?.label).toBe('Should we reduce contractor spend?');
    expect(returnedNode).not.toHaveProperty('label_placeholder');

    expect(nodeById(reload, 'derived_counterpart')).toMatchObject({
      provenance: 'ai_inferred',
      label_authored: true,
    });
    expect(nodeById(reload, 'unknown_counterpart')).not.toHaveProperty('provenance');
    expect(nodeById(reload, 'unknown_counterpart')).not.toHaveProperty('label_placeholder');
  });

  it('treats a literal user-authored Question as authored, never as placeholder', async () => {
    const defectivePrior = persistedDraft();
    const targetBefore = placeholderNode(defectivePrior);
    // Reachable migration state from the deployed composition defect: a prior
    // rename changed the label/provenance but left the top-level marker stale.
    targetBefore.label = 'Temporary user title';
    targetBefore.provenance = 'user_set';
    expect(targetBefore.label_placeholder).toBe(true);
    mocks.loadPersistedGraphStrict.mockResolvedValue(defectivePrior);

    const result = await rename(defectivePrior, 'Question');

    expect(result.commitPerformed).toBe(true);
    const reload = GraphV3.parse(jsonReload(mocks.committedGraphs[0]));
    const renamed = nodeById(reload, String(targetBefore.id));
    expect(renamed.label).toBe('Question');
    expect(renamed.provenance).toBe('user_set');
    expect('label_authored' in renamed).toBe(false);
    expect('label_placeholder' in renamed).toBe(false);

    const returnedNode = result.response.draft_graph?.nodes.find(
      (node) => (node as Record<string, unknown>).id === targetBefore.id,
    ) as Record<string, unknown> | undefined;
    expect(returnedNode).toMatchObject({ label: 'Question', provenance: 'user_set' });
    expect(returnedNode).not.toHaveProperty('label_placeholder');
  });
});
