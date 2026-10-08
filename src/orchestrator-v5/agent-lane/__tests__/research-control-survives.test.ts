/**
 * ⭐ A SEARCH CONTROL THE AGENT WAS TOLD THE USER SEES, REACHES THE USER (S-B slice 1a; witnessed on staging 7 Oct 2026).
 *
 * `offer_public_research` answers the model "The user now sees a control…". On a Run that withholds its leader, the final
 * egress gate (`leader-final-egress.ts`, "3: chips") then removed that control because the query it quotes compared the
 * options, and the reply still said "it runs only if you press the control" (Render 10:17:54.742Z:
 * `agent_lane.leader_claim_residual_removed`, `removed_paths: ["suggested_actions[0]"]`; wire `suggested_actions: []`).
 *
 * THE INVARIANT (the spec, not the failure): a reply never leaves the user looking for a search control that is not
 * there. Every search the Agent offered either has its control on the wire, or the reply says in fixed words that it
 * has none (or the gate replaced the whole reply, words and controls).
 *
 * TWO READERS OF ONE RULE (`controlSurvivesLeaderGate`, built from the gate's own predicates):
 *  - EARLY, at the offer: a query the gate would remove is refused with the reason, so the model can ask a neutral
 *    question. This is what the user normally meets.
 *  - FINAL, on the body as it ships: the state can change AFTER an accepted offer (a Run later in the same turn; Codex
 *    buddy r1 on #2746), so the controls and the reply's words are settled on the turn's final read, from the SAME
 *    inputs object the gate is then given.
 *    It runs AFTER every gate that can edit the reply (buddy r2): a sentence added earlier was removed by a later edit,
 *    and a copy of the words inside a sentence the gate then deleted was trusted. Only a DELIVERED control is
 *    remembered as pressable.
 * NOT covered here: a RETRIED turn (replay) re-offers no search control, as before this change.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import {
  RESEARCH_NOT_ON_OFFER_TEXT, RESEARCH_ONLY_SHOWN_TEXT, RESEARCH_WORDING_REASON_TEXT, researchChipFor, withResearchControlTruth,
} from '../runtime/public-research.js';
import { dispatchTool, type AgentCapabilities, type AgentToolContext } from '../runtime/agent-tools.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { controlSurvivesLeaderGate, enforceLeaderLicenceAtFinalEgress, leaderGateInputsOf, type LeaderGateInputs } from '../leader-final-egress.js';
import { findLeaderClaims, textAssertsLeadingOption, textNamesLeadingOption } from '../../compose/leading-option-egress-guard.js';
import { WITHHELD_GOAL_SCOPE_UNRESOLVED } from '../../compose/analysis-state-v1.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { textAtRest } from '../decision-input-ask.js';

const SCENARIO = '8b3e4d5c-6f7a-4b8c-9d0e-1f2a3b4c5d70';
const OPTIONS = ['Hire a tech lead', 'Hire two developers'] as const;
/** A query that ranks the options: the gate removes a control that quotes it. */
const RANKING = 'Why is Hire a tech lead the best option for meeting a launch deadline?';
/** The same subject as one neutral public question: no option is put ahead. */
const NEUTRAL = 'How long do new engineering hires take to become productive before a launch deadline?';
const PROMISE = 'The search would look for that evidence; it runs only if you press the control.';
const NO_OFFER = 'I can describe the evidence that would help, but I have not offered a search for it.';
const WITHDRAWN = `${RESEARCH_NOT_ON_OFFER_TEXT} ${RESEARCH_WORDING_REASON_TEXT}`;

