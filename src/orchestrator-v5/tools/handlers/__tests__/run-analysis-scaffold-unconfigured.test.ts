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

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

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
import { buildScaffoldPromptDisclosure } from '../../../coaching/scaffold-disclosure.js';
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
// Round 4 (final-payload coherence): volume is configured RAW (2500), matching the
// RAW_CONFIGURED_* fixtures below. The old `fac_volume: 0.5` beside raw 120/90 was
// itself the corruption class round 4 blocks — an unproven [0,1] value that PLoT's
// fired gate divides by cap (0.5 / 5000). These specs pin scaffold mechanics, not
// scale semantics; the fixture is made coherent with intent preserved.
const CONFIGURED_B = { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_price: 90, fac_volume: 2500 } };

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

/** The mock PLoT `run` signature, so a wrapper can call the inner mock. */
type PlotRunFn = (payload: Record<string, unknown>) => Promise<V2RunResponseEnvelope>;

/**
 * The same preflight mirror, but the engine RETURNS the scaffolded arm in
 * its per-option records.
 *
 * Why this exists (2026-07-25): `v2-run-golden-happy.json` carries exactly
 * two records (`opt_a`, `opt_b`), so every test using the plain mirror models
 * a run in which the scaffolded option did NOT reach the comparison — which
 * is the LIVE case (staging scenario 454c14fb…: PLoT/ISL removed the
 * scaffolded arm with `IDENTICAL_OPTIONS_DEDUPED` because the scaffold's
 * neutral values coincide with the baseline option's). This variant is the
 * other half of the matrix: the arm survives, so "placeholder values were
 * used" is a TRUE statement and must still ship.
 */
