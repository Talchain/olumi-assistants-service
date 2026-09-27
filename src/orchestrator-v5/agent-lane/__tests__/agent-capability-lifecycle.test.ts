/**
 * Capability spine: real Agent route → real route-v2 → existing edge writer.
 * Storage and external transports only are substituted, following the existing
 * goal-target/held-option harnesses. This proves the product write path, not DB atomicity.
 * Fresh apps recover pending_actions through the production parser/rehydration.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import { SystemEventTurnPayloadSchema } from '@talchain/schemas/boundary';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0f1e3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphWrites: { turn_id: string; graph: unknown }[] = [];
const graphOf = new Map<string, unknown>();
const latestRow = (sid: string): Row | undefined =>
  [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
/** What a Postgres `jsonb` column gives back: keys shorter-first then bytewise, `undefined` dropped. */
const jsonbOrder = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(jsonbOrder)
    : v !== null && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v as Record<string, unknown>)
        .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
        .sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0))
        .map((k) => [k, jsonbOrder((v as Record<string, unknown>)[k])]))
      : v;
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  const raw = row ? (jsonbOrder(JSON.parse(JSON.stringify(row.pending_actions))) as unknown[]) : [];
  return raw.map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
let tick = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        created_at: new Date(Date.UTC(2026, 8, 26, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) {
        graphOf.set(w.scenario_id, jsonbOrder(JSON.parse(JSON.stringify(w.graph))));
        graphWrites.push({ turn_id: w.turn_id, graph: graphOf.get(w.scenario_id) });
      }
    }
    return { id: rows.get(k)!.id };
  }),
  readRecent: vi.fn(async (sid: string) => [...order].reverse().map((k) => rows.get(k)!).filter((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'))),
  readFactsFor: vi.fn(async () => []),
  readFactsWithTurnFor: vi.fn(async () => []),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
  storeDraftGraph: vi.fn(async (sid: string, g: unknown) => { graphOf.set(sid, g); }),
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
/** route-v2's LLM router: a typed system event is deterministic — ANY use is a failure. */
const routerCalls: string[] = [];
const refuse = (what: string) => async () => { routerCalls.push(what); throw new Error(`route-v2 LLM router must not be used on the capability writer (${what})`); };
vi.mock('../../../adapters/llm/router.js', () => {
  const adapter = { name: 'test', model: 'test-model', chat: refuse('chat'), chatWithTools: refuse('chatWithTools') };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});
vi.mock('../../../adapters/llm/prompt-loader.js', () => ({ getSystemPrompt: async () => 'test system prompt' }));
/** The Anthropic transport the post-commit summariser could reach. Asserted untouched after every case. */
const anthropicCalls: unknown[] = [];
vi.mock('../../../adapters/llm/anthropic.js', async (importOriginal) => {
  const original = await importOriginal<Record<string, unknown>>();
  return { ...original, chatWithAnthropic: async (...args: unknown[]) => { anthropicCalls.push(args); throw new Error('Anthropic transport is forbidden in this suite'); } };
});

type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _provider_calls?: { provider: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string; already_applied?: boolean }[]; replayed?: boolean; mutated?: boolean } };

/** A decision, a £-priced factor, and the goal the user will set a target on — no target yet. */
const seedGraph = () => {
  const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_mrr', kind: 'goal', label: 'MRR' },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP' } } },
    ],
    edges: [e('dec_x', 'opt_a'), e('dec_x', 'opt_b'), e('opt_a', 'fac_price'), e('opt_b', 'fac_price'), e('fac_price', 'goal_mrr')],
    goal_node_id: 'goal_mrr',
  };
};

let script: ((body: Record<string, unknown>) => unknown)[] = [];
let openAiCalls = 0;
const fnCall = (name: string, args: Record<string, unknown>) => ({ output: [{ type: 'function_call', name, call_id: `c${openAiCalls}`, arguments: JSON.stringify(args) }] });
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
/** Every request that reached route-v2, in order. */
let inner: Record<string, unknown>[] = [];
/** Runs inside the inner request's preHandler — BEFORE route-v2 reads the store (a writer racing the approval). */
let onInner: ((body: Record<string, unknown>) => void) | undefined;
let innerStatus: number[] = [];
let writerFault: 'none' | 'transport_only' | 'after_commit_move' = 'none';

