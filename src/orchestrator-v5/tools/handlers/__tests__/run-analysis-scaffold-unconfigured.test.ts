/**
 * D-ask-1 (ROADMAP 2.11 P0-1) — scaffolded, DISCLOSED placeholder
 * interventions for an option added without configuration, so run_analysis
 * completes instead of 422-blocking the WHOLE analysis.
 *
 * RED-first evidence: every test in the "scaffold backstop" describe block
 * fails against pristine staging `4d79746a7` (the handler either throws the
 * rerouted `options_not_configured` failure, or emits no disclosure), and
 * passes only once the scaffold + disclosure land. The "unchanged behaviour"
 * block pins the paths the scaffold must NOT touch — those are GREEN before
 * AND after (regression pins, not RED pins).
 *
 * The mock PLoT client mirrors the REAL preflight contract this backstop
 * exists for (verified in the 2.11 diagnosis, scenario A): any option with
 * zero interventions → HTTP 422 with `analysis_status:
 * "preflight_validation_failed"` and the `Option '<label>' does not specify
 * what it changes` critique. The handler's own §4 catch reroutes exactly
 * that shape into `options_not_configured` — so with one unconfigured
 * option the ENTIRE analysis fails wholesale. That is the live defect.
 */

import { describe, it, expect, vi } from 'vitest';

import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { PLoTError } from '../../../../orchestrator/plot-client.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  isAllowedRunAnalysisAssistantText,
} from '../../../coaching/analysis-result-headline.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../../routing/validation-registry.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

// Loaded via fs (not a JSON import attribute) so this file typechecks clean
// under the full-tree tsconfig — keeping the typecheck drift ratchet at
// baseline (462) rather than adding a new baseline entry.
const happyFixture: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url),
    ),
    'utf8',
  ),
);

// ---------------------------------------------------------------------------
// Harness (mirrors run-analysis.test.ts)
// ---------------------------------------------------------------------------

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-scaffold-test';

/**
 * Graph fixture: goal + three factors with distinct neutral-value
 * provenance so the precedence rungs are individually observable:
 *   - fac_price:  observed_state.raw_value 100 (explicit user-scale) — rung 1
 *   - fac_volume: observed_state.value 0.4 (no raw_value)            — rung 2
 *   - fac_range:  no observed_state; prior range [10, 30] → mid 20   — rung 3
 *   - fac_dead:   no value provenance at all                         — skipped
 */
function makeGraph(extraNodes: Array<Record<string, unknown>> = [], extraEdges: Array<Record<string, unknown>> = []) {
  return {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Goal' },
      { id: 'd', kind: 'decision', label: 'Decision' },
      { id: 'fac_price', kind: 'factor', label: 'Price', observed_state: { value: 0.5, raw_value: 100, cap: 200 } },
      { id: 'fac_volume', kind: 'factor', label: 'Volume', observed_state: { value: 0.4, cap: 5000 } },
      { id: 'fac_range', kind: 'factor', label: 'Range Factor', prior: { distribution: 'uniform', range_min: 10, range_max: 30 } },
      { id: 'fac_dead', kind: 'factor', label: 'Dead Factor' },
      { id: 'opt_a', kind: 'option', label: 'Option A' },
      { id: 'opt_b', kind: 'option', label: 'Option B' },
      ...extraNodes,
    ],
    edges: [
      { from: 'opt_a', to: 'fac_price' },
      { from: 'opt_b', to: 'fac_price' },
      { from: 'fac_price', to: 'g' },
      { from: 'fac_volume', to: 'g' },
      { from: 'fac_range', to: 'g' },
      ...extraEdges,
    ],
  };
}

const CONFIGURED_A = { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_price: 120 } };
const CONFIGURED_B = { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_price: 90, fac_volume: 0.5 } };

function makeSnapshot(overrides?: Partial<RunAnalysisScenarioSnapshot>): RunAnalysisScenarioSnapshot {
  const graph = overrides?.graph ?? makeGraph();
  return {
    graph,
    options: [CONFIGURED_A, CONFIGURED_B],
    goal_node_id: 'g',
    rawPersistedGraph: overrides?.rawPersistedGraph ?? graph,
    ...overrides,
  };
}

