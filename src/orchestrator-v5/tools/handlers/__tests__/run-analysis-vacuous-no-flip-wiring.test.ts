/**
 * THE WIRING PIN for P2 — the run_analysis handler must hand the headline the
 * set of factors EVERY option sets, or the vacuous "no single factor we tested
 * would change the order" keeps shipping.
 *
 * `headline-vacuous-no-flip.test.ts` proves the headline's rule. It cannot prove
 * the handler PASSES the set: delete the `factorIdsSetByEveryOption:` line from
 * `run-analysis.ts` and every assertion there stays green while the product
 * ships the defect (chronic failure #1 — built, not plugged in). This file
 * EXECUTES the handler, modelled on `run-analysis-unset-option-effect-wiring.test.ts`
 * (two stubbed deps: `plotClient`, `scenarioReader`).
 *
 * ARM 1 is the defect shape (every option sets both tested factors). ARM 2 is
 * the DISCRIMINATING TWIN (one option leaves a tested factor free): the same
 * handler must still state the finding there, so ARM 1 cannot pass against a
 * build that simply never says it.
 *
 * ARMS 3-6 pin the POPULATION (Codex, PR #1754 comment 5796871024): the
 * intersection must be taken over the options PLoT actually RECEIVED
 * (`finalWireOptions`), not every persisted option. The analysable-option gate
 * EXCLUDES an interventionless placeholder and HOLDS an interventionless status
 * quo, so the persisted graph is wrong in both directions:
 *  - ARM 3: an excluded placeholder must not empty the intersection (RED on a
 *    persisted-graph source);
 *  - ARM 5: a held status quo sets its factors ON THE WIRE only (RED on a
 *    persisted-graph source AND on "persisted options filtered to submitted
 *    ids" — only the wire interventions answer it);
 *  - ARMS 4 and 6 are their twins: a submitted option (configured, or held on
 *    fewer factors) that leaves a tested factor free keeps the finding.
 * Each arm first asserts the wire population it claims, so a fixture that
 * stopped exercising the gate fails loudly instead of passing vacuously.
 *
 * Status ladder: TESTED. Stubbed PLoT is not a wire witness.
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
import { isAllowedRunAnalysisAssistantText } from '../../../coaching/analysis-result-headline.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

const TEST_SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TEST_REQUEST_ID = 'req-vacuous-no-flip-wiring';

const v3Edge = (id: string, from: string, to: string) => ({
  id,
  from,
  to,
  strength: { mean: 0.5, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive' as const,
});

const factor = (id: string, label: string) => ({
  id,
  kind: 'factor',
  label,
  category: 'controllable',
  observed_state: { value: 0.5, cap: 1 },
});

const option = (
  id: string,
  label: string,
  interventions: Record<string, number>,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: 'option',
  label,
  interventions,
  ...extra,
});

/** ARM 1 — every option sets BOTH tested factors (Paul's shape). */
const EVERY_OPTION_SETS_EVERY_FACTOR = {
  version: '1',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Hit the delivery date' },
    { id: 'decision', kind: 'decision', label: 'Delivery plan' },
    factor('fac_scope', 'Scope'),
    factor('fac_capacity', 'Team capacity'),
    option('opt_reduce', 'Reduce scope', { fac_scope: 0.4, fac_capacity: 0.5 }),
    option('opt_contract', 'Hire a contractor', { fac_scope: 0.8, fac_capacity: 0.8 }),
    option('opt_sq', 'Status quo', { fac_scope: 0.8, fac_capacity: 0.5 }),
  ],
  edges: [
    v3Edge('e1', 'decision', 'opt_reduce'),
    v3Edge('e2', 'decision', 'opt_contract'),
    v3Edge('e3', 'decision', 'opt_sq'),
    v3Edge('e4', 'opt_reduce', 'fac_scope'),
    v3Edge('e5', 'opt_reduce', 'fac_capacity'),
    v3Edge('e6', 'opt_contract', 'fac_scope'),
    v3Edge('e7', 'opt_contract', 'fac_capacity'),
    v3Edge('e8', 'opt_sq', 'fac_scope'),
    v3Edge('e9', 'opt_sq', 'fac_capacity'),
    v3Edge('e10', 'fac_scope', 'goal'),
    v3Edge('e11', 'fac_capacity', 'goal'),
  ],
};

