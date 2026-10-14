/**
 * A2 L1 (Science 0df0e1): ONE leader-licence verdict per Run, SHADOW ONLY. `run_analysis` computes the verdict after
 * every Run-time withhold and logs `cee.leader_licence.shadow` with each live predicate's disagreement. Nothing stores
 * or reads it: the fact, the reply and every hash are unchanged.
 *
 * Real `run_analysis` handler and real snapshot loader. Fixtures:
 * - the served fa027cf5 graph (Acceptance receipt hourly-0325-20261005) and the served Run's own option statistics,
 *   inside a SYNTHETIC envelope: the golden happy response, whose `robustness.level: 'moderate'` supplies the
 *   separation. These rows cover the handler; they do NOT establish the served Run's own licence (Codex r2 P2);
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
const tele = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn(), debug: vi.fn(), emit: vi.fn() }));
vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: logInfo, warn: tele.warn, error: tele.error, debug: tele.debug },
  emit: tele.emit, TelemetryEvents: new Proxy({}, { get: (_t, p) => String(p) }),
}));
/** L1-f: `off` makes the shadow throw (as if it were absent); `seen` records the fact before and after it ran. */
const shadowSwitch = vi.hoisted(() => ({ off: false, slowMs: 0, seen: [] as Array<{ before: string; after: string }> }));
vi.mock('../../../compose/leader-licence-shadow.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../compose/leader-licence-shadow.js')>();
  return { ...original, leaderLicenceShadow: (input: Parameters<typeof original.leaderLicenceShadow>[0]) => {
    if (shadowSwitch.off) throw new Error('shadow disabled');
    const before = JSON.stringify(input.fact);
    const out = original.leaderLicenceShadow(input);
    // L1-f: a SLOW shadow (the fake clock jumps) must not reach any returned timing.
    if (shadowSwitch.slowMs > 0) vi.setSystemTime(Date.now() + shadowSwitch.slowMs);
    shadowSwitch.seen.push({ before, after: JSON.stringify(input.fact) });
    return out;
  } };
});

import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { priorRunForSeed } from '../../../coaching/seed-reuse.js';
import { NO_CLAIM, runWithBoundAnalysisSnapshot } from '../../../run-analysis-snapshot-binding.js';
import { createRegistry, resolveHandler } from '../../registry.js';
import { config } from '../../../../config/index.js';
import { GOAL_FIGURES_OPTIONS_IDENTICAL, GOAL_FIGURES_PLACEHOLDER_PATH } from '../../../../orchestrator/context/option-result-source.js';
import { leaderLicenceVerdict, storedResultRecords, type LeaderLicenceVerdictInput } from '../../../compose/leader-licence-verdict.js';
import { readResultRecords } from '../run-analysis.js';
import {
  WITHHELD_CONSTRAINT_VERDICT, WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT, WITHHELD_GOAL_SCOPE_UNRESOLVED,
  WITHHELD_LEADER_CAUSE_UNRECORDED, WITHHELD_NEAR_TIE, WITHHELD_NO_OPTION_MEETS_LIMIT,
  WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN, WITHHELD_RUN_IDENTITY_CONFLICT, WITHHELD_RUN_IDENTITY_UNCONFIRMED,
  WITHHELD_SEPARATION_UNAVAILABLE, WITHHELD_UNREQUESTED_ANALYSIS,
} from '../../../compose/analysis-state-v1.js';

type Rec = Record<string, any>;
const FA027 = 'fa027cf5-c5c9-4021-9578-ee79b15c6eb8';
const fa027Graph = JSON.parse(readFileSync(new URL('../../../handlers/__tests__/fixtures/sci-deep-fa027cf5-graph.json', import.meta.url), 'utf8')) as Rec;
// pre-ruling legacy class: a defaulted size that is not the door constant (Science 393023 LICENCE (a))
const fa027Legacy = structuredClone(fa027Graph);
for (const edge of fa027Legacy.edges) {
  if (edge.defaulted === true && Math.abs(edge.strength.mean) === 0.5 && edge.strength.std === 0.125
    && edge.provenance?.magnitude === undefined && edge.provenance?.natural_effect === undefined) edge.strength.std = 0.1;
}
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
type Shape = 'served' | 'pair_same' | 'near_tie' | 'label_only' | 'label_collision';

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
      // SYNTHETIC label_only: the engine's rows carry labels but no ids (the picker's documented label fallback).
      if (shape === 'label_only') for (const row of response.option_comparison as Rec[]) delete row.option_id;
      // SYNTHETIC label_collision (Codex r2 P1): no ids, and each row's label is ANOTHER option's id.
      if (shape === 'label_collision') {
        const rows = response.option_comparison as Rec[];
        const ids = rows.map((r) => String(r.option_id));
        rows.forEach((row, i) => { delete row.option_id; row.option_label = ids[(i + 1) % ids.length]; });
      }
      response.option_comparison_status = 'computed';
      response.results = (response.option_comparison as Rec[]).map((r) => ({ ...(r.option_id === undefined ? {} : { option_id: r.option_id }),
        option_label: r.option_label, win_probability: r.win_probability }));
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