function makeReader(snapshot: RunAnalysisScenarioSnapshot): ScenarioReader {
  return vi.fn(() => Promise.resolve(snapshot));
}

/**
 * PLoT preflight mirror: rejects with the REAL 422 shape whenever any
 * payload option carries zero interventions; succeeds with the golden happy
 * fixture otherwise. This is the positive control that makes the block
 * reproduction meaningful — a payload that still carries an unconfigured
 * option CANNOT pass this client.
 */
function makePreflightPlotClient(): { client: PLoTClient; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (payload: Record<string, unknown>) => {
    const options = (payload.options ?? []) as Array<{ label?: string; interventions?: Record<string, unknown> }>;
    const missing = options.find(
      (o) => !o.interventions || Object.keys(o.interventions).length === 0,
    );
    if (missing) {
      const err = new PLoTError('PLoT /v2/run returned 422', 422, 'run', 5, TEST_REQUEST_ID);
      err.v2RunError = {
        analysis_status: 'preflight_validation_failed',
        status_reason: 'preflight validation failed',
        critiques: [
          {
            code: 'OPTION_NO_INTERVENTIONS',
            severity: 'error',
            message: `Option '${missing.label ?? 'unknown'}' does not specify what it changes — it must define at least one intervention.`,
          },
        ],
      } as NonNullable<PLoTError['v2RunError']>;
      throw err;
    }
    return JSON.parse(JSON.stringify(happyFixture)) as V2RunResponseEnvelope;
  });
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

/** Snapshot with one unconfigured added option (the 2.11 scenario-A shape). */
function snapshotWithUnconfiguredOption(): RunAnalysisScenarioSnapshot {
  const graph = makeGraph(
    [{ id: 'opt_new', kind: 'option', label: 'New Option' }],
    [{ from: 'opt_new', to: 'fac_price' }],
  );
  return makeSnapshot({
    graph,
    rawPersistedGraph: graph,
    options: [
      CONFIGURED_A,
      CONFIGURED_B,
      { id: 'opt_new', option_id: 'opt_new', label: 'New Option', interventions: {} },
    ],
  });
}

// ---------------------------------------------------------------------------
// D-ask-1 scaffold backstop — RED against pristine 4d79746a7
// ---------------------------------------------------------------------------

