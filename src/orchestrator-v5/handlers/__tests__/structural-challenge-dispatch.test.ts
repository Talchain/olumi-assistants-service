/**
 * SCI-DEEP v1 — "Test without this link" asks about THE Run the user saw, recomputes through the ONE Run path, and
 * persists nothing. (PTL ruling programme-docs #87/5972622586.)
 *
 * Real `run_analysis` handler, real snapshot loader, the served c96fc4bb graph (Paul's MRR journey) — the harness of
 * `decision-flip-dispatch.test.ts` / `run-analysis-c1-seed-reuse.test.ts`. Run A is produced by the production registry;
 * the dispatch then challenges one link and must:
 *   S1 send PLoT Run A's request with exactly that link removed (no brief, baseline seed pinned) and compare claim by claim;
 *   S2 refuse a model edited since Run A as `stale` without asking PLoT;
 *   S3 refuse an ineligible link (a root-making removal, option wiring, an identity operand) without asking PLoT;
 *   S4 map a PLoT timeout to `timed_out`; S5 withhold when exploratory work is not permitted;
 *   S6 return `no_run` with no Run; S7 be deterministic for the same Run and link (NOT_RETAINED, recomputable);
 *   S8 refuse a late reply when the model changed during the recompute.
 * S1 answers with the REAL bank-2 PLoT body for model A and, for the candidate, that body carrying the live
 * current-engine recompute of A minus churn -> subscribers (p4, ISL f759de5): the honest no-effect case, through the real
 * licences. The "unchanged winner, changed consequence" verdicts are held by the comparator's real-envelope oracles
 * (coaching/__tests__/structural-challenge-compare.test.ts); a synthetic envelope cannot reach licensed figures here.
 */
import { createHash } from 'node:crypto';
import { StructuralChallengeResultV1Schema } from '@talchain/schemas';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PLoTError, PLoTTimeoutError, type PLoTClient, type PLoTClientRunOpts } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';

vi.mock('../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));
const turnContext = vi.hoisted(() => ({ current: null as unknown }));
const currentnessStore = vi.hoisted(() => ({ current: undefined as import('../../session/store.js').SessionStore | undefined }));
vi.mock('../../session/index.js', () => ({ getSessionStore: () => currentnessStore.current }));
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildTurnContext: vi.fn(async () => turnContext.current),
}));

import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { priorRunForSeed } from '../../coaching/seed-reuse.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../../run-analysis-snapshot-binding.js';
import * as registry from '../../tools/registry.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../../tools/handler-errors.js';
import { SessionReadError } from '../../session/store.js';
import { AnalysisSnapshotDivergedError } from '../../run-analysis-snapshot-binding.js';
import { createRegistry, resolveHandler } from '../../tools/registry.js';
import { dispatchStructuralChallenge, isExactlyThisRemoval, structuralChallengeRecomputeKey } from '../structural-challenge-dispatch.js';
import { structuralChallengePressId, structuralChallengeTurnFor, structuralChallengeTurnUnderLicence } from '../../agent-lane/method-turn/structural-challenge-turn.js';
import type { StructuralChallengeFinalRead } from '../structural-challenge-dispatch.js';
import { readScenarioAnalysis } from '../../../routes/scenario-graph-analysis-read.js';

type Rec = Record<string, any>;
const SCENARIO = 'c96fc4bb-ccd1-4615-a6d9-52c652e3e0e4';
const served = JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec };
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as V2RunResponseEnvelope;
/** Bank-2 model A's REAL PLoT body (ISL c40a6c2e), and the live current-engine recompute of A minus churn -> subscribers
 *  (programme-docs output/sci-deep-20261003/results/p4_link_removal_live.json, ISL f759de5; ISL frame x 106,250 = £). */
const REAL_A = JSON.parse(readFileSync(new URL('./fixtures/sci-deep-bank2-A.plot-body.json', import.meta.url), 'utf8')) as Rec;
const P4_A_MINUS_CHURN: Record<string, { w: number; g: number; m: number; s: number; churn: number }> = {
  raise_pro_price_to_59: { w: 1, g: 1, m: 0.8499399759903957 * 106250, s: 3.3306690738754696e-16 * 106250, churn: 0.8744 },
  status_quo: { w: 0, g: 0, m: 0.7058823529411763 * 106250, s: 2.220446049250313e-16 * 106250, churn: 0.8744 },
};
/** Bank-2 model A: the same MRR journey after Olumi's identity card was accepted (MRR = price x subscribers, read). */
const confirmed = JSON.parse(readFileSync(new URL('../../coaching/__tests__/fixtures/sci-deep-bank2/A-graph.json', import.meta.url), 'utf8')) as { graph: Rec };
const CHURN_LINK = { from_id: 'monthly_churn', to_id: 'paying_subscribers' };

function context(turnId: string, priorFacts: Rec[]) {
  return {
    stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
    messages: [{ role: 'user', content: 'run analysis' }], session_id: SCENARIO,
    request_id: turnId, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
    prior_turns: [], prior_facts: priorFacts, scenarioBriefText: null, persistedGraph: null,
  };
}
const payloadOf = (turnId: string) =>
  makeMessagePayload({ turn_id: turnId, scenario_id: SCENARIO, message: 'test without this link', turn_class: 'decide', stage: 'analyse' });

const hasLink = (g: Rec, from: string, to: string) => (g.edges as Rec[]).some((e) => e.from === from && e.to === to);