afterEach(() => {
  logInfo.mockClear(); for (const f of Object.values(tele)) f.mockClear();
  shadowSwitch.off = false; shadowSwitch.slowMs = 0; shadowSwitch.seen = []; vi.useRealTimers();
});

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
  it('LICENCE (a) door constant: as-served fa027 withholds the leader', async () => {
    const r = await runOnce(FA027, fa027Graph, plotDouble('served'));
    // Science 393023 LICENCE (a)/(b), 7 Oct: fa027 door-default paths now withhold the leader.
    expect(r.fact.result.leading_option_id).toBeNull();
    expect(r.fact.result.constraint_verdict.may_name_leading_option).toBe(true);
    // Science 393023 LICENCE (a)/(b), 7 Oct: placeholder paths replace legacy disclosure; the no-target record stays.
    expect(warningCodes(r.fact)).toEqual(['GOAL_FIGURES_PLACEHOLDER_PATH', 'GOAL_FIGURES_NO_STATED_TARGET']);
  });

  it('LICENCE (a) door constant: shadow is withheld/goal_figures_withheld, CV still permits', async () => {
    const e = shadowOf(await runOnce(FA027, fa027Graph, plotDouble('served')));
    // Science 393023 LICENCE (a)/(b), 7 Oct: the same comparison now has an unsized goal path.
    expect(e).toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: 'goal_figures_withheld', caveats: [],
      admission_mode: 'comparative_leader', claim_reason: 'goal_path_unsized', failed_closed: false });
    // Science 393023 LICENCE (a)/(b), 7 Oct: the constraint verdict still permits; the path licence withholds.
    expect(e.disagreements).toEqual([{ site: 'CV', live: true, verdict: false }]);
  });

  it('PRE (served graph + statistics, SYNTHETIC envelope): the Run stores AI Reporting Module Sprint as its leader and its constraint verdict entitles it', async () => {
    const r = await runOnce(FA027, fa027Legacy, plotDouble('served'));
    expect(r.fact.result.leading_option_id).toBe(LEADER);
    expect(r.fact.result.constraint_verdict.may_name_leading_option).toBe(true);
    // ⭐ RE-PINNED, D3 step 1 (DL 0df0e1 #87 6006078553, PL rec 5), merged with MC P0 (#2613): this served goal holds NO
    // target, so whatever goal chances P0's Olumi-supplied-link withhold leaves are stripped with ONE typed `info` record —
    // not a withhold of anything the leader rests on.
    expect(warningCodes(r.fact)).toEqual(['GOAL_FIGURES_OLUMI_SUPPLIED_LINK', 'GOAL_FIGURES_NO_STATED_TARGET']);
  });

  it('L1-b (SYNTHETIC envelope): a separated comparative_leader Run is `permitted`, names the stored leader, and every live site agrees', async () => {
    const e = shadowOf(await runOnce(FA027, fa027Legacy, plotDouble('served')));
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
    const r = await runOnce(FA027, fa027Legacy, plotDouble('pair_same'));
    expect(warningCodes(r.fact)).toContain(GOAL_FIGURES_OPTIONS_IDENTICAL);
    const e = shadowOf(r);
    expect(e).toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: 'options_do_not_separate' });
    expect(e.disagreements).toEqual([{ site: 'CV', live: true, verdict: false }]);
  });

  it('L1-d (near tie, SYNTHETIC tie flag): `withheld`/`options_do_not_separate`; the stored leader and summary still name one', async () => {
    const r = await runOnce(FA027, fa027Legacy, plotDouble('near_tie'));
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

  it('L1-f (NO BEHAVIOUR CHANGE): with timings ON and a SLOW shadow, the outcome and every other telemetry call are identical to the Run without it; the fact is never mutated', async () => {
    const timing = config.cee.timingDebugEnabled;
    (config.cee as { timingDebugEnabled: boolean }).timingDebugEnabled = true;
    try {
      vi.useFakeTimers({ toFake: ['Date'] });
      const others = () => ({
        info: logInfo.mock.calls.filter((c) => (c[0] as Rec)?.event !== 'cee.leader_licence.shadow'),
        warn: tele.warn.mock.calls, error: tele.error.mock.calls, debug: tele.debug.mock.calls, emit: tele.emit.mock.calls,
      });
      vi.setSystemTime(new Date('2026-10-05T09:00:00.000Z'));
      shadowSwitch.slowMs = 5_000;
      const on = await runOnce(FA027, fa027Graph, plotDouble('near_tie'));
      const onTelemetry = structuredClone(others());
      expect(on.shadows).toHaveLength(1);
      expect(shadowSwitch.seen).toHaveLength(1);
      expect(shadowSwitch.seen[0].after).toBe(shadowSwitch.seen[0].before);
      expect((on.outcome as Rec).__plot_timings, 'timings are ON, so a slow shadow inside them would show').toBeDefined();
      logInfo.mockClear(); for (const f of Object.values(tele)) f.mockClear();
      shadowSwitch.off = true;
      vi.setSystemTime(new Date('2026-10-05T09:00:00.000Z'));
      const off = await runOnce(FA027, fa027Graph, plotDouble('near_tie'));
      expect(off.shadows).toHaveLength(0);
      expect(on.outcome).toEqual(off.outcome);
      expect(onTelemetry).toEqual(structuredClone(others()));
    } finally {
      (config.cee as { timingDebugEnabled: boolean }).timingDebugEnabled = timing;
    }
  });

  it('P1-2: a Run whose rows carry labels but no ids never names (or logs) the label as a leader', async () => {
    const r = await runOnce(FA027, fa027Graph, plotDouble('label_only'));
    const labels = (fa027Graph.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => String(n.label));
    expect(labels.length).toBeGreaterThan(1);
    // The precondition the finding needs: the picker stored a LABEL as the leader.
    expect(labels).toContain(r.fact.result.leading_option_id);
    const e = shadowOf(r);
    expect(e.leader_option_id).toBeNull();
    expect(e.verdict).toBe('withheld');
    const logged = JSON.stringify(e);
    for (const label of labels) expect(logged).not.toContain(label);
  });

  it('P1-2 r2: a label that equals ANOTHER option\'s id never licenses that option', async () => {
    const r = await runOnce(FA027, fa027Graph, plotDouble('label_collision'));
    // Precondition: the winner (AI Reporting, the largest share) carried the NEXT option's id as its label, and the
    // picker stored that id: a sent id, for the wrong option.
    expect(r.fact.result.leading_option_id).toBe('integration_bug_fix_sprint');
    const e = shadowOf(r);
    expect(e).toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: 'identity_conflict' });
  });

  it('L1-g: nothing is stored: the result has no verdict key and parses; the strict schema REJECTS one (why L1 is log-only)', async () => {
    const r = await runOnce(FA027, fa027Graph, plotDouble('served'));
    expect(r.fact.result).not.toHaveProperty('leader_licence');
    expect(RunAnalysisResultSchema.safeParse(r.fact.result).success).toBe(true);
    expect(RunAnalysisResultSchema.safeParse({ ...r.fact.result, leader_licence: { verdict: 'permitted' } }).success).toBe(false);
  });
});

