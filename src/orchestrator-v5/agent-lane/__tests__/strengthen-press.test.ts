/**
 * ⭐ M1 — "STRENGTHEN THE MODEL" OPENS ONE CARD, WITH NO MODEL CALL (PTL 5938801653 #1; brief CODEX-M1-NOW @28cbdc2b).
 *
 * R3's baseline (5933558156, D1): the press gave a good challenge but NO card (no typed action, a `C0_identical` rerun,
 * 37.1 s). The graph here is RC's banked served D1 Run turn (`m1-s1-served-graphs.json`, capture `d1-sprint-1149Z-11-
 * s5-run.json`), with the served option participation (`split_sprint_capacity` excluded by Olumi).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { randomUUID } from 'node:crypto';
import served from './fixtures/m1-s1-served-graphs.json';
import { strengthenCardFor, STRENGTHEN_PRESS_CHIP_ID } from '../strengthen-press.js';
import { chipOperationOf, NEXT_STEP_CHIPS, sameAgentTurnRequest, withChipOperation } from '../../../routes/agent-v1-turn.js';
import { linkStrengthCardFor } from '../approval-chips.js';

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
  it('the approval card is the STORED proposal\'s, bound by its id and to link strengths only', () => {
    const stored = (id: string, op: string) => ({ proposal_id: id, public_label: 'Record this link strength: "A" \u2192 "B" as moderate, Olumi\u2019s estimate',
      operations: [{ op, path: 'a::b', value: {} }] }) as never;
    expect(linkStrengthCardFor('p1', stored('p1', 'set_link_strength'))).toBe('Record this link strength: "A" \u2192 "B" as moderate, Olumi\u2019s estimate');
    expect(linkStrengthCardFor('p1', stored('p2', 'set_link_strength')), 'another proposal\'s card').toBeUndefined();
    expect(linkStrengthCardFor('p1', stored('p1', 'set_factor_value')), 'not a link-strength proposal').toBeUndefined();
    expect(linkStrengthCardFor('p1', undefined)).toBeUndefined();
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
  // The latest answer row's carrier, as `supabase-store.ts` reads it after a restart (rehydration of the stored proposal).
  readMostRecentPendingActions: vi.fn(async (sid: string) => [...rows.entries()].filter(([k]) => k.startsWith(`${sid}:`)).at(-1)?.[1].pending_actions ?? []),
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

  /** RC's S1 card as `proposeLinkStrengths` stores it: the link, its band and whose estimate (CODEX P1 #2 on #2481). */
  const CARD = 'Record this link strength: "Sprint capacity for AI reporting" \u2192 "AI reporting module availability" as moderate, Olumi\u2019s estimate';
  const approveOf = (b: Body) => (b.suggested_actions as { id: string; detail?: string }[]).find((a) => a.id.startsWith('agent-approve-proposal:'));

  it('RED (P1 #2): the approval carries the STORED card — the link, its band, "Olumi\'s estimate" — on the wire', async () => {
    const b = await press();
    expect(approveOf(b)?.detail).toBe(CARD);
  });

  it('RED (P1 #2): a lost response retried with the same turn_id replays the same card', async () => {
    const turn_id = randomUUID();
    const first = await press({ turn_id });
    const again = await press({ turn_id });
    expect(approveOf(again)?.id).toBe(approveOf(first)?.id);
    expect(approveOf(again)?.detail).toBe(CARD);
    expect(modelCalls).toBe(0);
  });

  it('RED (P1 #2): the same replay on a RESTARTED process (no memory) rebuilds the card from the stored proposal', async () => {
    const turn_id = randomUUID();
    const first = await press({ turn_id });
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const fresh = Fastify({ logger: false });
    fresh.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: D1.graph, graph_hash: 'h-d1', analysis_ready: { status: 'ready', may_run: true },
      analysis_state: analysisState, analysis_option_participation: PARTICIPATION,
    }));
    fresh.post('/orchestrate/v2/turn', async () => ({ assistant_text: 'ok', blocks: [] }));
    await fresh.register(agentV1TurnRoute);
    await fresh.ready();
    const chip = NEXT_STEP_CHIPS.find((c) => c.id === STRENGTHEN_PRESS_CHIP_ID)!;
    const r = await fresh.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'chip', chip: { id: chip.id }, turn_id } });
    await fresh.close();
    expect(r.statusCode, r.body).toBe(200);
    const again = r.json() as Body;
    expect(approveOf(again)?.id).toBe(approveOf(first)?.id);
    expect(approveOf(again)?.detail).toBe(CARD);
  });

  /** DL P2 on #2481: the press and the same words typed are DIFFERENT requests, so a reused turn_id refuses both ways. */
  const typed = (turn_id: string) => app.inject({ method: 'POST', url: '/agent/v1/turn',
    payload: { kind: 'message', scenario_id: SCENARIO, message: NEXT_STEP_CHIPS.find((c) => c.id === STRENGTHEN_PRESS_CHIP_ID)!.message, turn_id } });
  it('RED (DL P2): press, then the same words TYPED under the same turn_id → TURN_ID_REUSED, never the card replayed', async () => {
    const turn_id = randomUUID();
    await press({ turn_id });
    const r = await typed(turn_id);
    expect(r.statusCode, r.body).toBe(409);
    expect((r.json() as { error?: string }).error).toBe('TURN_ID_REUSED');
  });
  it('RED (DL P2): typed first, then the PRESS under the same turn_id → TURN_ID_REUSED, never the typed answer replayed', async () => {
    const turn_id = randomUUID();
    expect((await typed(turn_id)).statusCode).toBe(200);
    const chip = NEXT_STEP_CHIPS.find((c) => c.id === STRENGTHEN_PRESS_CHIP_ID)!;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'chip', chip: { id: chip.id }, turn_id } });
    expect(r.statusCode, r.body).toBe(409);
    expect((r.json() as { error?: string }).error).toBe('TURN_ID_REUSED');
  });
  it('RED (Codex pre-review P1): the UI\'s own retry of the press — same turn_id, `source: \'retry\'`, NO chip (DGAI buildPayload) — replays the card', async () => {
    const turn_id = randomUUID();
    const first = await press({ turn_id });
    const chip = NEXT_STEP_CHIPS.find((c) => c.id === STRENGTHEN_PRESS_CHIP_ID)!;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'retry', turn_id } });
    expect(r.statusCode, r.body).toBe(200);
    const again = r.json() as Body;
    expect(approveOf(again)?.id).toBe(approveOf(first)?.id);
    expect(approveOf(again)?.detail).toBe(CARD);
    expect(modelCalls).toBe(0);
  });
  it('CONTROL: the typed words retried under the same turn_id still replay (an ordinary message hashes as before)', async () => {
    const turn_id = randomUUID();
    const first = await typed(turn_id);
    const again = await typed(turn_id);
    expect(again.statusCode, again.body).toBe(200);
    expect((again.json() as Body).assistant_text).toBe((first.json() as Body).assistant_text);
  });
  it('the same request: exact; or a chipless UI retry of the recorded press of the same words — nothing else', () => {
    const plain = 'agent_turn:aaa';
    const pressed = withChipOperation(plain, chipOperationOf({ chip: { id: STRENGTHEN_PRESS_CHIP_ID } }));
    expect(pressed).not.toBe(plain);
    expect(withChipOperation(plain, undefined)).toBe(plain);
    expect(sameAgentTurnRequest(pressed, pressed, false)).toBe(true);
    expect(sameAgentTurnRequest(plain, plain, false)).toBe(true);
    expect(sameAgentTurnRequest(pressed, plain, true), 'the UI retry of the press').toBe(true);
    expect(sameAgentTurnRequest(pressed, plain, false), 'the same words typed').toBe(false);
    expect(sameAgentTurnRequest(plain, pressed, true), 'a press after typed words').toBe(false);
    const other = withChipOperation(plain, chipOperationOf({ chip: { id: 'agent-next-pre-mortem' } }));
    expect(sameAgentTurnRequest(pressed, other, true), 'another chip, even on a retry').toBe(false);
    expect(sameAgentTurnRequest(withChipOperation('agent_turn:bbb', chipOperationOf({ chip: { id: 'x' } })), plain, true), 'other words').toBe(false);
  });
  it('the chip operation: none without a chip; the same chip → the same; another id or action → another', () => {
    expect(chipOperationOf({ message: 'x' })).toBeUndefined();
    expect(chipOperationOf({ chip: null })).toBeUndefined();
    expect(chipOperationOf({ chip: { id: 'agent-next-strengthen' } })).toBe(chipOperationOf({ chip: { id: 'agent-next-strengthen' } }));
    expect(chipOperationOf({ chip: { id: 'agent-next-strengthen' } })).not.toBe(chipOperationOf({ chip: { id: 'agent-next-pre-mortem' } }));
    expect(chipOperationOf({ chip: { id: 'a', action_type: 'run_analysis' } })).not.toBe(chipOperationOf({ chip: { id: 'a' } }));
    expect(chipOperationOf({ chip: {} })).toBeDefined();
  });

  /** DL 5941839936: the suggestion preview rides the press that offers the card, from the STORED proposal it names. */
  type Previewed = Body & { proposal_preview?: { proposal_id: string; ops: unknown[] } };
  it('RED (preview): the press carries `proposal_preview` for the card\'s OWN proposal: the link and its band, nothing else', async () => {
    const b = await press() as Previewed;
    const id = approveOf(b)!.id.slice('agent-approve-proposal:'.length);
    // The press sizes an Olumi placeholder at the band it already has: a KEEP, so the ghost confirms rather than changes.
    expect(b.proposal_preview).toEqual({ proposal_id: id, ops: [{ op: 'set_link_strength', from_id: AI.from, to_id: AI.to, band: 'moderate', keeps: true }] });
  });
  it('NEGATIVE (preview): a replay of the press carries none; nor does a typed follow-up that does not re-offer the card', async () => {
    const turn_id = randomUUID();
    await press({ turn_id });
    const again = await press({ turn_id }) as Previewed;
    expect(again.proposal_preview).toBeUndefined();
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Tell me more.' } });
    expect((r.json() as Previewed).proposal_preview).toBeUndefined();
  });
  it('NEGATIVE (preview): the approve press offers no consent chip of its own, so it carries no preview (Codex P2: no settlement is claimed)', async () => {
    const b = await press();
    const chip = approveOf(b)!;
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: (chip as { message?: string }).message ?? 'Yes', source: 'chip', chip: { id: chip.id } } });
    const after = r.json() as Previewed;
    expect(after.suggested_actions.some((a) => a.id === chip.id), 'precondition: the chip is not re-offered').toBe(false);
    expect(after.proposal_preview).toBeUndefined();
  });

  // ⭐ S-B (ACTION-SYSTEM §D5/§E4, PL + DL binding, 7 Oct): Strengthen ships in its S1 scope with NO free-LLM fallback. This row
  // pinned the old fallback ("today's answer: the model is called"); the spec now is a typed "can't yet" with a working exit.
  it('S-B: the same press on a STALE Run → a typed "can\'t yet" (no model call, no card), the Run as its exit', async () => {
    analysisState = STALE;
    const b = await press();
    expect(modelCalls).toBe(0);
    expect(b._diagnostic_trace?.fast_path).toBe('method');
    expect(b.assistant_text).toBe('I can’t strengthen the model yet: it needs a current analysis first.');
    expect(b._agent?.tool_calls ?? []).toEqual([]);
  });

  it('CONTROL: the same words TYPED (no chip) → the model answers; no fast card', async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What would most strengthen this model?' } });
    expect(r.statusCode, r.body).toBe(200);
    expect(modelCalls).toBeGreaterThan(0);
    expect((r.json() as Body)._diagnostic_trace?.fast_path).toBeUndefined();
  });
});