/** Rows by the graph sent: the shape of the live p4 result (B minus churn -> subscribers). */
function rowsFor(graph: Rec, options: Rec[]): Rec[] {
  const churnBites = hasLink(graph, 'monthly_churn', 'paying_subscribers');
  const table: Record<string, Rec> = churnBites
    ? { raise_price_to_59: { w: 0.8416, g: 0.5291, m: 83433.86, s: 8230.69 }, keep_current_price: { w: 0.1584, g: 0, m: 75000, s: 0 } }
    : { raise_price_to_59: { w: 1, g: 1, m: 90306.12, s: 0 }, keep_current_price: { w: 0, g: 0, m: 75000, s: 0 } };
  table.raise_pro_price_to_59 = table.raise_price_to_59;
  table.status_quo = table.keep_current_price;
  return options.map((o) => {
    const id = o.option_id ?? o.id;
    const r = table[id] ?? { w: 0, g: 0, m: 70000, s: 0 };
    return {
      option_id: id, option_label: o.label, win_probability: r.w, probability_of_goal: r.g,
      outcome: { mean: r.m, std: r.s, n_samples: 10_000, n_valid_samples: 10_000 },
    };
  });
}

function plotDouble(opts: { timeoutOnCandidate?: boolean; real?: boolean; candidateIslBuild?: string; candidateMutation?: (response: Rec) => void } = {}) {
  const runBodies: Rec[] = [];
  const runOpts: (PLoTClientRunOpts | undefined)[] = [];
  const client = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec, _id: string, invocationOpts?: PLoTClientRunOpts) => {
      runOpts.push(invocationOpts);
      runBodies.push(structuredClone(body));
      if (opts.timeoutOnCandidate && runBodies.length > 1) throw new PLoTTimeoutError('candidate timed out', 'run', 75_000, 75_000);
      const derived = String(parseInt(createHash('sha256').update(JSON.stringify(body.graph)).digest('hex').slice(0, 7), 16));
      const seedUsed = body.seed !== undefined ? String(body.seed) : derived;
      if (opts.real) {
        // The REAL A envelope; with the link removed, the same envelope carrying the live recompute's numbers.
        const response = structuredClone(REAL_A);
        delete response._source;
        if (!hasLink(body.graph as Rec, 'monthly_churn', 'paying_subscribers')) {
          for (const o of response.option_comparison as Rec[]) {
            const r = P4_A_MINUS_CHURN[o.option_id];
            Object.assign(o, { win_probability: r.w, probability_of_goal: r.g });
            Object.assign(o.outcome, { mean: r.m, std: r.s });
            for (const k of Object.keys(o.constraint_probabilities ?? {})) o.constraint_probabilities[k] = r.churn;
          }
          for (const c of (response.constraint_results ?? []) as Rec[]) c.probability = P4_A_MINUS_CHURN[c.option_id]?.churn ?? c.probability;
        }
        response.meta = { ...(response.meta as Rec), seed_used: seedUsed };
        if (runBodies.length > 1) opts.candidateMutation?.(response);
        return response as V2RunResponseEnvelope;
      }
      const response = structuredClone(happy) as Rec;
      response.option_comparison = rowsFor(body.graph as Rec, body.options as Rec[]);
      response.option_comparison_status = 'computed';
      response.results = (response.option_comparison as Rec[]).map((r) => ({ option_id: r.option_id, option_label: r.option_label, win_probability: r.win_probability }));
      response.fact_objects = [];
      response.review_cards = [];
      response.meta = { ...(response.meta as Rec), seed_used: seedUsed, n_samples: 10_000 };
      response._meta = { builds: { plot: 'p1', isl: runBodies.length > 1 && opts.candidateIslBuild !== undefined ? opts.candidateIslBuild : 'i1' } };
      // As the real ISL does (live p4): every identity the sent graph declares is reported as evaluated.
      response.identity_evaluations = ((body.graph as Rec).nodes as Rec[])
        .filter((n) => n.nonlinear_identity)
        .map((n) => ({ node_id: n.id, operation: n.nonlinear_identity.operation, factor_ids: n.nonlinear_identity.factor_ids, addends: [], evaluated: true }));
      if (runBodies.length > 1) opts.candidateMutation?.(response);
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
  return { client, runBodies, runOpts };
}

async function harness(opts: { timeoutOnCandidate?: boolean; graph?: Rec; real?: boolean; candidateIslBuild?: string; candidateMutation?: (response: Rec) => void; keepExploratory?: boolean } = {}) {
  currentnessStore.current = undefined;
  const graph = structuredClone(opts.graph ?? served.graph);
  // Execution-boundary tests need an actually licensed quantitative model. These historical captures predate
  // the current target-path admission: explicitly model the user confirming the identity and stating these sizes
  // BEFORE Run A, on this test copy only. The unchanged capture is tested separately as an exploratory refusal.
  if (!opts.keepExploratory) {
    const goal = graph.nodes.find((node: Rec) => node.id === 'mrr');
    goal.nonlinear_identity ??= structuredClone(confirmed.graph.nodes.find((node: Rec) => node.id === 'mrr').nonlinear_identity);
    for (const node of graph.nodes as Rec[]) if (node.nonlinear_identity) node.nonlinear_identity.stated_in_brief = true;
    for (const edge of graph.edges as Rec[]) edge.provenance = { ...edge.provenance, source: 'user_specified', magnitude: 'user_stated' };
  }
  const reader = () => loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: structuredClone(graph) }));
  const plot = plotDouble({ timeoutOnCandidate: opts.timeoutOnCandidate, real: opts.real, candidateIslBuild: opts.candidateIslBuild, candidateMutation: opts.candidateMutation });
  const handler = resolveHandler(createRegistry({ plotClient: plot.client, scenarioReader: reader, counterfactualClient: null }), 'run_analysis')!;
  const a = await runWithBoundAnalysisSnapshot({ scenarioId: SCENARIO, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed([]) },
    () => handler({ context: context('turn-a', []), payload: payloadOf('turn-a'), requestId: 'turn-a', signal: new AbortController().signal, orientationText: '' } as unknown as HandlerInvocation));
  const runA = a.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec;
  expect(runA, 'Run A commits one Run fact').toBeDefined();
  const ask = (link = CHURN_LINK, over: Partial<{ priorFacts: Rec[]; reader: typeof reader; exploratory: boolean; contextPatch: Rec }> = {}) => {
    turnContext.current = { ...context('turn-q', over.priorFacts ?? [runA]), ...over.contextPatch };
    currentnessStore.current ??= canonicalStore(over.priorFacts ?? [runA], over.contextPatch?.analysis_invalidated_at ?? null);
    return dispatchStructuralChallenge({
      payload: payloadOf('turn-q'), requestId: 'turn-q', link, origin: 'user_selected',
      turnMayNameLeader: true, exploratoryWorkAllowed: over.exploratory ?? true,
      plotClient: plot.client, scenarioReader: over.reader ?? reader,
    });
  };
  return { ask, runA, plot, graph };
}

