/**
 * NO-RANK RULING (Paul, 2026-08-14) — an unanalysable/placeholder option must
 * NOT be included in comparative ranking or probabilities. It stays visible as
 * a proposed/unanalysed alternative with a clear reason and an action to
 * resolve it.
 *
 * ## The defect this pins, at the banked capture — NOT inferred
 *
 * `first-use-acceptance-2026-08-14/run-2/draws/A_hiring-2`:
 *
 *   step-DRAFT.json  → `body.analysis_ready.options` carried TWO options with
 *                      `interventions: {}` and
 *                      `status_reason: "No interventions extracted"`.
 *   step-ANALYSE.json → `blocks[0].enrichment.decision_brief.options`:
 *
 *       rank 1  e70301eb  hire a Tech lead          0.8963
 *       rank 2  be215545  two developers            0.0681
 *       rank 3  31997614  Hire Two Developers Only  0.0355   ← ZERO user values
 *
 * That rank and that probability are the thing the ruling forbids. The
 * fixtures below use THOSE ids and THOSE labels, so the shape under test is the
 * one that shipped rather than one invented to suit the fix.
 *
 * ## Why the old behaviour produced a rank at all
 *
 * The superseded scaffold held every factor at its own `observed_state` value.
 * For an arbitrary option that means "this option changes nothing" — the
 * definition of the STATUS QUO, not an approximation of the option. It did not
 * model `31997614`; it replaced it with "do nothing" and ranked that. (Which is
 * also why PLoT deduped `5445635a` onto it as `IDENTICAL_OPTIONS_DEDUPED`:
 * post-scaffold the two were byte-identical.)
 *
 * ## The mock PLoT client is a POSITIVE CONTROL, reproducing BOTH real gates
 *
 *  - `validation/preflight-v2.ts::validateInterventions` — an option with zero
 *    interventions raises blocker `EMPTY_INTERVENTIONS`, which fails the whole
 *    preflight → 422. So a submission that still carries an unconfigured option
 *    CANNOT pass this client, and "we excluded it" cannot be faked.
 *  - `/v2/run`'s Ajv request schema declares `options` with `minItems: 2` → 400.
 *    So "exclusion left one option" cannot silently succeed either.
 *
 * Without both, an absence assertion here would be vacuous (trap 13).
 *
 * ## RED-first
 *
 * Measured at pristine `73ea84e69f8fe8bf267e305d7d555de500e0b02b`, in a
 * worktree outside the repo root with isolation proven by a sentinel write.
 * The gate module does not exist at pristine, so the pure-function specs were
 * `it.skip`ped there and only handler-level specs ran — a collection error is
 * not evidence; assertion failures are.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi } from 'vitest';

import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { PLoTError } from '../../../../orchestrator/plot-client.js';
import {
  createRunAnalysisHandler,
  firstUsableExcludedLabel,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
// ⚠ PURE-FUNCTION IMPORT — absent at pristine. The specs that use it are the
// ones skipped for the RED measurement.
import {
  gateAnalysableOptions,
  PLOT_MIN_COMPARISON_OPTIONS,
} from '../analysable-option-gate.js';

const happyFixture: unknown = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL('../../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url),
    ),
    'utf8',
  ),
);

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-norank-test';

// ---------------------------------------------------------------------------
// The A_hiring-2 shape (ids + labels verbatim from the banked capture)
// ---------------------------------------------------------------------------

const OPT_TECH_LEAD = 'e70301eb';
const OPT_TWO_DEVS = 'be215545';
/** The capture's ranked-3 phantom: ZERO user interventions. */
const OPT_PHANTOM = '31997614';
const LABEL_PHANTOM = 'Hire Two Developers Only';
/** The capture's second empty option, deduped onto the phantom post-scaffold. */
const OPT_PHANTOM_2 = '5445635a';
const LABEL_PHANTOM_2 = 'Hire One Developer Now, Defer Second';

