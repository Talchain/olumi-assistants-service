/**
 * Cut-3 R6 (Science #87 6002390259; DL 0df0e1): a target the Run cannot test must not take away the separation
 * evidence. At CEE b644ddb8 the target-not-testable withhold emptied `robustness`, so the leader check read nothing and
 * the leader was withheld as `separation_unavailable` ("could not work out how far apart…") on Acceptance's fresh case,
 * even after the user sized both deciding links. RT-10 B′ R2 (#2606) keeps the ordering's evidence (`robustness`,
 * flips, synthesis) beside the shares; this pins it on the served case.
 *
 * Fixture: the stored graph after both sizings (byte-exact DB read) and the REAL PLoT body for CEE's exact payload.
 * THE PATH: the real loader and the real run_analysis handler. Rung: TESTED (in-process), not a wire witness.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { targetTestabilityOf } from '../../../admission/target-testability.js';
import {
  readRawRobustnessFromResponseBody, separationWithholdFromRobustness, WITHHELD_SEPARATION_UNAVAILABLE,
} from '../../../compose/analysis-state-v1.js';
import { GOAL_FIGURES_TARGET_NOT_TESTABLE } from '../../../../orchestrator/context/option-result-source.js';

type Json = Record<string, any>;
const F = JSON.parse(readFileSync(new URL('./fixtures/r6-target-keeps-separation.json', import.meta.url), 'utf8')) as {
  brief_text: string; graph: Json; plot_body: Json;
};
const SCENARIO = '00000000-0000-4000-8000-0000000000a6';
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const robustnessOf = (envelope: unknown) => readRawRobustnessFromResponseBody({ blocks: [{ enrichment: envelope }] });

async function runR6(): Promise<Json> {
  const store = {
    readMostRecentPendingActions: async () => [],
    loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(F.graph), briefText: F.brief_text })),
    loadGraph: vi.fn(async () => clone(F.graph)),
  };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-r6-load', store as never);
  const run = vi.fn(async () => clone(F.plot_body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot),
  });
  const outcome = await handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: SCENARIO, request_id: 'req-r6-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 't-r6', scenario_id: SCENARIO, message: 'Run analysis', turn_class: 'frame', stage: 'analyse' } as never),
    requestId: 'req-r6-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(run).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error(`wrong fact_type ${fact.fact_type}`);
  return fact.result as Json;
}

describe('Cut-3 R6 — an untestable target keeps the separation evidence', () => {
  it('precondition: the case after both sizings has a target the Run cannot test, and PLoT measured the separation', () => {
    expect(targetTestabilityOf(F.graph).kind).toBe('not_testable');
    expect(F.graph.edges.filter((e: Json) => e.provenance?.source === 'user_specified')).toHaveLength(3);
    expect(F.plot_body.robustness_status).toBe('computed');
    expect(robustnessOf(F.plot_body)).toEqual({ level: 'low', near_tie_is_tie: false });
    // The evidence the next row says survives is really there to survive (no vacuous "kept").
    expect(F.plot_body.flip_thresholds).toHaveLength(2);
    expect(F.plot_body.robustness.fragile_edges).toHaveLength(11);
    expect(F.plot_body.robustness_synthesis).toBeDefined();
  });

  it('through the real handler: the target-only withhold keeps robustness, so separation is evaluated (never separation_unavailable)', async () => {
    const result = await runR6();
    const env = result.enrichment as Json;
    // The withhold that applied is the TARGET one, and it kept the ordering (no win_share in its withheld claims).
    const target = (env.inference_warnings as Json[]).filter((w) => w.code === GOAL_FIGURES_TARGET_NOT_TESTABLE);
    expect(target).toHaveLength(1);
    expect(target[0]!.withheld_claims).toEqual(['goal_probability', 'joint_probability', 'outcome', 'downside']);
    // The separation evidence survives, exactly as PLoT measured it.
    const raw = robustnessOf(env);
    expect(raw).toEqual({ level: 'low', near_tie_is_tie: false });
    expect(separationWithholdFromRobustness(raw)).toBeNull();
    expect(separationWithholdFromRobustness(raw)).not.toBe(WITHHELD_SEPARATION_UNAVAILABLE);
    // The comparison's other evidence stays with it, and the Run names its leader by identity.
    expect(env.flip_thresholds).toEqual(F.plot_body.flip_thresholds);
    expect(env.robustness).toEqual(F.plot_body.robustness);
    expect(env.robustness_synthesis).toEqual(F.plot_body.robustness_synthesis);
    expect(result.leading_option_id).toBe('fix_integration_step_bug');
  });
});
