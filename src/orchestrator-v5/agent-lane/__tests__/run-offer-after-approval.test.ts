import { runPressToolResponse } from './fixtures/run-press-model.js';
import { explainRun } from './fixtures/run-explanation-follow-up.js';
/**
 * ⭐ THE EXPLICIT RUN AFTER AN OPENAI APPROVAL (RC #63; Codex 5805970015: "served Agent
 * approval calls approvalChipsFor after authorise_change and that helper returns no chips").
 *
 * ⭐ ADOPTED (Paul, #94 6166259456, confirmed 14 Oct): after a COMMITTED change, and ONLY when the canonical readiness
 * of the saved revision admits a run, the existing Run runs ONCE, automatically, in the same turn, and no Run chip is
 * offered (it already ran). This supersedes "fast path 2 runs nothing; one typed Run chip is offered". The negatives
 * stand: no admission → no Run and no chip; a replay never runs again; a refused approval runs nothing.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// A fresh scenario per case: proposals are identified per scenario, and a re-proposed link
// on the same one would replay as already applied.
let n = 0;
let SCENARIO = '';
const nextScenario = () => { n += 1; SCENARIO = `5e0d1c2b-3a4f-4e5d-8c6b-7a8f9e0d1c${String(n).padStart(2, '0')}`; };
/** Records committed answer rows by (scenario, turn), so a same-turn_id retry takes the REAL replay path. */
// The durable row carries `pending_actions` exactly as the store persists them, JSON round-tripped
// the way the JSONB column would be.
const rows = new Map<string, { id: string; request_hash: string; assistant_message: string | null; user_message: string | null; llm_calls_used: number; pending_actions: unknown[] }>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (sid: string, turnId: string) => rows.get(`${sid}:${turnId}`) ?? null),
  append: vi.fn(async (w: { scenario_id: string; turn_id: string; request_hash: string; assistantMessage?: string; userMessage?: string; llm_calls_used?: number; pending_actions?: unknown[] }) => {
    const k = `${w.scenario_id}:${w.turn_id}`;
    if (!rows.has(k)) rows.set(k, { id: `row-${rows.size + 1}`, request_hash: w.request_hash, assistant_message: w.assistantMessage ?? null, user_message: w.userMessage ?? null, llm_calls_used: w.llm_calls_used ?? 0, pending_actions: JSON.parse(JSON.stringify(w.pending_actions ?? [])) });
    return { id: rows.get(k)!.id };
  }),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

type Chip = { id: string; label: string; message: string; action_type?: string };
/** The Explain press's interpreting call: no tools at all, `tool_choice: 'none'` (agent-v1-turn.ts `interpretSelectedRun`). */
const isInterpretingCall = (body: Record<string, unknown>): boolean => body['tool_choice'] === 'none'
  && Array.isArray(body['tools']) && (body['tools'] as unknown[]).length === 0;
/** That call's request: the last input item's JSON (`{ request, canonical_state }`). */
const interpretingRequestOf = (body: Record<string, unknown>): { request?: string; canonical_state?: { ok?: boolean } } => {
  const last = (body['input'] as { content?: { text?: string }[] }[]).at(-1);
  return JSON.parse(last?.content?.[0]?.text ?? '{}') as { request?: string; canonical_state?: { ok?: boolean } };
};

