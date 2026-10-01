/**
 * ⭐ A REFUSAL THE USER SETTLES BY CHOOSING — THE HOST SIDE (Paul's order #4; MG interface 5933547779; lease 5938604755).
 *
 * The tool side (MG) is not built yet, so the route rows below use a TOOL DOUBLE for `propose_new_risk` that returns
 * the agreed refusal shape (`choices: [{ label, field, value }]`) and records the `ctx.chosen` it receives. It is a
 * double of the CONTRACT, not evidence about MG's tool: the host's job is to carry a typed choice from the tool's
 * result to the chip and from the press back to the tool, interpreting no words on the way.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { agentChoiceChipsOf, agentChoiceChipsFrom, chosenOf, AGENT_CHOICE_PREFIX } from '../agent-choice.js';
import { stillValidOffers } from '../../../routes/agent-v1-turn.js';

const DIRECTION_CHOICES = [
  { label: 'It makes the goal worse', field: 'direction', value: 'negative' },
  { label: 'It makes the goal better', field: 'direction', value: 'positive' },
];
const refusal = (choices: unknown) => ({ ok: false, mutated: false, refusal: 'direction_not_stated', detail: 'Say which way it acts.', choices });

describe('tool result → chips (all or none, ≤ 3, typed only)', () => {
  it('RED: a refusal with two typed choices → two chips whose ids carry the tool, the field and the value', () => {
    expect(agentChoiceChipsOf('propose_new_risk', refusal(DIRECTION_CHOICES))).toEqual([
      { id: 'agent-choice:propose_new_risk:direction:negative', label: 'It makes the goal worse', message: 'It makes the goal worse' },
      { id: 'agent-choice:propose_new_risk:direction:positive', label: 'It makes the goal better', message: 'It makes the goal better' },
    ]);
  });
  it('a canonical node id as the value (ambiguous entity) is carried whole, colon included', () => {
    const chips = agentChoiceChipsOf('propose_new_risk', refusal([{ label: 'Team size (hiring)', field: 'entity', value: 'fac:team_size-2' }]));
    expect(chips.map((c) => c.id)).toEqual(['agent-choice:propose_new_risk:entity:fac:team_size-2']);
  });
  it.each([
    ['a success, not a refusal', { ...refusal(DIRECTION_CHOICES), ok: true }],
    ['a refusal that wrote something', { ...refusal(DIRECTION_CHOICES), mutated: true }],
    ['no choices', { ok: false, mutated: false, refusal: 'direction_not_stated' }],
    ['four choices', refusal([...DIRECTION_CHOICES, ...DIRECTION_CHOICES.map((c) => ({ ...c, value: `${c.value}_x`, label: `${c.label}!` }))])],
    ['one entry with a free-text value', refusal([DIRECTION_CHOICES[0], { label: 'Either', field: 'direction', value: 'either way' }])],
    ['one entry with no label', refusal([DIRECTION_CHOICES[0], { label: ' ', field: 'direction', value: 'positive' }])],
    ['two entries with the same label', refusal([DIRECTION_CHOICES[0], { ...DIRECTION_CHOICES[1], label: DIRECTION_CHOICES[0]!.label }])],
  ])('CONTROL: %s → no chip at all', (_name, result) => {
    expect(agentChoiceChipsOf('propose_new_risk', result)).toEqual([]);
  });
  it('CONTROL: a tool the Agent does not carry → no chip', () => {
    expect(agentChoiceChipsOf('drop_table', refusal(DIRECTION_CHOICES))).toEqual([]);
  });
  it('the turn\'s chips pair each result with ITS call', () => {
    // Call 0 succeeded; call 1 refused with choices: the chips name call 1's tool, never call 0's.
    const chips = agentChoiceChipsFrom([{ name: 'propose_new_factor' }, { name: 'propose_new_risk' }], [{ ok: true, mutated: false }, refusal(DIRECTION_CHOICES)]);
    expect(chips.map((c) => c.id)).toEqual(['agent-choice:propose_new_risk:direction:negative', 'agent-choice:propose_new_risk:direction:positive']);
  });
});

describe('press → the reading, from the chip id ALONE', () => {
  const press = (id: unknown, extra: Record<string, unknown> = {}) => ({ kind: 'message', message: 'anything at all', chip: { id }, ...extra });
  it('RED: the id → { tool, field, value }; a node-id value keeps its colon', () => {
    expect(chosenOf(press('agent-choice:propose_new_risk:direction:negative'))).toEqual({ tool: 'propose_new_risk', field: 'direction', value: 'negative' });
    expect(chosenOf(press('agent-choice:propose_new_risk:entity:fac:team_size-2'))).toEqual({ tool: 'propose_new_risk', field: 'entity', value: 'fac:team_size-2' });
  });
  it.each([
    ['no chip (typed words)', { kind: 'message', message: 'It makes the goal worse' }],
    ['another chip', press('agent-run-analysis')],
    ['an unknown tool', press('agent-choice:drop_table:direction:negative')],
    ['no value', press('agent-choice:propose_new_risk:direction:')],
    ['no field', press('agent-choice:propose_new_risk::negative')],
    ['a free-text value', press('agent-choice:propose_new_risk:direction:Make it worse')],
    ['a system event, not a message', press('agent-choice:propose_new_risk:direction:negative', { kind: 'system_event' })],
  ])('CONTROL: %s → no reading', (_name, body) => {
    expect(chosenOf(body as Record<string, unknown>)).toBeUndefined();
  });
});

describe('a lost response replayed keeps the refusal\'s choices', () => {
  const now = { outstandingProposalIds: new Set<string>(), analysisReady: undefined, analysisState: undefined, modelExists: true };
  it('RED: the remembered choice chips are offered again', () => {
    const chips = agentChoiceChipsOf('propose_new_risk', refusal(DIRECTION_CHOICES));
    expect(stillValidOffers(chips, now).map((c) => c.id)).toEqual(chips.map((c) => c.id));
  });
  it('CONTROL: any other unrecognised chip is still dropped', () => {
    expect(stillValidOffers([{ id: 'something-else', label: 'x', message: 'x' } as never], now)).toEqual([]);
  });
});

/**
 * THE REAL ROUTE: the only seams are the product's internal graph read, the provider's HTTP call (`fetch`, recorded) and
 * the TOOL DOUBLE (above) standing in for MG's tool side.
 */
