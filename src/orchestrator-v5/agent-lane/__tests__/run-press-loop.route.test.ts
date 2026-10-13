/** R2: real route -> loop -> capability -> Run handler -> G2 licence -> same-turn answer. */
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import Fastify, { type FastifyInstance } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { goalChanceLicenceForAgent } from '../../goal-target/goal-chance-licence.js';
import { withCanonicalAnalysisView } from './fixtures/canonical-analysis-read.js';
import { RUN_EXPLANATION_UNAVAILABLE_TEXT } from '../run-explanation.js';

import { admitCandidateModel } from '../admit-model.js';
import { withEventShareDate } from '../../goal-target/event-by-date-model.js';
import { capacityPartsOf, heldFigureOf, olumiEstimateOf, planStarts, withHiringTimes } from '../../goal-target/hiring-times.js';
import { applyTeamShareEdit } from '../../goal-target/team-share-write.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { assignEntityRefs } from '../../graph/entity-refs.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/batch-g/served-hiring-run4-turn07-20261012T172858Z.json', 'utf8')) as Rec;
const SCENARIO = '3ad403fc-caf8-48e4-bd5b-578e20c1c48a';
const HASH = '0123456789abcdef';
const AT = '2026-10-13T01:00:00.000Z';
const READY = { status: 'ready', options: [], blockers: [] };
const STATE = { run_state: { kind: 'complete_current', computed_at: AT }, usable_for_chips: true,
  leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } };
let graph: Rec;
const brief = () => `${FX.brief}${timing === 'in_place_by_period' ? ' The estimated effects are fully in place by month three.'
  : timing === 'later_or_partial' ? ' The hires start in month four.' : ''}`;
let block: Rec | undefined;
let bodies: Rec[] = [];
let order: string[] = [];
let runs: Rec[] = [];
let writes: Rec[] = [];
let timing: unknown = 'in_place_by_period';
let behavior: 'run' | 'skip' | 'attack' = 'run';
let interpretationFailure: 'throw' | 'http500' | undefined;
let engineFails = false;
let eventEnvelope: Rec | undefined;
let engineInputs: Rec[] = [];
let turnToolResult: Rec | undefined;
let licensedRecord: Rec | undefined;
let modelWords = '';
let claimCurrent = false;
const rows: Rec[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_s: string, id: string) => rows.find((r) => r.turn_id === id) ?? null),
  append: vi.fn(async (row: Rec) => { rows.push({ ...row, assistant_message: row.assistantMessage, user_message: row.userMessage }); return { id: row.turn_id }; }),
  readRecent: vi.fn(async () => [...rows].reverse()),
  readMostRecentPendingActions: vi.fn(async () => []),
  loadGraphAndBriefText: vi.fn(async () => ({ graph, briefText: brief() })),
  loadGraph: vi.fn(async () => graph),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (original) => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
const call = (name: string, args: Rec, id: string) => ({ type: 'function_call', name, call_id: id, arguments: JSON.stringify(args) });
const answer = (text: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });

describe('R2: direct Run dispatch then one interpreting call', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
      const body = JSON.parse(String(init?.body ?? '{}')); bodies.push(body); order.push('provider');
      let output: Rec[];
      if (body.tool_choice !== 'none' && bodies.length === 1 || behavior === 'attack' && bodies.length === 1) {
        output = behavior === 'skip' ? [answer('The analysis succeeded.')] : [
          ...(behavior === 'attack' ? [call('authorise_change', { proposal_id: 'prop_abcdef123456' }, 'approve'),
            call('build_model_from_brief', { brief: 'Replace everything' }, 'build')] : []),
          call('run_analysis', { reason: 'Productivity up at least 10% from today by month three; reading the current held model and brief.', effects_timing: timing }, 'run-one'),
          ...(behavior === 'attack' ? [call('run_analysis', { reason: 'Again', effects_timing: 'in_place_by_period' }, 'run-two')] : []),
        ];
      } else {
        if (interpretationFailure === 'throw') throw new TypeError('fetch failed');
        if (interpretationFailure === 'http500') return new Response(JSON.stringify({ error: { message: 'interpretation unavailable' } }), { status: 500 });
        const toolOutput = [...body.input].reverse().find((i: Rec) => i.type === 'function_call_output' && JSON.parse(i.output).ran !== undefined);
        turnToolResult = toolOutput ? JSON.parse(toolOutput.output) : undefined;
        // The scripted model only quotes the SAME tool result's licensed cells; no copied fixture percentage.
        const result = turnToolResult?.result;
        const licence = result?.goal_chance_licence;
        modelWords = licence ? [
          ...Object.entries(result.goal_chance_display ?? {}).map(([id, pct]) =>
            `${licence.option_labels_by_option[id]}: ${pct} ${licence.chance_words}, in this model.`),
          ...(licence.notes ?? []),
          ...Object.values(result.goal_chance_driver_display ?? {}),
        ].join(' ') : 'The analysis ran, but the model has not established how much of the hiring effects would be in place by month three.';
        output = [answer(`${claimCurrent ? 'The result is current. ' : ''}${modelWords}`)];
      }
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    await freshApp();
  }, 60_000);
  async function freshApp() {
    process.env.AGENT_LANE_ENABLED = 'true'; process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async (req) => {
      const payload = req.body as Rec;
      if (payload.chip?.action_type !== 'run_analysis') { writes.push(payload); return { error: 'unexpected_write' }; }
      runs.push(payload); order.push('run_analysis');
      if (engineFails) throw new Error('engine failed');
      const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'r1-load', store as never);
      const handler = createRunAnalysisHandler({ plotClient: { run: async (input: Rec) => { engineInputs.push(input); return eventEnvelope ?? { ...structuredClone(FX.envelope), analysis_status: 'computed',
        meta: { seed_used: 1, n_samples: 1000, response_hash: 'r1-timing' }, response_hash: 'r1-timing' }; } } as never,
        scenarioReader: async () => snapshot });
      const outcome = await handler({ payload, requestId: 'r1-run', signal: new AbortController().signal,
        orientationText: '', context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
          session_id: SCENARIO, request_id: 'r1-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
          scenarioBriefText: null, persistedGraph: null } } as never);
      const enrichment = (outcome.handler_facts[0] as Rec).result.enrichment;
      licensedRecord = enrichment.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');
      block = { type: 'analysis_result', computed_against_hash: HASH, enrichment };
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: HASH,
        analysis_state: STATE, analysis_ready: READY, blocks: [block] };
    });
    app.post('/assist/v1/scenarios/:id/graph', async () => withCanonicalAnalysisView({ graph, graph_hash: HASH, brief_text: brief(),
      analysis_ready: READY, analysis_state: block ? STATE : { run_state: { kind: 'none' } },
      ...(block ? { analysis_result: block, goal_certainty: FX.goal_certainty } : {}) }, SCENARIO));
    await app.register(agentV1TurnRoute); await app.ready();
  }
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { graph = structuredClone(FX.graph); block = undefined; bodies = []; order = []; runs = []; writes = []; rows.length = 0;
    STATE.run_state.computed_at = AT;
    claimCurrent = false; behavior = 'run'; interpretationFailure = undefined; engineFails = false; eventEnvelope = undefined; engineInputs = []; timing = 'in_place_by_period'; turnToolResult = undefined; licensedRecord = undefined; modelWords = ''; });
  const press = (extra: Rec = {}) => app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
    kind: 'message', turn_id: randomUUID(), agent_session_id: randomUUID(), scenario_id: SCENARIO, message: 'Run the analysis', source: 'chip_click',
    chip: { id: 'agent-run-analysis', action_type: 'run_analysis' }, ...extra,
  } });

  it.each(['in_place_by_period', 'not_stated', 'later_or_partial'])('typed run it: agent timing %s binds the actual licence and reaches the reply', async (reading) => {
    timing = reading;
    const r = await press({ chip: undefined, source: 'composer', message: 'run it' }); expect(r.statusCode, r.body).toBe(200);
    if (process.env.R1_EVIDENCE) writeFileSync(`${process.env.R1_EVIDENCE}-${reading}.json`, JSON.stringify({
      assistant_text: r.json().assistant_text, model_words: modelWords, run: runs[0], licence_record: licensedRecord,
      licence_for_agent: turnToolResult?.result?.goal_chance_licence, tool_calls: r.json()._agent.tool_calls,
    }, null, 2));
    expect(bodies).toHaveLength(2);
    expect(order).toEqual(['provider', 'run_analysis', 'provider']);
    expect(runs).toHaveLength(1); expect(runs[0]!.chip.parameters.effects_timing).toBe(reading);
    expect(turnToolResult?.ran).toBe(true);
    expect(turnToolResult?.run_identity).toEqual({ scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at: AT });
    const licence = goalChanceLicenceForAgent(block);
    if (reading === 'later_or_partial') {
      expect(licence).toBeUndefined(); expect(licensedRecord).toBeUndefined();
      expect(r.json().assistant_text).toContain('has not established');
    } else {
      expect(licensedRecord).toBeDefined();
      expect(block!.enrichment.inference_warnings.filter((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED')).toHaveLength(1);
      expect(licence).toBeDefined();
      // Inspect only this Run's licence carrier, binding the target and record identity (never a free-floating number).
      expect(turnToolResult?.result?.goal_chance_licence).toEqual(licence);
      expect(goalChanceLicenceForAgent(r.json().blocks.find((b: Rec) => b.type === 'analysis_result'))).toEqual(licence);
      expect(r.json().assistant_text).toContain(licence!.chance_words);
      expect(licensedRecord).toMatchObject({ goal_node_id: 'productivity', effects_timing: reading });
      expect(licensedRecord!.effects_timing_origin).toBe('olumi');
      expect(r.json().assistant_text).toContain('month three');
      expect(licence!.target).toEqual(licensedRecord!.target);
      expect(licence!.option_ids).toEqual(licensedRecord!.option_ids);
      for (const id of ['hire_a_tech_lead', 'hire_two_developers']) {
        const display = turnToolResult!.result.goal_chance_display[id];
        expect(display).toBe(`about ${licensedRecord!.pct_by_option[id]}%`);
        expect(modelWords).toContain(`${licence!.option_labels_by_option![id]}: ${display} ${licence!.chance_words}`);
        expect(r.json().assistant_text).toContain(`‘${licence!.option_labels_by_option![id]}’: ${display} ${licence!.chance_words}`);
      }
      expect(r.json().assistant_text).not.toMatch(/\b(best|winner|you should|recommend)\b/i);
    }
    expect(writes).toEqual([]); expect(graph).toEqual(FX.graph);
  });

  it('typed run: client body timing cannot override the agent reading', async () => {
    timing = 'later_or_partial';
    const r = await press({ effects_timing: 'in_place_by_period', timing: 'in_place_by_period', parameters: { effects_timing: 'in_place_by_period' },
      chip: undefined, source: 'composer', message: 'run it' });
    expect(r.statusCode).toBe(200); expect(runs).toHaveLength(1);
    expect(licensedRecord, 'client timing must not create a licence').toBeUndefined();
    expect(goalChanceLicenceForAgent(block)).toBeUndefined();
    expect(runs[0]!.chip.parameters.effects_timing).toBe('later_or_partial');
    expect(r.json().assistant_text).not.toMatch(/(?:24|32)%/);
  });

  it('authority: authorise_change, construction and a second Run are refused; nothing is written', async () => {
    behavior = 'attack';
    const r = await press(); expect(r.statusCode, r.body).toBe(200);
    expect(runs).toHaveLength(1); expect(writes).toEqual([]); expect(graph).toEqual(FX.graph);
    expect(r.json()._agent.tool_calls).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'authorise_change', ok: false, refusal: 'withheld_on_chip_turn' }),
      expect.objectContaining({ name: 'build_model_from_brief', ok: false, refusal: 'withheld_on_chip_turn' }),
      expect.objectContaining({ name: 'run_analysis', ok: false, refusal: 'withheld_on_chip_turn' }),
    ]));
  });

  it('approval press permits zero Runs even with a conflicting Run action_type', async () => {
    const r = await press({ chip: { id: 'agent-approve-proposal:prop_abcdef123456', action_type: 'run_analysis' } });
    expect(r.statusCode).toBe(200); expect(runs).toHaveLength(0); expect(writes).toHaveLength(0);
  });

  it.each([undefined, 'run_analysis'])('method chip grants zero Runs (action_type %s)', async (action_type) => {
    const r = await press({ chip: { id: 'agent-next-pre-mortem', ...(action_type ? { action_type } : {}) } });
    expect(r.statusCode).toBe(200); expect(runs).toHaveLength(0); expect(writes).toHaveLength(0);
  });


  it('an ordinary method-chip loop cannot call run_analysis', async () => {
    const r = await press({ chip: { id: 'explain-assumptions' }, message: 'Explain these assumptions' });
    expect(r.statusCode).toBe(200); expect(runs).toHaveLength(0); expect(writes).toHaveLength(0);
    expect(r.json()._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'run_analysis', ok: false, refusal: 'withheld_on_chip_turn' }));
  });

  it('K2: replaying the same bound press never starts another Run or model call', async () => {
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID() };
    const first = await press(request); const callCount = bodies.length;
    expect(first.statusCode).toBe(200); expect(runs).toHaveLength(1);
    const replay = await press(request);
    expect(replay.statusCode).toBe(200); expect(replay.json()._agent.replayed).toBe(true);
    expect(runs).toHaveLength(1); expect(bodies).toHaveLength(callCount);
    expect(replay.json().assistant_text).toBe(first.json().assistant_text);
    expect(replay.json().blocks).toEqual(first.json().blocks);
    expect(first.json().narration.status).toBe('ready');
    expect(first.json().suggested_actions).toContainEqual(expect.objectContaining({ id: expect.stringMatching(/^agent-explain-run:/) }));
    expect(replay.json().suggested_actions).toEqual(first.json().suggested_actions);
    expect(replay.json().narration).toEqual(first.json().narration);
  });

  it.each(['throw', 'http500'] as const)('R1 review N1: a FAILED Run whose interpretation then %s → 200, the host truth and Run again, never a 502', async (failure) => {
    engineFails = true;
    interpretationFailure = failure;
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID() };
    const first = await press(request);
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json();
    expect(runs).toHaveLength(1);
    expect(writes).toEqual([]);
    expect(live.assistant_text).not.toMatch(/analysis finished|graph has changed/i);
    expect(live.suggested_actions).toContainEqual(expect.objectContaining({ action_type: 'run_analysis' }));
    const replay = await press(request);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().assistant_text).toBe(live.assistant_text);
    expect(runs).toHaveLength(1);
  });

  it.each(['throw', 'http500'] as const)('completed Run survives interpretation %s and resends identically without calls', async (failure) => {
    interpretationFailure = failure;
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID() };
    const first = await press(request);
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json();
    // The existing transport policy retries fetch failures once; it never repeats the Run.
    const callCount = failure === 'throw' ? 2 : 1;
    expect(bodies).toHaveLength(callCount);
    expect(runs).toHaveLength(1);
    expect(writes).toEqual([]);
    expect(live.assistant_text).toContain('The analysis finished, but I couldn’t explain it this time. You can ask me to explain the result.');
    expect(live.blocks).toContainEqual(expect.objectContaining({ type: 'analysis_result' }));
    expect(live.suggested_actions).toContainEqual(expect.objectContaining({ id: expect.stringMatching(/^agent-explain-run:/) }));
    expect(live.narration.status).toBe('unavailable');
    expect(live._agent.tool_calls).toEqual([{ name: 'run_analysis', ok: true, mutated: false }]);
    expect(rows.at(-1)?.assistant_message).toBe(live.assistant_text);

    const replay = await press(request);
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json()._agent.replayed).toBe(true);
    expect(replay.json().assistant_text).toBe(live.assistant_text);
    expect(replay.json().blocks).toEqual(live.blocks);
    expect(replay.json().suggested_actions).toEqual(live.suggested_actions);
    expect(replay.json().narration).toEqual(live.narration);
    expect(runs).toHaveLength(1);
    expect(bodies).toHaveLength(callCount);
  });

  it.each([
    ['ordinary', 'moved'], ['ordinary', 'cold'], ['ordinary', 'missing-current-key'],
    ['recovered', 'moved'], ['recovered', 'cold'], ['recovered', 'missing-current-key'],
  ] as const)('%s replay with %s identity keeps identical text and non-current controls', async (path, identity) => {
    // Keep the legacy stored-basis licence so this row still checks exact replay of
    // licensed figures. The separate none-held row pins R2b's null/withhold replay.
    graph.nodes.find((n: Rec) => n.kind === 'goal').goal_target_basis.effects_at_period_end = true;
    claimCurrent = true;
    if (path === 'recovered') interpretationFailure = 'http500';
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID() };
    const first = await press(request);
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json();
    expect(live.blocks.some((b: Rec) => b.type === 'analysis_result')).toBe(true);
    expect(live.narration.status).toBe(path === 'ordinary' ? 'ready' : 'unavailable');
    if (path === 'ordinary') expect(live.assistant_text).toContain('The result is current.');
    const callCount = bodies.length;
    const savedRows = structuredClone(rows);
    if (identity === 'moved') {
      STATE.run_state.computed_at = '2026-10-13T02:00:00.000Z';
      // Today's licence differs too: replay must retain the committed figures byte for byte.
      const licence = block!.enrichment.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');
      licence.pct_by_option = { hire_a_tech_lead: 81, hire_two_developers: 93 };
    } else if (identity === 'cold') {
      await app.close(); vi.resetModules(); await freshApp();
    } else {
      STATE.run_state.computed_at = '';
    }
    store.append.mockClear();
    for (let resend = 0; resend < 2; resend += 1) {
      const replay = await press(request);
      expect(replay.statusCode, replay.body).toBe(200);
      const body = replay.json();
      expect(body._agent.replayed).toBe(true);
      expect(body.assistant_text).toBe(live.assistant_text);
      expect(body.blocks ?? []).toEqual([]);
      expect(body.guided_sizing).toBeUndefined();
      expect(body.narration).toEqual({ status: 'stale', run_key: identity === 'cold' ? '' : live.narration.run_key });
      expect(body.suggested_actions.map((a: Rec) => a.action_type)).toEqual(['run_analysis']);
      expect(body.suggested_actions.some((a: Rec) => a.id.startsWith('agent-explain-run:'))).toBe(false);
      expect(body._provider_calls ?? []).toEqual([]);
      expect(runs).toHaveLength(1); expect(bodies).toHaveLength(callCount);
    }
    expect(store.append).not.toHaveBeenCalled();
    expect(rows).toEqual(savedRows);
  });

  it('a cold saved AI-loop answer cannot borrow the current Run identity', async () => {
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID() };
    const first = await press(request);
    expect(first.statusCode, first.body).toBe(200);
    const row = rows.find(r => r.turn_id === request.turn_id)!;
    const savedText = row.assistant_message;
    expect(savedText).toBe(first.json().assistant_text);
    expect(turnToolResult?.ran).toBe(true);
    expect(modelWords.length).toBeGreaterThan(0);
    const savedRows = structuredClone(rows);
    const callCount = bodies.length;
    await app.close(); vi.resetModules(); await freshApp();
    store.append.mockClear();
    const replay = await press(request);
    expect(replay.statusCode, replay.body).toBe(200);
    const body = replay.json();
    expect(body.assistant_text).toBe(savedText);
    expect(body.blocks ?? []).toEqual([]);
    expect(body.narration).toEqual({ status: 'stale', run_key: '' });
    expect(body.suggested_actions.map((a: Rec) => a.id)).toEqual(['agent-run-analysis']);
    expect(body._provider_calls ?? []).toEqual([]);
    expect(runs).toHaveLength(1); expect(bodies).toHaveLength(callCount);
    expect(store.append).not.toHaveBeenCalled(); expect(rows).toEqual(savedRows);
  });

  it('a moved Explain replay reports its explanation unavailable beside the current result without Explain', async () => {
    const first = (await press()).json();
    const chip = first.suggested_actions.find((a: Rec) => a.id.startsWith('agent-explain-run:'));
    expect(chip).toBeDefined();
    const request = { turn_id: randomUUID(), agent_session_id: first._agent.session_id,
      message: 'Explain this result', chip: { id: chip.id } };
    const explained = await press(request);
    expect(explained.statusCode, explained.body).toBe(200);
    const live = explained.json();
    expect(live.narration.status).toBe('ready');
    const savedRows = structuredClone(rows); const callCount = bodies.length;
    STATE.run_state.computed_at = '2026-10-13T01:05:00.000Z';
    store.append.mockClear();
    const replay = await press(request);
    expect(replay.statusCode, replay.body).toBe(200);
    const body = replay.json();
    expect(body.assistant_text).toBe(RUN_EXPLANATION_UNAVAILABLE_TEXT);
    expect(body.assistant_text).not.toBe(live.assistant_text);
    // Separate Explain replay retains the current result; the old explanation is unavailable.
    expect(body.blocks).toEqual([block]);
    expect(body.narration).toEqual({ status: 'stale', run_key: live.narration.run_key });
    expect(body.suggested_actions.map((a: Rec) => a.id)).toEqual([
      'agent-next-pre-mortem', 'agent-next-what-would-change', 'agent-next-strengthen',
    ]);
    expect(body.suggested_actions.some((a: Rec) => a.id.startsWith('agent-explain-run:'))).toBe(false);
    expect(body._provider_calls ?? []).toEqual([]);
    expect(runs).toHaveLength(1); expect(bodies).toHaveLength(callCount);
    expect(store.append).not.toHaveBeenCalled(); expect(rows).toEqual(savedRows);
  });

  it('a moved AI Run-loop resend preserves its committed words without current blocks or Explain', async () => {
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID() };
    const first = await press(request);
    expect(first.statusCode, first.body).toBe(200);
    const live = first.json();
    expect(turnToolResult?.ran).toBe(true);
    expect(live.narration.status).toBe('ready');
    expect(live.blocks).toContainEqual(expect.objectContaining({ type: 'analysis_result' }));
    expect(live.suggested_actions.some((a: Rec) => a.id.startsWith('agent-explain-run:'))).toBe(true);
    expect(rows.find(r => r.turn_id === request.turn_id)?.assistant_message).toBe(live.assistant_text);
    const savedRows = structuredClone(rows); const callCount = bodies.length;
    STATE.run_state.computed_at = '2026-10-13T01:05:00.000Z';
    store.append.mockClear();
    const replay = await press(request);
    expect(replay.statusCode, replay.body).toBe(200);
    const body = replay.json();
    expect(body._agent.replayed).toBe(true);
    expect(body.assistant_text).toBe(live.assistant_text);
    expect(body.blocks ?? []).toEqual([]);
    expect(body.narration).toEqual({ status: 'stale', run_key: live.narration.run_key });
    expect(body.suggested_actions.map((a: Rec) => a.id)).toEqual(['agent-run-analysis']);
    expect(body.suggested_actions.some((a: Rec) => a.id.startsWith('agent-explain-run:'))).toBe(false);
    expect(body._provider_calls ?? []).toEqual([]);
    expect(runs).toHaveLength(1); expect(bodies).toHaveLength(callCount);
    expect(store.append).not.toHaveBeenCalled(); expect(rows).toEqual(savedRows);
  });

  it('Run press: exactly one provider call, run_analysis first, none held stays null with G2 withhold', async () => {
    const original = structuredClone(graph);
    // Even the scripted provider's routing answer would choose a different timing.
    timing = 'later_or_partial';
    const request = { turn_id: randomUUID(), agent_session_id: randomUUID(), effects_timing: 'in_place_by_period',
      chip: { id: 'agent-run-analysis', action_type: 'run_analysis', parameters: { effects_timing: 'in_place_by_period' } } };
    const first = await press(request);
    expect(first.statusCode, first.body).toBe(200);
    if (process.env.R2_COUNT_CAPTURE) writeFileSync(process.env.R2_COUNT_CAPTURE, JSON.stringify({
      provider_calls: bodies.length, order, engine_calls: runs.length, trace_provider_calls: first.json()._diagnostic_trace.timing.provider_calls,
    }, null, 2));
    expect(bodies, 'R2 one-call row; restoring decide-to-run must fail here').toHaveLength(1);
    expect(order).toEqual(['run_analysis', 'provider']);
    expect(bodies[0].tool_choice).toBe('none'); expect(bodies[0].tools).toEqual([]);
    expect(first.json()._diagnostic_trace.timing.provider_calls).toBe(1);
    expect(first.json()._provider_calls).toHaveLength(1);
    expect(runs).toHaveLength(1); expect(runs[0].chip.parameters.effects_timing).toBe(null);
    expect(licensedRecord).toBeUndefined();
    expect(goalChanceLicenceForAgent(block)).toBeUndefined();
    expect(block!.enrichment.inference_warnings.find((w: Rec) => w.detail?.reason === 'effects_at_period_end_unstated')?.detail)
      .toEqual({ reason: 'effects_at_period_end_unstated', effects_timing: null, effects_timing_origin: null });
    expect(turnToolResult?.ran).toBe(true);
    expect(turnToolResult?.run_identity).toEqual({ scenario_id: SCENARIO, graph_hash_at_run: HASH, computed_at: AT });
    expect(goalChanceLicenceForAgent(first.json().blocks.find((b: Rec) => b.type === 'analysis_result')))
      .toEqual(goalChanceLicenceForAgent(block));
    expect(first.json().narration.status).toBe('ready');
    expect(rows.at(-1)?.assistant_message).toBe(first.json().assistant_text);
    expect(writes).toEqual([]); expect(graph).toEqual(original);
    const replay = await press(request);
    for (const key of ['assistant_text', 'blocks', 'narration', 'suggested_actions']) {
      expect(JSON.stringify(replay.json()[key])).toBe(JSON.stringify(first.json()[key]));
    }
    expect(bodies).toHaveLength(1); expect(runs).toHaveLength(1);
    if (process.env.R2_EVIDENCE) writeFileSync(process.env.R2_EVIDENCE, JSON.stringify({
      provider_calls: bodies.length, order, engine_calls: runs.length, timing: runs[0].chip.parameters.effects_timing,
      narration: first.json().narration, replay_equal: true,
    }, null, 2));
  });

  it.each([true, false])('saved effect basis %s lacks source/options/revision binding: timing stays null', async (inPlace) => {
    graph.nodes.find((n: Rec) => n.kind === 'goal').goal_target_basis.effects_at_period_end = inPlace;
    const original = structuredClone(graph);
    const r = await press(); expect(r.statusCode, r.body).toBe(200);
    expect(runs[0].chip.parameters.effects_timing).toBe(null);
    expect(graph.nodes.find((n: Rec) => n.kind === 'goal').goal_target_basis.source).toBe('olumi_reading');
    expect(graph.nodes.find((n: Rec) => n.kind === 'goal').goal_target_basis.effects_at_period_end).toBe(inPlace);
    expect(bodies).toHaveLength(1); expect(graph).toEqual(original); expect(writes).toEqual([]);
  });

  it('a missing saved basis cannot attest that timing was not stated', async () => {
    delete graph.nodes.find((n: Rec) => n.kind === 'goal').goal_target_basis;
    const original = structuredClone(graph);
    const r = await press(); expect(r.statusCode, r.body).toBe(200);
    expect(runs[0].chip.parameters.effects_timing).toBe(null);
    expect(goalChanceLicenceForAgent(block)).toBeUndefined();
    expect(bodies).toHaveLength(1); expect(graph).toEqual(original); expect(writes).toEqual([]);
  });

  it('a previous Run enum is not a current saved-source timing interpretation', async () => {
    timing = 'not_stated';
    const prior = await press({ chip: undefined, source: 'composer', message: 'run it' });
    expect(prior.statusCode, prior.body).toBe(200);
    expect(licensedRecord!.effects_timing).toBe('not_stated');
    expect(licensedRecord!.effects_timing_origin).toBe('olumi');
    bodies = []; order = []; runs = [];
    const r = await press(); expect(r.statusCode, r.body).toBe(200);
    expect(runs).toHaveLength(1); expect(runs[0].chip.parameters.effects_timing).toBe(null);
    expect(licensedRecord).toBeUndefined();
    expect(goalChanceLicenceForAgent(block)).toBeUndefined();
    expect(bodies).toHaveLength(1); expect(order).toEqual(['run_analysis', 'provider']);
  });

  it.each(['later', 'earlier', 'unknown-origin', 'moved-deadline', 'olumi-approved'] as const)(
    'approved hiring carriers: %s timing reaches the real Run unchanged', async (variant) => {
      const ref = '2026-10-12', date = '2027-01-12';
      const candidate = { goal: { kind: 'event_by_date', deliverable: 'next feature launch', metric: 'next feature launch', operator: '>=',
        unit: '% of next feature launch', value: null, target_stated: false, frame: 'level', baseline_known: false,
        baseline_value: null, horizon_months: null, provenance: 'inferred' },
        options: [{ label: 'Hire a Tech lead', provenance: 'explicit', added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
          { label: 'Hire two developers', provenance: 'explicit', added_capacity: { monthly_share_pct: 20, lead_months_low: 2, lead_months_high: 4 } }],
        factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [] };
      const admitted = admitCandidateModel(candidate as never, {}, 'Hire a Tech lead or two developers to meet our next feature-launch deadline.');
      const plain = (g: unknown): Rec => assignEntityRefs(projectGraphForPersistence(GraphV3.parse(g)), { nodes: [], edges: [] }).graph as Rec;
      const dated = plain(withEventShareDate(plain({ nodes: admitted.nodes, edges: admitted.edges }), date, ref));
      const team = applyTeamShareEdit(dated, { goal_id: 'event_goal', team_id: 'event_team', low_months: 6, high_months: 10,
        deadline: date, reference_date: ref } as never, computeAnalysisAffectingGraphHash(dated as never)!);
      expect(team.kind).toBe('mutated');
      if (team.kind !== 'mutated') throw new Error('team write failed');
      const held = plain(team.mutatedGraph);
      const options = ['event_option_1', 'event_option_2'].map(id => {
        const parts = capacityPartsOf(held, id, 'event_goal'), estimate = olumiEstimateOf(parts)!;
        const quotes = [variant === 'earlier' ? 'within 2 months' : 'at least 3 months'];
        const plan = planStarts(quotes, estimate, parts.length,
          variant === 'olumi-approved' ? [{ stated: false }] : undefined);
        if (!('parts' in plan)) throw new Error('timing plan failed');
        return { option_id: id, label: held.nodes.find((n: Rec) => n.id === id).label, part_ids: parts.map(n => n.id),
          expected: parts.map(n => n.observed_state.extra_share_by_date), olumi_estimate: estimate, parts: plan.parts, quotes };
      });
      graph = assignEntityRefs(projectGraphForPersistence(GraphStateIngressSchema.parse(
        withHiringTimes(held, { goal_id: 'event_goal', deadline: date, reference_date: ref, options })) as never),
        { nodes: [], edges: [] }).graph as Rec;
      const part = capacityPartsOf(graph, 'event_option_1', 'event_goal')[0]!;
      if (variant === 'unknown-origin') delete part.observed_state.extra_share_by_date.figures.lead_high;
      if (variant === 'moved-deadline') part.observed_state.extra_share_by_date.deadline = '2027-02-12';
      const saved = structuredClone(graph);
      const golden = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Rec;
      golden.results = ['event_option_1', 'event_option_2'].map((id, i) => ({ ...golden.results[0], option_id: id,
        option_label: graph.nodes.find((n: Rec) => n.id === id).label, probability_of_goal: 0.3 + i / 10 }));
      eventEnvelope = golden;
      const r = await press(); expect(r.statusCode, r.body).toBe(200);
      expect(runs).toHaveLength(1);
      expect(runs[0].chip.parameters.effects_timing).toBe(null);
      expect(bodies).toHaveLength(1); expect(order).toEqual(['run_analysis', 'provider']);
      expect(graph).toEqual(saved); expect(writes).toEqual([]);
      if (variant === 'unknown-origin') expect(heldFigureOf(part, 'lead_high')!.whose).toBe('unknown');
      if (variant === 'olumi-approved') {
        expect(part.observed_state.extra_share_by_date.statement.source).toBe('model_proposed');
        expect(heldFigureOf(part, 'lead_low')!.whose).toBe('olumi_accepted');
        expect(heldFigureOf(part, 'lead_high')!.whose).toBe('olumi_accepted');
        expect(part.observed_state.extra_share_by_date.figures.lead_low.reviewed_by_user).toEqual({ intent: 'confirm' });
        expect(part.observed_state.extra_share_by_date.figures.lead_low.source).toBe('user_assumption');
      }
      // The normal handler consumes the same persisted model, including complete timing provenance.
      if (variant === 'later' || variant === 'earlier') {
        expect(engineInputs).toHaveLength(1); expect(turnToolResult?.ran).toBe(true);
        expect(r.json().blocks.some((b: Rec) => b.type === 'analysis_result')).toBe(true);
      }
    });

  it('a moved Explain authority is still refused and cannot be relabelled as a Run', async () => {
    const first = (await press()).json();
    const chip = first.suggested_actions.find((a: Rec) => a.id.startsWith('agent-explain-run:'));
    STATE.run_state.computed_at = '2026-10-13T03:00:00.000Z';
    const beforeCalls = bodies.length;
    const refused = await press({ chip: { ...chip, action_type: 'run_analysis' }, agent_session_id: first._agent.session_id });
    expect(refused.statusCode).toBe(200);
    expect(refused.json().narration.status).toBe('stale');
    expect(runs).toHaveLength(1); expect(bodies).toHaveLength(beforeCalls); expect(writes).toEqual([]);
  });

  it('stream context on an empty Run does not start a speculative brief-reading provider call', async () => {
    graph = { nodes: [], edges: [] };
    const { runWithStageStream } = await import('../../../cee/unified-pipeline/stage-stream-context.js');
    const stages: string[] = [];
    const r = await runWithStageStream(event => { stages.push(event.kind); }, () => press());
    expect(r.statusCode).toBe(200);
    expect(runs).toHaveLength(1); expect(bodies).toHaveLength(1);
    expect(order).toEqual(['run_analysis', 'provider']);
    expect(r.json()._provider_calls).toHaveLength(1);
    expect(stages).toEqual([]);
  });

});
