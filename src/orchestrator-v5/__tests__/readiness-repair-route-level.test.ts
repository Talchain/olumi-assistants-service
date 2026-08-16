import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import type { PendingAction } from '../session/pending-action.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { computeGraphIdentityHash } from '../context/graph-identity.js';
import { assessCanonicalAnalysisReadiness } from '../../orchestrator/tools/analysis-ready-helper.js';
import { buildReadinessRepairOffer } from '../handlers/readiness-repair-proposal.js';
import { _resetConfigCache } from '../../config/index.js';

const SCENARIO_ID = randomUUID();
type Dict = Record<string, unknown>;

function edge(from: string, to: string): Dict {
  return {
    from,
    to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 1,
    effect_direction: 'positive',
  };
}

const GRAPH: Dict = {
  goal_node_id: 'goal_1',
  nodes: [
    { id: 'goal_1', kind: 'goal', label: 'Grow responsibly' },
    {
      id: 'fac_cost',
      kind: 'factor',
      label: 'Annual cost',
      category: 'controllable',
      observed_state: { value: 0.4, unit: '£', cap: 100 },
    },
    { id: 'fac_capacity', kind: 'factor', label: 'Delivery capacity', category: 'controllable' },
    {
      id: 'opt_a',
      kind: 'option',
      label: 'Option A',
      data: { interventions: { fac_cost: { raw_value: 40, unit: '£' } } },
    },
    {
      id: 'opt_b',
      kind: 'option',
      label: 'Option B',
      'data/interventions/fac_cost': { raw_value: 60, unit: '£' },
    },
  ],
  edges: [
    edge('opt_a', 'fac_cost'),
    edge('opt_b', 'fac_cost'),
    edge('fac_cost', 'goal_1'),
    edge('fac_capacity', 'goal_1'),
  ],
};

const PARSED_GRAPH = GraphStateIngressSchema.parse(GRAPH);
const HASH = computeAnalysisAffectingGraphHash(PARSED_GRAPH);
if (HASH === null) throw new Error('readiness fixture must have an analysis hash');
const IDENTITY_HASH = computeGraphIdentityHash(PARSED_GRAPH);
if (IDENTITY_HASH === null) throw new Error('readiness fixture must have an identity hash');
const ASSESSMENT = assessCanonicalAnalysisReadiness(GRAPH);
const OFFER = buildReadinessRepairOffer({
  assessment: ASSESSMENT,
  currentGraphHash: HASH,
  scenarioId: SCENARIO_ID,
})!;
const PROPOSAL = ASSESSMENT.repairProposal;
if (PROPOSAL === null) throw new Error('readiness fixture must have a repair proposal');

const UNKNOWN_KEY_MUTANTS = [
  {
    location: 'root',
    proposal: { ...PROPOSAL, unexpected_root: true },
  },
  {
    location: 'change',
    proposal: {
      ...PROPOSAL,
      changes: PROPOSAL.changes.map((change, index) => index === 0
        ? { ...change, unexpected_nested: true }
        : change),
    },
  },
  {
    location: 'unresolved input',
    proposal: {
      ...PROPOSAL,
      unresolved_inputs: PROPOSAL.unresolved_inputs.map((input, index) => index === 0
        ? { ...input, unexpected_input: true }
        : input),
    },
  },
];

const canonicalReadinessControl = vi.hoisted(() => ({
  unavailableBeforeGraphAppend: false,
  graphAppendOccurred: false,
}));

vi.mock('../../orchestrator/tools/analysis-ready-helper.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../orchestrator/tools/analysis-ready-helper.js')
  >();
  return {
    ...actual,
    buildCanonicalAnalysisReadyFromGraph: vi.fn((graph: unknown) =>
      canonicalReadinessControl.unavailableBeforeGraphAppend &&
      !canonicalReadinessControl.graphAppendOccurred
        ? undefined
        : actual.buildCanonicalAnalysisReadyFromGraph(graph),
    ),
  };
});

let pendingActionsForRead: readonly PendingAction[] = [OFFER.pending];
const appendCalls: Array<Record<string, unknown>> = [];

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: Record<string, unknown>) => {
      appendCalls.push(write);
      if (write.graph != null) canonicalReadinessControl.graphAppendOccurred = true;
      return {
        id: `row-${appendCalls.length}`,
        ...(write.graph != null
          ? { graph_write_disposition: 'accepted_insert' as const }
          : {}),
      };
    },
    readRecent: async () => [],
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => GRAPH,
    loadGraphAndBriefText: async () => ({ graph: GRAPH, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => pendingActionsForRead,
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message: 'yes',
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function throwingRoutingAdapter() {
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockImplementation(async () => {
        throw new Error('readiness confirmation must not call the routing model');
      }),
  };
}

beforeEach(() => {
  vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'observe');
  _resetConfigCache();
  appendCalls.length = 0;
  pendingActionsForRead = [OFFER.pending];
  canonicalReadinessControl.unavailableBeforeGraphAppend = false;
  canonicalReadinessControl.graphAppendOccurred = false;
});

afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('readiness multi-repair through TurnExecutor', () => {
  it('confirmation commits one canonical graph with a receipt and readback', async () => {
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload(), 'req-readiness-repair', {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(appendCalls).toHaveLength(1);
    const write = appendCalls[0]!;
    expect(write.graph).toBeDefined();
    expect(write.expectedGraphIdentityHash).toBe(IDENTITY_HASH.value);
    expect(write.expectedGraphAnalysisHash).toBe(HASH);
    expect((write.handler_facts as Array<{ fact_type?: string }>)[0]?.fact_type).toBe('edit_graph');
    expect(write.pending_actions).toEqual([]);
    const written = write.graph as Dict;
    const optionA = (written.nodes as Dict[]).find((node) => node.id === 'opt_a')!;
    const optionB = (written.nodes as Dict[]).find((node) => node.id === 'opt_b')!;
    expect((optionA.interventions as Dict).fac_cost).toMatchObject({ value: 0.4 });
    expect((optionB.interventions as Dict).fac_cost).toMatchObject({ value: 0.6 });
    expect((optionA.data as Dict | undefined)?.interventions).toBeUndefined();
    expect(result.response.draft_graph).toBeDefined();
    expect(result.analysisReady?.status).toBe('blocked');
    expect(result.response.assistant_text).toContain('did not invent');
  });

  it('fails closed before append when canonical readiness is unavailable', async () => {
    canonicalReadinessControl.unavailableBeforeGraphAppend = true;
    const result = await runTurnExecutor(payload(), 'req-readiness-repair-status-unavailable', {
      routingAdapter: throwingRoutingAdapter(),
    });

    expect(appendCalls.some((write) => write.graph != null)).toBe(false);
    expect(result.telemetry.commit_performed).toBe(false);
    expect(result.response.draft_graph).toBeUndefined();
    expect(result.response.graph_hash).toBeUndefined();
    const errorBlock = (
      result.response.blocks as Array<{ type: string; error_code?: string }>
    ).find((block) => block.type === 'error');
    expect(errorBlock?.error_code).toBe('INTERNAL_ERROR');
  });

  it('a stale pin regenerates a proposal but performs zero graph writes', async () => {
    pendingActionsForRead = [{
      ...OFFER.pending,
      preconditions: { graph_hash: 'stale_hash' },
    }];
    const adapter = throwingRoutingAdapter();
    const result = await runTurnExecutor(payload(), 'req-readiness-stale', {
      routingAdapter: adapter,
    });
    expect(adapter.chatWithTools).not.toHaveBeenCalled();
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
    expect((appendCalls[0]!.pending_actions as PendingAction[])).toHaveLength(1);
    expect(result.response.assistant_text).toContain('regenerated');
  });

  it('a proposal missing one unresolved input is rejected and regenerated without graph mutation', async () => {
    const action = OFFER.pending.action;
    if (action.kind !== 'apply_proposed_change') throw new Error('fixture');
    const inline = action.inline_patch as Dict;
    const proposal = inline.proposal as Dict;
    pendingActionsForRead = [{
      ...OFFER.pending,
      action: {
        ...action,
        inline_patch: {
          ...inline,
          proposal: {
            ...proposal,
            unresolved_inputs: (proposal.unresolved_inputs as unknown[]).slice(1),
          },
        },
      },
    }];
    await runTurnExecutor(payload(), 'req-readiness-mutant', {
      routingAdapter: throwingRoutingAdapter(),
    });
    expect(appendCalls).toHaveLength(1);
    expect(appendCalls[0]!.graph).toBeUndefined();
    expect((appendCalls[0]!.pending_actions as PendingAction[])).toHaveLength(1);
  });

  it.each(UNKNOWN_KEY_MUTANTS)(
    'a proposal with an unknown $location key is rejected before execution with zero graph writes',
    async ({ proposal }) => {
      const action = OFFER.pending.action;
      if (action.kind !== 'apply_proposed_change') throw new Error('fixture');
      pendingActionsForRead = [{
        ...OFFER.pending,
        action: {
          ...action,
          inline_patch: {
            ...action.inline_patch,
            proposal,
          },
        },
      }];

      const result = await runTurnExecutor(payload(), `req-readiness-unknown-${randomUUID()}`, {
        routingAdapter: throwingRoutingAdapter(),
      });

      expect(appendCalls).toHaveLength(1);
      expect(appendCalls[0]!.graph).toBeUndefined();
      expect((appendCalls[0]!.pending_actions as PendingAction[])).toHaveLength(1);
      expect(result.response.assistant_text).toContain('regenerated');
    },
  );
});