/** ARM 2 — identical, except the status quo leaves Team capacity free. */
const ONE_OPTION_LEAVES_A_FACTOR_FREE = {
  ...EVERY_OPTION_SETS_EVERY_FACTOR,
  nodes: EVERY_OPTION_SETS_EVERY_FACTOR.nodes.map((n) =>
    n.id === 'opt_sq' ? option('opt_sq', 'Status quo', { fac_scope: 0.8 }) : n,
  ),
  edges: EVERY_OPTION_SETS_EVERY_FACTOR.edges.filter((e) => e.id !== 'e9'),
};

const goalAndFactors = [
  { id: 'goal', kind: 'goal', label: 'Hit the delivery date' },
  { id: 'decision', kind: 'decision', label: 'Delivery plan' },
  factor('fac_scope', 'Scope'),
  factor('fac_capacity', 'Team capacity'),
];
const factorToGoalEdges = [v3Edge('e10', 'fac_scope', 'goal'), v3Edge('e11', 'fac_capacity', 'goal')];

/**
 * ARM 3 — Codex's counterexample. A and B both set both tested factors; C is an
 * interventionless, non-baseline PLACEHOLDER, which the gate EXCLUDES from the
 * PLoT submission. PLoT compares A and B only.
 */
const EXCLUDED_PLACEHOLDER_BESIDE_TWO_SETTERS = {
  version: '1',
  nodes: [
    ...goalAndFactors,
    option('opt_reduce', 'Reduce scope', { fac_scope: 0.4, fac_capacity: 0.5 }),
    option('opt_contract', 'Hire a contractor', { fac_scope: 0.8, fac_capacity: 0.8 }),
    option('opt_placeholder', 'Something else', {}),
  ],
  edges: [
    v3Edge('e1', 'decision', 'opt_reduce'),
    v3Edge('e2', 'decision', 'opt_contract'),
    v3Edge('e3', 'decision', 'opt_placeholder'),
    v3Edge('e4', 'opt_reduce', 'fac_scope'),
    v3Edge('e5', 'opt_reduce', 'fac_capacity'),
    v3Edge('e6', 'opt_contract', 'fac_scope'),
    v3Edge('e7', 'opt_contract', 'fac_capacity'),
    ...factorToGoalEdges,
  ],
};

/** ARM 4 — ARM 3's twin: a SUBMITTED option (B) leaves Team capacity free. */
const EXCLUDED_PLACEHOLDER_SUBMITTED_OPTION_LEAVES_FREE = {
  ...EXCLUDED_PLACEHOLDER_BESIDE_TWO_SETTERS,
  nodes: EXCLUDED_PLACEHOLDER_BESIDE_TWO_SETTERS.nodes.map((n) =>
    n.id === 'opt_contract' ? option('opt_contract', 'Hire a contractor', { fac_scope: 0.8 }) : n,
  ),
  edges: EXCLUDED_PLACEHOLDER_BESIDE_TWO_SETTERS.edges.filter((e) => e.id !== 'e7'),
};

/**
 * ARM 5 — A and B set both tested factors; the status quo (`is_baseline`) has
 * NO persisted interventions and edges to both factors, so the gate HOLDS it at
 * both factors' observed values. On the wire every option sets both factors.
 */
const HELD_BASELINE_ON_EVERY_TESTED_FACTOR = {
  version: '1',
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Hit the delivery date' },
    { id: 'decision', kind: 'decision', label: 'Delivery plan' },
    // The hold needs a PROJECTABLE observed position: a bare `value` beside a
    // `cap` is `ambiguous_no_evidence` and is skipped (the gate never invents a
    // status quo). A capless level projects under `no_cap`, so the gate HOLDS.
    { ...factor('fac_scope', 'Scope'), observed_state: { value: 0.5 } },
    { ...factor('fac_capacity', 'Team capacity'), observed_state: { value: 0.5 } },
    option('opt_reduce', 'Reduce scope', { fac_scope: 0.4, fac_capacity: 0.5 }),
    option('opt_contract', 'Hire a contractor', { fac_scope: 0.8, fac_capacity: 0.8 }),
    option('opt_sq', 'Status quo', {}, { is_baseline: true }),
  ],
  edges: [
    v3Edge('e1', 'decision', 'opt_reduce'),
    v3Edge('e2', 'decision', 'opt_contract'),
    v3Edge('e3', 'decision', 'opt_sq'),
    v3Edge('e4', 'opt_reduce', 'fac_scope'),
    v3Edge('e5', 'opt_reduce', 'fac_capacity'),
    v3Edge('e6', 'opt_contract', 'fac_scope'),
    v3Edge('e7', 'opt_contract', 'fac_capacity'),
    v3Edge('e8', 'opt_sq', 'fac_scope'),
    v3Edge('e9', 'opt_sq', 'fac_capacity'),
    ...factorToGoalEdges,
  ],
};

