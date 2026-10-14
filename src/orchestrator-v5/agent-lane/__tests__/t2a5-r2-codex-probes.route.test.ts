/**
 * ⭐ #3002 r2: THE INDEPENDENT CHECK'S OWN PROBES, adopted unchanged as rows (Codex CHECK-3002-a3b352af, 14 Oct: 19 failed /
 * 13 passed on a3b352af), and the r2 check's (CHECK-3002-783a55b8). KNOWN-ORIGIN TRANSPORT (DL 14 Oct): the AI DECLARES each
 * band's `origin`. USER only when declared user with a verified whole quote and complete history; OLUMI only a declared olumi
 * band with its own basis, no quote, no copy; UNKNOWN everything else, never written, named on the card.
 *
 * The real path, end to end: DGAI's `selected_elements` → `/agent/v1/turn` → the stubbed model calls `propose_link_strengths`
 * (its links declare NO origin unless a row says so) → the real door → the card or the refusal → the press → the
 * production writer → the stored graph read back. Served bytes: the W3 cold read (`520aab46`, CEE `f074916`). 0 LLM calls.
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

type Json = Record<string, any>;
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url), 'utf8')) as Json;
const LATER = 'OK, record your estimates for the links.';

type Row = { id: string; scenario_id: string; turn_id: string; request_hash: string; assistant_message: string | null;
  user_message: string | null; llm_calls_used: number; turn_class: string; handler_id: string | null; pending_actions: unknown[]; created_at: string };
const rows = new Map<string, Row>();
const order: string[] = [];
const graphOf = new Map<string, unknown>();
const latestRow = (sid: string): Row | undefined => [...order].reverse().map((k) => rows.get(k)!).find((r) => r.scenario_id === sid && !r.turn_id.endsWith(':claim'));
const parsedPending = async (row: Row | undefined, sid: string): Promise<unknown[]> => {
  const { parsePendingAction } = await import('../../session/pending-action.js');
  return (row ? JSON.parse(JSON.stringify(row.pending_actions)) as unknown[] : []).map((x) => parsePendingAction(x)).filter((x) => x !== null && x.scenario_id === sid);
};
let tick = 0;
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  getScenarioOwner: vi.fn(async () => null),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => {
    const row = rows.get(`${sid}:${turnId}`);
    return row === undefined ? null : { ...row, pending_actions: await parsedPending(row, sid) };
  }),
  readMostRecentPendingActions: vi.fn(async (sid: string) => parsedPending(latestRow(sid), sid)),
  append: vi.fn(async (w: Json) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) {
      tick += 1;
      rows.set(k, { id: `row-${rows.size + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, request_hash: w.request_hash,
        assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0,
        turn_class: w.turn_class ?? 'direct_answer', handler_id: w.handler_id ?? null,
        pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) as unknown[],
        created_at: new Date(Date.UTC(2026, 9, 13, 0, 0, tick)).toISOString() });
      order.push(k);
      if (w.graph !== undefined && w.graph !== null) graphOf.set(w.scenario_id, JSON.parse(JSON.stringify(w.graph)));
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
  loadGraph: vi.fn(async (sid: string) => graphOf.get(sid) ?? null),
  loadGraphAndBriefText: vi.fn(async (sid: string) => ({ graph: graphOf.get(sid) ?? null, briefText: null })),
  hasPriorTurns: vi.fn(async (sid: string) => order.some((k) => rows.get(k)!.scenario_id === sid)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
// Observe the real link-set door's input and the operations it prepares; the capability itself runs unchanged.
const doors: { ctx: Json; operations: Json[]; public_label: unknown; refusal: unknown; left_out_third_party?: unknown }[] = [];
vi.mock('../runtime/agent-capabilities.js', async (original) => {
  const actual = await original<typeof import('../runtime/agent-capabilities.js')>();
  return { ...actual, createAgentCapabilities: (...input: Parameters<typeof actual.createAgentCapabilities>) => {
    const capabilities = actual.createAgentCapabilities(...input);
    const proposeLinkStrengths = capabilities.proposeLinkStrengths!;
    return { ...capabilities, proposeLinkStrengths: async (...args: Parameters<typeof proposeLinkStrengths>) => {
      const result = await proposeLinkStrengths(...args);
      const proposal = input[1].get(String(result.proposal_id));
      doors.push({ ctx: args[0] as Json, operations: [...(proposal?.operations ?? [])] as Json[], public_label: result.public_label, refusal: result.refusal, left_out_third_party: result.left_out_third_party });
      return result;
    } };
  } };
});

/** What the stubbed model proposes on the turn that asks for it. */
let proposeOn: { message: string; links: Json[] } | null = null;
const lastUserText = (body: Json): string => String((body.input as Json[]).filter((i) => i.role === 'user').pop()?.content?.[0]?.text ?? '');
const reply = (output: Json[]) => new Response(JSON.stringify({ output }), { status: 200 });

