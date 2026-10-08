/**
 * S4c THROUGH THE ROUTE: on a Run turn the screen's range line is in the reply (Wave B4: both Run narrations said "only as
 * a range" with no figure). The REAL agent route, a scripted OpenAI `fetch` (no provider is contacted), and the SERVED
 * b3-2 readback (`waveB3-unseen2-7addf05-readback-run1.json`, keys untouched). The expected line is the one the UI drew on
 * that Run (`waveB-screen-chance-lines-20261007.json`, source unseen-b3-2). Harness copied from the S2e route test.
 */
import { readFileSync } from 'node:fs';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { goalChanceScreenLinesForAgent, withScreenLinesOwed } from '../goal-chance-screen-lines.js';
import { SPREAD_NOTE_WITHOUT_DOWNSIDE } from '../../goal-target/goal-chance-licence.js';
import { deriveAnswerTextFromShape, type AnswerShape } from '../../routing/answer-shape.js';
import { untestedHorizonLine } from '../decision-input-ask.js';
import { whatChangesFaceLine } from '../../goal-target/goal-chance-range-agent.js';
import { HORIZON_MARKER, WITHHOLD_FALLBACK_MARKER, type ReplyComposeInput, type ReplyComposition } from '../reply/compose-reply.js';
import { runExplanationChip, RUN_EXPLANATION_MESSAGE } from '../run-explanation.js';
import { goalKindOf } from '../../goal-target/goal-kind.js';
import { teamShareMoments, extraShareMoments } from '../../goal-target/event-by-date-share.js';
import { preconditionRiskIds } from '../../../graph/inert-risk.js';
import { WIDENED_RISK_MARKER_DOWN } from '../widened-risk-markers.js';