const rows = new Map<string, Record<string, unknown>>();
/** Every row the route asked the store to write, as it was handed over. */
const writes: unknown[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: Record<string, unknown>) => {
    writes.push(w);
    rows.set(String(w.turn_id), { request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, response_emitted: w.response_emitted });
    return { id: `row-${rows.size}` };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

describe('an accepted search offer has its control on the wire', () => {
  let app: FastifyInstance;
  let bodies: Record<string, unknown>[] = [];
  let query = NEUTRAL;
  /** What the scenario's read answers: a Run that withholds its leader, or one that licenses naming it. */
  let run: 'withheld' | 'licensed' = 'withheld';
  /** The Agent starts a Run AFTER its offer, and that Run withholds its leader. */
  let runsAfterOffer = false;
  /** What the Agent says after an ACCEPTED offer (default: the promise). */
  let reply = PROMISE;
  /** A critique code on the bound result. `__proto__` makes the gate's projector throw, so it ships its envelope. */
  let critique: string | null = null;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const raw = String(init?.body ?? '{}');
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
      // The Agent offers the search first. Then it speaks from the tool's own answer: a promise only for an accepted offer.
      if (bodies.length === 1) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'offer_public_research', call_id: 'c1', arguments: JSON.stringify({ query }) }] }), { status: 200 });
      }
      if (runsAfterOffer && bodies.length === 2) {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'run_analysis', call_id: 'c2', arguments: JSON.stringify({ reason: 'asked' }) }] }), { status: 200 });
      }
      const accepted = raw.includes('The user now sees a control');
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: accepted ? reply : NO_OFFER }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      if (runsAfterOffer) run = 'withheld';
      return { response_version: 2, assistant_text: 'x', suggested_actions: [], insights: [], blocks: [] };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph: {
        nodes: [
          { id: 'g', kind: 'goal', label: 'Meet the launch deadline' },
          { id: 'o1', kind: 'option', label: OPTIONS[0] },
          { id: 'o2', kind: 'option', label: OPTIONS[1] },
          { id: 'f', kind: 'factor', label: 'Delivery pace' },
        ],
        edges: [{ from: 'f', to: 'g' }],
      },
      graph_hash: '0123456789abcdef',
      analysis_result: {
        type: 'analysis_result', summary: 'A provisional first pass.', computed_against_hash: '0123456789abcdef',
        ...(critique !== null ? { enrichment: { critiques: [{ code: critique }] } } : {}),
      },
      ...(run === 'licensed' ? {
        analysis_ready: { status: 'ready', options: [], blockers: [], analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } },
        analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: true, separation: 'separated' } },
      } : {
        analysis_state: { run_state: { kind: 'complete_current' }, leader_claim: { permitted: false, withheld_reason: 'goal_path_unsized' } },
      }),
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { bodies = []; query = NEUTRAL; run = 'withheld'; runsAfterOffer = false; reply = PROMISE; critique = null; rows.clear(); writes.length = 0; });

  type Body = {
    assistant_text: string;
    suggested_actions: { id: string; label: string; message: string; detail?: string }[];
    _answer_shape?: AnswerShape;
    _agent?: { tool_calls?: { name: string; ok: boolean }[] };
  };
  const turn = async (): Promise<Body> => {
    const payload = runsAfterOffer
      ? { kind: 'message', scenario_id: SCENARIO, message: 'Find evidence for this, then run it again please' }
      : { kind: 'message', scenario_id: SCENARIO, message: 'What are the limits of this analysis?', source: 'chip', chip: { id: 'ask:limits' } };
    // Its own turn id, so the answer row is written (and the store mock sees the words a reload would show).
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { ...payload, turn_id: randomUUID() } });
    expect(r.statusCode).toBe(200);
    return r.json() as Body;
  };
  const offers = (b: Body) => (b._agent?.tool_calls ?? []).filter((c) => c.name === 'offer_public_research');
  const controls = (b: Body) => b.suggested_actions.filter((a) => a.id.startsWith('agent-public-research:'));
  /** Did the route hand the store these exact words (what a reload shows)? */
  const stored = (text: string): boolean => writes.some((w) => JSON.stringify(w).includes(JSON.stringify(text).slice(1, -1)));

  it('PRECONDITION: the gate’s own predicate reads the ranking query’s control as a leader claim, and not the neutral one', () => {
    const asserts = (q: string) => {
      const chip = researchChipFor(q)!;
      return [chip.label, chip.message, chip.detail].some((text) => textAssertsLeadingOption(text, { optionLabels: [...OPTIONS] }));
    };
    expect(asserts(RANKING)).toBe(true);
    expect(asserts(NEUTRAL)).toBe(false);
  });

  it('RED (staging 7 Oct): a query the gate would remove is refused at the offer; nothing promises a control that is not there', async () => {
    query = RANKING;
    const b = await turn();
    expect(offers(b), 'the Agent made the offer').toHaveLength(1);
    // The invariant: accepted ⇒ on the wire. Here the offer is refused, so there is no control and no promise of one.
    expect(offers(b)[0]!.ok).toBe(false);
    expect(controls(b)).toEqual([]);
    expect(b.assistant_text).not.toContain('press the control');
    expect(b.assistant_text).toBe(NO_OFFER);
  });

  it('CONTRAST: a neutral query on the same withheld Run is accepted, and its ONE control is on the wire', async () => {
    query = NEUTRAL;
    const b = await turn();
    expect(offers(b)).toEqual([expect.objectContaining({ name: 'offer_public_research', ok: true })]);
    expect(controls(b)).toEqual([researchChipFor(NEUTRAL)]);
    expect(b.assistant_text).toBe(PROMISE);
  });

  it('CONTRAST: on a Run that licenses naming a leader, the ranking query is accepted and its control is on the wire', async () => {
    query = RANKING; run = 'licensed';
    const b = await turn();
    expect(offers(b)).toEqual([expect.objectContaining({ ok: true })]);
    expect(controls(b)).toEqual([researchChipFor(RANKING)]);
    expect(b.assistant_text).not.toContain(RESEARCH_NOT_ON_OFFER_TEXT);
  });

  it('RED (Codex buddy r1): a Run AFTER the accepted offer withholds its leader, so the reply says no search is on offer', async () => {
    query = RANKING; run = 'licensed'; runsAfterOffer = true;
    const b = await turn();
    expect(offers(b), 'accepted while the Run still licensed a leader').toEqual([expect.objectContaining({ ok: true })]);
    expect(run, 'the Agent’s own Run ran, and withholds').toBe('withheld');
    expect(controls(b)).toEqual([]);
    expect(b.assistant_text.endsWith(WITHDRAWN), b.assistant_text).toBe(true);
    expect(stored(b.assistant_text), 'the answer row holds the words the user saw').toBe(true);
    expect(stored(PROMISE), 'POSITIVE CONTROL: the probe sees a stored reply').toBe(true);
  });

  const QUESTIONS = 'Questions this model does not answer yet: How long do new hires take?';

  it('RED (buddy r2): the words are said AT REST, never behind the questions toggle that a later edit drops', async () => {
    query = RANKING; run = 'licensed'; runsAfterOffer = true; reply = `${PROMISE}\n\n${QUESTIONS}`;
    const b = await turn();
    expect(controls(b)).toEqual([]);
    expect(b.assistant_text, 'the questions keep their place, last').toContain(QUESTIONS);
    expect(textAtRest(b.assistant_text), b.assistant_text).toBe(`${PROMISE}\n\n${WITHDRAWN}`);
    expect(stored(b.assistant_text)).toBe(true);
  });

  // ⚠ NOT RED EVIDENCE: this row also passes on the round-2 code (an EARLIER gate edits the sentence in this fixture). The
  // buddy's own reproducer needs an unresolved-scope turn, which is not replayed here.
  it('the same words inside a sentence the gate deletes are not trusted (holds; not a RED row)', async () => {
    query = RANKING; run = 'licensed'; runsAfterOffer = true;
    reply = `${PROMISE}\n\n${OPTIONS[0]} is the best option \u2014 ${RESEARCH_NOT_ON_OFFER_TEXT}`;
    const b = await turn();
    expect(controls(b)).toEqual([]);
    expect(b.assistant_text, 'the gate edited the sentence that named a leader').not.toContain('is the best option');
    // Contract order (i): "RESEARCH_* words stay on the face per #2746". The composer places the two fixed
    // control-truth lines in separate face bullets, then the next step; their old contiguous suffix is not the contract.
    expect(b._answer_shape, 'the delivered research truth has a shaped face').toBeDefined();
    const shape = b._answer_shape!;
    const face = [shape.headline, ...(shape.bullets ?? [])].join('\n');
    for (const truth of [RESEARCH_NOT_ON_OFFER_TEXT, RESEARCH_WORDING_REASON_TEXT]) {
      expect(b.assistant_text.split(truth).length - 1, `delivered exactly once: ${truth}`).toBe(1);
      expect(face.split(truth).length - 1, `must-face research truth: ${truth}`).toBe(1);
      expect(shape.detail ?? '', 'no research truth is hidden or duplicated in detail').not.toContain(truth);
    }
    expect(b.assistant_text).toBe(deriveAnswerTextFromShape(shape));
  });

  it('CONTRAST: the same turn with a neutral query keeps its control, and nothing is added to the reply', async () => {
    query = NEUTRAL; run = 'licensed'; runsAfterOffer = true;
    const b = await turn();
    expect(run).toBe('withheld');
    expect(controls(b)).toEqual([researchChipFor(NEUTRAL)]);
    expect(b.assistant_text).not.toContain(RESEARCH_NOT_ON_OFFER_TEXT);
  });

  /** Every web search actually sent: the ONE request shape `researchRequestBody` builds. */
  const searchesSent = (): string[] => bodies.filter((b) => JSON.stringify(b['tools']) === JSON.stringify([{ type: 'web_search' }])).map((b) => JSON.stringify(b['input']));
  const press = async (chip: { id: string; message: string }): Promise<void> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'chip', chip: { id: chip.id } } });
    expect(r.statusCode).toBe(200);
  };

  it('a control that was never shown cannot buy a search: a press of its id sends no query', async () => {
    // Its own query: the offers a scenario was shown are remembered for the life of the process, across these rows.
    const neverShown = 'Why is Hire two developers the best option for hitting a release date?';
    query = neverShown; run = 'licensed'; runsAfterOffer = true;
    const b = await turn();
    expect(offers(b), 'accepted while the Run still licensed a leader').toEqual([expect.objectContaining({ ok: true })]);
    expect(controls(b)).toEqual([]);
    runsAfterOffer = false;
    await press(researchChipFor(neverShown)!);
    expect(searchesSent()).toEqual([]);
  });

  it('RED (buddy r2): a control the gate\u2019s own envelope removed cannot buy a search either', async () => {
    const hidden = 'How long does onboarding a senior engineer usually take?';
    query = hidden; critique = '__proto__';
    const b = await turn();
    expect(offers(b), 'the offer was accepted').toEqual([expect.objectContaining({ ok: true })]);
    expect(controls(b)).toEqual([]);
    expect(b.assistant_text, 'the envelope\u2019s fixed line is left as it is').not.toContain(RESEARCH_NOT_ON_OFFER_TEXT);
    expect(b.assistant_text).not.toContain('press the control');
    critique = null;
    await press(researchChipFor(hidden)!);
    expect(searchesSent()).toEqual([]);
  });

  it('CONTRAST: with an ordinary critique code the control is delivered, and its press buys the search', async () => {
    const shown = 'How long does onboarding a staff engineer usually take?';
    query = shown; critique = 'ordinary_code';
    expect(controls(await turn())).toEqual([researchChipFor(shown)]);
    await press(researchChipFor(shown)!);
    expect(searchesSent()).toHaveLength(1);
  });

  it('CONTRAST: the control that WAS shown buys exactly its query', async () => {
    query = NEUTRAL;
    expect(controls(await turn())).toEqual([researchChipFor(NEUTRAL)]);
    await press(researchChipFor(NEUTRAL)!);
    expect(searchesSent()).toHaveLength(1);
    expect(searchesSent()[0]).toContain(NEUTRAL);
  });

  it.each([
    [RANKING, 'withheld', false], [NEUTRAL, 'withheld', false],
    [RANKING, 'licensed', false], [NEUTRAL, 'licensed', false],
    [RANKING, 'licensed', true], [NEUTRAL, 'licensed', true],
  ] as const)('INVARIANT: %j on a %s Run (Run after the offer: %s): a control per accepted offer, or the reply says it has none', async (q, state, runs) => {
    query = q; run = state; runsAfterOffer = runs;
    const b = await turn();
    const accepted = offers(b).filter((c) => c.ok).length;
    expect(controls(b).length).toBeLessThanOrEqual(accepted);
    expect(b.assistant_text.includes(RESEARCH_NOT_ON_OFFER_TEXT)).toBe(controls(b).length < accepted);
  });
});