describe('T2A3 on /agent/v1/turn: whose band a link strength is, from the selection to the saved graph', () => {
  let app: FastifyInstance;
  let scenario = '';
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
      const body = JSON.parse(String(init?.body)) as Json;
      const input = body.input as Json[];
      const thisTurn = input.slice(input.map((i) => i.role === 'user').lastIndexOf(true) + 1);
      const answered = thisTurn.some((i) => i.type === 'function_call_output');
      if (!answered && proposeOn !== null && lastUserText(body) === proposeOn.message) {
        return reply([{ type: 'function_call', name: 'propose_link_strengths', call_id: 'fixture_link_set',
          arguments: JSON.stringify({ links: proposeOn.links, rationale: 'The user asked for these link strengths.' }) }]);
      }
      return reply([{ type: 'message', content: [{ type: 'output_text', text: 'Noted.' }] }]);
    }));
    vi.stubEnv('AGENT_LANE_ENABLED', 'true');
    vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async (req) => {
      const g = graphOf.get((req.params as { id: string }).id) ?? null;
      return { ...SERVED, graph: g, graph_hash: g === null ? null : computeAnalysisAffectingGraphHash(g as never) };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 600_000);
  beforeEach(() => {
    doors.length = 0; proposeOn = null;
    scenario = randomUUID();
    graphOf.set(scenario, structuredClone(SERVED.graph));
  });
  afterAll(async () => { await app?.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  const send = async (payload: Json): Promise<Json> => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn',
      payload: { kind: 'message', scenario_id: scenario, turn_id: randomUUID(), ...payload } });
    expect(res.statusCode, res.body.slice(0, 400)).toBe(200);
    return res.json() as Json;
  };
  const edgeNow = (from: string, to: string): Json => (graphOf.get(scenario) as Json).edges.find((e: Json) => e.from === from && e.to === to);
  /** The ONE prepared operation for this link, the card's own approve chip pressed, and the saved edge read back. */
  const _proposeAndApprove = async (session: string, message: string, extra: Json, link: Json, path: string) => {
    proposeOn = { message, links: [link] };
    const body = await send({ agent_session_id: session, message, ...extra });
    expect(doors, 'the stubbed model reached the real link-set door once').toHaveLength(1);
    const ops = doors[0]!.operations.filter((op) => op.path === path);
    expect(ops, path).toHaveLength(1);
    const chips = (body.suggested_actions as Json[]).filter((c) => String(c.id).startsWith('agent-approve-proposal:'));
    expect(chips, JSON.stringify(body.suggested_actions)).toHaveLength(1);
    proposeOn = null;
    await send({ agent_session_id: session, message: chips[0]!.message, source: 'chip', chip: { id: chips[0]!.id } });
    return { op: ops[0]!, label: String(doors[0]!.public_label), ctx: doors[0]!.ctx };
  };
  /** T2A5: the user's own words, not verifiably quoted, keep an unknown origin: no card, nothing written, the edge unchanged. */
  const _proposeRefused = async (session: string, message: string, extra: Json, link: Json) => {
    const before = JSON.stringify(edgeNow(...CHURN));
    proposeOn = { message, links: [link] };
    const body = await send({ agent_session_id: session, message, ...extra });
    proposeOn = null;
    expect(doors, 'the stubbed model reached the real link-set door').not.toHaveLength(0);
    expect(doors[0]!.refusal).toBe('origin_unknown');
    expect((body.suggested_actions as Json[]).filter((c) => String(c.id).startsWith('agent-approve-proposal:'))).toHaveLength(0);
    expect(JSON.stringify(edgeNow(...CHURN)), 'nothing written').toBe(before);
  };
  const CHURN = ['monthly_churn', 'paying_subscribers'] as const;
  const CHURN_EDGE = { id: 'monthly_churn→paying_subscribers', kind: 'edge' };
  const _NEW_EDGE = { id: 'monthly_new_paying_subscribers→paying_subscribers', kind: 'edge' };
  const churnLink = (strength: string) => ({ from_label: 'Monthly churn', to_label: 'Paying subscribers', strength });
  const expectSaved = (author: 'user_stated' | 'model_proposed', magnitude: number) => {
    const saved = edgeNow(...CHURN);
    expect(Math.abs(saved.strength.mean), 'the approved band was written').toBe(magnitude);
    if (author === 'user_stated') expect(saved.provenance.source).toBe('user_specified');
    else expect(saved.provenance.source, 'Olumi’s estimate, never the user’s').not.toBe('user_specified');
  };


  const probes = [
    ['evidence-pair', 'Monthly churn has strong evidence for its effect on Paying subscribers.', []],
    ['evidence-selection', 'Monthly churn is strong evidence for the model.', [CHURN_EDGE]],
    ['alice-says', 'Alice says Monthly churn has a strong effect on Paying subscribers.', []],
    ['came-from-Olumi', 'These estimates came from Olumi. Monthly churn has a strong effect on Paying subscribers.', []],
    ['question', 'Monthly churn has a strong effect on Paying subscribers. Is that right?', []],
  ] as const;
  const runProbe = async (name: string, words: string, earlier: boolean, links: Json[], selected: readonly Json[] = [], middle?: string) => {
    const session = `independent-${randomUUID()}`;
    if (earlier) await send({ agent_session_id: session, message: words, selected_elements: selected });
    if (middle) await send({ agent_session_id: session, message: middle });
    const message = earlier ? LATER : words;
    const before = JSON.stringify(graphOf.get(scenario));
    proposeOn = { message, links };
    const body = await send({ agent_session_id: session, message, selected_elements: selected });
    const door = doors[0];
    expect(door).toBeDefined();
    const chips = (body.suggested_actions as Json[]).filter(c => String(c.id).startsWith('agent-approve-proposal:'));
    proposeOn = null;
    if (chips.length) await send({ agent_session_id: session, message: chips[0].message, source: 'chip', chip: { id: chips[0].id } });
    const result = { name, earlier, refusal: door!.refusal, label: door!.public_label,
      operations: door!.operations.map(o => ({path: o.path, value: o.value})),
      saved: links.map(l => ({ from: l.from_label, to: l.to_label, provenance: edgeNow(
        (SERVED.graph.nodes as Json[]).find(n => n.label === l.from_label)!.id,
        (SERVED.graph.nodes as Json[]).find(n => n.label === l.to_label)!.id).provenance })) };
    console.log('PROBE', JSON.stringify(result));
    return { door: door!, changed: JSON.stringify(graphOf.get(scenario)) !== before, chips };
  };
  it.each(probes.flatMap(([name, words, selected]) => [false, true].flatMap(earlier => [false, true].map(quoted => ({name, words, selected, earlier, quoted})))))('prior overclaim $name earlier=$earlier quoted=$quoted', async ({name, words, selected, earlier, quoted}) => {
      const p = await runProbe(name, words, earlier, [{...churnLink('strong'), ...(quoted ? {from_words: words} : {})}], selected);
      expect.soft(p.door.refusal, 'unverified source must stay unknown').toBe('origin_unknown');
      expect.soft(p.door.operations, 'nothing prepared').toHaveLength(0);
      expect.soft(p.changed, 'nothing written').toBe(false);
    });
  it.each([false, true].flatMap(earlier => [false, true].map(aiDenies => ({earlier, aiDenies}))))('third-party whole frame earlier=$earlier explicit third-party=$aiDenies', async ({earlier, aiDenies}) => {
      const words = 'Alice supplied these estimates. Monthly churn has a strong effect on Paying subscribers.';
      const p = await runProbe('alice-frame', words, earlier, [{...churnLink('strong'), from_words: words,
        ...(aiDenies ? {user_stated: false, author: 'Alice', source: 'Alice', basis: 'Alice supplied these estimates; they are not the user’s.'} : {})}]);
      expect.soft(p.door.refusal).toBe('origin_unknown');
      expect.soft(p.changed).toBe(false);
    });
  it.each(['None of these are my estimates.', 'I disagree with all these estimates.'])('run-wide withhold %s every link', async frame => {
    const words = `${frame} Monthly churn has a strong effect on Paying subscribers. Monthly new paying subscribers has a strong effect on Paying subscribers.`;
    const p = await runProbe('withhold', words, false, [churnLink('strong'), {from_label:'Monthly new paying subscribers', to_label:'Paying subscribers', strength:'strong'}].map(l => ({...l, from_words:words})));
    expect.soft(p.door.refusal).toBe('origin_unknown');
    expect.soft(p.changed).toBe(false);
  });
  it.each([false, true])('withdrawal supersedes every target earlier=%s', async _earlier => {
    const words = 'Monthly churn has a strong effect on Paying subscribers. Monthly new paying subscribers has a strong effect on Paying subscribers.';
    const p = await runProbe('withdrawal', words, true, [churnLink('strong'), {from_label:'Monthly new paying subscribers', to_label:'Paying subscribers', strength:'strong'}].map(l => ({...l, from_words:words})), [], 'I withdraw all my earlier estimates.');
    expect(p.door.refusal).toBe('origin_unknown');
    expect(p.changed).toBe(false);
  });
  it.each([false, true])('credit never carries to a different link earlier=$earlier', async earlier => {
    const words = 'Monthly churn has a strong effect on Paying subscribers.';
    // ⛔ EXPECTATION CHANGED (r2): the quote of the OTHER link does not verify, so it is UNKNOWN, never Olumi's (the check's own
    // expectation was model_proposed). Declared Olumi's, with its basis and no quote, it is Olumi's.
    const p = await runProbe('other-link', words, earlier, [{from_label:'Monthly new paying subscribers', to_label:'Paying subscribers', strength:'strong', from_words:words, origin: 'user'}]);
    expect(p.door.refusal).toBe('origin_unknown');
    expect(p.door.operations).toHaveLength(0);
    doors.length = 0;
    const o = await runProbe('other-link', words, earlier, [{from_label:'Monthly new paying subscribers', to_label:'Paying subscribers', strength:'strong', origin: 'olumi', basis: 'Olumi\u2019s own estimate from the model'}]);
    expect(o.door.operations).toHaveLength(1);
    expect(o.door.operations[0].path).toBe('monthly_new_paying_subscribers::paying_subscribers');
    expect(o.door.operations[0].value.author).toBe('model_proposed');
  });
  it('#3002 mixed set: the HOST names the left-out link on the approval card, by its model labels; only the known tiers are written', async () => {
    const words = 'Monthly churn has a strong effect on Paying subscribers.';
    const unknownBefore = structuredClone(edgeNow('monthly_new_paying_subscribers', 'paying_subscribers'));
    const p = await runProbe('mixed', words, false, [{ ...churnLink('strong'), origin: 'user', from_words: words },
      { from_label: 'Monthly new paying subscribers', to_label: 'Paying subscribers', strength: 'strong', origin: 'user', from_words: words },
      { from_label: 'Pro plan price', to_label: 'Monthly new paying subscribers', strength: 'weak', origin: 'olumi',
        basis: 'Olumi proposes weak because the model includes retention effects moderating the price response.' }]);
    expect(p.door.operations.map((o) => [o.path, o.value.author])).toEqual([['monthly_churn::paying_subscribers', 'user_stated'],
      ['pro_plan_price::monthly_new_paying_subscribers', 'model_proposed']]);
    // The card the user approves (the chip's detail, the stored proposal's own label) says it, never the Agent's prose.
    expect(p.chips).toHaveLength(1);
    // ⛔ EXPECTATION CHANGED (AIE packet 2b19ae59): the AIE's exact singular sentence replaces the host's draft.
    expect(String(p.chips[0].detail)).toContain('Left out of this change set: '
      + '"Monthly new paying subscribers" \u2192 "Paying subscribers"' + ', because the proposed band\'s source is unverified. Its current relationship and source are kept.');
    expect(String(p.door.public_label)).toBe(String(p.chips[0].detail));
    expect(edgeNow('monthly_new_paying_subscribers', 'paying_subscribers'), 'the unknown link is untouched').toEqual(unknownBefore);
    expect(edgeNow(...CHURN).provenance.source).toBe('user_specified');
    expect(edgeNow('pro_plan_price', 'monthly_new_paying_subscribers').provenance.magnitude).toBe('olumi_estimate');
  });
  it('CONTROL: a set with nothing left out names nothing on its card', async () => {
    const words = 'Monthly churn has a strong effect on Paying subscribers.';
    const p = await runProbe('mixed-control', words, false, [{ ...churnLink('strong'), origin: 'user', from_words: words }]);
    expect(String(p.chips[0].detail)).not.toContain('Left out of this change set');
  });
  // ⭐ Codex r2's cited-source probes, both shapes: declared third_party with its source, and the r2 shape (no origin, a false user
  // flag plus basis text citing the source). Never Olumi's, never written; the declared source is named on the result.
  it.each(['Alice', 'the Smith report'])('third party declared (%s): never Olumi\u2019s, nothing written, named with its source', async cited => {
    const p = await runProbe('cited-third-party', 'Please suggest link strengths.', false, [{ ...churnLink('weak'), origin: 'third_party', source: cited }]);
    expect(p.door.refusal).toBe('origin_unknown');
    expect(p.door.operations).toHaveLength(0);
    expect(p.changed, 'nothing written').toBe(false);
    expect(p.chips, 'no card').toHaveLength(0);
    // ⛔ EXPECTATION CHANGED (packet 2b19ae59): named as the card names it, "attributed to" its whole source.
    expect(p.door.left_out_third_party).toEqual([`"Monthly churn" \u2192 "Paying subscribers", attributed to "${cited}"`]);
  });
  it.each(['Alice supplied this weak estimate.', 'The Smith report estimates a weak effect for this link.'])('the r2 shape (no origin; user_stated false + basis "%s") is no declaration: unknown, nothing written', async basis => {
    const p = await runProbe('cited-basis', 'Please suggest link strengths.', false, [{ ...churnLink('weak'), user_stated: false, basis }]);
    expect(p.door.refusal).toBe('origin_unknown');
    expect(p.changed).toBe(false);
  });
  // ⭐ #3002 (DL 14 Oct): reseeded chip text is stored as a user message, so a fresh session's restored words prove nothing. The
  // route hands restored rows to the door only as UNVERIFIED text (`history-store.ts` `authorshipWords`), never as typed words.
  it('a fresh session reseeded from the durable rows: a quote of the restored earlier words is not the user\u2019s: unknown, nothing written', async () => {
    const words = 'Monthly churn has a strong effect on Paying subscribers.';
    await send({ agent_session_id: `typed-${randomUUID()}`, message: words });
    const before = JSON.stringify(edgeNow(...CHURN));
    proposeOn = { message: LATER, links: [{ ...churnLink('strong'), origin: 'user', from_words: words }] };
    const body = await send({ agent_session_id: `reseeded-${randomUUID()}`, message: LATER });
    proposeOn = null;
    expect(doors).toHaveLength(1);
    expect(String(doors[0]!.ctx.unverified_user_text), 'the earlier words reach the door as restored, unknown-source text').toContain(words);
    expect(doors[0]!.ctx.verified_user_messages, 'never as typed words').not.toContain(words);
    expect(doors[0]!.refusal).toBe('origin_unknown');
    expect((body.suggested_actions as Json[]).filter((c) => String(c.id).startsWith('agent-approve-proposal:'))).toHaveLength(0);
    expect(JSON.stringify(edgeNow(...CHURN)), 'nothing written').toBe(before);
  });
  it.each([false, true])('positive own quote earlier=$earlier', async earlier => {
    const words = 'Monthly churn has a strong effect on Paying subscribers.';
    // ⛔ INPUT CHANGE (#3002): the AI declares the user's own band (origin user) beside its verified quote.
    const p = await runProbe('own-control', words, earlier, [{...churnLink('strong'), from_words:words, origin: 'user'}]);
    expect(p.door.operations[0].path).toBe(CHURN.join('::'));
    expect(p.door.operations[0].value.author).toBe('user_stated');
    expectSaved('user_stated', 0.55);
  });
});
