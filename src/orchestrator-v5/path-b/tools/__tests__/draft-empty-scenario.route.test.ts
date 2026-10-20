/**
 * ⛔ CORE CAN DRAFT THE FIRST MODEL (VERIFIER CORE run on 86c9663a, redteam/core-accept/runs/20261019T174921Z: every case failed at
 * turn 1 — `build_model_from_brief` → unavailable `read_malformed`). A NEW scenario's graph read is `graph: null, graph_present:
 * false, graph_hash: null, graph_identity_hash: null` (assist.v1.scenario-graph.ts, "An EMPTY graph is a valid answer"), and the
 * adapters' one reader called that malformed. Through the REAL route in core mode: a scripted AI, the REAL draft adapter (one
 * drafter call with a scripted answer, Step 8's `candidateToGraph`, create-only registration), and the graph / register / versions
 * routes as doubles that answer in the served shapes. SYNTHETIC wording; no journey brief. (The brief stays the AI's literal copy
 * of the user's words, as on base.)
 */
import { runPressToolResponse } from '../../../agent-lane/__tests__/fixtures/run-press-model.js';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeAnalysisAffectingGraphHash } from '../../../context/graph-hash.js';
import { registrationTurnId } from '../../../graph-registration/registration-identity.js';
import { candidateToGraph } from '../candidate-to-graph.js';
import { readCanonicalContext } from '../context-tool.js';
import { valueProvenanceOf } from '../../../../cee/provenance/provenance-of.js';
import { placeholderGoalPaths, unsizedLeaderGoalPaths } from '../../../agent-lane/goal-certainty.js';

type Json = Record<string, any>;
/** A NEW scenario per row: the route keeps each scenario's verified typed messages for the process. */
let SCENARIO = '';
const AIM = 'We want to grow weekly bookings to at least 300 within 12 months.';
const BRIEF = [AIM, 'Bookings are 180 a week today.', 'We could add evening slots or run a referral offer.'].join('\n');
const GOAL = 'Weekly bookings';

/** The drafter's answer (the lean-core real-path draft shape, lean-core-authorship.route.test.ts). */
const DRAFT = (() => {
  const link = (from: string, to: string): Json => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 300, unit: 'bookings a week', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 180, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Add evening slots', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Evening slots', value: 20, value_kind: 'absolute', unit: 'slots a week', provenance: 'ai_proposed' }] },
    ],
    factors: [{ label: 'Evening slots', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'slots a week', provenance: 'ai_proposed', plausible_max: 60 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [link('Evening slots', GOAL)],
    statements: [{ quote: AIM, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound',
      value: 300, low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null }],
  };
})();

/**
 * ⭐ K5 LOOP SHAPE (VERIFIER 23:47Z on 4d8080ea), synthetic: an added part at 0 today the AI declared `inferred` with no statement of it, and
 * its one-for-one definition into the goal declared `inferred` with no quote.
 */
const ADDED = 'Extra bookings from evening slots';
const ADDED_DRAFT: Json = {
  ...DRAFT,
  factors: [...DRAFT.factors, { label: ADDED, role: 'observable', baseline_known: true, baseline_value: 0, unit: 'bookings a week', provenance: 'inferred', origin: 'olumi', stance: 'estimate', plausible_max: null }],
  links: [{ ...DRAFT.links[0], to: ADDED }, { ...DRAFT.links[0], from: ADDED, effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'inferred', definitional: true }],
};
/**
 * ⭐ K5 P0 RULING SHAPE (option 2, 20 Oct), synthetic: what B's drafter text asks for. The goal's current level is its own fixed factor
 * carrying the goal baseline; the option's effect is a setting on the addition; the goal is declared as their sum, each operand linked one
 * for one in the same unit.
 */
const CURRENT = 'Current weekly bookings';
const SUM_DRAFT: Json = {
  ...DRAFT,
  options: [DRAFT.options[0], { ...DRAFT.options[1], interventions: [{ factor_label: ADDED, value: 20, value_kind: 'absolute', unit: 'bookings a week', provenance: 'explicit' }] }],
  factors: [{ label: CURRENT, role: 'observable', baseline_known: true, baseline_value: 180, unit: 'bookings a week', provenance: 'explicit', plausible_max: null },
    { label: ADDED, role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'bookings a week', provenance: 'inferred', plausible_max: 60 }],
  links: [CURRENT, ADDED].map((from) => ({ ...DRAFT.links[0], from, effect_amount: 1, effect_per_source_change: 1, effect_provenance: 'inferred', definitional: true })),
  identities: [{ operation: 'sum', outcome: GOAL, factors: [CURRENT, ADDED], provenance: 'inferred', evidence: null }],
};
let drafterAnswer: Json = DRAFT;
let draftSchema: Json = {};

