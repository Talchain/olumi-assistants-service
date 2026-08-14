/**
 * ROW 2.1090 / 2.1091 — a realistic money brief must analyse, and the refusal
 * that remains must be TRUE.
 *
 * THE DEFECT (diagnosed at the wire on deployed staging CEE `6079f2d`,
 * 2026-08-13 — `olumi-docs/PHASE0-EVIDENCE-2026-07-28/coaching-surface-2026-08-12/
 * DIAGNOSIS-MIXED-SCALE.md` §3.3):
 *
 *   The drafter frames a £600,000 money factor CORRECTLY as
 *   `{value: 0.6, raw_value: 600000}` and stores NO cap (a deliberate
 *   `projector.ts` decision). It also, unprompted, adds a third "phased" option
 *   it leaves unconfigured — in 3 of 3 big-money arms. `gateAnalysableOptions`
 *   then fills that option from the factor's `observed_state` INCLUDING
 *   `raw_value`, `resolveRawInterventionValue` rule 1 makes `raw_value` WIN, and
 *   **600000** lands on the wire beside its siblings' 0.6 and 0. With no cap the
 *   emission can carry no `unitIntervalEquivalent`, so it is UNDEMOTABLE, the
 *   request is mixed-and-unresolvable, and `run_analysis` refuses — naming a
 *   factor whose incoherent value CEE had just manufactured itself.
 *
 *   Measured: 3 of 3 big-money briefs refused; the one arm that computed did so
 *   only because both its options happened to be configured.
 *
 * THE FIXTURES ARE BANKED WIRE CAPTURES, NOT AUTHORED SHAPES.
 * `fixtures/staging-mixed-scale-captures-2026-08-13.json` holds the VERBATIM
 * persisted graphs read back from CEE's own `/bff/cee/scenarios/:id/graph` on
 * deployed staging for arms M2, N and K. A fixture written from the author's
 * head is not evidence about the wire (CLAUDE.md trap 16-inverse), and this
 * defect is precisely a case where the author's model of the producer was
 * wrong. The capture file is an APPEND-ONLY RECORD (trap 14b): never edit a
 * value in it to make a test pass.
 *
 * The snapshot `options` are derived from those banked option nodes by the
 * PRODUCTION function the loader uses (`mergeInterventionSourceObjects`), so
 * the input to the handler is derived, not mirrored.
 *
 * RED-first at `6079f2d01bea6ccc9a6fe1bc62ed6316a3c461a1`: the two behavioural
 * tests fail with `HandlerInvocationFailedError analysis_not_ready /
 * mixed_scale_unresolved`.
 */

/**
 * ⚠ RE-POINTED BY THE NO-RANK RULING (Paul, 2026-08-14), and the re-point is a
 * claim about REACHABILITY, not a convenience.
 *
 * Since the ruling, an unconfigured option is EXCLUDED from the submission
 * rather than filled with CEE-chosen values. The ONE remaining path on which
 * CEE supplies values at all is the STATUS-QUO HOLD. So the corruption class
 * these tests pin — a CEE-supplied value re-mixing the request's scale after
 * the coherence attestation — is now reachable ONLY through the hold, and the
 * fixture option is therefore flagged `is_baseline` and RENAMED to what it now
 * is ("No change (status quo)").
 *
 * It is renamed rather than merely flagged deliberately: a fixture labelled
 * "Added later" carrying `is_baseline: true` would be a fixture LIE — the same
 * lie a bulk `is_baseline` patch introduced elsewhere in this wave and had to
 * revert ("Partner with a specialist consultancy" is not a status quo). The
 * fixture must BE what it asserts.
 *
 * No banked capture was edited to achieve this (trap 14b): the shapes changed
 * here are locally-authored fixtures.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, it, expect, vi } from 'vitest';

import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { mergeInterventionSourceObjects } from '../../../../orchestrator/tools/analysis-ready-helper.js';
import {
  createRunAnalysisHandler,
  HandlerInvocationFailedError,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import type { HandlerInvocation } from '../../registry.js';
import { gateAnalysableOptions } from '../analysable-option-gate.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-money-brief-scaffold';

// ---------------------------------------------------------------------------
// Banked staging captures (verbatim)
// ---------------------------------------------------------------------------

interface CaptureArm {
  readonly scenario_id: string;
  readonly captured_url: string;
  readonly nodes: Array<Record<string, unknown>>;
  readonly edges: Array<Record<string, unknown>>;
}

const CAPTURES = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('./fixtures/staging-mixed-scale-captures-2026-08-13.json', import.meta.url)),
    'utf8',
  ),
) as { arms: Record<string, CaptureArm> };

/**
 * Build the run_analysis snapshot from a banked capture EXACTLY as
 * `loadScenarioSnapshotForRunAnalysis` → `mergeOptionInterventionObjects`
 * builds it: option identity + label from the option NODE, intervention
 * objects from the production merge function. Nothing here invents a value.
 */
