/**
 * DL ruling 21 Oct (Lenses #3584): an option nothing links to the goal is left out of the comparison (`no_path_to_goal`,
 * `analysable-option-gate.ts`). It has no engine row, so it had no cell. Its cell now says why, with the same next step the
 * reply gives ("Say what <option> changes that affects <goal>"). The real Run handler; PLoT answers with the engine's own
 * response for the two options it compares (`tests/fixtures/no-path-cell`). SYNTHETIC wording.
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
import { KNOWN_ANSWER } from '../../path-b/living-model/__tests__/fixtures.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../tools/registry.js';
import { createRunAnalysisHandler } from '../../tools/handlers/run-analysis.js';
import { goalChanceLicenceOf } from '../goal-chance-licence.js';
import { goalChanceWithheldReasonsForAgent } from '../goal-chance-range-agent.js';
import { projectCanonicalAnalysisCells } from '../../../routes/canonical-analysis-view.js';

type Rec = Record<string, any>;
const SCENARIO = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ENGINE = JSON.parse(readFileSync('tests/fixtures/no-path-cell/known-answer.plot-response.json', 'utf8')) as Rec;
const LINE = '\'Pivot\' was left out of this comparison because nothing links it to \'Reach 100 units\'. Say what \'Pivot\' changes that affects \'Reach 100 units\'.';
/** Lenses' shape: an option that sets only "Office move", a factor nothing links to the goal. */
const withPathlessOption = (lm: LivingModelT): LivingModelT => ({ ...lm,
  factors: [...lm.factors, { kind: 'factor', limit: null, id: 'office', label: 'Office move', value: 0, low: null, high: null, unit: null, defined_as: null, source: 'user', party: null, quote: null }],
  options: [...lm.options, { status: 'feasible', id: 'pivot', label: 'Pivot', developed_from: null, source: 'user', party: null, quote: null,
    settings: [{ factor_id: 'office', value: 1, low: null, high: null, unit: null, source: 'user', party: null, quote: null }] }] });
const stored = (m: LivingModelT): Rec => projectCorePostimageForPersistence(GraphV3.parse({ ...mapLivingModel(m).graph, living_model: m })) as Rec;

async function runOf(graph: Rec): Promise<{ result: Rec; licence: Rec; sent: string[] }> {
  const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: async () => ({ graph: structuredClone(graph), briefText: null }),
    loadGraph: async () => structuredClone(graph) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'np', store as never);
  const run = vi.fn(async () => structuredClone(ENGINE) as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({ plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot });
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
      request_id: 'np', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 'np', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'np', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledOnce();
  const sent = ((run.mock.calls as unknown as [Rec][])[0][0].options as Rec[]).map((o) => o.option_id ?? o.id);
  const fact = outcome.handler_facts.find((f) => f.fact_type === 'run_analysis') as Rec;
  return { result: fact.result, sent, licence: fact.result.enrichment.inference_warnings.find((w: Rec) => w.code === 'GOAL_CHANCE_LICENSED') };
}

describe('an option left out for having no path to the goal has a cell that says why and what next', () => {
  it('RED (real handler): Pivot is not sent; its cell is withheld with its own reason and the next step; Push keeps its chance', async () => {
    const graph = stored(withPathlessOption(KNOWN_ANSWER));
    const { result, licence, sent } = await runOf(graph);
    expect(sent).toEqual(['hold', 'push']);
    expect(licence.pct_by_option).toMatchObject({ push: 15 });
    expect(licence.option_ids).toContain('pivot');
    expect(licence.withheld_option_ids).toContain('pivot');
    expect(licence.withheld_reason_by_option?.pivot).toEqual({ reason: 'no_path_to_goal', line: LINE });
    // The reader the canonical view and the Agent share.
    expect(goalChanceWithheldReasonsForAgent(result, 'pivot')[0]).toEqual({ code: 'no_path_to_goal', message: LINE });
    // The cell the person sees.
    const cell = projectCanonicalAnalysisCells({ type: 'analysis_result', ...result } as never, graph).find((c) => c.option_id === 'pivot')?.cell;
    expect(cell).toMatchObject({ kind: 'withheld', why: LINE });
  });

  it('CONTRAST: with nothing left out, the same Run has no such cell', async () => {
    const { licence, sent } = await runOf(stored(KNOWN_ANSWER));
    expect(sent).toEqual(['hold', 'push']);
    expect(licence.option_ids).not.toContain('pivot');
    expect(JSON.stringify(licence)).not.toContain('no_path_to_goal');
  });

  it('CONTRAST: an option left out for having no values set keeps its own handling; only a pathless one gets this cell', () => {
    const g = stored(KNOWN_ANSWER);
    const l = goalChanceLicenceOf(structuredClone(ENGINE), g, 'g', undefined, undefined, g, {
      excludedOptions: [{ option_id: 'idle', label: 'Idle', reason: 'no_interventions' }] });
    expect(l?.option_ids).not.toContain('idle');
    expect(l?.withheld_reason_by_option?.idle).toBeUndefined();
  });
});
