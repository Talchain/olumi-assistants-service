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
 * ⛔ WHAT THIS IS NOT (PL 6122519782, AIE 6122738619). The first `it` is a SHORTENED fixture: three typed inputs (brief, deadline
 * sentence, team-time sentence) plus two approvals and a Run, with Paul's late team forecast moved to typed turn 3 and his E5
 * hiring timings left out. It is a transport check of CEE's doors and words, not the original transcript (see the full-transcript
 * `it`), not the real numerical engine, and not proof of usable chances.
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
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { constructionOperationId } from '../../agent-lane/runtime/build-model.js';
import { registrationTurnId } from '../../graph-registration/registration-identity.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
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
/** What Paul's team-time sentence says the team's time is, as the Agent reads it: one figure. */
const DRAFTED_AT = '2026-10-12T08:41:24.992Z';
const NOW = new Date('2026-10-12T09:14:24.374Z');

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
/** Every question the readiness authority puts to the user, as the turn's own readback carries it. */

/** How many times `ask` is said in one reply: its text (however the composer lays it out), and the questions toggle list. */

/** ONE VOICE: the Run path, the readiness route and the coach put the SAME question while the team part has no level. */

/** The request CEE posted to staging PLoT for Paul's Run (`recovery/bB/ebd/paul-plot-capture/paul-plot-request.json`). */

/**
 * The REAL Run producer over the stored graph; PLoT answers with the real engine's response to this exact request.
 * `mutate` (a discriminating mutant only) edits the engine's answer, never the request it is bound to.
 */

describe("EBD: Paul's hiring conversation reaches a labelled chance per option by his 3rd typed turn", () => {

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
});