const BASE: LeaderLicenceVerdictInput = {
  runId: 'run-1', graphHash: 'gh-1',
  result: { leading_option_id: 'opt_a',
    enrichment: { inference_warnings: [], option_comparison: [{ option_id: 'opt_a', win_probability: 0.7 }, { option_id: 'opt_b', win_probability: 0.3 }] },
    input_snapshot: { options: [{ option_id: 'opt_a' }, { option_id: 'opt_b' }] } },
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
    expect(leaderLicenceVerdict({ ...BASE, result: { ...BASE.result, leading_option_id: undefined } }))
      .toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: null });
  });

  it('P1-2 r2: rows without their own sent id (labels only, or mixed) are `identity_conflict` even when the leader is a sent id', () => {
    const snap = { options: [{ option_id: 'opt_a' }, { option_id: 'opt_b' }] };
    const collision = { leading_option_id: 'opt_b', input_snapshot: snap, enrichment: { inference_warnings: [],
      option_comparison: [{ option_label: 'opt_b', win_probability: 0.8 }, { option_label: 'Second', win_probability: 0.2 }] } };
    expect(leaderLicenceVerdict({ ...BASE, result: collision })).toMatchObject({ verdict: 'withheld', reason: 'identity_conflict' });
    const mixed = { ...collision, enrichment: { inference_warnings: [],
      option_comparison: [{ option_id: 'opt_b', win_probability: 0.8 }, { option_label: 'Second', win_probability: 0.2 }] } };
    expect(leaderLicenceVerdict({ ...BASE, result: mixed })).toMatchObject({ verdict: 'withheld', reason: 'identity_conflict' });
    // Contrast: the same Run with ids on every row names opt_b.
    const ided = { ...collision, enrichment: { inference_warnings: [],
      option_comparison: [{ option_id: 'opt_b', win_probability: 0.8 }, { option_id: 'opt_a', win_probability: 0.2 }] } };
    expect(leaderLicenceVerdict({ ...BASE, result: ided })).toMatchObject({ verdict: 'permitted', leader_option_id: 'opt_b' });
  });

  it('PARITY: the verdict reads the rows the picker reads (`readResultRecords`)', () => {
    const cmp = [{ option_id: 'a' }]; const res = [{ option_id: 'b' }];
    for (const env of [{ option_comparison: cmp, results: res }, { option_comparison: [], results: res }, { results: res }, {}]) {
      expect(storedResultRecords(env)).toEqual(readResultRecords(env as never));
    }
  });

  it('P1-2: a stored leader that is not an option this Run sent is `identity_conflict`; no snapshot names nobody', () => {
    expect(leaderLicenceVerdict({ ...BASE, result: { ...BASE.result, leading_option_id: 'Alice Smith' } }))
      .toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: 'identity_conflict' });
    expect(leaderLicenceVerdict({ ...BASE, result: { ...BASE.result, input_snapshot: undefined } }))
      .toMatchObject({ verdict: 'withheld', leader_option_id: null, reason: null });
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
      [WITHHELD_GOAL_SCOPE_UNRESOLVED]: 'scope_unresolved', [WITHHELD_CONSTRAINT_VERDICT]: 'constraint_withheld',
      [WITHHELD_NO_OPTION_MEETS_LIMIT]: 'constraint_infeasible', [WITHHELD_EVERY_OPTION_LIKELY_BREAKS_LIMIT]: 'limit_likely_breaks',
      [WITHHELD_RUN_IDENTITY_CONFLICT]: 'identity_conflict', [WITHHELD_RUN_IDENTITY_UNCONFIRMED]: 'identity_conflict',
      [WITHHELD_UNREQUESTED_ANALYSIS]: 'not_requested', [WITHHELD_NONLINEAR_IDENTITY_SIGN_UNPROVEN]: 'sign_unproven',
      [WITHHELD_LEADER_CAUSE_UNRECORDED]: 'cause_unrecorded',
    };
    for (const [code, reason] of Object.entries(expected)) {
      expect(leaderLicenceVerdict({ ...BASE, licence: 'withheld', leaderClaim: { permitted: false, withheld_reason: code } }).reason, code)
        .toBe(reason);
    }
  });

  it('P1-1: the summary names a leader only when the headline was EMITTED and names one', async () => {
    const { summaryNamesLeader } = await vi.importActual<typeof import('../../../compose/leader-licence-shadow.js')>(
      '../../../compose/leader-licence-shadow.js');
    expect(summaryNamesLeader('AI Reporting Module Sprint currently leads.', { has_leading_option: true })).toBe(true);
    // Withheld headline (constraint unevaluated, identity, provisional): the template names nobody.
    expect(summaryNamesLeader(null, { has_leading_option: true })).toBe(false);
    expect(summaryNamesLeader('Ran analysis.', { has_leading_option: false })).toBe(false);
  });

  it('fails closed: a fact that throws on read gives `withheld`, reason null, `failed_closed`, and never throws', async () => {
    // The ACTUAL shadow, not this file's L1-f wrapper (which stringifies the fact first).
    const { leaderLicenceShadow: actual } = await vi.importActual<typeof import('../../../compose/leader-licence-shadow.js')>(
      '../../../compose/leader-licence-shadow.js');
    const fact = { fact_type: 'run_analysis', get result(): never { throw new Error('boom'); } };
    const out = actual({ fact: fact as never, graph: fa027Graph, scenarioId: FA027, summaryNamesLeader: true });
    expect(out).toMatchObject({ failed_closed: true, verdict: { verdict: 'withheld', reason: null, leader_option_id: null }, disagreements: [] });
    // P2-5: a throwing field INSIDE the result is guarded on the fallback too.
    const inner = { fact_type: 'run_analysis', result: { get run_id(): never { throw new Error('boom'); } } };
    const out2 = actual({ fact: inner as never, graph: fa027Graph, scenarioId: FA027, summaryNamesLeader: false });
    expect(out2).toMatchObject({ failed_closed: true, verdict: { verdict: 'withheld', basis: { run_id: '' } } });
  });
});
