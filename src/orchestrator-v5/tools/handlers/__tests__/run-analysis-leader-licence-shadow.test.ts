/**
 * A2 L1 (Science 0df0e1): ONE leader-licence verdict per Run, SHADOW ONLY. `run_analysis` computes the verdict after
 * every Run-time withhold and logs `cee.leader_licence.shadow` with each live predicate's disagreement. Nothing stores
 * or reads it: the fact, the reply and every hash are unchanged.
 *
 * Real `run_analysis` handler and real snapshot loader. Fixtures:
 * - the served fa027cf5 graph (Acceptance receipt hourly-0325-20261005), with the served Run's own option rows;
 * - the served cut-costs graph + PLoT body (scenario 714abc5c, CEE 1f9d769), whose goal figures are withheld on the
 *   placeholder path (the a994c38a class: the constraint verdict permits, the Run stores no leader).
 * Shapes marked SYNTHETIC are self-authored variations of the served rows.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';

const logInfo = vi.hoisted(() => vi.fn());
vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(), TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));
/** L1-f: `off` makes the shadow throw (as if it were absent); `seen` records the fact before and after it ran. */
const shadowSwitch = vi.hoisted(() => ({ off: false, seen: [] as Array<{ before: string; after: string }> }));
vi.mock('../../../compose/leader-licence-shadow.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../compose/leader-licence-shadow.js')>();
  return { ...original, leaderLicenceShadow: (input: Parameters<typeof original.leaderLicenceShadow>[0]) => {
    if (shadowSwitch.off) throw new Error('shadow disabled');
    const before = JSON.stringify(input.fact);
    const out = original.leaderLicenceShadow(input);
    shadowSwitch.seen.push({ before, after: JSON.stringify(input.fact) });
    return out;
  } };
});