/**
 * Factors chosen so each hold outcome is individually observable:
 *   - `fac_salary`  CAPPED   observed {value .6, raw 60000, cap 100k} → holdable
 *   - `fac_speed`   CAPPED   observed {value .5, raw 100, cap 200} → holdable (raw wins)
 *   - `fac_ambig`   CAPPED   observed {value: 0.4} and NO raw      → NOT holdable
 *                            (`ambiguous_no_evidence`: PLoT divides by cap, so an
 *                             unproven [0,1] would slam the arm to ~0 — the
 *                             measured 100,000x corruption class)
 *   - `fac_bare`    no observed_state at all                       → NOT holdable
 */
function makeGraph(
  extraNodes: Array<Record<string, unknown>> = [],
  extraEdges: Array<Record<string, unknown>> = [],
) {
  return {
    nodes: [
      { id: 'g', kind: 'goal', label: 'Delivery outcome' },
      { id: 'd', kind: 'decision', label: 'Hiring decision' },
      {
        id: 'fac_salary',
        kind: 'factor',
        label: 'Salary cost',
        observed_state: { value: 0.6, raw_value: 60000, cap: 100000 },
      },
      {
        id: 'fac_speed',
        kind: 'factor',
        label: 'Delivery speed',
        observed_state: { value: 0.5, raw_value: 100, cap: 200 },
      },
      { id: 'fac_ambig', kind: 'factor', label: 'Ambiguous', observed_state: { value: 0.4, cap: 5000 } },
      { id: 'fac_bare', kind: 'factor', label: 'Bare', prior: { range_min: 10, range_max: 30 } },
      { id: OPT_TECH_LEAD, kind: 'option', label: 'Hire a Tech Lead' },
      { id: OPT_TWO_DEVS, kind: 'option', label: 'Hire Two Developers' },
      ...extraNodes,
    ],
    edges: [
      { from: OPT_TECH_LEAD, to: 'fac_speed' },
      { from: OPT_TWO_DEVS, to: 'fac_speed' },
      { from: 'fac_salary', to: 'g' },
      { from: 'fac_speed', to: 'g' },
      ...extraEdges,
    ],
  };
}

const CONFIGURED_TECH_LEAD = {
  id: OPT_TECH_LEAD,
  option_id: OPT_TECH_LEAD,
  label: 'Hire a Tech Lead',
  interventions: { fac_speed: 140 },
};
const CONFIGURED_TWO_DEVS = {
  id: OPT_TWO_DEVS,
  option_id: OPT_TWO_DEVS,
  label: 'Hire Two Developers',
  interventions: { fac_speed: 120, fac_salary: 80000 },
};

function emptyOption(
  optionId: string,
  label: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return { id: optionId, option_id: optionId, label, interventions: {}, ...extra };
}

