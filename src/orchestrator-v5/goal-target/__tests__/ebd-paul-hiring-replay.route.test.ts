/**
 * ⭐ EBD — PAUL'S HIRING CONVERSATION (staging, 12 Oct 2026, scenario 4184e877), REPLAYED THROUGH THE REAL AGENT ROUTE.
 *
 * Paul's words are copied VERBATIM from `v5_conversation_turns` (SELECT-only read, 12 Oct). On served c85817f2 the brief
 * became the deadline ("event by date") model, and then:
 *   · the Run was blocked on "What is "Share today's team finishes by the deadline" today, before any option changes it?
 *     Without a current level the analysis would treat it as zero." — a question this model must never ask (E1);
 *   · "…our launch deadline in six months time" was refused `deadline_not_placed` twice (E3);
 *   · "…a month late … (so, 7 months), but I have low confidence…" was refused `team_time_not_stated` (E2);
 *   · no event-model scenario has ever reached a Run.
 *
 * THE PATH: the REAL `agentV1TurnRoute` (Fastify inject) → the REAL capabilities → the REAL atomic batch writer
 * (`commitOptionLevelsInProcess`) over a stateful session-store double; the scenario graph read is a local stub serving
 * the stored graph with the REAL analysis hash and the REAL canonical readiness (`buildCanonicalAnalysisReadyFromGraph`).
 * OpenAI is scripted at `fetch` (0 provider calls; the drafter output is the event candidate the served drafter wrote:
 * 3 options, Olumi's pace 12% / 20% a month and hiring lead 2–4 months). The Run is the REAL `run_analysis` handler over
 * the stored graph, PLoT faked at the transport: each option's goal probability is the normal approximation CEE's own
 * share gate models (`event-by-date-share.ts` `normalChance`), never a figure this file chooses.
 *
 * Paul's hiring lead times ("a tech lead would take at least 3 months…") are E5 (SYS1's start-time door) and are not
 * replayed here: Olumi's own labelled hiring estimates stand until that card is approved.
 */
