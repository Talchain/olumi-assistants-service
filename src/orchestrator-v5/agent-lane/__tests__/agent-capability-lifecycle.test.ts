/**
 * Capability contract: real Agent dispatch/routes → existing writers → canonical readback.
 * Storage and external transports only are substituted, following the existing
 * goal-target/held-option harnesses. This proves the product write path, not DB atomicity.
 * Fresh apps recover pending_actions through the production parser/rehydration.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import hiringFixture from './fixtures/live-hiring-envelope-candidate-20260923.json';
import type { CallStructuredModel } from '../runtime/build-model.js';
import plotFixture from '../../../../tests/fixtures/plot/v2-run-golden-happy.json';
import { SystemEventTurnPayloadSchema } from '@talchain/schemas/boundary';

let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `6b1e2d3c-4b5a-4f6e-9d7c-8b9a0f1e3d${String(n).padStart(2, '0')}`; };

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; handler_facts: Record<string, unknown>[]; created_at: string };
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
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; turn_class?: string; handler_id?: string | null; pending_actions?: unknown[]; graph?: unknown; handler_facts?: Record<string, unknown>[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: jsonbOrder(JSON.parse(JSON.stringify(w.pending_actions ?? []))) as unknown[],
        handler_facts: structuredClone(w.handler_facts ?? []),
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
  readFactsFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id)).flatMap((r) => r.handler_facts)),
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].filter((r) => ids.includes(r.id))
    .flatMap((r) => r.handler_facts.map((fact) => ({ turn_id: r.id, fact, fact_created_at: r.created_at })))),
  readScenarioRunAnalysisFactsFor: vi.fn(async (sid: string, limit = 20) => {
    const facts = [...rows.values()].reverse().filter((r) => r.scenario_id === sid).flatMap((r) => r.handler_facts
      .filter((f) => f.fact_type === 'run_analysis').map((fact, i) => ({ fact, fact_row_id: `${r.id}-${i}`, fact_created_at: r.created_at })));
    return { facts: facts.slice(0, limit), total_count: facts.length };
  }),
  scenarioExists: vi.fn(async (sid: string) => graphOf.has(sid)),
  getScenarioOwner: vi.fn(async () => null),
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

// Only the external science service is substituted. The Agent dispatch, run loader,
// handler, fact commit and canonical analysis reader stay real.
const plotRequests: Record<string, unknown>[] = [];
vi.mock('../../../orchestrator/plot-client.js', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  createPLoTClient: () => ({
    run: async (request: Record<string, unknown>) => { plotRequests.push(structuredClone(request)); return structuredClone(plotFixture); },
    validatePatch: async () => { throw new Error('Unexpected patch validation'); },
  }),
}));

type Chip = { id: string; label: string; message: string };
type Body = { assistant_text: string; suggested_actions: Chip[]; _provider_calls?: { provider: string }[];
  _agent: { tool_calls: { name: string; ok: boolean; mutated?: boolean; refusal?: string; proposal_id?: string; already_applied?: boolean }[]; replayed?: boolean; mutated?: boolean } };

/** Existing pricing harness: unrelated identities, values and links are preservation sentinels. */
const seedGraph = () => {
  const e = (from: string, to: string) => ({ from, to, strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' as const });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_mrr', kind: 'goal', label: 'MRR', goal_threshold: 0.8 },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP', source: 'user_specified' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP', source: 'user_specified' } } },
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
    await a.register((await import('../../../routes/assist.v1.scenario-graph.js')).default);
    await a.register((await import('../../../routes/assist.v1.scenario-graph-register.js')).default);
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
    script = []; openAiCalls = 0; inner = []; innerStatus = [];
    writerFault = 'none'; plotRequests.length = 0; routerCalls.length = 0; anthropicCalls.length = 0;
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

  const proposeTool = async (name: string, args: Record<string, unknown>, message: string) => {
    const before = structuredClone(graphNow());
    script = [() => fnCall(name, args), () => say('Please approve this change.')];
    const out = await turn({ message });
    expect(out._agent.tool_calls, JSON.stringify(out)).toContainEqual(expect.objectContaining({ name, ok: true, mutated: false }));
    expect(graphNow()).toEqual(before);
    expect(graphWrites).toHaveLength(0);
    const chip = approveChipOf(out);
    expect(chip, JSON.stringify(out)).toBeDefined();
    return chip!;
  };
  const approveOnce = async (chip: Chip) => {
    const result = await approve(chip);
    expect(result._agent.tool_calls, JSON.stringify(result)).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(graphWrites, JSON.stringify(result)).toHaveLength(1);
    return result;
  };
  const readback = async (): Promise<Record<string, unknown>> => {
    const res = await app.inject({ method: 'POST', url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: {} });
    expect(res.statusCode, res.body).toBe(200);
    return res.json();
  };

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

  it('propose_new_option preserves £59 for new customers and £49 for existing customers, identities, units and provenance', async () => {
    const g = graphNow();
    g.nodes.find((n) => n.id === 'goal_mrr')!.description = 'The team disagrees on whether pricing alone can reach this goal; test the retention assumption.';
    g.goal_constraints = [{ constraint_id: 'gc-price', node_id: 'fac_price', operator: '<=', value: 90, unit: 'GBP', provenance: 'explicit', value_frame: 'level', label: 'New-customer Pro price', source_quote: 'Keep new-customer prices at or below £90.' }];
    g.nodes.find((n) => n.id === 'fac_price')!.label = 'New-customer Pro price';
    g.nodes.push({ id: 'fac_existing', kind: 'factor', label: 'Existing-customer Pro price',
      observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200, source: 'user_override' } });
    for (const [id, value] of [['opt_a', 49], ['opt_b', 59]] as const) {
      const opt = g.nodes.find((n) => n.id === id)!;
      opt.interventions = { ...opt.interventions as object, fac_existing: { value: value / 200, raw_value: value, unit: 'GBP' } };
    }
    g.edges.push({ from: 'fac_existing', to: 'goal_mrr', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
    const before = structuredClone(g);
    const chip = await proposeTool('propose_new_option', {
      label: 'Grandfather existing customers', rationale: 'The user stated both prices.',
      acts_on: [
        { factor_label: 'New-customer Pro price', direction: 'positive', level: { value: 59, unit: 'GBP' } },
        { factor_label: 'Existing-customer Pro price', direction: 'positive', level: { value: 49, unit: 'GBP' } },
      ],
    }, 'Add grandfathering: £59 for new customers and £49 for existing customers.');
    await approveOnce(chip);
    const added = graphNow().nodes.find((n) => n.label === 'Grandfather existing customers')!;
    expect(added).toBeDefined();
    expect(added.interventions).toMatchObject({
      fac_price: { value: 59 / 200, raw_value: 59, unit: 'GBP', source: 'user_specified' },
      fac_existing: { value: 49 / 200, raw_value: 49, unit: 'GBP', source: 'user_specified' },
    });
    expect(graphNow().nodes.filter((n) => n.id !== added.id)).toEqual(before.nodes);
    expect(graphNow().goal_constraints).toEqual(before.goal_constraints);
    expect(graphNow().goal_node_id).toBe(before.goal_node_id);
    expect(graphNow().edges.filter((e) => e.from !== added.id && e.to !== added.id)).toEqual(before.edges);
    expect(graphNow().edges).toContainEqual(expect.objectContaining({ from: 'dec_x', to: added.id }));
    expect((await readback()).graph).toEqual(graphNow());
  }, 120_000);

  it('propose_new_option with two new factors gives #2103 one request for their values through the real receipt', async () => {
    const labels = ['New-customer Pro price', 'Existing-customer Pro price'];
    const chip = await proposeTool('propose_new_option', {
      label: 'Grandfather existing customers', rationale: 'Separate the two populations.',
      acts_on: labels.map((factor_label) => ({ factor_label, direction: 'positive' })),
      new_factors: labels.map((label) => ({ label, affects: [{ label: 'MRR', direction: 'positive' }] })),
    }, 'Add grandfathering with separate new-customer and existing-customer prices; each affects MRR.');
    const result = await approveOnce(chip);
    expect(result.assistant_text.match(/Tell me/g)).toHaveLength(1);
    expect(result.assistant_text).toContain(`Tell me today's value for "${labels[0]}" and "${labels[1]}"`);
    expect(result.assistant_text).not.toContain('Its current value is not set yet');
    for (const label of labels) {
      const factor = graphNow().nodes.find((n) => n.kind === 'factor' && n.label === label)!;
      expect(factor).toBeDefined();
      expect(factor.observed_state).toBeUndefined();
      expect(graphNow().edges).toContainEqual(expect.objectContaining({ from: factor.id, to: 'goal_mrr', provenance: expect.objectContaining({ source: 'cee_hypothesis' }) }));
    }
  }, 120_000);

  it('propose_new_risk adds the risk and its intended links while preserving unrelated content', async () => {
    const before = structuredClone(graphNow());
    const chip = await proposeTool('propose_new_risk', {
      label: 'Competitive response', affects: [{ target_label: 'MRR', direction: 'negative' }],
      caused_by: [{ factor_label: 'Price', direction: 'positive' }], rationale: 'A price rise may provoke competition.',
    }, 'Add a competitive response risk driven by Price that lowers MRR.');
    await approveOnce(chip);
    const risk = graphNow().nodes.find((n) => n.kind === 'risk')!;
    expect(risk.label).toBe('Competitive response');
    expect(graphNow().edges).toContainEqual(expect.objectContaining({ from: risk.id, to: 'goal_mrr', effect_direction: 'negative', provenance: expect.objectContaining({ source: 'cee_hypothesis' }) }));
    expect(graphNow().edges).toContainEqual(expect.objectContaining({ from: 'fac_price', to: risk.id }));
    expect(graphNow().nodes.filter((n) => n.id !== risk.id)).toEqual(before.nodes);
    expect(graphNow().edges.filter((e) => e.from !== risk.id && e.to !== risk.id)).toEqual(before.edges);
  }, 120_000);

  it('propose_limit_change changes a non-goal limit without changing the goal or its target', async () => {
    graphNow().goal_constraints = [{ constraint_id: 'gc-price', label: 'Price', node_id: 'fac_price', operator: '<=', value: 80, unit: 'GBP', provenance: 'explicit', value_frame: 'level' }];
    const before = structuredClone(graphNow());
    const chip = await proposeTool('propose_limit_change', { limit_label: 'Price', operator: '<=', new_value: 90, unit: 'GBP', rationale: 'The user raised the price limit.' }, 'The Price limit can now be at most £90.');
    await approveOnce(chip);
    expect(graphNow().goal_constraints).toEqual([expect.objectContaining({ node_id: 'fac_price', value: 90, unit: 'GBP' })]);
    expect(graphNow().nodes).toEqual(before.nodes);
    expect(graphNow().edges).toEqual(before.edges);
  }, 120_000);

  it('propose_goal_target records the stated target through the existing goal writer', async () => {
    const before = structuredClone(graphNow());
    const chip = await proposeTool('propose_goal_target', { constraint_type: 'at_least', value: 60000, unit: '£', rationale: 'The stated goal.' }, 'We need at least £60,000 MRR.');
    await approveOnce(chip);
    expect(graphNow().nodes.find((n) => n.id === 'goal_mrr')).toMatchObject({ goal_threshold_raw: 60000, goal_threshold_unit: '£', threshold_source: 'user' });
    expect(graphNow().nodes.filter((n) => n.id !== 'goal_mrr')).toEqual(before.nodes.filter((n) => n.id !== 'goal_mrr'));
    expect(graphNow().edges).toEqual(before.edges);
  }, 120_000);

  it('propose_goal_current_level writes the goal baseline on its declared scale and preserves the target', async () => {
    Object.assign(graphNow().nodes.find((n) => n.id === 'goal_mrr')!, {
      goal_threshold_raw: 20000, goal_threshold_unit: 'GBP', goal_threshold_cap: 25000, goal_threshold_frame: 'level', threshold_source: 'user',
    });
    const before = structuredClone(graphNow());
    const chip = await proposeTool('propose_goal_current_level', { goal_label: 'MRR', value: 12000, unit: 'GBP', goal_is: 'at_least', user_stated: true }, 'Our current MRR is £12,000.');
    await approveOnce(chip);
    expect(graphNow().nodes.find((n) => n.id === 'goal_mrr')).toMatchObject({ goal_threshold_raw: 20000, observed_state: { value: 0.48, raw_value: 12000, unit: 'GBP', source: 'user_override' } });
    expect(graphNow().nodes.filter((n) => n.id !== 'goal_mrr')).toEqual(before.nodes.filter((n) => n.id !== 'goal_mrr'));
    expect(graphNow().edges).toEqual(before.edges);
  }, 120_000);

  it.each(['propose_assumptions', 'propose_starting_point'])('%s persists an explicitly labelled assumption through the existing value writer', async (name) => {
    graphNow().nodes.push({ id: 'fac_churn', kind: 'factor', label: 'Monthly churn' });
    graphNow().edges.push({ from: 'fac_churn', to: 'goal_mrr', strength: { mean: -0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'negative' });
    const before = structuredClone(graphNow());
    const assumptions = [{ factor_label: 'Monthly churn', value: 5, unit: '%', basis: 'A provisional starting assumption to check.' }];
    const args = name === 'propose_assumptions' ? { assumptions } : { assumptions, option_levels: [] };
    const chip = await proposeTool(name, args, 'Suggest a starting churn assumption for me to approve.');
    await approveOnce(chip);
    expect(graphNow().nodes.find((n) => n.id === 'fac_churn'), JSON.stringify(graphNow().nodes.find((n) => n.id === 'fac_churn'))).toMatchObject({ observed_state: { value: 0.05, raw_value: 5, source: 'user_assumption' } });
    expect(graphNow().nodes.filter((n) => n.id !== 'fac_churn')).toEqual(before.nodes.filter((n) => n.id !== 'fac_churn'));
    expect(graphNow().edges).toEqual(before.edges);
  }, 120_000);

  it('propose_option_interventions records the approved native figure on the existing option identity', async () => {
    const before = structuredClone(graphNow());
    const chip = await proposeTool('propose_option_interventions', { interventions: [{ option_label: 'Raise to £59', factor_label: 'Price', value: 64, unit: 'GBP', user_stated: true, basis: 'The user revised the option price.' }] }, 'Set the Raise to £59 option price to £64 instead.');
    await approveOnce(chip);
    expect(graphNow().nodes.find((n) => n.id === 'opt_b')).toMatchObject({ interventions: { fac_price: { value: 0.32, raw_value: 64, unit: 'GBP', source: 'user_specified' } } });
    expect(graphNow().nodes.filter((n) => n.id !== 'opt_b')).toEqual(before.nodes.filter((n) => n.id !== 'opt_b'));
    expect(graphNow().edges).toEqual(before.edges);
  }, 120_000);

  it('propose_model_change connects existing identities using the stated strength through the real structural writer', async () => {
    graphNow().edges = graphNow().edges.filter((e) => e !== linkOf(graphNow()));
    const before = structuredClone(graphNow());
    const chip = await proposeTool('propose_model_change', { from_label: 'Price', to_label: 'MRR', direction: 'positive', strength: 'strong', rationale: 'The user named this link.' }, 'Price has a strong positive effect on MRR; connect them.');
    await approveOnce(chip);
    expect(linkOf(graphNow())).toMatchObject({ strength: { mean: 0.55 }, provenance: { source: 'user_specified' } });
    expect(graphNow().nodes).toEqual(before.nodes);
    expect(graphNow().edges.filter((e) => e !== linkOf(graphNow()))).toEqual(before.edges);
  }, 120_000);

  const dispatchCapability = async (name: string, args: Record<string, unknown>, mode: 'full' | 'preview' = 'full', structured?: CallStructuredModel) => {
    const { createAgentCapabilities } = await import('../runtime/agent-capabilities.js');
    const { dispatchTool } = await import('../runtime/agent-tools.js');
    const { ProposalStore } = await import('../proposal.js');
    const caps = createAgentCapabilities(async (url, payload) => {
      const res = await app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
      return { status: res.statusCode, json: res.json() };
    }, new ProposalStore(), structured, mode);
    return dispatchTool(name, JSON.stringify(args), { scenario_id: SCENARIO, authenticated_user_id: null, request_id: randomUUID() }, caps, mode);
  };

  it('build_model_from_brief retains the approved empty-preview construction exception through real registration', async () => {
    graphOf.set(SCENARIO, { nodes: [], edges: [] });
    const structured: CallStructuredModel = async () => ({ text: JSON.stringify(hiringFixture.candidate) });
    const brief = 'Should I hire a Tech Lead or two developers to increase velocity?';
    const result = await dispatchCapability('build_model_from_brief', { brief }, 'preview', structured);
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, mutated: true });
    expect(graphWrites).toHaveLength(1);
    expect(graphNow().nodes.filter((n) => n.kind === 'option').map((n) => n.label)).toEqual(expect.arrayContaining(hiringFixture.candidate.options.filter((o) => o.provenance === 'explicit').map((o) => o.label)));
    expect((await readback()).graph).toEqual(graphNow());
    const saved = structuredClone(graphNow());
    const refused = await dispatchCapability('build_model_from_brief', { brief: 'Replace everything.' }, 'preview', structured);
    expect(refused).toMatchObject({ ok: false, mutated: false, refusal: 'model_already_exists' });
    expect(graphWrites).toHaveLength(1);
    expect(graphNow()).toEqual(saved);
  }, 120_000);

  it('get_canonical_state and offer_public_research support a non-decision investigation without changing it', async () => {
    graphOf.set(SCENARIO, { nodes: [{ id: 'workload', kind: 'factor', label: 'Workload' }, { id: 'burnout', kind: 'outcome', label: 'Burnout' }], edges: [{ from: 'workload', to: 'burnout', strength: { mean: 0.6, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] });
    const before = structuredClone(graphNow());
    const read = await dispatchCapability('get_canonical_state', { reason: 'Investigate workplace wellbeing.' });
    expect(read).toMatchObject({ ok: true, mutated: false, graph_revision: analysisHash(before), entities: expect.arrayContaining([expect.objectContaining({ id: 'workload', label: 'Workload' }), expect.objectContaining({ id: 'burnout', label: 'Burnout' })]) });
    const query = 'Evidence about workload and employee burnout';
    expect(await dispatchCapability('offer_public_research', { query })).toMatchObject({ ok: true, mutated: false, offered_query: query });
    expect(graphWrites).toHaveLength(0);
    expect(plotRequests).toHaveLength(0);
    expect(graphNow()).toEqual(before);
  });

  it('run_analysis becomes stale after an approved write and explicit rerun computes the exact committed revision', async () => {
    const initialHash = analysisHash(graphNow());
    const first = await dispatchCapability('run_analysis', { reason: 'Compare the current model.' });
    expect(first, JSON.stringify(first)).toMatchObject({ ok: true, mutated: false, ran: true });
    expect(plotRequests).toHaveLength(1);
    expect((await readback()).analysis_state).toMatchObject({ run_state: { kind: 'complete_current' } });
    const chip = await propose();
    await approveOnce(chip);
    const saved = structuredClone(graphNow());
    const savedHash = analysisHash(saved);
    expect(savedHash).not.toBe(initialHash);
    expect(plotRequests, 'approval must not run analysis').toHaveLength(1);
    const stale = await readback();
    expect(stale.graph_hash).toBe(savedHash);
    expect(stale.analysis_state).toMatchObject({ run_state: { kind: 'complete_stale', cause: 'graph_changed' } });
    expect((await store.readScenarioRunAnalysisFactsFor(SCENARIO)).facts[0]!.fact.result).toMatchObject({ graph_hash_at_run: initialHash });
    const rerun = await dispatchCapability('run_analysis', { reason: 'Rerun on the approved link.' });
    expect(rerun, JSON.stringify(rerun)).toMatchObject({ ok: true, mutated: false, ran: true });
    expect(plotRequests).toHaveLength(2);
    expect(linkOf(plotRequests[1]!.graph as G).strength.mean).toBe(0.85);
    // The PLoT wire carries the goal id beside graph, and option levels in native units.
    const submitted = plotRequests[1]!;
    expect(submitted.graph).toEqual({ nodes: saved.nodes, edges: saved.edges });
    expect(submitted.goal_node_id).toBe(saved.goal_node_id);
    expect(submitted.options).toMatchObject([
      { id: 'opt_a', interventions: { fac_price: 49 } },
      { id: 'opt_b', interventions: { fac_price: 59 } },
    ]);
    expect(analysisHash({ ...submitted.graph as G, goal_node_id: submitted.goal_node_id })).toBe(savedHash);
    expect(graphNow(), 'analysis never changes the committed model').toEqual(saved);
    expect(graphWrites).toHaveLength(1);
    const current = await readback();
    expect(current.graph_hash).toBe(savedHash);
    expect(current.analysis_state).toMatchObject({ run_state: { kind: 'complete_current' } });
    const facts = await store.readScenarioRunAnalysisFactsFor(SCENARIO);
    expect(facts.facts[0]!.fact.result).toMatchObject({ graph_hash_at_run: savedHash });
  }, 120_000);
});