function makeSnapshot(
  options: ReadonlyArray<Record<string, unknown>>,
  graph: Record<string, unknown> = makeGraph(),
): RunAnalysisScenarioSnapshot {
  return {
    graph,
    options,
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

function makeReader(snapshot: RunAnalysisScenarioSnapshot): ScenarioReader {
  return vi.fn(() => Promise.resolve(snapshot));
}

/**
 * PLoT mirror + POSITIVE CONTROL for both real request gates, and it ECHOES the
 * submitted option set back as per-arm records.
 *
 * The echo matters: `analysedOptionIds` is derived from the returned records,
 * so echoing models the real engine (a record per arm it scored) instead of a
 * fixed fixture whose ids would classify every arm as "dropped".
 */
function makePlotClient(): { client: PLoTClient; run: ReturnType<typeof vi.fn> } {
  const run = vi.fn(async (payload: Record<string, unknown>) => {
    const options = (payload.options ?? []) as Array<{
      option_id?: string;
      label?: string;
      interventions?: Record<string, unknown>;
    }>;
    // GATE 1 — `/v2/run` Ajv: `options` has `minItems: 2`.
    if (options.length < 2) {
      const err = new PLoTError('PLoT /v2/run returned 400', 400, 'run', 5, TEST_REQUEST_ID);
      err.v2RunError = {
        analysis_status: 'request_validation_failed',
        status_reason: 'options must NOT have fewer than 2 items',
        critiques: [],
      } as NonNullable<PLoTError['v2RunError']>;
      throw err;
    }
    // GATE 2 — preflight `EMPTY_INTERVENTIONS` blocker.
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
    const envelope = JSON.parse(JSON.stringify(happyFixture)) as Record<string, unknown>;
    envelope.results = options.map((o, index) => ({
      option_id: o.option_id ?? `unknown_${index}`,
      option_label: o.label ?? '',
      win_probability: index === 0 ? 0.62 : 0.38 / Math.max(1, options.length - 1),
      percentile_p10: 0.31,
      percentile_p90: 0.68,
    }));
    return envelope as unknown as V2RunResponseEnvelope;
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

function sentOptions(run: ReturnType<typeof vi.fn>): Array<{
  option_id: string;
  label: string;
  interventions: Record<string, number>;
}> {
  return (run.mock.calls[0]![0] as Record<string, unknown>).options as Array<{
    option_id: string;
    label: string;
    interventions: Record<string, number>;
  }>;
}

/** The banked A_hiring-2 shape: two configured arms + the ranked-3 phantom. */
function hiringSnapshotWithPhantom(): RunAnalysisScenarioSnapshot {
  const graph = makeGraph(
    [{ id: OPT_PHANTOM, kind: 'option', label: LABEL_PHANTOM }],
    [{ from: OPT_PHANTOM, to: 'fac_speed' }],
  );
  return makeSnapshot(
    [CONFIGURED_TECH_LEAD, CONFIGURED_TWO_DEVS, emptyOption(OPT_PHANTOM, LABEL_PHANTOM)],
    graph,
  );
}

// ===========================================================================
// THE RULING
// ===========================================================================

describe('no-rank ruling — an option with no values set is EXCLUDED, never ranked', () => {
  it('the A_hiring-2 placeholder LOSES its rank: it is not in the PLoT submission at all', async () => {
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(hiringSnapshotWithPhantom()),
    });
    const outcome = await handler(makeInvocation());

    expect(run).toHaveBeenCalledTimes(1);
    const sent = sentOptions(run);
    // Bound by IDENTITY (trap 19): the capture's own option id, not "the one
    // with no interventions" — a predicate another arm could satisfy.
    expect(sent.map((o) => o.option_id)).toEqual([OPT_TECH_LEAD, OPT_TWO_DEVS]);
    expect(sent.find((o) => o.option_id === OPT_PHANTOM)).toBeUndefined();

    // …and therefore it cannot carry a rank or a probability, by construction.
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
    expect(Object.keys(fact.result.win_probabilities ?? {})).not.toContain(OPT_PHANTOM);
    expect(Object.keys(fact.result.win_probabilities ?? {})).not.toContain(LABEL_PHANTOM);
  });

  it('no placeholder value is minted: every submitted option carries interventions the user set', async () => {
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(hiringSnapshotWithPhantom()),
    });
    await handler(makeInvocation());

    const sent = sentOptions(run);
    // The configured arms reach PLoT byte-identical — the gate never touches
    // a configured option — and NOTHING else is on the wire.
    expect(sent.find((o) => o.option_id === OPT_TECH_LEAD)!.interventions).toEqual({
      fac_speed: 140,
    });
    expect(sent.find((o) => o.option_id === OPT_TWO_DEVS)!.interventions).toEqual({
      fac_speed: 120,
      fac_salary: 80000,
    });
    expect(sent).toHaveLength(2);
  });

  it('a single excluded option is named, with the reason and the route that resolves it', async () => {
    const { client } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(hiringSnapshotWithPhantom()),
    });
    const outcome = await handler(makeInvocation());
    const fact = outcome.handler_facts[0]!;
    if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');

    for (const text of [outcome.assistant_text, fact.result.summary]) {
      expect(text).toContain(
        `'${LABEL_PHANTOM}' was left out of this comparison because it has no values set.`,
      );
      expect(text).toContain(`say 'Help me configure ${LABEL_PHANTOM}.'`);
      // The superseded claim must be GONE: nothing was defaulted for it.
      expect(text).not.toMatch(/Placeholder values were used/);
    }
    // And it survives the wire egress allowlist rather than being silently
    // swapped for the bland locked template.
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text)).toBe(true);
  });

  it('TWO excluded options give the COUNT, not the names (the egress grammar has ONE label slot)', async () => {
    const graph = makeGraph(
      [
        { id: OPT_PHANTOM, kind: 'option', label: LABEL_PHANTOM },
        { id: OPT_PHANTOM_2, kind: 'option', label: LABEL_PHANTOM_2 },
      ],
      [
        { from: OPT_PHANTOM, to: 'fac_speed' },
        { from: OPT_PHANTOM_2, to: 'fac_speed' },
      ],
    );
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot(
          [
            CONFIGURED_TECH_LEAD,
            CONFIGURED_TWO_DEVS,
            emptyOption(OPT_PHANTOM, LABEL_PHANTOM),
            emptyOption(OPT_PHANTOM_2, LABEL_PHANTOM_2),
          ],
          graph,
        ),
      ),
    });
    const outcome = await handler(makeInvocation());

    expect(sentOptions(run).map((o) => o.option_id)).toEqual([OPT_TECH_LEAD, OPT_TWO_DEVS]);
    expect(outcome.assistant_text).toContain(
      '2 of your options were left out of this comparison because they have no values set.',
    );
    // ⭐ THE DIVISION OF LABOUR, PINNED SO IT CANNOT DRIFT INTO "we thought the
    // chat named them": above two, the chat surface gives a COUNT ONLY. Naming
    // each excluded option is the RESULTS PANEL's job (the UI half of this
    // ruling), and this assertion is what stops a later copy edit from
    // quietly assuming otherwise.
    expect(outcome.assistant_text).not.toContain(LABEL_PHANTOM);
    expect(outcome.assistant_text).not.toContain(LABEL_PHANTOM_2);
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text)).toBe(true);
  });

  it('refuses honestly when exclusion leaves fewer than two options to compare — BEFORE the wire', async () => {
    const graph = makeGraph(
      [{ id: OPT_PHANTOM, kind: 'option', label: LABEL_PHANTOM }],
      [{ from: OPT_PHANTOM, to: 'fac_speed' }],
    );
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot([CONFIGURED_TECH_LEAD, emptyOption(OPT_PHANTOM, LABEL_PHANTOM)], graph),
      ),
    });

    await expect(handler(makeInvocation())).rejects.toBeInstanceOf(HandlerInvocationFailedError);
    // Not a 400 dressed up as an engine fault: no request was made at all.
    expect(run).not.toHaveBeenCalled();
  });

  it('the refusal names the option that needs mapping, prescribes a step that works, and never says "placeholder"', async () => {
    const graph = makeGraph(
      [{ id: OPT_PHANTOM, kind: 'option', label: LABEL_PHANTOM }],
      [{ from: OPT_PHANTOM, to: 'fac_speed' }],
    );
    const { client } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot([CONFIGURED_TECH_LEAD, emptyOption(OPT_PHANTOM, LABEL_PHANTOM)], graph),
      ),
    });

    const error = await handler(makeInvocation()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HandlerInvocationFailedError);
    const failure = error as HandlerInvocationFailedError;
    // `analysis_not_ready` is already in RECOVERABLE_HANDLER_CAUSES and its
    // composer renders `details.next_step` VERBATIM — so this is a 200 with an
    // honest next step, not a 500, and it needs no new cause kind.
    expect(failure.cause_kind).toBe('analysis_not_ready');
    const details = failure.details as Record<string, unknown>;
    expect(details.reason_code).toBe('insufficient_analysable_options');
    const nextStep = details.next_step as string;
    expect(nextStep).toContain(LABEL_PHANTOM);
    expect(nextStep).toMatch(/isn't a comparison/);
    expect(nextStep).not.toMatch(/placeholder/i);
    // It must not blame the engine for a decision CEE made.
    expect(nextStep).not.toMatch(/engine|error|failed/i);
  });
});

