/**
 * ⭐ M1 — "STRENGTHEN THE MODEL" OPENS ONE CARD, WITH NO MODEL CALL (PTL 5938801653 #1; brief CODEX-M1-NOW @28cbdc2b).
 *
 * R3's baseline (5933558156, D1): the press gave a good challenge but NO card (no typed action, a `C0_identical` rerun,
 * 37.1 s). The graph here is RC's banked served D1 Run turn (`m1-s1-served-graphs.json`, capture `d1-sprint-1149Z-11-
 * s5-run.json`), with the served option participation (`split_sprint_capacity` excluded by Olumi).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import served from './fixtures/m1-s1-served-graphs.json';
import { strengthenCardFor, STRENGTHEN_PRESS_CHIP_ID } from '../strengthen-press.js';
import { NEXT_STEP_CHIPS } from '../../../routes/agent-v1-turn.js';

const D1 = served.cases.find((c) => c.id === 'D1-sprint-run')!;
const D3 = served.cases.find((c) => c.id === 'D3-cost-run')!;
const CURRENT = { run_state: { kind: 'complete_current', computed_at: '2026-10-01T11:52:22.669Z' } };
const STALE = { run_state: { kind: 'complete_stale', computed_at: '2026-10-01T11:52:22.669Z' } };
const PARTICIPATION = [{ option_id: 'split_sprint_capacity', state: 'excluded_olumi_proposed' }];
const label = (g: { nodes: { id: string; label?: string }[] }, id: string) => g.nodes.find((n) => n.id === id)!.label!;
const AI = { from: 'sprint_capacity_for_ai_reporting', to: 'ai_reporting_module_availability' };

describe('the card for a press (pure)', () => {
  it('RED: served D1, current Run → ONE link (the S1 pick), its current band, no from_words; RC\'s S1 copy', () => {
    const card = strengthenCardFor({ graph: structuredClone(D1.graph), analysisState: CURRENT, optionParticipation: PARTICIPATION });
    expect(card).not.toBeNull();
    expect({ from_id: card!.target.from_id, to_id: card!.target.to_id }).toEqual(D1.expect);
    expect(card!.args).toEqual({
      links: [{ from_label: label(D1.graph, AI.from), to_label: label(D1.graph, AI.to), strength: 'moderate' }],
      rationale: expect.any(String),
    });
    expect(card!.args.links[0]).not.toHaveProperty('from_words');
    expect(card!.text.split('\n\n')).toEqual([
      'The comparison rests on a link nobody has sized yet.',
      // RC's mid-sentence rule lowers 'Sprint…' but keeps the acronym in 'AI reporting…' (render.ts `midSentence`).
      'How much does sprint capacity for AI reporting really change AI reporting module availability? The comparison turns on it.',
    ]);
  });
  it('an option the Run took out never supplies the link, even one nearer the goal (the comparison\'s options only)', () => {
    type G = { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] };
    const g = structuredClone(D1.graph) as unknown as G;
    const goal = g.nodes.find((x) => x.kind === 'goal')!.id as string;
    const template = g.nodes.find((x) => x.id === 'ai_reporting_module_sprint')!;
    g.nodes.push({ ...structuredClone(template), id: 'taken_out_option', label: 'Taken-out option', interventions: { taken_out_lever: 1 } },
      { id: 'taken_out_lever', kind: 'factor', label: 'Taken-out lever' });
    g.edges.push({ from: 'taken_out_option', to: 'taken_out_lever', strength: { mean: 1 } },
      { from: 'taken_out_lever', to: goal, strength: { mean: 0.25 }, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_placeholder' } });
    const taken = [...PARTICIPATION, { option_id: 'taken_out_option', state: 'excluded_olumi_proposed' }];
    const pick = (participation: unknown) => {
      const c = strengthenCardFor({ graph: structuredClone(g), analysisState: CURRENT, optionParticipation: participation });
      return c === null ? null : `${c.target.from_id}->${c.target.to_id}`;
    };
    expect(pick(taken)).toBe(`${AI.from}->${AI.to}`);
    // Control: the same option IN the comparison supplies its nearer link.
    expect(pick(PARTICIPATION)).toBe(`taken_out_lever->${goal}`);
  });
  it('CONTROL: the same graph on a STALE Run → null (the press keeps today\'s answer)', () => {
    expect(strengthenCardFor({ graph: structuredClone(D1.graph), analysisState: STALE, optionParticipation: PARTICIPATION })).toBeNull();
  });
  it('CONTROL: no Run state at all → null', () => {
    expect(strengthenCardFor({ graph: structuredClone(D1.graph) })).toBeNull();
  });
  it('CONTROL: served D3 (no placeholder on an analysed path) → null', () => {
    expect(strengthenCardFor({ graph: structuredClone(D3.graph), analysisState: CURRENT })).toBeNull();
  });
  it('CONTROL: an unreadable graph → null, never a throw', () => {
    expect(strengthenCardFor({ graph: { nodes: 'x' }, analysisState: CURRENT })).toBeNull();
  });
  it('the press chip is the product\'s own "Strengthen the model" next step', () => {
    expect(NEXT_STEP_CHIPS.map((c) => c.id)).toContain(STRENGTHEN_PRESS_CHIP_ID);
  });
});

/** THE REAL ROUTE: only the product's internal graph read and the provider's HTTP call (`fetch`, counted) are seams. */
const SCENARIO_BASE = '7d2e3f40-5b6c-4d7e-8f90-a1b2c3d4e5';
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