import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { priorRunForSeed } from '../../../coaching/seed-reuse.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../../../run-analysis-snapshot-binding.js';
import { createRegistry, resolveHandler } from '../../registry.js';
import { GOAL_FIGURES_OPTIONS_IDENTICAL, GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../../orchestrator/context/option-result-source.js';
import { leaderLicenceVerdict, type LeaderLicenceVerdictInput } from '../../../compose/leader-licence-verdict.js';
import {
  WITHHELD_CONSTRAINT_VERDICT, WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT, WITHHELD_GOAL_SCOPE_UNRESOLVED,
  WITHHELD_LEADER_CAUSE_UNRECORDED, WITHHELD_NEAR_TIE, WITHHELD_NO_OPTION_MEETS_LIMIT,
  WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN, WITHHELD_RUN_IDENTITY_CONFLICT, WITHHELD_RUN_IDENTITY_UNCONFIRMED,
  WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_UNREQUESTED_ANALYSIS,
} from '../../../compose/analysis-state-v1.js';

type Rec = Record<string, any>;
const FA027 = 'fa027cf5-c5c9-4021-9578-ee79b15c6eb8';
const fa027Graph = JSON.parse(readFileSync(new URL('../../../handlers/__tests__/fixtures/sci-deep-fa027cf5-graph.json', import.meta.url), 'utf8')) as Rec;
const happy = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Rec;
const CUT = JSON.parse(readFileSync(new URL('./fixtures/served-cut-costs-altB-r0-1f9d769.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Rec; plot_body: Rec;
};
const CUT_SCENARIO = '714abc5c-4e82-4436-9454-eec6c8f68589';
const LEADER = 'ai_reporting_module_sprint';

type Stats = { w: number; mean: number; std: number; p10: number; p50: number; p90: number };
/** The served fa027cf5 Run's own rows (receipt `.run_response`, ISL @620ee5f0). */
const SERVED: Record<string, Stats> = {
  ai_reporting_module_sprint: { w: 0.5116166666666628, mean: 0.02134743573525561, std: 0.05794864377732945, p10: -0.04447165769637492, p50: 0.012637991252167108, p90: 0.10051804427935832 },
  integration_bug_fix_sprint: { w: 0.3777666666666818, mean: 0.01883963611307356, std: 0.054676120365086324, p10: -0.04206720064552672, p50: 0.009069426170272335, p90: 0.09350546215162735 },
  continue_current_plan: { w: 0.11061666666666901, mean: 0.015054768174162368, std: 0.05551686855808458, p10: -0.047450823228790816, p50: 0.005030893009746502, p90: 0.09102360146076206 },
};
/** SYNTHETIC: Integration ≡ Carry On (one identical pair); AI Reporting distinct with the largest share. */
const PAIR: Record<string, Stats> = {
  ai_reporting_module_sprint: { w: 0.4, mean: 0.016, std: 0.05, p10: -0.045, p50: 0.014, p90: 0.085 },
  integration_bug_fix_sprint: { w: 0.3, mean: 0.012, std: 0.05, p10: -0.05, p50: 0.01, p90: 0.08 },
  continue_current_plan: { w: 0.3, mean: 0.012, std: 0.05, p10: -0.05, p50: 0.01, p90: 0.08 },
};
type Shape = 'served' | 'pair_same' | 'near_tie';

function plotDouble(shape: Shape) {
  return {
    validatePatch: vi.fn().mockResolvedValue({}),
    run: vi.fn(async (body: Rec) => {
      const derived = String(parseInt(createHash('sha256').update(JSON.stringify(body.graph)).digest('hex').slice(0, 7), 16));
      const response = structuredClone(happy);
      response.option_comparison = (body.options as Rec[]).map((o) => {
        const id = String(o.option_id ?? o.id);
        const s = (shape === 'pair_same' ? PAIR : SERVED)[id] ?? { w: 0, mean: 0.01, std: 0.05, p10: -0.05, p50: 0.001, p90: 0.08 };
        return {
          option_id: id, option_label: o.label, win_probability: s.w, probability_of_goal: null, status: 'computed',
          outcome: { mean: s.mean, std: s.std, p10: s.p10, p50: s.p50, p90: s.p90, n_samples: 10_000, n_valid_samples: 10_000,
            validity_ratio: 1, percentiles_source: 'samples' },
        };
      });
      response.option_comparison_status = 'computed';
      response.results = (response.option_comparison as Rec[]).map((r) => ({ option_id: r.option_id, option_label: r.option_label, win_probability: r.win_probability }));
      // SYNTHETIC near_tie: the engine's own tie flag on the served rows.
      if (shape === 'near_tie') response.robustness = { ...(response.robustness as Rec), near_tie: { is_tie: true } };
      response.fact_objects = [];
      response.review_cards = [];
      response.meta = { ...(response.meta as Rec), seed_used: body.seed !== undefined ? String(body.seed) : derived, n_samples: 10_000 };
      response._meta = { builds: { plot: 'p1', isl: 'i1' } };
      response.identity_evaluations = [];
      return response as V2RunResponseEnvelope;
    }),
  } as unknown as PLoTClient;
}

function context(turnId: string, scenarioId: string) {
  return {
    stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {},
    messages: [{ role: 'user', content: 'run analysis' }], session_id: scenarioId,
    request_id: turnId, budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
    prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
  };
}

async function runOnce(scenarioId: string, graph: Rec, plotClient: PLoTClient, briefText: string | null = null) {
  const reader = () => loadScenarioSnapshotForRunAnalysis(scenarioId, 'l1', createNoopSessionStore({
    loadGraphResult: structuredClone(graph), ...(briefText === null ? {} : { loadBriefTextResult: briefText }),
  } as never));
  const handler = resolveHandler(createRegistry({ plotClient, scenarioReader: reader, counterfactualClient: null }), 'run_analysis')!;
  const outcome = await runWithBoundAnalysisSnapshot({ scenarioId, analysisGraphHash: NO_CLAIM, priorRunSeed: priorRunForSeed([]) },
    () => handler({ context: context('turn-l1', scenarioId), payload: makeMessagePayload({ turn_id: 'turn-l1', scenario_id: scenarioId,
      message: 'run analysis', turn_class: 'decide', stage: 'analyse' }), requestId: 'turn-l1', signal: new AbortController().signal,
      orientationText: '' } as unknown as HandlerInvocation));
  const fact = outcome.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec;
  expect(fact, 'the Run commits one Run fact').toBeDefined();
  const shadows = logInfo.mock.calls.map((c) => c[0] as Rec).filter((e) => e?.event === 'cee.leader_licence.shadow');
  return { outcome, fact, shadows };
}

afterEach(() => { logInfo.mockClear(); shadowSwitch.off = false; shadowSwitch.seen = []; vi.useRealTimers(); });

const warningCodes = (fact: Rec): string[] => ((fact.result.enrichment?.inference_warnings ?? []) as Rec[]).map((w) => w.code);
const cutPlot = () => ({ validatePatch: vi.fn().mockResolvedValue({}),
  run: vi.fn(async () => structuredClone(CUT.plot_body) as V2RunResponseEnvelope) } as unknown as PLoTClient);
const runCut = () => runOnce(CUT_SCENARIO, CUT.graph, cutPlot(), CUT._provenance.brief_text);
/** The ONE shadow event, bound to this Run by its id. */
function shadowOf(r: { fact: Rec; shadows: Rec[] }): Rec {
  expect(r.shadows, 'exactly one shadow event per Run').toHaveLength(1);
  expect(r.shadows[0].run_id).toBe(r.fact.result.run_id);
  return r.shadows[0];
}

describe('A2 L1 through run_analysis (real handler; only PLoT doubled)', () => {
  it('PRE: the served fa027cf5 Run stores AI Reporting Module Sprint as its leader and its constraint verdict entitles it', async () => {
    const r = await runOnce(FA027, fa027Graph, plotDouble('served'));
    expect(r.fact.result.leading_option_id).toBe(LEADER);
    expect(r.fact.result.constraint_verdict.may_name_leading_option).toBe(true);
    expect(warningCodes(r.fact)).toEqual([]);
  });

  it('L1-b: a separated comparative_leader Run is `permitted`, names the stored leader, and every live site agrees', async () => {
    const e = shadowOf(await runOnce(FA027, fa027Graph, plotDouble('served')));
    expect(e).toMatchObject({ verdict: 'permitted', leader_option_id: LEADER, reason: null, caveats: [],
      admission_mode: 'comparative_leader', claim_reason: null, failed_closed: false });
    expect(e.disagreements).toEqual([]);
  });

  it('L1-a (a994 class): goal figures withheld on the placeholder path → `withheld`/`goal_figures_withheld`; CV still permits', async () => {
    const r = await runCut();
    expect(warningCodes(r.fact)).toContain(GOAL_FIGURES_PLACEHOLDER_PATH);
    expect(r.fact.result.constraint_verdict.may_name_leading_option).toBe(true);
    expect(r.fact.result.leading_option_id).toBeNull();
    const e = shadowOf(r);
    expect(e).toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: 'goal_figures_withheld', caveats: [] });
    expect(e.disagreements).toEqual([{ site: 'CV', live: true, verdict: false }]);
  });

  it('L1-d (identical arms, SYNTHETIC pair): gate 1 v2 withholds → `withheld`/`options_do_not_separate`, never `permitted`', async () => {
    const r = await runOnce(FA027, fa027Graph, plotDouble('pair_same'));
    expect(warningCodes(r.fact)).toContain(GOAL_FIGURES_OPTIONS_IDENTICAL);
    const e = shadowOf(r);
    expect(e).toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: 'options_do_not_separate' });
    expect(e.disagreements).toEqual([{ site: 'CV', live: true, verdict: false }]);
  });

  it('L1-d (near tie, SYNTHETIC tie flag): `withheld`/`options_do_not_separate`; the stored leader and summary still name one', async () => {
    const r = await runOnce(FA027, fa027Graph, plotDouble('near_tie'));
    expect(r.fact.result.leading_option_id).toBe(LEADER);
    const e = shadowOf(r);
    expect(e).toMatchObject({ verdict: 'withheld', reason: 'options_do_not_separate', claim_reason: WITHHELD_NEAR_TIE });
    // The live finding L2 must close: three sites still name a leader the verdict withholds.
    expect(e.disagreements).toEqual([
      { site: 'CV', live: true, verdict: false },
      { site: 'stored_leader', live: true, verdict: false },
      { site: 'summary_leader', live: true, verdict: false },
    ]);
  });

  it('L1-f (NO BEHAVIOUR CHANGE): the Run outcome is identical with the shadow running and with it absent; the fact is never mutated', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-05T09:00:00.000Z'));
    const on = await runOnce(FA027, fa027Graph, plotDouble('near_tie'));
    expect(on.shadows).toHaveLength(1);
    expect(shadowSwitch.seen).toHaveLength(1);
    expect(shadowSwitch.seen[0].after).toBe(shadowSwitch.seen[0].before);
    logInfo.mockClear();
    shadowSwitch.off = true;
    const off = await runOnce(FA027, fa027Graph, plotDouble('near_tie'));
    expect(off.shadows).toHaveLength(0);
    expect(on.outcome).toEqual(off.outcome);
  });

  it('L1-g: nothing is stored: the result has no verdict key and parses; the strict schema REJECTS one (why L1 is log-only)', async () => {
    const r = await runOnce(FA027, fa027Graph, plotDouble('served'));
    expect(r.fact.result).not.toHaveProperty('leader_licence');
    expect(RunAnalysisResultSchema.safeParse(r.fact.result).success).toBe(true);
    expect(RunAnalysisResultSchema.safeParse({ ...r.fact.result, leader_licence: { verdict: 'permitted' } }).success).toBe(false);
  });
});

