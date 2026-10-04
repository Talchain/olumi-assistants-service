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
import { describe, expect, it, vi } from 'vitest';
import { PLoTTimeoutError, type PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';

vi.mock('../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));
const turnContext = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  buildTurnContext: vi.fn(async () => turnContext.current),
}));

import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { priorRunForSeed } from '../../coaching/seed-reuse.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../../run-analysis-snapshot-binding.js';
import { createRegistry, resolveHandler } from '../../tools/registry.js';
import { dispatchStructuralChallenge, isExactlyThisRemoval, structuralChallengeRecomputeKey } from '../structural-challenge-dispatch.js';

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
  const client = {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
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
  return { client, runBodies };
}

async function harness(opts: { timeoutOnCandidate?: boolean; graph?: Rec; real?: boolean; candidateIslBuild?: string; candidateMutation?: (response: Rec) => void } = {}) {
  const graph = structuredClone(opts.graph ?? served.graph);
  const reader = () => loadScenarioSnapshotForRunAnalysis(SCENARIO, 'sd', createNoopSessionStore({ loadGraphResult: structuredClone(graph) }));
  const plot = plotDouble({ timeoutOnCandidate: opts.timeoutOnCandidate, real: opts.real, candidateIslBuild: opts.candidateIslBuild, candidateMutation: opts.candidateMutation });
  const handler = resolveHandler(createRegistry({ plotClient: plot.client, scenarioReader: reader, counterfactualClient: null }), 'run_analysis')!;
  const a = await runWithBoundAnalysisSnapshot({ scenarioId: SCENARIO, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed([]) },
    () => handler({ context: context('turn-a', []), payload: payloadOf('turn-a'), requestId: 'turn-a', signal: new AbortController().signal, orientationText: '' } as unknown as HandlerInvocation));
  const runA = a.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec;
  expect(runA, 'Run A commits one Run fact').toBeDefined();
  const ask = (link = CHURN_LINK, over: Partial<{ priorFacts: Rec[]; reader: typeof reader; exploratory: boolean }> = {}) => {
    turnContext.current = context('turn-q', over.priorFacts ?? [runA]);
    return dispatchStructuralChallenge({
      payload: payloadOf('turn-q'), requestId: 'turn-q', link, origin: 'user_selected',
      turnMayNameLeader: true, exploratoryWorkAllowed: over.exploratory ?? true,
      plotClient: plot.client, scenarioReader: over.reader ?? reader,
    });
  };
  return { ask, runA, plot, graph };
}

const resultOf = (r: Awaited<ReturnType<typeof dispatchStructuralChallenge>>) => {
  if (r.kind !== 'result') throw new Error(`expected a result, got ${r.kind}`);
  expect(StructuralChallengeResultV1Schema.parse(r.result)).toEqual(r.result);
  return r.result;
};

describe('SCI-DEEP dispatch — the selected Run, one link, one Run path, nothing persisted', () => {
  it('S1: recomputes Run A\'s request with exactly that link removed and compares claim by claim (real A envelope)', async () => {
    const h = await harness({ graph: confirmed.graph, real: true });
    const result = resultOf(await h.ask());
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
    // The leader claim follows THE authority: named only when the Run's own verdict permits it.
    const leader = result.claims.find((c) => c.kind === 'leader');
    if (h.runA.result.constraint_verdict?.may_name_leading_option === true && h.runA.result.leading_option_id !== null) {
      expect(leader).toMatchObject({ baseline_option_id: h.runA.result.leading_option_id, verdict: 'holds', basis: 'leader_same' });
    } else {
      expect(leader).toMatchObject({ baseline_option_id: null, verdict: 'not_comparable', basis: 'withheld_on_one_side' });
    }
    // The honest no-effect case under model A: nothing CHANGES; churn (upstream of the removed link) holds by construction.
    expect(result.claims.filter((c) => c.verdict === 'changes')).toEqual([]);
    for (const c of result.claims.filter((x) => x.kind === 'constraint_probability')) {
      expect(c).toMatchObject({ verdict: 'holds', basis: 'unaffected_by_construction', invariant_by_construction: true });
    }
    expect(result.not_compared).toEqual(expect.arrayContaining(['structural_influence', 'e_values', 'driver_rank', 'robustness_label', 'fragile_edges']));
  });

  it('S1b: on the served MRR graph (goal product not read) nothing withheld is named or quoted', async () => {
    const h = await harness();
    const result = resultOf(await h.ask());
    expect(result.status).toBe('completed');
    expect(h.runA.result.leading_option_id).toBeNull();
    expect(result.claims.find((c) => c.kind === 'leader'))
      .toMatchObject({ baseline_option_id: null, alternative_option_id: null, verdict: 'not_comparable', basis: 'withheld_on_one_side' });
    for (const c of result.claims.filter((x) => x.kind === 'goal_probability')) {
      expect(c.verdict).toBe('not_comparable');
    }
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
    ['served MRR', served.graph, false], ['bank-2 A and live link-removal numbers', confirmed.graph, true],
  ])('every dispatched output on the existing %s fixture parses with the published result schema', async (_label, graph, real) => {
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
