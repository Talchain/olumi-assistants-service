/**
 * ROADMAP 2.1089 — the baseline gate's BLOCKING arm, pinned at the HANDLER seam.
 *
 * Closes REVIEW-926 finding F-R3-1: reviewer mutant R3-C (`run-analysis.ts`
 * passing `[]` to `decideAnalysisScaleBlock` instead of the computed
 * `caplessRawBaselineIds`) survived the entire handlers test directory. The
 * pure predicate (`findScaleIncoherentBaselineFactorIds`) and the pure
 * decision (`decideAnalysisScaleBlock`) are thoroughly pinned — but nothing
 * asserted the HANDLER actually feeds the computed ids into the decision, so
 * a tidy-up deleting that argument would ship green and silently reopen the
 * R2-2 compute class (a raw capless baseline reaching PLoT's kernel beside
 * framed levels). Trap 13b's exact shape: presence of a control is not
 * coverage of the branch.
 *
 * This spec commits the reviewer's ROUND 3 VERIFICATION probe case (1): the
 * out/none add-node class — a capless factor whose observed pair is
 * {value: 40, raw_value: 40} (outside [0,1], no cap, no proving convention)
 * with NO user-authored interventions on it. The block can then fire ONLY
 * through the `caplessRawBaselineIds` argument (`projection.mixedUnresolved`
 * is false: every intervention on the wire is in-unit), so under R3-C the
 * verdict flips to `{blocked: false}`, PLoT IS called, and this spec REDs on
 * both assertions. Under the pristine handler it blocks with the typed
 * `analysis_not_ready` + `reason_code: baseline_scale_unresolved`, names the
 * factor, and never calls PLoT.
 *
 * DISCRIMINATION (trap 19 pair, proven in the lane's mutant run):
 *  - R3-C applied → the blocking `it` REDs (PLoT called / no typed throw);
 *  - the in-range CONTROL below stays GREEN under R3-C — so the pin binds to
 *    the baseline-ids argument specifically, not to "the handler throws".
 */

import { describe, it, expect, vi } from 'vitest';

import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEST_REQUEST_ID = 'req-baseline-gate-seam';

const PLOT_RESPONSE = {
  meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:baseline-gate-seam' },
  results: [{ option_id: 'opt_a', option_label: 'Committed', win_probability: 0.6 }],
  response_hash: 'sha256:baseline-gate-seam-top',
  analysis_status: 'completed',
} as unknown as V2RunResponseEnvelope;

function makeCapturingPlotClient(): { client: PLoTClient; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async () => JSON.parse(JSON.stringify(PLOT_RESPONSE)) as V2RunResponseEnvelope);
  const client = { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient;
  return { client, run };
}

function makeInvocation(): HandlerInvocation {
  return {
    context: {
      stage: 'analyse',
      entity_registry: { option_ids: [], goal_id: null },
      capabilities: {},
      messages: [{ role: 'user', content: 'run analysis' }],
      session_id: TEST_SCENARIO_ID,
      request_id: TEST_REQUEST_ID,
      budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({
      turn_id: 't1',
      scenario_id: TEST_SCENARIO_ID,
      message: 'run analysis',
      turn_class: 'decide',
      stage: 'analyse',
    }),
    requestId: TEST_REQUEST_ID,
    signal: new AbortController().signal,
    orientationText: '',
  };
}

const makeReader = (snapshot: RunAnalysisScenarioSnapshot): ScenarioReader =>
  vi.fn(() => Promise.resolve(snapshot));

/**
 * The out/none add-node shape (reviewer probe case 1):
 *  - `f_lic` — capless factor, observed {value: 40, raw_value: 40}: outside
 *    [0,1], raw == value proves no convention, NO cap ⇒ the baseline gate's
 *    incoherent class. NO option intervenes on it (a chat-added raw-magnitude
 *    factor — the add_node class).
 *  - `f_ok` — capless factor with an in-unit baseline and one in-unit
 *    user-authored intervention, so the request projection itself is fully
 *    coherent (`mixedUnresolved: false`) and the ONLY blocking evidence is
 *    the computed `caplessRawBaselineIds`.
 *  - The single option is configured, so `scaffoldUnconfiguredOptions`
 *    returns untouched (`unconfigured.length === 0`) — no synthesised values
 *    muddy the provenance.
 */
function makeOutNoneSnapshot(rawBaseline: Record<string, unknown>): RunAnalysisScenarioSnapshot {
  const graph = {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Goal' },
      { id: 'f_ok', kind: 'factor', label: 'Adoption Rate', observed_state: { value: 0.35 } },
      { id: 'f_lic', kind: 'factor', label: 'Annual Licence Cost', observed_state: rawBaseline },
      { id: 'opt_a', kind: 'option', label: 'Committed', interventions: { f_ok: { value: 0.5 } } },
    ],
    edges: [
      { from: 'f_ok', to: 'g' },
      { from: 'f_lic', to: 'g' },
      { from: 'opt_a', to: 'f_ok' },
    ],
  };
  return {
    graph,
    rawPersistedGraph: graph,
    goal_node_id: 'g',
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'Committed', interventions: { f_ok: { value: 0.5 } } },
    ],
  };
}

describe('2.1089 — baseline gate BLOCKING arm at the handler seam (kills mutant R3-C)', () => {
  it('an out/none capless raw baseline {40, 40} blocks with baseline_scale_unresolved, names the factor, and PLoT is NEVER called', async () => {
    const snapshot = makeOutNoneSnapshot({ value: 40, raw_value: 40 });
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    let thrown: unknown = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      thrown = err;
    }

    // The compute must never have been reached — under R3-C the handler hands
    // `[]` to the decision, the verdict is {blocked:false}, and this REDs.
    expect(run, 'PLoT must NOT be called when the baseline gate blocks').not.toHaveBeenCalled();

    expect(thrown, 'the handler must fail typed, not succeed silently').toBeInstanceOf(HandlerInvocationFailedError);
    const failure = thrown as HandlerInvocationFailedError;
    expect(failure.cause_kind).toBe('analysis_not_ready');

    const details = failure.details as { reason_code?: string; next_step?: string };
    // The BASELINE arm specifically — not the intervention-side mixed arm.
    expect(details.reason_code).toBe('baseline_scale_unresolved');
    // Identity binding (trap 19): the ask names THE offending factor…
    expect(details.next_step ?? '').toContain('Annual Licence Cost');
    // …and not the healthy one.
    expect(details.next_step ?? '').not.toContain('Adoption Rate');
    expect((details.next_step ?? '').toLowerCase(), 'the ask must tell the user what to provide').toMatch(/unit|scale/);
  });

  it('CONTROL: the same shape with an IN-unit baseline computes — the harness can reach PLoT at all (and stays green under R3-C)', async () => {
    const snapshot = makeOutNoneSnapshot({ value: 0.4 });
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    await handler(makeInvocation());

    expect(run, 'the in-range twin must compute — otherwise the blocking assertion above is vacuous').toHaveBeenCalledTimes(1);
  });
});
