/**
 * ⭐ THE USER'S ANSWER TO "HOW MUCH DOES PRICE MOVE SUBSCRIBERS?" LANDS, END TO END (DL 5882763151; Canonical #2274's door).
 * Served journey C (CEE 5411da8): "Pro plan price" → "Pro plan paying subscribers" is a DIRECT link nobody sized. The user
 * writes "every £1 on the Pro price loses us about 50 paying subscribers"; the Agent prepares ONE change
 * (`propose_link_effect`), ONE approval commits it through the REAL level door, and the stored link is the user's own size
 * (`magnitude: user_stated`, their `natural_effect`, their quote on the fact) — kept on a fresh read.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';

const SCENARIO_ID = '38b6c2a6-0000-4000-8000-0000000000c5';
import { readFileSync } from 'node:fs';

/** The served journey-C model (5411da8, D1 brief turn): a DIRECT, unsized price → paying-subscribers link. */
const SERVED = (JSON.parse(readFileSync(new URL('../../../src/orchestrator-v5/agent-lane/__tests__/fixtures/served-journey-c-price-subscribers-unsized-5411da8.json', import.meta.url), 'utf8')) as { graph: { nodes: unknown[]; edges: unknown[] } }).graph;
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

describe('journey C: the user\'s stated link effect, through the real door, is stored as their own size and stays so', () => {
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
  const edgeOf = () => (persisted as { edges: { from: string; to: string; provenance?: Record<string, any>; strength?: { mean?: number }; effect_direction?: string }[] })
    .edges.find((e) => e.from === 'pro_plan_price' && e.to === 'pro_plan_paying_subscribers')!;
  const SAID = 'Honestly, every £1 on the Pro price loses us about 50 paying subscribers.';
  const ARGS = { from_label: 'Pro plan price', to_label: 'Pro plan paying subscribers', amount: -50, amount_unit: 'subscribers',
    per_source_change: 1, per_source_change_unit: 'GBP per month', quote: 'every £1 on the Pro price loses us about 50 paying subscribers' };

  it('RED (served journey C): propose → ONE approval → ONE commit; the link is the user\'s own size, with their words; kept on re-read', async () => {
    expect(edgeOf().provenance?.magnitude).toBeUndefined(); // precondition: unsized on the served bytes
    const a = agent(SAID);
    const p = await a.caps.proposeLinkEffect!(a.ctx, ARGS);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const out = await a.caps.authoriseChange({ ...a.ctx, typed_approval_of: String(p.proposal_id) }, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'ONE commit').toBe(1);
    const e = edgeOf();
    expect(e.provenance).toEqual(expect.objectContaining({ source: 'user_specified', magnitude: 'user_stated' }));
    expect(e.provenance?.natural_effect).toEqual(expect.objectContaining({ amount: -50, per_source_change: 1 }));
    expect(e.effect_direction).toBe('negative'); // the stored direction is kept, never flipped
    const facts = [...rows.values()].flatMap((r) => (r.write.handler_facts ?? []) as Array<Record<string, any>>);
    expect(JSON.stringify(facts)).toContain(ARGS.quote); // the user's words ride the fact (audit + approval card)
    // A fresh read: the stored size survives.
    const b = agent('What is in the model now?');
    const state = await b.caps.getCanonicalState(b.ctx) as Record<string, any>;
    expect(JSON.stringify(state.links ?? [])).toContain('pro_plan_paying_subscribers');
    expect(edgeOf().provenance?.magnitude).toBe('user_stated');
  });

  it('REFUSED end to end: the same answer after ANOTHER turn changed this link\'s bytes → superseded, nothing written', async () => {
    const a = agent(SAID);
    const p = await a.caps.proposeLinkEffect!(a.ctx, ARGS);
    expect(p.ok).toBe(true);
    // Another writer changes Olumi's reasoning on the link — a byte the analysis hash does not read (DL 5882808387).
    const g = persisted as { edges: Array<Record<string, any>> };
    const e = g.edges.find((x) => x.from === 'pro_plan_price' && x.to === 'pro_plan_paying_subscribers')!;
    e.provenance = { ...(e.provenance ?? {}), reasoning: 'changed by another turn' };
    const out = await a.caps.authoriseChange({ ...a.ctx, typed_approval_of: String(p.proposal_id) }, { proposal_id: String(p.proposal_id) });
    expect(out.ok).toBe(false);
    expect(rows.size, 'nothing written').toBe(0);
    expect(edgeOf().provenance?.magnitude).toBeUndefined();
  });
});