const rows = new Map<string, { id: string; turn_id: string; request_hash: string }>();
const conversationIds = new Map<string, string>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: { turn_id: string; request_hash: string }) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return { id: prior.id, replayedPriorTurn: true as const };
    const row = { id: `row-${rows.size + 1}`, turn_id: w.turn_id, request_hash: w.request_hash };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => []),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
  readOpenAiConversationId: vi.fn(async (sid: string): Promise<string | null | undefined> => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string): Promise<string | null | undefined> => {
    if (!conversationIds.has(sid)) conversationIds.set(sid, id);
    return conversationIds.get(sid);
  }),
  readOpenAiPausedRun: vi.fn(async () => null),
  saveOpenAiPausedRun: vi.fn(async () => true),
  takeOpenAiPausedRun: vi.fn(async () => true),
};
vi.mock('../../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

let served = 0;
/** What the route hands the AI after each tool call (`function_call_output`), as sent. */
const toolOutputs: Json[] = [];
const responsesBody = (output: Record<string, unknown>[]): Json => {
  served += 1;
  return {
    id: `resp_${served}`, object: 'response', model: 'gpt-scripted-returned', status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed',
          content: (item.content as Json[]).map((c) => ({ ...c, annotations: [] })) }
      : { id: `fc_${served}_${i}`, status: 'completed', ...item }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } },
  };
};

/** The served empty-scenario read (assist.v1.scenario-graph.ts:541–590, `graphPresent` false). */
const EMPTY_READ = (): Json => ({ scenario_id: SCENARIO, graph: null, graph_present: false, brief_text: null, graph_identity_hash: null, graph_hash: null });

