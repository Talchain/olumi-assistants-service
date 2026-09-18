/**
 * ⭐ THE AGREEMENT PIN — the user-facing SENTENCE and the typed WIRE FIELD come
 * from one computation and CANNOT DISAGREE.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THERE IS A TYPED FIELD AT ALL
 *
 * #1602 shipped the sentence and exported its GRAMMAR — a regex — as the only
 * machine-readable binding. The UI lane refused that binding, and the argument
 * is the reason this file exists:
 *
 *     "A regex binding fails silently and open. If you change the sentence, my
 *      match returns nothing, the disclosure vanishes from my surface, and
 *      nothing goes red anywhere. The user is then told nothing about a reduced
 *      model — which is the precise harm this disclosure exists to prevent. So
 *      the failure mode of the binding is identical to the failure mode it is
 *      meant to close."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ HOW ARM 2 READS THE SENTENCE, AND WHY IT DOES NOT USE THE EXPORTED REGEX
 *
 * The obvious way to compare the sentence against the field is to parse it with
 * `ANALYSIS_PARTICIPATION_DISCLOSURE_RE_SRC`. THAT WOULD REPRODUCE THE DEFECT
 * ONE LEVEL UP: the grammar is maintained beside the copy, so a change that
 * moved both would leave this test green while the numbers a user reads drifted
 * from the numbers a consumer reads. A guard that agrees with itself.
 *
 * So ARM 2 extracts EVERY DIGIT RUN from the disclosure tail with a bare
 * `/\d+/g` and asserts the sequence equals `[excluded_node_count,
 * pruned_edge_count]`. It is deliberately ignorant of the grammar: any rewording
 * that changes which numbers appear, in what order, or how many, fails it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ ONE DISCLOSED RESIDUAL, stated rather than left to be found. The builder's
 * `readCount` CLAMPS at `10^6 - 1` because it has to SPELL the number; the typed
 * field carries the guard's raw value uncapped. Above 999,999 excluded nodes the
 * two would differ, and the field would be the truthful one. No persisted
 * scenario approaches that, and the fix would be to clamp the FIELD, which would
 * make the wire lie to preserve an invariant about prose. Recorded, not closed.
 *
 * ⚠ EXECUTING, NOT A STATIC PIN — the harness below drives the real handler, for
 * the same reason the sibling wiring spec does: a static pin cannot distinguish a
 * live call from a call whose RESULT IS DISCARDED, which is exactly the defect
 * #1602 closed one level down.
 *
 * THE FIXTURE IS NOT THIS LANE'S. The harness is lifted verbatim from
 * `run-analysis-participation-disclosure-wiring.test.ts`, which lifted its core
 * from `run-analysis-unset-option-effect-wiring.test.ts`, which lifted it from
 * `run-admission-two-term.test.ts` — an unrelated lane. A fixture the author
 * wrote is not evidence about the wire (trap 16-inverse).
 *
 * Status ladder: TESTED. Stubbed PLoT + stubbed scenario reader is not a wire
 * witness and not a journey witness.
 */

import { describe, expect, it, vi } from 'vitest';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { composeToolCallResponse } from '../../../compose.js';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

const TEST_SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEST_REQUEST_ID = 'req-participation-disclosure-wiring';

// ============================================================================
// THE FIXTURE — the BASE is not written by this lane, deliberately
// ============================================================================
//
// The option/factor core below is lifted verbatim from
// `run-analysis-unset-option-effect-wiring.test.ts`, which lifted it from
// `run-admission-two-term.test.ts`, where an unrelated lane built it. A fixture
// the author wrote is not evidence about the wire (trap 16-inverse); this core
// predates the surface it is now exercising and is known to REACH a summary.
//
// This lane adds only the two `retained_excluded` factors and their three
// edges, because that is the state under test and no prior fixture carries it.

const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const option = (id: string, label: string, interventions?: Record<string, number>) => ({
  id,
  kind: 'option',
  label,
  ...(interventions ? { interventions } : {}),
});

const factor = (
  id: string,
  label: string,
  participation?: 'included' | 'retained_excluded',
) => ({
  id,
  kind: 'factor',
  label,
  category: 'external',
  observed_state: { value: 0.5, cap: 1 },
  ...(participation !== undefined ? { analysis_participation: participation } : {}),
});

