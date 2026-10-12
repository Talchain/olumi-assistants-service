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
 * the stored graph. ⭐ DL (b1)(3), 12 Oct: PLoT answers with the REAL ENGINE's response to this exact request (staging PLoT
 * 6ec01e8 + ISL, posted 2026-10-12T11:49:51Z, `recovery/score/EBD-REAL-ENGINE.md`; fixture sha256 2b9d1b3c…), served only
 * when CEE's request is byte-for-byte the one that was posted (sha256 7ea1f711…). CEE's own approximation (`normalChance`)
 * is never the evidence: the engine gives no `probability_of_goal` at threshold 1, and each chance is read off the goal's own
 * constraint (`goal-own-constraint-chance.ts`).
 *
 * Paul's hiring lead times ("a tech lead would take at least 3 months…") are E5 (SYS1's start-time door) and are not
 * replayed here: Olumi's own labelled hiring estimates stand until that card is approved.
 *
 * ⛔ WHAT THIS IS NOT (PL 6122519782, AIE 6122738619). The first `it` is a SHORTENED fixture: four typed inputs (brief, deadline
 * sentence, Paul's team-time sentence, which the base door refuses, then a range he types: E delta, 12 Oct) plus two approvals
 * and a Run, with his late team forecast moved to typed turn 3 and his E5 hiring timings left out. It is a transport check of CEE's doors and words, not the original transcript (see the full-transcript
 * `it`), not the real numerical engine, and not proof of usable chances.
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
import { goalChanceNotesForAgent, goalChanceScreenLinesForAgent } from '../../agent-lane/goal-chance-screen-lines.js';
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
/**
 * ⭐ RECOVERY BATCH E delta (DL, 12 Oct; independent check FAIL 3c7d1a71, E2 BLOCKING): the quote-bound team-time reader is
 * removed again, so the base door reads only a time THIS message states, and Paul's sentence is refused. The team time then
 * reaches the model the base way: the user types a range. NOT Paul's words: the range the base team-time specs use.
 */