describe('core drafts the FIRST model of a new scenario (graph null is a valid empty state)', () => {
  let app: FastifyInstance;
  let saved: Json | null = null;
  let registered: Json[] = [];
  let read: () => Json = EMPTY_READ;
  let briefArg = BRIEF;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return new Response(JSON.stringify({ id: 'conv_draft', object: 'conversation' }), { status: 200, headers: { 'content-type': 'application/json' } });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      const runCall = runPressToolResponse(body);
      if (runCall) return runCall;
      const ok = (output: Record<string, unknown>[]) => new Response(JSON.stringify(responsesBody(output)), { status: 200, headers: { 'content-type': 'application/json' } });
      // The construction's structured calls: the whole candidate gets the drafter's answer; any other structured step answers nothing.
      if (body.text?.format?.type === 'json_schema') {
        if (body.text.format.name === 'whole_candidate') draftSchema = body.text.format.schema;
        return ok(body.text.format.name === 'whole_candidate' ? [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(drafterAnswer) }] }] : []);
      }
      // The core agent: first the draft call, then its words.
      const input = Array.isArray(body.input) ? body.input as Json[] : [];
      toolOutputs.push(...input.filter((i) => i.type === 'function_call_output'));
      if (!input.some((i) => i.type === 'function_call_output')) {
        return ok([{ type: 'function_call', name: 'build_model_from_brief', call_id: 'draft_call', arguments: JSON.stringify({ brief: briefArg }) }]);
      }
      return ok([{ type: 'message', content: [{ type: 'output_text', text: 'Here is a first model.' }] }]);
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => read());
    app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
      const b = req.body as Json;
      registered.push(b);
      saved = b.graph as Json;
      const graphHash = computeAnalysisAffectingGraphHash(saved as never);
      read = () => ({ scenario_id: SCENARIO, graph: saved, graph_present: true, brief_text: b.brief_text ?? null,
        graph_identity_hash: { kind: 'graph_identity', value: 'id_1', algorithm: 'sha256' }, graph_hash: graphHash });
      return { model_version: { version_id: 'v_1', version_number: 1 } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async (req) => ({ versions: registered.map((b, i) => ({
      version_id: `v_${i + 1}`, sequence: i + 1, created_at: '2026-10-19T18:00:00.000Z',
      creation: { kind: 'committed_mutation', mutation_id: `m_${i + 1}`, source_turn_id: registrationTurnId((req.params as { id: string }).id, String(b.operation_id)) } })) }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { SCENARIO = randomUUID(); rows.clear(); conversationIds.clear(); saved = null; registered = []; read = EMPTY_READ; toolOutputs.length = 0; drafterAnswer = DRAFT; briefArg = BRIEF; draftSchema = {}; });

  const turn = async (): Promise<Json> => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', headers: { 'x-olumi-ai-mode': 'core' }, payload: {
      kind: 'message', turn_id: randomUUID(), scenario_id: SCENARIO, stage: 'frame', turn_class: 'frame', message: briefArg, source: 'composer' } });
    expect(r.statusCode, r.body).toBe(200);
    return r.json() as Json;
  };
  const draftCall = (body: Json): Json => (body._agent?.tool_calls as Json[] | undefined)?.find((c) => c.name === 'build_model_from_brief') ?? {};

  it('RED: a NEW scenario (graph null) → ONE draft saved, by its own receipt and a model read back', async () => {
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({ brief_text: BRIEF, expected_graph_identity_hash: null });
    expect((saved?.nodes as Json[]).length).toBeGreaterThan(0);
  });

  it('⭐ STEP 8 gap 3 (RED on the bridge): the model saved is candidateToGraph\'s conversion of the ONE draft, and the draft travels to the AI beside the receipt', async () => {
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    // ⭐ The draft's statements are recorded on their subjects from the brief's own words (gap 3 carry): the aim, on the goal's target.
    const goal = (registered[0]!.graph.nodes as Json[]).find((n) => n.kind === 'goal')!;
    expect(goal.user_statements).toEqual([{ subject_key: `goal|${goal.id}|||target`, field: 'target', recorded_at: expect.any(String),
      attest: { recorded_by: 'construction' }, statements: [{ said_by: 'unknown', quote: AIM, source: AIM, form: 'lower_bound', low: 300,
        unit: 'bookings a week', reading: 'olumi', subject: { quantity: `goal|${goal.id}|||target`, node_id: goal.id } }] }]);
    const converted = candidateToGraph(DRAFT, { words: BRIEF, recorded_at: goal.user_statements[0].recorded_at });
    if ('refused' in converted) throw new Error(converted.refused);
    // The registered bytes are the conversion's: A's numbers on a label-blind copy, each figure with the origin the AI declared.
    expect(registered[0]!.graph).toEqual(converted.graph);
    // The AI reads the drafter's JSON verbatim, and what the conversion said, in the tool's answer (the conversation keeps them).
    const answer = JSON.parse(String(toolOutputs.find((o) => o.call_id === 'draft_call')?.output ?? '{}')) as Json;
    expect(answer).toMatchObject({ status: 'ok', mutated: true, data: { provisional: 'olumi', draft: { declared: DRAFT, not_expressible: converted.blocked_schema } } });
    expect(answer.data.draft.said).toEqual([...new Set(converted.loss.map((l) => l.reason))]);
  });

  it('⭐ GAP 1 + K5 LOOP (real path): the added part\'s 0 is saved as Olumi\'s, and a size with no quote is never said as the brief\'s', async () => {
    drafterAnswer = ADDED_DRAFT;
    const body = await turn();
    expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    const part = (registered[0]!.graph.nodes as Json[]).find((n) => n.label === ADDED)!;
    expect(part.observed_state).toMatchObject({ value: 0, source: 'cee_inference' });
    const said = (JSON.parse(String(toolOutputs.find((o) => o.call_id === 'draft_call')?.output ?? '{}')) as Json).data.draft.said as string[];
    expect(said).toContain(`This link was drafted at 1 per 1; this path doesn't use that size in the calculation yet, so the link from "${ADDED}" to "${GOAL}" keeps Olumi's placeholder size.`);
    expect(said.filter((x) => x.includes('says "1 per 1"'))).toEqual([]);
  });

  it('⭐ K5 P0 RULING (real path): the sum the drafter text asks for is carried exact, and no placeholder stands between the option and the goal', async () => {
    const savedFor = async (answer: Json): Promise<Json> => {
      SCENARIO = randomUUID(); registered = []; saved = null; read = EMPTY_READ; drafterAnswer = answer;
      const body = await turn();
      expect(draftCall(body), JSON.stringify(body._agent)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
      return registered[0]!.graph as Json;
    };
    const g = await savedFor(SUM_DRAFT);
    const id = (label: string): string => (g.nodes as Json[]).find((n) => n.label === label)!.id;
    const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
    expect(goal.nonlinear_identity).toMatchObject({ operation: 'sum', factor_ids: [id(CURRENT), id(ADDED)] });
    // Exact: each operand is the sum's definition (existence 1, Olumi's, never the person's); the Run evaluates the identity itself.
    for (const from of [CURRENT, ADDED]) {
      expect((g.edges as Json[]).find((e) => e.from === id(from) && e.to === goal.id)).toMatchObject({ exists_probability: 1, provenance: { definitional: true, magnitude: 'olumi_estimate' } });
    }
    const optionsOf = (graph: Json): string[] => (graph.nodes as Json[]).filter((n) => n.kind === 'option').map((n) => n.id as string);
    const options = optionsOf(g);
    expect((g.nodes as Json[]).find((n) => n.label === 'Add evening slots')!.interventions[id(ADDED)]).toMatchObject({ raw_value: 20 });
    // The goal chance is computable: no placeholder link on any option's path to the goal (the gate that withheld it in the K5 loop) …
    expect(placeholderGoalPaths(g, options)).toEqual([]);
    expect(unsizedLeaderGoalPaths(g, options)).toEqual([]);
    // … while the K5 loop's served shape (no declared sum) still has one, so the gate is not vacuous.
    const loop = await savedFor(ADDED_DRAFT);
    expect(placeholderGoalPaths(loop, optionsOf(loop))).not.toEqual([]);
  });

  it.each([
    ['user', 'stated_current', 'We run 6 evening slots today.', 'human'],
    ['olumi', 'estimate', 'We are exploring evening opening.', 'ai'],
    ['unknown', 'estimate', 'Someone mentioned 6 evening slots.', 'unknown'],
    ['user', 'hypothetical', 'Suppose we run 6 evening slots if the trial starts.', null],
  ] as const)('ONE declared pair (real route): %s/%s survives registration and a cold canonical read', async (origin, stance, words, expected) => {
    briefArg = `${BRIEF}\n${words}`;
    drafterAnswer = { ...DRAFT, factors: [{ ...DRAFT.factors[0], baseline_known: true, baseline_value: 6, origin, stance }],
      statements: origin === 'olumi' ? [] : [{ quote: words, subject: { kind: 'factor', label: 'Evening slots', to_label: null, factor_label: null },
        field: 'level', form: 'point', value: 6, low: null, high: null, unit: 'slots a week', qualifier: null,
        conditions: stance === 'hypothetical' ? 'if the trial starts' : null, speaker: origin === 'user' ? 'user' : 'unknown' }] };
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: true, mutated: true, outcome: 'ok' });
    expect(registered).toHaveLength(1);
    expect(draftSchema.properties.factors.items.required).toEqual(expect.arrayContaining(['origin', 'stance']));
    // Serialise the store then read it through a fresh canonical reader, with no turn history.
    saved = JSON.parse(JSON.stringify(saved)) as Json;
    const factor = (saved!.nodes as Json[]).find((n) => n.label === 'Evening slots')!;
    if (expected === null) expect(factor.observed_state).toBeUndefined();
    else expect(valueProvenanceOf(factor.observed_state).origin).toBe(expected);
    const cold = await readCanonicalContext({ dispatch: async () => ({ status: 200, json: read() }) }, { scenario_id: SCENARIO });
    expect(cold.status).toBe('ok');
    const node = ((cold as { data: Json }).data.nodes as Json[]).find((n) => n.id === factor.id)!;
    if (origin === 'olumi') expect(node.statements ?? []).toEqual([]);
    else expect(node.statements[0].statements).toEqual([expect.objectContaining({
      ...(origin === 'user' ? { speaker: 'user' } : { said_by: 'unknown' }), quote: words, low: 6, high: 6, stance,
      ...(stance === 'hypothetical' ? { conditions: 'if the trial starts' } : {}),
    })]);
    if (expected === null) expect(node).not.toHaveProperty('observed');
    else expect(node.observed_source.origin).toBe(expected);
  });

  it('ONE declared pair negative (real route): another subject\'s literal figure never credits this factor as the user\'s', async () => {
    briefArg = `${BRIEF}\nWe run 6 evening slots; the studio has 9 rooms.`;
    drafterAnswer = { ...DRAFT, factors: [{ ...DRAFT.factors[0], baseline_known: true, baseline_value: 9, origin: 'user', stance: 'stated_current' }],
      statements: [{ quote: 'the studio has 9 rooms', subject: { kind: 'factor', label: 'Studio rooms', to_label: null, factor_label: null },
        field: 'level', form: 'point', value: 9, low: null, high: null, unit: 'slots a week', speaker: 'user' }] };
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: true, mutated: true });
    const factor = (saved!.nodes as Json[]).find((n) => n.label === 'Evening slots')!;
    expect(valueProvenanceOf(factor.observed_state).origin).toBe('unknown');
    expect(factor.user_statements ?? []).toEqual([]);
  });

  it('CONTRAST: a non-null read that is not a graph is still malformed: refused, nothing registered', async () => {
    read = () => ({ scenario_id: SCENARIO, graph: 'not a graph', graph_present: true, graph_hash: 'h', graph_identity_hash: null });
    const body = await turn();
    expect(draftCall(body)).toMatchObject({ ok: false, mutated: false, outcome: 'unavailable', refusal: 'read_malformed' });
    expect(registered).toHaveLength(0);
  });
});
