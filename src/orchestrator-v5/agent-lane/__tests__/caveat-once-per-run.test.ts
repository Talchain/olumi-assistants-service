/**
 * ⭐ THE PROVISIONAL CAVEAT ONCE PER RUN (AIQ #75 5925678816 (A); lease #85 5926691199).
 *
 * Served R3 `train-0545Z` (CEE `3b0537c1`): the same 35-word caveat led the Run reply AND the four replies after it
 * (inspect, link-size, adopt, answer), none of which named an option — 140 repeated words.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { withCaveatOncePerRun, resetCaveatRecordForTests, runAtOf } from '../caveat-once.js';
import { PROVISIONAL_FIGURES_CAVEAT, PROVISIONAL_FIGURES_CAVEATS } from '../../compose/leading-option-wire-enforcement.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/served-caveat-repeats-train-0545Z.json', import.meta.url), 'utf8')) as {
  turns: { step: string; ran: boolean; run_at: string; served_assistant_text: string }[];
  cold_read: Rec & { graph: { nodes: Rec[]; edges: Rec[] }; analysis_state: Rec };
};
const G = FX.cold_read.graph;
const RUN_AT = FX.turns[0]!.run_at;
const state = (at: string) => ({ run_state: { kind: 'complete_current', computed_at: at } });
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;
const turn = (o: { ranThisTurn?: boolean; at?: string; scenarioId?: string } = {}) =>
  ({ scenarioId: o.scenarioId ?? 's-1', ranThisTurn: o.ranThisTurn ?? false, analysisState: state(o.at ?? RUN_AT), graph: G });
const RUN_REPLY = `${PROVISIONAL_FIGURES_CAVEAT}\n\nAngel investor outreach provisionally leads the comparison.`;
const LATER = `${PROVISIONAL_FIGURES_CAVEAT}\n\nIt is an Olumi-inferred positive link; its strength is a placeholder.`;

beforeEach(() => resetCaveatRecordForTests());

describe('the served sequence (R3 train-0545Z): the caveat once, on the Run reply', () => {
  it('PRECONDITION: all five served replies open with the SAME caveat, for the SAME Run, and the four later ones name no option', () => {
    expect(FX.turns.map((t) => t.served_assistant_text.startsWith(PROVISIONAL_FIGURES_CAVEAT))).toEqual([true, true, true, true, true]);
    expect(new Set(FX.turns.map((t) => t.run_at)).size).toBe(1);
    expect(runAtOf(FX.cold_read.analysis_state)).toBe(RUN_AT);
    expect(words(PROVISIONAL_FIGURES_CAVEAT)).toBe(35);
  });

  it('RED: the Run reply keeps it; each of the four later replies drops it, word for word otherwise — 140 words fewer', () => {
    const out = FX.turns.map((t) => withCaveatOncePerRun(t.served_assistant_text, turn({ ranThisTurn: t.ran, at: t.run_at })));
    expect(out[0]).toBe(FX.turns[0]!.served_assistant_text);
    for (const [i, t] of FX.turns.entries()) {
      if (i === 0) continue;
      expect(out[i]).toBe(t.served_assistant_text.slice(PROVISIONAL_FIGURES_CAVEAT.length).replace(/^\s+/, ''));
    }
    const saved = FX.turns.reduce((n, t, i) => n + words(t.served_assistant_text) - words(out[i]!), 0);
    expect(saved).toBe(140);
  });
});

describe('it is said again whenever it carries news (AIQ: "again only when the provisional state changes")', () => {
  it('CONTROL: a later reply that NAMES an option keeps its qualifier', () => {
    withCaveatOncePerRun(RUN_REPLY, turn({ ranThisTurn: true }));
    const naming = `${PROVISIONAL_FIGURES_CAVEAT}\n\nCompared with "Continue current outreach", the pilot has no result.`;
    expect(withCaveatOncePerRun(naming, turn())).toBe(naming);
  });

  it('DL 5926719387: the ENFORCER\'s own detector decides — a partial label, an ordinal, a pronoun claim all KEEP it', () => {
    for (const claim of [
      'Angel outreach looks stronger on these figures.', // a partial label ("Angel investor outreach" / "Angel outreach pilot")
      'The first option comes out ahead.', // an ordinal
      'That one wins on these estimates.', // a pronoun after a label said earlier
      'The first option is better.', // the enforcer reads this as no ranking: kept by the option-cue + comparison safe keep
    ]) {
      resetCaveatRecordForTests();
      withCaveatOncePerRun(RUN_REPLY, turn({ ranThisTurn: true }));
      const reply = `${PROVISIONAL_FIGURES_CAVEAT}\n\n${claim}`;
      expect(withCaveatOncePerRun(reply, turn()), claim).toBe(reply);
    }
  });

  it('CONTROL: a turn that RAN keeps it even on the same Run with no option named', () => {
    withCaveatOncePerRun(LATER, turn({ ranThisTurn: true }));
    expect(withCaveatOncePerRun(LATER, turn({ ranThisTurn: true }))).toBe(LATER);
  });

  it('CONTROL: a NEW Run (another computed_at) → said again, and the new Run is recorded', () => {
    withCaveatOncePerRun(RUN_REPLY, turn({ ranThisTurn: true }));
    const later = turn({ at: '2026-10-01T05:49:42.000Z' });
    expect(withCaveatOncePerRun(LATER, later)).toBe(LATER);
    expect(withCaveatOncePerRun(LATER, later)).not.toContain(PROVISIONAL_FIGURES_CAVEAT);
  });

  it('CONTROL: a CHANGED cause (another caveat string) → said', () => {
    withCaveatOncePerRun(RUN_REPLY, turn({ ranThisTurn: true }));
    const other = PROVISIONAL_FIGURES_CAVEATS.find((c) => c !== PROVISIONAL_FIGURES_CAVEAT)!;
    expect(other).toBeDefined();
    const changed = `${other}\n\nIt is an Olumi-inferred positive link.`;
    expect(withCaveatOncePerRun(changed, turn())).toBe(changed);
  });

  it('CONTROL: nothing recorded (a restart, another instance) or another scenario → said', () => {
    expect(withCaveatOncePerRun(LATER, turn())).toBe(LATER);
    resetCaveatRecordForTests();
    withCaveatOncePerRun(RUN_REPLY, turn({ ranThisTurn: true, scenarioId: 's-other' }));
    expect(withCaveatOncePerRun(LATER, turn())).toBe(LATER);
  });

  it('CONTROL: a turn that RAN always carries it, and a reply that is only the caveat keeps it', () => {
    withCaveatOncePerRun(RUN_REPLY, turn({ ranThisTurn: true }));
    expect(withCaveatOncePerRun(RUN_REPLY, turn({ ranThisTurn: true }))).toBe(RUN_REPLY);
    expect(withCaveatOncePerRun(PROVISIONAL_FIGURES_CAVEAT, turn())).toBe(PROVISIONAL_FIGURES_CAVEAT);
  });

  it('no Run on record → unchanged and nothing recorded', () => {
    const none = { scenarioId: 's-1', ranThisTurn: false, analysisState: {}, graph: G };
    expect(withCaveatOncePerRun(LATER, none)).toBe(LATER);
    expect(withCaveatOncePerRun(LATER, turn())).toBe(LATER);
  });
});

// ── The route: two message turns on the served cold read, model stubbed (0 LLM) ──
const rows = new Map<string, Rec>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, tid: string) => rows.get(`${sid}|${tid}`) ?? null),
  append: vi.fn(async (w: Rec) => { rows.set(`${String(w.scenario_id)}|${String(w.turn_id)}`, { ...w, assistant_message: w.assistantMessage ?? null }); return { id: `row-${rows.size}` }; }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('on the wire: the second reply on the same Run drops the caveat; the answer row and a replay say the same', () => {
  let app: FastifyInstance;
  let modelSays = 'It is an Olumi-inferred positive link; its strength is a placeholder.';
  let n = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: modelSays }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ ...JSON.parse(JSON.stringify(FX.cold_read)), graph_hash: 'h0' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { modelSays = 'It is an Olumi-inferred positive link; its strength is a placeholder.'; n += 1; });
  const sid = () => `9c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e${String(n).padStart(2, '0')}`;
  const say = async (scenario: string, turnId?: string) => (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    ...(turnId !== undefined ? { turn_id: turnId } : {}), kind: 'message', source: 'composer', scenario_id: scenario, message: 'Tell me more.',
  } })).json() as { assistant_text: string };

  it('PRECONDITION + RED: the first reply opens with the caveat; the second on the same Run does not; its replay is byte-identical', async () => {
    const s = sid();
    const first = (await say(s)).assistant_text;
    expect(first.startsWith(PROVISIONAL_FIGURES_CAVEAT)).toBe(true);
    const turnId = '7e2f9a3b-4c5d-4e6f-8a7b-8c9d0e1f2a3b';
    const second = (await say(s, turnId)).assistant_text;
    expect(second).not.toContain(PROVISIONAL_FIGURES_CAVEAT);
    expect(second).toContain('placeholder');
    expect((await say(s, turnId)).assistant_text).toBe(second);
  });

  it('CONTROL: the second reply names an option → it keeps the caveat', async () => {
    const s = sid();
    await say(s);
    modelSays = 'Angel investor outreach still leads on Olumi\'s estimates.';
    expect((await say(s)).assistant_text.startsWith(PROVISIONAL_FIGURES_CAVEAT)).toBe(true);
  });
});