const TEAM_RANGE = 'It’ll take 6–10 months';
/** The base team-time card for the user's own range (its words, as served on the base door). */
const TEAM_RANGE_CARD = 'Use 6–10 months for today\'s team? By 12 April 2027 that is about 77% of next feature launch.';
/** What the base writer holds for the user's own 6–10 months: their range, no forecast, no Olumi range. */
const TEAM_RANGE_HELD: Rec = { quantity: 'months_to_finish', unit: 'months', low: 6, high: 10, deadline: '2027-04-12', reference_date: '2026-10-12' };
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
function world(brief: string = PAUL.brief) {
  const sid = randomUUID();
  let bytes: string | null = null;
  const read = (): Rec => (bytes === null ? { nodes: [], edges: [] } : JSON.parse(bytes));
  const rows: SessionTurnWithContent[] = [];
  const writes: Rec[] = [];
  const latest = () => rows.find(r => !r.turn_id.endsWith(':claim'));
  const store = createMockSessionStore({
    loadGraph: async () => (bytes === null ? null : read()), loadGraphAndBriefText: async () => ({ graph: bytes === null ? null : read(), briefText: bytes === null ? null : brief }),
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
  const graphWire = () => bytes === null ? { graph: null, graph_hash: null } : { graph: read(), graph_hash: hash(read()), brief_text: brief,
    scenario_created_at: DRAFTED_AT, analysis_ready: buildCanonicalAnalysisReadyFromGraph(read()) };
  const versions = () => ({ versions: bytes === null ? [] : [{ version_id: 'draft-v1', sequence: 1, created_at: DRAFTED_AT,
    creation: { kind: 'initial', source_turn_id: registrationTurnId(sid, constructionOperationId(sid, brief)) } }] });
  const register = (graph: Rec) => { bytes = JSON.stringify(graph); };
  return { sid, store, rows, read, graphWire, versions, register };
}

/** One queue of scripted Agent outputs per turn; structured calls (drafter, widening, brief reading) are answered by kind. */
let agentScript: Rec[] = [];
/** The drafter's scripted output for this test (Paul's event candidate unless a row swaps it). */
let drafterOutput: () => Rec = () => candidate();
const providerCalls: string[] = [];
/** Every request body sent to the Agent model, in order: what the Agent was given to read (its context). */
const agentBodies: Rec[] = [];
const apps: FastifyInstance[] = [];
beforeEach(() => { vi.useFakeTimers({ now: NOW, toFake: ['Date'] }); agentScript = []; providerCalls.length = 0; agentBodies.length = 0; drafterOutput = () => candidate(); });
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
      return new Response(JSON.stringify(say(JSON.stringify(drafterOutput()))), { status: 200 });
    }
    providerCalls.push('agent');
    agentBodies.push(body);
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

/** How many times `ask` is said in one reply: its text (however the composer lays it out), and the questions toggle list. */
const oneLine = (s: string): string => s.replace(/\s+/g, ' ');
const timesSaid = (body: Rec, ask: string): number => oneLine(String(body.assistant_text ?? '')).split(oneLine(ask)).length - 1
  + (Array.isArray(body._agent?.open_questions) ? body._agent.open_questions.filter((q: unknown) => q === ask).length : 0);

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

/** The request CEE posted to staging PLoT for Paul's Run (`recovery/bB/ebd/paul-plot-capture/paul-plot-request.json`). */
/**
 * ⭐ E delta (DL, 12 Oct): the team time now reaches the model as the user's range (the base door), so what CEE sends
 * changed (only the team part: `fixtures/ebd-paul-plot-request-range-39748a8b.json` against the 7ea1f711… request). It was
 * posted ONCE to staging PLoT 6ec01e8 + ISL at 2026-10-12T18:38:47Z (HTTP 200, 0 provider calls; the recipe in
 * `recovery/score/EBD-REAL-ENGINE.md`; evidence `recovery/bE/delta/plot-range-capture/`). The 7ea1f711… recording is kept
 * (`goal-own-constraint-chance.test.ts` still reads it).
 */
const POSTED_REQUEST_SHA256 = '39748a8be38d08d9e5b721c4c9e7e9245226c321d0f922330de422cd2ac9e832';
const ENGINE_RESPONSE_BYTES = readFileSync(new URL('./fixtures/ebd-paul-real-engine-response-range-6ec01e8.json', import.meta.url));
const ENGINE_RESPONSE_SHA256 = '7d4639548621ab9e89b5c503c1f94d67fb678064f52a722bc4da9dd575e31dcc';
const sha256 = (b: string | Buffer): string => createHash('sha256').update(b).digest('hex');

/**
 * The REAL Run producer over the stored graph; PLoT answers with the real engine's response to this exact request.
 * `mutate` (a discriminating mutant only) edits the engine's answer, never the request it is bound to.
 */
async function runOn(w: ReturnType<typeof world>, mutate: (response: Rec) => Rec = r => r): Promise<{ result: Rec; request: unknown }> {
  const snapshot = await loadScenarioSnapshotForRunAnalysis(w.sid, 'ebd-run-load', w.store as never);
  expect(sha256(ENGINE_RESPONSE_BYTES), 'the real-engine response, as captured').toBe(ENGINE_RESPONSE_SHA256);
  const run = vi.fn(async (request: unknown) => {
    // The one capture route for a reviewed change to what is sent (§7.4): the request, exactly as hashed below.
    const capture = process.env.EBD_CAPTURE_REQUEST;
    if (capture !== undefined && capture !== '') (await import('node:fs')).writeFileSync(capture, JSON.stringify(request, null, 2));
    // A recording answers only the request it was recorded for: any change to what CEE sends invalidates it (§7.4).
    expect(sha256(JSON.stringify(request, null, 2)), 'CEE sends the request the engine answered').toBe(POSTED_REQUEST_SHA256);
    return mutate(JSON.parse(ENGINE_RESPONSE_BYTES.toString('utf8'))) as unknown as V2RunResponseEnvelope;
  });
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
  return { result: fact.result as Rec, request: (run.mock.calls[0] as unknown[] | undefined)?.[0] };
}

describe("EBD: Paul's hiring conversation reaches a labelled chance per option by his 4th typed turn", () => {
  it('brief → deadline → team time (his words refused, then a range he types): one question at a time, no "% today", then a chance per option', async () => {
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
    // E4 control: Paul's drafted event model set nothing aside, so no set-aside sentence.
    expect(JSON.stringify(t1)).not.toContain('set aside');

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

    // ── Typed turn 3: Paul's team-time sentence (served turn 13). E delta: the base door refuses it, writes nothing, and asks
    // for the soonest and latest times; the model still asks the same one question.
    const beforeRefusal = JSON.stringify(w.read());
    const t3 = await turn({ message: PAUL.teamTime, agent_session_id: t2yes._agent.session_id },
      [call('propose_team_time', { quote: TEAM_QUOTE, low_months: 7, high_months: 7 }), say('How long would it take at the soonest, and at the latest?')]);
    seen.push(t3);
    expect(t3._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_team_time', ok: false, mutated: false, refusal: 'team_time_not_stated' })]);
    expect(JSON.stringify(w.read()), 'the refusal wrote nothing').toBe(beforeRefusal);
    expect(expectOneVoice(w.read(), 'after the refused team time')).toBe(ask2);

    // ── Typed turn 4: the user gives a range (the base route). ONE card: the user's own range.
    const t4 = await turn({ message: TEAM_RANGE, agent_session_id: t3._agent.session_id },
      [call('propose_team_time', { low_months: 6, high_months: 10 }), say('Please confirm.')]);
    seen.push(t4);
    const team = proposed(t4, 'propose_team_time');
    expect(cardOf(t4, team.proposal_id)).toBe(TEAM_RANGE_CARD);
    const t4yes = await turn(approve(t4, team.proposal_id));
    seen.push(t4yes);
    expect(t4yes._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'authorise_change', ok: true, mutated: true }));
    const held = w.read(), part = draftedTeamPartOf(held)!;
    expect(part.team.observed_state.stated_time).toEqual(TEAM_RANGE_HELD);
    expect(Number.isFinite(part.team.observed_state.value)).toBe(true);

    // ONE readiness authority: the Run, the readiness route and the turn's readback all say ready; the coach asks nothing.
    expect(resolveRunAdmission(held).willProceed).toBe(true);
    expect(assessRouteAdmission(held).can_run_analysis).toBe(true);
    expect(t4yes.analysis_ready?.status).toBe('ready');
    expect(decisionInputAsk(held, askContext)).toBeNull();
    expect(shareChanceRunBlock(held)).toBeNull();

    // No "% today" question ever reached the user, on any surface of any turn.
    for (const body of seen) expect(JSON.stringify(body)).not.toMatch(LEVEL_ASK);
    // ⭐ EACH ASK ONCE PER REPLY (DL, 12 Oct: reply 1 said the deadline question 3×): every question the model asks on any
    // turn (readiness, the coach) is said at most once in each reply; the deadline ask IS said, once, on the build turn.
    const asks = [...new Set([ask1, ask2, ...seen.flatMap(b => readinessAsks(b.analysis_ready))])];
    for (const [k, body] of seen.entries()) for (const ask of asks) expect(timesSaid(body, ask), `turn ${k + 1}: ${ask}`).toBeLessThanOrEqual(1);
    expect(timesSaid(t1, ask1), String(t1.assistant_text)).toBe(1);

    // ── Run (the Run click). ⭐ DL (b1): PLoT answers with the REAL ENGINE's response to this exact request (`runOn`). The
    // engine gives no `probability_of_goal` at threshold 1; each chance is the goal's own constraint (`auto_goal_threshold`,
    // bound by identity), shown as a point with "about" (DL (b1)(ii): the 2-point test is not applied to an engine figure).
    const { result, request } = await runOn(w);
    const lines = goalChanceScreenLinesForAgent(result, held, true);
    // For the DL's real-engine route (PL 6122519782): the exact stored graph and the analysis request CEE sent to PLoT.
    const out = process.env.EBD_CAPTURE_DIR;
    if (out !== undefined && out !== '') {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${out}/paul-stored-graph.json`, JSON.stringify(held, null, 2));
      writeFileSync(`${out}/paul-plot-request.json`, JSON.stringify(request, null, 2));
      writeFileSync(`${out}/paul-run-result-real-engine.json`, JSON.stringify({ result, lines }, null, 2));
    }
    expect(lines.map(l => l.option_id).sort()).toEqual(['event_option_1', 'event_option_2', 'event_option_3']);
    // The engine's own figures on the range request (81.72 / 98.68 / 2.75 %, `recovery/bE/delta/plot-range-capture/`), each a
    // point, none a range.
    expect(Object.fromEntries(lines.map(l => [l.option_id, l.figure]))).toEqual({ event_option_1: 'about 82%', event_option_2: 'about 99%', event_option_3: 'about 3%' });
    // E delta: the team's 6–10 months is the user's own range, so no team-time assumption of Olumi's is attributed (the base
    // rule, as in ebd-input-loop's E5 combine row); each line exactly as served on this request.
    expect(lines.map(l => l.chance)).toEqual([
      '‘Hire a Tech lead’: about 82% chance of launching by 12 April 2027, in this model, using Olumi’s estimates of hiring time (2–4 months) '
        + 'and of the additional progress from the hires (12% of next feature launch per month), using Olumi\'s estimates for 2 relationships (see Check estimates).',
      '‘Hire two developers’: about 99% chance of launching by 12 April 2027, in this model, using Olumi’s estimates of hiring time (2–4 months) '
        + 'and of the additional progress from the hires (20% of next feature launch per month), using Olumi\'s estimates for 2 relationships (see Check estimates).',
      '‘Carry on as now’: about 3% chance of launching by 12 April 2027, in this model, using Olumi\'s estimates for 2 relationships (see Check estimates).',
    ]);
    for (const l of lines) {
      expect(l.chance, l.chance).not.toMatch(/forecast|bell-curve|assumed .*-month range|equally likely|your 3\.5|most likely|which Olumi widened|slow end|between about/);
    }
    // ⭐ DISCRIMINATING MUTANT (DL (b1)(ii)): what the user sees is the ENGINE's figure, never CEE's `normalChance`. The same
    // request, the engine's answer for two developers moved to 0.9015: the line follows it (90), while CEE's own approximation
    // of that option stays at 99.
    const parts2 = sharePartsForOption(held, 'event_option_2')!;
    expect(Math.round(normalChance(parts2, 1) * 100)).toBe(99);
    const moved = await runOn(w, r => ({ ...r, option_comparison: r.option_comparison.map((o: Rec) => o.option_id !== 'event_option_2' ? o
      : { ...o, constraint_probabilities: { ...o.constraint_probabilities, auto_goal_threshold: 0.9015 } }) }));
    expect(goalChanceScreenLinesForAgent(moved.result, held, true).find(l => l.option_id === 'event_option_2')!.figure).toBe('about 90%');
    // AIE 6125204695 (3): Olumi's assumed time range is noted only when Olumi assumed one; the user's own range is not.
    const notes = goalChanceNotesForAgent(result, held, true);
    expect(notes).toEqual([]);
    // MISMATCH NEGATIVE (AIE 6125204695): an engine row not scored on THIS goal node is never read; no figure is said for it.
    const offGoal = await runOn(w, r => ({ ...r, option_comparison: r.option_comparison.map((o: Rec) => o.option_id !== 'event_option_2' ? o
      : { ...o, goal_fit_basis: { ...o.goal_fit_basis, node_ids: ['event_team'] } }) }));
    expect(goalChanceScreenLinesForAgent(offGoal.result, held, true).map(l => l.option_id).sort()).toEqual(['event_option_1', 'event_option_3']);
    for (const id of ['event_option_1', 'event_option_2']) {
      // E5 combine: the AIE 6122738619 words (the hires' additional progress), after the team's attribution.
      expect(lines.find(l => l.option_id === id)!.chance).toContain("Olumi’s estimates of hiring time (2–4 months) and of the additional progress from the hires");
    }
    expect(providerCalls.filter(c => c !== 'agent' && c !== 'drafter' && c !== 'widening' && c !== 'brief_spans')).toEqual([]);
  }, 60_000);

  it('E4: what the deadline model set aside from a brief is said ONCE, on the build turn, and never on a later turn', async () => {
    const brief = 'Should we hire two senior engineers or four junior engineers to ship the new platform by Q3, while keeping annual salary spend under £400k?';
    drafterOutput = () => ({ ...candidate(), goal: { ...candidate().goal, deliverable: 'the new platform', metric: 'Platform completion', unit: '%' },
      options: [
        { label: 'Current team', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [], added_capacity: null },
        { label: 'Hire two senior engineers', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Senior engineers hired', value: 2, unit: 'engineers', provenance: 'explicit', stated_evidence: null }], added_capacity: { monthly_share_pct: 12, lead_months_low: 2, lead_months_high: 4 } },
        { label: 'Hire four junior engineers', provenance: 'explicit', changes: [], interventions: [{ factor_label: 'Junior engineers hired', value: 4, unit: 'engineers', provenance: 'explicit', stated_evidence: null }], added_capacity: { monthly_share_pct: 10, lead_months_low: 3, lead_months_high: 5 } },
      ],
      factors: [
        { label: 'Senior engineers hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'engineers', provenance: 'inferred', plausible_max: 10 },
        { label: 'Junior engineers hired', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'engineers', provenance: 'inferred', plausible_max: 20 },
      ], decision_question: brief });
    const w = world(brief), turn = await route(w);
    const said = 'This forecast does not yet use "Senior engineers hired" and "Junior engineers hired" from your brief; they remain as context for the wider productivity question. ' + 'This forecast does not yet use "£400k" from your brief; the model keeps it only in the wording of your decision question.';
    const t1 = await turn({ message: brief }, [call('build_model_from_brief', { brief }), say('I have set up the comparison.')]);
    expect(t1._agent.tool_calls).toContainEqual(expect.objectContaining({ name: 'build_model_from_brief', ok: true }));
    expect(t1.assistant_text.split(said)).toHaveLength(2);
    expect(t1._answer_shape?.detail).toContain(said);
    // "remain" only where the SAVED model keeps them (AIE): the two factors are held as context nodes; the figure only in the
    // decision question's words (its label), never as a figure the model uses.
    const saved = w.read();
    for (const label of ['Senior engineers hired', 'Junior engineers hired']) {
      expect(saved.nodes.find((n: Rec) => n.label === label), label).toMatchObject({ analysis_participation: 'retained_excluded' });
    }
    expect(saved.nodes.filter((n: Rec) => JSON.stringify(n).includes('400k')).map((n: Rec) => n.kind)).toEqual(['decision']);
    expect(JSON.stringify(saved.edges)).not.toContain('400k');
    expect(t1.assistant_text).not.toMatch(/1 more question remains/);
    const t2 = await turn({ message: 'What does the model still need?', agent_session_id: t1._agent.session_id }, [say('The deadline, first.')]);
    expect(JSON.stringify(t2)).not.toContain('set aside');
  });
  /**
   * ⭐ PAUL'S ORIGINAL TRANSCRIPT, ALL 13 OF HIS MESSAGES IN ORDER (PL 6122519782; DL, 12 Oct). Every user message is verbatim
   * from `v5_conversation_turns` (scenario 4184e877, 08:41–09:14Z), chips sent as chip presses. The Agent's side is SCRIPTED
   * (one plausible tool call or answer per turn, no provider), so this measures CEE's doors, readiness and retention on his
   * real sequence, not the Agent's judgement or the real engine. It reports the real interaction count to a licensed result.
   */
  it('ORIGINAL TRANSCRIPT: all 13 of Paul\'s messages, then his range, the card and the Run; count the interactions and keep what he said', async () => {
    const ORIGINAL = {
      needs: PAUL.needs,
      blockerPaste: 'Not ready for analysis yet\n\nWhat is "Share today\'s team finishes by the deadline" today, before any option changes it? Without a current level the analysis would treat it as zero. - Please explain this error message to me.',
      lateRate: "We have a launch deadline in 6 months. At our current rate of development, we are likely to miss that deadline by over a month. We need to bring in additional development capacity or technical leadership to help accelerate the team's progress. We're not sure which to do. What information do I need to make this decision effectively?",
      workItOut: "I've said it's 6 months from today. Can you not work that out?",
      yes: 'Yes, that is my deadline.',
      onboarding: 'What does ‘Developer onboarding burdens team’ do in this decision, and what is it assumed to depend on?',
      risks: "Suggest risks I haven't considered.",
      blockerPaste2: 'Not ready for analysis yet\n\nWhat is "Share today\'s team finishes by 12 April 2027" today, before any option changes it? Without a current level the analysis would treat it as zero. - I don\'t understand this. I don\'t understand what you need. Can you not provide an estimate from what I\'ve told you so far? If not, ask me directly what you need.',
    } as const;
    const w = world(), turn = await route(w);
    const log: { n: number; by: 'typed' | 'chip'; said: string; tools: string[]; text: string }[] = [];
    let session: string | undefined;
    /** The first interaction after which the model holds his deadline. */
    let deadlineSavedAt: number | null = null;
    const noteDeadline = (): void => { if (deadlineSavedAt === null && draftedTeamPartOf(w.read())?.goal.goal_horizon?.deadline === '2027-04-12') deadlineSavedAt = log.length; };
    const send = async (by: 'typed' | 'chip', said: string, script: Rec[], extra: Rec = {}): Promise<Rec> => {
      const body = await turn({ message: said, ...(session !== undefined ? { agent_session_id: session } : {}), ...extra }, script);
      session = body._agent?.session_id ?? session;
      log.push({ n: log.length + 1, by, said, tools: (body._agent?.tool_calls ?? []).map((c: Rec) => `${c.name}:${c.ok ? 'ok' : c.refusal ?? 'refused'}`), text: String(body.assistant_text) });
      noteDeadline();
      const dir = process.env.EBD_CAPTURE_DIR;
      if (dir !== undefined && dir !== '') (await import('node:fs')).writeFileSync(`${dir}/paul-original-transcript-log.json`, JSON.stringify({ deadlineSavedAt, log }, null, 2));
      return body;
    };
    const chip = (body: Rec, id: string): Rec => { const c = body.suggested_actions.find((a: Rec) => a.id === id); return c === undefined ? {} : { source: 'chip_click', chip: { id: c.id } }; };
    const deadlineAsk = chanceGoalDeadlineAsk('next feature launch'), teamAsk = 'How long would next feature launch take with the team you have now?';

    const t1 = await send('typed', PAUL.brief, [call('build_model_from_brief', { brief: PAUL.brief }), say('I have set up the comparison.')]);
    const t2 = await send('chip', ORIGINAL.needs, [say(deadlineAsk)], chip(t1, 'agent-suggest-what-it-needs'));
    const t3 = await send('typed', PAUL.deadline, [call('propose_goal_deadline', { deadline_words: DEADLINE_WORDS, rationale: PAUL.deadline }), say('Please confirm the date.')]);
    proposed(t3, 'propose_goal_deadline');
    await send('typed', ORIGINAL.blockerPaste, [say('That was the old question. The deadline card above is the one step: 12 April 2027.')]);
    const t5 = await send('typed', ORIGINAL.lateRate, [call('propose_goal_deadline', { deadline_words: 'a launch deadline in 6 months', rationale: ORIGINAL.lateRate }), say('Please confirm the date.')]);
    const t6 = await send('typed', ORIGINAL.workItOut, [say('Yes: 6 months from today is 12 April 2027. Please confirm it.')]);
    // His "Yes, that is my deadline." is the card's Yes chip (a durable row stores a chip's text as user_message): pressed on the
    // latest offer of the held deadline card.
    const offered = [t6, t5, t3].flatMap(b => (b.suggested_actions ?? []).filter((a: Rec) => typeof a.id === 'string' && a.id.startsWith(approvalChipIdFor(''))).map((a: Rec) => ({ b, a })))[0];
    expect(offered, 'a Yes chip for the deadline card').toBeDefined();
    const t7 = await send('chip', ORIGINAL.yes, [], { source: 'chip_click', chip: { id: offered!.a.id }, message: offered!.a.message });
    const t8 = await send('chip', ORIGINAL.needs, [say(teamAsk)], chip(t7, 'agent-suggest-what-it-needs'));
    await send('typed', PAUL.hiring, [say('I will use those hiring timings when the hiring card is ready; first, how long would the launch take with the team you have now?')]);
    await send('typed', ORIGINAL.onboarding, [say('It is a risk Olumi suggested; it is not connected to the forecast yet.')]);
    await send('chip', ORIGINAL.risks, [say('Two more risks to consider: key-person dependency and scope growth.')], chip(t8, 'agent-next-suggest-risks'));
    await send('typed', ORIGINAL.blockerPaste2, [say(teamAsk)]);
    const t13 = await send('typed', PAUL.teamTime, [call('propose_team_time', { quote: TEAM_QUOTE, low_months: 7, high_months: 7 }), say('How long would it take at the soonest, and at the latest?')]);
    // E delta: the base door refuses his sentence (nothing written); he then gives a range, the base route.
    expect(t13._agent.tool_calls).toEqual([expect.objectContaining({ name: 'propose_team_time', ok: false, refusal: 'team_time_not_stated' })]);
    const t14 = await send('typed', TEAM_RANGE, [call('propose_team_time', { low_months: 6, high_months: 10 }), say('Please confirm.')]);
    const team = proposed(t14, 'propose_team_time');
    const t15 = await turn(approve(t14, team.proposal_id));
    log.push({ n: 15, by: 'chip', said: 'Yes (team-time card)', tools: (t15._agent?.tool_calls ?? []).map((c: Rec) => `${c.name}:${c.ok ? 'ok' : 'refused'}`), text: String(t15.assistant_text) });
    const held = w.read();
    expect(resolveRunAdmission(held).willProceed).toBe(true);
    const { result } = await runOn(w);
    const lines = goalChanceScreenLinesForAgent(result, held, true);
    const interactionsToResult = log.length + 1; // + the Run press

    // What he said is kept: the six-month goal on the model, his forecast with its qualifier on the team part, and the
    // 25%/three-month condition and his hiring qualifier in what the Agent reads on his last turn (the model holds neither).
    expect(draftedTeamPartOf(held)!.goal.goal_horizon).toEqual({ deadline: '2027-04-12' });
    expect(draftedTeamPartOf(held)!.team.observed_state.stated_time).toEqual(TEAM_RANGE_HELD);
    const lastContext = JSON.stringify(agentBodies[agentBodies.length - 1] ?? {});
    const kept = {
      productivity_25pct_3months: lastContext.includes("increase our developer's output by 25%, in the next three months"),
      six_month_deadline_words: lastContext.includes('launch deadline in six months time'),
      low_confidence_words: lastContext.includes('but I have low confidence in this because they keep missing deadlines'),
      hiring_qualifier_words: lastContext.includes("I would think, but I'm not sure, that a tech lead would take at least 3 months"),
    };
    const out = process.env.EBD_CAPTURE_DIR;
    if (out !== undefined && out !== '') {
      const { writeFileSync } = await import('node:fs');
      writeFileSync(`${out}/paul-original-transcript.json`, JSON.stringify({ deadline_saved_at_interaction: deadlineSavedAt,
        interactions_to_result: interactionsToResult, kept, log, lines }, null, 2));
    }
    expect(lines.map(l => l.option_id).sort()).toEqual(['event_option_1', 'event_option_2', 'event_option_3']);
    expect(deadlineSavedAt).toBe(7);
    expect(interactionsToResult).toBe(16);
    expect(kept).toEqual({ productivity_25pct_3months: true, six_month_deadline_words: true, low_confidence_words: true, hiring_qualifier_words: true });
    for (const body of [t1, t2]) expect(JSON.stringify(body)).not.toMatch(LEVEL_ASK);
  }, 60_000);
});
