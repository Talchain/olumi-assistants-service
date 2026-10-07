import { legacyDoorGraph } from './licence-test-graphs.js';
/**
 * ⭐ T2 — THE GUIDANCE ROW ON THE WIRE (M1; AI HARNESS lease 5940322790, DL 5940323402). On RC's banked served D1 Run
 * (`m1-s1-served-graphs.json`), a typed turn carries root `guidance.slot1` = RC-STRENGTHEN-ITEM S1, with `item_ref`
 * naming the unsized link BY ID, in the exact snake_case shape PANEL's `readGuidanceRow` reads (DGAI
 * `panel/t4-guidance-row` @56e55a4b: a row needs `policy_id`, `state_key_hash` and `copy.title`).
 * No row rides a Run result, a method press, a decision point, a turn with no text, or a replay.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import served from './fixtures/m1-s1-served-graphs.json';
import { guidanceLeaderLicensed, guidanceRequestOf, itemRefOf, turnGuidanceFor, type TurnGuidanceInputs } from '../turn-context/guidance-wire.js';
import { NEXT_STEP_CHIPS } from '../../../routes/agent-v1-turn.js';
import { guidanceHistoryOf, type AnswerGuidance } from '../turn-context/guidance-history.js';
import { entryKey } from '../guidance/index.js';

// Science 393023 LICENCE (a)/(b), 7 Oct: std 0.125 → 0.1 on a clone preserves this independent claim; captured bytes stay unchanged.
const D1_SERVED = served.cases.find((c) => c.id === 'D1-sprint-run')!;
const D1 = { ...D1_SERVED, graph: legacyDoorGraph(D1_SERVED.graph) };
// Science 393023 LICENCE (a)/(b), 7 Oct: std 0.125 → 0.1 on a clone preserves this independent claim; captured bytes stay unchanged.
const D3_SERVED = served.cases.find((c) => c.id === 'D3-cost-run')!;
const D3 = { ...D3_SERVED, graph: legacyDoorGraph(D3_SERVED.graph) };
const CURRENT = { run_state: { kind: 'complete_current', computed_at: '2026-10-01T11:52:22.669Z' } };
const PARTICIPATION = [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }];
const AI = { from: 'sprint_capacity_for_ai_reporting', to: 'ai_reporting_module_availability' };
const METHOD_IDS: ReadonlySet<string> = new Set(NEXT_STEP_CHIPS.map((c) => c.id));
const S1_ROW = {
  policy_id: 'RC-STRENGTHEN-ITEM',
  variant: 'S1',
  priority: 'P1',
  item: `${AI.from}->${AI.to}`,
  primary_action: { label: 'Give your estimate', action_kind: 'edit_inline', target: `${AI.from}->${AI.to}` },
  state_key_hash: expect.stringMatching(/^[0-9a-f]{12}$/),
  copy: {
    title: 'The comparison rests on a link nobody has sized yet.',
    why: "Until it is sized, Olumi can't compare the options on your goal.",
    question: 'How much does sprint capacity for AI reporting really change AI reporting module availability? The comparison turns on it.',
  },
  item_ref: { kind: 'link', from_id: AI.from, to_id: AI.to },
};

const inputs = (over: Partial<TurnGuidanceInputs> = {}): TurnGuidanceInputs => ({
  request: 'turn', offeredSpecific: [], assistantText: 'Here is where the comparison stands.', licence: 'withheld',
  state: { graph: structuredClone(D1.graph), analysisState: CURRENT, optionParticipation: PARTICIPATION }, ...over,
});

describe('T2 — the row (pure)', () => {
  it('RED: served D1, current Run, a typed turn → slot1 = RC-STRENGTHEN-ITEM S1 with item_ref BY ID; no slot2', () => {
    const g = turnGuidanceFor(inputs());
    expect(g).toEqual({ slot1: S1_ROW });
  });
  it('the licence never changes this row (S1 names no option); a permitted Run gives the same row', () => {
    expect(turnGuidanceFor(inputs({ licence: 'permitted' }))).toEqual({ slot1: S1_ROW });
  });
  it('a row builds on the leader only on an unqualified licence: a caveated one carries a caveat no row has (fail closed)', () => {
    expect(guidanceLeaderLicensed('permitted')).toBe(true);
    expect(guidanceLeaderLicensed('permitted_with_caveat')).toBe(false);
    expect(guidanceLeaderLicensed('withheld')).toBe(false);
  });
  it('NEGATIVES: a Run result, a method press, a decision point → no row', () => {
    expect(turnGuidanceFor(inputs({ request: 'run_result' })), 'request 1').toBeUndefined();
    expect(turnGuidanceFor(inputs({ request: 'method' })), 'method').toBeUndefined();
    expect(turnGuidanceFor(inputs({ offeredSpecific: [{ id: 'agent-approve:p1' }] })), 'decision point').toBeUndefined();
  });
  it('NEGATIVE: a turn with no text carries no row (PANEL 5940333155: an empty turn renders as a failure)', () => {
    expect(turnGuidanceFor(inputs({ assistantText: '' }))).toBeUndefined();
    expect(turnGuidanceFor(inputs({ assistantText: '   ' }))).toBeUndefined();
    expect(turnGuidanceFor(inputs({ assistantText: undefined }))).toBeUndefined();
  });
  it('CONTROL: an unreadable graph → no row, never a throw', () => {
    expect(turnGuidanceFor(inputs({ state: { graph: { nodes: 'x' }, analysisState: CURRENT } }))).toBeUndefined();
  });
  it('the request: Run → run_result, explanation → narration, a next-step press → method, else turn', () => {
    expect(guidanceRequestOf('run', undefined, METHOD_IDS)).toBe('run_result');
    expect(guidanceRequestOf('explain', 'agent-explain-run:0123456789abcdef', METHOD_IDS)).toBe('narration');
    for (const c of NEXT_STEP_CHIPS) expect(guidanceRequestOf(undefined, c.id, METHOD_IDS), c.id).toBe('method');
    expect(guidanceRequestOf('strengthen', 'agent-next-strengthen', METHOD_IDS)).toBe('method');
    expect(guidanceRequestOf(undefined, undefined, METHOD_IDS)).toBe('turn');
    expect(guidanceRequestOf('approve', 'agent-approve:p1', METHOD_IDS)).toBe('turn');
  });
});

describe('item_ref — by identity in the same graph', () => {
  const g = { nodes: [{ id: 'f', kind: 'factor' }, { id: 'o', kind: 'option' }, { id: 'goal', kind: 'goal' }],
    edges: [{ from: 'f', to: 'goal' }, { from: 'o', to: 'f' }] };
  it('a factor by its node id; a link by its ends', () => {
    expect(itemRefOf('f', g)).toEqual({ kind: 'factor', factor_id: 'f' });
    expect(itemRefOf('f->goal', g)).toEqual({ kind: 'link', from_id: 'f', to_id: 'goal' });
  });
  it('NEGATIVES: a non-factor node, a link the graph lacks, no item, no graph → none', () => {
    expect(itemRefOf('o', g)).toBeUndefined();
    expect(itemRefOf('goal->f', g)).toBeUndefined();
    expect(itemRefOf(undefined, g)).toBeUndefined();
    expect(itemRefOf('f->goal', null)).toBeUndefined();
  });
  it('more than one entity answering to the item binds to NONE (Codex pre-review P1 ×2): Accept/Edit never acts on another', () => {
    const twins = { nodes: [], edges: [{ from: 'a->b', to: 'c' }, { from: 'a', to: 'b->c' }] };
    expect(itemRefOf('a->b->c', twins), 'two links spell it').toBeUndefined();
    const parallel = { nodes: [], edges: [{ from: 'a', to: 'b', provenance: { magnitude: 'olumi_placeholder' } }, { from: 'a', to: 'b' }] };
    expect(itemRefOf('a->b', parallel), 'parallel links').toBeUndefined();
    const spelled = { nodes: [{ id: 'f->goal', kind: 'factor' }, { id: 'f', kind: 'factor' }, { id: 'goal', kind: 'goal' }], edges: [{ from: 'f', to: 'goal' }] };
    expect(itemRefOf('f->goal', spelled), 'a factor id that spells a link').toBeUndefined();
    // Controls: the same graphs, an item exactly one entity answers to.
    expect(itemRefOf('a->b', { nodes: [], edges: [{ from: 'a', to: 'b' }] })).toEqual({ kind: 'link', from_id: 'a', to_id: 'b' });
    expect(itemRefOf('f', spelled)).toEqual({ kind: 'factor', factor_id: 'f' });
  });
});

/** THE REAL ROUTE. Seams: the internal graph read, the provider's HTTP call (`fetch`, counted), the session store, identity. */
const SCENARIO_BASE = '8e3f4a51-6c7d-4e8f-9a01-b2c3d4e5f6';
let n = 0;
let SCENARIO = '';
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[]; agent_guidance?: AnswerGuidance }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  readGuidanceHistory: vi.fn(async (sid: string) => guidanceHistoryOf([...rows.entries()].reverse()
    .filter(([key, row]) => key.startsWith(`${sid}:`) && row.agent_guidance !== undefined).map(([, row]) => row.agent_guidance))!),
  readMostRecentPendingActions: vi.fn(async (sid: string) => [...rows.entries()].filter(([k]) => k.startsWith(`${sid}:`)).at(-1)?.[1].pending_actions ?? []),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[]; agent_guidance?: AnswerGuidance }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])),
      ...(w.agent_guidance !== undefined ? { agent_guidance: structuredClone(w.agent_guidance) } : {}) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('the real route: the row rides the typed turn, and only it', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  // As served: a current Run the canonical state lets chips build on (`offersNextSteps`).
  const SERVED_CURRENT = { ...CURRENT, usable_for_chips: true };
  let analysisState: unknown = SERVED_CURRENT;
  let graph: unknown = D1.graph;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'The comparison is close on your goal.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph, graph_hash: 'h-d1', analysis_ready: { status: 'ready', may_run: true },
      analysis_state: analysisState, analysis_option_participation: PARTICIPATION,
    }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelCalls = 0; analysisState = SERVED_CURRENT; graph = D1.graph; n += 1; SCENARIO = `${SCENARIO_BASE}${String(n).padStart(2, '0')}`; });

  type Body = { assistant_text: string; guidance?: unknown; suggested_actions: { id: string }[] };
  const turn = async (payload: Record<string, unknown>) => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, ...payload } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Body;
  };
  const press = (id: string, extra: Record<string, unknown> = {}) => {
    const chip = NEXT_STEP_CHIPS.find((c) => c.id === id)!;
    return turn({ message: chip.message, source: 'chip', chip: { id: chip.id }, ...extra });
  };

  it('RED: a typed turn on the current D1 Run → root guidance.slot1 = RC-STRENGTHEN-ITEM S1, item_ref by id, beside non-empty text', async () => {
    const b = await turn({ message: 'Where does this leave me?' });
    expect(modelCalls).toBe(1);
    expect(b.assistant_text.trim()).not.toBe('');
    expect(b.guidance).toEqual({ slot1: S1_ROW });
    // DL 7 Oct: Paul's 'pills are static' ask supersedes the PANEL-T4 hold
    expect(b.suggested_actions).toEqual([{ ...NEXT_STEP_CHIPS[2], label: 'Give your estimate' }, NEXT_STEP_CHIPS[0], NEXT_STEP_CHIPS[1]]);
  });
  it('NEGATIVE: a method press with no specific control ("Run a pre-mortem") → no row (the method runs; no other is offered)', async () => {
    const b = await press('agent-next-pre-mortem');
    expect(b.guidance).toBeUndefined();
  });
  it('NEGATIVE: the Strengthen press (its held card is the decision point) → no row', async () => {
    const b = await press('agent-next-strengthen');
    expect(b.suggested_actions.some((a) => a.id.startsWith('agent-approve'))).toBe(true);
    expect(b.guidance).toBeUndefined();
  });
  it('NEGATIVE: a typed turn while the Strengthen card still waits for its yes → no row; the waiting card is the step', async () => {
    const held = await press('agent-next-strengthen');
    expect(held.suggested_actions.some((a) => a.id.startsWith('agent-approve-proposal:'))).toBe(true);
    const b = await turn({ message: 'Where does this leave me?' });
    // The route's own rule agrees: no next steps beside a proposal that would still execute (`offeredNow`).
    expect(b.suggested_actions.map((a) => a.id)).not.toContain('agent-next-strengthen');
    expect(b.guidance).toBeUndefined();
  });
  it('NEGATIVE: TWO proposals still waiting for their yes → no row (Codex pre-review P1: the one-proposal chip rule missed it)', async () => {
    const first = await press('agent-next-strengthen');
    // The first link is now sized (as after its Apply), so the next press holds a card on the OTHER placeholder.
    graph = { ...D1.graph, edges: D1.graph.edges.map((e) => (e.from === AI.from && e.to === AI.to
      ? { ...e, provenance: { ...e.provenance, magnitude: 'olumi_accepted' } } : e)) };
    const second = await press('agent-next-strengthen');
    const held = (b: Body) => b.suggested_actions.map((a) => a.id).filter((id) => id.startsWith('agent-approve-proposal:'));
    expect(held(first)).toHaveLength(1);
    expect(held(second)).toHaveLength(1);
    expect(held(second)).not.toEqual(held(first));
    const b = await turn({ message: 'Where does this leave me?' });
    expect(b.guidance).toBeUndefined();
  });
  it('NEGATIVE: a replay of the same turn_id carries no row (never on the answer row; PANEL restores from its transcript)', async () => {
    const turn_id = randomUUID();
    const first = await turn({ message: 'Where does this leave me?', turn_id });
    expect(first.guidance).toEqual({ slot1: S1_ROW });
    const again = await turn({ message: 'Where does this leave me?', turn_id });
    expect(again.assistant_text).toBe(first.assistant_text);
    expect(again.guidance).toBeUndefined();
  });
  it('CONTROL: the same typed turn on served D3 (no unsized link on an analysed path) → no Strengthen row', async () => {
    graph = D3.graph;
    const b = await turn({ message: 'Where does this leave me?' });
    expect(b.assistant_text.trim()).not.toBe('');
    expect((b.guidance as { slot1?: { policy_id?: string } } | undefined)?.slot1?.policy_id).not.toBe('RC-STRENGTHEN-ITEM');
  });
  it('records content-free surviving guidance WITH the final answer, including an unnamed turn', async () => {
    const b = await turn({ message: 'Where does this leave me?' });
    const key = entryKey('RC-STRENGTHEN-ITEM', `${AI.from}->${AI.to}`);
    const saved = [...rows.entries()].find(([k]) => k.startsWith(`${SCENARIO}:`))![1];
    expect(saved.assistant_message).toBe(b.assistant_text);
    expect(saved.agent_guidance).toEqual({ version: 1, entries: { [key]: {
      status: 'offered', state_key_hash: (b.guidance as { slot1: { state_key_hash: string } }).slot1.state_key_hash,
    } } });
    expect(JSON.stringify(saved.agent_guidance)).not.toContain(AI.from);
    expect((await turn({ message: 'What next?' })).guidance).toEqual(b.guidance); // offered is not settled
  });
  it('records a pressed event ONLY for the S1 item the successful held card actually targets', async () => {
    await turn({ message: 'Where does this leave me?' });
    await press('agent-next-strengthen');
    const events = [...rows.entries()].filter(([k]) => k.startsWith(`${SCENARIO}:`)).map(([, r]) => r.agent_guidance);
    const key = entryKey('RC-STRENGTHEN-ITEM', `${AI.from}->${AI.to}`);
    expect(guidanceHistoryOf(events.filter(e => e !== undefined).reverse())?.[key]?.status).toBe('pressed');
    expect(events.some(e => Object.values(e?.entries ?? {}).some(v => v.status === 'completed'))).toBe(false);
  });
  it('an unreadable history suppresses guidance while keeping the ordinary answer', async () => {
    store.readGuidanceHistory.mockRejectedValueOnce(new Error('database unavailable'));
    const b = await turn({ message: 'Where does this leave me?' });
    expect(b.assistant_text.trim()).not.toBe('');
    expect(b.guidance).toBeUndefined();
  });
  it('a new route instance consumes the same persisted settled entry, without reconstructing conversation history', async () => {
    const first = await turn({ message: 'Where does this leave me?' });
    const key = entryKey('RC-STRENGTHEN-ITEM', `${AI.from}->${AI.to}`);
    // A recorded event fixture; this verifies the real HTTP consumer, not a live DB/browser persistence claim.
    const saved = [...rows.entries()].find(([k]) => k.startsWith(`${SCENARIO}:`))![1];
    saved.agent_guidance = { version: 1, entries: { [key]: { status: 'dismissed',
      state_key_hash: (first.guidance as { slot1: { state_key_hash: string } }).slot1.state_key_hash } } };
    await app.close();
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph, graph_hash: 'h-d1',
      analysis_ready: { status: 'ready', may_run: true }, analysis_state: analysisState, analysis_option_participation: PARTICIPATION }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
    const next = await turn({ message: 'What next?' });
    expect((next.guidance as { slot1?: { item?: string } } | undefined)?.slot1?.item).not.toBe(`${AI.from}->${AI.to}`);
    expect(store.readGuidanceHistory).toHaveBeenCalledWith(SCENARIO);
  });
});

it('Science 393023: as-served D1 and D3 guidance names each new S1 link by ID', () => {
  for (const [c, from, to] of [[D1_SERVED, 'enterprise_prospect_signing_likelihood', 'quarterly_revenue'], [D3_SERVED, 'gcp_workload_share', 'monthly_cloud_savings']] as const) {
    const g = turnGuidanceFor(inputs({ state: { graph: structuredClone(c.graph), analysisState: CURRENT, optionParticipation: PARTICIPATION } }));
    expect(g?.slot1).toMatchObject({ policy_id: 'RC-STRENGTHEN-ITEM', variant: 'S1', item_ref: { kind: 'link', from_id: from, to_id: to } });
  }
});
