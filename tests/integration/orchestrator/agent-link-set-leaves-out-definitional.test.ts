/**
 * ⛔ R3-9 × R12 — served 13acc577 (Runtime w2255 served row, 28 Sep): Olumi's bands for six links, approved, were refused WHOLE
 * ("Not saved: none of it was applied.") because two are operands of the declared MRR = price × subscribers. The proposer now
 * leaves those out by the writer's own predicate and says so. Real in-process door, the served graph verbatim.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { RunAnalysisHandlerFactSchema } from '@talchain/schemas/orchestrator';
import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '13acc577-f1d4-4859-b272-e34feafb38ce'; // the served scenario_id (T2/T3 requests)

const servedBefore = JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/served-13acc577-linkset-graph.json', import.meta.url), 'utf8')) as { graph: { nodes: unknown[]; edges: unknown[]; goal_constraints?: unknown[] } };

function servedGraph(): unknown {
  const g = servedBefore.graph;
  return projectGraphForPersistence({ ...GraphV3.parse({ nodes: g.nodes, edges: g.edges, goal_constraints: g.goal_constraints }), options: [] as Array<Record<string, unknown>> });
}

let persisted: unknown = servedGraph();
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      return (r.write.handler_facts ?? []) as unknown[];
    }),
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-09-28T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-09-28T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id };
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

// T2's six proposed bands, in T2's own listed order.
const BANDS = [
  { from_label: 'Pro plan price', to_label: 'Monthly churn', strength: 'moderate' as const },
  { from_label: 'Monthly churn', to_label: '12-month net Pro subscriber growth', strength: 'strong' as const },
  { from_label: '12-month net Pro subscriber growth', to_label: 'Pro paying subscribers', strength: 'very strong' as const },
  { from_label: 'Pro plan price', to_label: 'Pro MRR', strength: 'very strong' as const },
  { from_label: 'Pro paying subscribers', to_label: 'Pro MRR', strength: 'very strong' as const },
  { from_label: 'Pro MRR', to_label: 'MRR', strength: 'very strong' as const },
];


const RUN_AT = '2026-09-28T17:00:00.000Z';
/** A successful Run that WITHDREW pro_mrr's identity: the writer's own input (`identityRunUseFromFacts`). */
const withdrawnRun = () => RunAnalysisHandlerFactSchema.parse({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: SCENARIO_ID, computed_at: RUN_AT,
    graph_hash_at_run: computeAnalysisAffectingGraphHash(persisted as never),
    leading_option_id: null, summary: 'First pass.',
    enrichment: {
      analysis_status: 'completed',
      identity_evaluations: [{ node_id: 'pro_mrr', evaluated: false }],
      _meta: { identities_not_forwarded: [{ node_id: 'pro_mrr', reason: 'inferred_identity_frame_unresolved', frameless_node_ids: ['pro_plan_price'] }] },
    },
  },
});
function seedRun(): void {
  rows.set(`${SCENARIO_ID}/seed-run`, { id: 'seed-run', write: {
    scenario_id: SCENARIO_ID, turn_id: 'seed-run', turn_class: 'analyse', handler_id: 'run_analysis',
    request_hash: 'seed', response_emitted: true, llm_calls_used: 0, duration_ms: 1, handler_facts: [withdrawnRun()] } });
}

type Edge = { from: string; to: string; strength: { mean: number }; defaulted?: boolean; provenance?: Record<string, unknown> };
const edgesOf = (): Edge[] => (persisted as { edges: Edge[] }).edges;
const DEFINITIONAL = ['pro_plan_price::pro_mrr', 'pro_paying_subscribers::pro_mrr'];

describe('⛔ R3-9 × R12: a link set leaves out the links a declared identity defines (served 13acc577: the set was refused whole at approval)', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
  });
  beforeEach(() => { persisted = servedGraph(); rows.clear(); });

  /** The read carries `analysis_identity_run_use` exactly as the route does (#2248): null = no successful Run. */
  const agent = (runUse: { withdrawn_node_ids: string[] } | null) => {
    const store = new ProposalStore();
    const hash = (): string => { const h = computeAnalysisAffectingGraphHash(persisted as never); if (h === null) throw new Error('no hash'); return h; };
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: hash(), analysis_identity_run_use: runUse } });
    let doorCalls = 0;
    const caps = createAgentCapabilities(d as never, store, undefined, 'full', undefined, {
      commitOptionLevels: (input) => { doorCalls += 1; return commitOptionLevelsInProcess(input, 'req-r12'); },
    });
    const said = 'We need to make educated guesses on all of these link strengths. What do you recommend?';
    return { caps, ctx: { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: said, user_turn_text: said }, doorCalls: () => doorCalls };
  };

  it('RED (served): no Run → the two identity operands are left out and named; the other four land in ONE commit as reviewed Olumi estimates', async () => {
    const { caps, ctx, doorCalls } = agent(null);
    const before = new Map(edgesOf().map((e) => [`${e.from}::${e.to}`, JSON.stringify(e)]));
    const p = await caps.proposeLinkStrengths!(ctx, { links: BANDS as never, rationale: 'Olumi’s bands (T2)' }) as Record<string, unknown>;
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect((p.links as unknown[]).length).toBe(4);
    const left = p.left_out_definitional as string[];
    expect(left).toHaveLength(2);
    for (const s of left) expect(s).toContain('Pro MRR');
    expect(String(p.public_label)).not.toContain('"Pro plan price" → "Pro MRR"');
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(doorCalls()).toBe(1);
    expect(rows.size, 'ONE commit').toBe(1);
    for (const e of edgesOf()) {
      const k = `${e.from}::${e.to}`;
      if (DEFINITIONAL.includes(k)) { expect(JSON.stringify(e), `${k} untouched`).toBe(before.get(k)); continue; }
      const rv = e.provenance?.reviewed_by_user as { intent?: string; band?: string } | undefined;
      if (rv === undefined) continue;
      expect(rv.intent, k).toBe('confirm');
      expect(e.defaulted, `${k} keeps defaulted`).toBe(true);
    }
    expect(edgesOf().filter((e) => (e.provenance?.reviewed_by_user as unknown) !== undefined)).toHaveLength(4);
  });

  it('CONTROL: the last Run WITHDREW the identity → nothing is left out; all six land in one commit', async () => {
    seedRun();
    const { caps, ctx } = agent({ withdrawn_node_ids: ['pro_mrr'] });
    const p = await caps.proposeLinkStrengths!(ctx, { links: BANDS as never, rationale: 'Olumi’s bands (T2)' }) as Record<string, unknown>;
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect((p.links as unknown[]).length).toBe(6);
    expect(p.left_out_definitional).toBeUndefined();
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
  });

  it('a set of ONLY identity operands prepares nothing and says why (never an empty approval)', async () => {
    const { caps, ctx } = agent(null);
    const p = await caps.proposeLinkStrengths!(ctx, { links: BANDS.filter((b) => b.to_label === 'Pro MRR' && b.from_label !== 'Pro MRR') as never, rationale: 'x' }) as Record<string, unknown>;
    expect(p.ok).toBe(false);
    expect(p.refusal).toBe('definitional_link');
    expect((p.definitional as string[]).length).toBe(2);
  });
});