/** Real reload reader, with durable row identity and chronology bound to the production handler's Run. */
function canonicalStore(facts: Rec[], invalidatedAt: string | null = null, opts: Partial<Parameters<typeof createNoopSessionStore>[0]> = {}) {
  const store = createNoopSessionStore({
    facts: facts as never,
    factsWithTurn: facts.map((fact, i) => ({
      fact, fact_row_id: `run-row-${i}`, fact_created_at: fact.result.computed_at, turn_id: `turn-row-${i}`,
    })) as never,
    scenarioAnalysisFacts: facts as never,
    ...opts,
  });
  store.readAnalysisInvalidatedAt = vi.fn(async () => invalidatedAt);
  return store;
}

const resultOf = (r: Awaited<ReturnType<typeof dispatchStructuralChallenge>>) => {
  if (r.kind !== 'result') throw new Error(`expected a result, got ${r.kind}`);
  expect(StructuralChallengeResultV1Schema.parse(r.result)).toEqual(r.result);
  return r.result;
};

describe('SCI-DEEP dispatch — the selected Run, one link, one Run path, nothing persisted', () => {
  it('S1: recomputes Run A\'s request with exactly that link removed and compares claim by claim (real A envelope)', async () => {
    const h = await harness({ graph: confirmed.graph, real: true });
    const output = await h.ask();
    const result = resultOf(output);
    expect(result.status).toBe('completed');
    expect(h.plot.runBodies).toHaveLength(2); // Run A + the one candidate
    const [sentA, sentB] = h.plot.runBodies;
    expect(hasLink(sentB.graph, 'monthly_churn', 'paying_subscribers')).toBe(false);
    expect((sentB.graph.edges as Rec[]).length).toBe((sentA.graph.edges as Rec[]).length - 1);
    expect(sentB.brief).toBeUndefined();
    const { graph: gA, seed: _sA, request_id: _rA, brief: _bA, ...restA } = sentA;
    const { graph: gB, seed: _sB, request_id: _rB, brief: _bB, ...restB } = sentB;
    expect(restB).toEqual(restA); // everything else the Run sent is unchanged
    // The baseline's seed is PINNED on the candidate (contract S3), and the pair proves seed, budget and engine equal.
    expect(String(sentB.seed)).toBe(String(result.baseline.seed_used));
    expect(result.pair_provenance).toMatchObject({ seed_equal: true, n_equal: true, builds_equal: 'equal', hash_equal: false });
    expect(gB.nodes).toEqual(gA.nodes);
    expect(result).toMatchObject({ attribution_case: 'C2_unpaired', retention: 'not_retained', pair_provenance: { hash_equal: false } });
    expect(result.baseline).toMatchObject({ scenario_id: SCENARIO, graph_hash_at_run: h.runA.result.graph_hash_at_run, run_id: h.runA.result.run_id });
    expect(result.alternative).toMatchObject({ op: 'remove_link', ...CHURN_LINK, origin: 'user_selected' });
    // The leader claim follows BOTH full licences, including the canonical admission and candidate's bound licence.
    const leader = result.claims.find((c) => c.kind === 'leader');
    if (output.kind === 'result' && output.finalRead?.currentness?.permissions?.leader_may_be_named === true
      && output.candidateLeaderLicence !== 'withheld'
      && h.runA.result.constraint_verdict?.may_name_leading_option === true && h.runA.result.leading_option_id !== null) {
      expect(leader).toMatchObject({ baseline_option_id: h.runA.result.leading_option_id, verdict: 'holds', basis: 'leader_same' });
    } else {
      expect(leader).toMatchObject({ baseline_option_id: null, verdict: 'not_comparable', basis: 'withheld_on_one_side' });
    }
    // No changed claim is licensed here; unavailable constraint measurements stay unavailable.
    expect(result.claims.filter((c) => c.verdict === 'changes')).toEqual([]);
    const constraints = result.claims.filter((x) => x.kind === 'constraint_probability');
    // The real handler withholds the raw frequencies; submitted limit identities remain as typed nulls.
    expect(constraints).toHaveLength(h.runA.result.input_snapshot.options.length * h.runA.result.input_snapshot.constraints.length);
    for (const constraint of constraints) expect(constraint).toMatchObject({ baseline: null, alternative: null, verdict: 'not_comparable', basis: 'missing_on_one_side' });
    expect(result.claims.filter((c) => c.kind !== 'constraint_probability').map((c) => c.kind === 'leader' ? 'leader' : [c.kind, c.option_id, c.constraint_id])).toEqual(['leader', ['goal_probability', 'raise_pro_price_to_59', null], ['goal_probability', 'status_quo', null], ['outcome_level', 'raise_pro_price_to_59', null], ['outcome_level', 'status_quo', null]]);
    expect(result.not_compared).toEqual(expect.arrayContaining(['structural_influence', 'e_values', 'driver_rank', 'robustness_label', 'fragile_edges']));
  });

  it('S1b / P1-1: the unchanged served exploratory MRR graph licenses no quantitative comparison', async () => {
    const h = await harness({ keepExploratory: true });
    const result = resultOf(await h.ask());
    expect(result).toMatchObject({ status: 'withheld', reason: 'exploratory_work_not_permitted',
      baseline: { run_id: h.runA.result.run_id }, claims: [], pair_provenance: null });
    expect(h.runA.result.leading_option_id).toBeNull();
    expect(h.plot.runBodies).toHaveLength(1);
  });

  it('S2: a model edited since the Run is stale, and PLoT is never asked', async () => {
    const h = await harness();
    const edited = structuredClone(h.graph);
    (edited.edges as Rec[])[7].strength = { mean: 0.9, std: 0.1 };
    const reader = () => loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: structuredClone(edited) }));
    const result = resultOf(await h.ask(CHURN_LINK, { reader }));
    expect(result).toMatchObject({ status: 'stale', reason: 'run_not_current', claims: [], pair_provenance: null });
    expect(h.plot.runBodies).toHaveLength(1);
  });

  it.each([
    ['target_becomes_root', { from_id: 'pro_plan_price', to_id: 'monthly_churn' }],
    ['option_wiring_link', { from_id: 'raise_price_to_59', to_id: 'pro_plan_price' }],
    ['link_not_found', { from_id: 'mrr', to_id: 'monthly_churn' }],
  ])('S3: an ineligible link (%s) is refused without asking PLoT', async (reason, link) => {
    const h = await harness();
    expect(resultOf(await h.ask(link))).toMatchObject({ status: 'unsupported', reason, claims: [] });
    expect(h.plot.runBodies).toHaveLength(1);
  });

  it('canonical absent-link press preserves the real dispatcher link_not_found reply without recomputing', async () => {
    const h = await harness();
    const link = { from_id: 'absent', to_id: 'paying_subscribers' };
    const turn = await structuralChallengeTurnFor(structuralChallengePressId(link), (selected) => h.ask(selected));
    expect(turn).toMatchObject({ outcome: 'unsupported', result: { status: 'unsupported', reason: 'link_not_found', claims: [] } });
    expect(turn?.reply).toBe("I can't test the link from absent to Paying subscribers. That link isn't in the model this analysis ran on, so there is nothing to test. Nothing in your model changed.");
    expect(h.plot.runBodies).toHaveLength(1); // The baseline only; no candidate transport call.
  });

  it('S4: a PLoT timeout on the candidate is timed_out, never a figure', async () => {
    const h = await harness({ timeoutOnCandidate: true });
    expect(resultOf(await h.ask())).toMatchObject({ status: 'timed_out', reason: 'candidate_run_timeout', claims: [] });
  });

  it('S5: withheld when exploratory work is not permitted, without asking PLoT', async () => {
    const h = await harness();
    expect(resultOf(await h.ask(CHURN_LINK, { exploratory: false }))).toMatchObject({ status: 'withheld', reason: 'exploratory_work_not_permitted' });
    expect(h.plot.runBodies).toHaveLength(1);
  });

  it('S6: no Run, no challenge', async () => {
    const h = await harness();
    expect(await h.ask(CHURN_LINK, { priorFacts: [] })).toEqual({ kind: 'no_run' });
  });

  it('S7: deterministic for the same Run and link — NOT_RETAINED, but recomputable by its key', async () => {
    const h = await harness();
    const first = resultOf(await h.ask());
    const second = resultOf(await h.ask());
    expect(second).toEqual(first);
    expect(first.recompute_key).toBe(structuralChallengeRecomputeKey(first.baseline.sent_digest, first.alternative, first.baseline.seed_used, first.baseline.n_samples));
  });

  it('the recompute key is the contract\'s canonical encoding (schemas 0.76.0 golden digest)', () => {
    const alternative = { op: 'remove_link', from_id: 'monthly_churn', to_id: 'paying_subscribers', origin: 'olumi_suggested', sizing: 'olumi_estimate' } as const;
    const sent = '90d572771786ae04e8fe0885fd6bceaed633ad03dd41d7005c928969d6b45da2';
    expect(structuralChallengeRecomputeKey(sent, alternative, '1254899477', 10000)).toBe('7ef9ac27f55d3c44c3226801fa4c39916232d43342607d8f0fc1edcd4e78c65e');
    expect(structuralChallengeRecomputeKey(sent, alternative, 1254899477, 10000)).not.toBe('7ef9ac27f55d3c44c3226801fa4c39916232d43342607d8f0fc1edcd4e78c65e');
  });

  it('S11: engine builds that differ between the Run and the recompute license no verdict', async () => {
    const h = await harness({ candidateIslBuild: 'i2' });
    expect(resultOf(await h.ask())).toMatchObject({ status: 'failed', reason: 'baseline_payload_mismatch', claims: [], pair_provenance: null });
    expect(h.plot.runBodies).toHaveLength(2); // the candidate ran; its pair could not be proven
  });

  it.each([
    ['different seed', (r: Rec) => { r.meta.seed_used = '999999'; }],
    ['different sample budget', (r: Rec) => { r.meta.n_samples = 5000; }],
    ['unrecorded engine builds', (r: Rec) => { delete r._meta; }],
    ['only one engine build recorded', (r: Rec) => { r._meta = { builds: { plot: 'p1' } }; }],
  ])('S3: %s withholds all structural verdicts and clears pair provenance', async (_label, candidateMutation) => {
    const h = await harness({ candidateMutation });
    const result = resultOf(await h.ask());
    expect(result).toMatchObject({ status: 'failed', reason: 'baseline_payload_mismatch', claims: [], pair_provenance: null });
    expect(h.plot.runBodies).toHaveLength(2);
  });

  it.each(['unsupported', 'failed', 'timed_out', 'stale', 'withheld'] as const)(
    'every non-completed status (%s) has null pair provenance and parses', async (status) => {
      const h = await harness({ timeoutOnCandidate: status === 'timed_out', candidateIslBuild: status === 'failed' ? 'i2' : undefined });
      const edited = structuredClone(h.graph);
      (edited.edges as Rec[])[7].strength = { mean: 0.9, std: 0.1 };
      const reader = () => loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: structuredClone(edited) }));
      const result = resultOf(await h.ask(
        status === 'unsupported' ? { from_id: 'pro_plan_price', to_id: 'monthly_churn' } : CHURN_LINK,
        { exploratory: status !== 'withheld', ...(status === 'stale' ? { reader } : {}) },
      ));
      expect(result).toMatchObject({ status, claims: [], pair_provenance: null });
    },
  );

  it.each([
    ['MRR with user-confirmed identity and sizes', served.graph, false], ['bank-2 A with user-stated sizes and live link-removal numbers', confirmed.graph, true],
  ])('every dispatched output on the licensed %s fixture parses with the published result schema', async (_label, graph, real) => {
    const h = await harness({ graph: graph as Rec, real: real as boolean });
    const result = resultOf(await h.ask());
    expect(result.status).toBe('completed');
    expect(StructuralChallengeResultV1Schema.parse(result)).toEqual(result);
  });

  it('S9: the one-edit guard — exactly this link\'s presence, and nothing else the Runs recorded', async () => {
    const h = await harness();
    const without = (fact: Rec, mutate: (snap: Rec) => void) => {
      const copy = structuredClone(fact);
      mutate(copy.result.input_snapshot);
      return copy;
    };
    const dropLink = (snap: Rec) => { snap.links = (snap.links as Rec[]).filter((l) => !(l.from === 'monthly_churn' && l.to === 'paying_subscribers')); };
    expect(isExactlyThisRemoval(h.runA as never, without(h.runA, dropLink) as never, CHURN_LINK)).toBe(true);
    expect(isExactlyThisRemoval(h.runA as never, without(h.runA, dropLink) as never, { from_id: 'pro_plan_price', to_id: 'mrr' })).toBe(false);
    const alsoAnother = (snap: Rec) => { dropLink(snap); (snap.links as Rec[])[0].mean = ((snap.links as Rec[])[0].mean as number) + 0.25; };
    expect(isExactlyThisRemoval(h.runA as never, without(h.runA, alsoAnother) as never, CHURN_LINK)).toBe(false);
    expect(isExactlyThisRemoval(h.runA as never, h.runA as never, CHURN_LINK)).toBe(false);
  });

  it('S10: the same builder — a Run whose request no longer rebuilds exactly is never compared, and PLoT is never asked', async () => {
    const h = await harness();
    const drifted = structuredClone(h.runA);
    const digest = drifted.result.input_snapshot.sent_digest as string;
    // What a change in how CEE builds the payload since the Run looks like: the rebuilt request's digest is not the Run's.
    drifted.result.input_snapshot.sent_digest = `${digest[0] === 'a' ? 'b' : 'a'}${digest.slice(1)}`;
    const result = resultOf(await h.ask(CHURN_LINK, { priorFacts: [drifted] }));
    expect(result).toMatchObject({ status: 'failed', reason: 'baseline_payload_mismatch', claims: [], pair_provenance: null });
    expect(h.plot.runBodies).toHaveLength(1); // Run A only: the rebuild went through the probe, not PLoT
  });

  it('S8: a model edited DURING the recompute is stale — a late reply never overwrites it', async () => {
    const h = await harness();
    const edited = structuredClone(h.graph);
    (edited.edges as Rec[])[7].strength = { mean: 0.9, std: 0.1 };
    let reads = 0;
    const reader = () => {
      reads += 1;
      const g = reads === 1 ? h.graph : edited;
      return loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: structuredClone(g) }));
    };
    expect(resultOf(await h.ask(CHURN_LINK, { reader }))).toMatchObject({ status: 'stale', reason: 'model_changed_during_challenge' });
  });
});