describe('the offer itself: accepted only when the control will be shown', () => {
  const ctx: AgentToolContext = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'research-offer' };
  const offer = (caps: Partial<AgentCapabilities>) => dispatchTool('offer_public_research', JSON.stringify({ query: NEUTRAL }), ctx, caps as AgentCapabilities);
  const ACCEPTED = {
    ok: true, mutated: false, offered_query: NEUTRAL,
    detail: 'The user now sees a control that searches the web for exactly this query. Nothing has been searched yet: '
      + 'tell them what the search would look for and that it runs only if they press it.',
  };

  it('CONTROL: with no showable read wired, a sendable query is accepted exactly as before (same bytes)', async () => {
    expect(await offer({})).toEqual(ACCEPTED);
  });

  it('accepted when the control will be shown', async () => {
    expect(await offer({ researchControlShowable: async () => true })).toEqual(ACCEPTED);
  });

  const gateRemoves = async (): Promise<boolean> => false;
  const readThrows = async (): Promise<boolean> => { throw new Error('readback failed'); };
  const notTrue = async (): Promise<boolean> => 'yes' as unknown as boolean;
  it.each([
    ['the gate would remove the control', gateRemoves],
    ['the read throws (fail closed)', readThrows],
    ['the read answers something that is not true', notTrue],
  ] as const)('refused when %s: no accepted offer, and the model is told there is no control', async (_why, showable) => {
    const r = await offer({ researchControlShowable: showable });
    expect(r).toMatchObject({ ok: false, mutated: false, refusal: 'query_cannot_be_shown' });
    expect(r).not.toHaveProperty('offered_query');
    expect(String(r.detail)).toContain('The user sees NO control');
  });

  it('a query that cannot be sent at all keeps its own refusal, and the showable read is never asked', async () => {
    let asked = 0;
    const r = await dispatchTool('offer_public_research', JSON.stringify({ query: 'x'.repeat(201) }), ctx,
      { researchControlShowable: async () => { asked += 1; return true; } } as Partial<AgentCapabilities> as AgentCapabilities);
    expect(r).toMatchObject({ ok: false, refusal: 'query_not_sendable' });
    expect(asked).toBe(0);
  });
});

