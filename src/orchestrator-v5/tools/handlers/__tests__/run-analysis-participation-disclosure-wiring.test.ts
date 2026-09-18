/**
 * THE WIRING PIN for the run-level participation disclosure — and it EXECUTES
 * the handler.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THE DEFECT THIS CLOSES.
 *
 * #1588 taught `run_analysis` to honour `node.analysis_participation ===
 * 'retained_excluded'`: such a node is withheld from the graph CEE hands PLoT,
 * AND SO IS EVERY EDGE INCIDENT TO IT (PLoT's preflight raises
 * `INVALID_EDGE_ENDPOINT` as a BLOCKER for a dangling endpoint, so the edges
 * cannot stay). The guard returns `excludedNodeIds` and `prunedEdgeCount` to
 * say so.
 *
 * At the tip that introduced it, `run-analysis.ts` read `participation.graph`
 * AND NOTHING ELSE. Both counts went to telemetry and nowhere a user could
 * reach. The UI already marks the NODE ("Unfinished — not included in
 * analysis."), so the user knows that ONE node was left out — and nothing told
 * them the RUN excluded anything, or that EDGES went with it. A user who marks
 * one factor unfinished can lose several connections they never marked, and
 * every number in the result is then internally consistent with a graph they
 * are not looking at, SO THEY CANNOT DETECT IT BY READING CAREFULLY.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⭐ EXECUTING, NOT A STATIC-SOURCE PIN. Same reasoning as the sibling
 * `run-analysis-unset-option-effect-wiring.test.ts`: a static pin cannot
 * distinguish a live call from a call whose RESULT IS DISCARDED, which is
 * EXACTLY the defect here — the guard was called, and its counts discarded.
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
import { guardAnalysisParticipation } from '../run-analysis-participation-guard.js';
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

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

/** Drive the real handler and return the assistant text it puts on the turn. */
async function runAndReadSummary(graph: Record<string, unknown>): Promise<string> {
  const handler = createRunAnalysisHandler({
    plotClient: makePlotClient(),
    scenarioReader: makeScenarioReader(graph),
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0];
  if (fact === undefined || fact.fact_type !== 'run_analysis') {
    throw new Error(`expected a run_analysis fact, got ${String(fact?.fact_type)}`);
  }
  return fact.result.summary ?? '';
}

/**
 * The literal sentences a user reads. Hand-written on purpose: a derived guard
 * proves agreement, never correctness (trap 12d), and these are the exact bytes
 * that ship.
 */
const PLURAL_SENTENCE =
  ' This analysis ran on a reduced model: 2 parts of your model are kept out of the' +
  ' calculation, which also leaves out 3 connections to them.';
const SINGULAR_SENTENCE =
  ' This analysis ran on a reduced model: 1 part of your model is kept out of the' +
  ' calculation, which also leaves out 1 connection to it.';
const SINGULAR_NO_EDGE_SENTENCE =
  ' This analysis ran on a reduced model: 1 part of your model is kept out of the' +
  ' calculation.';

describe('wiring — the run_analysis handler surfaces the participation guard’s own counts', () => {
  // ==========================================================================
  // PRECONDITIONS — pinned in-test, so no arm below can pass on a path it
  // never walked. Today's measured lesson: a fixture that silently exercised a
  // different branch was caught only by its precondition assertion.
  // ==========================================================================
  it('⭐ PRECONDITION — the guard HONOURS this fixture: 2 nodes withheld, 3 edges pruned, 0 refusals', () => {
    const result = guardAnalysisParticipation(TWO_EXCLUDED, {
      goalNodeId: 'goal',
      optionInterventionTargetIds: ['fac_velocity'],
      submittedOptionIds: ['opt_c0', 'opt_c1'],
    });
    expect(result.refusals).toEqual([]);
    expect([...result.excludedNodeIds].sort()).toEqual(['fac_ext_a', 'fac_ext_b']);
    expect(result.prunedEdgeCount).toBe(3);
    // The two integers DIFFER, so a swapped-field wiring cannot pass.
    expect(result.excludedNodeIds.length).not.toBe(result.prunedEdgeCount);
  });

  it('⭐ PRECONDITION (contrast) — the SAME fixture on `included` withholds nothing', () => {
    const result = guardAnalysisParticipation(NONE_EXCLUDED, {
      goalNodeId: 'goal',
      optionInterventionTargetIds: ['fac_velocity'],
      submittedOptionIds: ['opt_c0', 'opt_c1'],
    });
    expect(result.refusals).toEqual([]);
    expect(result.excludedNodeIds).toEqual([]);
    expect(result.prunedEdgeCount).toBe(0);
  });

  // ==========================================================================
  // ARM 1 — both counts reach the text the user receives
  // ==========================================================================
  it('⭐ ARM 1 — the run-level disclosure ARRIVES in the turn, carrying BOTH counts', async () => {
    const summary = await runAndReadSummary(TWO_EXCLUDED);
    expect(summary).toContain(PLURAL_SENTENCE);
    // Composed ≠ delivered: a tail the egress allowlist rejects does not error,
    // it silently replaces the whole summary with the locked template.
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });

  it('⭐ ARM 1b — the singular grammar, one node and one edge', async () => {
    const summary = await runAndReadSummary(ONE_EXCLUDED);
    expect(summary).toContain(SINGULAR_SENTENCE);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });

  it('⭐ ARM 1c — no incident edge ⇒ the edge clause is ABSENT, not "0 connections"', async () => {
    const summary = await runAndReadSummary(ONE_EXCLUDED_NO_EDGES);
    expect(summary).toContain(SINGULAR_NO_EDGE_SENTENCE);
    expect(summary).not.toContain('connection');
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });

  // ==========================================================================
  // ARM 2 — THE DISCRIMINATING TWIN. Zero exclusions ⇒ not one byte.
  // ==========================================================================
  it('⭐ ARM 2 (DISCRIMINATING TWIN) — an ordinary run says NOTHING about exclusions', async () => {
    const summary = await runAndReadSummary(NONE_EXCLUDED);
    expect(summary).not.toContain('reduced model');
    expect(summary).not.toContain('kept out of the calculation');
    // …and the turn still produced a real summary, so this arm is not passing
    // because the handler failed before composing anything.
    expect(summary.length).toBeGreaterThan(0);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  });
});