describe('independent-review dispatch regressions', () => {
  afterEach(() => { currentnessStore.current = undefined; });
  const empty = (result: ReturnType<typeof resultOf>, status: string, reason: string, baseline: Rec) => {
    expect(result).toMatchObject({ status, reason, claims: [], pair_provenance: null, baseline: { run_id: baseline.result.run_id, scenario_id: SCENARIO, graph_hash_at_run: baseline.result.graph_hash_at_run }, alternative: { ...CHURN_LINK } });
    expect(StructuralChallengeResultV1Schema.parse(result)).toEqual(result);
  };

  it('7: a retained_excluded parent does not make a root-making wire removal eligible', async () => {
    const graph = structuredClone(confirmed.graph);
    const parent = structuredClone(graph.nodes.find((n: Rec) => n.id === 'pro_plan_price'));
    Object.assign(parent, { id: 'excluded_parent', label: 'Excluded parent', analysis_participation: 'retained_excluded', category: 'external' });
    graph.nodes.push(parent);
    graph.edges.push({ from: 'excluded_parent', to: 'monthly_churn', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
    const h = await harness({ graph, real: true });
    const link = { from_id: 'pro_plan_price', to_id: 'monthly_churn' };
    const result = resultOf(await h.ask(link));
    expect(result).toMatchObject({ status: 'unsupported', reason: 'target_becomes_root', claims: [], alternative: link });
    expect(h.plot.runBodies).toHaveLength(1);
    expect(hasLink(h.plot.runBodies[0].graph, 'excluded_parent', 'monthly_churn')).toBe(false);
  });

  it.each([
    ['identity_participant_link', { from_id: 'pro_plan_price', to_id: 'mrr' }],
    ['anchored_identity_target', { from_id: 'monthly_churn', to_id: 'mrr' }],
  ])('7: canonical definition refusal %s survives the wire check', async (reason, link) => {
    const graph = structuredClone(confirmed.graph);
    if (reason === 'anchored_identity_target') graph.edges.push({ from: link.from_id, to: link.to_id, strength: { mean: 0.3, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });
    const h = await harness({ graph, real: true });
    const result = resultOf(await h.ask(link));
    expect(result).toMatchObject({ status: 'unsupported', reason, claims: [], alternative: link });
    expect(h.plot.runBodies).toHaveLength(1);
  });

  it('8: restored identical graph is stale through the real canonical reload reader', async () => {
    const h = await harness({ graph: confirmed.graph, real: true });
    const result = resultOf(await h.ask(CHURN_LINK, { contextPatch: { analysis_invalidated_at: h.runA.result.computed_at } }));
    empty(result, 'stale', 'run_not_current', h.runA);
    expect(h.plot.runBodies).toHaveLength(1);
  });

  it.each(['restore', 'unit', 'newer_run', 'run_id', 'read_unavailable'] as const)('8: late %s invalidates the pinned Run through the real canonical reader', async (negative) => {
    const h = await harness({ graph: confirmed.graph, real: true });
    let reads = 0;
    const reader = async () => {
      reads += 1;
      const graph = structuredClone(h.graph);
      if (reads === 2) {
        if (negative === 'restore') currentnessStore.current = canonicalStore([h.runA], h.runA.result.computed_at);
        if (negative === 'unit') graph.nodes.find((n: Rec) => n.id === 'mrr').goal_threshold_unit = 'USD/month';
        if (negative === 'newer_run' || negative === 'run_id') {
          const newer = structuredClone(h.runA);
          newer.result.run_id = 'newer-run';
          if (negative !== 'run_id') newer.result.computed_at = new Date(Date.parse(h.runA.result.computed_at) + 1).toISOString();
          currentnessStore.current = canonicalStore([newer]);
        }
        if (negative === 'read_unavailable') currentnessStore.current = canonicalStore([h.runA], null, { throwOnScenarioAnalysisFactRead: new SessionReadError('durable read unavailable') });
      }
      return loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: graph }));
    };
    empty(resultOf(await h.ask(CHURN_LINK, { reader })), negative === 'read_unavailable' ? 'failed' : 'stale', negative === 'read_unavailable' ? 'probe_unavailable' : 'model_changed_during_challenge', h.runA);
    expect(h.plot.runBodies).toHaveLength(2);
  });

  it('10: only the candidate invocation disables retries; success is one candidate call', async () => {
    const h = await harness({ graph: confirmed.graph, real: true });
    const output = await h.ask();
    const result = resultOf(output);
    expect(result.status).toBe('completed');
    expect(h.plot.runBodies).toHaveLength(2);
    expect(h.plot.runOpts[0]?.retryPolicy).toBeUndefined();
    expect(h.plot.runOpts[1]?.retryPolicy).toBe('no_retry');
    expect(output.kind === 'result' && output.certainty?.baseline).toEqual(h.runA.result.goal_certainty);
    expect(Object.keys(result)).not.toContain('certainty');
  });

  it.each([400, 422, 500, 503, 'reset', 'abort'] as const)('10: candidate %s fails once without a second request', async (failure) => {
    const h = await harness({ graph: confirmed.graph, real: true });
    const run = vi.mocked(h.plot.client.run);
    run.mockImplementationOnce(async (_body, _id, opts) => {
      expect(opts?.retryPolicy).toBe('no_retry');
      if (typeof failure === 'number') throw new PLoTError('engine rejected request', failure, 'run', 1);
      if (failure === 'abort') throw new DOMException('aborted', 'AbortError');
      throw new TypeError('network reset');
    });
    empty(resultOf(await h.ask()), 'failed', 'candidate_run_failed', h.runA);
    expect(run).toHaveBeenCalledTimes(2); // ordinary baseline, then exactly one candidate
  });

  it.each(['initial', 'late'] as const)('11: strict %s snapshot read failures return typed unavailable results', async (phase) => {
    const h = await harness({ graph: confirmed.graph, real: true });
    let reads = 0;
    const reader = async () => {
      reads += 1;
      if (reads === (phase === 'initial' ? 1 : 2)) throw new SessionReadError('snapshot read unavailable');
      return loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: structuredClone(h.graph) }));
    };
    empty(resultOf(await h.ask(CHURN_LINK, { reader })), 'failed', 'probe_unavailable', h.runA);
    expect(h.plot.runBodies).toHaveLength(phase === 'initial' ? 1 : 2);
  });

  it.each(['probe', 'candidate'] as const)('11: invalid %s facts, timeouts, divergence and strict read errors never escape', async (phase) => {
    for (const failure of ['invalid', 'timeout', 'stale', 'read'] as const) {
      const h = await harness({ graph: confirmed.graph, real: true });
      const original = registry.resolveHandler;
      let resolves = 0;
      const spy = vi.spyOn(registry, 'resolveHandler').mockImplementation((...args) => {
        resolves += 1;
        if (resolves !== (phase === 'probe' ? 1 : 2)) return original(...args);
        return async () => {
          if (failure === 'invalid') throw new HandlerResultInvalidError('invalid candidate fact');
          if (failure === 'timeout') throw new HandlerInvocationFailedError('timeout', { cause_kind: 'plot_timeout', retryable: true, details: { handler_id: 'run_analysis' } });
          if (failure === 'stale') throw new AnalysisSnapshotDivergedError({ scenarioId: SCENARIO, expectedGraphHash: 'a', observedGraphHash: 'b' });
          throw new SessionReadError('strict read unavailable');
        };
      });
      try {
        const result = resultOf(await h.ask());
        empty(result, failure === 'timeout' ? 'timed_out' : failure === 'stale' ? 'stale' : 'failed', failure === 'timeout' ? 'candidate_run_timeout' : failure === 'stale' ? 'model_changed_during_challenge' : failure === 'invalid' ? 'candidate_unparseable' : phase === 'probe' ? 'probe_unavailable' : 'candidate_run_failed', h.runA);
      } finally { spy.mockRestore(); }
    }
  });
});


