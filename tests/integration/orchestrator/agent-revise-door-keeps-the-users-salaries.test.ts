/**
 * ⛔ JOURNEY E'S SALARIES ARE THE USER'S, END TO END (served CEE 5d73351, #72 5882023751; DL HIGH gate 5882032796; AIQ 5882087383).
 * The user wrote "Senior engineers cost £120k a year each and juniors £65k a year each." Through the REAL in-process door,
 * propose → ONE approval stores both salaries as the user's (`source: user_override`), and a later, unrelated commit keeps
 * that source on re-read. Before the fix the revise door marked both Olumi's (`not_the_users_figure`), and the commit
 * stamped them as Olumi's figures.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '38b6c2a6-0000-4000-8000-0000000000e5';
import { readFileSync } from 'node:fs';

/** The served journey-E model the salaries were stated against (5d73351, D1 brief turn). */
const SERVED = (JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/served-journey-e-salaries-5d73351-d1.json', import.meta.url), 'utf8')) as { graph: { nodes: unknown[]; edges: unknown[] } }).graph;
function pricingGraph() {
  return projectGraphForPersistence({ ...GraphV3.parse({ nodes: SERVED.nodes, edges: SERVED.edges }), options: [] as Array<Record<string, unknown>> });
}

let persisted: unknown = pricingGraph();
let receiptFor: ((write: Record<string, unknown>) => Record<string, unknown>) | undefined;
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    // The door verifies its OWN row and fact through these (as `route-v2-option-intervention-edit.test.ts` models them).
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-09-26T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-26T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id, ...(receiptFor !== undefined ? { modelVersionReceipt: receiptFor(write) } : {}) };
    },
    getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

const currentHash = (): string => {
  const h = computeAnalysisAffectingGraphHash(persisted as never);
  if (h === null) throw new Error('fixture must have an analysis-affecting hash');
  return h;
};

describe('journey E: the user\'s salaries, through the real door, are stored as theirs and stay theirs', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
  });
  beforeEach(() => {
    persisted = pricingGraph();
    rows.clear();
    receiptFor = (write) => ({
      mutation_id: '33333333-3333-4333-8333-333333333333', version_id: '44444444-4444-4444-8444-444444444444', version_number: 7,
      graph_identity_hash: 'a'.repeat(64), analysis_affecting_hash: 'b'.repeat(64), hash_algorithm: 'sha256',
      identity_projection_version: 'v1', identity_normaliser_version: 'v1', graph_schema_version: 'graph.v3',
      actor_kind: 'system', authored_by: null, creation_kind: 'committed_mutation', source_version_id: null,
      parent_version_id: null, root_version_id: null, undo_version_id: null, event_id: 'evt-compound',
      graph: write.graph, source_turn_id: write.turn_id,
    });
  });
  const agent = (user_text: string) => {
    const store = new ProposalStore();
    const d = async (path: string, body?: unknown) => {
      if (path.endsWith('/graph/register')) {
        const b = body as { graph: unknown; expected_graph_hash?: string; operation_id?: string };
        if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== currentHash()) return { status: 409, json: { code: 'GRAPH_STALE' } };
        persisted = b.graph;
        rows.set(`register/${String(b.operation_id)}`, { id: `row-${rows.size + 1}`, write: { scenario_id: SCENARIO_ID, turn_id: String(b.operation_id), graph: b.graph } });
        return { status: 200, json: { graph_hash: currentHash() } };
      }
      return { status: 200, json: { graph: persisted, graph_hash: currentHash() } };
    };
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-agent'),
    });
    return { caps, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text } };
  };
  const os = (id: string) => (persisted as { nodes: { id: string; observed_state?: Record<string, unknown> }[] }).nodes.find((n) => n.id === id)!.observed_state ?? {};
  const SALARIES = { assumptions: [
    { factor_label: 'Senior engineer annual salary', value: 120000, unit: 'GBP/year per engineer', basis: 'as the user said', revise: true },
    { factor_label: 'Junior engineer annual salary', value: 65000, unit: 'GBP/year per engineer', basis: 'as the user said', revise: true },
  ] };

  it('RED (served E1): ONE approval stores both salaries as the user\'s, and a later unrelated commit keeps that on re-read', async () => {
    const a = agent('Senior engineers cost £120k a year each and juniors £65k a year each.');
    const p = await a.caps.proposeAssumptions(a.ctx, SALARIES as never);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(p.not_the_users_figure, JSON.stringify(p.not_the_users_figure)).toBeUndefined();
    const out = await a.caps.authoriseChange(a.ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'two values, ONE commit').toBe(1);
    for (const id of ['senior_engineer_annual_salary', 'junior_engineer_annual_salary']) {
      expect(os(id).source, `${id} ${JSON.stringify(os(id))}`).toBe('user_override');
    }
    expect(os('senior_engineer_annual_salary').raw_value ?? os('senior_engineer_annual_salary').value).toBe(120000);
    // A later, unrelated commit (Olumi's figure on another factor), then a fresh read: the user's source survives.
    const b = agent('What would you assume for annual salary spend?');
    const q = await b.caps.proposeAssumptions(b.ctx, { assumptions: [{ factor_label: 'Annual salary spend', value: 250000, unit: 'GBP/year', basis: 'two seniors', revise: true }] } as never);
    expect(q.ok, JSON.stringify(q)).toBe(true);
    const out2 = await b.caps.authoriseChange(b.ctx, { proposal_id: String(q.proposal_id) });
    expect(out2.ok, JSON.stringify(out2)).toBe(true);
    expect(rows.size).toBe(2);
    for (const id of ['senior_engineer_annual_salary', 'junior_engineer_annual_salary']) expect(os(id).source).toBe('user_override');
    expect(os('annual_salary_spend').source, JSON.stringify(os('annual_salary_spend'))).not.toBe('user_override');
  });
});
