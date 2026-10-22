/**
 * ⭐ PATH-B GAP 4 (Paul via the AIE, 19 Oct 18:08): ON `core`, A COMMITTED CHANGE AND AN UNDO EACH RUN THE EXISTING Run
 * PIPELINE EXACTLY ONCE, AND THE SAME SDK RUN THAT OWNS THE REPLY RECEIVES THE ENGINE'S RESULTS AS A TYPED TOOL OUTCOME.
 *  · commit: the approved `apply_change` commits, then the route's automatic Run (`analyseCommittedChange`, once per request)
 *    runs, and its result rides `apply_change`'s own outcome; the SDK continues natively and the AI writes the reply:
 *    results first, then coaching on that same Run, with the preceding Run's comparison where one exists;
 *  · Undo: the canvas's Run after the restore reaches CEE as a Run press; on `core` the SDK run's first call is
 *    `run_analysis`, which spends the press's ONE Run through the existing pipeline (its operation id makes a resend recover
 *    that Run, never run another);
 *  · never a second interpreting call, a second Run, or a host line on the AI's reply. A failed Run keeps the save.
 * Harness: the real route, SDK, card carrier, Run pipeline and adapters; the write itself is a counted commit (C5's door is
 * proven in `path-b/tools/__tests__`), the model is scripted through global fetch (0 provider calls). SYNTHETIC wording.
 */
import { computeGraphIdentityHash } from '../../context/graph-identity.js';
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildRunDelta } from '../../coaching/build-run-delta.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { streamWhenAsked } from './stream-when-asked.js';

type Json = Record<string, any>;
const SCENARIO = '6a1d2c3b-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CORE = { 'x-olumi-ai-mode': 'core' };
const graphAt = (value: number) => ({
  nodes: [{ id: 'g', kind: 'goal', label: 'Velocity' }, { id: 'f', kind: 'factor', label: 'Capacity', observed_state: { value } }],
  edges: [{ from: 'f', to: 'g' }],
});
const GRAPH_AT_2 = graphAt(2);
const GRAPH_AT_4 = graphAt(4);
const HASH_2 = computeAnalysisAffectingGraphHash(GRAPH_AT_2 as never)!;
const HASH_4 = computeAnalysisAffectingGraphHash(GRAPH_AT_4 as never)!;
const PRIOR_AT = '2026-10-19T03:00:00.000Z';
const RUN_AT = '2026-10-19T03:02:00.000Z';
const SAVED_BETWEEN = '2026-10-19T03:01:00.123456+00:00';
const RESTORE_V = 'a1b2c3d4-0000-4000-8000-000000000014';
const RESTORE_MUT = 'e5f6a7b8-0000-4000-8000-0000000000d4';
const EARLIER_V = 'a1b2c3d4-0000-4000-8000-000000000012';
const EDIT_V = 'a1b2c3d4-0000-4000-8000-000000000013';

function runFact(runId: string, computedAt: string, wins: [number, number], hash: string): HandlerFact {
  return { fact_type: 'run_analysis', noop: false, result: {
    enrichment: { analysis_status: 'completed',
      results: [{ option_id: 'opt_a', option_label: 'Option A', win_probability: wins[0] }, { option_id: 'opt_b', option_label: 'Option B', win_probability: wins[1] }],
      meta: { seed_used: '4242', n_samples: 10_000 }, _meta: { builds: { plot: 'plot-1', isl: 'isl-1' } } },
    run_id: runId, computed_at: computedAt, graph_hash_at_run: hash,
    constraint_verdict: { may_name_leading_option: true, constraint_verdict_state: 'evaluated_feasible' },
  } } as unknown as HandlerFact;
}
const built = buildRunDelta({ priorFacts: [runFact('run-at-2', RUN_AT, [0.44, 0.56], HASH_2), runFact('run-at-4', PRIOR_AT, [0.61, 0.39], HASH_4)], mayNameLeadingOption: false });
if (built.kind !== 'ok') throw new Error(`fixture: the producer refused (${built.reason})`);
const DELTA = built.delta;
const READY = { status: 'ready', options: [], blockers: [], goal_node_id: 'g' };
const PRIOR_STATE = { run_state: { kind: 'complete_current', computed_at: PRIOR_AT } };
const PRIOR_RESULT = { type: 'analysis_result', computed_against_hash: HASH_4, summary: 'The earlier comparison.', leading_option_id: null };
const STATE = { run_state: { kind: 'complete_current', computed_at: RUN_AT },
  leader_claim: { permitted: false, withheld_reason: 'options_do_not_separate', separation: 'near_tie' } };
const RESULT = { type: 'analysis_result', computed_against_hash: HASH_2, summary: 'A provisional comparison.', leading_option_id: null };

