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

type Rec = Record<string, any>;
const SCENARIO = 'f2f2f2f2-f2f2-4f2f-8f2f-f2f2f2f2f2f2';
const ENGINE = JSON.parse(readFileSync('tests/fixtures/track2-f2/point.plot-response.json', 'utf8')) as Rec;
const LINE = '‘Carry on’ still faces ‘Key supplier fails’ in this model, so its chance allows for that risk — not an assumption that nothing changes.';
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
  });

  it('CONTRAST: the same engine response with no risk in the model: carry on stays withheld as moved, with no risk line', async () => {
    const l = await licenceOfRun(stored(noRisk()));
    expect(l.withheld_reason_by_option?.status_quo).toMatchObject({ reason: 'reference_moved' });
    expect(l.pct_by_option).not.toHaveProperty('status_quo');
    expect(JSON.stringify(l)).not.toContain('still faces');
  });

  it('CONTRAST: a risk whose only path to the goal carrying on cuts (it sets the node between) earns nothing', () => {
    const g = stored(supplier('point'));
    const edge = (g.edges as Rec[]).find((e) => e.from === 'supplier_fails' && e.to === 'gp')!;
    g.nodes.push({ id: 'supply_loss', kind: 'factor', label: 'Supply loss', observed_state: { value: 0, raw_value: 0, cap: 1, unit: '' } });
    g.edges = [...(g.edges as Rec[]).filter((e) => e !== edge), { ...edge, to: 'supply_loss' }, { ...edge, from: 'supply_loss' }];
    const cut = structuredClone(g);
    const sq = (cut.nodes as Rec[]).find((n) => n.id === 'status_quo')!;
    sq.interventions = { ...(sq.interventions ?? {}), supply_loss: 0 };
    const open = goalChanceLicenceOf(structuredClone(ENGINE), g, 'gp');
    const closed = goalChanceLicenceOf(structuredClone(ENGINE), cut, 'gp');
    expect(open?.pct_by_option).toMatchObject({ status_quo: 92 });
    expect(closed?.withheld_reason_by_option?.status_quo).toMatchObject({ reason: 'reference_moved' });
  });

  it('NEGATIVE: a risk earns nothing on a change frame, on an unsupported reference, or for an exact chance on the wrong side', () => {
    const row = { probability_of_goal: 0.9 };
    expect(statusQuoReadingOf({ paired: true, forecast: false, row, reference: 0, zeroChange: 1, riskOnPath: true })).toBe('moved');
    expect(statusQuoReadingOf({ paired: true, forecast: false, row, reference: 16000, riskOnPath: true })).toBe('moved');
    expect(statusQuoReadingOf({ paired: true, forecast: false, row: { probability_of_goal: 0 }, reference: 16000, referenceChance: 1, riskOnPath: true })).toBe('moved');
    expect(statusQuoReadingOf({ paired: true, forecast: false, row, reference: 16000, referenceChance: 1, riskOnPath: true })).toBe('at_risk');
    expect(statusQuoReadingOf({ paired: true, forecast: false, row, reference: 16000, referenceChance: 1 })).toBe('moved');
  });
});
