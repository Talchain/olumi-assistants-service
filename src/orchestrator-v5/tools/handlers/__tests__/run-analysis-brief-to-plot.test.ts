/**
 * Lane 28 — brief pipeline seam 3: flag-gated CEE → PLoT brief leg.
 *
 * PLoT's /v2/run accepts a top-level `brief` (string, maxLength 10000 —
 * plot-lite-service src/routes/v2/run.ts V2_RUN_ALLOWED_KEYS + runV3Schema)
 * and gates its factor-review / M2 legs on `!!body.brief` (`brief_present`
 * telemetry). CEE has never sent it, so those legs are structurally dead.
 *
 * The leg ships DARK behind CEE_SEND_BRIEF_TO_PLOT (default OFF): doctrine
 * ask D5 (brief-to-PLoT privacy) is Paul-gated and undecided. These tests
 * pin:
 *   1. flag OFF (default) → the outbound payload carries NO `brief` key even
 *      when the snapshot has one (wire-identical to today);
 *   2. flag ON + snapshot brief → payload.brief === snapshot.briefText;
 *   3. flag ON + no brief → no `brief` key (PLoT's `no_brief` skip stays
 *      honest — we never send an empty string);
 *   4. flag ON + over-wire-max brief → bounded at PLOT_BRIEF_MAX_CHARS with
 *      a disclosed warn log (defence-in-depth: the scenarios.brief_text DB
 *      CHECK caps at 8000, under PLoT's 10000, so this should never fire).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { config } from '../../../../config/index.js';
import type { PLoTClient, PLoTClientRunOpts } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  PLOT_BRIEF_MAX_CHARS,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import happyFixture from '../../../../../tests/fixtures/plot/v2-run-golden-happy.json' with { type: 'json' };
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const BRIEF = 'Should we hire locally or offshore? Budget £250k, decide by Q3.';

function makeScenarioSnapshot(
  overrides?: Partial<RunAnalysisScenarioSnapshot>,
): RunAnalysisScenarioSnapshot {
  const graph = overrides?.graph ?? { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] };
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
    ...overrides,
  };
}

function makeScenarioReader(snapshot: RunAnalysisScenarioSnapshot): ScenarioReader {
  return vi.fn<[string, AbortSignal | undefined], Promise<RunAnalysisScenarioSnapshot>>(
    () => Promise.resolve(snapshot),
  );
}

function makeCapturingPlotClient(): { client: PLoTClient; payloads: Array<Record<string, unknown>> } {
  const payloads: Array<Record<string, unknown>> = [];
  const run = vi.fn<
    [Record<string, unknown>, string, PLoTClientRunOpts | undefined],
    Promise<V2RunResponseEnvelope>
  >((payload) => {
    payloads.push(payload);
    return Promise.resolve(JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope);
  });
  const validatePatch = vi.fn().mockResolvedValue({});
  return { client: { run, validatePatch } as unknown as PLoTClient, payloads };
}

function makeInvocation(): HandlerInvocation {
  return {
    context: { stage: 'analyse' },
    payload: makeMessagePayload({ scenario_id: TEST_SCENARIO_ID, message: 'run the analysis' }),
    args: {},
    requestId: 'req-brief-plot',
    signal: new AbortController().signal,
  } as unknown as HandlerInvocation;
}

async function runWith(
  snapshot: RunAnalysisScenarioSnapshot,
): Promise<Record<string, unknown>> {
  const { client, payloads } = makeCapturingPlotClient();
  const handler = createRunAnalysisHandler({
    plotClient: client,
    scenarioReader: makeScenarioReader(snapshot),
  });
  await handler(makeInvocation());
  expect(payloads).toHaveLength(1);
  return payloads[0]!;
}

describe('run_analysis — flag-gated brief-to-PLoT leg (CEE_SEND_BRIEF_TO_PLOT)', () => {
  let originalFlag: boolean;

  beforeEach(() => {
    originalFlag = config.cee.sendBriefToPlot;
  });

  afterEach(() => {
    (config.cee as { sendBriefToPlot: boolean }).sendBriefToPlot = originalFlag;
    vi.clearAllMocks();
  });

  it('flag defaults OFF', () => {
    expect(originalFlag).toBe(false);
  });

  it('flag OFF (default): payload carries NO brief key even when the snapshot has one', async () => {
    (config.cee as { sendBriefToPlot: boolean }).sendBriefToPlot = false;
    const payload = await runWith(makeScenarioSnapshot({ briefText: BRIEF }));
    expect('brief' in payload).toBe(false);
  });

  it('flag ON: payload.brief carries the snapshot brief verbatim', async () => {
    (config.cee as { sendBriefToPlot: boolean }).sendBriefToPlot = true;
    const payload = await runWith(makeScenarioSnapshot({ briefText: BRIEF }));
    expect(payload.brief).toBe(BRIEF);
  });

  it('flag ON, no persisted brief: payload carries NO brief key (never an empty string)', async () => {
    (config.cee as { sendBriefToPlot: boolean }).sendBriefToPlot = true;
    const payload = await runWith(makeScenarioSnapshot());
    expect('brief' in payload).toBe(false);
  });

  it('flag ON, whitespace-only brief: payload carries NO brief key', async () => {
    (config.cee as { sendBriefToPlot: boolean }).sendBriefToPlot = true;
    const payload = await runWith(makeScenarioSnapshot({ briefText: '   \n ' }));
    expect('brief' in payload).toBe(false);
  });

  it('flag ON, over-wire-max brief: bounded at PLOT_BRIEF_MAX_CHARS (defence-in-depth)', async () => {
    (config.cee as { sendBriefToPlot: boolean }).sendBriefToPlot = true;
    const over = 'x'.repeat(PLOT_BRIEF_MAX_CHARS + 100);
    const payload = await runWith(makeScenarioSnapshot({ briefText: over }));
    expect(typeof payload.brief).toBe('string');
    expect((payload.brief as string).length).toBe(PLOT_BRIEF_MAX_CHARS);
  });

  it('the wire max clears PLoT run schema maxLength 10000 and the DB CHECK ceiling 8000', () => {
    // scenarios.brief_text CHECK caps at 8000 (normalise-brief-text.ts /
    // 20260502120000_v5_brief_text_persistence.sql); PLoT rejects > 10000.
    // The defensive bound must sit at the PLoT wire max so a legitimate
    // 8000-char brief is never touched.
    expect(PLOT_BRIEF_MAX_CHARS).toBe(10000);
  });
});