describe('8/11: identity-bound canonical reload currentness, before and after recomputation', () => {
  afterEach(() => { currentnessStore.current = undefined; });
  for (const phase of ['initial', 'late'] as const) {
    it.each(['restore', 'unit', 'newer_run', 'run_id', 'read_error', 'durable_degraded', 'missing', 'capped_empty'] as const)(`${phase} canonical %s never licenses the pinned Run`, async (negative) => {
      const h = await harness({ graph: confirmed.graph, real: true });
      currentnessStore.current = canonicalStore([h.runA]);
      let reads = 0;
      const reader = async () => {
        reads += 1;
        const graph = structuredClone(h.graph);
        if (reads === (phase === 'initial' ? 1 : 2)) {
          if (negative === 'restore') currentnessStore.current = canonicalStore([h.runA], h.runA.result.computed_at);
          if (negative === 'unit') graph.nodes.find((n: Rec) => n.id === 'mrr').goal_threshold_unit = 'USD/month';
          if (negative === 'newer_run' || negative === 'run_id') {
            const newer = structuredClone(h.runA);
            newer.result.run_id = 'newer-run';
            if (negative === 'newer_run') newer.result.computed_at = new Date(Date.parse(h.runA.result.computed_at) + 1).toISOString();
            currentnessStore.current = canonicalStore([newer]);
          }
          if (negative === 'read_error') currentnessStore.current!.readAnalysisInvalidatedAt = vi.fn().mockRejectedValue(new SessionReadError('restore marker unavailable'));
          if (negative === 'durable_degraded') currentnessStore.current = canonicalStore([h.runA], null, {
            priorTurns: [{ id: 'turn-row-0' }] as never,
            throwOnScenarioAnalysisFactRead: new SessionReadError('durable read unavailable'),
          });
          if (negative === 'missing' || negative === 'capped_empty') currentnessStore.current = canonicalStore([], null,
            negative === 'capped_empty' ? { scenarioAnalysisFactTotal: 21 } : {});

          // Contrast the real canonical verdict and its SAME-read identity receipt with the handler's refusal.
          let receipt: unknown;
          const canonical = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'canonical-witness', onCurrentnessRead: (read) => { receipt = read; } });
          if (negative === 'restore' || negative === 'unit') expect(canonical.analysis_state?.run_state.kind).toBe('complete_stale');
          if (negative === 'newer_run' || negative === 'run_id') {
            expect(canonical.analysis_state?.run_state.kind).toBe('complete_current');
            expect(receipt).toMatchObject({ readOk: true, fact: { result: { run_id: 'newer-run' } } });
          }
          if (negative === 'read_error') expect(canonical.analysis_state).toBeNull();
          if (negative === 'durable_degraded') {
            // Reload can retain figures from a healthy hot window; that cannot certify the newest pinned execution.
            expect(canonical.analysis_state?.run_state.kind).toBe('complete_current');
            expect(receipt).toMatchObject({ readOk: false, fact: null });
          }
        }
        return loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: graph }));
      };
      const unavailable = ['read_error', 'durable_degraded', 'missing', 'capped_empty'].includes(negative);
      expect(resultOf(await h.ask(CHURN_LINK, { reader }))).toMatchObject({
        status: unavailable ? 'failed' : 'stale',
        reason: unavailable ? 'probe_unavailable' : phase === 'initial' ? 'run_not_current' : 'model_changed_during_challenge',
        claims: [], pair_provenance: null, baseline: { run_id: h.runA.result.run_id }, alternative: CHURN_LINK,
      });
      expect(h.plot.runBodies).toHaveLength(phase === 'initial' ? 1 : 2);
    });
  }

  it('a Run computed after restore remains current on both checks', async () => {
    const h = await harness({ graph: confirmed.graph, real: true });
    currentnessStore.current = canonicalStore([h.runA], new Date(Date.parse(h.runA.result.computed_at) - 1).toISOString());
    expect(resultOf(await h.ask()).status).toBe('completed');
    expect(currentnessStore.current.readAnalysisInvalidatedAt).toHaveBeenCalledTimes(2);
    expect(h.plot.runBodies).toHaveLength(2);
  });

  it('a validated capped page retains the newest identity-bound Run on both checks', async () => {
    const h = await harness({ graph: confirmed.graph, real: true });
    const older = Array.from({ length: 20 }, (_, i) => {
      const fact = structuredClone(h.runA);
      fact.result.run_id = `older-run-${i}`;
      fact.result.computed_at = new Date(Date.parse(h.runA.result.computed_at) - i - 1).toISOString();
      return fact;
    });
    currentnessStore.current = canonicalStore([h.runA, ...older]);
    expect(resultOf(await h.ask()).status).toBe('completed');
    expect(currentnessStore.current.readAnalysisInvalidatedAt).toHaveBeenCalledTimes(2);
  });
});


