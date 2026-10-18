/** S3-2 r4: whole-reply obligation, not a new runtime gate. Reuses the real
 * goal-chance-screen-lines.route.test.ts route/Run/session harness and fixtures.
 * B2 mutations are constructed controls, not additional served evidence. */
import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { projectCanonicalAnalysisView } from '../../../routes/canonical-analysis-view.js';
import { OBLIGATIONS } from '../../claims/claim-licence-registry.js';
import { AT_REST_WORD_BOUND, textAtRest, statedTargetWords, untestedHorizonLine } from '../decision-input-ask.js';
import { ZERO_SPREAD_NEEDS_MONTHLY_CHANGES } from '../../goal-target/zero-spread-horizon-line.js';
import type { ReplyComposeInput } from '../reply/compose-reply.js';

type Json = Record<string, any>;
const fixture = (name: string): Json => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')) as Json;
const READ_B3 = fixture('waveB3-unseen2-7addf05-readback-run1.json').j;
const READ_B1 = fixture('r11b-head-b1.json');
const RANGE_B2 = fixture('guided-sizing-range-wins.json');
const BASELINE = JSON.parse(readFileSync(new URL('../../../../scripts/ci/claim-licence-baseline.json', import.meta.url), 'utf8')) as { obligationGaps: string[] };
const SCENARIO = '7a5e4d3c-2b1a-4d0e-9f8a-7b6c5d4e3f2a';
// Constructed B2 narration with an unresolved question and a substantial reasoning
// account. #2843 removed the old duplicate horizon question, so none is scripted here.
// The identical narration is replayed through the explicit-Run positive control.
const B2_BRIEF = 'Explore launching a starter tier, keeping current plans, and improving the pro plan. Our goal is £80,000 monthly recurring revenue within 9 months. The current level is £50,000 per month. Keep the uncertain price-to-subscriber relationship visible.';
const B2_NARRATION = `The model keeps three approaches to pricing in view: launching a starter tier, keeping the current plans, and improving the pro plan. These approaches depend on different assumptions about who will subscribe, what they will pay, and how existing customers will respond. The starter tier connects its price to subscriber numbers and then to monthly recurring revenue. The size of that first relationship still needs evidence, while the second uses an Olumi estimate. Keep these differences visible when the team reviews the model.

Before changing the model, compare the assumptions with customer interviews, recent subscription behaviour, and the evidence behind each relationship. Check whether the proposed offer reaches a different group of customers or changes how existing customers choose their plan. Record the source and the limits of any evidence you add. A finding from a small customer sample should remain open to challenge, and team members should be able to preserve competing explanations. The model can then evolve as people clarify what they believe, why they believe it, and which observation would help resolve the remaining uncertainty.

Questions this model does not answer yet:

How strongly does Starter tier price affect Starter subscribers?`;
const MIXES = ['all-figure', 'range+withheld', 'all-withheld', 'no-Run draft', 'no-H', 'range+withheld Run control'] as const;
type Mix = typeof MIXES[number];
let read: Json;
let result: Json;
let noRun = false;
let buildTurn = false;
let firstRunDispatches = 0;
let savedGraph: Json;
let composeInput: ReplyComposeInput | undefined;
let outputs: Record<string, unknown>[][] = [];
const measuredGaps: string[] = [];
const rows = new Map<string, Json>();
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async (_sid: string, id: string) => rows.get(id) ?? null),
  append: vi.fn(async (w: Json) => {
    rows.set(w.turn_id, { ...w, assistant_message: w.assistantMessage, user_message: w.userMessage, id: w.turn_id });
    return { id: w.turn_id };
  }),
  readRecent: vi.fn(async () => []), readFactsFor: vi.fn(async () => []),
  readAnalysisInvalidatedAt: vi.fn(async () => null),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async original => ({
  ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }),
}));
vi.mock('../reply/compose-reply.js', async original => {
  const actual = await original<typeof import('../reply/compose-reply.js')>();
  return { ...actual, composeReplyShape: (input: ReplyComposeInput) => {
    composeInput = input;
    return actual.composeReplyShape(input);
  } };
});
// Construction's external generation/storage only. The actual build capability,
// host A7, readback, cell readers, egress and composer are retained (build-route harness).
vi.mock('../runtime/build-model.js', async original => ({
  ...await original<Record<string, unknown>>(),
  buildModelFromBrief: async (scenarioId: string, _brief: unknown,
    dispatch: (path: string, body: unknown) => Promise<unknown>) => {
    await dispatch(`/assist/v1/scenarios/${scenarioId}/graph/register`, { graph: structuredClone(read.graph) });
    return { ok: true, mutated: true, model_version: { version_number: 1 }, graph_hash: read.graph_hash };
  },
}));
vi.mock('../../drafter-raw/index.js', () => ({
  buildWithDrafterRawRecord: async (_ctx: unknown, _brief: unknown, _op: unknown, call: unknown,
    build: (drafter: unknown) => Promise<unknown>) => build(call),
}));

