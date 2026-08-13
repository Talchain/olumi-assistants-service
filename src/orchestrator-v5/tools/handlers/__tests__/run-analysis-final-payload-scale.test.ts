/**
 * ROUND 4 — scale coherence enforced on the FINAL PLoT payload, at the handler seam.
 *
 * Round 3 asserted coherence inside the snapshot LOADER, and two things defeated it:
 *
 *  (a) TOCTOU: `scaffoldUnconfiguredOptions` runs AFTER the loader's projection and
 *      adds neutral interventions through its own per-value resolver — so the loader
 *      attests `demoted:true, allWithinUnitInterval:true, mixedUnresolved:false` and
 *      the scaffold then pushes a raw-scale neutral (e.g. 35000) into the wire.
 *      Executed by the round-3 review with the REAL PLoT normaliser: the configured
 *      cost factor reaches ISL at 0.0000072 — the exact round-2 number, STRICTLY
 *      WORSE than pre-fix, where the un-demoted 72000 would have round-tripped.
 *
 *  (b) `mixedUnresolved` was log-only: a request the system itself classified
 *      unresolvable-mixed still computed, shipping `robustness: high` with no hedge.
 *
 *  (B) The stranded predicate enumerated RULE NAMES, so `encoded_verbatim` within
 *      [0,1] was invisible: wire {72000, encoded 1} shipped `mixedUnresolved:false`
 *      while real PLoT renormalises "buy"=1 to 0.5 — a code, rescaled as a magnitude.
 *
 * The fix these tests specify: scaffold FIRST, then ONE request-level projection,
 * then a hard postcondition on the FINAL `plotPayload.options` immediately before
 * `plotClient.run` — and an unresolvable-mixed request must NOT compute: it routes
 * to the existing `analysis_not_ready` recoverable shape (200 + honest next step +
 * review chip), naming the factors and asking for their units.
 *
 * RED-first: every test in the "round 4" block fails at head e649a871.
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

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-final-payload-scale';

const PLOT_RESPONSE = {
  meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:final-scale-test' },
  results: [{ option_id: 'opt_a', option_label: 'Committed', win_probability: 0.6 }],
  response_hash: 'sha256:final-scale-test-top',
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

/** Every intervention value on the final wire, flattened, with option/factor context. */
function finalWireValues(run: ReturnType<typeof vi.fn>): Array<{ factorId: string; value: unknown }> {
  expect(run, 'PLoT must have been called exactly once for a wire assertion').toHaveBeenCalledTimes(1);
  const payload = run.mock.calls[0]![0] as { options: Array<{ interventions: Record<string, unknown> }> };
  return payload.options.flatMap((o) =>
    Object.entries(o.interventions).map(([factorId, value]) => ({ factorId, value })),
  );
}

// ---------------------------------------------------------------------------
// Fixtures. Factor scale info mirrors the round-3 review's executed probes.
// ---------------------------------------------------------------------------

/** Cost-driver factor PROVING the normalised convention (0.35 * 100000 = 35000). */
const COST_DRIVER = { id: 'f_cd', kind: 'factor', label: 'Migration Cost', observed_state: { value: 0.35, raw_value: 35000, cap: 100000 } };
/** Ambiguous cost factor baselined at £0 — can never prove the convention. */
const AMBIGUOUS = { id: 'f_amb', kind: 'factor', label: 'Training Spend', observed_state: { value: 0, raw_value: 0, cap: 25000 } };
/** Encoded categorical factor — its values are CODES, not magnitudes. */
const ENCODED = { id: 'f_enc', kind: 'factor', label: 'Build vs Buy', observed_state: { value: 1 } };

const graphWith = (
  optionNodes: Array<Record<string, unknown>>,
  edges: Array<Record<string, unknown>>,
  factors: Array<Record<string, unknown>> = [COST_DRIVER, AMBIGUOUS],
) => ({
  nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }, ...factors, ...optionNodes],
  edges: [...factors.map((f) => ({ from: f.id, to: 'g' })), ...edges],
});