describe('review P1-1: actual canonical authority at final presentation', () => {
  afterEach(() => { currentnessStore.current = undefined; });
  it.each(['newer_run', 'same_time_new_id', 'same_id_new_time', 'stale', 'scope_withdrawn', 'scope_unavailable', 'durable_unavailable'] as const)(
    'a final %s cannot license the earlier challenge, even after a successful late dispatch read', async (negative) => {
      const h = await harness({ graph: confirmed.graph, real: true });
      const output = await h.ask();
      expect(resultOf(output).status).toBe('completed');
      if (output.kind !== 'result') throw new Error('expected result');
      expect(output.finalRead?.currentness).toMatchObject({ readOk: true, fact: { result: { run_id: h.runA.result.run_id } }, permissions: expect.any(Object) });
      const turn = await structuralChallengeTurnFor(structuralChallengePressId(CHURN_LINK), async () => output);
      if (turn === null) throw new Error('expected turn');
      expect(turn.outcome).toBe('completed');
      const graph = structuredClone(h.graph);
      if (negative === 'newer_run' || negative === 'same_time_new_id' || negative === 'same_id_new_time') {
        const newer = structuredClone(h.runA);
        if (negative !== 'same_id_new_time') newer.result.run_id = 'newer-run';
        if (negative !== 'same_time_new_id') newer.result.computed_at = new Date(Date.parse(h.runA.result.computed_at) + 1).toISOString();
        currentnessStore.current = canonicalStore([newer]);
      }
      if (negative === 'stale') graph.edges[7].strength = { mean: 0.9, std: 0.1 };
      if (negative === 'durable_unavailable') currentnessStore.current = canonicalStore([h.runA], null,
        { throwOnScenarioAnalysisFactRead: new SessionReadError('canonical permission unavailable') });
      let currentness: StructuralChallengeFinalRead['currentness'];
      const read = await readScenarioAnalysis({ scenarioId: SCENARIO, graph, requestId: 'final-presentation',
        ...(negative.startsWith('scope') ? { goalScopeClaimInput: { status: negative === 'scope_withdrawn' ? 'unresolved' as const : 'unavailable' as const, issues: [] } } : {}),
        onCurrentnessRead: (receipt) => { currentness = receipt; },
      });
      const final = structuralChallengeTurnUnderLicence(turn, { read, currentness });
      expect(final.result).toMatchObject({ baseline: { run_id: h.runA.result.run_id }, claims: [], pair_provenance: null,
        status: negative === 'scope_withdrawn' ? 'withheld' : negative.includes('unavailable') ? 'failed' : 'stale' });
      expect(StructuralChallengeResultV1Schema.parse(final.result)).toEqual(final.result);
      expect(final.reply).not.toContain('What holds:');
      expect(final.reply).not.toContain('What changes:');
    },
  );
  it.each(['unresolved', 'unavailable'] as const)('the late canonical scope %s is consumed by dispatch before any comparison is returned', async (status) => {
    const h = await harness({ graph: confirmed.graph, real: true });
    let reads = 0;
    const reader = async () => {
      const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'scope-late', createNoopSessionStore({ loadGraphResult: structuredClone(h.graph) }));
      reads += 1;
      return { ...snapshot, ...(reads === 2 ? { goalScopeClaimInput: { status, issues: [] } } : {}) };
    };
    const result = resultOf(await h.ask(CHURN_LINK, { reader }));
    expect(result).toMatchObject({ baseline: { run_id: h.runA.result.run_id }, claims: [], pair_provenance: null,
      status: status === 'unavailable' ? 'failed' : 'withheld',
      reason: status === 'unavailable' ? 'probe_unavailable' : 'exploratory_work_not_permitted' });
    expect(h.plot.runBodies).toHaveLength(2);
  });
});


