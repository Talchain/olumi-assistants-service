/**
 * ⛔ A RUN'S REPLY TAKES ITS REASON FROM THE ENGINE'S TYPED OUTCOME (DL #72 5867687155 + AIQ 5867754251; one seam,
 * DL order 5867785083).
 *
 * Two served defects, both on the Run button (the Agent route's fast path 3):
 *   - served `9cd467e`, journey C run 2 (scenario `9ca6b263`, 09:21Z): the Run turn answered 200 with no result, because
 *     the engine refused the request (ISL 422). The readback carried a separate, NON-blocking readiness issue
 *     (`MISSING_OPTION_VALUE`, `may_run: true`), and the interpreting model said "The analysis did not run because the
 *     50/50 option has no setting for whether the new feature is available." That is a false reason;
 *   - served `d202fc5` (AIQ R3-W, scenario `8103c8ce`): ISL withheld the analysis on a stated identity that does not add
 *     up. CEE composed the one ask that unblocks it ("The figures don't add up: … Which is right?" with "Check the
 *     figures"). The reply was the model's own prose, and the chip never reached the user.
 *
 * The rule (`run-outcome.ts`): a Run with no result whose typed outcome is the engine's (`blocked_reason` in
 * `ENGINE_RUN_OUTCOMES`), or that carries the identity chip, is said in CEE's own words for that outcome, verbatim,
 * with that outcome's own chips. No model is called, so nothing can substitute a readiness issue. A Run that READINESS
 * stopped is explained as before, and the readiness ask is named. The Run turn's shapes below are the recoverable
 * handler's own (`composeRecoverableHandlerResponse` + `buildAnalysisRefusalReadiness`).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { runOutcomeOf } from '../run-outcome.js';

const SCENARIO = '9ca6b263-a672-4017-a80b-925d4681fb2c';
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

// The Run turn's own words, per outcome: `composeHandlerFailureBody`'s copy (generic `analysis_blocked`; the identity ask).
const ENGINE_WORDS = "The analysis engine couldn't proceed with the current scenario. Try simplifying options or constraints, then run again.";
const STATUS_CHIP = { id: 'chip_prompt_show_scenario_status', label: 'Show scenario status', message: 'Show me the current status of my scenario.' };
const BUSY_WORDS = 'The analysis engine is busy right now. Nothing is wrong with your model. Please try again in a few seconds.';
const RETRY_CHIP = { id: 'chip_action_retry_analysis', label: 'Retry', message: 'Run the analysis again.', action_type: 'run_analysis' };
const IDENTITY_WORDS = "The figures don't add up: Pro plan price × Paying Pro subscribers gives £74,970/month, but you said MRR is £93,000/month. Which is right?";
const IDENTITY_CHIP = { id: 'chip_prompt_identity_identity_inconsistent', label: 'Check the figures', message: 'My MRR figure is right; the rest of MRR comes from elsewhere.' };
const READINESS_WORDS = 'The analysis can’t run yet: the option "50/50" has no level for "New feature availability".';
// What the served interpreting call said (the false reason). If any model is called, this is what it says.
const FALSE_REASON = 'The analysis did not run because the 50/50 option has no setting for whether the new feature is available.';

type Mode = 'engine' | 'busy' | 'identity' | 'readiness';
const RUN_TURN: Record<Mode, Record<string, unknown>> = {
  engine: { assistant_text: ENGINE_WORDS, suggested_actions: [STATUS_CHIP], analysis_ready: { status: 'blocked', blocked_reason: 'analysis_blocked' } },
  busy: { assistant_text: BUSY_WORDS, suggested_actions: [RETRY_CHIP], analysis_ready: { status: 'blocked', blocked_reason: 'analysis_engine_busy' } },
  identity: { assistant_text: IDENTITY_WORDS, suggested_actions: [IDENTITY_CHIP], analysis_ready: { status: 'blocked', blocked_reason: 'analysis_blocked' } },
  readiness: { assistant_text: READINESS_WORDS, suggested_actions: [], analysis_ready: { status: 'blocked', blocked_reason: 'options_not_configured' } },
};

describe('⛔ a Run with no result says the engine’s typed outcome, never a readiness issue it did not stop on', () => {
  let app: FastifyInstance;
  let modelCalls = 0;
  let mode: Mode = 'engine';
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      modelCalls += 1;
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: FALSE_REASON }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => ({ response_version: 2, insights: [], graph_hash: 'h1', blocks: [], ...RUN_TURN[mode] }));
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      // The served readback: one option lacks a level (a NON-blocking readiness issue), and no run is on record.
      graph: {
        nodes: [
          { id: 'd', kind: 'decision', label: 'Which plan?' },
          { id: 'o1', kind: 'option', label: 'Features', interventions: { f: 1 } },
          { id: 'o2', kind: 'option', label: '50/50', interventions: {} },
          { id: 'f', kind: 'factor', label: 'New feature availability' },
          { id: 'g', kind: 'goal', label: 'MRR' },
        ],
        edges: [{ from: 'd', to: 'o1' }, { from: 'd', to: 'o2' }, { from: 'o1', to: 'f' }, { from: 'o2', to: 'f' }, { from: 'f', to: 'g' }],
      },
      graph_hash: 'h1',
      analysis_state: { run_state: { kind: 'never_run' }, leader_claim: { permitted: false, withheld_reason: 'constraint_verdict_withheld' } },
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  });
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); });
  beforeEach(() => { modelCalls = 0; mode = 'engine'; });

  const run = async () => {
    const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.', source: 'chip_click', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' },
    } });
    expect(r.statusCode).toBe(200);
    return r.json() as { assistant_text: string; suggested_actions: { id: string; label: string; message: string }[] };
  };

  it('RED (served 9cd467e, engine refused): the reply is the engine’s outcome in Olumi’s words, the option is never named, no model is called', async () => {
    const b = await run();
    expect(b.assistant_text.startsWith(ENGINE_WORDS), b.assistant_text).toBe(true);
    expect(b.assistant_text).not.toContain(FALSE_REASON);
    expect(b.assistant_text).not.toMatch(/50\/50|New feature availability/);
    expect(modelCalls, 'nothing interprets it').toBe(0);
    expect(b.suggested_actions.map((a) => a.id)).toContain(STATUS_CHIP.id);
    expect(b.suggested_actions.map((a) => a.id), 'not a model gap: no "what it still needs"').not.toContain('agent-suggest-what-it-needs');
  });

  it('RED (engine busy): the retry the engine offered is offered, as a Run', async () => {
    mode = 'busy';
    const b = await run();
    expect(b.assistant_text.startsWith(BUSY_WORDS), b.assistant_text).toBe(true);
    expect(modelCalls).toBe(0);
    expect(b.suggested_actions).toContainEqual(expect.objectContaining({ id: RETRY_CHIP.id, action_type: 'run_analysis' }));
  });

  it('RED (AIQ R3-W, served d202fc5): IDENTITY_NOT_EVALUATED → the ask verbatim, and its "Check the figures" chip', async () => {
    mode = 'identity';
    const b = await run();
    expect(b.assistant_text.startsWith("The figures don't add up:"), b.assistant_text).toBe(true);
    expect(b.assistant_text).toContain(IDENTITY_WORDS);
    expect(modelCalls).toBe(0);
    expect(b.suggested_actions).toContainEqual(expect.objectContaining({ id: IDENTITY_CHIP.id, label: 'Check the figures', message: IDENTITY_CHIP.message }));
  });

  it('CONTROL (readiness stopped it): explained as before — the one interpreting call, and the next-step chip', async () => {
    mode = 'readiness';
    const b = await run();
    expect(modelCalls, 'the readiness refusal is still interpreted').toBe(1);
    expect(b.suggested_actions.map((a) => a.id)).toContain('agent-suggest-what-it-needs');
  });

  it('the reader, by type: a result, a readiness cause and an untyped outcome are never an engine outcome', () => {
    expect(runOutcomeOf({ ...RUN_TURN.engine, blocks: [{ type: 'analysis_result', data: {} }] })).toBeUndefined();
    expect(runOutcomeOf(RUN_TURN.readiness)).toBeUndefined();
    // Today's served defect in reverse (DL CHANGES_REQUIRED on #2233, mutant 1a): no readiness or model-side cause is
    // ever read as the engine's, whatever its words and chips.
    for (const reason of ['MISSING_OPTION_VALUE', 'analysis_not_ready', 'args_validation_failed']) {
      expect(runOutcomeOf({ ...RUN_TURN.engine, analysis_ready: { status: 'blocked', blocked_reason: reason } }), reason).toBeUndefined();
    }
    // A model that MOVED is its own typed outcome (DL #2233 follow-up 1), never the engine's and never readiness.
    expect(runOutcomeOf({ ...RUN_TURN.engine, analysis_ready: { status: 'blocked', blocked_reason: 'analysis_snapshot_diverged' } })?.kind).toBe('moved');
    expect(runOutcomeOf({ assistant_text: ENGINE_WORDS, analysis_ready: { status: 'blocked' } })).toBeUndefined();
    expect(runOutcomeOf({ ...RUN_TURN.engine, assistant_text: '  ' })).toBeUndefined();
    expect(runOutcomeOf(RUN_TURN.identity)).toEqual({ kind: 'identity_ask', text: IDENTITY_WORDS, chips: [IDENTITY_CHIP] });
    expect(runOutcomeOf(RUN_TURN.engine)).toEqual({ kind: 'engine', reason: 'analysis_blocked', text: ENGINE_WORDS, chips: [STATUS_CHIP] });
  });
});