function snapshotFromCapture(armKey: string): RunAnalysisScenarioSnapshot {
  const arm = CAPTURES.arms[armKey];
  expect(arm, `banked capture arm "${armKey}" must exist in the fixture`).toBeDefined();
  const graph = { nodes: arm!.nodes, edges: arm!.edges };
  const optionNodes = arm!.nodes.filter((n) => n.kind === 'option');
  expect(optionNodes.length, `${armKey}: the capture must carry option nodes`).toBeGreaterThan(0);
  const goalNode = arm!.nodes.find((n) => n.kind === 'goal');
  return {
    graph,
    rawPersistedGraph: graph,
    goal_node_id: (goalNode?.id as string | undefined) ?? null,
    options: optionNodes.map((node) => ({
      id: node.id as string,
      option_id: node.id as string,
      label: (node.label as string | undefined) ?? '',
      interventions: mergeInterventionSourceObjects(node),
    })),
  } as unknown as RunAnalysisScenarioSnapshot;
}

/** The capture's own unconfigured options — the precondition this fix is about. */
function unconfiguredOptionLabels(armKey: string): string[] {
  const snapshot = snapshotFromCapture(armKey);
  return (snapshot.options as Array<{ label: string; interventions: Record<string, unknown> }>)
    .filter((o) => Object.keys(o.interventions).length === 0)
    .map((o) => o.label);
}

// ---------------------------------------------------------------------------
// Handler harness
// ---------------------------------------------------------------------------

const PLOT_RESPONSE = {
  meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:money-brief-test' },
  results: [{ option_id: 'opt_a', option_label: 'A', win_probability: 0.6 }],
  response_hash: 'sha256:money-brief-test-top',
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

/** Run the handler, returning either the PLoT call or the typed failure. */
async function driveHandler(snapshot: RunAnalysisScenarioSnapshot): Promise<{
  run: ReturnType<typeof vi.fn>;
  thrown: unknown;
}> {
  const { client, run } = makeCapturingPlotClient();
  const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });
  let thrown: unknown = null;
  try {
    await handler(makeInvocation());
  } catch (err) {
    thrown = err;
  }
  return { run, thrown };
}

function failureDetail(thrown: unknown): { reason_code?: string; next_step?: string } {
  if (!(thrown instanceof HandlerInvocationFailedError)) return {};
  return (thrown.details ?? {}) as { reason_code?: string; next_step?: string };
}

function wireNumbers(run: ReturnType<typeof vi.fn>): number[] {
  const payload = run.mock.calls[0]![0] as { options: Array<{ interventions: Record<string, unknown> }> };
  return payload.options.flatMap((o) => Object.values(o.interventions) as number[]);
}

// ---------------------------------------------------------------------------
// FIX 1 — the scaffold must not resurrect a capless factor's `raw_value`
// ---------------------------------------------------------------------------

