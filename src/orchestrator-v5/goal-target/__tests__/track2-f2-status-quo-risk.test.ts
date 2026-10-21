/**
 * DL ruling on served F2 (L1, 21 Oct 2026). Served CEE 8177faa9 withheld carrying on's chance (0.9154) as `reference_moved`:
 * the licence read any status-quo chance between 0 and 1 as "moved from today". Carrying on still faces the supplier
 * failure the person stated, so that chance is earned. It is now shown, with a line naming the risk. Every other
 * disagreement stays withheld. The envelope is the REAL PLoT → ISL response to this exact request (`tests/fixtures/track2-f2`).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../orchestrator/types.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import type { LivingModelT } from '../../../schemas/living-model.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { projectCorePostimageForPersistence } from '../../persisted-graph-projection.js';
import { mapLivingModel } from '../../path-b/living-model/mapper.js';
import { supplier } from '../../path-b/living-model/__tests__/track2-f2-event-risk.fixtures.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { goalChanceLicenceOf, statusQuoReadingOf } from '../goal-chance-licence.js';
import { GOAL_TARGET_ROLE } from '../goal-targets-joint.js';
import { wireGoalConstraints } from '../../tools/handlers/run-analysis.js';

type Rec = Record<string, any>;
const SCENARIO = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
const ENGINE = JSON.parse(readFileSync('tests/fixtures/track2-f2/point.plot-response.json', 'utf8')) as Rec;
const LINE = '‘Carry on’ still faces ‘Key supplier fails’ in this model, so its chance allows for that risk — not an assumption that nothing changes.';
/** The threshold the Run sends for F2 (goal ≥ £12,000 on its £20,000 frame; today £16,000), pinned by the handler row below. */
const SENT = { value: 0.6, field: 'goal_threshold', frame: 'level', baseline: 0.8, status_quo_option_id: 'status_quo' } as const;
const stored = (m: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Rec;
const noRisk = (): LivingModelT => {
  const m = supplier('point');
  // No risk, so no mitigation step either: the dual-source option keeps only its cost.
  return { ...m, risks: [], factors: [], options: m.options.map((o) => ({ ...o, settings: [] })), links: m.links.filter((l) => l.from !== 'supplier_fails') };
};

/** The real Run handler on the saved graph; PLoT answers with the engine's own response. Returns the stored licence. */
async function licenceOfRun(graph: Rec): Promise<Rec> {
  const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: null }),
    loadGraph: async () => structuredClone(graph) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'f2-sq', store as never);
  const run = vi.fn(async () => structuredClone(ENGINE) as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot });
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
      request_id: 'f2-sq', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 'f2-sq', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'f2-sq', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledOnce();
  const fact = outcome.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec;
  return fact.result.enrichment.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED');
}

