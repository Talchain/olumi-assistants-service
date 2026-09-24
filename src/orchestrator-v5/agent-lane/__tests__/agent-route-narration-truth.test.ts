/**
 * ⛔ THREE WAYS THE AGENT ROUTE TOLD THE USER SOMETHING ITS OWN STATE DID NOT SUPPORT
 * (Panel, #63 5811761386, measured on served staging b53f0980).
 *
 *   (7) A re-run could not say what changed. The route finalised with `{ scenarioId }` only,
 *       so `attachRunDelta` took its `prior_facts_absent` exit and no `run_delta` was ever
 *       stamped on an Agent turn — while Conventional threads the facts (route-v2.ts).
 *   (8) The narration named a leader ("…favours adding the £89 Enterprise tier") beside
 *       `analysis_state.leader_claim.permitted: false`, because the instruction said "say which
 *       option leads … and how firmly" with no condition on the permission.
 *   (9) The approval ask promised a run ("…and I'll save it and run the comparison"), because an
 *       instruction said "After authorise_change … call run_analysis in the SAME turn" — against
 *       the zero-call approve path and the acceptance rule "no automatic Run on approval".
 *
 * ⭐ PRODUCTION-SHAPED. The run handler PERSISTS a `run_analysis` fact stamped with the real
 * `computeAnalysisAffectingGraphHash` of the graph it analysed; the graph read serves the REAL
 * `readScenarioAnalysis` over that same store, so `analysis_state` / `analysis_result` are the
 * product's own composition, and `run_delta` is built by the real producer. Nothing here returns
 * a delta or a verdict that a fake wrote by hand.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import type { HandlerFact } from '@talchain/schemas/orchestrator';
import { runAnalysisFact } from '../../context/__tests__/run-delta-fixtures.js';

const SCENARIO = '6c1d2e3f-4a5b-4c6d-8e7f-9a0b1c2d3e4f';

/** The product's session store, reduced to the reads the analysis path makes. Newest first, like Supabase. */
const persisted: { id: string; fact: HandlerFact }[] = [];
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-answer' })),
  readRecent: vi.fn(async () => [...persisted].reverse().map((p) => ({ id: p.id, turn_class: 'handler', handler_id: 'run_analysis' }))),
  readFactsFor: vi.fn(async (ids: readonly string[]) => [...persisted].reverse().filter((p) => ids.includes(p.id)).map((p) => p.fact)),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

/** A small model the analysis can run over. `observed_state.value` is analysis-affecting, so an edit moves the hash. */
function graphWith(capacity: number): Record<string, unknown> {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Delivery' },
      { id: 'opt-a', kind: 'option', label: 'Offshore partner', interventions: { fac: 1 } },
      { id: 'opt-b', kind: 'option', label: 'Hire locally', interventions: { fac: 0.5 } },
      { id: 'fac', kind: 'factor', label: 'Capacity', observed_state: { value: capacity } },
    ],
    edges: [
      { from: 'opt-a', to: 'fac' },
      { from: 'opt-b', to: 'fac' },
      { from: 'fac', to: 'goal', strength: { mean: 0.6, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' },
    ],
  };
}

/**
 * The fact the product's run handler persists (`tools/handlers/run-analysis.ts`): the shared fixture's
 * PLoT envelope and echoes, plus the CEE-owned identity the handler stamps beside them — `scenario_id`
 * and `leading_option_id`. Without `scenario_id` the run-fact identity binding is `unconfirmed` and the
 * product itself withholds the analysis, so a fixture lacking it would test a state the handler never writes.
 */
function productRunFact(options: readonly { id: string; win: number }[], hash: string, at: string, mayName: boolean): HandlerFact {
  const base = runAnalysisFact(options, '111', hash, at, mayName) as unknown as { result: Record<string, unknown> & { enrichment: Record<string, unknown> } };
  const leader = [...options].sort((x, y) => y.win - x.win)[0]!.id;
  return { ...base, result: {
    ...base.result,
    scenario_id: SCENARIO,
    leading_option_id: leader,
    // PLoT's envelope carries its robustness verdict; without it the product withholds the leader as `separation_unavailable`.
    enrichment: { ...base.result.enrichment, robustness: { level: 'robust', near_tie: { is_tie: false } } },
  } } as unknown as HandlerFact;
}

const RUN_CHIP = { kind: 'message', scenario_id: SCENARIO, message: 'Run analysis.', source: 'chip_click', chip: { id: 'agent-run-analysis', action_type: 'run_analysis' } };