// ===========================================================================
// EDGE DOMAIN — the status quo (13d: derived, with its opposite twin pinned)
// ===========================================================================

describe('no-rank ruling — the status quo is HELD, not excluded', () => {
  /** The phantom id, but flagged as the baseline. */
  function baselineSnapshot(extra: Record<string, unknown> = {}): RunAnalysisScenarioSnapshot {
    const graph = makeGraph(
      [{ id: OPT_PHANTOM, kind: 'option', label: LABEL_PHANTOM }],
      [{ from: OPT_PHANTOM, to: 'fac_speed' }],
    );
    return makeSnapshot(
      [
        CONFIGURED_TECH_LEAD,
        CONFIGURED_TWO_DEVS,
        emptyOption(OPT_PHANTOM, LABEL_PHANTOM, { is_baseline: true, ...extra }),
      ],
      graph,
    );
  }

  it('an is_baseline option with no interventions is HELD at its own observed values and SUBMITTED', async () => {
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(baselineSnapshot()),
    });
    await handler(makeInvocation());

    const sent = sentOptions(run);
    expect(sent.map((o) => o.option_id)).toEqual([OPT_TECH_LEAD, OPT_TWO_DEVS, OPT_PHANTOM]);
    // Held at fac_speed's OWN observed position, in the sibling convention:
    // capped factor ⇒ `raw_value` wins ⇒ 100, beside the siblings' 140/120.
    // Not a guess — the number the model already records for that factor.
    expect(sent.find((o) => o.option_id === OPT_PHANTOM)!.interventions).toEqual({
      fac_speed: 100,
    });
  });

  it('OPPOSITE TWIN — the same option WITHOUT the baseline flag is EXCLUDED', async () => {
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      // Byte-identical to the fixture above except `is_baseline` is absent.
      scenarioReader: makeReader(hiringSnapshotWithPhantom()),
    });
    await handler(makeInvocation());

    expect(sentOptions(run).map((o) => o.option_id)).toEqual([OPT_TECH_LEAD, OPT_TWO_DEVS]);
  });

  it('a status quo whose observed values are UNPROVABLE is EXCLUDED, not held (with a contrast control)', async () => {
    // `fac_ambig` carries a [0,1] value on a cap-bearing factor with no
    // corroborating raw_value. PLoT divides by the cap, so submitting 0.4 as
    // "no change" would slam the arm to ~0 — a large intervention wearing the
    // status quo's clothes. The honest outcome is exclusion.
    //
    // ⚠ REAL, DISCLOSED PRODUCT CONSEQUENCE — stated, not buried.
    const graph = makeGraph(
      [{ id: OPT_PHANTOM, kind: 'option', label: LABEL_PHANTOM }],
      [{ from: OPT_PHANTOM, to: 'fac_ambig' }],
    );
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot(
          [
            CONFIGURED_TECH_LEAD,
            CONFIGURED_TWO_DEVS,
            emptyOption(OPT_PHANTOM, LABEL_PHANTOM, { is_baseline: true }),
          ],
          graph,
        ),
      ),
    });
    const outcome = await handler(makeInvocation());
    expect(sentOptions(run).map((o) => o.option_id)).toEqual([OPT_TECH_LEAD, OPT_TWO_DEVS]);
    expect(outcome.assistant_text).toContain(`'${LABEL_PHANTOM}' was left out of this comparison`);

    // ⭐ CONTRAST CONTROL IN THE SAME SWEEP (trap 13e): the identical fixture
    // pointed at a factor WITH provable observed values must be HELD. Without
    // this, "excluded" above is equally consistent with a gate that never holds
    // anything — a blind instrument cannot fake a discrimination it is not
    // making.
    const holdableGraph = makeGraph(
      [{ id: OPT_PHANTOM, kind: 'option', label: LABEL_PHANTOM }],
      [{ from: OPT_PHANTOM, to: 'fac_salary' }],
    );
    const contrast = makePlotClient();
    const contrastHandler = createRunAnalysisHandler({
      plotClient: contrast.client,
      scenarioReader: makeReader(
        makeSnapshot(
          [
            CONFIGURED_TECH_LEAD,
            CONFIGURED_TWO_DEVS,
            emptyOption(OPT_PHANTOM, LABEL_PHANTOM, { is_baseline: true }),
          ],
          holdableGraph,
        ),
      ),
    });
    await contrastHandler(makeInvocation());
    expect(sentOptions(contrast.run).find((o) => o.option_id === OPT_PHANTOM)!.interventions).toEqual(
      { fac_salary: 60000 },
    );
  });

  it('a HELD baseline is disclosed as NO CHANGE — never as a placeholder, and with no futile repair step', async () => {
    const { client } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(baselineSnapshot()),
    });
    const outcome = await handler(makeInvocation());

    expect(outcome.assistant_text).toContain(
      `'${LABEL_PHANTOM}' was analysed as no change — the factors it compares against were held at the values your model records today.`,
    );
    // Reusing the placeholder copy would be false twice over: nothing was
    // guessed at, and the comparison is NOT illustrative — it is sound.
    expect(outcome.assistant_text).not.toMatch(/Placeholder values were used/);
    expect(outcome.assistant_text).not.toMatch(/illustrative/);
    // Nothing for the user to fix ⇒ no advised-action exemplar. A disclosure
    // prescribing a futile step is worse than one that reports.
    expect(outcome.assistant_text).not.toMatch(/Help me configure/);
    // And the new sentence SURVIVES the egress allowlist (a copy branch that
    // ships while the egress silently swallows the summary carrying it is the
    // defect the grammar union exists to prevent).
    expect(isAllowedRunAnalysisAssistantText(outcome.assistant_text)).toBe(true);
  });

  it('a baseline the user DID author intent for is EXCLUDED, never overwritten with our own numbers', async () => {
    // The persisted node carries an intervention entry that merely failed
    // numeric projection. That is user intent, and intent is never written
    // over — but nor can it be submitted, because PLoT sees an empty object.
    // Excluded and disclosed is the only honest outcome.
    const graph = makeGraph(
      [
        {
          id: OPT_PHANTOM,
          kind: 'option',
          label: LABEL_PHANTOM,
          data: { interventions: { fac_speed: 'much faster' } },
        },
      ],
      [{ from: OPT_PHANTOM, to: 'fac_speed' }],
    );
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot(
          [
            CONFIGURED_TECH_LEAD,
            CONFIGURED_TWO_DEVS,
            emptyOption(OPT_PHANTOM, LABEL_PHANTOM, { is_baseline: true }),
          ],
          graph,
        ),
      ),
    });
    const outcome = await handler(makeInvocation());

    expect(sentOptions(run).map((o) => o.option_id)).toEqual([OPT_TECH_LEAD, OPT_TWO_DEVS]);
    expect(outcome.assistant_text).toContain(`'${LABEL_PHANTOM}' was left out of this comparison`);
  });
});