describe('run_analysis D-ask-1 scaffold backstop (2.11 P0-1)', () => {
  it('RED reproduction: an unconfigured added option no longer blocks the whole analysis', async () => {
    const { client, run } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });

    // Pre-fix: the preflight mirror 422s and the handler reroutes it into a
    // HandlerInvocationFailedError(options_not_configured) — the WHOLE
    // analysis fails because ONE added option has no values. Post-fix: the
    // scaffold fills disclosed placeholder interventions and the run
    // completes.
    const outcome = await handler(makeInvocation());

    expect(run).toHaveBeenCalledTimes(1);
    const sentPayload = run.mock.calls[0][0] as Record<string, unknown>;
    const sentOptions = sentPayload.options as Array<{ option_id: string; interventions: Record<string, number> }>;
    const sentNew = sentOptions.find((o) => o.option_id === 'opt_new');
    expect(sentNew).toBeDefined();
    // The scaffolded option carries at least one placeholder intervention —
    // that is the exact predicate the PLoT preflight enforces.
    expect(Object.keys(sentNew!.interventions).length).toBeGreaterThan(0);
    expect(outcome.handler_facts).toHaveLength(1);
  });

  it('scaffold values are neutral: the factor’s own current value (raw_value rung), never an invented number', async () => {
    const { client, run } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    await handler(makeInvocation());

    const sentOptions = (run.mock.calls[0][0] as Record<string, unknown>).options as Array<{
      option_id: string;
      interventions: Record<string, number>;
    }>;
    const sentNew = sentOptions.find((o) => o.option_id === 'opt_new')!;
    // opt_new is edge-connected to fac_price only; fac_price's explicit
    // user-scale current value is observed_state.raw_value = 100.
    expect(sentNew.interventions).toEqual({ fac_price: 100 });
  });

  it('neutral-value precedence: observed value rung, then prior range midpoint; no-provenance factors are skipped', async () => {
    const graph = makeGraph(
      [{ id: 'opt_new', kind: 'option', label: 'New Option' }],
      [
        { from: 'opt_new', to: 'fac_volume' },
        { from: 'opt_new', to: 'fac_range' },
        { from: 'opt_new', to: 'fac_dead' },
      ],
    );
    const { client, run } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot({
          graph,
          rawPersistedGraph: graph,
          options: [
            CONFIGURED_A,
            CONFIGURED_B,
            { id: 'opt_new', option_id: 'opt_new', label: 'New Option', interventions: {} },
          ],
        }),
      ),
    });
    await handler(makeInvocation());

    const sentOptions = (run.mock.calls[0][0] as Record<string, unknown>).options as Array<{
      option_id: string;
      interventions: Record<string, number>;
    }>;
    const sentNew = sentOptions.find((o) => o.option_id === 'opt_new')!;
    expect(sentNew.interventions).toEqual({
      fac_volume: 0.4, // observed_state.value rung (no raw_value on the factor)
      fac_range: 20, // centre-of-range: (10 + 30) / 2
      // fac_dead absent: no value provenance → never invented
    });
  });

  it('an option with NO factor edges scaffolds on the configured siblings’ comparison basis', async () => {
    const graph = makeGraph([{ id: 'opt_iso', kind: 'option', label: 'Isolated Option' }]);
    const { client, run } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot({
          graph,
          rawPersistedGraph: graph,
          options: [
            CONFIGURED_A,
            CONFIGURED_B,
            { id: 'opt_iso', option_id: 'opt_iso', label: 'Isolated Option', interventions: {} },
          ],
        }),
      ),
    });
    await handler(makeInvocation());

    const sentOptions = (run.mock.calls[0][0] as Record<string, unknown>).options as Array<{
      option_id: string;
      interventions: Record<string, number>;
    }>;
    const sentIso = sentOptions.find((o) => o.option_id === 'opt_iso')!;
    // Configured siblings intervene on fac_price + fac_volume → the
    // scaffold covers the same comparison basis at neutral values.
    expect(sentIso.interventions).toEqual({ fac_price: 100, fac_volume: 0.4 });
  });

  // -------------------------------------------------------------------------
  // Disclosure — claim-safety-critical. Named tests: deleting the disclosure
  // turns THESE red (mutation-check target).
  // -------------------------------------------------------------------------

  it('DISCLOSURE: summary + assistant_text say the option’s values are placeholders and point at the configure route', async () => {
    const { client } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');

    // The disclosure rides on BOTH the chat receipt (assistant_text) and the
    // analysis_result block source (fact.result.summary — the block copies
    // it verbatim in compose.ts buildAnalysisResultBlock).
    for (const text of [outcome.assistant_text, fact.result.summary]) {
      expect(text).toMatch(/Placeholder values were used for 'New Option'/);
      expect(text).toMatch(/until you configure it/);
      // Configure-route pointer derives from configure-option-chip-text
      // (#487's single copy source): the advised exemplar must carry the
      // deterministic routing prefix.
      expect(text).toContain("say 'Help me configure New Option.'");
    }
  });

  it('DISCLOSURE survives the wire egress allowlist (validation-registry forwarder does NOT replace it with the bland fallback)', async () => {
    const { client } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());

    // The registry-side allowlist is the second line of defence on BOTH the
    // routed path (turn-executor renderConfirmation) and the chip-click path
    // (confirmation_template) — if it rejects the disclosure-bearing text it
    // silently substitutes the locked template and the disclosure NEVER
    // reaches the user. Assert the real predicate AND the real forwarder.
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text)).toBe(true);
    const forwarder = HANDLER_VALIDATION_REGISTRY.run_analysis!.confirmation_template;
    expect(typeof forwarder).toBe('function');
    const forwarded = (forwarder as (o: unknown) => string)(outcome);
    expect(forwarded).toBe(outcome.assistant_text);
    expect(forwarded).toMatch(/Placeholder values were used/);
  });

  it('exposes the scaffold record on the outcome with the value_defaulted marker (chip + telemetry channel)', async () => {
    const { client } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());

    const scaffolded = (outcome as { __scaffolded_options?: ReadonlyArray<Record<string, unknown>> })
      .__scaffolded_options;
    expect(scaffolded).toBeDefined();
    expect(scaffolded).toHaveLength(1);
    expect(scaffolded![0]).toMatchObject({
      option_id: 'opt_new',
      label: 'New Option',
      value_defaulted: true,
    });
    expect(scaffolded![0].factor_ids).toEqual(['fac_price']);
  });

  // -------------------------------------------------------------------------
  // No-clobber / no-overreach pins
  // -------------------------------------------------------------------------

  it('NEVER clobbers a configured option: configured interventions reach PLoT byte-identical', async () => {
    const { client, run } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    await handler(makeInvocation());

    const sentOptions = (run.mock.calls[0][0] as Record<string, unknown>).options as Array<{
      option_id: string;
      interventions: Record<string, number>;
    }>;
    expect(sentOptions.find((o) => o.option_id === 'opt_a')!.interventions).toEqual({ fac_price: 120 });
    expect(sentOptions.find((o) => o.option_id === 'opt_b')!.interventions).toEqual({
      fac_price: 90,
      fac_volume: 0.5,
    });
  });

  it('does NOT scaffold an option the user configured with (unencodable) raw intent — that stays on the honest configure path', async () => {
    // opt_raw carries data.interventions raw intent in the RAW persisted
    // graph (the canvas-autosave shape GraphV3 projection drops). The user
    // DID configure it — scaffolding placeholders over their intent would
    // misrepresent. It must stay unconfigured on the wire, so the run still
    // fails into the recoverable options_not_configured path (#487's
    // configure chip route).
    const rawGraph = makeGraph(
      [
        {
          id: 'opt_raw',
          kind: 'option',
          label: 'Raw Intent Option',
          data: { interventions: { fac_price: { raw_value: 50, unit: 'GBP' } } },
        },
      ],
      [{ from: 'opt_raw', to: 'fac_price' }],
    );
    const { client } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot({
          graph: rawGraph,
          rawPersistedGraph: rawGraph,
          options: [
            CONFIGURED_A,
            CONFIGURED_B,
            { id: 'opt_raw', option_id: 'opt_raw', label: 'Raw Intent Option', interventions: {} },
          ],
        }),
      ),
    });

    await expect(handler(makeInvocation())).rejects.toMatchObject({
      name: 'HandlerInvocationFailedError',
      cause_kind: 'options_not_configured',
    });
  });

  it('no unconfigured options → summary is byte-identical to today (no suffix, no scaffold record)', async () => {
    const { client } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(makeSnapshot()),
    });
    const outcome = await handler(makeInvocation());

    expect(outcome.assistant_text).not.toMatch(/Placeholder values/);
    expect('__scaffolded_options' in outcome).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Unchanged behaviour (GREEN before and after — regression pins)
// ---------------------------------------------------------------------------

describe('run_analysis D-ask-1 scaffold — paths the scaffold must NOT touch', () => {
  it('ALL options unconfigured → the pre-PLoT options_not_configured guard still fires (no PLoT call, no scaffold)', async () => {
    const graph = makeGraph();
    const { client, run } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot({
          graph,
          rawPersistedGraph: graph,
          options: [
            { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: {} },
            { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: {} },
          ],
        }),
      ),
    });

    let thrown: unknown;
    try {
      await handler(makeInvocation());
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(HandlerInvocationFailedError);
    expect((thrown as HandlerInvocationFailedError).cause_kind).toBe('options_not_configured');
    expect(run).not.toHaveBeenCalled();
  });
});
