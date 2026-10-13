/**
 * S4c THROUGH THE ROUTE: on a Run turn the screen's range line is in the reply (Wave B4: both Run narrations said "only as
 * a range" with no figure). The REAL agent route, a scripted OpenAI `fetch` (no provider is contacted), and the SERVED
 * b3-2 readback (`waveB3-unseen2-7addf05-readback-run1.json`, keys untouched). The expected line is the one the UI drew on
 * that Run (`waveB-screen-chance-lines-20261007.json`, source unseen-b3-2). Harness copied from the S2e route test.
 * Historical Run captures are forwarded by the mocked downstream route: these
 * rows preserve recorded screen permissions and do not prove a new chance at H.
 * Science §(ad)'s real producer withholding is tested in goal-horizon-verdict.route.test.ts.
 */
import { readFileSync } from 'node:fs';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed as _withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import { SPREAD_NOTE_WITHOUT_DOWNSIDE } from '../../goal-target/goal-chance-licence.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { untestedHorizonLine as _untestedHorizonLine } from '../decision-input-ask.js';
import { whatChangesFaceLine as _whatChangesFaceLine } from '../../goal-target/goal-chance-range-agent.js';
import { HORIZON_MARKER, WITHHOLD_FALLBACK_MARKER as _WITHHOLD_FALLBACK_MARKER, type ReplyComposeInput, type ReplyComposition } from '../reply/compose-reply.js';
import { runExplanationChip as _runExplanationChip, RUN_EXPLANATION_MESSAGE as _RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { goalKindOf as _goalKindOf } from '../../goal-target/goal-kind.js';
import { teamShareMoments as _teamShareMoments, extraShareMoments as _extraShareMoments } from '../../goal-target/event-by-date-share.js';
import { preconditionRiskIds as _preconditionRiskIds } from '../../../graph/inert-risk.js';
import { WIDENED_RISK_MARKER_DOWN as _WIDENED_RISK_MARKER_DOWN } from '../widened-risk-markers.js';

type Json = Record<string, any>;
const READ_B3 = (JSON.parse(readFileSync(new URL('./fixtures/waveB3-unseen2-7addf05-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
/** B5 T1b on 3fce64f: three point lines on the `each` licence, leader withheld (near tie); the gate deleted the chat's copy. */
const READ_T1B = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
/** Historical static B1 pilot before the accumulation carrier, with its original face/detail. */
const _READ_B1 = JSON.parse(readFileSync(new URL('./fixtures/r11b-head-b1.json', import.meta.url), 'utf8')) as Json;
// Exact B2 was not captured in this tree; the constructed fixture records its source and alterations.
const _RANGE_WINS_B2 = JSON.parse(readFileSync(new URL('./fixtures/guided-sizing-range-wins.json', import.meta.url), 'utf8')) as Json;
let READ: Json = READ_B3;
const VIEW = {
  view: 'Before comparing, size how strongly running a fourth shop changes its monthly operating profit.',
  reasoning: 'That relationship remains unsized.',
  confirm_step: 'Tell me roughly how much monthly profit the fourth shop would add, and I can propose it.',
};
const SCENARIO = '7a5e4d3c-2b1a-4d0e-9f8a-7b6c5d4e3f2a';
const ALL_SCREEN = JSON.parse(readFileSync(new URL('./fixtures/waveB-screen-chance-lines-20261007.json', import.meta.url), 'utf8')) as { line: string; source: string }[];
const SCREEN = ALL_SCREEN.filter((s) => s.source.includes('/unseen-b3-2/')).map((s) => s.line);
// Batch C: condition 6 of a correct chance / r1 item 6 (DL, 12 Oct) — a range rests on the same Olumi inputs as a point and
// says so in the point's own words. The served B3 line predates that: SCREEN_NOW is the CAPTURED line with exactly that
// clause inserted after "in this model" (its count is RC4's census, `goalChanceEstimateCounts`). Nothing else moves.
const withClause = (line: string, words: string): string => {
  const at = line.indexOf(', in this model.');
  if (at < 0) throw new Error(`no "in this model" in: ${line}`);
  return `${line.slice(0, at)}, in this model, using Olumi's estimates for ${words} (see Check estimates).${line.slice(at + ', in this model.'.length)}`;
};
const _SCREEN_NOW = SCREEN.map((l) => withClause(l, '6 starting values, 2 option settings and 5 relationships'));
const SCREEN_T1B = ALL_SCREEN.filter((s) => s.source.includes('/t1b-b5-1/')).map((s) => s.line);
const SIZE_QUESTION = 'How sure are you of that size?';
// RC6 keeps the first screen unit intact and drops only the later copy of its question.
const SCREEN_T1B_SAID_ONCE = SCREEN_T1B.map((line, i) => i === 1 ? line.replace(` ${SIZE_QUESTION}`, '') : line);
let analysisResult: Json = READ.analysis_result;
let forwardedText = 'ok';
let composeInput: ReplyComposeInput | undefined;
let composition: ReplyComposition | undefined;
let lastTurnPayload: Json;
let _runCompleted = false;
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
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

let callModelOutputs: Record<string, unknown>[][] = [];
type Body = { assistant_text: string; _answer_shape?: AnswerShape; _agent: { tool_calls: { name: string; ok: boolean }[]; replayed?: boolean } };

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
    app.post('/orchestrate/v2/turn', async () => { _runCompleted = true; return ({
      response_version: 2, assistant_text: forwardedText, suggested_actions: [], insights: [], graph_hash: READ.graph_hash,
      blocks: [analysisResult], analysis_ready: READ.analysis_ready, analysis_state: READ.analysis_state,
    }); });
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      // The harness authors the successful fact wrapper around this captured Run; production never invents one.
      const canonical_analysis_view = projectCanonicalAnalysisView({ graph: READ.graph,
        runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
          scenario_id: SCENARIO, run_id: 'fixture-screen-run', summary: analysisResult.summary,
          leading_option_id: analysisResult.leading_option_id, enrichment: analysisResult.enrichment,
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
  beforeEach(() => { _runCompleted = false; canonicalReadOverride = undefined; warn.mockClear(); rows.clear(); recentRows = []; forwardedText = 'ok'; READ = READ_B3; analysisResult = JSON.parse(JSON.stringify(READ.analysis_result)); composeInput = undefined; composition = undefined; });
  const _useT1b = (): void => { READ = READ_T1B; analysisResult = JSON.parse(JSON.stringify(READ.analysis_result)); };

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
  const _run = (reply: string) => [[{ type: 'function_call', name: 'run_analysis', arguments: JSON.stringify({ reason: 'compare' }), call_id: 'c1' }], say(reply)];
  const count = (text: string, s: string): number => text.split(s).length - 1;
  const faceUnits = (body: Body): string[] => [body._answer_shape!.headline, ...body._answer_shape!.bullets];
  const _withholdMarkers = (body: Body): string[] => faceUnits(body).filter(unit => /^Not shown(?::| yet;)/.test(unit));
  const _expectStoredAndReplayed = async (body: Body): Promise<void> => {
    const payload = structuredClone(lastTurnPayload);
    expect(body._answer_shape, 'PL live: displayed contract carries its face/detail shape').toBeDefined();
    const durable = rows.get(payload.turn_id);
    expect(durable?.assistant_message, 'PL live: durable answer text equals displayed text').toBe(body.assistant_text);
    expect(body.assistant_text, 'PL live: display is the exact shape derivation').toBe(deriveAnswerTextFromShape(body._answer_shape!));
    const providerCalls = vi.mocked(fetch).mock.calls.length;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
    expect(response.statusCode, response.body).toBe(200);
    const replay = response.json() as Body;
    expect(replay._agent.replayed).toBe(true);
    expect(vi.mocked(fetch).mock.calls.length, 'PL replay makes no provider call').toBe(providerCalls);
    expect(replay.assistant_text, 'PL replay: durable answer text equals displayed text').toBe(durable?.assistant_message);
    expect(replay.assistant_text, 'PL replay: exact live words').toBe(body.assistant_text);
    expect(replay._answer_shape, 'PL replay: exact live face/detail shape').toEqual(body._answer_shape);
    expect(replay.assistant_text, 'PL replay: display is the exact shape derivation').toBe(deriveAnswerTextFromShape(replay._answer_shape!));
  };
  const _expectHorizonMarker = (body: Body, chance: string, fullSentence: string): void => {
    const shape = body._answer_shape!;
    const units = [shape.headline, ...shape.bullets];
    expect(units[units.indexOf(chance) + 1], 'must-face horizon marker immediately follows its chance').toBe(HORIZON_MARKER);
    expect(count(units.join('\n'), HORIZON_MARKER), 'one horizon marker on face').toBe(1);
    expect(count(units.join('\n'), fullSentence), 'full horizon sentence is off face').toBe(0);
    expect(count(shape.detail, fullSentence), 'full horizon sentence is verbatim in detail once').toBe(1);
    expect(count(body.assistant_text, fullSentence), 'one full horizon sentence in whole reply').toBe(1);
    expect(body.assistant_text).toBe(deriveAnswerTextFromShape(shape));
  };
  const expectNoRetiredHorizon = (body: Body): void => {
    expect(composeInput?.horizonLine).toBeUndefined();
    expect(faceUnits(body)).not.toContain(HORIZON_MARKER);
    expect(body.assistant_text).not.toMatch(/This chance uses|These chances use|This model doesn't yet say whether any option gets there/);
    expect(body.assistant_text).not.toContain("doesn't project");
  };
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
  const _expectMandatoryFindings = (body: Body) => {
    expect(body._answer_shape, 'R2 T1b coaching reply carries one shape').toBeDefined();
    const units = [body._answer_shape!.headline, ...body._answer_shape!.bullets];
    // This route harness forwards a historical licence, bypassing the Run producer.
    // §(ad)'s new producer coverage belongs to goal-horizon-verdict.route.test.ts.
    expect(units, 'exact recorded finding identities, with no retired time-bound disclaimer or optional framing/W/E').toEqual(SCREEN_T1B_SAID_ONCE);
    expectNoRetiredHorizon(body);
    expect(composition?.measure?.face_words, 'T1b is re-measured below its old 137-word face').toBeLessThan(120);
    expect(units.join('\n')).not.toContain('What would change it:');
    expect(units.join('\n')).not.toContain("Olumi's estimates:");
    expect(composition?.measure?.face_over_word_budget).toBe(true);
  };
  const _shortfallScreenLine = () => {
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

  const _oneChance = (goalFields: Json = {}, driver = false) => {
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

  it('r11: a forwarded assistant reply crosses the same current-Run boundary', async () => {
    const line = estimateScreenLine();
    const unrelated = 'The chance of supplier failure is 10%.';
    forwardedText = `Raise to £59: 67%. ${unrelated}`;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'system_event', scenario_id: SCENARIO, event: { kind: 'structural_rename', target_id: 'raise_prices_10', label: 'Raise to £59' },
    } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().assistant_text).toBe(forwardedText);
    forwardedText = `There is a 68% chance that Raise to £59 meets your goal. ${unrelated}`;
    const wrong = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'system_event', scenario_id: SCENARIO, event: { kind: 'structural_rename', target_id: 'raise_prices_10', label: 'Raise to £59' },
    } });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.json().assistant_text).toBe(`${line.chance} ${unrelated}`);
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

});
