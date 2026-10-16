import { unsizedLinkSentence, UNSIZED_PATH_LEADER_CAUSE_KEY } from '../unsized-path-cause.js';
/** Real Agent route with mocked transport: one reply, recorded figures, source, scope and durable replay. */
import { readFileSync } from 'node:fs';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { goalChanceScreenLinesForAgent, checkScreenLineClaims } from '../goal-chance-screen-lines.js';
import { SPREAD_NOTE_WITHOUT_DOWNSIDE } from '../../goal-target/goal-chance-licence.js';
import { type AnswerShape } from '../../routing/answer-shape.js';
import { whatChangesFaceLine } from '../../goal-target/goal-chance-range-agent.js';
import { type ReplyComposeInput, type ReplyComposition } from '../reply/compose-reply.js';
import { runExplanationChip, RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { runOmittedRisks, unsizedOlumiRiskLineFor, unsizedOlumiRiskOmissionWarning } from '../unsized-risk.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import capacity from '../../goal-target/__tests__/fixtures/capacity-247ae5b4-run.json';
import minimal from '../../../../tests/fixtures/plot/v2-run-golden-minimal.json';
import CAPTURED_COACHING from './fixtures/c3-4de96a0a-coaching-blocks.json';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { STATIC_MODEL_SCOPE_NOTE } from '../../goal-target/goal-chance-licence.js';

type Json = Record<string, any>;
const READ_B3 = (JSON.parse(readFileSync(new URL('./fixtures/waveB3-unseen2-7addf05-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
/** B5 T1b on 3fce64f: three point lines on the `each` licence, leader withheld (near tie); the gate deleted the chat's copy. */
const READ_T1B = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
let READ: Json = READ_B3;
const VIEW = {
  view: 'Before comparing, size how strongly running a fourth shop changes its monthly operating profit.',
  reasoning: 'That relationship remains unsized.',
  confirm_step: 'Tell me roughly how much monthly profit the fourth shop would add, and I can propose it.',
};
const SCENARIO = '7a5e4d3c-2b1a-4d0e-9f8a-7b6c5d4e3f2a';
const ALL_SCREEN = JSON.parse(readFileSync(new URL('./fixtures/waveB-screen-chance-lines-20261007.json', import.meta.url), 'utf8')) as { line: string; source: string }[];
const SCREEN = ALL_SCREEN.filter((s) => s.source.includes('/unseen-b3-2/')).map((s) => s.line);
let analysisResult: Json = READ.analysis_result;
let forwardedText = 'ok';
let extraRunBlocks: Json[] = [];
let composeInput: ReplyComposeInput | undefined;
let composition: ReplyComposition | undefined;
let lastTurnPayload: Json;
let runCompleted = false;
let nb1SavedBasis = false;
let nb1MovedBasis = false;
let canonicalReadOverride: ((view: ReturnType<typeof projectCanonicalAnalysisView>) => unknown) | undefined;
let warn: ReturnType<typeof vi.spyOn>;
vi.mock('../reply/compose-reply.js', async original => {
  const actual = await original<typeof import('../reply/compose-reply.js')>();
  return { ...actual, composeReplyShape: (input: ReplyComposeInput) => {
    composeInput = input;
    composition = actual.composeReplyShape(input);
    return composition;
  } };
});
let recentRows: Json[] = [];
let hashTurn: (message: string) => string;

const rows = new Map<string, Json>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, turnId: string) => rows.get(turnId) ?? null),
  append: vi.fn(async (w: Json) => {
    const prior = rows.get(w.turn_id);
    if (prior !== undefined) return prior.request_hash === w.request_hash ? { id: prior.id, replayedPriorTurn: true as const } : { id: prior.id, priorTurnConflict: true as const };
    const row = { ...w, assistant_message: w.assistantMessage, user_message: w.userMessage, id: `row-${rows.size + 1}` };
    rows.set(w.turn_id, row);
    return { id: row.id };
  }),
  readRecent: vi.fn(async () => recentRows),
  readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
  // NB1 exercises the real uncached CAS/readback condition; older rows keep their former no-card setup.
  readExistingScenario: vi.fn(async () => nb1SavedBasis ? { graph: READ.graph, revision: nb1MovedBasis ? 2 : 1 } : null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let callModelOutputs: Record<string, unknown>[][] = [];
type Body = { assistant_text: string; canonical_analysis_view?: ReturnType<typeof projectCanonicalAnalysisView>; blocks?: Json[]; _answer_shape?: AnswerShape; _agent: { tool_calls: { name: string; ok: boolean }[]; replayed?: boolean } };

describe('S4c through the route: the screen’s range line is in the Run narration', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const req = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      if ((req['tool_choice'] as { name?: unknown } | undefined)?.name === 'give_provisional_view') {
        return new Response(JSON.stringify({ output: [{ type: 'function_call', name: 'give_provisional_view', arguments: JSON.stringify(VIEW), call_id: 'forced' }] }), { status: 200 });
      }
      const output = callModelOutputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute, agentTurnRequestHash } = await import('../../../routes/agent-v1-turn.js');
    const { log } = await import('../../../utils/telemetry.js');
    warn = vi.spyOn(log, 'warn');
    hashTurn = message => agentTurnRequestHash(SCENARIO, null, message);
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => { runCompleted = true; return ({
      response_version: 2, assistant_text: forwardedText, suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [analysisResult, ...extraRunBlocks], analysis_ready: READ.analysis_ready, analysis_state: READ.analysis_state,
    }); });
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      // The harness authors the successful fact wrapper around this captured Run; production never invents one.
      const canonical_analysis_view = projectCanonicalAnalysisView({ graph: READ.graph,
        ...(nb1SavedBasis ? { revision: 1, derivation: { freshness: 'fresh' as const, reason: 'graph_hash_match' as const, selected_fact_index: 0,
          graph_hash_at_run: READ.graph_hash, current_graph_hash: READ.graph_hash, computed_at: READ.analysis_state.run_state.computed_at } } : {}),
        runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
          scenario_id: SCENARIO, run_id: analysisResult.run_id ?? 'fixture-screen-run', summary: analysisResult.summary,
          leading_option_id: analysisResult.leading_option_id, enrichment: analysisResult.enrichment,
          ...(analysisResult.input_snapshot === undefined ? {} : { input_snapshot: analysisResult.input_snapshot }),
          graph_hash_at_run: READ.graph_hash, computed_at: READ.analysis_state.run_state.computed_at,
        } } as never,
        analysisState: READ.analysis_state as never, analysisReady: READ.analysis_ready,
        currentResult: analysisResult as never });
      return { graph: READ.graph, graph_hash: READ.graph_hash, analysis_result: analysisResult, analysis_state: READ.analysis_state,
        analysis_ready: READ.analysis_ready, canonical_analysis_view: canonicalReadOverride === undefined
          ? canonical_analysis_view : canonicalReadOverride(canonical_analysis_view) };
    });
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { warn.mockRestore(); await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { extraRunBlocks = []; nb1SavedBasis = false; nb1MovedBasis = false; runCompleted = false; canonicalReadOverride = undefined; warn.mockClear(); rows.clear(); recentRows = []; forwardedText = 'ok'; READ = READ_B3; analysisResult = JSON.parse(JSON.stringify(READ.analysis_result)); composeInput = undefined; composition = undefined; });
  const useT1b = (): void => { READ = READ_T1B; analysisResult = JSON.parse(JSON.stringify(READ.analysis_result)); };

  let seq = 0;
  // A string third argument is the Agent session id (GP rows); an object is extra payload (A rows).
  const turn = async (outputs: Record<string, unknown>[][], message: string, extra: Json | string = {}): Promise<Body> => {
    seq += 1;
    callModelOutputs = outputs;
    const more: Json = typeof extra === 'string' ? { agent_session_id: extra } : extra;
    lastTurnPayload = { kind: 'message', scenario_id: SCENARIO, message,
      turn_id: `9c3d4e5f-6a7b-4c8d-9e0f-${String(seq).padStart(12, '0')}`, ...more };
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: lastTurnPayload });
    expect(r.statusCode, r.body).toBe(200);
    const b = r.json() as Body;
    expect(b._agent.replayed).not.toBe(true);
    return b;
  };
  const say = (text: string) => [{ type: 'message', content: [{ type: 'output_text', text }] }];
  const run = (reply: string) => [[{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }], say(reply)];
  const count = (text: string, s: string): number => text.split(s).length - 1;
  const estimateScreenLine = () => {
    READ = structuredClone(READ_T1B);
    READ.graph.nodes.find((n: Json) => n.id === 'raise_prices_10').label = 'Raise to £59';
    READ.analysis_state.leader_claim = { permitted: true, separation: 'separated' };
    analysisResult = structuredClone(READ.analysis_result);
    analysisResult.enrichment.inference_warnings = [{
      code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance of meeting your goal is licensed on this Run.',
      form: 'each', option_ids: ['raise_prices_10'], pct_by_option: { raise_prices_10: 67 },
      target: { comparator: 'at_least', value: 126000, unit: '£/month' }, olumi_estimate_link_count: 1,
      goal_node_id: 'monthly_recurring_revenue', goal_label: 'Monthly recurring revenue',
      option_labels_by_option: { raise_prices_10: 'Raise to £59' },
    }];
    return goalChanceScreenLinesForAgent(analysisResult, READ.graph, true)[0]!;
  };
  const shortfallScreenLine = () => {
    READ = structuredClone(READ_T1B);
    READ.analysis_state.leader_claim = { permitted: true };
    analysisResult = structuredClone(READ.analysis_result);
    // Authored stored licence strings isolate the route/composer contract from the producer's numerical rows.
    analysisResult.enrichment.inference_warnings = [{
      code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance of meeting your goal is licensed on this Run.',
      form: 'each', option_ids: ['raise_prices_10'], pct_by_option: { raise_prices_10: 55 },
      target: { comparator: 'at_least', value: 126000, unit: '£/month' },
      sent_threshold: { value: 126000, field: 'goal_threshold_raw', frame: 'delta' },
      spread_note_by_option: { raise_prices_10: SPREAD_NOTE_WITHOUT_DOWNSIDE },
      shortfall_note_by_option: {
        raise_prices_10: 'In its worst 1 in 20 runs of this model, ‘Raise prices 10%’ falls short of your target by £16,000 / month or more.',
      },
    }];
    const lines = goalChanceScreenLinesForAgent(analysisResult, READ.graph, true);
    expect(lines).toHaveLength(1);
    expect(lines[0]!.spread_note).toBe(SPREAD_NOTE_WITHOUT_DOWNSIDE);
    expect(lines[0]!.shortfall_note).toBeDefined();
    return lines[0]!;
  };

  const oneChance = (goalFields: Json = {}, driver = false) => {
    READ = structuredClone(READ_T1B);
    const goal = READ.graph.nodes.find((n: Json) => n.kind === 'goal');
    Object.assign(goal, { label: 'MRR', goal_threshold_raw: 20000, goal_threshold_cap: 25000,
      goal_threshold_unit: '£/month', goal_horizon_months: 12 }, goalFields);
    READ.analysis_state.leader_claim = { permitted: true, separation: 'separated' };
    analysisResult = structuredClone(READ.analysis_result);
    // A mocked historical licence isolates the reply contract. A positive H
    // without a typed producer withhold does not license a new Run at H; this
    // harness neither computes nor rewrites the producer's stored permission.
    analysisResult.enrichment.inference_warnings = [{
      code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance is licensed.', form: 'each',
      option_ids: ['raise_prices_10'], pct_by_option: { raise_prices_10: 67 },
      target: { comparator: 'at_least', value: 20000, unit: '£/month' },
      ...(driver ? { driver_by_option: { raise_prices_10: { kind: 'factor_value', factor_id: 'price_rise', quantity_id: 'price_rise',
        side: 'low', cut_value: 0.05, cut_unit: '%', pct_if_side: 40, authored_by: 'user' } } } : {}),
    }];
    return goalChanceScreenLinesForAgent(analysisResult, READ.graph, true)[0]!;
  };

  it.each(['run_with_card', 'run_without_card', 'run_basis_moved', 'run_card_stale', 'run_foreign_card', 'explain'] as const)(
    'NB1: recorded omission is said once across reply and the actual card (%s)', async mode => {
      // Reuse the existing authored 67% licence control; add both real omission carriers and its matching read basis.
      const finding = estimateScreenLine();
      nb1SavedBasis = true; nb1MovedBasis = mode === 'run_basis_moved';
      const savedHash = computeAnalysisAffectingGraphHash(READ.graph);
      if (savedHash === null) throw new Error('NB1 fixture must have a real analysis hash');
      READ.graph_hash = savedHash; analysisResult.computed_against_hash = savedHash;
      const risk = { node_id: 'recorded-risk', label: 'The recorded provisional risk', reason: 'unsized_olumi_risk' as const };
      analysisResult.enrichment.inference_warnings[0].omitted_from_calculation = { scope: 'modelled_effects_only', risks: [risk] };
      analysisResult.enrichment.inference_warnings.push(unsizedOlumiRiskOmissionWarning([risk]));
      expect(runOmittedRisks(analysisResult)).toEqual([risk]);
      const note = unsizedOlumiRiskLineFor(risk.label, true)!;
      const riskSentence = note.slice(note.indexOf('. ') + 2);
      if (mode === 'run_without_card') canonicalReadOverride = () => undefined;
      if (mode === 'run_card_stale') canonicalReadOverride = view => ({ ...view, staleness: { ...view.staleness, stale: true } });
      if (mode === 'run_foreign_card') canonicalReadOverride = view => ({ ...view,
        run: view.run === null ? null : { ...view.run, computed_at: '2000-01-01T00:00:00.000Z' } });
      const chip = runExplanationChip(SCENARIO, { graphHash: READ.graph_hash, analysisState: READ.analysis_state, analysisResult })!;
      const b = mode === 'explain'
        ? await turn([say(`Review the retained assumptions. ${note}`)], RUN_EXPLANATION_MESSAGE, { chip: { id: chip.id } })
        : await turn(run(`Review the retained assumptions. ${note}`), 'Run it');
      const view = b.canonical_analysis_view;
      const cardNotes = view?.goal_chance?.notes ?? [];

      if (mode === 'run_with_card') {
        expect(runCompleted).toBe(true);
        expect(b.blocks?.some(block => block.type === 'analysis_result')).toBe(true);
        expect(view?.run).toMatchObject({ run_id: 'fixture-screen-run', graph_hash_at_run: READ.graph_hash,
          computed_at: READ.analysis_state.run_state.computed_at });
        expect(view?.staleness.stale).toBe(false);
        expect(cardNotes.filter(line => line === note)).toHaveLength(1);
        expect(view?.options.find(row => row.option_id === finding.option_id)?.cell).toMatchObject({ kind: 'figure', face: finding.chance });
        expect(b.assistant_text, 'the exact chance face already follows the same-Run card binding').not.toContain(finding.chance);
        expect(count(b.assistant_text, riskSentence), 'the same current card already says this whole recorded omission').toBe(0);
      } else {
        expect(count(b.assistant_text, riskSentence), 'without a new Run card the reply retains the risk disclosure').toBe(1);
        if (mode === 'explain') expect(runCompleted, 'Explain must not run analysis again').toBe(false);
        else if (mode === 'run_card_stale') expect(view?.staleness.stale).toBe(true);
        else if (mode === 'run_foreign_card') expect(view?.run?.computed_at).not.toBe(READ.analysis_state.run_state.computed_at);
        else expect(view).toBeUndefined();
      }
      expect(rows.get(lastTurnPayload.turn_id)?.assistant_message).toBe(b.assistant_text);
    }, 60000);

  it.each(['bound', 'absent', 'stale', 'foreign', 'explain'] as const)(
    'C3: the static scope is said once, only on the bound current card (%s)', async mode => {
      // Replay the captured engine rows through the real producer. No engine/provider is contacted.
      const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'c3-capacity', {
        loadGraphAndBriefText: vi.fn(async () => ({ graph: structuredClone(capacity.graph), briefText: capacity.brief, revision: 2 })),
        readMostRecentPendingActions: vi.fn(async () => []),
      } as never);
      const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot,
        plotClient: { run: vi.fn(async () => ({ ...structuredClone(minimal),
          option_comparison: structuredClone(capacity.result.enrichment.option_comparison) })), validatePatch: vi.fn() } as never });
      const outcome = await handler({ payload: { scenario_id: SCENARIO, turn_id: 'c3-capacity' }, requestId: 'c3-capacity',
        context: {}, signal: new AbortController().signal, orientationText: '' } as never);
      const fact = outcome.handler_facts.find(f => f.fact_type === 'run_analysis');
      if (fact?.fact_type !== 'run_analysis' || fact.noop) throw new Error('Expected the real producer Run');
      READ = { graph: structuredClone(capacity.graph), graph_hash: fact.result.graph_hash_at_run,
        analysis_state: { ...structuredClone(READ_T1B.analysis_state),
          run_state: { kind: 'complete_current', computed_at: fact.result.computed_at } } };
      analysisResult = { type: 'analysis_result', ...fact.result, computed_against_hash: fact.result.graph_hash_at_run };
      nb1SavedBasis = true;
      if (mode === 'absent') canonicalReadOverride = () => undefined;
      if (mode === 'stale') canonicalReadOverride = view => ({ ...view, staleness: { ...view.staleness, stale: true } });
      if (mode === 'foreign') canonicalReadOverride = view => ({ ...view,
        run: view.run === null ? null : { ...view.run, computed_at: '2000-01-01T00:00:00.000Z' } });
      if (mode === 'bound') extraRunBlocks = structuredClone(CAPTURED_COACHING.blocks);
      const answer = `The retained chance is conditional on these inputs. ${STATIC_MODEL_SCOPE_NOTE}`;
      const chip = runExplanationChip(SCENARIO, { graphHash: READ.graph_hash, analysisState: READ.analysis_state, analysisResult })!;
      const body = mode === 'explain'
        ? await turn([say(answer)], RUN_EXPLANATION_MESSAGE, { chip: { id: chip.id } })
        : await turn(run(answer), 'Run it');
      if (mode === 'bound') {
        expect(body.canonical_analysis_view?.question?.scope.status).toBe('supported_static');
        expect(body.canonical_analysis_view?.options.find(row => row.option_id === 'add_one_specialist')?.cell)
          .toMatchObject({ kind: 'figure', face: expect.stringContaining(`about 40%`) });
        expect(body.canonical_analysis_view?.options.find(row => row.option_id === 'add_one_specialist')?.cell)
          .toMatchObject({ face: expect.stringContaining(STATIC_MODEL_SCOPE_NOTE) });
        expect(count(body.assistant_text, STATIC_MODEL_SCOPE_NOTE)).toBe(0);
        expect(body.blocks?.some(block => block.type === 'coaching' || block.type === 'exercise')).toBe(false);
      } else {
        expect(count(body.assistant_text, STATIC_MODEL_SCOPE_NOTE)).toBe(1);
        if (mode === 'explain') expect(runCompleted, 'Explain does not run analysis again').toBe(false);
      }
      expect(rows.get(lastTurnPayload.turn_id)?.assistant_message).toBe(body.assistant_text);
    }, 60000);

  it('SCOPE: ordinary converse keeps its lead and three bullets visible without draft or Run contract', async () => {
    oneChance();
    const text = 'The main risks are clear.\n- Churn could rise.\n- Adoption could lag.\n- Support costs could grow.';
    const b = await turn([say(text)], 'What are the main risks?');
    expect(b._agent.tool_calls).toEqual([]);
    expect(composeInput?.faceContract).toBeUndefined();
    expect(b.assistant_text.startsWith(text)).toBe(true);
    expect(b._answer_shape).toBeUndefined();
  });

  it('W stale selected Run: no W despite a licensed result', async () => {
    oneChance({ goal_horizon_months: undefined }, true);
    expect(whatChangesFaceLine(analysisResult, READ.graph)).not.toBeNull();
    READ.analysis_state.run_state.kind = 'complete_stale';
    const b = await turn(run('The analysis returned a stale result.'), 'Run it', { chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });
    expect(composeInput?.faceContract).toBe('run');
    expect(composeInput?.whatChanges).toBeUndefined();
    expect(b.assistant_text).not.toContain('What would change it:');
  });

  it('W stale Explain binding: a newer current licensed Run cannot supply W for the old control', async () => {
    oneChance({ goal_horizon_months: undefined }, true);
    const chip = runExplanationChip(SCENARIO, { graphHash: READ.graph_hash, analysisState: READ.analysis_state, analysisResult })!;
    expect(chip).not.toBeNull();
    expect(whatChangesFaceLine(analysisResult, READ.graph)).not.toBeNull();
    READ.analysis_state.run_state.computed_at = '2026-10-08T11:00:00.000Z';
    seq += 1;
    callModelOutputs = [];
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: RUN_EXPLANATION_MESSAGE,
      turn_id: `9c3d4e5f-6a7b-4c8d-9e0f-${String(seq).padStart(12, '0')}`, chip: { id: chip.id },
    } });
    expect(response.statusCode, response.body).toBe(200);
    const b = response.json() as Body & { narration?: { status: string } };
    expect(b.narration?.status).toBe('stale');
    expect(composeInput?.faceContract).toBe('run');
    expect(composeInput?.whatChanges).toBeUndefined();
    expect(b.assistant_text).not.toContain('What would change it:');
  });

  it('GP review P1: zero added lines still applies cleaned narration and removes a fabricated link count', async () => {
    shortfallScreenLine();
    analysisResult.enrichment.inference_warnings[0].olumi_estimate_link_count = 1;
    const line = goalChanceScreenLinesForAgent(analysisResult, READ.graph, true)[0]!;
    expect(line.olumi_estimate_link_count).toBe(1);
    const canonical = [line.chance, line.depends].filter(Boolean).join(' ');
    const narration = `${canonical} Olumi's estimates feed 99 links.`;
    expect(checkScreenLineClaims(narration, [line])).not.toContain('99 links');
    const b = await turn(run(narration), 'Run it');
    expect(b.assistant_text).not.toContain('99 links');
    expect(b.assistant_text).toContain(line.chance);
  });

  it.each(['run', 'follow-up', 'added=0'] as const)('r10 %s: qualified points are labelled on wire, storage and replay', async kind => {
    const line = estimateScreenLine();
    const bare = kind === 'follow-up' ? 'The recorded chance for Raise to £59 is 67%.' : '‘Raise to £59’: about 67% in this model.';
    const unrelated = 'The chance of supplier failure is 10%. The chance of supplier failure is 67%.';
    const narration = `${bare} ${unrelated}${kind === 'added=0' ? `\n${line.chance}` : ''}`;
    const outputs = kind === 'follow-up' ? [say(narration)] : run(narration);
    const message = kind === 'follow-up' ? 'What was the recorded chance for Raise to £59?' : 'Run it';
    const b = await turn(outputs, message);
    const assertLabelled = (text: string) => {
      expect(text).not.toContain(bare);
      expect(count(text, line.chance), text).toBe(1);
      expect(text).toContain(unrelated);
    };
    assertLabelled(b.assistant_text);
    const saved = [...rows.values()].find(r => r.assistant_message === b.assistant_text);
    expect(saved, 'the exact labelled wire text is the durable answer').toBeDefined();
    assertLabelled(saved!.assistant_message);
    // Even a historical ordinary answer with the old bare sentence crosses the current licence boundary on replay.
    if (kind === 'follow-up') saved!.assistant_message = narration;
    const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message, turn_id: saved!.turn_id,
    } });
    expect(replay.statusCode, replay.body).toBe(200);
    const replayed = replay.json() as Body;
    expect(replayed._agent.replayed).toBe(true);
    assertLabelled(replayed.assistant_text);
  });

  it('r11: a forwarded assistant reply crosses the same current-Run boundary', async () => {
    const line = estimateScreenLine();
    const unrelated = 'The chance of supplier failure is 10%.';
    forwardedText = `Raise to £59: 67%. ${unrelated}`;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'system_event', scenario_id: SCENARIO, event: { kind: 'structural_rename', target_id: 'raise_prices_10', label: 'Raise to £59' },
    } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().assistant_text).toBe(`${line.chance} ${unrelated}`);
  });

  it('r13: a user-authored competitor sentence survives live egress, storage and same-id replay', async () => {
    const line = estimateScreenLine();
    const risk = 'Raise to £59: there is a 67% chance a competitor launches first.';
    const message = `Keep this risk in our reasoning. ${risk} We can revisit it next quarter.`;
    const narration = `You said: “${risk}”\n${line.chance}`;
    const b = await turn([say(narration)], message);
    expect(b.assistant_text).toContain(risk);
    const saved = [...rows.values()].find(r => r.assistant_message === b.assistant_text)!;
    expect(saved.assistant_message).toContain(risk);
    const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message, turn_id: saved.turn_id,
    } });
    expect(replay.statusCode, replay.body).toBe(200);
    expect(replay.json().assistant_text).toContain(risk);
  });

  it.each(['live', 'replay'] as const)('r13 cold %s: an earlier durable user sentence survives an assistant echo after restart', async mode => {
    const line = estimateScreenLine();
    const risk = 'Raise to £59: there is a 67% chance a competitor launches first.';
    const earlierMessage = `Keep this risk in our reasoning. ${risk} We can revisit it next quarter.`;
    const earlier = { id: 'r13-user-risk', turn_id: 'a13d0000-0000-4000-8000-000000000001', request_hash: hashTurn(earlierMessage),
      user_message: earlierMessage, assistant_message: 'Recorded your risk.', llm_calls_used: 1,
      created_at: '2026-10-08T10:00:00.000Z' };
    const message = 'Review the risk we recorded earlier.';
    const narration = `You said: “${risk}”\n${line.chance}`;
    // A unique session starts with no in-process typedWords. Only actual durable user_message rows own the risk.
    const sessionId = `r13-cold-${mode}`;
    recentRows = [earlier];
    if (mode === 'live') {
      const b = await turn([say(narration)], message, sessionId);
      expect(b.assistant_text).toContain(risk);
      expect([...rows.values()].find(r => r.assistant_message === b.assistant_text)!.assistant_message).toContain(risk);
    } else {
      const turnId = 'a13d0000-0000-4000-8000-000000000002';
      const prior = { id: 'r13-prior-followup', turn_id: turnId, request_hash: hashTurn(message),
        user_message: message, assistant_message: narration, llm_calls_used: 1, created_at: '2026-10-08T10:01:00.000Z' };
      rows.set(turnId, prior); recentRows = [prior, earlier];
      const providerCalls = vi.mocked(fetch).mock.calls.length;
      const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: SCENARIO, message, turn_id: turnId, agent_session_id: sessionId,
      } });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()._agent.replayed).toBe(true);
      expect(vi.mocked(fetch).mock.calls.length, 'a cold replay makes no provider call').toBe(providerCalls);
      expect(response.json().assistant_text).toContain(risk);
    }
  });

  it('fixture control: the served readback carries a range record and withholds the leader on a current Run', () => {
    expect(READ.analysis_result.enrichment.inference_warnings.map((w: Json) => w.code)).toContain('GOAL_CHANCE_RANGE');
    expect(READ.analysis_state.leader_claim.permitted).toBe(false);
    expect(READ.analysis_state.run_state.kind).toBe('complete_current');
    expect(SCREEN).toHaveLength(1);
  });

  it('a Run reply that already says the line keeps ONE copy (the leader gate and egress leave it)', async () => {
    const b = await turn(run(`The analysis ran. ${SCREEN[0]}`), 'Run it');
    expect(count(b.assistant_text, 'between about 5% and 50%'), b.assistant_text).toBe(1);
  });

  it('CONTRAST: the same Run with no range record says no range', async () => {
    analysisResult.enrichment.inference_warnings = analysisResult.enrichment.inference_warnings.filter((w: Json) => w.code !== 'GOAL_CHANCE_RANGE');
    const b = await turn(run('The analysis ran, but it cannot put an option forward yet.'), 'Run it');
    expect(b.assistant_text).not.toContain('between about');
  });

  it('⭐ S7 B1 (served B5 T1b, leader withheld): the AI’s OWN licensed chance lines survive the gate, with NO composer copy', async () => {
    useT1b();
    expect(READ.analysis_state.leader_claim.permitted).toBe(false);
    const screen = goalChanceScreenLinesForAgent(analysisResult, READ.graph, true);
    expect(screen).toHaveLength(3);
    // The AI's own words for each option's licensed figure, built from the screen's own figure (never typed by hand).
    const own = screen.map((l) => `In this model, ${l.label} has ${l.figure} chance of meeting your goal.`);
    const b = await turn(run(`The analysis ran. ${own.join(' ')}`), 'Run it');
    for (const [i, line] of own.entries()) {
      expect(count(b.assistant_text, line), `${line}\n---\n${b.assistant_text}`).toBe(1);
      expect(count(b.assistant_text, screen[i]!.chance), 'no composer copy of the same figure').toBe(0);
    }
    // CONTRAST (the fallback stays truthful): the same Run with the AI saying no figure still gets the screen's lines.
  });

  it('B19 r1 CONTROL: a canonical chance already carrying spread and shortfall keeps both notes on the face once', async () => {
    const line = shortfallScreenLine();
    const reply = `Analysis is ready. Review the evidence. Check the assumptions. ${line.chance} Keep unresolved disagreements visible in the model for the team’s next review and keep the conversation grounded in evidence.`;
    expect(checkScreenLineClaims(reply, [line]), 'the complete producer unit stays intact').toBe(reply);
    const b = await turn(run(reply), 'Run it');
    expect(callModelOutputs, 'the control: the scripted canonical chance was consumed').toEqual([]);
    expect(b.assistant_text).toContain(line.chance);
    for (const note of [line.spread_note!, line.shortfall_note!]) {
      expect(count(b.assistant_text, note), b.assistant_text).toBe(1);

    }
  });

  it('AIE-04: the recorded qualification stays, while the AI owns one step; no stock invitation in wire or replay', async () => {
    const line = estimateScreenLine();
    const links = [{ from: 'monthly_churn', to: 'monthly_recurring_revenue',
      from_label: 'Monthly churn', to_label: 'Monthly recurring revenue' }];
    analysisResult.enrichment[UNSIZED_PATH_LEADER_CAUSE_KEY] = { ...links[0], links };
    const qualification = unsizedLinkSentence(links).replace(' Set it to see how much it matters.', '');
    const step = 'Compare the churn assumption with the latest customer evidence.';
    const b = await turn(run(`${line.chance} ${qualification} ${step}`), 'Run it');
    expect(b.assistant_text).toContain(line.chance);
    expect(b.assistant_text).toContain(qualification);
    expect(b.assistant_text.split(qualification)).toHaveLength(2);
    expect(b.assistant_text.split(step)).toHaveLength(2);
    expect(b.assistant_text).not.toContain('Set it to see how much it matters.');
    const saved = rows.get(lastTurnPayload.turn_id)!;
    expect(saved.assistant_message).toBe(b.assistant_text);
    const replay = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: lastTurnPayload });
    expect(replay.json().assistant_text).toBe(b.assistant_text);
  });

  it('CONTROL: a turn that ran nothing adds nothing', async () => {
    const b = await turn([say('Happy to help with the next step.')], 'Thanks');
    expect(b._agent.tool_calls.map((c) => c.name)).not.toContain('run_analysis');
    expect(b.assistant_text).not.toContain('between about');
  });
});