describe('carrying on as now, facing a risk the person stated, has an earned chance', () => {
  it('KNOWN ANSWER: the engine\'s carry-on chance is the analytic 1 − 0.10·Φ(1) = 0.916, within four standard errors', () => {
    const row = (ENGINE.option_comparison as Rec[]).find((o) => o.option_id === 'status_quo')!;
    const analytic = 1 - 0.10 * 0.841345;
    expect(Math.abs(row.probability_of_goal - analytic)).toBeLessThan(4 * Math.sqrt(analytic * (1 - analytic) / row.outcome.n_samples));
  });

  it('F2 (real handler, real engine response): carry on is shown at 92 %, named with the risk it still faces', async () => {
    const l = await licenceOfRun(stored(supplier('point')));
    expect(l.withheld_reason_by_option?.status_quo).toBeUndefined();
    expect(l.withheld_option_ids ?? []).not.toContain('status_quo');
    expect(l.pct_by_option).toMatchObject({ status_quo: 92, dual_source: 97 });
    expect(l.notes).toContain(LINE);
    expect(l.sent_threshold).toEqual(SENT);
  });

  it('CONTRAST: the same engine response with no risk in the model: carry on stays withheld as moved, with no risk line', async () => {
    const l = await licenceOfRun(stored(noRisk()));
    expect(l.withheld_reason_by_option?.status_quo).toMatchObject({ reason: 'reference_moved' });
    expect(l.pct_by_option).not.toHaveProperty('status_quo');
    expect(JSON.stringify(l)).not.toContain('still faces');
  });

  // Codex r1 on #3582: each counterexample it reproduced, on the same saved graph and the Run's own sent threshold.
  const lic = (graph: Rec, env: Rec = ENGINE) => goalChanceLicenceOf(structuredClone(env), graph, 'gp', undefined, SENT as never);
  const sqOf = (l: ReturnType<typeof lic>) => ({ pct: l?.pct_by_option?.status_quo, reason: (l?.withheld_reason_by_option as Rec | undefined)?.status_quo?.reason });
  const EARNED = { pct: 92, reason: undefined };
  const MOVED = { pct: undefined, reason: 'reference_moved' };
  const f2 = () => stored(supplier('point'));
  const nodeOf = (g: Rec, id: string): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;

  it('CONTROL: the same saved graph and engine response, read directly with the Run\'s threshold, earn 92 %', () => {
    expect(sqOf(lic(f2()))).toEqual(EARNED);
  });

  it('NEGATIVE: a move the risk cannot explain stays withheld: 50 % when at most 15 % can fail, or a frame the Run did not record', () => {
    const env = structuredClone(ENGINE);
    (env.option_comparison as Rec[]).find((o) => o.option_id === 'status_quo')!.probability_of_goal = 0.5;
    expect(sqOf(lic(f2(), env))).toEqual(MOVED);
    const unframed = goalChanceLicenceOf(structuredClone(ENGINE), f2(), 'gp');
    expect(unframed?.withheld_reason_by_option?.status_quo).toMatchObject({ reason: 'reference_moved' });
    // Codex r2 on #3582: a row mixing frames (a raw £ figure beside the encoded median) is not the Run's own reading.
    for (const mixed of [{ p10: 8000 }, { mean: 15200 }, { p90: 16000 }]) {
      const env2 = structuredClone(ENGINE);
      const row = (env2.option_comparison as Rec[]).find((o) => o.option_id === 'status_quo')!;
      row.outcome = { ...row.outcome, ...mixed };
      expect(sqOf(lic(f2(), env2)), JSON.stringify(mixed)).toEqual(MOVED);
    }
  });

  it('NEGATIVE: a path carrying on cuts earns nothing, whether its setting is held in interventions or in data.interventions', () => {
    const between = (): Rec => {
      const g = f2();
      const edge = (g.edges as Rec[]).find((e) => e.from === 'supplier_fails' && e.to === 'gp')!;
      g.nodes.push({ id: 'supply_loss', kind: 'factor', label: 'Supply loss', observed_state: { value: 0, raw_value: 0, cap: 1, unit: '' } });
      g.edges = [...(g.edges as Rec[]).filter((e) => e !== edge), { ...edge, to: 'supply_loss' }, { ...edge, from: 'supply_loss' }];
      return g;
    };
    expect(sqOf(lic(between()))).toEqual(EARNED);
    const top = between();
    nodeOf(top, 'status_quo').interventions.supply_loss = { value: 0, raw_value: 0 };
    expect(sqOf(lic(top))).toEqual(MOVED);
    const nested = between();
    nodeOf(nested, 'status_quo').data = { interventions: { supply_loss: { value: 0, raw_value: 0 } } };
    expect(sqOf(lic(nested))).toEqual(MOVED);
  });

  it('NEGATIVE: a risk that cannot happen under carrying on (no chance, or fully prevented there), or reaches the goal only through an option, earns nothing', () => {
    const none = f2();
    nodeOf(none, 'supplier_fails').event_risk.occurrence = { p_low: 0, p_high: 0, basis: 'user' };
    expect(sqOf(lic(none))).toEqual(MOVED);
    const beside = f2();
    beside.nodes.push({ ...nodeOf(beside, 'supplier_fails'), id: 'flood', label: 'Flood', event_risk: { ...nodeOf(beside, 'supplier_fails').event_risk, occurrence: { p_low: 0, p_high: 0, basis: 'user' } } });
    beside.edges.push({ ...(beside.edges as Rec[]).find((e) => e.from === 'supplier_fails' && e.to === 'gp')!, from: 'flood' });
    expect(lic(beside)?.notes).toContain(LINE);
    const prevented = f2();
    nodeOf(prevented, 'supplier_fails').event_risk.mitigations[0].occurrence_reduction = 1;
    nodeOf(prevented, 'status_quo').interventions.dual_sourcing = { value: 1, raw_value: 1 };
    expect(sqOf(lic(prevented))).toEqual(MOVED);
    const viaOption = f2();
    viaOption.edges = [...(viaOption.edges as Rec[]).map((e) => (e.from === 'supplier_fails' && e.to === 'gp' ? { ...e, to: 'dual_source' } : e)),
      { from: 'dual_source', to: 'gp', strength: { mean: 1, std: 0.01 }, exists_probability: 1 }];
    expect(sqOf(lic(viaOption))).toEqual(MOVED);
  });

  it('NEGATIVE: with several targets sent, carrying on is read as before: this rule licenses the single goal\'s chance only', () => {
    const g = f2();
    const stored = [{ constraint_id: 'target:gp', node_id: 'gp', role: GOAL_TARGET_ROLE, operator: '>=', value: 12000, unit: '£', label: 'Gross profit', value_frame: 'level' }];
    const l = goalChanceLicenceOf(structuredClone(ENGINE), g, 'gp', undefined, SENT as never, g, { storedConstraints: stored, sentConstraints: wireGoalConstraints(stored) });
    expect(l?.pct_by_option ?? {}).not.toHaveProperty('status_quo');
    expect(JSON.stringify(l)).not.toContain('still faces');
  });

  it('NEGATIVE: a risk earns nothing on a change frame, on an unsupported reference, for an exact chance on the wrong side, or past a half', () => {
    const row = { probability_of_goal: 0.9, outcome: { p50: 16000, n_samples: 10000 } };
    const at = (x: Record<string, unknown>) => statusQuoReadingOf({ paired: true, forecast: false, row, reference: 16000, referenceChance: 1, riskChance: 0.15,
      frameRatio: 0.8 / 16000, ...x });
    expect(at({})).toBe('at_risk');
    expect(at({ riskChance: undefined })).toBe('moved');
    expect(at({ referenceChance: undefined })).toBe('moved');
    expect(at({ reference: 0, zeroChange: 1, referenceChance: undefined })).toBe('moved');
    expect(at({ row: { probability_of_goal: 0 } })).toBe('moved');
    expect(at({ riskChance: 0.6 })).toBe('moved');
    expect(at({ row: { probability_of_goal: 0.9, outcome: { p50: 16000 } } })).toBe('moved');
    expect(at({ frameRatio: undefined })).toBe('moved');
    expect(at({ row: { probability_of_goal: 0.9, outcome: { p50: 16000, p10: 0.7, n_samples: 10000 } } })).toBe('moved');
    expect(at({ row: { probability_of_goal: 0.9, outcome: { p50: 16000, p10: 8000, n_samples: 10000 } } })).toBe('at_risk');
  });
});