describe('the Agent route tells the truth about runs, leaders and approvals', () => {
  let app: FastifyInstance;
  let graph = graphWith(0.4);
  /** Win probabilities the NEXT run will produce (the change flips the leader). */
  let nextRunOptions = [{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }];
  /** The next run's own persisted leader-claim verdict. */
  let nextRunMayName = true;
  let runs = 0;
  let modelBodies: Record<string, unknown>[] = [];
  /** Scripted outputs for tool-enabled (Agent) calls, in order; empty ⇒ a plain answer. */
  let agentScript: Record<string, unknown>[][] = [];
  let hashOf: (g: unknown) => string | null;

  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async (_u: unknown, init?: { body?: string }) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      modelBodies.push(body);
      if (body['tool_choice'] !== 'none' && agentScript.length > 0) {
        return new Response(JSON.stringify({ output: agentScript.shift() }), { status: 200 });
      }
      return new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: 'In the current model the comparison is close.' }] }] }), { status: 200 });
    }));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    const { readScenarioAnalysis } = await import('../../../routes/scenario-graph-analysis-read.js');
    const { computeAnalysisAffectingGraphHash } = await import('../../context/graph-hash.js');
    hashOf = (g) => computeAnalysisAffectingGraphHash(g as never);
    app = Fastify({ logger: false });
    // The product's run: it analyses the CURRENT graph and persists the fact, stamped with that graph's hash.
    app.post('/orchestrate/v2/turn', async (req) => {
      const chip = (req.body as { chip?: { action_type?: string } }).chip;
      if (chip?.action_type !== 'run_analysis') return { response_version: 2, assistant_text: 'unexpected', suggested_actions: [], insights: [], blocks: [] };
      runs += 1;
      const hash = hashOf(graph)!;
      const at = new Date(Date.UTC(2026, 8, 24, 9, runs)).toISOString();
      persisted.push({ id: `run-row-${runs}`, fact: productRunFact(nextRunOptions, hash, at, nextRunMayName) });
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: hash,
        blocks: [{ type: 'analysis_result', data: { run: runs } }], analysis_ready: { status: 'ready', options: [], blockers: [] } };
    });
    // The product's graph read: its hash and its analysis are composed by the real reader over the same store.
    app.post('/assist/v1/scenarios/:id/graph', async () => ({
      graph,
      graph_hash: hashOf(graph),
      ...(await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'test-readback' })),
    }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 300_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });
  beforeEach(() => {
    persisted.length = 0;
    graph = graphWith(0.4);
    nextRunOptions = [{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }];
    nextRunMayName = true;
    runs = 0;
    modelBodies = [];
    agentScript = [];
  });

  type Body = {
    run_delta?: { attribution_case: string; pair_provenance: { hash_equal: boolean; seed_equal: boolean }; leader: { changed: boolean; current_leading_option_id?: string; prior_leading_option_id?: string } };
    analysis_state?: { leader_claim?: { permitted?: boolean; withheld_reason?: string | null }; run_state?: { kind?: string } };
    blocks?: { type: string }[];
  };

  describe('(7) a re-run on the Agent route says what changed', () => {
    it('RED: the second Run after a change carries the run_delta the real producer builds; the first carries none', { timeout: 60_000 }, async () => {
      const first = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: RUN_CHIP });
      expect(first.statusCode).toBe(200);
      expect(runs).toBe(1);
      expect((first.json() as Body).run_delta, 'one run: nothing to compare, so nothing is claimed').toBeUndefined();

      // The user changes the model, and the change flips which option leads.
      const before = hashOf(graph);
      graph = graphWith(0.6);
      expect(hashOf(graph), 'precondition: the change is analysis-affecting').not.toBe(before);
      nextRunOptions = [{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }];

      const second = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: RUN_CHIP });
      expect(second.statusCode).toBe(200);
      expect(runs).toBe(2);
      const b = second.json() as Body;
      expect(b.analysis_state?.run_state?.kind, 'precondition: the readback verdict is current').toBe('complete_current');
      expect(b.run_delta, 'the re-run says what changed').toBeDefined();
      expect(b.run_delta!.pair_provenance.hash_equal, 'bound to the two persisted runs: different graphs').toBe(false);
      expect(b.run_delta!.pair_provenance.seed_equal).toBe(true);
      // ONE authority per response: the delta names a leader because this response's own verdict permits one.
      expect(b.analysis_state?.leader_claim?.permitted, 'precondition: the product permits the leader on this pair').toBe(true);
      expect(b.run_delta!.leader, 'the change flipped the leader, and the delta says so').toEqual(expect.objectContaining({ changed: true, prior_leading_option_id: 'opt-a', current_leading_option_id: 'opt-b' }));
    });

    it('CONTRAST: a turn that ran nothing ships no run_delta, even with a comparable pair already persisted', { timeout: 60_000 }, async () => {
      await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: RUN_CHIP });
      graph = graphWith(0.6);
      nextRunOptions = [{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }];
      const rerun = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: RUN_CHIP });
      expect((rerun.json() as Body).run_delta, 'precondition: the pair IS comparable').toBeDefined();
      const talk = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'What does that mean for us?' } });
      expect(talk.statusCode).toBe(200);
      expect(runs, 'the conversational turn ran nothing').toBe(2);
      expect((talk.json() as Body).run_delta, 'one run_delta per completed re-run — never on a turn that ran nothing').toBeUndefined();
    });

    it('CONTRAST: a leader-withheld pair never names a leader in the delta', { timeout: 60_000 }, async () => {
      nextRunMayName = false;
      await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: RUN_CHIP });
      graph = graphWith(0.6);
      nextRunOptions = [{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }];
      const b = (await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: RUN_CHIP })).json() as Body;
      expect(b.analysis_state?.leader_claim?.permitted, 'precondition: the product withholds the leader').toBe(false);
      expect(b.run_delta).toBeDefined();
      expect(b.run_delta!.leader.current_leading_option_id).toBeUndefined();
      expect(b.run_delta!.leader.prior_leading_option_id).toBeUndefined();
    });
  });

  describe('(8) a leader is named only when the analysis permits it', () => {
    const OLD_UNCONDITIONAL = 'Never call an option the winner, the best option or the recommended one; say which option leads in this model and how firmly.';

    it('RED: the conversation call is told to name a leader ONLY when leader_claim.permitted is true, and what to say when it is withheld', { timeout: 60_000 }, async () => {
      const { LEADER_CLAIM_INSTRUCTION } = await import('../../../routes/agent-v1-turn.js');
      await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Which option is ahead?' } });
      const sent = String(modelBodies[0]!['instructions']);
      expect(sent).toContain(LEADER_CLAIM_INSTRUCTION);
      expect(LEADER_CLAIM_INSTRUCTION).toMatch(/leader_claim/);
      expect(LEADER_CLAIM_INSTRUCTION).toMatch(/permitted/);
      expect(LEADER_CLAIM_INSTRUCTION).toMatch(/no option can be named as leading yet/i);
      expect(sent, 'the unconditional "say which option leads" is gone').not.toContain(OLD_UNCONDITIONAL);
    });

    it('RED: the Run interpreter (fast path 3) gets the condition AND the withheld permission it depends on', { timeout: 60_000 }, async () => {
      const { LEADER_CLAIM_INSTRUCTION } = await import('../../../routes/agent-v1-turn.js');
      nextRunMayName = false;
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: RUN_CHIP });
      expect(r.statusCode).toBe(200);
      expect(modelBodies).toHaveLength(1);
      expect(modelBodies[0]!['tool_choice']).toBe('none');
      expect(String(modelBodies[0]!['instructions'])).toContain(LEADER_CLAIM_INSTRUCTION);
      const outputs = (modelBodies[0]!['input'] as { type?: string; output?: string }[]).filter((i) => i.type === 'function_call_output');
      const run = JSON.parse(outputs.at(-1)!.output!) as { canonical_state?: { analysis_state?: { leader_claim?: { permitted?: boolean } } } };
      expect(run.canonical_state?.analysis_state?.leader_claim?.permitted, 'the interpreter is told the leader is withheld').toBe(false);
    });

    it('RED: when the Agent itself calls run_analysis, the result it reads carries the post-run leader_claim too', { timeout: 60_000 }, async () => {
      nextRunMayName = false;
      agentScript = [[{ type: 'function_call', name: 'run_analysis', call_id: 'c-run', arguments: JSON.stringify({ reason: 'the user asked' }) }]];
      const r = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Run it and tell me which is ahead' } });
      expect(r.statusCode).toBe(200);
      expect(runs).toBe(1);
      const answering = modelBodies[1]!;
      const outputs = (answering['input'] as { type?: string; call_id?: string; output?: string }[]).filter((i) => i.type === 'function_call_output' && i.call_id === 'c-run');
      expect(outputs).toHaveLength(1);
      const run = JSON.parse(outputs[0]!.output!) as { ran?: boolean; canonical_state?: { analysis_state?: { leader_claim?: { permitted?: boolean; withheld_reason?: unknown } } } };
      expect(run.ran).toBe(true);
      expect(run.canonical_state?.analysis_state?.leader_claim?.permitted, 'the permission travels with the run it describes').toBe(false);
      expect(typeof run.canonical_state?.analysis_state?.leader_claim?.withheld_reason).toBe('string');
    });
  });

  describe('(9) approval never promises or triggers a Run', () => {
    const OLD_RUN_AFTER_APPROVAL = 'After authorise_change applies values or option levels, call run_analysis in the SAME turn';

    it('RED: the conversation call is not told to run after authorise_change, and is told approval saves only', { timeout: 60_000 }, async () => {
      const { NO_RUN_ON_APPROVAL_INSTRUCTION } = await import('../../../routes/agent-v1-turn.js');
      await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: SCENARIO, message: 'Yes, use those.' } });
      const sent = String(modelBodies[0]!['instructions']);
      expect(sent, 'the run-after-approval instruction is gone').not.toContain(OLD_RUN_AFTER_APPROVAL);
      expect(sent).not.toMatch(/call run_analysis in the SAME turn/i);
      expect(sent).toContain(NO_RUN_ON_APPROVAL_INSTRUCTION);
      expect(NO_RUN_ON_APPROVAL_INSTRUCTION).toMatch(/do NOT call run_analysis/);
      expect(NO_RUN_ON_APPROVAL_INSTRUCTION).toMatch(/never (say|promise)/i);
      expect(NO_RUN_ON_APPROVAL_INSTRUCTION).toMatch(/Run analysis/);
    });
  });
});