const BASE_NODES = [
  { id: 'goal', kind: 'goal', label: 'Bridge the sales/engineering gap' },
  { id: 'decision', kind: 'decision', label: 'Hiring' },
  {
    id: 'fac_velocity',
    kind: 'factor',
    label: 'Engineering Delivery Velocity',
    category: 'controllable',
    observed_state: { value: 0.5, cap: 1 },
  },
  option('opt_c0', 'Configured 0', { fac_velocity: 0.4 }),
  option('opt_c1', 'Configured 1', { fac_velocity: 0.8 }),
];

const BASE_EDGES = [
  v3Edge('e1', 'decision', 'opt_c0'),
  v3Edge('e2', 'decision', 'opt_c1'),
  v3Edge('e5', 'opt_c0', 'fac_velocity'),
  v3Edge('e6', 'opt_c1', 'fac_velocity'),
  v3Edge('e10', 'fac_velocity', 'goal'),
];

/**
 * TWO excluded nodes and THREE pruned edges — deliberately DIFFERENT integers,
 * so a wiring that reads the right field from the wrong slot (or swaps the two)
 * cannot pass by coincidence.
 *
 * Neither excluded factor is the goal, an option, or the target of any option's
 * interventions, so the guard HONOURS both rather than refusing the run — the
 * path this disclosure exists for.
 */
const TWO_EXCLUDED = {
  version: '1',
  nodes: [
    ...BASE_NODES,
    factor('fac_ext_a', 'Market Conditions', 'retained_excluded'),
    factor('fac_ext_b', 'Regulatory Climate', 'retained_excluded'),
  ],
  edges: [
    ...BASE_EDGES,
    v3Edge('e12', 'fac_ext_a', 'goal'),
    v3Edge('e13', 'fac_ext_a', 'fac_velocity'),
    v3Edge('e14', 'fac_ext_b', 'goal'),
  ],
};

/** ONE excluded node, ONE pruned edge — the singular grammar. */
const ONE_EXCLUDED = {
  version: '1',
  nodes: [...BASE_NODES, factor('fac_ext_a', 'Market Conditions', 'retained_excluded')],
  edges: [...BASE_EDGES, v3Edge('e12', 'fac_ext_a', 'goal')],
};

/** ONE excluded node with NO incident edge — nodes disclosed, edges silent. */
const ONE_EXCLUDED_NO_EDGES = {
  version: '1',
  nodes: [...BASE_NODES, factor('fac_ext_a', 'Market Conditions', 'retained_excluded')],
  edges: [...BASE_EDGES],
};

/**
 * THE CONTRAST FIXTURE — byte-identical to {@link TWO_EXCLUDED} but for the
 * literal `'included'`. The guard withholds nothing, so the disclosure must be
 * ABSENT. Without this arm every assertion below could be true of a build that
 * appends the sentence unconditionally.
 */
const NONE_EXCLUDED = {
  version: '1',
  nodes: [
    ...BASE_NODES,
    factor('fac_ext_a', 'Market Conditions', 'included'),
    factor('fac_ext_b', 'Regulatory Climate', 'included'),
  ],
  edges: [
    ...BASE_EDGES,
    v3Edge('e12', 'fac_ext_a', 'goal'),
    v3Edge('e13', 'fac_ext_a', 'fac_velocity'),
    v3Edge('e14', 'fac_ext_b', 'goal'),
  ],
};

// ============================================================================
// HANDLER SCAFFOLDING — two deps, both stubbed
// ============================================================================

function makeScenarioReader(graph: Record<string, unknown>): ScenarioReader {
  const snapshot = {
    graph,
    options: (graph.nodes as Array<Record<string, unknown>>).filter((n) => n.kind === 'option'),
    goal_node_id: 'goal',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
  return (() => Promise.resolve(snapshot)) as ScenarioReader;
}

const OPTION_COMPARISON: ReadonlyArray<Record<string, unknown>> = [
  { option_id: 'opt_c0', option_label: 'Configured 0', win_probability: 0.62, status: 'computed' },
  { option_id: 'opt_c1', option_label: 'Configured 1', win_probability: 0.38, status: 'computed' },
];

function makePlotClient(): PLoTClient {
  const response = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'participation-wiring' },
    response_hash: 'participation-wiring',
    analysis_status: 'computed',
    option_comparison: OPTION_COMPARISON,
    factor_sensitivity: [
      {
        node_id: 'fac_velocity',
        factor_id: 'fac_velocity',
        label: 'Engineering Delivery Velocity',
        influence_score: 0.9,
        sensitivity_score: 0.9,
      },
    ],
  } as unknown as V2RunResponseEnvelope;
  return {
    run: vi.fn(() =>
      Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope),
    ),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
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