/** ARM 6 — ARM 5's twin: the status quo is held on Scope ONLY, leaving Team capacity free. */
const HELD_BASELINE_LEAVES_A_TESTED_FACTOR_FREE = {
  ...HELD_BASELINE_ON_EVERY_TESTED_FACTOR,
  edges: HELD_BASELINE_ON_EVERY_TESTED_FACTOR.edges.filter((e) => e.id !== 'e9'),
};

function makeScenarioReader(graph: Record<string, unknown>): ScenarioReader {
  const snapshot = {
    graph,
    options: (graph.nodes as Array<Record<string, unknown>>).filter((n) => n.kind === 'option'),
    goal_node_id: 'goal',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
  return (() => Promise.resolve(snapshot)) as ScenarioReader;
}

const COMPARISON_ROWS: Record<string, Record<string, unknown>> = {
  opt_reduce: { option_id: 'opt_reduce', option_label: 'Reduce scope', win_probability: 0.62, status: 'computed' },
  opt_contract: { option_id: 'opt_contract', option_label: 'Hire a contractor', win_probability: 0.25, status: 'computed' },
  opt_sq: { option_id: 'opt_sq', option_label: 'Status quo', win_probability: 0.13, status: 'computed' },
};

/**
 * Not robust, and every flip row ATTESTS no flip — the 2.278 posture. The
 * comparison carries exactly the options PLoT was sent (an excluded option is
 * never ranked), so the stub mirrors the submission it would have received.
 */
function makePlotClient(comparedOptionIds: readonly string[] = ['opt_reduce', 'opt_contract', 'opt_sq']): PLoTClient {
  const response = {
    meta: { seed_used: 1, n_samples: 1000, response_hash: 'vacuous-no-flip-wiring' },
    response_hash: 'vacuous-no-flip-wiring',
    analysis_status: 'computed',
    option_comparison: comparedOptionIds.map((id) => COMPARISON_ROWS[id]),
    factor_sensitivity: [],
    robustness: { is_robust: false, level: 'low' },
    flip_thresholds: [
      { factor_id: 'fac_scope', factor_label: 'Scope', current_value: 0.5, flip_value: null, flip_reason: 'structurally_invariant' },
      { factor_id: 'fac_capacity', factor_label: 'Team capacity', current_value: 0.5, flip_value: null, flip_reason: 'structurally_invariant' },
    ],
  } as unknown as V2RunResponseEnvelope;
  return {
    run: vi.fn(() => Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope)),
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

async function runAndReadSummary(graph: Record<string, unknown>): Promise<string> {
  return (await runAndReadSummaryAndWire(graph)).summary;
}

type WireOption = { id?: string; option_id?: string; interventions: Record<string, number> };

/** Runs the handler and returns the summary AND the options PLoT actually received. */
async function runAndReadSummaryAndWire(
  graph: Record<string, unknown>,
  comparedOptionIds?: readonly string[],
): Promise<{ summary: string; wire: Map<string, string[]> }> {
  const plotClient = makePlotClient(comparedOptionIds);
  const handler = createRunAnalysisHandler({
    plotClient,
    scenarioReader: makeScenarioReader(graph),
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0];
  if (fact === undefined || fact.fact_type !== 'run_analysis') {
    throw new Error(`expected a run_analysis fact, got ${String(fact?.fact_type)}`);
  }
  const run = plotClient.run as unknown as ReturnType<typeof vi.fn>;
  expect(run).toHaveBeenCalledTimes(1);
  const sent = (run.mock.calls[0]![0] as { options: WireOption[] }).options;
  const wire = new Map(
    sent.map((o) => [String(o.id ?? o.option_id), Object.keys(o.interventions).sort()]),
  );
  return { summary: fact.result.summary ?? '', wire };
}

/** The literal clause a user reads. Hand-written: a derived guard proves agreement, not correctness. */
const NO_FLIP_CLAIM = 'no single factor we tested would change the order';

/** The egress grammar costs seconds per call on the no-flip sentence (see headline-vacuous-no-flip.test.ts). */
const GRAMMAR_BUDGET_MS = 30_000;

describe('wiring — run_analysis hands the headline the every-option factor set (P2)', () => {
  it('⭐ ARM 1 — every option sets every tested factor ⇒ the vacuous claim is NOT in the summary', async () => {
    const summary = await runAndReadSummary(EVERY_OPTION_SETS_EVERY_FACTOR);
    // Precondition: the robustness verdict rides, so an absence below is not vacuous.
    expect(summary).toContain('The result is not yet robust');
    expect(summary).not.toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  }, GRAMMAR_BUDGET_MS);

  it('⭐ ARM 2 (DISCRIMINATING TWIN) — one option leaves a tested factor free ⇒ the finding is stated', async () => {
    const summary = await runAndReadSummary(ONE_OPTION_LEAVES_A_FACTOR_FREE);
    expect(summary).toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  }, GRAMMAR_BUDGET_MS);

  // ---- The POPULATION (PR #1754, comment 5796871024) ----------------------

  it('⭐ ARM 3 — an EXCLUDED placeholder does not govern the claim: the two submitted options both set every tested factor ⇒ withheld', async () => {
    const { summary, wire } = await runAndReadSummaryAndWire(
      EXCLUDED_PLACEHOLDER_BESIDE_TWO_SETTERS,
      ['opt_reduce', 'opt_contract'],
    );
    // Precondition: the gate EXCLUDED the placeholder, so PLoT compared A and B only.
    expect([...wire.keys()].sort()).toEqual(['opt_contract', 'opt_reduce']);
    expect(wire.get('opt_reduce')).toEqual(['fac_capacity', 'fac_scope']);
    expect(wire.get('opt_contract')).toEqual(['fac_capacity', 'fac_scope']);
    // The verdict stays (the existing not-robust sentence); the vacuous finding does not.
    expect(summary).toContain('The result is not yet robust');
    expect(summary).not.toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  }, GRAMMAR_BUDGET_MS);

  it('⭐ ARM 4 (TWIN of 3) — a SUBMITTED option leaves a tested factor free ⇒ the finding is stated', async () => {
    const { summary, wire } = await runAndReadSummaryAndWire(
      EXCLUDED_PLACEHOLDER_SUBMITTED_OPTION_LEAVES_FREE,
      ['opt_reduce', 'opt_contract'],
    );
    expect([...wire.keys()].sort()).toEqual(['opt_contract', 'opt_reduce']);
    expect(wire.get('opt_contract')).toEqual(['fac_scope']);
    expect(summary).toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  }, GRAMMAR_BUDGET_MS);

  it('⭐ ARM 5 — a HELD status quo sets its factors on the WIRE: every submitted option sets every tested factor ⇒ withheld', async () => {
    const { summary, wire } = await runAndReadSummaryAndWire(HELD_BASELINE_ON_EVERY_TESTED_FACTOR);
    // Precondition: persisted status quo has NO interventions; the gate HELD it on both.
    expect([...wire.keys()].sort()).toEqual(['opt_contract', 'opt_reduce', 'opt_sq']);
    expect(wire.get('opt_sq')).toEqual(['fac_capacity', 'fac_scope']);
    expect(summary).toContain('The result is not yet robust');
    expect(summary).not.toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  }, GRAMMAR_BUDGET_MS);

  it('⭐ ARM 6 (TWIN of 5) — the status quo is held on fewer factors, leaving one free ⇒ the finding is stated', async () => {
    const { summary, wire } = await runAndReadSummaryAndWire(HELD_BASELINE_LEAVES_A_TESTED_FACTOR_FREE);
    expect([...wire.keys()].sort()).toEqual(['opt_contract', 'opt_reduce', 'opt_sq']);
    expect(wire.get('opt_sq')).toEqual(['fac_scope']);
    expect(summary).toContain(NO_FLIP_CLAIM);
    expect(isAllowedRunAnalysisAssistantText(summary)).toBe(true);
  }, GRAMMAR_BUDGET_MS);
});