describe('FIX 1 — a money brief with an unconfigured option must analyse (banked staging arms)', () => {
  // The precondition, asserted from the capture itself rather than assumed: if
  // the drafter had NOT left an option unconfigured, these tests would be
  // measuring nothing (trap 13b — a guard whose discrimination depends on a
  // fixture that nothing pins).
  it.each([
    ['M2_with_digit', 'Phased: Compliance then Sales'],
    ['N_no_digit', 'Phased: Security Cert First, Then Outbound'],
  ])(
    'PRECONDITION %s: the banked draft carries the unconfigured option this fix is about',
    (armKey, expectedLabel) => {
      expect(unconfiguredOptionLabels(armKey)).toEqual([expectedLabel]);
    },
  );

  it.each([
    ['M2_with_digit', 'Compliance Investment (SOC 2 + SSO)'],
    ['N_no_digit', 'Security & SSO Investment'],
  ])(
    '⭐ %s: the analysis RUNS — it no longer refuses on a value CEE manufactured (%s)',
    async (armKey, blockedFactorLabel) => {
      const { run, thrown } = await driveHandler(snapshotFromCapture(armKey));

      // The load-bearing behavioural claim: the user gets an analysis.
      expect(
        thrown === null,
        `${armKey} must analyse; instead it threw ${
          thrown instanceof HandlerInvocationFailedError
            ? `${thrown.cause_kind}/${failureDetail(thrown).reason_code ?? '?'}: ${failureDetail(thrown).next_step ?? ''}`
            : String(thrown)
        }`,
      ).toBe(true);
      expect(run, 'PLoT must be called exactly once — the analysis actually ran').toHaveBeenCalledTimes(1);

      // ... and it runs on a COHERENT payload, not by relaxing the gate.
      const numbers = wireNumbers(run);
      expect(numbers.length, 'the wire must carry interventions').toBeGreaterThan(0);
      expect(
        numbers.every((v) => typeof v === 'number' && v >= 0 && v <= 1),
        `the wire must be scale-coherent, not merely unblocked; got ${JSON.stringify(numbers)}`,
      ).toBe(true);
      // Bound by IDENTITY (trap 19), not by "some number is absent": the raw
      // magnitude that used to be synthesised onto THIS factor must be gone.
      const arm = CAPTURES.arms[armKey]!;
      const blocked = arm.nodes.find((n) => n.label === blockedFactorLabel) as
        | { id: string; observed_state?: { value?: number; raw_value?: number } }
        | undefined;
      expect(blocked, `the capture must contain ${blockedFactorLabel}`).toBeDefined();
      const rawMagnitude = blocked!.observed_state?.raw_value;
      expect(rawMagnitude, 'the capture must carry the display magnitude this fix strips').toBe(600000);
      const payload = run.mock.calls[0]![0] as {
        options: Array<{ interventions: Record<string, unknown> }>;
      };
      for (const option of payload.options) {
        expect(
          option.interventions[blocked!.id],
          `${blockedFactorLabel} must never reach PLoT as its display magnitude`,
        ).not.toBe(rawMagnitude);
      }
      // The scaffolded neutral IS the factor's own framed level.
      const scaffoldedValues = payload.options
        .map((o) => o.interventions[blocked!.id])
        .filter((v): v is number => typeof v === 'number');
      expect(scaffoldedValues, 'the neutral must be the factor value the drafter framed').toContain(
        blocked!.observed_state?.value,
      );
    },
  );

  it('CONTRAST CONTROL K_money_small: the arm that already computed must still compute', async () => {
    // The £50,000 CRM brief — the one big-money arm that analysed on the
    // deployed build, and only because both its options were configured. It is
    // the opposite-direction twin: the fix must not change a working arm.
    expect(unconfiguredOptionLabels('K_money_small'), 'K has no unconfigured option').toEqual([]);
    const { run, thrown } = await driveHandler(snapshotFromCapture('K_money_small'));
    expect(thrown, 'K must not start refusing').toBeNull();
    expect(run, 'K must still reach PLoT').toHaveBeenCalledTimes(1);
  });

  it('⭐⭐ SEAM: the scaffolded neutral OBJECT keeps `raw_value` on a CAPPED factor and drops it on a CAPLESS one', () => {
    // ⚠ THIS TEST EXISTS BECAUSE A MUTANT SURVIVED, and the survivor is the
    // finding. The handler-level CAPPED TWIN below did NOT detect a mutant that
    // strips `raw_value` from EVERY factor — because its capped fixture PROVES
    // the normalised convention, and on that shape rule 1 and rule 2 converge
    // on the identical number with the identical `unitIntervalEquivalent`:
    //   {value:0.35, raw_value:35000} -> raw_value_used     -> 35000, uie 0.35
    //   {value:0.35}                  -> cap_denormalised   -> 35000, uie 0.35
    // So that mutant is EQUIVALENT for that fixture and NOT equivalent for the
    // code (CLAUDE.md trap 13c — an equivalent mutant must be demonstrated, and
    // so must a non-equivalent one). On a capped factor that does NOT prove the
    // convention the two paths diverge completely:
    //   {value:0.4, raw_value:20000}  -> raw_value_used     -> 20000
    //   {value:0.4}                   -> ambiguous_no_evidence -> REJECTED by
    //     `projectNeutralCandidate`, so the factor is skipped entirely.
    //
    // Binding at the seam the fix actually changes — the candidate OBJECT —
    // discriminates in BOTH shapes, so it cannot be fooled by a fixture whose
    // two code paths happen to agree.
    const graph = {
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        // Capped, convention PROVEN (0.35 * 100000 = 35000).
        { id: 'f_capped', kind: 'factor', label: 'Migration Cost', observed_state: { value: 0.35, raw_value: 35000, cap: 100000 } },
        // Capped, convention NOT proven (0.4 * 100000 = 40000 != 20000). This is
        // the shape the handler-level twin could not see.
        { id: 'f_capped_noconv', kind: 'factor', label: 'Training Spend', observed_state: { value: 0.4, raw_value: 20000, cap: 100000 } },
        // CAPLESS money factor — the deployed drafter's own shape for "£600,000".
        { id: 'f_capless', kind: 'factor', label: 'Compliance Investment', observed_state: { value: 0.6, raw_value: 600000 } },
        { id: 'opt_a', kind: 'option', label: 'Committed', interventions: { f_capped: { value: 0.72, raw_value: 72000 } } },
        { id: 'opt_b', kind: 'option', label: 'No change (status quo)', interventions: {}, is_baseline: true },
      ],
      edges: [
        { from: 'opt_a', to: 'f_capped' },
        { from: 'opt_b', to: 'f_capped' },
        { from: 'opt_b', to: 'f_capped_noconv' },
        { from: 'opt_b', to: 'f_capless' },
      ],
    };
    const outcome = gateAnalysableOptions({
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Committed', interventions: { f_capped: { value: 0.72, raw_value: 72000 } } },
        { id: 'opt_b', option_id: 'opt_b', label: 'No change (status quo)', interventions: {}, is_baseline: true },
      ],
      graph,
      rawPersistedGraph: graph,
      // Pinned true at the sole production call site (run_analysis).
      scaleNetEnabled: true,
    });

    // Precondition, pinned in-test (trap 13b): the scaffold actually fired on
    // the option we are about to inspect. Without this the assertions below
    // could pass on an empty map.
    expect(outcome.held.map((s) => s.option_id)).toEqual(['opt_b']);
    const scaffoldedInterventions = (outcome.options[1] as { interventions: Record<string, unknown> })
      .interventions;

    // CAPPED: `raw_value` IS the level (PLoT divides by the cap) and a pair on a
    // usable cap is demotable — unchanged by this fix, in BOTH capped shapes.
    expect(scaffoldedInterventions.f_capped, 'a capped factor keeps its raw_value').toEqual({
      value: 0.35,
      raw_value: 35000,
    });
    expect(
      scaffoldedInterventions.f_capped_noconv,
      'a capped factor that does not prove the convention ALSO keeps its raw_value — this is the case the handler-level twin was blind to',
    ).toEqual({ value: 0.4, raw_value: 20000 });

    // CAPLESS: `raw_value` is the DISPLAY magnitude, undemotable, and was the
    // whole defect. It must be absent — and the level must be the framed value.
    expect(scaffoldedInterventions.f_capless, 'a capless factor must NOT carry its display magnitude').toEqual({
      value: 0.6,
    });
    expect(
      Object.prototype.hasOwnProperty.call(scaffoldedInterventions.f_capless as object, 'raw_value'),
      'raw_value must be absent, not merely undefined',
    ).toBe(false);
  });

  it('⭐ CAPPED TWIN (handler seam): a capped scaffolded neutral still ships raw, and the request still computes', async () => {
    // On a CAPPED factor `raw_value` IS the level (PLoT divides by the cap) and
    // a consistent pair carries a unitIntervalEquivalent, so it is demotable and
    // must be left exactly as it was. Same scaffold shape as the arms above; the
    // only variable is the presence of a cap.
    const capped = {
      id: 'f_cap',
      kind: 'factor',
      label: 'Migration Cost',
      observed_state: { value: 0.35, raw_value: 35000, cap: 100000 },
    };
    const graph = {
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        capped,
        { id: 'opt_a', kind: 'option', label: 'Committed', interventions: { f_cap: { value: 0.72, raw_value: 72000 } } },
        { id: 'opt_b', kind: 'option', label: 'No change (status quo)', interventions: {}, is_baseline: true },
      ],
      edges: [
        { from: 'f_cap', to: 'g' },
        { from: 'opt_a', to: 'f_cap' },
        { from: 'opt_b', to: 'f_cap' },
      ],
    };
    const snapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Committed', interventions: { f_cap: { value: 0.72, raw_value: 72000 } } },
        { id: 'opt_b', option_id: 'opt_b', label: 'No change (status quo)', interventions: {}, is_baseline: true },
      ],
    } as unknown as RunAnalysisScenarioSnapshot;

    const { run, thrown } = await driveHandler(snapshot);
    expect(thrown, 'the capped shape must keep computing').toBeNull();
    const payload = run.mock.calls[0]![0] as {
      options: Array<{ interventions: Record<string, unknown> }>;
    };
    // ⚠ EXPECTATION DERIVED FROM THE PRODUCER, NOT FROM THE AUTHOR'S MODEL
    // (CLAUDE.md trap 13c — this assertion first read `[0.72, 0.35]`, which was
    // my reading of what "capped" ought to do, and pristine measured
    // `[72000, 35000]`). The request is consistently RAW: BOTH emissions are
    // `raw_value_used`, which IS a raw-scale-emitting rule, so nothing is
    // stranded, `mixed` is false, and there is nothing to demote. PLoT then
    // divides each by the factor's cap — the correct operation.
    //
    // This is the discriminating half of the pair: on a CAPPED factor the
    // scaffolded neutral must still be the factor's `raw_value` (35000). If the
    // fix stripped `raw_value` unconditionally, the neutral would fall to a
    // bare no-cap 0.35 beside a raw 72000 and this would change.
    expect(payload.options.map((o) => o.interventions.f_cap)).toEqual([72000, 35000]);
  });
});

