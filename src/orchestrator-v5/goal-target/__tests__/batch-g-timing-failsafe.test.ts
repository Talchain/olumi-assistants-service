/** G2: AI timing argument → existing capability/chip → real Run handler → stored CEE licence/refusal. No timing sweep. */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { AGENT_TOOLS, AIE_APPROVED_EFFECTS_TIMING_DESCRIPTION, dispatchTool } from '../../agent-lane/runtime/agent-tools.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { createRunAnalysisHandler, setHostLicenceStages } from '../../tools/handlers/run-analysis.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../build-turn-context.js';
import { goalChanceLicenceForAgent } from '../goal-chance-licence.js';
// S12 shortcut (#3238): this spec pins a host withhold stage that is switched off by default; it runs it explicitly (post-PoC deletion).
setHostLicenceStages(true);

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/batch-g/served-hiring-run4-turn07-20261012T172858Z.json', 'utf8')) as Rec;
const SCENARIO = '3ad403fc-caf8-48e4-bd5b-578e20c1c48a';
const NOTE = 'Provisional: this calculation assumes the estimated effects are in place by month three. It does not model when they arrive.';
const WITHHOLD = 'The chance of reaching your target for ‘productivity’ (up at least 10% from today) by month three isn’t shown: '
  + 'the model has not established how much of these effects would be in place by then.';

describe('G2: AI reading is required and carried into this Run, with Olumi origin', () => {
  it('one required nullable enum argument uses the exact approved AIE text', () => {
    const tool = AGENT_TOOLS.find((t) => t.name === 'run_analysis')!;
    expect(tool.parameters.required).toEqual(['reason', 'effects_timing']);
    expect(AIE_APPROVED_EFFECTS_TIMING_DESCRIPTION).toBe("Your reading of the current held target, its period and the options being analysed, using the current canonical model and all relevant readable user statements, including later turns. Choose in_place_by_period only when those statements support the relevant effects being fully in place by that period; later_or_partial when a relevant effect arrives later or only partly; not_stated only when the complete readable relevant source states no effects timing (the goal's period alone is not effects timing). Use null when required context is missing, truncated, unreadable, has unknown authorship, conflicts, or cannot be classified reliably; never turn unknown into not_stated. In reason, identify the actual target/period and the source or missing context for your reading. This is Olumi's interpretation, not a measurement, human approval or a change to the user's evidence.");
    expect((tool.parameters.properties as Rec).effects_timing).toEqual({ anyOf: [
      { type: 'string', enum: ['in_place_by_period', 'later_or_partial', 'not_stated'] },
      { type: 'null' },
    ], description: AIE_APPROVED_EFFECTS_TIMING_DESCRIPTION });
  });

  it.each([
    ['The hires start in month four.', 'later_or_partial', false],
    ['The hires cannot contribute during that window.', 'later_or_partial', false],
    ['', 'not_stated', true],
    ['The effects are fully in place by month three.', 'in_place_by_period', true],
    ['', null, false],
    ['', undefined, false],
    ['', 'invalid', false],
  ] as const)('%s / %s → licensed=%s', async (words, effects_timing, licensed) => {
    const graph = structuredClone(FX.graph);
    // Positive timing/licence fixture: explicitly hold its sampled risk; original captured bytes stay untouched.
    graph.nodes.find((n: Rec) => n.id === 'launch_date_missed').observed_state = {
      value: 0.2, raw_value: 0.2, source: 'cee_inference', extractionType: 'inferred',
    };
    const before = JSON.stringify(graph);
    const store = {
      readMostRecentPendingActions: async () => [],
      loadGraphAndBriefText: async () => ({ graph, briefText: `${FX.brief} ${words}` }),
      loadGraph: async () => graph,
    };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'g2-load', store as never);
    const plotRun = vi.fn(async () => ({ ...structuredClone(FX.envelope), analysis_status: 'computed',
      meta: { seed_used: 1, n_samples: 1000, response_hash: 'g2-timing' }, response_hash: 'g2-timing' }));
    const handler = createRunAnalysisHandler({ plotClient: { run: plotRun } as never,
      scenarioReader: async () => snapshot });
    let stored: Rec | undefined;
    const dispatch: InternalDispatch = async (path, body) => {
      if (path !== '/orchestrate/v2/turn') return { status: 200, json: { graph } };
      expect((body as Rec).chip.parameters.effects_timing).toBe(effects_timing);
      const outcome = await handler({ payload: body, requestId: 'g2-run', signal: new AbortController().signal,
        orientationText: '', context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null },
          capabilities: {}, messages: [], session_id: SCENARIO, request_id: 'g2-run',
          budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
          scenarioBriefText: null, persistedGraph: null } } as never);
      const fact = outcome.handler_facts[0]!;
      expect(fact.fact_type).toBe('run_analysis');
      stored = JSON.parse(JSON.stringify((fact as Rec).result.enrichment));
      return { status: 200, json: { analysis_ready: { status: 'ready' }, blocks: [] } };
    };
    const caps = createAgentCapabilities(dispatch, new ProposalStore());
    await dispatchTool('run_analysis', JSON.stringify({ reason: 'Run the analysis',
      ...(effects_timing === undefined ? {} : { effects_timing }) }),
      { scenario_id: SCENARIO, authenticated_user_id: 'g2', request_id: 'g2' }, caps);
    expect(plotRun).toHaveBeenCalledTimes(1);
    expect(stored).toBeDefined();
    const valid = effects_timing !== null && effects_timing !== undefined && effects_timing !== 'invalid';
    expect(stored).not.toHaveProperty('effects_timing');
    expect(stored).not.toHaveProperty('effects_timing_origin');
    const record = (stored!.inference_warnings as Rec[]).find((w) => licensed
      ? w.code === 'GOAL_CHANCE_LICENSED' : w.detail?.reason === 'effects_at_period_end_unstated');
    const reading = licensed ? record : record?.detail;
    expect(reading?.effects_timing).toBe(valid ? effects_timing : null);
    expect(reading?.effects_timing_origin).toBe(valid ? 'olumi' : null);
    const licence = goalChanceLicenceForAgent({ type: 'analysis_result', enrichment: stored });
    const warning = (stored!.inference_warnings as Rec[]).find((w) => w.detail?.reason === 'effects_at_period_end_unstated');
    if (licensed) {
      expect(licence?.notes).toContain(NOTE);
      expect(warning).toBeUndefined();
    } else {
      expect(licence).toBeUndefined();
      expect(warning).toMatchObject({ message: WITHHOLD, option_ids: ['hire_a_tech_lead', 'hire_two_developers'] });
      expect(JSON.stringify(stored)).not.toContain(NOTE);
    }
    expect(JSON.stringify(graph)).toBe(before);
    expect(graph.nodes.find((n: Rec) => n.id === 'productivity').goal_target_basis.effects_at_period_end).toBe(false);
  });
});