type G = {
  nodes: { id: string; kind: string; label: string; [key: string]: unknown }[];
  edges: { from: string; to: string; strength: { mean: number; std: number }; provenance?: { source: string }; [key: string]: unknown }[];
  [key: string]: unknown;
};
const graphNow = () => graphOf.get(SCENARIO) as G;
const linkOf = (g: G) => g.edges.find((e) => e.from === 'fac_price' && e.to === 'goal_mrr')!;
const approveChipOf = (b: Body) => b.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
const systemEvents = () => inner.filter((b) => b.kind === 'system_event');

describe('capability spine through the real product writer', () => {
  let app: FastifyInstance;
  let analysisHash: (g: unknown) => string | null;

  async function buildApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { ceeOrchestratorRouteV2 } = await import('../../../orchestrator/route-v2.js');
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    analysisHash = (g) => computeAnalysisAffectingGraphHash(g as never);
    const a = Fastify({ logger: false });
    a.addHook('preHandler', async (req, reply) => {
      if (req.url !== '/orchestrate/v2/turn') return;
      const body = req.body as Record<string, unknown>;
      inner.push(body);
      onInner?.(body);
      if (writerFault === 'transport_only' && body.kind === 'system_event') {
        // Fault at the transport boundary, with no writer/receipt/readback mutation.
        return reply.send({ assistant_text: 'Processed.', graph_hash: analysisHash(graphNow()) });
      }
    });
    a.addHook('onSend', async (req, reply, payload) => {
      if (req.url === '/orchestrate/v2/turn') {
        innerStatus.push(reply.statusCode);
        if (writerFault === 'after_commit_move' && graphWrites.length > 0) {
          // Another writer changes the target AFTER our real writer committed.
          const g = graphNow();
          graphOf.set(SCENARIO, { ...g, edges: g.edges.map((e) => e === linkOf(g) ? { ...e, strength: { ...e.strength, mean: 0.2 } } : e) });
        }
      }
      return payload;
    });
    a.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { graph: g, graph_hash: g === null ? null : analysisHash(g) };
    });
    await a.register(ceeOrchestratorRouteV2);
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }

  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    // The existing edge writer is enabled only with the atomic RPC contract.
    vi.stubEnv('CEE_V5_GRAPH_CAS_MODE', 'enforce');
    vi.stubEnv('CEE_V5_GRAPH_CAS_RPC', 'enforce');
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
      if (!String(url).includes('openai')) throw new Error(`Forbidden external request: ${String(url)}`);
      openAiCalls += 1;
      const next = script.shift();
      if (!next) throw new Error('Unscripted model call');
      return new Response(JSON.stringify(next(JSON.parse(String(init?.body ?? '{}')))), { status: 200 });
    }));
    app = await buildApp();
  }, 600_000);
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(() => {
    nextScenario(); graphOf.set(SCENARIO, seedGraph()); graphWrites.length = 0;
    script = []; openAiCalls = 0; inner = []; innerStatus = []; onInner = undefined;
    writerFault = 'none'; routerCalls.length = 0; anthropicCalls.length = 0;
  });
  afterEach(() => {
    expect(routerCalls).toEqual([]);
    expect(anthropicCalls).toEqual([]);
    expect(script, 'every scripted call must actually execute').toEqual([]);
  });

  const turn = async (payload: Record<string, unknown>): Promise<Body> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, turn_id: randomUUID(), ...payload,
    } });
    expect(r.statusCode, r.body.slice(0, 600)).toBe(200);
    return r.json() as Body;
  };
  const propose = async (): Promise<Chip> => {
    script = [
      () => fnCall('propose_link_strength', { from_label: 'Price', to_label: 'MRR', strength: 'very strong', rationale: 'The user stated the strength.' }),
      () => say('I propose recording that link as your own very strong estimate.'),
    ];
    const out = await turn({ message: 'The relationship from Price to MRR is very strong.' });
    expect(out._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'propose_link_strength', ok: true, mutated: false }));
    const chip = approveChipOf(out);
    expect(chip, JSON.stringify(out)).toBeDefined();
    expect(graphWrites).toHaveLength(0);
    return chip!;
  };
  const approve = (chip: Chip, turnId = randomUUID()) => turn({
    message: chip.message, source: 'chip', chip: { id: chip.id }, turn_id: turnId,
  });

  it('propose → real durable parser → fresh Agent → approve → real edge writer → canonical readback → durable replay', async () => {
    const before = structuredClone(graphNow());
    const chip = await propose();
    expect(graphNow()).toEqual(before);
    const pending = await store.readMostRecentPendingActions(SCENARIO);
    expect(pending).toHaveLength(1);
    const { ProposalStore } = await import('../proposal.js');
    const { rehydrateProposals } = await import('../durable-proposal.js');
    const restored = new ProposalStore();
    expect(rehydrateProposals(pending, restored, { scenario_id: SCENARIO, user_id: null })).toBe(1);
    const proposalId = chip.id.slice('agent-approve-proposal:'.length);
    expect(restored.get(proposalId)?.operations).toEqual([expect.objectContaining({ op: 'update_edge', path: 'fac_price::goal_mrr' })]);

    await app.close(); app = await buildApp();
    const approvalTurn = randomUUID();
    const callsBefore = openAiCalls;
    const applied = await approve(chip, approvalTurn);
    expect(openAiCalls).toBe(callsBefore);
    expect(applied._agent.tool_calls, JSON.stringify(applied)).toEqual([expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true })]);
    expect(graphWrites).toHaveLength(1);
    expect(systemEvents()).toHaveLength(1);
    expect(SystemEventTurnPayloadSchema.safeParse(systemEvents()[0]).success).toBe(true);
    expect(systemEvents()[0]?.event).toMatchObject({ kind: 'edge_strength_edit', from: 'fac_price', to: 'goal_mrr', magnitude: 0.85 });
    expect(linkOf(graphNow())).toMatchObject({ strength: { mean: 0.85 }, provenance: { source: 'user_specified' } });
    expect(graphNow().nodes).toEqual(before.nodes);
    expect(applied.assistant_text).toContain('Saved.');
    const committed = structuredClone(graphNow());
    const eventCount = inner.length;
    await app.close(); app = await buildApp();
    const replay = await approve(chip, approvalTurn);
    expect(replay._agent.replayed).toBe(true);
    expect(replay._agent.mutated).toBe(false);
    expect(replay._agent.tool_calls).toEqual([]);
    expect(graphWrites).toHaveLength(1);
    expect(inner).toHaveLength(eventCount);
    expect(graphNow()).toEqual(committed);
  }, 180_000);

  it('transport 200 with no committed write is not a saved link', async () => {
    const before = structuredClone(graphNow());
    const chip = await propose(); writerFault = 'transport_only';
    const out = await approve(chip);
    expect(innerStatus).toContain(200);
    expect(out._agent.tool_calls).toContainEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'not_applied' }));
    expect(graphWrites).toHaveLength(0);
    expect(graphNow()).toEqual(before);
    expect(out.assistant_text).not.toMatch(/\bSaved\./);
  }, 60_000);

  it('a verified commit followed by another edit is unverified, not a pre-commit refusal', async () => {
    const chip = await propose(); writerFault = 'after_commit_move';
    const out = await approve(chip);
    expect(graphWrites, JSON.stringify(out)).toHaveLength(1);
    expect(linkOf(graphWrites[0]!.graph as G).strength.mean).toBe(0.85);
    expect(linkOf(graphNow()).strength.mean).toBe(0.2);
    expect(out._agent.tool_calls).toContainEqual(expect.objectContaining({ ok: false, mutated: true, refusal: 'not_verified' }));
    expect(out.assistant_text).not.toMatch(/\bSaved\.|nothing was applied/i);
  }, 60_000);

  it('a stale proposal refuses before the writer and preserves the competing edit', async () => {
    const chip = await propose();
    linkOf(graphNow()).strength.mean = 0.2;
    const before = structuredClone(graphNow());
    const out = await approve(chip);
    expect(out._agent.tool_calls).toContainEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'superseded' }));
    expect(systemEvents()).toEqual([]);
    expect(graphWrites).toHaveLength(0);
    expect(graphNow()).toEqual(before);
  }, 60_000);
});