const BASE: LeaderLicenceVerdictInput = {
  runId: 'run-1', graphHash: 'gh-1', result: { leading_option_id: 'opt_a', enrichment: { inference_warnings: [] } },
  licence: 'permitted', leaderClaim: { permitted: true, separation: 'separated' },
  analysisReady: { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'comparative_leader', reasons: [] } },
  constraintEntitled: true, robustnessLevel: 'moderate',
};

describe('A2 L1 verdict mapping (pure; SYNTHETIC inputs)', () => {
  it('contrast: the base inputs give a plain `permitted` with no caveat', () => {
    expect(leaderLicenceVerdict(BASE)).toMatchObject({ verdict: 'permitted', leader_option_id: 'opt_a', reason: null, caveats: [] });
  });

  it('L1-c: a quantified_provisional admission → `permitted_with_caveat`, caveat `provisional_mode`', () => {
    const v = leaderLicenceVerdict({ ...BASE, licence: 'permitted_with_caveat',
      analysisReady: { analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'quantified_provisional', reasons: [] } } });
    expect(v).toMatchObject({ verdict: 'permitted_with_caveat', leader_option_id: 'opt_a', caveats: ['provisional_mode'] });
  });

  it('L1-e (DL ruling): a root treated as zero caps a `permitted` lead at `permitted_with_caveat`', () => {
    const roots = [{ node_id: 'churn', label: 'Churn', kind: 'risk', treated_as: 'zero' }];
    const v = leaderLicenceVerdict({ ...BASE, analysisReady: { ...(BASE.analysisReady as Rec), unvalued_roots: roots } });
    expect(v).toMatchObject({ verdict: 'permitted_with_caveat', leader_option_id: 'opt_a', caveats: ['unvalued_root_treated_as_zero'] });
    expect(leaderLicenceVerdict({ ...BASE, analysisReady: { ...(BASE.analysisReady as Rec), unvalued_roots: [] } }).verdict).toBe('permitted');
  });

  it('a licence with no stored leader names nobody (withheld, reason unknown)', () => {
    expect(leaderLicenceVerdict({ ...BASE, result: { enrichment: {} } })).toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: null });
  });

  it('an exploratory admission → `admission_exploratory`; TARGET_NOT_TESTABLE → `target_not_testable`', () => {
    const ready = (reasons: Rec[]) => ({ analysis_admission: { structurally_analysable: true, permitted_analysis_mode: 'exploratory', reasons } });
    expect(leaderLicenceVerdict({ ...BASE, licence: 'withheld', analysisReady: ready([]) }).reason).toBe('admission_exploratory');
    expect(leaderLicenceVerdict({ ...BASE, licence: 'withheld', analysisReady: ready([{ code: 'TARGET_NOT_TESTABLE' }]) }).reason)
      .toBe('target_not_testable');
  });

  it('CLASS: every Run-time leader_claim withheld code maps to a closed reason (none unnamed)', () => {
    const expected: Record<string, string> = {
      [WITHHELD_NEAR_TIE]: 'options_do_not_separate', [WITHHELD_SEPARATION_UNAVAILABLE]: 'separation_unavailable',
      [WITHHELD_GOAL_SCOPE_UNRESOLVED]: 'scope_unresolved', [WITHHELD_CONSTRAINT_VERDICT]: 'constraint_infeasible',
      [WITHHELD_NO_OPTION_MEETS_LIMIT]: 'constraint_infeasible', [WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT]: 'constraint_infeasible',
      [WITHHELD_RUN_IDENTITY_CONFLICT]: 'identity_conflict', [WITHHELD_RUN_IDENTITY_UNCONFIRMED]: 'identity_conflict',
      [WITHHELD_UNREQUESTED_ANALYSIS]: 'not_requested', [WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN]: 'sign_unproven',
      [WITHHELD_LEADER_CAUSE_UNRECORDED]: 'cause_unrecorded',
    };
    for (const [code, reason] of Object.entries(expected)) {
      expect(leaderLicenceVerdict({ ...BASE, licence: 'withheld', leaderClaim: { permitted: false, withheld_reason: code } }).reason, code)
        .toBe(reason);
    }
  });

  it('fails closed: a fact that throws on read gives `withheld`, reason null, `failed_closed`, and never throws', async () => {
    // The ACTUAL shadow, not this file's L1-f wrapper (which stringifies the fact first).
    const { leaderLicenceShadow: actual } = await vi.importActual<typeof import('../../../compose/leader-licence-shadow.js')>(
      '../../../compose/leader-licence-shadow.js');
    const fact = { fact_type: 'run_analysis', get result(): never { throw new Error('boom'); } };
    const out = actual({ fact: fact as never, graph: fa027Graph, scenarioId: FA027, summaryNamesLeader: true });
    expect(out).toMatchObject({ failed_closed: true, verdict: { verdict: 'withheld', reason: null, leader_option_id: null }, disagreements: [] });
  });
});