/** The model-management head as `getCurrentVersion` returns it: a restore for the Undo rows, an ordinary edit otherwise. */
const versionRow = (over: Record<string, unknown> = {}) => ({
  id: RESTORE_V, scenario_id: SCENARIO, owner_user_id: 'owner-1', version_number: 4, graph_identity_hash: 'f'.repeat(64),
  hash_algorithm: 'sha256', identity_projection_version: '1', identity_normaliser_version: '1', graph_schema_version: '1',
  analysis_affecting_hash: 'e'.repeat(64), mutation_id: RESTORE_MUT, parent_version_id: EDIT_V, root_version_id: EARLIER_V,
  actor_kind: 'known', authored_by: 'owner-1', creation_kind: 'restore', source_version_id: EARLIER_V, source_turn_id: null,
  label: 'Undo: Edit Capacity', provenance: null, restored_from_version_id: EARLIER_V, created_at: SAVED_BETWEEN, graph: GRAPH_AT_2, ...over,
});
let head: unknown;
vi.mock('../../model-management/index.js', async (original) => ({
  ...await original<Record<string, unknown>>(),
  getModelManagementService: () => ({ getCurrentVersion: async () => head }),
}));

/** The scenario as stored: its graph, whether the change was committed, and whether a Run has analysed the saved model. */
const world = { graph: GRAPH_AT_4 as Json, hash: HASH_4, ranOnSaved: false, prior: true, runStatus: 200, delta: true };
const probe = vi.hoisted(() => ({ applied: 0, proposalId: '' }));
/** The write is a counted commit of the proposal (C5's real door is proven in path-b/tools/__tests__); the adapters stay real. */
vi.mock('../../path-b/tools/change-tools.js', async (original) => {
  const real = await original<any>();
  const { ok } = await import('../../path-b/tools/outcome.js');
  return { ...real, applyChange: async () => {
    probe.applied += 1;
    world.graph = GRAPH_AT_2; world.hash = HASH_2; world.ranOnSaved = false;
    return ok({ proposal_id: probe.proposalId, receipt: { version_number: 5 } }, { mutated: true });
  } };
});
vi.mock('../../path-b/tools/index.js', async (original) => {
  const real = await original<any>();
  const { createProposal } = await import('../proposal.js');
  return { ...real, pathBTools: (deps: any, ctx: any, mode: any, onCall: any) => {
    const p = createProposal({ scenario_id: ctx.scenario_id, user_id: ctx.authenticated_user_id, base_graph_identity_hash: HASH_4,
      operations: [{ op: 'set_factor_value', path: 'f', value: { value: 2, unit: 'people', stance: 'estimate', source: { origin: 'olumi', quote: null, named_source: null } } }],
      provenance: { authored_by: 'model_proposed', basis: 'Synthetic' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Set Capacity to 2' });
    deps.proposals.put(p); probe.proposalId = p.proposal_id;
    return real.pathBTools(deps, ctx, mode, onCall);
  } };
});

let pausedRun: any = null;
const rows = new Map<string, any>();
/** The engine's Run turns as the orchestrator records them: the turn row (keyed by the Run operation's id) and its fact. */
const runRows = new Map<string, any>();
const runFacts = new Map<string, unknown>();
const conversationIds = new Map<string, string>();
const store = {
  readOpenAiPausedRun: vi.fn(async () => pausedRun),
  saveOpenAiPausedRun: vi.fn(async (_s: string, r: any) => { if (pausedRun !== null) return false; pausedRun = r; return true; }),
  takeOpenAiPausedRun: vi.fn(async (_s: string, id: string) => { if (pausedRun?.pause_id !== id) return false; pausedRun = null; return true; }),
  readOpenAiConversationId: vi.fn(async (sid: string) => conversationIds.get(sid) ?? null),
  claimOpenAiConversationId: vi.fn(async (sid: string, id: string) => { if (!conversationIds.has(sid)) conversationIds.set(sid, id); return conversationIds.get(sid); }),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? runRows.get(id) ?? null),
  append: vi.fn(async (w: any) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...w, scenario_id: SCENARIO, created_at: new Date().toISOString(), id: `row-${rows.size + 1}`, assistant_message: w.assistantMessage, user_message: w.userMessage };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => [...rows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).reverse()),
  readMostRecentPendingActions: vi.fn(async () => [...rows.values()].filter((r) => !String(r.turn_id).endsWith(':claim')).at(-1)?.pending_actions ?? []),
  readFactsFor: vi.fn(async (ids: readonly string[], kind?: string) => kind === 'run_analysis' ? ids.flatMap((id) => runFacts.has(id) ? [runFacts.get(id)] : []) : []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  readExistingScenario: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));

/** One scripted Responses API body (the SDK reads ids, roles and status as the API sends them). */
let served = 0;
const responsesBody = (output: Json[]): Json => {
  served += 1;
  return { id: `resp_${served}`, object: 'response', model: 'gpt-scripted', status: 'completed',
    output: output.map((item, i) => item.type === 'message'
      ? { id: `msg_${served}_${i}`, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: item.text, annotations: [] }] }
      : { id: `fc_${served}_${i}`, status: 'completed', type: 'function_call', name: item.name, call_id: item.call_id ?? `call_${served}_${i}`,
          arguments: item.name === 'apply_change' ? JSON.stringify({ proposal_id: probe.proposalId }) : JSON.stringify(item.args ?? {}) }),
    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } };
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Every function_call_output the AI received, by tool name, parsed. */
function toolOutputs(body: Json): { call_id: string; output: Json }[] {
  return (Array.isArray(body.input) ? body.input : []).flatMap((item: Json) => {
    if (item?.type !== 'function_call_output' || typeof item.output !== 'string') return [];
    try { return [{ call_id: String(item.call_id), output: JSON.parse(item.output) as Json }]; } catch { return []; }
  });
}

