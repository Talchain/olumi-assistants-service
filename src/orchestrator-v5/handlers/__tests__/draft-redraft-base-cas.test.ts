import { beforeEach as beforeEachRevisionScope } from 'vitest';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';

// Pin the retained legacy RPC contract; CAS-ON equivalents live in the v6/door suites.
beforeEachRevisionScope(() => __setUseAppendV6ForTest(false));

/**
 * S1-A: real draft dispatch → commitDirectAnswer → appendCheckedGraphWrite.
 * Only provider/storage ports are replaced. The append fake implements the
 * persisted identity CAS contract (including absence, legacy and same-state
 * exemptions); it does not invent a rejection independent of the write.
 * RED at 54afd737b: moved-base row's rejects assertion resolves instead,
 * because expectedGraphIdentityHash is undefined and append replaces the graph.
 * Vitest execution is deliberately left to the delivery lead.
 */
import { BoundaryErrorSchema } from '@talchain/schemas/boundary';
import Fastify from 'fastify';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import type { DraftGraphResult } from "../../../orchestrator/types.js";
import type { SessionStore,SessionTurnWrite } from '../../session/store.js';

const ports = vi.hoisted(() => ({ draft: vi.fn(), store: vi.fn() }));

vi.mock('../../session/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../session/index.js')>(),
  getSessionStore: ports.store,
}));
vi.mock('../../rolling-summary/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../rolling-summary/index.js')>(),
  getRollingSummaryStore: () => { throw new Error('Summary storage isolated'); },
}));
// The heuristic draft path needs no routing provider. Fail any accidental call
// at the provider boundary rather than allowing a live request.
vi.mock('../../../adapters/llm/router.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../adapters/llm/router.js')>(),
  getAdapter: () => { throw new Error('Unexpected routing provider call'); },
  getAdapterWithResolution: () => { throw new Error('Unexpected routing provider call'); },
}));

import { _resetConfigCache } from '../../../config/index.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { computeExpectedGraphCasHashes } from '../../context/graph-cas-conflict.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';
import { GraphStaleWriteError } from '../../session/store.js';

import { ceeOrchestratorRouteV2 } from '../../../orchestrator/route-v2.js';
import scenarioGraphRoute from '../../../routes/assist.v1.scenario-graph.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';

const SCENARIO = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const PAYLOAD = makeMessagePayload({
  scenario_id: SCENARIO,
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  stage: 'frame',
  message: 'Should we raise the Pro price from £49 to £59 or hold it at £49? We want to grow recurring revenue over the next year while keeping retention high.',
});
const BASE: NonNullable<DraftGraphResult['graphOutput']> = {
  nodes: [
    { id: 'fac_price', kind: 'factor', label: 'Monthly price', observed_state: { value: 0.49 } },
    { id: 'goal_mrr', kind: 'goal', label: 'Recurring revenue' },
  ],
  edges: [{ from: 'fac_price', to: 'goal_mrr', strength: { mean: 0.5, std: 0.1 },
    effect_direction: 'positive', exists_probability: 1 }],
};
type Graph = typeof BASE;
const USER_MODEL: Graph = {
  ...structuredClone(BASE),
  nodes: BASE.nodes.map(n => n.id === 'fac_price' ? { ...n, observed_state: { value: 0.77 } } : { ...n }),
};
const DRAFT: Graph = {
  ...structuredClone(BASE),
  nodes: BASE.nodes.map(n => n.id === 'fac_price' ? { ...n, observed_state: { value: 0.59 } } : { ...n }),
};
function identity(graph: unknown) {
  return computeExpectedGraphCasHashes(graph).expectedGraphIdentityHash;
}

function harness(initial: Graph | null, duringDraft: (h: Harness) => void = () => {}) {
  const h = {
    persisted: structuredClone(initial) as unknown,
    brief: null as string | null,
    attempts: [] as SessionTurnWrite[],
    committed: [] as SessionTurnWrite[],
    order: [] as string[],
    readFailure: null as Error | null,
    appendFailure: null as Error | null,
  };
  const store: SessionStore = {
    ...createNoopSessionStore(),
    hasPriorTurns: async () => false,
    hasOtherAdmittedLiveTurn: async () => false,
    scenarioDraftLossStands: async () => false,
    markGraphWriteFailed: async () => undefined,
    loadGraph: async () => structuredClone(h.persisted),
    async loadGraphAndBriefText() {
      h.order.push('read');
      if (h.readFailure) throw h.readFailure;
      return { graph: structuredClone(h.persisted), briefText: h.brief };
    },
    async readExistingScenario() {
      return { userId: null, graph: structuredClone(h.persisted), briefText: h.brief, analysisInvalidatedAt: null };
    },
    async append(write) {
      h.order.push('append');
      h.attempts.push(structuredClone(write));
      if (h.appendFailure) throw h.appendFailure;
      const current = identity(h.persisted);
      const incoming = identity(write.graph);
      const expected = write.expectedGraphIdentityHash;
      // Same compare/exemptions as the atomic append SQL, at storage only.
      if (write.graph !== undefined && expected !== undefined && expected !== current
        && incoming !== current && !(current === null && expected !== null)) {
        throw new GraphStaleWriteError('Atomic append refused a moved base', {
          conflict_category: 'rpc_cas_conflict', expected_base_graph_hash: expected ?? undefined,
        });
      }
      if (write.graph !== undefined) h.persisted = structuredClone(write.graph);
      if (write.briefText !== undefined) h.brief = write.briefText;
      h.committed.push(structuredClone(write));
      return { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    },
  };
  ports.store.mockReturnValue(store);
  ports.draft.mockImplementation(async () => {
    h.order.push('draft');
    duringDraft(h);
    return {
      blocks: [], assistantText: 'Draft output available.', latencyMs: 1,
      strengthenItems: [], coachingSummary: null, coachingWideningLog: null,
      coachingBiasSignals: null, draftWarnings: [], graphOutput: structuredClone(DRAFT),
    } satisfies DraftGraphResult;
  });
  return h;
}
type Harness = ReturnType<typeof harness>;



beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_REQUIRE_USER_JWT', 'false');
  vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'observe');
  vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'enforce');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'false');
  vi.stubEnv('CEE_V6_DUAL_DRAFT_ENABLED', 'false');
  _resetConfigCache();
  setTestSink(() => undefined);
});
afterEach(() => {
  setTestSink(null);
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('S1-A draft/redraft base through the real durable commit door', () => {












  it('the retired draft route returns 410; cold read in a fresh app reads the user model', async () => {
    const h = harness(USER_MODEL);
    const app = Fastify();
    await ceeOrchestratorRouteV2(app);
    try {
      const refused = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', payload: PAYLOAD });
      expect(refused.statusCode).toBe(410);
      const body = refused.json();
      expect(BoundaryErrorSchema.safeParse(body).success).toBe(true);
      expect(body).toMatchObject({ error: 'INGRESS_CONTRACT_VIOLATION', retryable: false,
        details: { reason: 'conventional_conversation_retired' } });
      expect(h.attempts).toHaveLength(0);
      expect(h.committed).toHaveLength(0);
    } finally {
      await app.close();
    }
    // A new application instance has no dispatch response or turn-local cache.
    const coldApp = Fastify();
    await scenarioGraphRoute(coldApp);
    try {
      const cold = await coldApp.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
      expect(cold.statusCode).toBe(200);
      expect(cold.json().graph).toEqual(USER_MODEL);
      expect(JSON.stringify(h.persisted)).toBe(JSON.stringify(USER_MODEL));
      expect(h.committed).toHaveLength(0);
    } finally {
      await coldApp.close();
    }
  });
});