describe('review P1-2/P1-3: result identities and measurement licences survive the real handler boundary', () => {
  afterEach(() => { currentnessStore.current = undefined; });
  it.each(['ghost_option', 'unsubmitted_constraint'] as const)('candidate %s returns no comparison and keeps the baseline Run identity', async (negative) => {
    const h = await harness({ graph: confirmed.graph, real: true, candidateMutation: (r) => {
      if (negative === 'ghost_option') r.option_comparison.push({ ...structuredClone(r.option_comparison[0]), option_id: 'ghost_option' });
      else r.option_comparison[0].constraint_probabilities.unsubmitted_constraint = 1;
    } });
    expect(resultOf(await h.ask())).toMatchObject({ status: 'failed', reason: 'candidate_unparseable',
      baseline: { run_id: h.runA.result.run_id }, claims: [], pair_provenance: null });
  });
  it.each(['skipped', 'zero_draws', 'uncertified_scale'] as const)('candidate %s cannot yield a verdict from an unlicensed measurement', async (negative) => {
    const optionId = 'raise_pro_price_to_59';
    const h = await harness({ graph: confirmed.graph, real: true, candidateMutation: (r) => {
      const row = r.option_comparison.find((o: Rec) => o.option_id === optionId);
      if (negative === 'skipped') row.status = 'skipped';
      if (negative === 'zero_draws') row.outcome.n_valid_samples = 0;
      if (negative === 'uncertified_scale') for (const limit of r.constraint_results) delete limit.scale_provenance;
    } });
    const output = await h.ask();
    const result = resultOf(output);
    expect(result.baseline.run_id).toBe(h.runA.result.run_id);
    expect(result.status).toBe('completed');
    const affected = result.claims.filter((c) => c.kind !== 'leader' && c.option_id === optionId
      && (negative !== 'uncertified_scale' || c.kind === 'constraint_probability'));
    expect(affected.length).toBeGreaterThan(0);
    for (const c of affected) expect(c).toMatchObject({ alternative: null, verdict: 'not_comparable', noise_verdict: 'not_noise_qualified' });
    const turn = await structuralChallengeTurnFor(structuralChallengePressId(CHURN_LINK), async () => output);
    expect(turn?.reply).toContain('unavailable');
    expect(turn?.reply).not.toMatch(/rests on|depends on/i);
  });
});