// ===========================================================================
// UNCHANGED BEHAVIOUR — the paths the gate must NOT touch
// ===========================================================================

describe('no-rank ruling — paths the gate must NOT touch', () => {
  it('PURE: all options analysable ⇒ byte-stable no-op, the SAME ARRAY by reference', () => {
    const options = [CONFIGURED_TECH_LEAD, CONFIGURED_TWO_DEVS];
    const outcome = gateAnalysableOptions({
      options,
      graph: makeGraph(),
      rawPersistedGraph: makeGraph(),
      scaleNetEnabled: true,
    });
    // `toBe`, not `toEqual`: identity is the claim. A deep-equality assertion
    // would pass on a freshly-rebuilt array and hide a re-projection.
    expect(outcome.options).toBe(options);
    expect(outcome.held).toEqual([]);
    expect(outcome.excluded).toEqual([]);
  });

  it('PURE: all options unanalysable ⇒ ungated, and the gate excludes NOTHING', () => {
    // The pre-PLoT `options_not_configured` guard owns this shape and runs
    // FIRST. The gate must never turn "nothing was runnable" into an EMPTY
    // submission — that would send zero options and read as an engine fault.
    const options = [
      emptyOption(OPT_PHANTOM, LABEL_PHANTOM),
      emptyOption(OPT_PHANTOM_2, LABEL_PHANTOM_2),
    ];
    const outcome = gateAnalysableOptions({
      options,
      graph: makeGraph(),
      rawPersistedGraph: makeGraph(),
      scaleNetEnabled: true,
    });
    expect(outcome.options).toBe(options);
    expect(outcome.excluded).toEqual([]);
    expect(outcome.held).toEqual([]);
  });

  it('all options unanalysable ⇒ the pre-PLoT options_not_configured guard still fires, with NO PLoT call', async () => {
    const graph = makeGraph(
      [
        { id: OPT_PHANTOM, kind: 'option', label: LABEL_PHANTOM },
        { id: OPT_PHANTOM_2, kind: 'option', label: LABEL_PHANTOM_2 },
      ],
      [],
    );
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(
        makeSnapshot(
          [emptyOption(OPT_PHANTOM, LABEL_PHANTOM), emptyOption(OPT_PHANTOM_2, LABEL_PHANTOM_2)],
          graph,
        ),
      ),
    });

    const error = await handler(makeInvocation()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HandlerInvocationFailedError);
    expect((error as HandlerInvocationFailedError).cause_kind).toBe('options_not_configured');
    expect(run).not.toHaveBeenCalled();
  });

  it('a PRE-EXISTING single-option scenario still attempts the call — the refusal is gated on EXCLUSION', async () => {
    // A scenario that always had exactly one configured option is a
    // pre-existing shape, not this lane's to alter. Its twin (§2.56, above)
    // fires only when the gate itself excluded something. Without this pin the
    // new refusal would silently widen to a shape it was never ratified for.
    const graph = makeGraph([], []);
    const { client, run } = makePlotClient();
    const handler = createRunAnalysisHandler({
      plotClient: client,
      scenarioReader: makeReader(makeSnapshot([CONFIGURED_TECH_LEAD], graph)),
    });

    await handler(makeInvocation()).catch(() => undefined);
    expect(run).toHaveBeenCalledTimes(1);
    expect(sentOptions(run)).toHaveLength(1);
  });

  it('an ANONYMOUS unanalysable option stays in the submission — PLoT owns it, loudly', async () => {
    // With no readable id it cannot be disclosed by name and cannot be matched
    // to a returned comparison entry, so excluding it would SILENTLY drop an
    // option the user can see on their canvas — the one outcome worse than the
    // pre-ruling behaviour.
    const options = [
      CONFIGURED_TECH_LEAD,
      CONFIGURED_TWO_DEVS,
      { label: 'Nameless', interventions: {} },
    ];
    const outcome = gateAnalysableOptions({
      options,
      graph: makeGraph(),
      rawPersistedGraph: makeGraph(),
      scaleNetEnabled: true,
    });
    expect(outcome.options).toHaveLength(3);
    expect(outcome.excluded).toEqual([]);
  });

  it('PURE: the refusal threshold is the PUBLISHED PLoT minimum, not a local number', () => {
    // Derived, not mirrored: if PLoT's `minItems` ever moves, this constant is
    // the ONE place that changes, and every consumer follows.
    expect(PLOT_MIN_COMPARISON_OPTIONS).toBe(2);
  });

  it('PURE: an unnameable excluded label degrades to the generic twin rather than showing an id', () => {
    // The labelled branch is what every other fixture exercises, so without
    // this the generic branch is a line nothing runs.
    expect(
      firstUsableExcludedLabel([
        { option_id: OPT_PHANTOM, label: OPT_PHANTOM, reason: 'no_interventions' },
      ]),
    ).toBeNull();
    expect(
      firstUsableExcludedLabel([
        { option_id: OPT_PHANTOM, label: null, reason: 'no_interventions' },
        { option_id: OPT_PHANTOM_2, label: LABEL_PHANTOM_2, reason: 'no_interventions' },
      ]),
    ).toBe(LABEL_PHANTOM_2);
  });
});