// ============================================================================
// Reading the counts back off the two surfaces
// ============================================================================

const DISCLOSURE_LEAD = ' This analysis ran on a reduced model: ';

/** Drive the real handler and return the whole run_analysis fact. */
async function runAndReadFact(graph: Record<string, unknown>) {
  const handler = createRunAnalysisHandler({
    plotClient: makePlotClient(),
    scenarioReader: makeScenarioReader(graph),
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0];
  if (fact === undefined || fact.fact_type !== 'run_analysis') {
    throw new Error(`expected a run_analysis fact, got ${String(fact?.fact_type)}`);
  }
  return fact;
}

/**
 * Every integer a user can read in the disclosure tail, in order.
 *
 * Bare `/\d+/g` on purpose — see this file's header. Returns `null` when the
 * sentence is absent, which is a DIFFERENT answer from `[]` (a sentence that
 * spells no digits, e.g. the "1 part ... " singular form).
 */
function numbersInDisclosure(summary: string): number[] | null {
  const at = summary.indexOf(DISCLOSURE_LEAD);
  if (at === -1) return null;
  return (summary.slice(at).match(/\d+/g) ?? []).map(Number);
}

describe('the typed field and the sentence cannot disagree', () => {
  it('⭐ ARM 1 — the typed field arrives on the fact carrying BOTH counts, bound by name', async () => {
    const fact = await runAndReadFact(TWO_EXCLUDED);
    // The fixture is 2 nodes and 3 edges — DIFFERENT integers, so a read of the
    // right field from the wrong slot cannot pass by coincidence.
    expect(fact.result.analysis_participation_withheld).toStrictEqual({
      excluded_node_count: 2,
      pruned_edge_count: 3,
    });
  });

  it('⭐⭐ ARM 2 — the numbers a USER reads are the numbers a CONSUMER reads (2 nodes / 3 edges)', async () => {
    const fact = await runAndReadFact(TWO_EXCLUDED);
    const typed = fact.result.analysis_participation_withheld;
    expect(typed).toBeDefined();
    const spelled = numbersInDisclosure(fact.result.summary ?? '');
    // Precondition pinned IN-TEST: this payload really does produce a sentence.
    // Without it the comparison below could pass by both sides being empty.
    expect(spelled).not.toBeNull();
    expect(spelled).toStrictEqual([
      typed?.excluded_node_count,
      typed?.pruned_edge_count,
    ]);
  });

  it('⭐⭐ ARM 2b — and again at DIFFERENT counts (1 node / 1 edge), where the copy goes singular', async () => {
    const fact = await runAndReadFact(ONE_EXCLUDED);
    const typed = fact.result.analysis_participation_withheld;
    expect(typed).toStrictEqual({ excluded_node_count: 1, pruned_edge_count: 1 });
    // The singular copy spells "1 part ..." and "1 connection ...", so the digit
    // runs are still [1, 1]. If a future copy edit drops a numeral in the
    // singular form, this arm reds — which is the point of running the pin at
    // more than one arity.
    expect(numbersInDisclosure(fact.result.summary ?? '')).toStrictEqual([1, 1]);
  });

  it('⭐ ARM 2c — 1 node / 0 edges: the field says 0 edges and the sentence spells no edge clause', async () => {
    const fact = await runAndReadFact(ONE_EXCLUDED_NO_EDGES);
    expect(fact.result.analysis_participation_withheld).toStrictEqual({
      excluded_node_count: 1,
      pruned_edge_count: 0,
    });
    const summary = fact.result.summary ?? '';
    expect(summary).toContain(DISCLOSURE_LEAD);
    // "never 0 connections" — the sentence omits the clause rather than
    // spelling a zero, while the FIELD states the zero explicitly. Two correct
    // answers to two different questions; this arm pins that they stay that way.
    expect(summary).not.toContain('connection');
    expect(numbersInDisclosure(summary)).toStrictEqual([1]);
  });

  it('⭐⭐ ARM 3 — THE CONTRAST: nothing withheld ⇒ field present as {0, 0}, sentence ABSENT', async () => {
    const fact = await runAndReadFact(NONE_EXCLUDED);
    // The field is a POSITIVE ATTESTATION that the guard ran and withheld
    // nothing. This is the one place the two surfaces deliberately differ, and
    // the difference is the contract: silence to a reader, a measured zero to a
    // consumer.
    expect(fact.result.analysis_participation_withheld).toStrictEqual({
      excluded_node_count: 0,
      pruned_edge_count: 0,
    });
    expect(numbersInDisclosure(fact.result.summary ?? '')).toBeNull();
  });

  it('⛔ ARM 3b — the sentence appears EXACTLY when excluded_node_count > 0, across every fixture', async () => {
    // One assertion over all four arms, so a build that appends the sentence
    // unconditionally — or suppresses it unconditionally — cannot pass any of
    // them. Without the NONE_EXCLUDED arm every other assertion here would be
    // true of a build that always discloses.
    for (const graph of [TWO_EXCLUDED, ONE_EXCLUDED, ONE_EXCLUDED_NO_EDGES, NONE_EXCLUDED]) {
      const fact = await runAndReadFact(graph);
      const typed = fact.result.analysis_participation_withheld;
      expect(typed).toBeDefined();
      const sentencePresent = numbersInDisclosure(fact.result.summary ?? '') !== null;
      expect(sentencePresent).toBe((typed?.excluded_node_count ?? 0) > 0);
    }
  });
});

describe('the field reaches the WIRE, at the top level', () => {
  const composeInput = (facts: readonly HandlerFact[]) =>
    ({
      orientation: '',
      confirmation: 'done',
      coaching: null,
      stage: 'analyse',
      answerKind: 'substantive',
      handlerFacts: facts,
    }) as unknown as Parameters<typeof composeToolCallResponse>[0];

  it('⭐ ARM 4 — composeToolCallResponse stamps it top-level, and the envelope VALIDATES', async () => {
    const fact = await runAndReadFact(TWO_EXCLUDED);
    const response = composeToolCallResponse(composeInput([fact]));
    expect(response.analysis_participation_withheld).toStrictEqual({
      excluded_node_count: 2,
      pruned_edge_count: 3,
    });
    // Proves the placement actually survives the strict egress schema rather
    // than merely being assigned onto the object.
    expect(OlumiResponseSchema.safeParse(response).success).toBe(true);
  });

  it('⛔ ARM 4b — it is NOT smuggled into the analysis_result block', async () => {
    const fact = await runAndReadFact(TWO_EXCLUDED);
    const response = composeToolCallResponse(composeInput([fact]));
    const block = response.blocks.find((b) => b.type === 'analysis_result');
    expect(block).toBeDefined();
    // `AnalysisResultBlockSchema` is .strict() and the UI strict-validates this
    // block type, so a key here is a whole-turn schema_mismatch for any consumer
    // still on 0.55.0. This arm is the guard on a future tidy-up that moves it.
    expect(Object.keys(block ?? {})).not.toContain('analysis_participation_withheld');
  });

  it('⛔ ARM 5 — a fact with NO counts (persisted before 0.56.0) yields NO KEY, never {0, 0}', async () => {
    const fact = await runAndReadFact(TWO_EXCLUDED);
    const legacyResult = { ...fact.result };
    delete (legacyResult as Record<string, unknown>).analysis_participation_withheld;
    const legacyFact = { ...fact, result: legacyResult } as typeof fact;

    const response = composeToolCallResponse(composeInput([legacyFact]));
    // The whole point of the absence semantics: defaulting here would tell the
    // user their model was complete on a turn that never assessed it.
    expect('analysis_participation_withheld' in response).toBe(false);
    expect(OlumiResponseSchema.safeParse(response).success).toBe(true);
  });

  it('⛔ ARM 5b — a turn with no run_analysis fact at all yields NO KEY', async () => {
    const response = composeToolCallResponse(composeInput([]));
    expect('analysis_participation_withheld' in response).toBe(false);
  });
});