const SCENARIO_BASE = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e';
let n = 0;
let SCENARIO = '';
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});
/** What the TOOL DOUBLE received on each call: the `chosen` the route bound, if any. */
const toolSaw: { chosen: unknown }[] = [];
vi.mock('../runtime/agent-capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../runtime/agent-capabilities.js')>();
  return {
    ...actual,
    createAgentCapabilities: (...args: Parameters<typeof actual.createAgentCapabilities>) => ({
      ...actual.createAgentCapabilities(...args),
      proposeNewRisk: async (ctx: { chosen?: unknown }) => {
        toolSaw.push({ chosen: ctx.chosen });
        return refusal(DIRECTION_CHOICES);
      },
    }),
  };
});

describe('the real route: refusal → chips; press → the tool first, with the reading', () => {
  let app: FastifyInstance;
  let modelBodies: Record<string, unknown>[] = [];
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelBodies.push(body);
      const input = JSON.stringify(body['input'] ?? '');
      // First call of a turn: add the risk. After its result: one plain sentence.
      if (!input.includes('function_call_output')) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'propose_new_risk', call_id: `c${modelBodies.length}`,
          arguments: JSON.stringify({ label: 'Supplier delay', threatens: ['Velocity'], rationale: 'They named it.' }) }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'Which way does it act on the goal?' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: { nodes: [{ id: 'goal_velocity', kind: 'goal', label: 'Velocity' }, { id: 'fac_team', kind: 'factor', label: 'Team size' }], edges: [] },
      graph_hash: 'h1', analysis_ready: { status: 'needs_user_input', may_run: false }, analysis_state: {},
    }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelBodies = []; toolSaw.length = 0; n += 1; SCENARIO = `${SCENARIO_BASE}${String(n).padStart(2, '0')}`; });

  const turn = async (payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, ...payload } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as { suggested_actions: { id: string; label: string }[] };
  };

  it('RED: the tool refuses with two choices → the reply offers exactly those two buttons, in the tool\'s words', async () => {
    const b = await turn({ message: 'Add a supplier delay risk.' });
    const choices = b.suggested_actions.filter((a) => a.id.startsWith(AGENT_CHOICE_PREFIX));
    expect(choices).toEqual([
      expect.objectContaining({ id: 'agent-choice:propose_new_risk:direction:negative', label: 'It makes the goal worse' }),
      expect.objectContaining({ id: 'agent-choice:propose_new_risk:direction:positive', label: 'It makes the goal better' }),
    ]);
    expect(toolSaw).toEqual([{ chosen: undefined }]);
  });

  it('RED: the press → the first provider request must call that tool, and the tool receives the reading', async () => {
    await turn({ message: 'It makes the goal worse', source: 'chip', chip: { id: 'agent-choice:propose_new_risk:direction:negative' } });
    expect(modelBodies[0]!['tool_choice']).toEqual({ type: 'function', name: 'propose_new_risk' });
    expect(toolSaw[0]).toEqual({ chosen: { tool: 'propose_new_risk', field: 'direction', value: 'negative' } });
  });

  it('CONTROL: the same words TYPED → nothing is forced and the tool receives no reading', async () => {
    await turn({ message: 'It makes the goal worse' });
    expect(modelBodies.length, 'the control reached the model').toBeGreaterThan(0);
    expect(modelBodies.every((q) => q['tool_choice'] === undefined)).toBe(true);
    expect(toolSaw.every((s) => s.chosen === undefined)).toBe(true);
  });

  it('CONTROL: a forged id naming a tool the Agent does not carry → nothing is forced, no reading', async () => {
    await turn({ message: 'x', source: 'chip', chip: { id: 'agent-choice:drop_table:direction:negative' } });
    expect(modelBodies.every((q) => q['tool_choice'] === undefined)).toBe(true);
    expect(toolSaw.every((s) => s.chosen === undefined)).toBe(true);
  });
});