describe('the real route: the press → ONE held card, 0 model calls', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  let analysisState: unknown = CURRENT;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'A grounded challenge with no card.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: D1.graph, graph_hash: 'h-d1', analysis_ready: { status: 'ready', may_run: true },
      analysis_state: analysisState, analysis_option_participation: PARTICIPATION,
    }));
    app.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelCalls = 0; analysisState = CURRENT; n += 1; SCENARIO = `${SCENARIO_BASE}${String(n).padStart(2, '0')}`; });

  type Body = { assistant_text: string; suggested_actions: { id: string }[]; _agent?: { tool_calls?: { name: string; proposal_id?: string }[] }; _diagnostic_trace?: { fast_path?: string } };
  const press = async (payload: Record<string, unknown> = {}) => {
    const chip = NEXT_STEP_CHIPS.find((c) => c.id === STRENGTHEN_PRESS_CHIP_ID)!;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'chip', chip: { id: chip.id }, ...payload } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Body;
  };

  it('RED: the press on a current Run → RC\'s S1 copy, ONE propose_link_strengths held for approval, its approve + amend chips, 0 model calls', async () => {
    const b = await press();
    expect(modelCalls).toBe(0);
    // RC's fixed copy, exactly: nothing narrated around it.
    expect(b.assistant_text).toBe('The comparison rests on a link nobody has sized yet.\n\nHow much does sprint capacity for AI reporting really change AI reporting module availability? The comparison turns on it.');
    expect(b._agent?.tool_calls?.map((c) => c.name)).toEqual(['propose_link_strengths']);
    const proposalId = b._agent!.tool_calls![0]!.proposal_id;
    expect(typeof proposalId).toBe('string');
    const ids = b.suggested_actions.map((a) => a.id);
    expect(ids.some((id) => id.startsWith('agent-approve-proposal') && id.includes(proposalId!))).toBe(true);
    expect(ids).toContain('agent-amend-proposal');
    expect(b._diagnostic_trace?.fast_path).toBe('strengthen');
  });

  it('CONTROL: the same press on a STALE Run → today\'s answer (the model is called, no card)', async () => {
    analysisState = STALE;
    const b = await press();
    expect(modelCalls).toBeGreaterThan(0);
    expect(b._diagnostic_trace?.fast_path).toBeUndefined();
  });

  it('CONTROL: the same words TYPED (no chip) → the model answers; no fast card', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What would most strengthen this model?' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(modelCalls).toBeGreaterThan(0);
    expect((r.json() as Body)._diagnostic_trace?.fast_path).toBeUndefined();
  });
});