const GRAPH = { nodes: [{ id: 'o1', kind: 'option', label: OPTIONS[0] }, { id: 'o2', kind: 'option', label: OPTIONS[1] }] };

describe('the control check IS the gate: the same answer for every state the gate distinguishes', () => {
  const SCOPE = { leaderClaimWithheldReason: WITHHELD_GOAL_SCOPE_UNRESOLVED };
  // [state, inputs, the ranking control ships, the neutral control ships]: the spec, by state.
  const STATES: readonly (readonly [string, LeaderGateInputs, boolean, boolean])[] = [
    ['a leader may be named', { licence: 'permitted', graph: GRAPH, analysisReady: undefined }, true, true],
    ['a leader may be named with a caveat', { licence: 'permitted_with_caveat', graph: GRAPH, analysisReady: undefined }, true, true],
    ['the leader is withheld', { licence: 'withheld', graph: GRAPH, analysisReady: undefined }, false, true],
    ['withheld, scope unresolved, authority read', { licence: 'withheld', graph: GRAPH, analysisReady: undefined, ...SCOPE, scopeAuthorityUnavailable: false }, false, true],
    ['withheld, scope unresolved, authority UNAVAILABLE', { licence: 'withheld', graph: GRAPH, analysisReady: undefined, ...SCOPE, scopeAuthorityUnavailable: true }, false, false],
    ['withheld, scope unresolved, NO option roster', { licence: 'withheld', graph: { nodes: [] }, analysisReady: undefined, ...SCOPE }, false, false],
  ];
  const shipsThroughTheGate = (chip: unknown, inputs: LeaderGateInputs): boolean => {
    const out = enforceLeaderLicenceAtFinalEgress({ assistant_text: 'A reply.', suggested_actions: [chip], blocks: [] }, {
      ...inputs, requestId: 'research-control', exitPath: 'test', mayNameLeadingOption: inputs.licence !== 'withheld', separationEstablished: false,
    });
    return (out.response.suggested_actions as unknown[]).includes(chip);
  };

  it.each(STATES.flatMap(([state, inputs, ranking, neutral]) => [[state, RANKING, inputs, ranking], [state, NEUTRAL, inputs, neutral]] as const))(
    '%s, %j: ships = %s (the check and the gate agree)',
    (_state, q, inputs, ships) => {
      const chip = researchChipFor(q);
      expect(shipsThroughTheGate(chip, inputs), 'the gate').toBe(ships);
      expect(controlSurvivesLeaderGate(chip, inputs), 'the check').toBe(ships);
    },
  );

  it('the inputs come from ONE read: licence, withheld reason, roster sources and the scope restriction', () => {
    const analysisReady = { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader' } };
    expect(leaderGateInputsOf({ analysisState: { leader_claim: { permitted: true, separation: 'separated' } }, analysisReady, graph: GRAPH }))
      .toEqual({ licence: 'permitted', graph: GRAPH, analysisReady });
    expect(leaderGateInputsOf({ analysisState: { leader_claim: { permitted: false, withheld_reason: WITHHELD_GOAL_SCOPE_UNRESOLVED } }, analysisReady, graph: undefined, scopeAuthorityUnavailable: true }))
      .toEqual({ licence: 'withheld', leaderClaimWithheldReason: WITHHELD_GOAL_SCOPE_UNRESOLVED, scopeAuthorityUnavailable: true, graph: null, analysisReady });
    expect(leaderGateInputsOf({})).toEqual({ licence: 'withheld', graph: null, analysisReady: undefined });
  });
});

describe('the early check: an unsuccessful read licenses nothing (Codex buddy r1)', () => {
  type Showable = (dispatch: InternalDispatch, scenarioId: string, query: string) => Promise<boolean>;
  let showableNow: Showable;
  beforeAll(async () => { ({ researchControlShowableNow: showableNow } = await import('../../../routes/agent-v1-turn.js')); }, 60_000);
  const readOk: InternalDispatch = async () => ({ status: 200, json: { graph: GRAPH, graph_hash: '0123456789abcdef' } });
  const readThrows: InternalDispatch = async () => { throw new Error('graph read down'); };
  const readRefused: InternalDispatch = async () => ({ status: 503, json: {} });

  it('CONTROL: a successful read shows a neutral query, and refuses one that ranks the options', async () => {
    expect(await showableNow(readOk, SCENARIO, NEUTRAL)).toBe(true);
    expect(await showableNow(readOk, SCENARIO, RANKING)).toBe(false);
  });

  it.each([['throws', readThrows], ['answers 503', readRefused]] as const)('a read that %s shows nothing, not even a neutral query', async (_why, dispatch) => {
    expect(await showableNow(dispatch, SCENARIO, NEUTRAL)).toBe(false);
  });

  it('a query that cannot be sent is never read for', async () => {
    let reads = 0;
    const counted: InternalDispatch = async (path, body) => { reads += 1; return readOk(path, body); };
    expect(await showableNow(counted, SCENARIO, 'x'.repeat(201))).toBe(false);
    expect(reads).toBe(0);
  });
});

describe('the reply\u2019s words follow the controls it carries', () => {
  const ranking = researchChipFor(RANKING)!;
  const neutral = researchChipFor(NEUTRAL)!;
  const other = { id: 'agent-next-pre-mortem', label: 'Run a pre-mortem', message: 'Imagine this went badly.' };
  const all = (): boolean => true;
  const neutralOnly = (chip: unknown): boolean => (chip as { id: string }).id !== ranking.id;

  it('CONTROL: every offered control is on the body \u2192 the SAME body, untouched', () => {
    const body = { assistant_text: PROMISE, suggested_actions: [other, neutral] };
    expect(withResearchControlTruth(body, [neutral], all)).toBe(body);
    expect(withResearchControlTruth(body, [], neutralOnly)).toBe(body);
  });

  it('a control the gate would remove is taken off, and the reply says why in fixed words', () => {
    const out = withResearchControlTruth({ assistant_text: `${PROMISE}  \n`, suggested_actions: [other, ranking] }, [ranking], neutralOnly);
    expect(out.suggested_actions).toEqual([other]);
    expect(out.assistant_text).toBe(`${PROMISE}\n\n${WITHDRAWN}`);
  });

  it('an offered control that is simply not on the body is said so, with no reason it did not measure', () => {
    const out = withResearchControlTruth({ assistant_text: PROMISE, suggested_actions: [other] }, [neutral], all);
    expect(out.suggested_actions).toEqual([other]);
    expect(out.assistant_text).toBe(`${PROMISE}\n\n${RESEARCH_NOT_ON_OFFER_TEXT}`);
  });

  it('two offers, one shown: the reply says only the search shown is on offer', () => {
    const out = withResearchControlTruth({ assistant_text: PROMISE, suggested_actions: [neutral, ranking] }, [neutral, ranking], neutralOnly);
    expect(out.suggested_actions).toEqual([neutral]);
    expect(out.assistant_text).toBe(`${PROMISE}\n\n${RESEARCH_ONLY_SHOWN_TEXT} ${RESEARCH_WORDING_REASON_TEXT}`);
  });

  it('the sentence goes where `place` puts it (the route keeps it out from behind the questions toggle)', () => {
    const out = withResearchControlTruth({ assistant_text: PROMISE, suggested_actions: [] }, [ranking], neutralOnly, (text, sentence) => `${sentence} | ${text}`);
    expect(out.assistant_text).toBe(`${WITHDRAWN} | ${PROMISE}`);
  });

  it('the fixed sentences name no option and use no leader vocabulary, and the gate leaves them as written', () => {
    expect(textNamesLeadingOption(`${OPTIONS[0]} is the best option`), 'POSITIVE CONTROL: the probe sees a leader claim').toBe(true);
    const said = `${PROMISE}\n\n${RESEARCH_NOT_ON_OFFER_TEXT} ${RESEARCH_ONLY_SHOWN_TEXT} ${RESEARCH_WORDING_REASON_TEXT}`;
    for (const text of [RESEARCH_NOT_ON_OFFER_TEXT, RESEARCH_ONLY_SHOWN_TEXT, RESEARCH_WORDING_REASON_TEXT]) {
      expect(textNamesLeadingOption(text), text).toBe(false);
      expect(textAssertsLeadingOption(text, { optionLabels: [...OPTIONS] }), text).toBe(false);
    }
    expect(findLeaderClaims({ assistant_text: said, suggested_actions: [], blocks: [] } as unknown as Parameters<typeof findLeaderClaims>[0])).toEqual([]);
    const out = enforceLeaderLicenceAtFinalEgress({ assistant_text: said, suggested_actions: [], blocks: [] }, {
      licence: 'withheld', graph: GRAPH, analysisReady: undefined, requestId: 'research-control', exitPath: 'test', mayNameLeadingOption: false, separationEstablished: false,
    });
    expect(out.response.assistant_text).toBe(said);
    // And when the gate DOES edit a neighbouring sentence, the fixed words beside it are left whole.
    const edited = enforceLeaderLicenceAtFinalEgress({ assistant_text: `${OPTIONS[0]} is the best option. ${WITHDRAWN}`, suggested_actions: [], blocks: [] }, {
      licence: 'withheld', graph: GRAPH, analysisReady: undefined, requestId: 'research-control', exitPath: 'test', mayNameLeadingOption: false, separationEstablished: false,
    });
    expect(edited.response.assistant_text).not.toContain('is the best option');
    expect(String(edited.response.assistant_text).endsWith(WITHDRAWN), String(edited.response.assistant_text)).toBe(true);
  });
});