type Json = Record<string, any>;
const READ_B3 = (JSON.parse(readFileSync(new URL('./fixtures/waveB3-unseen2-7addf05-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
/** B5 T1b on 3fce64f: three point lines on the `each` licence, leader withheld (near tie); the gate deleted the chat's copy. */
const READ_T1B = (JSON.parse(readFileSync(new URL('./fixtures/waveB5-t1b-3fce64f-readback-run1.json', import.meta.url), 'utf8')) as { j: Json }).j;
/** The live HEAD-B1 pilot, copied locally with its graph, Run and original displayed face/detail. */
const READ_B1 = JSON.parse(readFileSync(new URL('./fixtures/r11b-head-b1.json', import.meta.url), 'utf8')) as Json;
// Exact B2 was not captured in this tree; the constructed fixture records its source and alterations.
const RANGE_WINS_B2 = JSON.parse(readFileSync(new URL('./fixtures/guided-sizing-range-wins.json', import.meta.url), 'utf8')) as Json;
let READ: Json = READ_B3;
const VIEW = {
  view: 'Before comparing, size how strongly running a fourth shop changes its monthly operating profit.',
  reasoning: 'That relationship remains unsized.',
  confirm_step: 'Tell me roughly how much monthly profit the fourth shop would add, and I can propose it.',
};
const SCENARIO = '7a5e4d3c-2b1a-4d0e-9f8a-7b6c5d4e3f2a';
const ALL_SCREEN = JSON.parse(readFileSync(new URL('./fixtures/waveB-screen-chance-lines-20261007.json', import.meta.url), 'utf8')) as { line: string; source: string }[];
const SCREEN = ALL_SCREEN.filter((s) => s.source.includes('/unseen-b3-2/')).map((s) => s.line);
const SCREEN_T1B = ALL_SCREEN.filter((s) => s.source.includes('/t1b-b5-1/')).map((s) => s.line);
const SIZE_QUESTION = 'How sure are you of that size?';
// RC6 keeps the first screen unit intact and drops only the later copy of its question.
const SCREEN_T1B_SAID_ONCE = SCREEN_T1B.map((line, i) => i === 1 ? line.replace(` ${SIZE_QUESTION}`, '') : line);
let analysisResult: Json = READ.analysis_result;
let forwardedText = 'ok';
let composeInput: ReplyComposeInput | undefined;
let composition: ReplyComposition | undefined;
let lastTurnPayload: Json;
let runCompleted = false;
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
    app.post('/orchestrate/v2/turn', async () => { runCompleted = true; return ({
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
  beforeEach(() => { runCompleted = false; canonicalReadOverride = undefined; warn.mockClear(); rows.clear(); recentRows = []; forwardedText = 'ok'; READ = READ_B3; analysisResult = JSON.parse(JSON.stringify(READ.analysis_result)); composeInput = undefined; composition = undefined; });
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
  const faceUnits = (body: Body): string[] => [body._answer_shape!.headline, ...body._answer_shape!.bullets];
  const withholdMarkers = (body: Body): string[] => faceUnits(body).filter(unit => /^Not shown(?::| yet;)/.test(unit));
  const expectStoredAndReplayed = async (body: Body): Promise<void> => {
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
  const expectHorizonMarker = (body: Body, chance: string, fullSentence: string): void => {
    const shape = body._answer_shape!;
    const units = [shape.headline, ...shape.bullets];
    expect(units[units.indexOf(chance) + 1], 'must-face horizon marker immediately follows its chance').toBe(HORIZON_MARKER);
    expect(count(units.join('\n'), HORIZON_MARKER), 'one horizon marker on face').toBe(1);
    expect(count(units.join('\n'), fullSentence), 'full horizon sentence is off face').toBe(0);
    expect(count(shape.detail, fullSentence), 'full horizon sentence is verbatim in detail once').toBe(1);
    expect(count(body.assistant_text, fullSentence), 'one full horizon sentence in whole reply').toBe(1);
    expect(body.assistant_text).toBe(deriveAnswerTextFromShape(shape));
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
  const expectMandatoryFindings = (body: Body) => {
    expect(body._answer_shape, 'R2 T1b coaching reply carries one shape').toBeDefined();
    const units = [body._answer_shape!.headline, ...body._answer_shape!.bullets];
    const horizon = untestedHorizonLine(READ.graph, { besideChance: true, plural: true })!;
    expect(units, 'exact mandatory finding identities, then short horizon marker; no optional framing/W/E').toEqual([...SCREEN_T1B_SAID_ONCE, HORIZON_MARKER]);
    expectHorizonMarker(body, SCREEN_T1B_SAID_ONCE.at(-1)!, horizon);
    expect(composition?.measure?.face_words, 'T1b is re-measured below its old 137-word face').toBeLessThan(120);
    expect(units.join('\n')).not.toContain('What would change it:');
    expect(units.join('\n')).not.toContain("Olumi's estimates:");
    expect(composition?.measure?.face_over_word_budget).toBe(true);
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
    analysisResult.enrichment.inference_warnings = [{
      code: 'GOAL_CHANCE_LICENSED', severity: 'info', message: 'Each option’s chance is licensed.', form: 'each',
      option_ids: ['raise_prices_10'], pct_by_option: { raise_prices_10: 67 },
      target: { comparator: 'at_least', value: 20000, unit: '£/month' },
      ...(driver ? { driver_by_option: { raise_prices_10: { kind: 'factor_value', factor_id: 'price_rise', quantity_id: 'price_rise',
        side: 'low', cut_value: 0.05, cut_unit: '%', pct_if_side: 40, authored_by: 'user' } } } : {}),
    }];
    return goalChanceScreenLinesForAgent(analysisResult, READ.graph, true)[0]!;
  };

  it.each([
    ['missing', () => undefined],
    ['null', () => null],
    ['invalid options', (view: ReturnType<typeof projectCanonicalAnalysisView>) => ({ ...view, options: {} })],
    ['invalid cell', (view: ReturnType<typeof projectCanonicalAnalysisView>) => ({ ...view, options: [{ option_id: 'bad', cell: { kind: 'figure' } }] })],
    ['invalid range', (view: ReturnType<typeof projectCanonicalAnalysisView>) => ({ ...view, options: [{ option_id: 'bad', cell: { kind: 'range', display: 'between 1% and 2%', detail: {} } }] })],
  ] as const)('r11d %s canonical_analysis_view: no marker, chance-free horizon, one warning on live and replay', async (_name, override) => {
    READ = structuredClone(READ_B1);
    analysisResult = structuredClone(READ.analysis_result);
    canonicalReadOverride = override;
    const b = await turn(run('Your results are ready. You can view them now or ask me to explain them.'), 'Run it');
    expect(composeInput?.chanceCells).toEqual([]);
    expect(withholdMarkers(b)).toEqual([]);
    expect(count(b.assistant_text, "This model doesn't yet say whether any option gets there within 12 months.")).toBe(1);
    expect(b.assistant_text).not.toMatch(/This chance uses|These chances use/);
    const warnings = () => warn.mock.calls.filter((call: unknown[]) => (call[0] as { event?: unknown } | undefined)?.event === 'agent_lane.canonical_analysis_view_unavailable');
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]![0]).toMatchObject({ scenario_id: SCENARIO });
    await expectStoredAndReplayed(b);
    expect(warnings()).toHaveLength(2); // Once for each reply, never for the turn's intermediate reads.
  });

  it('r11d READ wins: FINAL read cells override a disagreeing local projection on live and replay', async () => {
    READ = structuredClone(READ_B1);
    analysisResult = structuredClone(READ.analysis_result);
    canonicalReadOverride = view => {
      expect(view.options.length).toBeGreaterThan(0);
      expect(view.options.every(row => row.cell.kind === 'withheld'), 'local projection would add a marker').toBe(true);
      // Earlier reads remain withheld; only the read after Run carries the none cells used by the UI.
      return runCompleted ? { ...view, options: view.options.map(row => ({ ...row, cell: { kind: 'none' as const } })) } : view;
    };
    const b = await turn(run('Your results are ready. You can view them now or ask me to explain them.'), 'Run it');
    expect(composeInput?.chanceCells?.length).toBeGreaterThan(0);
    expect(composeInput?.chanceCells?.every(cell => cell.kind === 'none'), 'READ owns the cells').toBe(true);
    expect(withholdMarkers(b), 'locally recomputed withholds cannot supply a marker').toEqual([]);
    expect(count(b.assistant_text, "This model doesn't yet say whether any option gets there within 12 months.")).toBe(1);
    await expectStoredAndReplayed(b);
    expect(composeInput?.chanceCells?.every(cell => cell.kind === 'none'), 'replay READ owns the cells too').toBe(true);
  });

  it('r11d valid withheld cells with no recorded reason retain the fallback marker', async () => {
    READ = structuredClone(READ_B1);
    analysisResult = structuredClone(READ.analysis_result);
    canonicalReadOverride = view => ({ ...view, options: view.options.map(row => ({ ...row,
      cell: { ...row.cell, kind: 'withheld' as const, reasons: [{ code: 'reason_not_recorded', message: null }] } })) });
    const b = await turn(run('Your results are ready.'), 'Run it');
    expect(withholdMarkers(b)).toEqual([WITHHOLD_FALLBACK_MARKER]);
    expect(warn.mock.calls.filter((call: unknown[]) => (call[0] as { event?: unknown } | undefined)?.event === 'agent_lane.canonical_analysis_view_unavailable')).toEqual([]);
    await expectStoredAndReplayed(b);
  });

  it('r11b B1 pilot: withheld canonical cells give one face marker and the chance-free horizon once', async () => {
    READ = structuredClone(READ_B1);
    analysisResult = structuredClone(READ.analysis_result);
    // Exercise the Run's real producer, including when an earlier identity withhold already removed its figures.
    const { withholdGoalFiguresForMissingCurrentLevel } = await import('../../tools/handlers/run-analysis.js');
    analysisResult.enrichment = withholdGoalFiguresForMissingCurrentLevel(analysisResult.enrichment, READ.graph);
    expect(analysisResult.enrichment.inference_warnings.some((warning: Json) => warning.code === 'GOAL_FIGURES_MISSING_CURRENT_LEVEL')).toBe(true);
    expect(goalChanceScreenLinesForAgent(analysisResult, READ.graph, true)).toEqual([]);
    const b = await turn(run(READ_B1.before_text), 'Run it');
    expect(composeInput?.chanceCells?.length).toBeGreaterThan(0);
    expect(composeInput?.chanceCells?.every(cell => cell.kind === 'withheld')).toBe(true);
    expect(b.assistant_text).not.toMatch(/This chance uses|These chances use/);
    const horizon = "This model doesn't yet say whether any option gets there within 12 months.";
    expect(count(b.assistant_text, horizon), 'the exact staging chance-free horizon survives once').toBe(1);
    expect(withholdMarkers(b), 'one marker is supplied by the Run cells despite three detail withhold sentences').toHaveLength(1);
    expect(withholdMarkers(b)[0], 'distinct identity and current-level causes cannot be replaced by one partial cause').toBe(WITHHOLD_FALLBACK_MARKER);
    for (const sentence of [
      "Olumi can't show each option's chance of reaching your MRR target yet: the model doesn't have MRR's current level to measure from.",
      'This run doesn’t yet show each option’s chance of reaching £20,000.',
      "Olumi reads 'MRR' as 'Pro plan price' × 'Pro paying subscribers', but that hasn't been confirmed, so this run gives no chance of reaching the target for 'MRR'.",
    ]) expect(b._answer_shape!.detail, 'the three original withhold sentences retain their producers this round').toContain(sentence);
    const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;
    process.stdout.write(`R11B_B1 ${JSON.stringify({
      before: READ_B1.before_shape, after: b._answer_shape,
      words: { before_face: words([READ_B1.before_shape.headline, ...READ_B1.before_shape.bullets].join(' ')),
        before_detail: words(READ_B1.before_shape.detail), after_face: words(faceUnits(b).join(' ')),
        after_detail: words(b._answer_shape!.detail) },
    })}\n`);
    await expectStoredAndReplayed(b);
  });

  it.each(['GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED', 'GOAL_FIGURES_PRODUCT_NOT_READ'] as const)(
    'r11c identity-only withheld Run: %s retains the named face marker through storage and replay', async code => {
      READ = structuredClone(READ_B1);
      analysisResult = structuredClone(READ.analysis_result);
      const identity = analysisResult.enrichment.inference_warnings.find((warning: Json) =>
        warning.code === 'GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED');
      expect(identity).toBeDefined();
      analysisResult.enrichment.inference_warnings = [{ ...identity, code }];
      const b = await turn(run('Your results are ready. You can view them now or ask me to explain them.'), 'Run it');
      expect(composeInput?.chanceCells?.length).toBeGreaterThan(0);
      expect(composeInput?.chanceCells?.every(cell => cell.kind === 'withheld'
        && cell.reasons.length === 1 && cell.reasons[0]!.code === code)).toBe(true);
      expect(withholdMarkers(b)).toEqual(["Not shown: how MRR is worked out isn't confirmed"]);
      expect(b.assistant_text).not.toMatch(/This chance uses|These chances use/);
      await expectStoredAndReplayed(b);
    });

  it('r11b B3 range fixture: the ranged option counts as a chance and supplies no withhold marker', async () => {
    // Reuse the served B3 range; narrow its Run roster to that option so the other B3 withholds do not add a marker.
    analysisResult.enrichment.option_comparison = analysisResult.enrichment.option_comparison
      .filter((option: Json) => option.option_id === 'fourth_shop_in_clifton');
    const b = await turn(run('Review the recorded assumptions.'), 'Run it');
    expect(composeInput?.chanceCells?.map(cell => cell.kind)).toEqual(['range']);
    expect(b.assistant_text).toContain(SCREEN[0]!);
    expect(b.assistant_text).toContain("This chance uses the model's numbers as they are today");
    expect(b.assistant_text).not.toContain('These chances use');
    expect(withholdMarkers(b)).toEqual([]);
    expect(faceUnits(b)).toContain(HORIZON_MARKER);
    await expectStoredAndReplayed(b);
  });

  it('FU1 served B3: added risks beside its captured range and withheld option use their own chance cells; replay identical', async () => {
    READ = structuredClone(READ_B3);
    analysisResult = structuredClone(READ.analysis_result);
    // Augment only the retained graph with typed zero-edge widening attachments. The served B3's Run roster,
    // recorded 5–50% range, and native withhold warnings stay unchanged; its original risks have no widening stamps.
    const goal = READ.graph.nodes.find((node: Json) => node.id === 'monthly_profit');
    const risks = [
      { id: 'fu1_shop_opening_delayed', label: 'Shop opening delayed', optionId: 'fourth_shop_in_clifton',
        throughId: 'fourth_shop_operating' },
      { id: 'fu1_loyalty_app_adoption_lags', label: 'Loyalty app adoption lags', optionId: 'loyalty_app',
        throughId: 'loyalty_app_active' },
    ].map(({ id, label, optionId, throughId }) => {
      const option = READ.graph.nodes.find((node: Json) => node.id === optionId);
      const through = READ.graph.nodes.find((node: Json) => node.id === throughId);
      return { id, kind: 'risk', label, provenance: 'ai_inferred', proposed_by: 'olumi',
        analysis_participation: 'retained_excluded', draft_widening: {
          provenance: 'ai_suggested_widen', hits: { id: option.id, label: option.label, kind: 'option' },
          through: { id: through.id, label: through.label, direction: 'negative' },
          affects: { id: goal.id, label: goal.label, direction: 'negative' }, mechanism: 'relies_on',
          relies_on: 'The option becoming active as planned.', watch_for: 'Launch milestones start slipping.',
        } };
    });
    READ.graph.nodes.push(...risks);
    const preconditions = preconditionRiskIds(READ.graph.nodes, READ.graph.edges,
      (READ.graph.goal_constraints ?? []).map((constraint: Json) => constraint.node_id));
    for (const risk of risks) expect(preconditions.has(risk.id), 'the added attachment is a valid excluded precondition').toBe(true);
    expect(analysisResult.enrichment.inference_warnings).toEqual(READ_B3.analysis_result.enrichment.inference_warnings);

    const body = await turn(run('Review the recorded assumptions.'), 'Run it');
    const input = composeInput!;
    const note = "Risks Olumi added aren't in the chance yet, so it may be too high.";
    expect(input.chanceCells).toContainEqual(expect.objectContaining({ kind: 'range', option_id: 'fourth_shop_in_clifton' }));
    expect(input.chanceCells).toContainEqual(expect.objectContaining({ kind: 'withheld', option_id: 'loyalty_app' }));
    expect(body.assistant_text).toContain(SCREEN[0]!);
    expect(input.widenedRiskNote).toBe(note);
    expect(input.widenedRiskMarker).toBe(WIDENED_RISK_MARKER_DOWN);
    expect(count(body.assistant_text, note)).toBe(1);
    expect(count(body._answer_shape!.detail, note)).toBe(1);
    const rangeLine = "‘Shop opening delayed’: ‘Fourth shop in Clifton’ relies on this not happening. This model can't yet apply that risk to that option alone, so the Run leaves it out, and that option's chance doesn't include it yet.";
    const withheldLine = "‘Loyalty app adoption lags’: ‘Loyalty app’ relies on this not happening. This model can't yet apply that risk to that option alone, so the Run leaves it out.";
    expect(count(body.assistant_text, rangeLine)).toBe(1);
    expect(count(body.assistant_text, withheldLine)).toBe(1);
    expect(body.assistant_text).not.toContain(`${withheldLine.slice(0, -1)}, and that option's chance doesn't include it yet.`);
    const units = faceUnits(body);
    const rangeIndex = units.findIndex(unit => unit.startsWith('‘Fourth shop in Clifton’: between about 5% and 50% chance'));
    expect(rangeIndex).toBeGreaterThanOrEqual(0);
    expect(units.indexOf(WIDENED_RISK_MARKER_DOWN)).toBeGreaterThan(rangeIndex);
    expect(count(units.join('\n'), WIDENED_RISK_MARKER_DOWN)).toBe(1);
    process.stdout.write(`FU1_B3_RUN ${JSON.stringify({ text: body.assistant_text, shape: body._answer_shape,
      cells: input.chanceCells, note: input.widenedRiskNote, marker: input.widenedRiskMarker })}\n`);
    await expectStoredAndReplayed(body);
    expect(composeInput?.widenedRiskNote).toBe(note);
    expect(composeInput?.widenedRiskMarker).toBe(WIDENED_RISK_MARKER_DOWN);
  });

  it.each([1, 2] as const)('r11b mixed %s shown: figure cells choose horizon grammar beside exactly one withheld marker', async shown => {
    oneChance();
    const licence = analysisResult.enrichment.inference_warnings[0];
    if (shown === 2) {
      licence.option_ids.push('launch_49_starter_tier');
      licence.pct_by_option.launch_49_starter_tier = 20;
    }
    analysisResult.enrichment.inference_warnings.push({
      code: 'GOAL_FIGURES_MISSING_CURRENT_LEVEL', severity: 'warning',
      message: "Not shown. MRR's current level is missing.", option_ids: ['keep_pricing_as_it_is'],
      detail: { reason: 'missing_goal_baseline' },
    });
    const b = await turn(run('Review the recorded assumptions.'), 'Run it');
    expect(composeInput?.chanceCells?.filter(cell => cell.kind === 'figure')).toHaveLength(shown);
    expect(composeInput?.chanceCells?.filter(cell => cell.kind === 'withheld')).toHaveLength(1);
    const prefix = shown === 1 ? 'This chance uses' : 'These chances use';
    const otherPrefix = shown === 1 ? 'These chances use' : 'This chance uses';
    expect(b.assistant_text).toContain(prefix);
    expect(b.assistant_text).not.toContain(otherPrefix);
    expect(count(b.assistant_text, "doesn't project")).toBe(1);
    expect(withholdMarkers(b)).toEqual(["Not shown: MRR's current level is missing"]);
    expect(faceUnits(b)).toContain(HORIZON_MARKER);
    await expectStoredAndReplayed(b);
  });

  it('SCOPE: ordinary converse keeps its lead and three bullets visible without draft or Run contract', async () => {
    oneChance();
    const text = 'The main risks are clear.\n- Churn could rise.\n- Adoption could lag.\n- Support costs could grow.';
    const b = await turn([say(text)], 'What are the main risks?');
    expect(b._agent.tool_calls).toEqual([]);
    expect(composeInput?.faceContract).toBeUndefined();
    expect(b.assistant_text.startsWith(text)).toBe(true);
    expect(b._answer_shape).toBeUndefined();
  });

  it('B1 Paul Run: marker beside chance, exact full horizon in detail once, with one next step', async () => {
    const line = oneChance();
    const horizon = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach £20,000 within 12 months.";
    const next = 'What evidence should we check next?';
    const b = await turn(run(`Your comparison is ready. ${next}`), 'Run it');
    expect(composeInput?.faceContract).toBe('run');
    const units = [b._answer_shape!.headline, ...b._answer_shape!.bullets];
    expectHorizonMarker(b, line.chance, horizon);
    expect(units.at(-1)).toBe(next);
    expect(count(b.assistant_text, horizon)).toBe(1);
    expect(count(b.assistant_text, "doesn't project")).toBe(1);
    await expectStoredAndReplayed(b);
  });

  it.each(['by Q3', 'no deadline'] as const)('B3 %s: horizon marker beside chance, short full sentence once in detail', async deadline => {
    const line = oneChance({ goal_horizon_months: undefined, ...(deadline === 'by Q3' ? { goal_deadline_as_stated: 'by Q3' } : {}) });
    const horizon = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet.";
    const b = await turn(run('Review the recorded assumptions.'), 'Run it');
    expectHorizonMarker(b, line.chance, horizon);
    expect(count(b.assistant_text, horizon)).toBe(1);
  });

  it('no target + months: marker beside chance, exact no-target horizon in detail once', async () => {
    const line = oneChance({ goal_threshold_raw: undefined, goal_threshold: undefined, goal_threshold_cap: undefined });
    const horizon = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll get there within 12 months.";
    const b = await turn(run('Review the recorded assumptions.'), 'Run it');
    expectHorizonMarker(b, line.chance, horizon);
    expect(count(b.assistant_text, horizon)).toBe(1);
  });

  it('hiring Run: horizon carries its own target words rather than pricing assumptions', async () => {
    const line = oneChance({ label: 'Hire engineers', goal_threshold_raw: 6, goal_threshold_unit: 'engineers', goal_horizon_months: 9 });
    const horizon = "This chance uses the model's numbers as they are today; the model doesn't project how they change over time yet, so it can't say whether you'll reach 6 engineers within 9 months.";
    const b = await turn(run('Review the recorded assumptions.'), 'Run it');
    expectHorizonMarker(b, line.chance, horizon);
    expect(count(b.assistant_text, horizon)).toBe(1);
  });

  it('share_by_date Run: event-by-date chances model time and carry no horizon clause anywhere', async () => {
    oneChance();
    const deadline = '2027-04-07', unit = '% of launch';
    const team = teamShareMoments(6, 6, 10), extra = extraShareMoments(0.1, 6, 3, 5);
    // The existing Science S2a graph: a held share sum with its real time/lead-time moments and fixed date.
    READ.graph = { nodes: [
      { id: 'launch_share', kind: 'goal', label: 'Launch share', goal_horizon: { deadline }, goal_horizon_months: 12,
        goal_threshold_frame: 'level', goal_threshold: 1, goal_threshold_raw: 100, goal_threshold_cap: 100,
        goal_threshold_unit: unit, goal_direction: '>=' },
      { id: 'team_share', kind: 'factor', category: 'observable', label: 'Team launch share', observed_state: {
        value: team.mean, std: team.sd, unit, cap: 100, source: 'user_override',
        stated_time: { quantity: 'months_to_finish', low: 6, high: 10, unit: 'months', deadline, reference_date: '2026-10-07' } } },
      { id: 'two_devs', kind: 'factor', category: 'controllable', label: 'Two developers', observed_state: {
        value: 0, source: 'cee_inference', extra_share_by_date: { monthly_share: 10, lead_low: 3, lead_high: 5,
          unit: `${unit} per month`, deadline, reference_date: '2026-10-07' } } },
      { id: 'launch_decision', kind: 'decision', label: 'How to launch on time' },
      { id: 'status_quo', kind: 'option', label: 'Carry on', is_baseline: true, interventions: { two_devs: { value: 0 } } },
      { id: 'hire', kind: 'option', label: 'Two developers', interventions: { two_devs: { value: 1 } } },
    ], edges: [
      { from: 'team_share', to: 'launch_share', exists_probability: 0.8, strength: { mean: 1, std: 0.1 }, effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis', definitional: true, natural_effect: {
          amount: 1, amount_unit: unit, per_source_change: 1, per_source_change_unit: unit,
          strength_mean: 1, strength_mean_frame: 'edge_strength' } } },
      { from: 'two_devs', to: 'launch_share', exists_probability: 1, strength: { mean: extra.mean, std: extra.sd }, effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', natural_effect: {
          amount: 20, amount_unit: unit, per_source_change: 1, per_source_change_unit: 'switch',
          strength_mean: extra.mean, strength_mean_frame: 'edge_strength' } } },
      ...['status_quo', 'hire'].flatMap(id => [
        { from: 'launch_decision', to: id, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
        { from: id, to: 'two_devs', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      ]),
    ] };
    analysisResult.enrichment.inference_warnings = [{ code: 'GOAL_CHANCE_LICENSED', form: 'each', severity: 'info',
      message: 'Each option’s chance is licensed.', option_ids: ['status_quo', 'hire'], pct_by_option: { status_quo: 2, hire: 39 },
      target: { comparator: 'at_least', value: 100, unit, by_date: deadline } }];
    expect(goalKindOf(READ.graph)).toBe('share_by_date');
    const lines = goalChanceScreenLinesForAgent(analysisResult, READ.graph, true);
    expect(lines).toHaveLength(2);
    const b = await turn(run('Review the recorded assumptions.'), 'Run it');
    expect(composeInput?.faceContract).toBe('run');
    expect(composeInput?.horizonLine).toBeUndefined();
    expect(b.assistant_text).not.toContain("uses the model's numbers as they are today");
    expect(b.assistant_text).not.toContain("use the model's numbers as they are today");
    expect(b.assistant_text).not.toContain("doesn't project");
    const face = [b._answer_shape!.headline, ...b._answer_shape!.bullets].join('\n');
    for (const line of lines) expect(face).toContain(line.chance);
  });

  it('two chances: plural horizon once across the whole reply even when the narrator echoes its singular fact', async () => {
    oneChance();
    const licence = analysisResult.enrichment.inference_warnings[0];
    licence.option_ids.push('keep_pricing_as_it_is');
    licence.pct_by_option.keep_pricing_as_it_is = 20;
    const singular = untestedHorizonLine(READ.graph)!;
    const plural = untestedHorizonLine(READ.graph, { besideChance: true, plural: true })!;
    const b = await turn(run(`Review the recorded assumptions.\n\n${singular}`), 'Run it');
    const lines = goalChanceScreenLinesForAgent(analysisResult, READ.graph, true);
    expectHorizonMarker(b, lines.at(-1)!.chance, plural);
    expect(count(b.assistant_text, plural)).toBe(1);
    expect(count(b.assistant_text, "doesn't project")).toBe(1);
  });

  it('W current licensed Run: same selected result and graph; face order chance, horizon marker, W, E', async () => {
    const line = oneChance({ goal_horizon_months: undefined }, true);
    const expected = whatChangesFaceLine(analysisResult, READ.graph);
    expect(expected).not.toBeNull();
    const b = await turn(run('Review the recorded assumptions.'), 'Run it');
    const units = [b._answer_shape!.headline, ...b._answer_shape!.bullets];
    const screen = goalChanceScreenLinesForAgent(analysisResult, READ.graph, true);
    expect(screen, 'W uses the same selected result and producer finding').toEqual([line]);
    const findingUnits = screen.map(finding => [finding.chance, finding.depends].filter(Boolean).join(' '));
    expect(units.slice(0, findingUnits.length), 'every exact chance plus its typed dependency precedes the marker').toEqual(findingUnits);
    const horizon = untestedHorizonLine(READ.graph, { besideChance: true, plural: screen.length > 1 })!;
    expect(composeInput?.whatChanges).toBe(expected);
    expectHorizonMarker(b, findingUnits.at(-1)!, horizon);
    expect(units[units.indexOf(HORIZON_MARKER) + 1]).toBe(expected);
    const e = units.findIndex(unit => unit.startsWith("Olumi's estimates:"));
    if (e >= 0) expect(e).toBeGreaterThan(units.indexOf(expected!));
  });

  it('W stale selected Run: no W despite a licensed result', async () => {
    oneChance({ goal_horizon_months: undefined }, true);
    expect(whatChangesFaceLine(analysisResult, READ.graph)).not.toBeNull();
    READ.analysis_state.run_state.kind = 'complete_stale';
    const b = await turn([], 'Run it', { chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } });
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
    const cleaned = withScreenLinesOwed(narration, [line]);
    expect(cleaned.added).toBe(0);
    expect(cleaned.text).not.toContain('99 links');
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

  it('RED at base: a Run reply with no range figure ends up saying the screen’s line, once', async () => {
    const b = await turn(run('The analysis ran, but it cannot put an option forward yet.'), 'Run it');
    expect(b._agent.tool_calls.map((c) => c.name)).toContain('run_analysis');
    expect(count(b.assistant_text, SCREEN[0]!), b.assistant_text).toBe(1);
  });

  it.each(['live', 'replay'] as const)('RANGE WINS B2 %s: the assistant says the range without the contradictory guided sentence', async mode => {
    READ = structuredClone(READ_B3);
    READ.graph = structuredClone(RANGE_WINS_B2.graph);
    analysisResult = structuredClone(RANGE_WINS_B2.run);
    const body = await turn(run('The analysis ran.'), 'Run it');
    const assertB2 = (text: string): void => {
      expect(text).toContain('‘Launch starter tier’: between about 5% and 37% chance of meeting your goal, in this model.');
      expect(text).not.toContain("The chance isn't shown yet");
    };
    assertB2(body.assistant_text);
    if (mode === 'replay') {
      const saved = [...rows.values()].find(r => r.assistant_message === body.assistant_text)!;
      const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
        kind: 'message', scenario_id: SCENARIO, message: 'Run it', turn_id: saved.turn_id,
      } });
      expect(response.statusCode, response.body).toBe(200);
      expect(response.json()._agent.replayed).toBe(true);
      assertB2(response.json().assistant_text);
    }
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

  it('POINTS, RED at base (B5 T1b readback): a Run reply whose figures are gone ends up with the screen’s three lines, once each', async () => {
    useT1b();
    expect(READ.analysis_state.leader_claim.permitted).toBe(false);
    expect(SCREEN_T1B).toHaveLength(3);
    expect(count(SCREEN_T1B[0]!, SIZE_QUESTION)).toBe(1);
    expect(count(SCREEN_T1B[1]!, SIZE_QUESTION)).toBe(1);
    const b = await turn(run('No single option can be put forward: the comparison is a near tie.\n\nFor reaching at least £126,000 monthly recurring revenue, on current information:'), 'Run it');
    for (const line of SCREEN_T1B_SAID_ONCE) expect(count(b.assistant_text, line), b.assistant_text).toBe(1);
    expect(count(b.assistant_text, SIZE_QUESTION), b.assistant_text).toBe(1);
    expectMandatoryFindings(b);
    await expectStoredAndReplayed(b);
    // B15 (#2783, DL): the lead-in opens the headline and is directly followed by the first screen chance finding; it
    // still introduces the list and never ends the reply on a colon.
    const lead = 'For reaching at least £126,000 monthly recurring revenue, on current information:';
    expect(b._answer_shape!.headline).toBe(SCREEN_T1B[0]!);
    expect(b._answer_shape!.detail).toContain(lead);
    expect(count(b.assistant_text, lead)).toBe(1);
    expect(b.assistant_text.trimEnd().endsWith(':'), 'never ends on a colon').toBe(false);
  });

  it('POINTS through the REAL leader gate: the Agent writes the screen’s lines, the gate deletes them, and the user still reads each once', async () => {
    useT1b();
    const b = await turn(run(`For reaching at least £126,000 monthly recurring revenue, on current information:\n\n${SCREEN_T1B.join(' ')}`), 'Run it');
    for (const line of SCREEN_T1B_SAID_ONCE) expect(count(b.assistant_text, line), b.assistant_text).toBe(1);
    expect(count(b.assistant_text, SIZE_QUESTION), b.assistant_text).toBe(1);
    expectMandatoryFindings(b);
    expect(b._answer_shape!.headline, 'the first chance+depends unit keeps its question and still leads').toBe(SCREEN_T1B[0]!);
  });

  it('B19 r3: a completed reply preserves Agent chance phrasing and keeps the appended canonical unit on the face', async () => {
    const line = shortfallScreenLine();
    const phrased = 'Raise prices 10%: about 55%.';
    const reply = `Analysis is ready. Review the evidence. Check the assumptions. ${phrased} Keep unresolved disagreements visible in the model for the team’s next review and keep the conversation grounded in evidence.`;
    const completed = withScreenLinesOwed(reply, [line]);
    expect(completed.added, 'the control: the route owes the complete canonical line').toBe(1);
    expect(completed.text.trim().split(/\s+/).length, 'the reply really crosses the composer boundary').toBeGreaterThanOrEqual(80);
    expect(completed.text).toBe(`${reply}\n\n${line.chance}`);
    const b = await turn(run(reply), 'Run it');
    expect(b._agent.tool_calls.map((c) => c.name)).toContain('run_analysis');
    expect(callModelOutputs, 'the control: the scripted Agent phrasing was consumed').toEqual([]);
    expect(b._answer_shape, 'the control: the reply really passes the face/detail split').toBeDefined();
    const face = [b._answer_shape!.headline, ...b._answer_shape!.bullets].join(' ');
    for (const note of [line.spread_note!, line.shortfall_note!]) {
      expect(count(b.assistant_text, note), b.assistant_text).toBe(1);
      expect(face, 'each licensed note is evidence on the face').toContain(note);
      expect(b._answer_shape!.detail).not.toContain(note);
    }
    expect(b.assistant_text).toContain(phrased);
    expect(count(b.assistant_text, line.chance)).toBe(1);
    expect(face).toContain(line.chance);
  });

  it('B19 r1 CONTROL: a canonical chance already carrying spread and shortfall keeps both notes on the face once', async () => {
    const line = shortfallScreenLine();
    const reply = `Analysis is ready. Review the evidence. Check the assumptions. ${line.chance} Keep unresolved disagreements visible in the model for the team’s next review and keep the conversation grounded in evidence.`;
    expect(withScreenLinesOwed(reply, [line]), 'the positive control: the complete unit is already present').toEqual({ text: reply, added: 0 });
    const b = await turn(run(reply), 'Run it');
    expect(callModelOutputs, 'the control: the scripted canonical chance was consumed').toEqual([]);
    expect(b._answer_shape).toBeDefined();
    const face = [b._answer_shape!.headline, ...b._answer_shape!.bullets].join(' ');
    expect(face).toContain(line.chance);
    for (const note of [line.spread_note!, line.shortfall_note!]) {
      expect(count(b.assistant_text, note), b.assistant_text).toBe(1);
      expect(b._answer_shape!.detail).not.toContain(note);
    }
  });

  it('CONTROL: a turn that ran nothing adds nothing', async () => {
    const b = await turn([say('Happy to help with the next step.')], 'Thanks');
    expect(b._agent.tool_calls.map((c) => c.name)).not.toContain('run_analysis');
    expect(b.assistant_text).not.toContain('between about');
  });
});