describe('round 4 — scale coherence on the FINAL payload (RED at e649a871)', () => {
  it('(a) TOCTOU: a scaffolded option cannot re-mix a demoted request — the FINAL wire is scale-coherent', async () => {
    // Post-fix loader shape: options carry the RAW merged intervention objects; the
    // single request-level projection now happens in the handler, AFTER the scaffold.
    const graph = graphWith(
      [
        { id: 'opt_a', kind: 'option', label: 'Committed', interventions: { f_cd: { value: 0.72 }, f_amb: { value: 0.3 } } },
        { id: 'opt_b', kind: 'option', label: 'Added later' },
      ],
      [
        { from: 'opt_a', to: 'f_cd' },
        { from: 'opt_a', to: 'f_amb' },
        { from: 'opt_b', to: 'f_cd' },
        { from: 'opt_b', to: 'f_amb' },
      ],
    );
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Committed', interventions: { f_cd: { value: 0.72 }, f_amb: { value: 0.3 } } },
        { id: 'opt_b', option_id: 'opt_b', label: 'Added later', interventions: {} },
      ],
    };
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    await handler(makeInvocation());

    const wire = finalWireValues(run);
    expect(wire.length, 'wire must carry interventions for BOTH options').toBeGreaterThanOrEqual(4);
    for (const { factorId, value } of wire) {
      expect(typeof value, `${factorId} must reach PLoT as a number`).toBe('number');
    }
    const numbers = wire.map((w) => w.value as number);
    // The hard postcondition, on the final bytes: the scaffolded neutral for f_cd
    // (observed pair 0.35/35000) must ship in the SAME scale as its demoted
    // configured sibling — all within [0,1] here. At head, the scaffold emits 35000
    // AFTER the loader's demote and the wire ships mixed: {0.72, 0.3, 35000, 0}.
    expect(
      numbers.every((v) => v >= 0 && v <= 1),
      `final wire must be scale-coherent after demotion; got ${JSON.stringify(numbers)}`,
    ).toBe(true);
  });

  it('(b) an unresolvable-mixed request must NOT compute — typed analysis_not_ready naming the factor and asking for units', async () => {
    // A bare 40 (no raw_value, no consistent pair) on the ambiguous-cost factor:
    // outside [0,1], undemotable — and a unit-scale sibling would be annihilated.
    const graph = graphWith(
      [{ id: 'opt_a', kind: 'option', label: 'Committed', interventions: { f_cd: { value: 40 }, f_amb: { value: 0.72 } } }],
      [
        { from: 'opt_a', to: 'f_cd' },
        { from: 'opt_a', to: 'f_amb' },
      ],
      // f_cd here does NOT prove the convention (baseline raw == value), so 40 is
      // a raw-looking passthrough with no known unit representation.
      [{ id: 'f_cd', kind: 'factor', label: 'Migration Cost', observed_state: { value: 0.35, raw_value: 0.35, cap: 1 } }, AMBIGUOUS],
    );
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Committed', interventions: { f_cd: { value: 40 }, f_amb: { value: 0.72 } } },
      ],
    };
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    let thrown: unknown = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      thrown = err;
    }
    expect(run, 'PLoT must NOT be called for a request the system classified unresolvable').not.toHaveBeenCalled();
    expect(thrown, 'the handler must fail typed, not succeed silently').toBeInstanceOf(HandlerInvocationFailedError);
    const failure = thrown as HandlerInvocationFailedError;
    expect(failure.cause_kind).toBe('analysis_not_ready');
    const nextStep = (failure.details as { next_step?: string }).next_step ?? '';
    expect(nextStep, 'the copy must name the factor the block is about').toContain('Migration Cost');
    // ⚠ REPLACED 2026-08-13 (row 2.1091). This read
    // `.toMatch(/unit|scale/)` under the intent "the copy must say what to do:
    // state the unit/scale". Two problems, and the second is why it is replaced
    // rather than deleted: (1) the copy no longer asks for a unit — the ask was
    // measured INERT (`FactorScaleInfo.unit` is read by no predicate here) and
    // the product declined its own requested answer; (2) after the rewrite the
    // old regex still PASSED, on the substring "rescale" — a test agreeing with
    // a contract it was no longer checking (trap 19).
    expect(nextStep.toLowerCase(), 'the copy must not ask for the inert `unit` field').not.toMatch(
      /\bunits?\b/,
    );
    expect(nextStep, 'the copy must own the limit rather than blame the model').toContain(
      'a limit in how I prepare the analysis, not a verdict on your model',
    );
  });

  it("⭐ (a2, round 5) the scaffold's OWN neutral must not un-strand a user value — it routes to the ask", async () => {
    // The user configures a coherent pair: a proven-convention capped factor (0.72)
    // and a NO-CAP factor at unit scale (0.5). Adding ONE unconfigured option makes
    // the scaffold fill it from each factor's observed_state, so the no-cap factor
    // gains CEE's own raw neutral (12). Under the provenance-blind exemption that
    // placeholder made the factor look "self-declared raw", the user's 0.5 stopped
    // counting as stranded, and the request shipped mixed: real PLoT (b9f6b5a7)
    // delivered that 0.5 to ISL as 0.03496 under `mixedUnresolved: false`.
    //
    // A value CEE manufactured is not evidence about the user's request, so this
    // takes the unresolved -> stop -> ask path instead.
    const NO_CAP = { id: 'f_nc', kind: 'factor', label: 'Switching Cost', observed_state: { value: 12 } };
    const graph = graphWith(
      [
        { id: 'opt_a', kind: 'option', label: 'Committed', interventions: { f_cd: { value: 0.72 }, f_nc: { value: 0.5 } } },
        { id: 'opt_b', kind: 'option', label: 'Added later' },
      ],
      [
        { from: 'opt_a', to: 'f_cd' },
        { from: 'opt_a', to: 'f_nc' },
        { from: 'opt_b', to: 'f_cd' },
        { from: 'opt_b', to: 'f_nc' },
      ],
      [COST_DRIVER, NO_CAP],
    );
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'Committed', interventions: { f_cd: { value: 0.72 }, f_nc: { value: 0.5 } } },
        { id: 'opt_b', option_id: 'opt_b', label: 'Added later', interventions: {} },
      ],
    };
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    let thrown: unknown = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      thrown = err;
    }

    expect(run, 'a request whose coherence rests on a CEE placeholder must NOT compute').not.toHaveBeenCalled();
    expect(thrown, 'it must fail typed, never silently').toBeInstanceOf(HandlerInvocationFailedError);
    const failure = thrown as HandlerInvocationFailedError;
    expect(failure.cause_kind).toBe('analysis_not_ready');
    const nextStep = (failure.details as { next_step?: string }).next_step ?? '';
    expect(nextStep, 'the copy must name the factor the user can fix').toContain('Switching Cost');
  });

  it('⭐ (a3, round 5) a USER-AUTHORED astride-1 no-cap request still computes — the ratified case, at the seam', async () => {
    // The opposite-direction twin of (a2): same factor, same astride-1 shape, but
    // BOTH values are the user's own and every option is configured (no scaffold).
    // This must keep computing — it is the 102-test shape the round-4b removal broke.
    const NO_CAP = { id: 'f_nc', kind: 'factor', label: 'Switching Cost', observed_state: { value: 12 } };
    const graph = graphWith(
      [
        { id: 'opt_a', kind: 'option', label: 'A', interventions: { f_nc: { value: 1.2 } } },
        { id: 'opt_b', kind: 'option', label: 'B', interventions: { f_nc: { value: 0.9 } } },
      ],
      [
        { from: 'opt_a', to: 'f_nc' },
        { from: 'opt_b', to: 'f_nc' },
      ],
      [NO_CAP],
    );
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { f_nc: { value: 1.2 } } },
        { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { f_nc: { value: 0.9 } } },
      ],
    };
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    await handler(makeInvocation());

    const wire = finalWireValues(run);
    expect(wire.map((w) => w.value), 'the user values must cross the wire untouched').toEqual([1.2, 0.9]);
  });

  it('(B) encoded stranded beside a raw promotion: the request demotes and the encoded code ships VERBATIM', async () => {
    // Round-3 review finding B, executed against real PLoT b9f6b5a: wire
    // {72000, encoded 1} shipped mixedUnresolved:false and PLoT renormalised
    // "buy"=1 to 0.5 — a CODE rescaled as a magnitude. The consistent pair
    // 0.72/72000 makes this request demotable; the coherent wire is {0.72, 1}
    // (gate skips, code delivered verbatim).
    const costNode = { id: 'f_cd', kind: 'factor', label: 'Migration Cost', observed_state: { value: 0.35, raw_value: 35000, cap: 100000 } };
    const graph = graphWith(
      [{
        id: 'opt_a', kind: 'option', label: 'Committed',
        interventions: {
          f_cd: { value: 0.72, raw_value: 72000 },
          f_enc: { value: 1, value_type: 'categorical', encoding_map: { build: 0, buy: 1 } },
        },
      }],
      [
        { from: 'opt_a', to: 'f_cd' },
        { from: 'opt_a', to: 'f_enc' },
      ],
      [costNode, ENCODED],
    );
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        {
          id: 'opt_a', option_id: 'opt_a', label: 'Committed',
          interventions: {
            f_cd: { value: 0.72, raw_value: 72000 },
            f_enc: { value: 1, value_type: 'categorical', encoding_map: { build: 0, buy: 1 } },
          },
        },
      ],
    };
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    await handler(makeInvocation());

    const wire = finalWireValues(run);
    const cd = wire.find((w) => w.factorId === 'f_cd')?.value;
    const enc = wire.find((w) => w.factorId === 'f_enc')?.value;
    expect(enc, 'the encoded code must ship verbatim — 1 means "buy", not a magnitude').toBe(1);
    expect(cd, 'the consistent pair must demote to its unit representation so the gate skips').toBe(0.72);
  });

  it('(B-block) encoded stranded beside an UNDEMOTABLE raw value: must not compute', async () => {
    // Same shape but the 72000 is a bare passthrough (no pair, no evidence): the
    // request cannot be made coherent, so it must route to the typed failure —
    // PLoT would renormalise the encoded code.
    const costNoEvidence = { id: 'f_cd', kind: 'factor', label: 'Migration Cost', observed_state: { value: 0.35, raw_value: 0.35, cap: 1 } };
    const graph = graphWith(
      [{
        id: 'opt_a', kind: 'option', label: 'Committed',
        interventions: {
          f_cd: { value: 72000 },
          f_enc: { value: 1, value_type: 'categorical', encoding_map: { build: 0, buy: 1 } },
        },
      }],
      [
        { from: 'opt_a', to: 'f_cd' },
        { from: 'opt_a', to: 'f_enc' },
      ],
      [costNoEvidence, ENCODED],
    );
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        {
          id: 'opt_a', option_id: 'opt_a', label: 'Committed',
          interventions: {
            f_cd: { value: 72000 },
            f_enc: { value: 1, value_type: 'categorical', encoding_map: { build: 0, buy: 1 } },
          },
        },
      ],
    };
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    let thrown: unknown = null;
    try {
      await handler(makeInvocation());
    } catch (err) {
      thrown = err;
    }
    expect(run, 'a code beside an unresolvable raw magnitude must not reach PLoT').not.toHaveBeenCalled();
    expect(thrown).toBeInstanceOf(HandlerInvocationFailedError);
    expect((thrown as HandlerInvocationFailedError).cause_kind).toBe('analysis_not_ready');
  });

  it('(B-twin) an all-unit request with an encoded code is untouched and computes — the opposite direction must not regress', async () => {
    const graph = graphWith(
      [{
        id: 'opt_a', kind: 'option', label: 'Committed',
        interventions: {
          f_amb: { value: 0.72 },
          f_enc: { value: 1, value_type: 'categorical', encoding_map: { build: 0, buy: 1 } },
        },
      }],
      [
        { from: 'opt_a', to: 'f_amb' },
        { from: 'opt_a', to: 'f_enc' },
      ],
      [AMBIGUOUS, ENCODED],
    );
    const snapshot: RunAnalysisScenarioSnapshot = {
      graph,
      rawPersistedGraph: graph,
      goal_node_id: 'g',
      options: [
        {
          id: 'opt_a', option_id: 'opt_a', label: 'Committed',
          interventions: {
            f_amb: { value: 0.72 },
            f_enc: { value: 1, value_type: 'categorical', encoding_map: { build: 0, buy: 1 } },
          },
        },
      ],
    };
    const { client, run } = makeCapturingPlotClient();
    const handler = createRunAnalysisHandler({ plotClient: client, scenarioReader: makeReader(snapshot) });

    await handler(makeInvocation());

    const wire = finalWireValues(run);
    expect(wire.find((w) => w.factorId === 'f_enc')?.value).toBe(1);
    expect(wire.find((w) => w.factorId === 'f_amb')?.value).toBe(0.72);
  });
});