function makeArmKeptPlotClient(optionId: string, optionLabel: string): {
  client: PLoTClient;
  run: ReturnType<typeof vi.fn>;
} {
  const { client, run } = makePreflightPlotClient();
  const inner = run.getMockImplementation()! as PlotRunFn;
  const wrapped = vi.fn(async (payload: Record<string, unknown>) => {
    const envelope = (await inner(payload)) as Record<string, unknown>;
    const records = envelope.results as Array<Record<string, unknown>>;
    records.push({
      option_id: optionId,
      option_label: optionLabel,
      win_probability: 0.05,
      percentile_p10: 0.01,
      percentile_p90: 0.09,
    });
    return envelope as unknown as V2RunResponseEnvelope;
  });
  (client as unknown as { run: unknown }).run = wrapped;
  return { client, run: wrapped };
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

  it('P1-1: scaffold values use the SIBLING convention — RAW user-scale (net unconditional since 2026-07-20)', async () => {
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
    // opt_new is edge-connected to fac_price only. The egress scale net is
    // UNCONDITIONAL since 2026-07-20 (O-7 wave 2:
    // CEE_PLOT_EGRESS_SCALE_NET_ENABLED deleted, live-true on staging), so
    // configured siblings reach the wire in RAW user-scale (CONFIGURED_A
    // sends fac_price: 120) — the scaffold's neutral for fac_price MUST be
    // observed_state.raw_value (100), the SAME convention. Mixing the
    // stored normalised 0.5 into the raw wire would be the 200x position
    // distortion P1-1 exists to prevent (PLoT ranks options RELATIVE to
    // each other, so the REAL options' win probabilities distort with it,
    // undisclosed).
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
    // RE-PINNED 2026-07-20 (O-7 wave 2 — the egress scale net is
    // unconditional, so the wire convention is RAW user-scale):
    expect(sentNew.interventions).toEqual({
      // fac_volume ABSENT — observed_state { value: 0.4, cap: 5000 } with no
      // raw_value cannot PROVE the normalised convention, so it is SKIPPED
      // on the raw wire (the P1-1 (B) evidence gate: PLoT divides by cap, so
      // an unproven 0.4 would slam the factor to ~0.00008).
      fac_range: 20, // capless prior midpoint passes through — PLoT cannot double-normalise it
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
    // Configured siblings intervene on fac_price + fac_volume → the scaffold
    // covers the same comparison basis at neutral values in the RAW
    // user-scale convention (net unconditional since 2026-07-20):
    // fac_price → raw_value 100; fac_volume is SKIPPED (cap-bearing with no
    // raw_value — the P1-1 (B) evidence gate refuses to fabricate it).
    expect(sentIso.interventions).toEqual({ fac_price: 100 });
  });

  // -------------------------------------------------------------------------
  // Disclosure — claim-safety-critical. Named tests: deleting the disclosure
  // turns THESE red (mutation-check target).
  // -------------------------------------------------------------------------

  it('DISCLOSURE: summary + assistant_text say the option’s values are placeholders and point at the configure route', async () => {
    // The arm SURVIVED to the comparison, so "placeholder values were used"
    // is true and is what must ship. (Before 2026-07-25 this test used the
    // plain mirror, whose golden fixture returns only opt_a/opt_b — so it
    // asserted the placeholder claim on a run where the option was NOT in
    // the results. That is the live defect, now covered by its own test
    // below; this one keeps the true-claim path honest.)
    const { client } = makeArmKeptPlotClient('opt_new', 'New Option');
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
    const { client } = makeArmKeptPlotClient('opt_new', 'New Option');
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

  // -------------------------------------------------------------------------
  // ⭐ 2026-07-25 — the option the scaffold filled placeholders for did NOT
  // reach the comparison. RED-first against staging tip 74c785f: the summary
  // there claims "Placeholder values were used for 'New Option'" while the
  // returned records contain only opt_a / opt_b.
  //
  // LIVE REPRODUCTION (deployed staging, CEE 74c785f, scenario
  // 454c14fb-cfa3-40d9-b285-cb6acb1897ff; independently again on
  // 0cc2923b-1b36-4ed6-903e-eeedade12bdb):
  //   user: "What about franchising instead? Add that as a fourth option."
  //   → held → confirmed → persisted `opt_franchise` (no interventions)
  //   → run_analysis → option_comparison had 3 entries, win_probabilities 3
  //     keys, `opt_franchise` in NEITHER, while the summary said
  //     "Placeholder values were used for 'Franchise the Leeds Location'".
  //   → v5_handler_facts carried the reason:
  //     IDENTICAL_OPTIONS_DEDUPED — "…has identical interventions to 'Stay at
  //     Current Location (Status Quo)' and was removed."
  // The collision is structural: the scaffold's neutral rule is the factor's
  // current observed position, which is exactly how the drafter defines the
  // baseline option.
  // -------------------------------------------------------------------------

  it('⭐ RED: an option the engine dropped is NOT claimed as included — the honest omission sentence ships instead', async () => {
    // Plain mirror: the golden fixture returns opt_a/opt_b only, i.e. the
    // scaffolded arm did not survive — the live shape.
    const { client } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');

    // Positive control for this whole test: the option really is absent from
    // the numbers the user is shown. Without this the assertions below could
    // pass against a run where nothing was dropped.
    expect(Object.keys(fact.result.win_probabilities ?? {})).not.toContain('New Option');

    for (const text of [outcome.assistant_text, fact.result.summary]) {
      // The false claim must be GONE …
      expect(text).not.toMatch(/Placeholder values were used/);
      // … and replaced by the honest one, still pointing at the working route.
      expect(text).toContain("'New Option' was left out of this comparison because it has no values set.");
      expect(text).toContain("say 'Help me configure New Option.'");
    }
  });

  it('⭐ the omission sentence SURVIVES the wire egress allowlist (it is not swapped for the bland fallback)', async () => {
    const { client } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());

    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text)).toBe(true);
    const forwarder = HANDLER_VALIDATION_REGISTRY.run_analysis!.confirmation_template;
    const forwarded = (forwarder as (o: unknown) => string)(outcome);
    expect(forwarded).toBe(outcome.assistant_text);
    expect(forwarded).toMatch(/was left out of this comparison/);
  });

  it('⭐ the omission verdict is stamped on the outcome channel so the review prompt inherits it', async () => {
    const { client } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    const records = outcome.__scaffolded_options!;
    expect(records).toHaveLength(1);
    expect(records[0]!.in_comparison).toBe(false);
    // And the LLM-facing disclosure built from that channel refuses to give
    // the dropped option numbers.
    const prompt = buildScaffoldPromptDisclosure(records);
    expect(prompt).toMatch(/is NOT in the option comparison/);
    expect(prompt).not.toMatch(/the analysis used neutral placeholder interventions/);
  });

  it('⭐ an unreadable result set asserts NO absence (trap-13 positive control)', async () => {
    // Engine returns zero per-option records: presence cannot be seen, so an
    // absence must not be derived. The pre-existing copy is the fail-safe.
    const { client } = makePreflightPlotClient();
    const inner = (client as unknown as { run: ReturnType<typeof vi.fn> }).run
      .getMockImplementation()! as PlotRunFn;
    (client as unknown as { run: unknown }).run = vi.fn(async (payload: Record<string, unknown>) => {
      const envelope = (await inner(payload)) as Record<string, unknown>;
      envelope.results = [];
      envelope.option_comparison = [];
      return envelope as unknown as V2RunResponseEnvelope;
    });
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).not.toMatch(/was left out of this comparison/);
    expect(outcome.__scaffolded_options![0]!.in_comparison).toBeUndefined();
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
      fac_volume: 2500,
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
// P1-1 — ONE scale convention, not two. The scaffold's wire numbers must be
// produced by the EXACT projection the configured siblings' interventions
// went through in loadScenarioSnapshotForRunAnalysis, on EVERY provenance
// rung. The scale net is UNCONDITIONAL since 2026-07-20 (O-7 wave 2:
// CEE_PLOT_EGRESS_SCALE_NET_ENABLED deleted); this block pins the raw-wire
// constructions, including (B): a rung-2 value-without-raw_value on a
// cap-bearing factor must never reach the raw-scale wire as a normalised
// number (PLoT divides intervention values by observed_state.cap, so an
// unproven 0.4 on a cap-5000 factor slams the option's position to ~0 — a
// large intervention masquerading as neutral).
// ---------------------------------------------------------------------------

describe('run_analysis D-ask-1 scaffold — P1-1 scale-net-ON convention parity', () => {
  const EGRESS_ENV = 'CEE_PLOT_EGRESS_SCALE_NET_ENABLED';

  beforeEach(async () => {
    process.env[EGRESS_ENV] = 'true';
    (await import('../../../../config/index.js'))._resetConfigCache();
  });

  afterEach(async () => {
    delete process.env[EGRESS_ENV];
    (await import('../../../../config/index.js'))._resetConfigCache();
  });

  /** Siblings as the net-ON loader projects them: RAW user-scale numbers. */
  const RAW_CONFIGURED_A = { id: 'opt_a', option_id: 'opt_a', label: 'Option A', interventions: { fac_price: 120 } };
  const RAW_CONFIGURED_B = { id: 'opt_b', option_id: 'opt_b', label: 'Option B', interventions: { fac_volume: 2500 } };

  it('P1-1 (B): an ambiguous [0,1] value on a cap-bearing factor is SKIPPED, never sent as a normalised number on the raw wire', async () => {
    // fac_volume: observed_state { value: 0.4, cap: 5000 } — no raw_value, so
    // the factor cannot PROVE the normalised convention. Pre-P1-1 the
    // scaffold sent 0.4 as the final wire number; PLoT normalises by cap →
    // 0.4/5000 ≈ 0.00008: the "neutral placeholder" slams the factor to
    // zero. Post-fix the factor is rejected as scaffold provenance (same
    // evidence gate as a sibling intervention — ambiguous_no_evidence).
    // RE-PINNED by review fix B4 (17 Jul): this option HAS an edge, so the
    // ratified comparison-basis fallback (scope: edge-LESS options only) no
    // longer fires — the option stays unscaffolded and the run takes the
    // honest configure-recovery path instead of scaffolding factors the
    // user's own edges never touch.
    const graph = makeGraph(
      [{ id: 'opt_new', kind: 'option', label: 'New Option' }],
      [{ from: 'opt_new', to: 'fac_volume' }],
    );
    const { client, run } = makePreflightPlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot({
          graph,
          rawPersistedGraph: graph,
          options: [
            RAW_CONFIGURED_A,
            RAW_CONFIGURED_B,
            { id: 'opt_new', option_id: 'opt_new', label: 'New Option', interventions: {} },
          ],
        }),
      ),
    });
    await expect(handler(makeInvocation())).rejects.toThrow(
      /missing interventions|options_not_configured/,
    );
    // The wire attempt (which PLoT's preflight then 422s) carries opt_new
    // UNSCAFFOLDED — the ambiguous cap-bearing factor is skipped AND no
    // sibling-basis values are fabricated for an option whose own edges the
    // basis doesn't cover.
    const sentOptions = (run.mock.calls[0][0] as Record<string, unknown>).options as Array<{
      option_id: string;
      interventions?: Record<string, number>;
    }>;
    const sentNew = sentOptions.find((o) => o.option_id === 'opt_new')!;
    expect(Object.keys(sentNew.interventions ?? {})).toHaveLength(0);
  });

  it('net-ON rungs route through the sibling projection: raw_value wins; a capless value passes through; proven convention denormalises', async () => {
    // fac_conv proves the normalised convention (0.4 * 5000 == 2000), so its
    // raw_value rung yields 2000 — the raw wire number a sibling
    // intervention { value: 0.4 } on that factor would also produce via
    // cap_denormalised. fac_range (prior midpoint 20, no cap) passes
    // through — no cap means PLoT cannot double-normalise it.
    const graph = makeGraph(
      [
        {
          id: 'fac_conv',
          kind: 'factor',
          label: 'Conversion',
          observed_state: { value: 0.4, raw_value: 2000, cap: 5000 },
        },
        { id: 'opt_new', kind: 'option', label: 'New Option' },
      ],
      [
        { from: 'fac_conv', to: 'g' },
        { from: 'opt_new', to: 'fac_conv' },
        { from: 'opt_new', to: 'fac_range' },
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
            RAW_CONFIGURED_A,
            RAW_CONFIGURED_B,
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
    expect(sentNew.interventions).toEqual({ fac_conv: 2000, fac_range: 20 });
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

// ---------------------------------------------------------------------------
// ⭐ ROADMAP 2.120(c) — 2026-07-29. The removal is disclosed with the ENGINE'S
// reason, end-to-end through the real handler.
//
// The tests above pin the FALLBACK sentence ("because it has no values set"),
// which is what ships when PLoT gives no reason — the golden fixture carries no
// `critiques` at all. These tests supply the reason PLoT actually gives, in the
// EXACT shape captured off deployed staging, and pin that the disclosure names
// the option the removed one collapsed onto.
//
// Live warning shape, verbatim from
// `PHASE0-EVIDENCE-2026-07-28/recapture-748-turn-bodies.json` (CEE `f2e00b6`,
// 2026-07-28 22:22Z) crossed with the producer read at PLoT `3d13e0a`
// (`validation/preflight-v2.ts:433-441`, which is where `affected_option_ids`
// comes from — the CEE→UI turn payload strips it, so only the PLoT→CEE hop
// carries it, and only this hop is what the handler reads):
//
//   { code: 'IDENTICAL_OPTIONS_DEDUPED', severity: 'warning', source: 'validation',
//     message: "Option 'Partner with Specialist Consultancy to Extend Current
//               System' has identical interventions to 'Defer Replacement
//               (Status Quo)' and was removed. Analysis proceeds with
//               deduplicated options.",
//     affected_option_ids: ['opt_status_quo', 'opt_consultancy'],
//     blocks_analysis: false }
// ---------------------------------------------------------------------------

/**
 * The preflight mirror, plus the engine's dedup reason for `removedId` —
 * `keptId` being an option the fixture DOES return. Mirrors the real envelope:
 * the removed arm is absent from the per-option records and named only in the
 * critique.
 */
function makeDedupPlotClient(
  removedId: string,
  keptId: string,
  overrides?: { affectedIds?: unknown; code?: string },
): { client: PLoTClient; run: ReturnType<typeof vi.fn> } {
  const { client, run } = makePreflightPlotClient();
  const inner = run.getMockImplementation()! as (
    payload: Record<string, unknown>,
  ) => Promise<V2RunResponseEnvelope>;
  const wrapped = vi.fn(async (payload: Record<string, unknown>) => {
    const envelope = (await inner(payload)) as Record<string, unknown>;
    envelope.critiques = [
      {
        id: '11111111-1111-4111-8111-111111111111',
        code: 'DOMINANT_FACTOR',
        severity: 'warning',
        message: 'One factor dominates.',
        source: 'validation',
        blocks_analysis: false,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        code: overrides?.code ?? 'IDENTICAL_OPTIONS_DEDUPED',
        severity: 'warning',
        message:
          `Option 'New Option' has identical interventions to 'Option A' and was removed. ` +
          'Analysis proceeds with deduplicated options.',
        source: 'validation',
        affected_option_ids:
          overrides && 'affectedIds' in overrides ? overrides.affectedIds : [keptId, removedId],
        blocks_analysis: false,
      },
    ];
    return envelope as unknown as V2RunResponseEnvelope;
  });
  (client as unknown as { run: unknown }).run = wrapped;
  return { client, run: wrapped };
}

describe('⭐ 2.120(c) run_analysis — the removal carries the engine\'s reason', () => {
  it('⭐ RED: the disclosure NAMES the kept option and drops the "no values set" reason', async () => {
    const { client } = makeDedupPlotClient('opt_new', 'opt_a');
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');

    // Positive control (trap-13): the removed arm really is absent from the
    // numbers, and the KEPT arm really is present — otherwise the sentence
    // below would be naming an option the user never saw.
    const shown = Object.keys(fact.result.win_probabilities ?? {});
    expect(shown).not.toContain('New Option');
    expect(shown).toContain('Option A');

    for (const text of [outcome.assistant_text, fact.result.summary]) {
      expect(text).toContain(
        "'New Option' was left out of this comparison because it is currently " +
          "indistinguishable from 'Option A' — its result is that option's result.",
      );
      // The engine's reason REPLACES the proxy reason on this branch.
      expect(text).not.toContain('left out of this comparison because it has no values set');
      // The deterministic configure route is still advised.
      expect(text).toContain("say 'Help me configure New Option.'");
      // And the false inclusion claim is still gone.
      expect(text).not.toMatch(/Placeholder values were used/);
    }
  });

  it('⭐ the new sentence SURVIVES the wire egress allowlist (not swapped for the bland fallback)', async () => {
    const { client } = makeDedupPlotClient('opt_new', 'opt_a');
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text)).toBe(true);
    const forwarder = HANDLER_VALIDATION_REGISTRY.run_analysis!.confirmation_template;
    const forwarded = (forwarder as (o: unknown) => string)(outcome);
    expect(forwarded).toBe(outcome.assistant_text);
    expect(forwarded).toContain("indistinguishable from 'Option A'");
  });

  it('CONTROL — the kept id is derived from PRESENCE, not from the array position PLoT happens to use', async () => {
    // Same warning, ids REVERSED. PLoT emits [kept, dropped] today; if this
    // handler read position 0 as "kept" it would name the REMOVED option as the
    // one to compare against — a self-referential sentence. Presence in the
    // returned comparison decides, so the flip changes nothing.
    const { client } = makeDedupPlotClient('opt_new', 'opt_a', {
      affectedIds: ['opt_new', 'opt_a'],
    });
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toContain("indistinguishable from 'Option A'");
    expect(outcome.assistant_text).not.toContain("indistinguishable from 'New Option'");
  });

  it('CONTROL — a DIFFERENT engine code keeps today\'s sentence (a future filter does not inherit a dedup explanation)', async () => {
    const { client } = makeDedupPlotClient('opt_new', 'opt_a', {
      code: 'SOME_FUTURE_OPTION_FILTER',
    });
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    expect(outcome.assistant_text).toContain(
      "'New Option' was left out of this comparison because it has no values set.",
    );
    expect(outcome.assistant_text).not.toContain('indistinguishable');
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text)).toBe(true);
  });

  it('CONTROL — an unusable affected_option_ids shape keeps today\'s sentence rather than guessing', async () => {
    for (const affectedIds of [
      undefined, // field absent (an older PLoT, or a shape change)
      [], // empty
      ['opt_new'], // only the REMOVED id → nothing present to name
      ['opt_a', 'opt_b'], // both present → nothing was removed per this warning
      ['opt_a'], // only a KEPT id → no removed option to attach it to
      'opt_a,opt_new', // not an array
      [null, 42], // non-strings
    ]) {
      const { client } = makeDedupPlotClient('opt_new', 'opt_a', { affectedIds });
      const handler = createRunAnalysisHandler({
        plotClient: client,
        scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
      });
      const outcome = await handler(makeInvocation());
      expect(outcome.assistant_text).toContain(
        "'New Option' was left out of this comparison because it has no values set.",
      );
      expect(outcome.assistant_text).not.toContain('indistinguishable');
      expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text)).toBe(true);
    }
  });

  it('the omission verdict is still stamped on the outcome channel, and the review prompt still forbids a result for the removed arm', async () => {
    const { client } = makeDedupPlotClient('opt_new', 'opt_a');
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(snapshotWithUnconfiguredOption()),
    });
    const outcome = await handler(makeInvocation());
    const stamped = (outcome as { __scaffolded_options?: Array<{ option_id: string; in_comparison?: boolean }> })
      .__scaffolded_options;
    expect(stamped).toBeDefined();
    expect(stamped!.find((s) => s.option_id === 'opt_new')?.in_comparison).toBe(false);
    const prompt = buildScaffoldPromptDisclosure(stamped as never);
    expect(prompt).toContain('is NOT in the option comparison');
  });
});