// ---------------------------------------------------------------------------
// FIX 2 — the refusal that REMAINS must be true
// ---------------------------------------------------------------------------

/**
 * The two reachable arms of the scale refusal, each driven to its own reason
 * code. `mixed_scale_unresolved` is reachable in three sub-branches
 * (`mixed && undemotable`, an encoded code outside [0,1], and a demotion
 * postcondition violation); the sentence below is written to be true of ALL of
 * them, because it claims only what `mixedUnresolved` MEANS — that the request
 * carries a value the engine would silently rescale — and never who authored it.
 *
 * ⚠ WHY IT MUST NOT CLAIM THE VALUE IS CEE'S. The measured refusals were all
 * CEE-manufactured, but a USER-authored out-of-range value on a capless factor
 * beside an `ambiguous_no_evidence` sibling reaches the SAME branch. A copy
 * asserting "this value is mine, not yours" would be false there. What IS true
 * in every branch is that the INABILITY is CEE's: the gate is CEE's own verdict
 * on CEE's own assembled request.
 */
describe('FIX 2 — the scale refusal must be true and must not ask for an inert field', () => {
  /** Mixed branch: a bare 40 (undemotable) beside a stranded unit-scale sibling. */
  async function driveMixedRefusal(): Promise<HandlerInvocationFailedError> {
    const graph = {
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        { id: 'f_cd', kind: 'factor', label: 'Migration Cost', observed_state: { value: 0.35, raw_value: 0.35, cap: 1 } },
        { id: 'f_amb', kind: 'factor', label: 'Training Spend', observed_state: { value: 0, raw_value: 0, cap: 25000 } },
        { id: 'opt_a', kind: 'option', label: 'Committed', interventions: { f_cd: { value: 40 }, f_amb: { value: 0.72 } } },
      ],
      edges: [
        { from: 'f_cd', to: 'g' },
        { from: 'f_amb', to: 'g' },
        { from: 'opt_a', to: 'f_cd' },
        { from: 'opt_a', to: 'f_amb' },
      ],
    };
    const snapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Committed', interventions: { f_cd: { value: 40 }, f_amb: { value: 0.72 } } },
      ],
    } as unknown as RunAnalysisScenarioSnapshot;
    const { thrown } = await driveHandler(snapshot);
    expect(thrown, 'the mixed branch must still refuse — the gate is correct').toBeInstanceOf(
      HandlerInvocationFailedError,
    );
    return thrown as HandlerInvocationFailedError;
  }

  /** Baseline branch: a capless factor whose stored baseline is a bare magnitude. */
  async function driveBaselineRefusal(): Promise<HandlerInvocationFailedError> {
    const graph = {
      nodes: [
        { id: 'g', kind: 'goal', label: 'Goal' },
        { id: 'f_raw', kind: 'factor', label: 'Annual Licence Cost', observed_state: { value: 600000, unit: '£' } },
        { id: 'opt_a', kind: 'option', label: 'Committed', interventions: { f_raw: { value: 0.6 } } },
        { id: 'opt_b', kind: 'option', label: 'Status quo', interventions: { f_raw: { value: 0.3 } } },
      ],
      edges: [
        { from: 'f_raw', to: 'g' },
        { from: 'opt_a', to: 'f_raw' },
        { from: 'opt_b', to: 'f_raw' },
      ],
    };
    const snapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Committed', interventions: { f_raw: { value: 0.6 } } },
        { id: 'opt_b', option_id: 'opt_b', label: 'Status quo', interventions: { f_raw: { value: 0.3 } } },
      ],
    } as unknown as RunAnalysisScenarioSnapshot;
    const { thrown } = await driveHandler(snapshot);
    expect(thrown, 'the baseline branch must still refuse').toBeInstanceOf(HandlerInvocationFailedError);
    return thrown as HandlerInvocationFailedError;
  }

  it('PRECONDITION: the two refusals are DIFFERENT branches, not the same one twice', async () => {
    // Trap 21 / 13b: a copy suite that unknowingly drives one branch twice would
    // certify nothing about the other. Pin the discrimination in-test.
    const mixed = failureDetail(await driveMixedRefusal());
    const baseline = failureDetail(await driveBaselineRefusal());
    expect(mixed.reason_code).toBe('mixed_scale_unresolved');
    expect(baseline.reason_code).toBe('baseline_scale_unresolved');
  });

  it.each([
    ['mixed_scale_unresolved', driveMixedRefusal],
    ['baseline_scale_unresolved', driveBaselineRefusal],
  ])(
    '⭐ %s: the copy must not ask for a unit — nothing reads `unit` on the decision path',
    async (_reason, drive) => {
      const nextStep = failureDetail(await drive()).next_step ?? '';
      expect(nextStep.length, 'the refusal must carry copy').toBeGreaterThan(0);
      // `FactorScaleInfo.unit` is declared, written twice, and read by NO
      // predicate — the module header says so at plot-intervention-scale.ts:80.
      // Asking for it is asking the user to answer a question the product
      // cannot hear, and the product then DECLINES the answer ("this factor is
      // recorded without a unit"). Measured closed loop, 2026-08-13 §6b.
      expect(nextStep.toLowerCase(), 'the copy must not ask for a unit').not.toMatch(/\bunits?\b/);
    },
  );

  it.each([
    ['mixed_scale_unresolved', driveMixedRefusal],
    ['baseline_scale_unresolved', driveBaselineRefusal],
  ])('⭐ %s: the copy must attribute the limit to CEE, not to the user', async (_reason, drive) => {
    const nextStep = failureDetail(await drive()).next_step ?? '';
    // The governing rule: the product may describe what IT did; it may not tell
    // the user what THEY said or did wrong. The old copy asserted "some values
    // look like raw amounts and others like 0-1 proportions" — false as a
    // statement about the user's model in 4 of 4 measured refusals.
    expect(nextStep, 'the copy must own the limitation in the first person').toMatch(
      /a limit in how I (prepare|record)/,
    );
    expect(nextStep, 'the copy must not present the block as a judgement of the model').toContain(
      'not a verdict on your model',
    );
    // The one reassurance that is provable at this seam: the handler throws
    // before any write, and the scale projection never mutates persisted state.
    expect(nextStep, 'the copy must say the model is untouched').toContain(
      'Nothing in your model has changed',
    );
    // No claim about who authored the incoherent value — that claim is not true
    // in every branch that reaches this copy (see the describe-block note).
    expect(nextStep.toLowerCase()).not.toMatch(/you (entered|typed|gave|told me) .*(wrong|incorrect)/);
  });

  it('⭐ the copy must still NAME the factor, so the user knows where the problem is', async () => {
    expect(failureDetail(await driveMixedRefusal()).next_step ?? '').toContain('Migration Cost');
    expect(failureDetail(await driveBaselineRefusal()).next_step ?? '').toContain('Annual Licence Cost');
  });

  it('⭐ the baseline copy must break the measured loop: restating the amount does not clear it', async () => {
    // §6c, measured: the single most competent thing a user can do — state the
    // exact value with its exact unit — overwrites the correctly-framed pair
    // with a bare raw magnitude and earns THIS refusal. The old copy then asked
    // for exactly that again.
    const nextStep = failureDetail(await driveBaselineRefusal()).next_step ?? '';
    expect(nextStep).toContain('Telling me the same amount again');
  });
});