const PREPARED = 'I have prepared the change; approve it on its card.';
const COACHED = 'Capacity at 2 changes the picture: the options no longer separate in this model.';
const UNDONE = 'After the Undo, Capacity is back at 2, and in this model the options no longer separate.';

describe('PATH-B gap 4: commit and Undo each run the existing Run pipeline once; the SDK run that owns the reply narrates it', () => {
  let app: FastifyInstance;
  /** The model calls of the current request, and the scripted outputs they get, in order. */
  let calls: Json[] = [];
  let outputs: (Json[] | 'fail')[] = [];
  let runTurns = 0;
  /** A change between the AI's calls (another writer), seen by the model call about to be answered. */
  let beforeModelCall: ((body: Json) => void) | undefined;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(streamWhenAsked(async (url: unknown, init?: { body?: unknown }) => {
      if (String(url).endsWith('/v1/conversations')) return json({ id: 'conv_gap4', object: 'conversation' });
      const body = JSON.parse(String(init?.body ?? '{}')) as Json;
      calls.push(body);
      beforeModelCall?.(body);
      const next = outputs.shift() ?? [{ type: 'message', text: COACHED }];
      if (next === 'fail') return json({ error: { message: 'scripted provider failure', type: 'server_error' } }, 400);
      return json(responsesBody(next));
    })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const route = await import('../../../routes/agent-v1-turn.js');
    // A resend of a turn whose outcome is unknown is answered after this wait (its original is not still running here).
    route.AGENT_TURN_CLAIM_WAIT.totalMs = 50;
    app = Fastify({ logger: false });
    // The engine's Run turn: counted. It analyses the SAVED model; a preceding Run gives it a run-over-run delta.
    app.post('/orchestrate/v2/turn', async (req, reply) => {
      runTurns += 1;
      if (world.runStatus !== 200) return reply.code(world.runStatus).send({ error: 'engine unavailable' });
      world.ranOnSaved = true;
      const turnId = String((req.body as Json).turn_id);
      runRows.set(turnId, { id: `run-row-${runTurns}`, turn_id: turnId, request_hash: 'native-run', user_message: null, assistant_message: null, llm_calls_used: 0 });
      runFacts.set(`run-row-${runTurns}`, { fact_type: 'run_analysis', fact_version: 1, noop: false, result: { scenario_id: SCENARIO,
        run_id: 'fixture-read-run', graph_hash_at_run: world.hash, computed_at: RUN_AT, leading_option_id: null, summary: RESULT.summary } });
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: world.hash,
        blocks: [{ ...RESULT, computed_against_hash: world.hash }], analysis_state: STATE, analysis_ready: READY, ...(world.delta ? { run_delta: DELTA } : {}) };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => world.ranOnSaved
      ? withCanonicalAnalysisView({ graph: world.graph, graph_hash: world.hash, analysis_ready: READY, analysis_state: STATE, analysis_result: { ...RESULT, computed_against_hash: world.hash },
          current_read: { run_state: STATE.run_state, run_id: 'fixture-read-run', computed_against_hash: world.hash, ...(world.delta ? { run_delta: DELTA } : {}) } }, SCENARIO)
      : { graph: world.graph, graph_hash: world.hash, graph_identity_hash: computeGraphIdentityHash(world.graph as never), analysis_ready: READY,
          ...(world.prior ? { analysis_state: PRIOR_STATE, analysis_result: PRIOR_RESULT } : {}) });
    await app.register(route.agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    rows.clear(); runRows.clear(); runFacts.clear(); conversationIds.clear(); pausedRun = null; calls = []; outputs = []; runTurns = 0; probe.applied = 0;
    beforeModelCall = undefined;
    // The store's own read of the saved scenario (the other-writer recheck): the live world, as the graph route serves it.
    store.readExistingScenario.mockImplementation(async () => ({ revision: 7, graph: world.graph }) as never);
    Object.assign(world, { graph: GRAPH_AT_4, hash: HASH_4, ranOnSaved: false, prior: true, runStatus: 200, delta: true });
    head = { status: 'ok', value: versionRow({ creation_kind: 'committed_mutation', source_version_id: null, restored_from_version_id: null, label: 'Edit Capacity', id: EDIT_V }) };
  });

  const post = (payload: Json) => app.inject({ method: 'POST', url: '/agent/v1/turn', headers: CORE,
    payload: { kind: 'message', scenario_id: SCENARIO, stage: 'analyse', turn_class: 'frame', ...payload } });
  /** Turn 1: the AI prepares the change and calls `apply_change`, so the SDK run pauses for approval on its card. */
  const prepared = async (): Promise<{ approve: Json; revision: string; digest: string; graphHash: string }> => {
    outputs = [[{ type: 'message', text: PREPARED }, { type: 'function_call', name: 'apply_change', call_id: 'apply_call' }]];
    const r = await post({ turn_id: randomUUID(), message: 'Set Capacity to 2.', source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j._agent.sdk?.paused?.proposal_id, 'PRECONDITION: the run paused on the proposal').toBe(probe.proposalId);
    const approve = (j.suggested_actions as Json[]).find((c) => String(c.id).startsWith('agent-approve-proposal:'));
    const rec = (j._proposal_fields?.proposals as Json[] | undefined)?.find((f) => f.proposal_id === probe.proposalId);
    expect(approve, 'PRECONDITION: the card is offered').toBeDefined();
    expect(probe.applied).toBe(0);
    expect(runTurns, 'nothing ran before the approval').toBe(0);
    calls = [];
    return { approve: approve!, revision: String(rec?.revision), digest: String(rec?.digest), graphHash: String(j._proposal_fields?.graph_hash) };
  };
  /** Turn 2: the press on that card. */
  const press = (card: { approve: Json; revision: string }, turnId = randomUUID()) => post({ turn_id: turnId, message: card.approve.message,
    source: 'chip_click', chip: { id: card.approve.id }, displayed_proposals: [{ proposal_id: probe.proposalId, revision: card.revision }] });
  /** The UI's ordinary press (`SuggestedChips.tsx`; served bytes, VERIFIER 22:26Z): source `chip`, the issued envelope, no fields. */
  const uiPress = (card: { approve: Json; revision: string; digest: string; graphHash: string }) => post({ turn_id: randomUUID(), message: card.approve.message,
    source: 'chip', chip: { id: card.approve.id },
    proposal_edits: { proposal_id: probe.proposalId, revision: card.revision, digest: card.digest, graph_hash: card.graphHash, fields: [] } });
  /** The canvas's automatic Run after an Undo: a Run press carrying only the Run chip. */
  const runPress = (turnId = randomUUID()) => post({ turn_id: turnId, message: 'Run analysis', source: 'chip_click', chip: { action_type: 'run_analysis' } });
  /** The tool output the AI received for one scripted call (by its call id: `apply_call`, `run_call`). */
  const outputOf = (callId: string): Json | undefined => calls.flatMap(toolOutputs).find((o) => o.call_id === callId)?.output;
  const interpreterCalls = () => calls.filter((b) => b.tool_choice === 'none').length;

  it('⭐ note_on_item (DL ruling 21 Oct): the AI\'s note on one item ships as the turn\'s first block, Olumi\'s, and nothing is written', async () => {
    const NOTE = 'What would make Capacity stop driving Velocity?';
    outputs = [[{ type: 'function_call', name: 'note_on_item', call_id: 'note_call', args: { item_id: 'f', note: NOTE } }], [{ type: 'message', text: 'I have put a question beside Capacity.' }]];
    const r = await post({ turn_id: randomUUID(), message: 'What should I question here?', source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const blocks = (r.json() as Json).blocks as Json[];
    expect(blocks[0]).toEqual({ type: 'ui_directive', verb: 'highlight', targets: [{ id: 'f', label: 'Capacity', kind: 'factor' }], note: NOTE, source: 'composer' });
    expect(blocks.filter((b) => b.type === 'ui_directive')).toHaveLength(1);
    expect(probe.applied, 'a note writes nothing').toBe(0);
    expect(runTurns).toBe(0);
  });

  it('⭐ Codex R1 (3): the model changed after the note was read (another writer) → the note is not shipped beside the new revision', async () => {
    outputs = [[{ type: 'function_call', name: 'note_on_item', call_id: 'note_call', args: { item_id: 'f', note: 'What would make Capacity stop driving Velocity?' } }], [{ type: 'message', text: 'I have put a question beside Capacity.' }]];
    // Another writer saves after the note was read: the call that carries the note's tool output is the first one after it.
    beforeModelCall = (body) => { if (toolOutputs(body).some((o) => o.call_id === 'note_call')) Object.assign(world, { graph: GRAPH_AT_2, hash: HASH_2 }); };
    const r = await post({ turn_id: randomUUID(), message: 'What should I question here?', source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    expect(outputOf('note_call'), 'PRECONDITION: the tool accepted the note at the earlier revision').toMatchObject({ status: 'ok' });
    expect(((r.json() as Json).blocks as Json[] | undefined ?? []).filter((b) => b.type === 'ui_directive')).toHaveLength(0);
  });

  it('⭐ Codex R2: a concurrent RENAME (same analysis hash, new identity) → the note naming the old card is not shipped', async () => {
    outputs = [[{ type: 'function_call', name: 'note_on_item', call_id: 'note_call', args: { item_id: 'f', note: 'What would make Capacity stop driving Velocity?' } }], [{ type: 'message', text: 'I have put a question beside Capacity.' }]];
    const renamed = { ...GRAPH_AT_4, nodes: GRAPH_AT_4.nodes.map((n) => n.id === 'f' ? { ...n, label: 'Team size' } : n) };
    expect(computeAnalysisAffectingGraphHash(renamed as never), 'PRECONDITION: a rename leaves the analysis hash alone').toBe(HASH_4);
    beforeModelCall = (body) => { if (toolOutputs(body).some((o) => o.call_id === 'note_call')) Object.assign(world, { graph: renamed }); };
    const r = await post({ turn_id: randomUUID(), message: 'What should I question here?', source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    expect(outputOf('note_call'), 'PRECONDITION: the tool accepted the note on the model as it was').toMatchObject({ status: 'ok' });
    expect(((r.json() as Json).blocks as Json[] | undefined ?? []).filter((b) => b.type === 'ui_directive')).toHaveLength(0);
  });

  it('CONTRAST: the same turn with no note call ships no directive', async () => {
    outputs = [[{ type: 'message', text: 'Capacity is the one factor here.' }]];
    const r = await post({ turn_id: randomUUID(), message: 'What should I question here?', source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    expect(((r.json() as Json).blocks as Json[] | undefined ?? []).filter((b) => b.type === 'ui_directive')).toHaveLength(0);
  });

  /** The canvas's Challenge press on one card (DGAI `NodeQuickActions` → `askAi`, served 22 Oct): chip `ask:challenge`, the card's own words. */
  const CHALLENGE = 'What is the figure for ‘Capacity’ based on, and what would make a different figure more defensible?';
  const challengePress = (selected: Json[]) => post({ turn_id: randomUUID(), message: CHALLENGE, source: 'chip', chip: { id: 'ask:challenge' }, selected_elements: selected });
  const CHALLENGE_SENTENCE = 'When the person asks you to challenge one item they name, put your challenge to it as this note on that item; if they name no item or several, answer in your reply alone.';
  const forcesNote = (b: Json) => b.tool_choice === 'required' || (b.tool_choice as Json | undefined)?.name === 'note_on_item';

  it('⭐ Challenge on one card (DL 22 Oct): the press offers note_on_item saying to challenge as a note, and the AI\'s challenge ships on that card', async () => {
    const NOTE = 'What is Capacity\'s figure based on, and what would make another one more defensible?';
    outputs = [[{ type: 'function_call', name: 'note_on_item', call_id: 'note_call', args: { item_id: 'f', note: NOTE } }], [{ type: 'message', text: 'I have put a challenge beside Capacity.' }]];
    const r = await challengePress([{ id: 'f', kind: 'factor', label: 'Capacity' }]);
    expect(r.statusCode, r.body).toBe(200);
    const offered = (calls[0]!.tools as Json[]).find((t) => t.name === 'note_on_item');
    expect(String(offered?.description)).toContain(CHALLENGE_SENTENCE);
    const blocks = (r.json() as Json).blocks as Json[];
    expect(blocks[0]).toMatchObject({ type: 'ui_directive', verb: 'highlight', targets: [{ id: 'f', label: 'Capacity', kind: 'factor' }], note: NOTE });
    expect(probe.applied, 'a challenge writes nothing').toBe(0);
  });

  it('⛔ NEGATIVE (DL 22 Oct): a Challenge naming no card, or two, demands no note: nothing forces the tool, and a reply alone ships no directive', async () => {
    for (const selected of [[], [{ id: 'f', kind: 'factor', label: 'Capacity' }, { id: 'v', kind: 'factor', label: 'Velocity' }]]) {
      calls = []; outputs = [[{ type: 'message', text: 'Capacity rests on one estimate; a second source would test it.' }]];
      const r = await challengePress(selected);
      expect(r.statusCode, r.body).toBe(200);
      expect(calls.length, 'PRECONDITION: the AI was asked').toBeGreaterThan(0);
      expect(calls.filter(forcesNote), JSON.stringify(selected)).toHaveLength(0);
      expect(((r.json() as Json).blocks as Json[] | undefined ?? []).filter((b) => b.type === 'ui_directive')).toHaveLength(0);
    }
  });

  it('⭐ RED→GREEN commit → ONE Run → the SAME SDK run gets its results and coaches; with the preceding Run\'s comparison', async () => {
    const card = await prepared();
    const r = await press(card);
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j._agent.sdk?.resumed?.answer).toBe('approved');
    expect(probe.applied, 'one write').toBe(1);
    expect(runTurns, 'exactly one Run, on the saved model').toBe(1);
    expect(calls.length, 'ONE model call: the resumed run narrates; no second interpreting call').toBe(1);
    expect(interpreterCalls()).toBe(0);
    const applied = outputOf('apply_call');
    expect(applied?.status, JSON.stringify(applied)).toBe('ok');
    expect(applied?.mutated).toBe(true);
    const analysis = applied?.data?.analysis as Json | undefined;
    expect(analysis, 'the Run rides apply_change\'s own outcome, typed').toMatchObject({ status: 'ok', ran: true, mutated: false });
    expect(analysis?.data?.result, 'the engine\'s actual result').toBeDefined();
    const comparison = analysis?.data?.run_comparison as Json | undefined;
    expect(comparison?.rerun_record ?? comparison?.run_delta, 'compared with the preceding Run').toBeDefined();
    expect(String(comparison?.note), 'with the existing coach-and-compare note').toContain('compare it with the preceding Run');
    expect(String(calls[0]!.instructions), 'the same call is told: results first, then coaching on that Run').toContain('results first');
    expect(j.assistant_text, 'the reply is the AI\'s own words').toBe(COACHED);
    expect(j._agent.tool_calls, 'the kit reads the commit and its Run').toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'apply_change', mutated: true }), expect.objectContaining({ name: 'run_analysis', ok: true })]));
    expect((j.blocks as Json[]).some((b) => b.type === 'analysis_result'), 'the result blocks ride this response').toBe(true);
  });

  it('⭐ RED→GREEN (VERIFIER 22:26Z (2)): the UI\'s press → ONE write, ONE Run, and the Run\'s own row says it ran', async () => {
    const card = await prepared();
    const r = await uiPress(card);
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(probe.applied, 'one write').toBe(1);
    expect(runTurns, 'exactly one Run, on the saved model').toBe(1);
    expect(j._agent.tool_calls, 'the kit reads the commit and a Run that RAN').toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'apply_change', mutated: true }), expect.objectContaining({ name: 'run_analysis', ok: true, ran: true })]));
  });

  it('⭐ the FIRST eligible commit (no preceding Run) still runs once and is coached; only the comparison is absent', async () => {
    Object.assign(world, { prior: false, delta: false });
    const card = await prepared();
    const r = await press(card);
    expect(r.statusCode, r.body).toBe(200);
    expect(runTurns).toBe(1);
    expect(calls.length).toBe(1);
    const analysis = outputOf('apply_call')?.data?.analysis as Json | undefined;
    expect(analysis).toMatchObject({ status: 'ok', ran: true });
    expect(analysis?.data?.result).toBeDefined();
    expect(analysis?.data?.run_comparison, 'no preceding Run, so no comparison').toBeUndefined();
    expect(String(calls[0]!.instructions)).toContain('results first');
    expect((r.json() as Json).assistant_text).toBe(COACHED);
  });

  it('⭐ a failed Run keeps the save: said by the AI from the outcome; the route runs nothing again and adds no line', async () => {
    world.runStatus = 500;
    const card = await prepared();
    outputs = [[{ type: 'message', text: 'Your change is saved; the analysis could not run this time.' }]];
    const r = await press(card);
    expect(r.statusCode, r.body).toBe(200);
    expect(probe.applied).toBe(1);
    expect(runTurns, 'one attempt, never repeated by the route').toBe(1);
    const applied = outputOf('apply_call');
    expect(applied?.mutated, 'the save stands').toBe(true);
    expect(applied?.data?.analysis).toMatchObject({ status: 'unavailable', reason: 'run_failed' });
    expect(calls.length).toBe(1);
    expect((r.json() as Json).assistant_text, 'no host line appended').toBe('Your change is saved; the analysis could not run this time.');
  });

  it('⭐ a Run the AI asks for in the same turn after the commit runs nothing more (typed approval: run_analysis is offered)', async () => {
    const card = await prepared();
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'again', effects_timing: null } }], [{ type: 'message', text: COACHED }]];
    const r = await post({ turn_id: randomUUID(), message: card.approve.message, source: 'composer',
      displayed_proposals: [{ proposal_id: probe.proposalId, revision: card.revision }] });
    expect(r.statusCode, r.body).toBe(200);
    expect(probe.applied, 'PRECONDITION: the typed approval applied it').toBe(1);
    expect(runTurns, 'still exactly one Run').toBe(1);
    expect(outputOf('run_call')).toMatchObject({ status: 'refused', reason: 'run_not_requested' });
  });

  it('⭐ RED→GREEN Undo → the canvas\'s Run press → ONE Run through the SDK\'s own run_analysis → results and coaching, knowing it was a restore', async () => {
    // The canvas restored the earlier version (its own saved version): the model is back at 2.
    Object.assign(world, { graph: GRAPH_AT_2, hash: HASH_2 });
    head = { status: 'ok', value: versionRow() };
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'The user pressed Run.', effects_timing: null } }], [{ type: 'message', text: UNDONE }]];
    const r = await runPress();
    expect(r.statusCode, r.body).toBe(200);
    const j = r.json() as Json;
    expect(j._agent.sdk, 'the SDK run owns this reply').toBeDefined();
    expect(runTurns, 'exactly one Run').toBe(1);
    expect(calls[0]!.tool_choice, 'its first call spends the press on run_analysis').toMatchObject({ type: 'function', name: 'run_analysis' });
    expect((calls[0]!.tools as Json[]).map((t) => t.name), 'a Run press calculates and reads only (a note writes nothing)').toEqual(['read_canonical_context', 'run_analysis', 'note_on_item']);
    expect(calls.length, 'the call that runs it and the call that narrates it; no interpreting call').toBe(2);
    expect(interpreterCalls()).toBe(0);
    const ran = outputOf('run_call');
    expect(ran?.status, JSON.stringify(ran)).toBe('ok');
    expect(ran?.data?.result).toBeDefined();
    expect(ran?.data?.run_comparison?.restore_between_runs).toMatchObject({ version_id: RESTORE_V, mutation_id: RESTORE_MUT, restored_version_id: EARLIER_V });
    expect(j.assistant_text).toBe(UNDONE);
    expect((j.blocks as Json[]).some((b) => b.type === 'analysis_result')).toBe(true);
  });

  it('CONTRAST (DL 21 Oct): a typed core turn still offers stress_test; only a Run press withholds it', async () => {
    outputs = [[{ type: 'message', text: 'Capacity is the one factor here.' }]];
    const r = await post({ turn_id: randomUUID(), message: 'What if Capacity were lower than we think?', source: 'composer' });
    expect(r.statusCode, r.body).toBe(200);
    const offered = (calls[0]!.tools as Json[]).map((t) => t.name);
    expect(offered, 'the person can ask to stress their assumptions').toContain('stress_test');
    expect(offered).toContain('run_analysis');
  });

  it('⭐ RED→GREEN (Codex R1): ONE restore = ONE Run. The same Undo\'s Run re-pressed with a fresh turn id recovers that Run; no second engine call', async () => {
    Object.assign(world, { graph: GRAPH_AT_2, hash: HASH_2 });
    head = { status: 'ok', value: versionRow() };
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run after Undo', effects_timing: null } }], [{ type: 'message', text: UNDONE }]];
    expect((await runPress()).statusCode).toBe(200);
    expect(runTurns).toBe(1);
    calls = [];
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run after Undo', effects_timing: null } }], [{ type: 'message', text: UNDONE }]];
    const again = await runPress();
    expect(again.statusCode, again.body).toBe(200);
    expect(runTurns, 'one restore, re-pressed with another request id: still ONE engine call').toBe(1);
    expect(outputOf('run_call'), 'the re-press is answered from the restore\'s own Run').toMatchObject({ status: 'ok', ran: true, data: { run_id: 'fixture-read-run' } });
    expect((again.json() as Json).assistant_text).toBe(UNDONE);
  });

  it('⭐ RED→GREEN (Codex R2, kept verbatim in substance): a head that cannot be read is NO Run, never a fresh operation', async () => {
    Object.assign(world, { graph: GRAPH_AT_2, hash: HASH_2 });
    head = { status: 'ok', value: versionRow() };
    const script = () => [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run after Undo', effects_timing: null } }], [{ type: 'message', text: UNDONE }]];
    outputs = script();
    expect((await runPress()).statusCode).toBe(200);
    expect(runTurns).toBe(1);
    // The same restore is still saved; only its metadata lookup is temporarily unavailable.
    head = { status: 'error', error: { code: 'store_error', recoverable: false, message: 'temporary metadata read failure' } };
    calls = []; outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run after Undo', effects_timing: null } }],
      [{ type: 'message', text: 'The analysis could not be run just now; nothing changed.' }]];
    const again = await runPress();
    expect(again.statusCode, again.body).toBe(200);
    expect(runTurns, 'the already completed Undo must not spend another engine Run when its head cannot be classified').toBe(1);
    expect(outputOf('run_call'), 'said truthfully: the existing unavailable outcome').toMatchObject({ status: 'unavailable', reason: 'run_failed' });
    expect((again.json() as Json).assistant_text).toBe('The analysis could not be run just now; nothing changed.');
  });

  it('CONTRAST: no version store (model management disabled) is a KNOWN head with no restore: the press runs once', async () => {
    Object.assign(world, { graph: GRAPH_AT_2, hash: HASH_2 });
    head = { status: 'disabled' };
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run it', effects_timing: null } }], [{ type: 'message', text: COACHED }]];
    expect((await runPress()).statusCode).toBe(200);
    expect(runTurns).toBe(1);
    expect(outputOf('run_call')).toMatchObject({ status: 'ok', ran: true });
  });

  it('CONTRAST (Codex R2): a second restore of the same graph is its own operation and gets its own Run', async () => {
    Object.assign(world, { graph: GRAPH_AT_2, hash: HASH_2 });
    head = { status: 'ok', value: versionRow() };
    const script = () => [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run after Undo', effects_timing: null } }], [{ type: 'message', text: UNDONE }]];
    outputs = script(); await runPress();
    head = { status: 'ok', value: versionRow({ mutation_id: 'e5f6a7b8-0000-4000-8000-0000000000d5' }) };
    outputs = script(); await runPress();
    expect(runTurns, 'deduplication is by restore operation, never by graph').toBe(2);
  });

  it('CONTRAST: an ordinary head (an edit, not a restore) keeps a fresh Run per press', async () => {
    Object.assign(world, { graph: GRAPH_AT_2, hash: HASH_2 });
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run it', effects_timing: null } }], [{ type: 'message', text: COACHED }]];
    await runPress();
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run it', effects_timing: null } }], [{ type: 'message', text: COACHED }]];
    await runPress();
    expect(runTurns, 'two deliberate Run presses on an edited model: two Runs').toBe(2);
  });

  it('⭐ narration retry: a resend of the press whose narration failed repeats no write, no Run and no model call', async () => {
    const card = await prepared();
    const turnId = randomUUID();
    outputs = ['fail', 'fail', 'fail'];
    const first = await press(card, turnId);
    expect(probe.applied).toBe(1);
    expect(runTurns).toBe(1);
    const before = calls.length;
    const again = await press(card, turnId);
    expect([200, 409], again.body).toContain(again.statusCode);
    expect(probe.applied, 'no second write').toBe(1);
    expect(runTurns, 'no second Run').toBe(1);
    expect(calls.length, 'no model call on the resend').toBe(before);
    expect(first.statusCode).not.toBe(500);
  });

  it('⭐ narration retry after an Undo\'s Run: the resend recovers the SAME Run and runs nothing again', async () => {
    Object.assign(world, { graph: GRAPH_AT_2, hash: HASH_2 });
    head = { status: 'ok', value: versionRow() };
    const turnId = randomUUID();
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'The user pressed Run.', effects_timing: null } }], 'fail', 'fail', 'fail'];
    await runPress(turnId);
    expect(runTurns).toBe(1);
    const before = calls.length;
    const again = await runPress(turnId);
    expect([200, 409], again.body).toContain(again.statusCode);
    expect(runTurns, 'no second Run').toBe(1);
    expect(calls.length, 'no model call on the resend').toBe(before);
  });

  it('⭐ THE CORE LOOP (PL 15:40 contract): press → save → ONE automatic Run → Undo → the canvas\'s ONE automatic Run on the RESTORED revision → the same SDK run coaches on it, holding the restored figure', async () => {
    // Press → save → the automatic Run on the saved model (Capacity 4 → 2).
    const card = await prepared();
    outputs = [[{ type: 'message', text: COACHED }]];
    const saved = await press(card);
    expect(saved.statusCode, saved.body).toBe(200);
    expect(probe.applied, 'ONE save').toBe(1);
    expect(runTurns, 'ONE automatic Run after the save').toBe(1);
    expect([...runFacts.values()].map((f: any) => f.result.graph_hash_at_run), 'it ran on the saved model').toEqual([HASH_2]);
    expect((saved.json() as Json).assistant_text).toBe(COACHED);
    // Undo: the canvas restores the earlier version (ONE restore: the model is back at 4), then presses Run automatically.
    Object.assign(world, { graph: GRAPH_AT_4, hash: HASH_4, ranOnSaved: false });
    head = { status: 'ok', value: versionRow({ graph: GRAPH_AT_4 }) };
    calls = [];
    const RESTORED = 'After the Undo, Capacity is back at 4, so in this model the comparison returns to where it was.';
    outputs = [[{ type: 'function_call', name: 'run_analysis', call_id: 'run_call', args: { reason: 'Run after Undo', effects_timing: null } }], [{ type: 'message', text: RESTORED }]];
    const undone = await runPress();
    expect(undone.statusCode, undone.body).toBe(200);
    expect(runTurns, 'ONE more Run for the ONE restore').toBe(2);
    expect([...runFacts.values()].map((f: any) => f.result.graph_hash_at_run), 'the second Run analysed the RESTORED revision').toEqual([HASH_2, HASH_4]);
    const ran = outputOf('run_call');
    expect(ran?.status, JSON.stringify(ran)).toBe('ok');
    expect(ran?.data?.run_comparison?.restore_between_runs, 'it knows a restore came between the Runs').toMatchObject({ version_id: RESTORE_V, restored_version_id: EARLIER_V, label: 'Undo: Edit Capacity' });
    // The coaching call holds the restored figure, by its factor's identity, on the restored revision.
    const seen = JSON.stringify(calls[calls.length - 1]);
    expect(seen, 'the restored revision').toContain(`_revision\\":\\"${HASH_4}`);
    expect(seen, 'Capacity at its restored figure').toContain('\\"id\\":\\"f\\",\\"label\\":\\"Capacity\\",\\"kind\\":\\"factor\\",\\"value\\":4');
    expect(calls.length, 'the call that runs it and the call that coaches on it; no interpreting call').toBe(2);
    expect(interpreterCalls()).toBe(0);
    expect((undone.json() as Json).assistant_text, 'the AI\'s own coaching on that same Run').toBe(RESTORED);
    expect(probe.applied, 'the Undo wrote nothing through the change door').toBe(1);
  });
});