import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance } from 'fastify';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Providers forbidden in the EBD replay'); },
  getAdapterWithResolution: () => { throw new Error('Providers forbidden in the EBD replay'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { constructionOperationId } from '../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { approvalChipIdFor } from '../../agent-lane/approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { assessRouteAdmission } from '../../../cee/graph-readiness/canonical-readiness.js';
import { decisionInputAsk } from '../../agent-lane/decision-input-ask.js';
import { draftedTeamPartOf } from '../event-by-date-model.js';
import { chanceGoalDeadlineAsk } from '../goal-kind.js';
import { shareChanceRunBlock, sharePartsForOption } from '../share-by-date-run.js';
import { normalChance } from '../event-by-date-share.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

type Rec = Record<string, any>;
/** Paul's turns, verbatim (v5_conversation_turns, scenario 4184e877, 12 Oct 2026 08:41–09:14Z). */
const PAUL = {
  brief: 'We need to decide whether to hire a Tech lead or two developers to boost productivity and meet our next feature-launch deadline.',
  needs: 'Suggest what this model still needs before the analysis can run, so I can approve it.',
  deadline: "If we don't increase our developer's output by 25%, in the next three months, we're unlikely to hit our launch deadline in six months time",
  teamTime: "The team are currently telling me they're going to be a month late delivering the next feature (so, 7 months), but I have low confidence in this because they keep missing deadlines.",
  hiring: "What hiring estimate would you give for a tech lead versus two developers? I would think, but I'm not sure, that a tech lead would take at least 3 months to get in the door. With two developers, we might be able to get one in within 2 months and then another a month or so later, as an estimate to use.",
} as const;
/** The deadline phrase the Agent quoted on served turn 3 (UNVERIFIED on the wire: redacted in the logs; the door binds it to the turn). */
const DEADLINE_WORDS = 'launch deadline in six months time';
/** What Paul's team-time sentence says the team's time is, as the Agent reads it: one figure. */
const TEAM_QUOTE = "they're going to be a month late delivering the next feature (so, 7 months), but I have low confidence in this because they keep missing deadlines.";
const DRAFTED_AT = '2026-10-12T08:41:24.992Z';
const NOW = new Date('2026-10-12T09:14:24.374Z');
const LEVEL_ASK = /before any option changes it|treat it as zero/;

/** The event candidate (served shape: 3 options, Olumi's pace and lead time, empty ordinary collections for the slice). */
const candidate = () => ({
  goal: { kind: 'event_by_date', deliverable: 'next feature launch', metric: 'Next feature launch', operator: '>=', unit: '% of next feature launch',
    value: null, target_stated: false, frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred',
    horizon_months: null, provenance: 'inferred', scope: null },
  options: [
    { label: 'Hire a Tech lead', provenance: 'explicit', changes: [], interventions: [], is_status_quo: null,
      added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Hire two developers', provenance: 'explicit', changes: [], interventions: [], is_status_quo: null,
      added_capacity: { monthly_share_pct: 20, lead_months_low: 2, lead_months_high: 4 } },
    { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], is_status_quo: true, added_capacity: null },
  ],
  factors: [], risks: [], outcomes: [], links: [], constraints: [], identities: [], unknowns: [],
  decision_question: 'We need to decide whether to hire a Tech lead or two developers to boost productivity and meet our next feature-launch deadline.',
});
const say = (text: string) => ({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });
const call = (name: string, args: Rec) => ({ output: [{ type: 'function_call', name, call_id: `call_${name}_${randomUUID().slice(0, 8)}`, arguments: JSON.stringify(args) }] });

const hash = (g: Rec) => computeAnalysisAffectingGraphHash(g as never)!;
function world() {
  const sid = randomUUID();
  let bytes: string | null = null;
  const read = (): Rec => (bytes === null ? { nodes: [], edges: [] } : JSON.parse(bytes));
  const rows: SessionTurnWithContent[] = [];
  const writes: Rec[] = [];
  const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const store = createMockSessionStore({
    loadGraph: async () => (bytes === null ? null : read()), loadGraphAndBriefText: async () => ({ graph: bytes === null ? null : read(), briefText: bytes === null ? null : PAUL.brief }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readCommittedTurn: async (_sid, id) => { const r = rows.find(x => x.turn_id === id); return r ? { id: r.id, request_hash: r.request_hash,
      user_message: r.user_message ?? null, assistant_message: r.assistant_message ?? null, llm_calls_used: r.llm_calls_used, pending_actions: (r as Rec).pending_actions ?? [] } : null; },
    readMostRecentPendingActions: async (_sid, opts) => { opts?.onLatestRowId?.(latest()?.id ?? null); return (latest() as Rec)?.pending_actions ?? []; },
    readRecent: async () => rows.filter(r => !r.turn_id.endsWith(':claim')),
    readFactsWithTurnFor: async ids => rows.flatMap(r => ids.includes(r.id) ? (writes.find(w => w.turn_id === r.turn_id)?.handler_facts ?? [])
      .map((fact: Rec) => ({ turn_id: r.id, fact_created_at: r.created_at, fact })) : []),
    append: async write => {
      writes.push(write);
      if (write.graph !== undefined && write.graph !== null) bytes = JSON.stringify(write.graph);
      const id = randomUUID(); rows.unshift({ ...makeSessionTurnRow({ id, scenario_id: sid, turn_id: write.turn_id, request_hash: write.request_hash,
        turn_class: write.turn_class, handler_id: write.handler_id, response_emitted: write.response_emitted, created_at: new Date().toISOString(),
        user_message: write.userMessage ?? null, assistant_message: write.assistantMessage ?? null }), pending_actions: write.pending_actions ?? [] } as SessionTurnWithContent);
      return { id };
    },
  });
  live.store = store;
  const graphWire = () => bytes === null ? { graph: null, graph_hash: null } : { graph: read(), graph_hash: hash(read()), brief_text: PAUL.brief,
    scenario_created_at: DRAFTED_AT, analysis_ready: buildCanonicalAnalysisReadyFromGraph(read()) };
  const versions = () => ({ versions: bytes === null ? [] : [{ version_id: 'draft-v1', sequence: 1, created_at: DRAFTED_AT,
    creation: { kind: 'initial', source_turn_id: registrationTurnId(sid, constructionOperationId(sid, PAUL.brief)) } }] });
  const register = (graph: Rec) => { bytes = JSON.stringify(graph); };
  return { sid, store, rows, read, graphWire, versions, register };
}

/** One queue of scripted Agent outputs per turn; structured calls (drafter, widening, brief reading) are answered by kind. */
let agentScript: Rec[] = [];
const providerCalls: string[] = [];
const apps: FastifyInstance[] = [];
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }); agentScript = []; providerCalls.length = 0; });
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
async function route(w: ReturnType<typeof world>) {
  vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
  vi.stubGlobal('fetch', vi.fn(async (url: unknown, init?: { body?: string }) => {
    if (!String(url).includes('openai')) throw new Error(`Network forbidden: ${String(url)}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as Rec;
    const format = body.text?.format;
    if (format?.name === 'brief_spans') { providerCalls.push('brief_spans');
      return new Response(JSON.stringify(say(JSON.stringify({ goal: 'next feature-launch deadline', options: ['hire a Tech lead', 'two developers'], limits: [], build: true }))), { status: 200 }); }
    if (format?.type === 'json_schema') {
      if (String(body.instructions).includes("This is Olumi's own check of a first draft")) { providerCalls.push('widening');
        return new Response(JSON.stringify(say(JSON.stringify({ risk_suggestions: [] }))), { status: 200 }); }
      providerCalls.push('drafter');
      return new Response(JSON.stringify(say(JSON.stringify(candidate()))), { status: 200 });
    }
    providerCalls.push('agent');
    return new Response(JSON.stringify(agentScript.shift() ?? say('Done.')), { status: 200 });
  }));
  const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
  const app = Fastify({ logger: false }); apps.push(app);
  app.post('/assist/v1/scenarios/:id/graph', async () => w.graphWire());
  app.post('/assist/v1/scenarios/:id/versions', async () => w.versions());
  app.post('/assist/v1/scenarios/:id/graph/register', async (req) => {
    w.register((req.body as Rec).graph);
    return { registered: true, graph_hash: hash(w.read()), model_version: { version_number: 1 } };
  });
  await app.register(agentV1TurnRoute); await app.ready();
  return async (over: Rec, script: Rec[] = []): Promise<Rec> => {
    agentScript = [...script];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', turn_id: randomUUID(), scenario_id: w.sid, ...over } });
    expect(r.statusCode, r.body.slice(0, 2000)).toBe(200);
    return r.json() as Rec;
  };
}
const approve = (body: Rec, proposalId: string): Rec => {
  const yes = body.suggested_actions.find((c: Rec) => c.id === approvalChipIdFor(proposalId));
  expect(yes, JSON.stringify(body.suggested_actions)).toBeDefined();
  return { message: yes.message, source: 'chip_click', chip: { id: yes.id }, agent_session_id: body._agent.session_id };
};
const proposed = (body: Rec, tool: string): Rec => {
  const calls = body._agent.tool_calls.filter((c: Rec) => c.name === tool);
  expect(calls, JSON.stringify(body._agent.tool_calls)).toHaveLength(1);
  expect(calls[0], JSON.stringify(calls[0])).toMatchObject({ ok: true });
  return calls[0];
};
const cardOf = (body: Rec, proposalId: string): string => body.suggested_actions.find((c: Rec) => c.id === approvalChipIdFor(proposalId))?.detail;
/** Every question the readiness authority puts to the user, as the turn's own readback carries it. */
const readinessAsks = (analysisReady: Rec | undefined): string[] => [
  ...(analysisReady?.blockers ?? []).map((b: Rec) => b.message),
  ...(analysisReady?.readiness_issues ?? []).map((i: Rec) => i.message),
].filter((m: unknown): m is string => typeof m === 'string');
const askContext = { builtOrRan: true, awaitingApproval: false, restingText: '', questionsToggle: false, recentReplies: [] };

/** ONE VOICE: the Run path, the readiness route and the coach put the SAME question while the team part has no level. */
function expectOneVoice(graph: Rec, label: string): string {
  const coach = decisionInputAsk(graph, askContext);
  expect(coach, `${label}: the coach's question`).not.toBeNull();
  const run = resolveRunAdmission(graph);
  const routeVerdict = assessRouteAdmission(graph);
  const team = draftedTeamPartOf(graph)!.team.id;
  const runAsk = run.assessment.blockingIssues.filter(i => i.factor_id === team).map(i => i.message);
  const routeAsk = (routeVerdict.readiness_issues ?? []).filter((i: Rec) => i.factor_id === team).map((i: Rec) => i.message);
  expect(runAsk, `${label}: the Run's blocker`).toEqual([coach]);
  expect(routeAsk, `${label}: graph-readiness`).toEqual([coach]);
  expect(run.willProceed).toBe(false);
  expect(routeVerdict.can_run_analysis).toBe(false);
  return coach!;
}

/** The REAL Run producer over the stored graph; PLoT faked with CEE's own normal approximation of each option's share. */
async function runOn(w: ReturnType<typeof world>): Promise<Rec> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(w.sid, 'ebd-run-load', w.store as never);
  const graph = w.read();
  const options = graph.nodes.filter((n: Rec) => n.kind === 'option');
  const run = vi.fn(async () => ({
    option_comparison: options.map((o: Rec) => {
      const parts = sharePartsForOption(graph, o.id);
      if (parts === null) throw new Error(`no share parts for ${o.id}`);
      return { id: o.id, option_id: o.id, label: o.label, option_label: o.label, status: 'computed',
        outcome: { mean: 0.8, p10: 0.6, p50: 0.8, p90: 1, std: 0.1, n_samples: 10000, n_valid_samples: 10000, validity_ratio: 1, percentiles_source: 'samples' },
        win_probability: 1 / options.length, probability_of_goal: normalChance(parts, 1) };
    }),
    option_comparison_status: 'computed', analysis_status: 'completed', inference_warnings: [], factor_sensitivity: [],
    conditional_probabilities: [], edge_e_values: [],
  }) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: w.sid, request_id: 'ebd-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: PAUL.brief, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-ebd-run', scenario_id: w.sid, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'ebd-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return fact.result as Rec;
}

describe("EBD: Paul's hiring conversation reaches a labelled chance per option by his 3rd typed turn", () => {
  it('brief → deadline → team time (Paul\'s own words): one question at a time, no "% today", then a chance per option', async () => {
    const w = world(), turn = await route(w);
    const seen: Rec[] = [];

    // ── Typed turn 1: the brief. Construction builds the deadline model; the one question is the deadline.
    const t1 = await turn({ message: PAUL.brief }, [call('build_model_from_brief', { brief: PAUL.brief }), say('I have set up the comparison.')]);
    seen.push(t1);
    expect(t1._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', ok: true }));
    expect(draftedTeamPartOf(w.read()), 'the deadline model was built').not.toBeNull();
    const ask1 = expectOneVoice(w.read(), 'after the brief');
    expect(ask1).toBe(chanceGoalDeadlineAsk('next feature launch'));
    expect(readinessAsks(t1.analysis_ready).filter(m => !m.startsWith('Review'))).toContain(ask1);

    // ── Typed turn 2: Paul's deadline sentence (served turn 3, refused twice). The quoted phrase is placed on the calendar.
    const t2 = await turn({ message: PAUL.deadline, agent_session_id: t1._agent.session_id },
      [call('propose_goal_deadline', { deadline_words: DEADLINE_WORDS, rationale: PAUL.deadline }), say('Please confirm the date.')]);
    seen.push(t2);
    const deadline = proposed(t2, 'propose_goal_deadline');
    expect(cardOf(t2, deadline.proposal_id)).toBe('Is your deadline 12 April 2027 (6 months from 12 October 2026)?');
    const t2yes = await turn(approve(t2, deadline.proposal_id));
    seen.push(t2yes);
    expect(t2yes._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    expect(draftedTeamPartOf(w.read())!.goal.goal_horizon).toEqual({ deadline: '2027-04-12' });
    const ask2 = expectOneVoice(w.read(), 'after the deadline');
    expect(ask2).toBe('How long would next feature launch take with the team you have now?');
    expect(readinessAsks(t2yes.analysis_ready)).toContain(ask2);

    // ── Typed turn 3: Paul's team-time sentence (served turn 13, refused). ONE card: his 7 months + Olumi's labelled range.
    const t3 = await turn({ message: PAUL.teamTime, agent_session_id: t2yes._agent.session_id },
      [call('propose_team_time', { quote: TEAM_QUOTE, low_months: 7, high_months: 7 }), say('Please confirm.')]);
    seen.push(t3);
    const team = proposed(t3, 'propose_team_time');
    const card = cardOf(t3, team.proposal_id);
    expect(card).toContain('7 months');
    expect(card).toContain('7–10.5 months');
    expect(card).toMatch(/Olumi/);
    const t3yes = await turn(approve(t3, team.proposal_id));
    seen.push(t3yes);
    expect(t3yes._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    const held = w.read(), part = draftedTeamPartOf(held)!;
    expect(part.team.observed_state).toMatchObject({ stated_time: { quantity: 'months_to_finish', low: 7, high: 10.5, most_likely: 7 } });
    expect(Number.isFinite(part.team.observed_state.value)).toBe(true);

    // ONE readiness authority: the Run, the readiness route and the turn's readback all say ready; the coach asks nothing.
    expect(resolveRunAdmission(held).willProceed).toBe(true);
    expect(assessRouteAdmission(held).can_run_analysis).toBe(true);
    expect(t3yes.analysis_ready?.status).toBe('ready');
    expect(decisionInputAsk(held, askContext)).toBeNull();
    expect(shareChanceRunBlock(held)).toBeNull();

    // No "% today" question ever reached the user, on any surface of any turn.
    for (const body of seen) expect(JSON.stringify(body)).not.toMatch(LEVEL_ASK);

    // ── Run (the Run click): a chance per option, each labelled with what rests on Olumi's estimates.
    const result = await runOn(w);
    const lines = goalChanceScreenLinesForAgent(result, held, true);
    expect(lines.map(l => l.option_id).sort()).toEqual(['event_option_1', 'event_option_2', 'event_option_3']);
    for (const l of lines) {
      expect(l.chance).toContain('chance of launching by 12 April 2027, in this model');
      expect(l.chance, l.chance).toContain("Olumi's range from your 7 months (7–10.5 months)");
    }
    for (const id of ['event_option_1', 'event_option_2']) {
      expect(lines.find(l => l.option_id === id)!.chance).toContain("Olumi's estimates of hiring time (2–4 months)");
    }
    expect(providerCalls.filter(c => c !== 'agent' && c !== 'drafter' && c !== 'widening' && c !== 'brief_spans')).toEqual([]);
  });
});