// As in one-reply-build-contract.route.test.ts, only the external first-Run
// orchestration is scripted; real admission, capability, readback and reply code run.
vi.mock('../../handlers/chip-click-dispatch.js', async original => ({
  ...await original<Record<string, unknown>>(),
  dispatchChipClickRunAnalysis: async () => {
    firstRunDispatches += 1;
    expect(noRun, 'the no-Run draft must not dispatch a first analysis').toBe(false);
    return { outcome: 'ok', commitPerformed: true, graph: savedGraph, mayNameLeadingOption: false,
      analysisReady: read.analysis_ready,
      response: { response_version: 2, assistant_text: 'The analysis ran.', suggested_actions: [], insights: [],
        blocks: [result], analysis_state: read.analysis_state } };
  },
}));

const ratchetFailures = (gaps: readonly string[], baseline: readonly string[]) => ({
  newGaps: gaps.filter(id => !baseline.includes(id)),
  fixedStillListed: baseline.filter(id => !gaps.includes(id)),
});

function useMix(mix: Mix): void {
  noRun = mix === 'no-Run draft';
  buildTurn = noRun || mix === 'range+withheld';
  if (mix === 'all-withheld' || noRun) {
    read = structuredClone(READ_B1);
    result = structuredClone(read.analysis_result);
  } else {
    read = structuredClone(READ_B3);
    read.graph = structuredClone(RANGE_B2.graph);
    read.graph.nodes.find((node: Json) => node.kind === 'goal').goal_horizon_months = 9;
    read.graph.nodes.push({ id: 'pricing', kind: 'decision', label: 'Pricing strategy' });
    for (const edge of read.graph.edges) {
      edge.exists_probability = 1; edge.effect_direction = 'positive';
      if (edge.provenance !== undefined) edge.provenance.source = 'cee_hypothesis';
    }
    for (const [id, label] of [['keep', 'Keep current plans'], ['pro', 'Improve pro plan']]) {
      read.graph.nodes.push({ id, kind: 'option', label, interventions: { price: 0.5 } });
    }
    // The range leaf fixture has no option-to-factor edges; add the committed
    // intervention paths so the real first-analysis admission can run it.
    for (const id of ['starter', 'keep', 'pro']) read.graph.edges.push(
      { from: id, to: 'price', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'pricing', to: id, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' });
    result = { ...structuredClone(RANGE_B2.run), type: 'analysis_result' };
    result.enrichment.option_comparison = ['starter', 'keep', 'pro'].map(option_id => ({ option_id, id: option_id,
      label: read.graph.nodes.find((node: Json) => node.id === option_id).label,
      option_label: read.graph.nodes.find((node: Json) => node.id === option_id).label, status: 'computed' }));
    if (mix === 'all-figure' || mix === 'no-H') {
      result.enrichment.inference_warnings = [{ code: 'GOAL_CHANCE_LICENSED', severity: 'info',
        message: 'Each option’s chance is licensed.', form: 'each', option_ids: ['starter', 'keep', 'pro'],
        pct_by_option: { starter: 37, keep: 5, pro: 20 },
        target: { comparator: 'at_least', value: 80000, unit: '£/month' } }];
    } else {
      result.enrichment.inference_warnings.push({ code: 'GOAL_FIGURES_MISSING_CURRENT_LEVEL', severity: 'warning',
        message: 'Not shown. The current level is missing.', option_ids: ['keep', 'pro'],
        detail: { reason: 'missing_goal_baseline' } });
    }
    if (mix === 'no-H') delete read.graph.nodes.find((node: Json) => node.kind === 'goal').goal_horizon_months;
  }
  // A genuinely incomplete draft is not admissible for an automatic first Run.
  if (noRun) read.graph.edges = [];
  savedGraph = buildTurn ? { nodes: [], edges: [] } : read.graph;
}

describe('HORIZON_LIMIT_STATED through the real route (zero-gap target)', () => {
  let app: FastifyInstance;
  let seq = 0;
  beforeAll(async () => {
    vi.stubEnv('AGENT_LANE_ENABLED', 'true'); vi.stubEnv('AGENT_LANE_PREVIEW', 'false');
    vi.stubGlobal('fetch', vi.fn(async (_url: unknown, init?: { body?: string }) => {
      const req = JSON.parse(String(init?.body ?? '{}')) as Json;
      if (req.tool_choice?.name === 'give_provisional_view') return new Response(JSON.stringify({ output: [{
        type: 'function_call', name: 'give_provisional_view', call_id: 'forced', arguments: JSON.stringify({
          view: 'Review the recorded assumptions.', reasoning: 'A link remains unsized.', confirm_step: 'Size the link to continue.',
        }),
      }] }), { status: 200 });
      const output = outputs.shift() ?? [{ type: 'message', content: [{ type: 'output_text', text: 'Done.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
    vi.resetModules();
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/orchestrate/v2/turn', async () => {
      expect(noRun, 'the draft control must never Run').toBe(false);
      return { response_version: 2, assistant_text: 'ran', suggested_actions: [], insights: [], graph_hash: read.graph_hash,
        blocks: [result], analysis_ready: read.analysis_ready, analysis_state: read.analysis_state };
    });
    app.post('/assist/v1/scenarios/:id/graph/register', async req => {
      savedGraph = (req.body as Json).graph;
      return { registered: true, graph_hash: read.graph_hash, model_version: { version_number: 1 } };
    });
    app.post('/assist/v1/scenarios/:id/versions', async () => ({ versions: [], next_cursor: null }));
    app.post('/assist/v1/scenarios/:id/graph', async () => {
      if (noRun || savedGraph.nodes.length === 0) {
        const analysis_state = { run_state: { kind: 'never_run' } };
        return { graph: savedGraph, graph_hash: read.graph_hash, analysis_state,
          canonical_analysis_view: projectCanonicalAnalysisView({ graph: savedGraph, analysisState: analysis_state as never }) };
      }
      return { graph: savedGraph, graph_hash: read.graph_hash, analysis_result: result,
        analysis_state: read.analysis_state, analysis_ready: read.analysis_ready,
        canonical_analysis_view: projectCanonicalAnalysisView({ graph: savedGraph,
          runFact: { fact_type: 'run_analysis', fact_version: 1, noop: false, result: {
            scenario_id: SCENARIO, run_id: 'fixture-obligation-run', summary: result.summary,
            leading_option_id: result.leading_option_id, enrichment: result.enrichment,
            graph_hash_at_run: read.graph_hash, computed_at: read.analysis_state.run_state.computed_at,
          } } as never, analysisState: read.analysis_state as never, analysisReady: read.analysis_ready,
          currentResult: result as never }) };
    });
    await app.register(agentV1TurnRoute); await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  beforeEach(() => { rows.clear(); outputs = []; composeInput = undefined; firstRunDispatches = 0; });

  it.each(MIXES)('%s: measure the held horizon on any assistant_text surface', async mix => {
    useMix(mix);
    const goal = read.graph.nodes.find((node: Json) => node.kind === 'goal')!;
    // No accumulation identity, evaluated or otherwise, exists in these fixtures.
    expect(read.graph.nodes.some((node: Json) => node.nonlinear_identity?.operation === 'accumulation')).toBe(false);
    const h = goal.goal_horizon_months as number | undefined;
    const required = typeof h === 'number' && h > 0;
    // withinMonths is private: obtain its exact phrase through the existing public
    // horizon formatter, which also calls statedTargetWords. No generic /horizon/ match.
    const formatted = untestedHorizonLine(read.graph);
    const phrase = formatted?.match(/within \d+(?:\.\d+)? months?/u)?.[0] ?? null;
    if (required) {
      expect(phrase).toBe(`within ${h} ${h === 1 ? 'month' : 'months'}`);
      const target = statedTargetWords(read.graph);
      if (target !== null) expect(formatted).toContain(target);
    } else {
      expect(phrase).toBeNull();
    }
    const narration = mix.startsWith('range+withheld') ? B2_NARRATION
      : buildTurn ? 'Olumi built your pricing model.' : 'The analysis ran.';
    if (mix.startsWith('range+withheld')) {
      expect(textAtRest(narration).trim().split(/\s+/u).length).toBeGreaterThan(AT_REST_WORD_BOUND);
      expect(textAtRest(narration)).not.toBe(narration);
      expect(narration).not.toContain(phrase!);
    }
    const tool = buildTurn ? 'build_model_from_brief' : 'run_analysis';
    const brief = noRun ? READ_B1.brief : B2_BRIEF;
    outputs = [[{ type: 'function_call', name: tool, call_id: 'c1', arguments: JSON.stringify(buildTurn
      ? { brief } : { reason: 'compare' }) }],
    [{ type: 'message', content: [{ type: 'output_text', text: narration }] }]];
    seq += 1;
    const response = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: {
      kind: 'message', scenario_id: SCENARIO, message: buildTurn ? brief : 'Run it',
      turn_id: `9c3d4e5f-6a7b-4c8d-9e0f-${String(seq).padStart(12, '0')}`,
    } });
    expect(response.statusCode, response.body).toBe(200);
    const body = response.json() as Json;
    expect(body._agent.tool_calls).toContainEqual(expect.objectContaining({ name: tool, ok: true }));
    expect(composeInput?.faceContract).toBe(buildTurn ? 'draft' : 'run');
    expect(firstRunDispatches, JSON.stringify(body._diagnostic_trace.first_analysis)).toBe(buildTurn && !noRun ? 1 : 0);
    if (buildTurn && !noRun) expect(body._diagnostic_trace.first_analysis).toMatchObject({ ran: true });
    if (noRun) {
      expect(body._diagnostic_trace.first_analysis).toMatchObject({ ran: false, reason: 'not_admissible' });
      expect(body._agent.tool_calls.some((call: Json) => call.name === 'run_analysis')).toBe(false);
    }
    const cells = composeInput?.chanceCells?.map(cell => cell.kind) ?? [];
    const expectedCells = noRun ? [] : mix.startsWith('range+withheld') ? ['range', 'withheld', 'withheld']
      : mix === 'all-withheld' ? ['withheld', 'withheld'] : ['figure', 'figure', 'figure'];
    expect(cells, 'control: measure the intended canonical cell mix').toEqual(expectedCells);
    const text = body.assistant_text as string;
    const stated = (phrase !== null && text.includes(phrase)) || text.includes(ZERO_SPREAD_NEEDS_MONTHLY_CHANGES);
    const gap = required && !stated;
    const id = `HORIZON_LIMIT_STATED:${mix}`;
    if (gap) measuredGaps.push(id);
    process.stdout.write(`HORIZON_OBLIGATION ${JSON.stringify({ mix, entry: buildTurn ? 'build' : 'Run', h: h ?? null, required, phrase, cells, stated, gap, assistant_text: text })}\n`);
    expect(gap && !BASELINE.obligationGaps.includes(id), `NEW obligation gap: ${id}\n${text}`).toBe(false);
    expect(!gap && BASELINE.obligationGaps.includes(id), `Fixed gap still listed; ratchet down: ${id}\n${text}`).toBe(false);
    if (!required) expect(gap, 'no-H is outside the obligation trigger').toBe(false);
  });

  it('baseline is exactly today’s obligation gaps, with no duplicates or stale mixes', () => {
    expect(Object.keys(OBLIGATIONS)).toEqual(['HORIZON_LIMIT_STATED']);
    expect(OBLIGATIONS.HORIZON_LIMIT_STATED.surfaces).toEqual(['face', 'detail', 'withhold_line']);
    expect(OBLIGATIONS.HORIZON_LIMIT_STATED.owners).toHaveLength(3);
    expect(new Set(BASELINE.obligationGaps).size).toBe(BASELINE.obligationGaps.length);
    expect(ratchetFailures(measuredGaps, BASELINE.obligationGaps)).toEqual({ newGaps: [], fixedStillListed: [] });
  });

  it('ratchet controls reject a new gap and a fixed gap still recorded', () => {
    expect(ratchetFailures(['new'], [])).toEqual({ newGaps: ['new'], fixedStillListed: [] });
    expect(ratchetFailures([], ['fixed'])).toEqual({ newGaps: [], fixedStillListed: ['fixed'] });
    expect(ratchetFailures([], [])).toEqual({ newGaps: [], fixedStillListed: [] });
  });
});
