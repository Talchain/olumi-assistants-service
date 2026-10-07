/**
 * ⭐ L1 — OLUMI ASKS FOR THE SIZE OF THE LINK THE USER ASKED ABOUT, WHEN OLUMI HAS NOT SIZED IT (DL #75 5925649954 item 5;
 * R3 5925627855; AIQ words 5925678816 (B); CODEX smallest pair + collision class 5925779142).
 *
 * Served R3 `train-0545Z` step 05 (CEE `3b0537c1`): the user asked about "Qualified angel investor conversations" →
 * "securing funding" (a placeholder: no `provenance.magnitude`, no natural effect). The reply said "a default placeholder"
 * and asked nothing; the user volunteered £20,000 only on the next turn.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { linkSizeAsk } from '../link-size-ask.js';
import { sizedLinkTest } from '../../../orchestrator/context/placeholder-parts.js';
import { textAtRest } from '../decision-input-ask.js';

type Rec = Record<string, unknown>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/served-link-inspect-train-0545Z.json', import.meta.url), 'utf8')) as {
  message: string; served_assistant_text: string; model_text: string; graph: { nodes: Rec[]; edges: Rec[] };
};
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const ASK = 'How much does one more "Qualified angel investor conversations" add to "securing funding", in £?';
const at = (text: string) => ({ message: FX.message, restingText: textAtRest(text), awaitingApproval: false });
const isAngel = (e: Rec) => e.from === 'qualified_angel_investor_conversations' && e.to === 'securing_funding';
const withAngel = (patch: (e: Rec) => Rec, g = FX.graph) => {
  const c = clone(g);
  return { ...c, edges: c.edges.map((e) => (isAngel(e) ? patch(e) : e)) };
};
const withNode = (id: string, patch: (n: Rec) => Rec, g: { nodes: Rec[]; edges: Rec[] } = FX.graph) => {
  const c = clone(g);
  return { ...c, nodes: c.nodes.map((n) => (n.id === id ? patch(n) : n)) };
};

describe('the served link (R3 train-0545Z step 05)', () => {
  it('PRECONDITION: the served link is a placeholder by the ONE sized-link test; its neighbour (Paul\'s £1-2m deal size) is sized', () => {
    const sized = sizedLinkTest(FX.graph.nodes);
    expect(sized(FX.graph.edges.find(isAngel)!)).toBe(false);
    expect(sized(FX.graph.edges.find((e) => e.from === 'investment_firm_deals_closed' && e.to === 'securing_funding')!)).toBe(true);
    expect(FX.served_assistant_text).toContain('default placeholder');
    expect(FX.served_assistant_text).not.toMatch(/\?/);
  });

  it('RED: the served reply asked nothing → the host asks for the £ in AIQ\'s words, naming the LINK\'s target and unit', () => {
    expect(linkSizeAsk(FX.graph, at(FX.served_assistant_text))).toBe(ASK);
  });

  it('AIQ CR 5925991084 (b): the ask promises nothing the link-size door cannot keep (it refuses a bare "About £20,000")', () => {
    const nonCount = linkSizeAsk(withAngel((e) => ({ ...e, from: 'hours_per_week_on_angel_outreach' })),
      { message: 'Tell me about the link from "Hours per week on angel outreach" to "securing funding".', restingText: '', awaitingApproval: false });
    for (const ask of [linkSizeAsk(FX.graph, at('')), nonCount]) {
      expect(ask).not.toBeNull();
      expect(ask!).not.toMatch(/\bI['’]ll\b|\bpropose|\brecord|\bsave/i);
      expect(ask!.endsWith('?')).toBe(true);
    }
  });

  it('CODEX smallest pair: the SAME link once sized (Olumi\'s natural effect, in the target\'s unit, for its mean) → no ask', () => {
    const sized = withAngel((e) => ({ ...e, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
      natural_effect: { amount: 20000, amount_unit: 'GBP', per_source_change: 1, strength_mean: (e.strength as Rec).mean, strength_mean_frame: 'edge_strength' } } }));
    expect(sizedLinkTest(sized.nodes)(sized.edges.find(isAngel)!)).toBe(true);
    expect(linkSizeAsk(sized, at(FX.served_assistant_text))).toBeNull();
  });

  it('the user\'s own link is never asked back (user_specified strength, or a size the user stated)', () => {
    expect(linkSizeAsk(withAngel((e) => ({ ...e, provenance: { source: 'user_specified' } })), at(FX.served_assistant_text))).toBeNull();
    expect(linkSizeAsk(withAngel((e) => ({ ...e, provenance: { source: 'brief_extraction', magnitude: 'user_stated' } })), at(FX.served_assistant_text))).toBeNull();
  });
});

describe('AIQ 5925678816 (B): the words follow the link — direction, money, count, unit', () => {
  it('a NEGATIVE link into money → "change", never "add to"', () => {
    const g = withAngel((e) => ({ ...e, strength: { ...(e.strength as Rec), mean: -0.5 }, effect_direction: 'negative' }));
    expect(linkSizeAsk(g, at(''))).toBe('How much does one more "Qualified angel investor conversations" change "securing funding", in £?');
  });

  it('a positive link into a NON-money target → "change", in that target\'s own unit (not the goal\'s)', () => {
    // Re-point the link at a sibling outcome measured in percent: the ask names THAT target, never the goal.
    const g0 = withNode('angel_fundraising_admin_time', (n) => ({ ...n, observed_state: { unit: '%', value: 10 } }));
    const g = withAngel((e) => ({ ...e, to: 'angel_fundraising_admin_time' }), g0);
    const msg = 'Tell me about the link from "Qualified angel investor conversations" to "Angel fundraising admin time".';
    expect(linkSizeAsk(g, { message: msg, restingText: '', awaitingApproval: false }))
      .toBe('How much does one more "Qualified angel investor conversations" change "Angel fundraising admin time", in percentage points?');
  });

  it('a NON-count source (hours/week) → "How much does <target> change when <source> goes up by one hour per week?"', () => {
    const g = withAngel((e) => ({ ...e, from: 'hours_per_week_on_angel_outreach' }));
    const msg = 'Tell me about the link from "Hours per week on angel outreach" to "securing funding".';
    // The real edge Hours → securing funding does not exist in the served graph: this one is the only link the message names.
    expect(linkSizeAsk(g, { message: msg, restingText: '', awaitingApproval: false }))
      .toBe('How much does "securing funding" change when "Hours per week on angel outreach" goes up by one hour per week?');
  });

  it('a non-count source with no unit to say "one <unit>" in → no ask (words are never improvised)', () => {
    // The served Distraction → securing funding link (negative, no unit on Distraction) is the only one the message names.
    const only = { ...clone(FX.graph), edges: FX.graph.edges.filter((e) => !isAngel(e)) };
    const msg = 'Tell me about the link from "Distraction from investment-firm fundraising" to "securing funding".';
    expect(linkSizeAsk(only, { message: msg, restingText: '', awaitingApproval: false })).toBeNull();
  });

  it('a count source into a target with NO unit → no ask; the same link with the goal\'s unit → the ask (pair)', () => {
    const noUnit = withNode('securing_funding', (n) => { const { goal_threshold_unit: _u, ...rest } = n; return rest; });
    expect(linkSizeAsk(noUnit, at(''))).toBeNull();
    expect(linkSizeAsk(FX.graph, at(''))).toBe(ASK);
  });

  it('UNKNOWN direction (no field, zero mean) or a CONFLICTING one → no ask', () => {
    expect(linkSizeAsk(withAngel((e) => { const { effect_direction: _d, ...rest } = e; return { ...rest, strength: { mean: 0 } }; }), at(''))).toBeNull();
    expect(linkSizeAsk(withAngel((e) => ({ ...e, effect_direction: 'negative' })), at(''))).toBeNull();
  });
});

describe('≤1 ask, and only for the link the user named (CODEX collision class 5925779142)', () => {
  it('anything at rest already asks (the model, or a host line) → no ask; a question behind the toggle does not count', () => {
    expect(linkSizeAsk(FX.graph, at(`${FX.model_text} Which matters more?`))).toBeNull();
    const folded = `${FX.model_text} Questions this model does not answer yet: Does it arrive in time?`;
    expect(folded).not.toMatch(/\bsaved\b/i);
    expect(folded).toContain('Questions this model does not answer yet:');
    expect(textAtRest(folded)).not.toMatch(/\?/);
    expect(linkSizeAsk(FX.graph, at(folded))).toBe(ASK);
  });

  it('a card awaits a yes → no ask', () => {
    expect(linkSizeAsk(FX.graph, { ...at(''), awaitingApproval: true })).toBeNull();
  });

  it('the message already states the size → no ask (the model proposes it)', () => {
    expect(linkSizeAsk(FX.graph, { ...at(''), message: 'Each extra "Qualified angel investor conversations" adds about £20,000 to "securing funding".' })).toBeNull();
  });

  it('one node named, or two links named, or a structural link → no ask', () => {
    expect(linkSizeAsk(FX.graph, { ...at(''), message: 'Tell me about "Qualified angel investor conversations".' })).toBeNull();
    const two = 'Compare "Qualified angel investor conversations", "Distraction from investment-firm fundraising" and "securing funding".';
    expect(linkSizeAsk(FX.graph, { ...at(''), message: two })).toBeNull();
    expect(linkSizeAsk(FX.graph, { ...at(''), message: 'Tell me about the link from "Angel investor outreach" to "Hours per week on angel outreach".' })).toBeNull();
  });

  it('a STRUCTURAL link (an option setting its lever) is never a size to ask for, even when every other rule would ask', () => {
    // An option whose label reads as a count, into a lever with a unit: only the structural rule stops the ask.
    const g = withNode('angel_investor_outreach', (o) => ({ ...o, label: 'Angel investor calls' }));
    const msg = 'Tell me about the link from "Angel investor calls" to "Hours per week on angel outreach".';
    expect(linkSizeAsk(g, { message: msg, restingText: '', awaitingApproval: false })).toBeNull();
  });
});

// ── The route: the served inspect turn, model stubbed to the served model words (0 LLM) ──
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

describe('on the wire: the inspect turn says the ask at rest, once, and a replay returns the same words', () => {
  let app: FastifyInstance;
  let graph: Rec = FX.graph;
  let modelSays = FX.model_text;
  let n = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: modelSays }] }] }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph, graph_hash: 'h0', analysis_ready: { status: 'ready', may_run: true },
      analysis_state: { run_state: { kind: 'complete_current' }, usable_for_chips: true },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { graph = FX.graph; modelSays = FX.model_text; n += 1; });
  const turn = async (message = FX.message, turnId?: string) => (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    ...(turnId !== undefined ? { turn_id: turnId } : {}), kind: 'message', source: 'composer',
    scenario_id: `8b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d${String(n).padStart(2, '0')}`, message,
  } })).json() as { assistant_text: string };

  it('RED: the served model words → the ask at rest, once, last before nothing else asks; a replay of the turn is word-for-word', async () => {
    const turnId = '6d1e8f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a';
    const text = (await turn(FX.message, turnId)).assistant_text;
    expect(text.split(ASK).length - 1).toBe(1);
    expect(textAtRest(text)).toContain(ASK);
    expect(text.match(/\?/g) ?? []).toHaveLength(1);
    expect((await turn(FX.message, turnId)).assistant_text).toBe(text);
  });

  it('CONTROL: the model asked its own question → no host ask (one "?" in the turn)', async () => {
    modelSays = `${FX.model_text}\n\nWhat would you put it at?`;
    const text = (await turn()).assistant_text;
    expect(text).not.toContain('How much does one more');
    expect(text.match(/\?/g) ?? []).toHaveLength(1);
  });

  it('CONTROL: the same turn on the sized link → no ask', async () => {
    graph = withAngel((e) => ({ ...e, provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate',
      natural_effect: { amount: 20000, amount_unit: 'GBP', per_source_change: 1, strength_mean: (e.strength as Rec).mean, strength_mean_frame: 'edge_strength' } } }));
    expect((await turn()).assistant_text).not.toContain('How much does one more');
  });
});