describe('the explicit Run is offered after a change the canonical readiness admits', () => {
  let app: FastifyInstance;
  let edges: { from: string; to: string }[] = [];
  let readiness: Record<string, unknown> = {};
  let runs = 0;
  let modelBodies: Record<string, unknown>[] = [];
  let proposeNext = true;
  let lastApproveId = '';
  let analysisState: Record<string, unknown> = {};
  /**
   * The route's final readback fails while the approval itself verified. After the write there are two graph
   * reads (measured): the approval's own verification, then the route's readback. Only the second is refused —
   * refusing the first would make the approval report `not_applied`, and the control would never reach the
   * condition it exists to test.
   */
  let failReadbackAfterWrite = false;
  let postWriteReads = 0;
  /** Scripted model outputs for an agent-loop turn, consumed in order before the default behaviour. */
  let script: Record<string, unknown>[] = [];
  /** The Run response's own stamp (its result's graph hash, its `computed_at`); null → an unstamped Run, as before. */
  let runStampedAt: string | null = null;
  /** The preceding Run's delta the read (`current_read`) and the Run response carry; undefined → a first Run. */
  let runDelta: unknown;
  /** The interpreting call's words (tool-less, `tool_choice: 'none'`); null → the default answer below. */
  let interpretation: string | null = null;
  /** A route instance on FRESH modules: an empty process cache and an empty proposal store. */
  async function buildRouteApp(): Promise<FastifyInstance> {
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const a = Fastify({ logger: false });
    a.post('/assist/v1/scenarios/:id/graph', async (_req, reply) => {
      if (edges.length > 0) postWriteReads += 1;
      if (failReadbackAfterWrite && postWriteReads >= 2) return reply.code(500).send({ error: 'read failed' });
      return {
        graph: { nodes: [{ id: 'f1', kind: 'factor', label: 'Team size' }, { id: 'o1', kind: 'outcome', label: 'Velocity' }, { id: 'f2', kind: 'factor', label: 'Tooling' }], edges },
        graph_hash: `h${edges.length}`,
        analysis_ready: readiness,
        analysis_state: runs > 0 ? { ...analysisState, run_state: { kind: 'complete_current', computed_at: '2026-10-01T12:00:00.000Z' } } : analysisState,
        ...(runs > 0 ? { analysis_result: { type: 'analysis_result', computed_against_hash: '0123456789abcdef', data: { marker: 'synthetic' } } } : {}),
        ...(runs > 0 && runDelta !== undefined ? { current_read: { run_delta: runDelta } } : {}),
      };
    });
    a.post('/orchestrate/v2/turn', async (req) => {
      const b = req.body as { kind?: string; event?: { from: string; to: string }; chip?: { action_type?: string } };
      if (b.kind === 'system_event' && b.event) edges = [...edges, { from: b.event.from, to: b.event.to }];
      if (b.chip?.action_type === 'run_analysis') runs += 1;
      if (b.chip?.action_type === 'run_analysis' && runStampedAt !== null) {
        return { assistant_text: 'ok', blocks: [{ type: 'analysis_result', computed_against_hash: '0123456789abcdef', data: {} }], analysis_ready: readiness,
          analysis_state: { run_state: { kind: 'complete_current', computed_at: runStampedAt } }, ...(runDelta !== undefined ? { run_delta: runDelta } : {}) };
      }
      return { assistant_text: 'ok', blocks: b.chip?.action_type === 'run_analysis' ? [{ type: 'analysis_result', data: {} }] : [], analysis_ready: readiness };
    });
    await a.register(agentV1TurnRoute);
    await a.ready();
    return a;
  }
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelBodies.push(body);
      const runCall = runPressToolResponse(body);
      if (runCall) return runCall;
      if (interpretation !== null && isInterpretingCall(body)) {
        return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: interpretation }] }] }), { status: 200 });
      }
      if (body['tool_choice'] !== 'none' && script.length > 0) return new Response(JSON.stringify({ output: [script.shift()] }), { status: 200 });
      if (body['tool_choice'] !== 'none' && proposeNext) {
        proposeNext = false;
        return new Response(JSON.stringify({ output: [{
          type: 'function_call', name: 'propose_model_change', call_id: `c${modelBodies.length}`,
          arguments: JSON.stringify({ from_label: 'Team size', to_label: 'Velocity', direction: 'positive', strength: 'strong', rationale: 'It moves velocity.' }),
        }] }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model, the link matters.' }] }] }), { status: 200 });
    }));
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    app = await buildRouteApp();
  }, 120_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => { edges = []; runs = 0; modelBodies = []; proposeNext = true; analysisState = {}; failReadbackAfterWrite = false; postWriteReads = 0; script = []; runStampedAt = null; runDelta = undefined; interpretation = null; nextScenario(); });

  /** Propose (one Agent turn), then approve through the typed chip (fast path 2). */
  async function proposeThenApprove(approveTurnId?: string): Promise<{ suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string } }> {
    const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.' } });
    const approve = (t1.json() as { suggested_actions: Chip[] }).suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(approve, 'the control: a real proposal was offered').toBeDefined();
    lastApproveId = approve!.id;
    const t2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: approve!.message, source: 'chip', chip: { id: approve!.id }, ...(approveTurnId ? { turn_id: approveTurnId } : {}) } });
    expect(t2.statusCode).toBe(200);
    return t2.json() as { suggested_actions: Chip[]; _diagnostic_trace: { fast_path?: string } };
  }

  it('⭐ (adopted, Paul #94) approval applied and the canonical readiness admits a run → the Run runs ONCE in the same turn; no Run chip', async () => {
    readiness = { status: 'needs_user_input', may_run: true };
    const b = await proposeThenApprove();
    expect(b._diagnostic_trace.fast_path).toBe('approve');
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(runs, 'the existing Run, once, after the commit').toBe(1);
    // The Run moves the analysis, so the final read is a fresh read after it (the capability's own check + that one).
    expect(postWriteReads).toBe(2);
    expect(b.suggested_actions.filter((c) => c.action_type === 'run_analysis'), 'it already ran: no Run chip').toEqual([]);
  });

  it('the Run chip, pressed as the UI sends it, still enters the loop — one run and same-turn interpretation', async () => {
    readiness = { status: 'ready', may_run: true };
    await proposeThenApprove();
    const { RUN_OFFER_CHIP } = await import('../../../routes/agent-v1-turn.js');
    const run = { ...RUN_OFFER_CHIP } as Chip;
    runs = 0;
    modelBodies = [];
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: run.message, source: 'chip', chip: { id: run.id, action_type: run.action_type },
    } });
    expect((r.json() as { _diagnostic_trace: { fast_path?: string } })._diagnostic_trace.fast_path).toBe('run');
    expect(runs).toBe(1);
    expect(modelBodies).toHaveLength(1);
    expect(modelBodies[0]?.tool_choice).toEqual({ type: 'function', name: 'run_analysis' });
    modelBodies = [];
    await explainRun(app, SCENARIO, r);
    expect(runs).toBe(1);
    expect(modelBodies.map((m) => m['tool_choice'])).toEqual(['none']);
  });

  it.each([
    ['may_run false wins over a ready status', { status: 'ready', may_run: false }],
    ['may_run false', { status: 'needs_user_input', may_run: false }],
    ['no may_run and not ready', { status: 'needs_user_input' }],
  ])('CONTRAST: %s → no Run offered', async (_l, r) => {
    readiness = r;
    const b = await proposeThenApprove();
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(b.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });

  /**
   * ⛔ P0, 25 Sep (RC #69 5826744045 §2): the served hiring dead end. The approval applied, the readiness is
   * the served `21e3b38` shape (AI Quality fixture `p0-post-approval-dead-end/dead-end.eng-hiring-2.approve.json`:
   * `status: blocked`, `may_run: false`, `blockers: null`), and the reply offered NOTHING.
   */
  it('RED: approval applied but the model is still blocked (served shape) → the next-step chip, and no Run', async () => {
    readiness = { status: 'blocked', may_run: false, blockers: null };
    const b = await proposeThenApprove();
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(b.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    expect(b.suggested_actions.map((c) => c.id), 'the user always has one reachable next action').toEqual(['agent-suggest-what-it-needs']);
    expect(runs).toBe(0);
  });

  // R2 T2 (friction audit row T2): "Suggest what it still needs" ("…so I can approve it") produced 0 tools and nothing
  // approvable (deadline 2/2, Paul 2/2) when every blocker was the user's own input; the face already asks for it.
  const humanLevelGap = { issue_id: 'level_1', code: 'MISSING_FACTOR_LEVEL', category: 'option_values', repairability: 'human_input_required',
    message: 'What is "Share today\u2019s team finishes by the deadline" today, before any option changes it?', factor_id: 'f', factor_label: 'Capacity' };
  const safeGap = { ...humanLevelGap, issue_id: 'x', code: 'OPTION_NEEDS_ENCODING', repairability: 'safe_canonicalisation' };
  it.each([
    { name: 'every blocker is human_input_required', issues: [humanLevelGap], offered: false },
    { name: 'CONTRAST: one blocker Olumi can supply', issues: [humanLevelGap, safeGap], offered: true },
    { name: 'an offered item is not a blocker', issues: [humanLevelGap, { ...safeGap, obligation: 'offered' }], offered: false },
  ])('R2 T2: approval applied, model still blocked, $name → next-step chip offered: $offered', async ({ issues, offered }) => {
    readiness = { status: 'needs_user_input', may_run: false, readiness_issues: issues };
    const b = await proposeThenApprove();
    expect(edges, 'the approval really applied').toHaveLength(1);
    expect(b.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    expect(b.suggested_actions.some((c) => c.id === 'agent-suggest-what-it-needs'), JSON.stringify(b.suggested_actions)).toBe(offered);
    const { stillValidOffers, NEXT_STEP_AFTER_BLOCKED_RUN_CHIP } = await import('../../../routes/agent-v1-turn.js');
    expect(stillValidOffers([NEXT_STEP_AFTER_BLOCKED_RUN_CHIP], { outstandingProposalIds: new Set<string>(), analysisReady: readiness, analysisState: {}, modelExists: true })
      .some((a) => a.id === 'agent-suggest-what-it-needs'), 'a carried chip follows the same rule').toBe(offered);
  });

  it('CONTROL: approval applied and a run is admitted → it RAN, and neither a Run chip nor the next-step chip is offered', async () => {
    readiness = { status: 'ready', may_run: true };
    const b = await proposeThenApprove();
    expect(runs).toBe(1);
    expect(b.suggested_actions.map((c) => c.id)).toEqual([]);
  });

  it('OPPOSITE CONTROL (C6 turnReadCache): after a VERIFIED commit the route answers from that verified read — it makes no second post-write read that could fail', async () => {
    // Before C6 the route re-read the model after the capability had already read it back, and this control failed
    // that second read to prove "unknown is not a refusal". With nothing written between the two, the route now reuses
    // the verified read, so that unknown state cannot arise here. The unknown-readiness rule at the approval is pinned by
    // the seam row `agent-writer-doors-seam.test.ts` (7c): an in-process write, then every read fails (DL #2114 Q4).
    readiness = { status: 'ready', may_run: true };
    failReadbackAfterWrite = true; // any SECOND post-write read would be refused
    const b = await proposeThenApprove() as unknown as { suggested_actions: Chip[]; _agent: { tool_calls: { name: string; mutated: boolean }[] } };
    expect(edges, 'the approval really committed').toHaveLength(1);
    expect(b._agent.tool_calls.find((c) => c.name === 'authorise_change')?.mutated, 'the approval reports it applied').toBe(true);
    // Adopted (Paul #94): the automatic Run follows the commit, so the final readback is a second post-write read after
    // it (the capability's own check is still reused up to the Run). That read is refused here: the reply still never
    // claims a ready model is blocked, and borrows no result.
    expect(runs, 'the automatic Run ran on the verified commit').toBe(1);
    // The capability's own check; the Run's own post-run read (refused here, so it is not kept); the final readback's
    // one retry of it (refused too). A read that fails is never answered from an older one.
    expect(postWriteReads, 'the capability\'s check, the Run\'s post-run read, the final read').toBe(3);
    expect(b.suggested_actions.some((c) => c.id === 'agent-suggest-what-it-needs'), 'a ready model is never given a blocked claim').toBe(false);
  });

  it('REPLAY: a remembered next-step chip is re-offered only on a KNOWN refusal, never on an unknown re-read (pre-review 5827131835)', async () => {
    const { stillValidOffers, NEXT_STEP_AFTER_BLOCKED_RUN_CHIP } = await import('../../../routes/agent-v1-turn.js');
    const now = (analysisReady: unknown) => ({ outstandingProposalIds: new Set<string>(), analysisReady, analysisState: {}, modelExists: true });
    const ids = (analysisReady: unknown) => stillValidOffers([NEXT_STEP_AFTER_BLOCKED_RUN_CHIP], now(analysisReady)).map((a) => a.id);
    expect(ids(undefined), 'the replay read failed: unknown').toEqual([]);
    expect(ids({}), 'an empty readiness is not a refusal').toEqual([]);
    expect(ids({ status: 'blocked', may_run: false, blockers: null }), 'still known blocked').toEqual(['agent-suggest-what-it-needs']);
    expect(ids({ status: 'ready', may_run: true }), 'a collaborator made it runnable').toEqual([]);
  });

  it('CONTROL: an agent-loop turn that APPLIES one proposal and PROPOSES another offers that approval, not the next-step chip', async () => {
    readiness = { status: 'blocked', may_run: false, blockers: null }; // a known refusal: the chip WOULD fire but for the waiting approval
    const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.' } });
    const first = (t1.json() as { suggested_actions: Chip[] }).suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'));
    expect(first, 'the control: a real first proposal').toBeDefined();
    const proposalId = first!.id.slice('agent-approve-proposal:'.length);
    script = [
      { type: 'function_call', name: 'authorise_change', call_id: 'a1', arguments: JSON.stringify({ proposal_id: proposalId }) },
      { type: 'function_call', name: 'propose_model_change', call_id: 'p2', arguments: JSON.stringify({ from_label: 'Tooling', to_label: 'Velocity', direction: 'positive', strength: 'moderate', rationale: 'Better tools speed delivery.' }) },
      { type: 'message', content: [{ type: 'output_text', text: 'Applied the first link; the second is ready for your approval.' }] },
    ];
    const t2 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Yes, apply that. Tooling moderately drives velocity too, so connect it.' } });
    const b = t2.json() as { suggested_actions: Chip[]; _agent: { tool_calls: { name: string; mutated: boolean }[] } };
    expect(b._agent.tool_calls.find((c) => c.name === 'authorise_change')?.mutated, 'PRECONDITION: the first approval applied').toBe(true);
    expect(b.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'PRECONDITION: the second proposal is waiting').toBe(true);
    expect(b.suggested_actions.some((c) => c.id === 'agent-suggest-what-it-needs'), 'the waiting approval is the next action').toBe(false);
  });

  it('knownNotRunnable, exactly: only a READ refusal counts; unknown or empty is never a refusal', async () => {
    const { knownNotRunnable } = await import('../../../routes/agent-v1-turn.js');
    expect(knownNotRunnable(undefined)).toBe(false);
    expect(knownNotRunnable(null)).toBe(false);
    expect(knownNotRunnable({})).toBe(false);
    expect(knownNotRunnable({ may_run: false })).toBe(true);
    expect(knownNotRunnable({ status: 'blocked', may_run: false, blockers: null })).toBe(true);
    expect(knownNotRunnable({ status: 'blocked' })).toBe(true);
    expect(knownNotRunnable({ status: 'ready' })).toBe(false);
    expect(knownNotRunnable({ status: 'blocked', may_run: true }), 'may_run decides when present').toBe(false);
  });

  it('CONTRAST: a turn that changed nothing is not offered a Run, even when a run is admitted', async () => {
    readiness = { status: 'ready', may_run: true };
    proposeNext = false; // the Agent just answers
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does this model say?' } });
    expect((r.json() as { suggested_actions: Chip[] }).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
  });

  it('the admission rule, exactly: may_run decides when present; status only when it is absent', async () => {
    const { admitsRunOffer, typedRunOf, RUN_OFFER_CHIP } = await import('../../../routes/agent-v1-turn.js');
    expect(admitsRunOffer({ status: 'ready' })).toBe(true);
    expect(admitsRunOffer({ status: 'ready', may_run: false })).toBe(false);
    expect(admitsRunOffer({ status: 'blocked', may_run: true })).toBe(true);
    expect(admitsRunOffer(undefined)).toBe(false);
    expect(typedRunOf({ kind: 'message', chip: { id: RUN_OFFER_CHIP.id } }), 'the id alone is recognised').toBe(true);
    expect(typedRunOf({ kind: 'message', chip: { id: 'agent-approve-proposal:prop_abc123' } })).toBe(false);
  });
  /**
   * ⛔ Independent review of #1792 (5806213240): the durable row keeps the words only, so a
   * retry of the SAME turn_id after a lost response replayed with no Run and no approve control.
   */
  /**
   * ⭐ THE AUTOMATIC RUN IS INTERPRETED IN ITS OWN TURN (DL, after #3038; Paul #94 6166259456: "science-based AI coaching
   * after every implemented change"). The Run follows the approval, so no Agent read it: ONE interpreting call, the Explain
   * press's own, over THIS Run (its run-fact identity on the read), and its words are the reply's coaching on the new result.
   */
  describe('the automatic Run is interpreted in its own turn', () => {
    const RUN_AT = '2026-10-01T12:00:00.000Z';
    const COACHING = 'This Run reads the model as you just saved it, with the link from Team size to Velocity included.';
    /** The preceding Run's delta: the approved link entered the analysis (one typed row, complete coverage). */
    const LINK_ENTERED = {
      attribution_case: 'C1_attributable', input_coverage: 'complete', win_probabilities: [], goal_chances: [], flip_thresholds: [],
      leader: { changed: false, noise_verdict: 'not_noise_qualified' },
      input_changes: [{ entity_kind: 'link', field: 'presence', link: { from: 'f1', to: 'o1' }, before: null, after: { raw: true } }],
    };
    const CODE_LINE = 'The link from ‘Team size’ to ‘Velocity’ is now part of the analysis.';
    const approveAndRun = async () => {
      readiness = { status: 'ready', may_run: true };
      interpretation = COACHING;
      const b = await proposeThenApprove() as unknown as { assistant_text: string; suggested_actions: Chip[] };
      expect(runs, 'the automatic Run ran once').toBe(1);
      return b;
    };

    it('RED: approve → the Run runs → ONE interpreting call over THIS Run; the reply carries its coaching', async () => {
      runStampedAt = RUN_AT;
      const b = await approveAndRun();
      const calls = modelBodies.filter(isInterpretingCall);
      expect(calls, 'one interpreting call').toHaveLength(1);
      const sent = interpretingRequestOf(calls[0]!);
      const { RUN_EXPLANATION_MESSAGE } = await import('../run-explanation.js');
      expect(sent.request, 'the Explain press\'s own request').toBe(RUN_EXPLANATION_MESSAGE);
      expect(sent.canonical_state?.ok, 'over the canonical read after the Run').toBe(true);
      expect(b.assistant_text).toContain(COACHING);
    });

    it('RED (compare): with the preceding Run\'s delta, the call is given the Run record and the reply leads with it', async () => {
      runStampedAt = RUN_AT;
      runDelta = LINK_ENTERED;
      const b = await approveAndRun();
      const calls = modelBodies.filter(isInterpretingCall);
      expect(calls).toHaveLength(1);
      expect(String(calls[0]!['instructions']), 'what changed, from the delta\'s typed row').toContain(`Run record: "${CODE_LINE}`);
      expect(b.assistant_text).toContain(`${CODE_LINE}`);
      expect(b.assistant_text).toContain(COACHING);
      expect(b.assistant_text.indexOf(CODE_LINE)).toBeLessThan(b.assistant_text.indexOf(COACHING));
    });

    it('ADVERSARIAL: the read selects another Run (same hash, another computed_at) → no interpreting call, no coaching', async () => {
      runStampedAt = '2026-10-01T11:59:00.000Z';
      const b = await approveAndRun();
      expect(modelBodies.filter(isInterpretingCall)).toHaveLength(0);
      expect(b.assistant_text).not.toContain(COACHING);
    });

    it('CONTRAST: a Run with no stamp to bind → no interpreting call', async () => {
      const b = await approveAndRun();
      expect(modelBodies.filter(isInterpretingCall)).toHaveLength(0);
      expect(b.assistant_text).not.toContain(COACHING);
    });

    it('CONTRAST: a turn that commits nothing runs nothing and interprets nothing', async () => {
      readiness = { status: 'ready', may_run: true };
      runStampedAt = RUN_AT;
      interpretation = COACHING;
      const t1 = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.' } });
      expect(t1.statusCode).toBe(200);
      expect(runs).toBe(0);
      expect(modelBodies.filter(isInterpretingCall)).toHaveLength(0);
    });
  });

  describe('a durable replay re-offers the original typed actions, re-validated on today\'s state', () => {
    const replay = async (payload: Record<string, unknown>) => {
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload });
      expect(r.statusCode).toBe(200);
      return r.json() as { suggested_actions: Chip[]; _agent: { replayed?: boolean }; _provider_calls: unknown[] };
    };

    it('approve with a stable turn_id (it ran once), lose the response, retry → the replay runs NOTHING more, no Run chip, no model call, no extra write', async () => {
      readiness = { status: 'needs_user_input', may_run: true };
      const T = '11111111-2222-4333-8444-555555555555';
      const first = await proposeThenApprove(T);
      expect(runs, 'the approving turn ran the analysis once').toBe(1);
      expect(first.suggested_actions.filter((c) => c.action_type === 'run_analysis')).toHaveLength(0);
      const writesBefore = edges.length; const callsBefore = modelBodies.length;
      // The retry is byte-identical to the first request (the UI resends it).
      const again = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.', source: 'chip', chip: { id: lastApproveId }, turn_id: T });
      expect(again._agent.replayed, 'the real replay path').toBe(true);
      expect(again.suggested_actions.filter((c) => c.action_type === 'run_analysis')).toEqual([]);
      expect(runs, 'the replay runs nothing more').toBe(1);
      expect(modelBodies.length - callsBefore, 'no model call').toBe(0);
      expect(edges.length - writesBefore, 'no second write').toBe(0);
    });

    it('CONTRAST: readiness later says may_run:false → the replay does NOT carry the stale Run chip', async () => {
      readiness = { status: 'needs_user_input', may_run: true };
      const T = '21111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      readiness = { status: 'ready', may_run: false };
      const again = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.', source: 'chip', chip: { id: lastApproveId }, turn_id: T });
      expect(again._agent.replayed).toBe(true);
      expect(again.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: a refused approval offered no Run, so its replay acquires none', async () => {
      readiness = { status: 'ready', may_run: true };
      const T = '31111111-2222-4333-8444-555555555555';
      const body = { kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.', source: 'chip', chip: { id: 'agent-approve-proposal:prop_0123456789abcdef0123456789abcdef' }, turn_id: T };
      const first = await replay(body);
      expect(first.suggested_actions.some((c) => c.action_type === 'run_analysis'), 'the refused original offered none').toBe(false);
      const again = await replay(body);
      expect(again._agent.replayed).toBe(true);
      expect(again.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: another scenario reusing the same turn_id never acquires this scenario\'s offer', async () => {
      readiness = { status: 'ready', may_run: true };
      const T = '41111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      const mine = SCENARIO;
      nextScenario();
      expect(SCENARIO).not.toBe(mine);
      const other = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'What does this model say?', turn_id: T });
      expect(other._agent.replayed ?? false, 'a different scenario is not a replay of mine').toBe(false);
      expect(other.suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('the SAME invariant covers the approve chip: replayed while its proposal is outstanding, dropped once it is applied', async () => {
      readiness = { status: 'needs_user_input', may_run: false };
      const T = '51111111-2222-4333-8444-555555555555';
      const offer = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.', turn_id: T });
      const chip = offer.suggested_actions.find((c) => c.id.startsWith('agent-approve-proposal:'))!;
      expect(chip, 'the control: a proposal was offered').toBeDefined();
      const again = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.', turn_id: T });
      expect(again._agent.replayed).toBe(true);
      // S-D, DL 7 Oct, Canvas capture #2614: Not now follows Change something first.
      expect(again.suggested_actions.map((c) => c.id)).toEqual([chip.id, 'agent-amend-proposal', `agent-decline-proposal:${chip.id.slice('agent-approve-proposal:'.length)}`]);
      await replay({ kind: 'message', scenario_id: SCENARIO, message: chip.message, source: 'chip', chip: { id: chip.id } });
      const afterApply = await replay({ kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.', turn_id: T });
      expect(afterApply._agent.replayed).toBe(true);
      expect(afterApply.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'an applied proposal is never re-offered').toBe(false);
    });

    it('the rule, exactly: stillValidOffers keeps only what today\'s state still admits', async () => {
      const { stillValidOffers, RUN_OFFER_CHIP } = await import('../../../routes/agent-v1-turn.js');
      const approve = { id: 'agent-approve-proposal:prop_abc123', label: 'Make this change', message: 'Yes, make that change.' };
      const amend = { id: 'agent-amend-proposal', label: 'Change something first', message: 'Before you apply it, I want to change some of it.' };
      const all = [approve, amend, RUN_OFFER_CHIP];
      expect(stillValidOffers(all, { outstandingProposalIds: new Set(['prop_abc123']), analysisReady: { may_run: true }, analysisState: {}, modelExists: true }).map((a) => a.id))
        .toEqual([approve.id, amend.id, RUN_OFFER_CHIP.id]);
      expect(stillValidOffers(all, { outstandingProposalIds: new Set(), analysisReady: { may_run: true }, analysisState: { run_state: { kind: 'complete_current' } }, modelExists: true })).toEqual([]);
      expect(stillValidOffers([], { outstandingProposalIds: new Set(['prop_abc123']), analysisReady: { may_run: true }, analysisState: {}, modelExists: true }), 'nothing is invented').toEqual([]);
    });
  });
  /**
   * ⛔ Independent review of #1792 (5806428423): the same-process cache cannot carry a replay
   * across a restart or another worker. The Run offer is persisted WITH the answer row and read
   * back from that exact row; these replays run on a FRESH route instance (empty cache, empty
   * proposal store), so only the durable record can supply the offer.
   */
  describe('a replay in a FRESH process recovers the Run offer from the committed row', () => {
    const approveBody = (T: string) => ({ kind: 'message', scenario_id: SCENARIO, message: 'Yes, make that change.', source: 'chip', chip: { id: lastApproveId }, turn_id: T });
    const onFresh = async (payload: Record<string, unknown>) => {
      const fresh = await buildRouteApp();
      try {
        const r = await fresh.inject({ method: 'POST', url: '/agent/v1/turn', payload });
        expect(r.statusCode).toBe(200);
        return r.json() as { suggested_actions: Chip[]; _agent: { replayed?: boolean } };
      } finally { await fresh.close(); }
    };

    it('approve (it ran once), lose the response, the process restarts, retry → no Run offer was persisted and none is invented; no second run, 0 model calls, 0 writes', async () => {
      readiness = { status: 'needs_user_input', may_run: true };
      const T = '61111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      expect(runs, 'the approving turn ran the analysis once').toBe(1);
      const row = rows.get(`${SCENARIO}:${T}`)!;
      expect((row.pending_actions as { chip_id?: string }[]).some((p) => p.chip_id === 'agent-run-analysis'), 'it ran: no Run offer persisted').toBe(false);
      const writes = edges.length; const calls = modelBodies.length;
      const again = await onFresh(approveBody(T));
      expect(again._agent.replayed, 'the real replay path, on a fresh instance').toBe(true);
      expect(again.suggested_actions.filter((c) => c.action_type === 'run_analysis')).toEqual([]);
      expect(runs).toBe(1);
      expect(modelBodies.length - calls).toBe(0);
      expect(edges.length - writes).toBe(0);
    });

    it('CONTRAST: today\'s readiness no longer admits a run → the durable offer is NOT re-offered', async () => {
      readiness = { status: 'needs_user_input', may_run: true };
      const T = '71111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      readiness = { status: 'ready', may_run: false };
      expect((await onFresh(approveBody(T))).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: a current analysis already exists → not re-offered', async () => {
      readiness = { status: 'ready', may_run: true };
      const T = '81111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      analysisState = { run_state: { kind: 'complete_current' } };
      expect((await onFresh(approveBody(T))).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: the ORIGINAL turn offered no Run (not admitted then) and the model became ready since → none; a historical absence confers nothing', async () => {
      readiness = { status: 'needs_user_input', may_run: false };
      const T = '91111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      expect(rows.get(`${SCENARIO}:${T}`)!.pending_actions).toEqual([]);
      readiness = { status: 'ready', may_run: true };
      expect((await onFresh(approveBody(T))).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: the persisted offer has expired (its own 10-minute lifetime) → none', async () => {
      readiness = { status: 'ready', may_run: true };
      const T = 'a1111111-2222-4333-8444-555555555555';
      await proposeThenApprove(T);
      const row = rows.get(`${SCENARIO}:${T}`)!;
      row.pending_actions = row.pending_actions.map((pa) => ({ ...(pa as Record<string, unknown>), expires_at_iso: '2020-01-01T00:00:00.000Z' }));
      expect((await onFresh(approveBody(T))).suggested_actions.some((c) => c.action_type === 'run_analysis')).toBe(false);
    });

    it('CONTRAST: an approve chip fails closed after a restart — its proposal lived in the old process', async () => {
      readiness = { status: 'needs_user_input', may_run: false };
      const T = 'b1111111-2222-4333-8444-555555555555';
      const first = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.', turn_id: T } });
      expect((first.json() as { suggested_actions: Chip[] }).suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'the control: offered originally').toBe(true);
      const again = await onFresh({ kind: 'message', scenario_id: SCENARIO, message: 'Team size strongly drives velocity, so connect them.', turn_id: T });
      expect(again._agent.replayed).toBe(true);
      expect(again.suggested_actions.some((c) => c.id.startsWith('agent-approve-proposal:')), 'never an approval for a proposal this process does not hold').toBe(false);
    });
  });
});
