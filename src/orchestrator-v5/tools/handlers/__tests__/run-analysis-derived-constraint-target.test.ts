/**
 * RELEASE BLOCKER r1225-constraint-regression — the regression pin.
 *
 * #1225 added a fourth argument to `deriveConstraintVerdict`: the ids of
 * constraints whose TARGET NODE carries no stored quantity. Those constraints
 * are partitioned out at "STEP 0b", BEFORE the precedence rule that reads the
 * producer's own "I refused to score this" disclosure.
 *
 * Its safety argument — "a constraint bound to a node that carries no quantity
 * cannot be scored by any engine, so its absence from the results is guaranteed
 * by construction" — INVERTS on derived targets. An `outcome` or `goal` node
 * carries no STORED quantity precisely because ISL DERIVES its value. Those are
 * the most computable constraint targets in the product, not the least; and the
 * founding 1/1 live-staging defect this module exists to close
 * (`constraint-feasibility.ts` §"DEFECT THIS EXISTS TO CLOSE") is exactly a
 * £2,500 monetary cap attached to a normalised [0,1] "Cost Efficiency"
 * OUTCOME node.
 *
 * So post-#1225 the producer says CONSTRAINT_OUT_OF_DOMAIN + `constraints_status:
 * 'unavailable'`, CEE discards that disclosure, and the leader is asserted over
 * an unchecked limit — the precise harm of trust-spine board #1.
 *
 * ⚠ WHAT THIS FILE PROVES. It EXECUTES the real `run_analysis` handler against
 * a mock PLoT envelope and a mock scenario reader, and reads the verdict off
 * the persisted fact by IDENTITY (`result.constraint_verdict`, the 0.25.0
 * contract field, whose two keys are produced by `projectClaimSafety`). It is
 * an in-process handler witness: status-ladder rung TESTED. It is not a wire
 * witness and not a journey witness.
 *
 * THE CONTROL ARM IS LOAD-BEARING. Arm B binds a constraint to a target that
 * DOES carry a stored quantity. It must read `unevaluated` on BOTH sides of the
 * change — so a green Arm A is attributable to the partition and not to the
 * harness (CLAUDE.md trap 20: a probe that answers identically for every input
 * is reporting on itself).
 */

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import type { PLoTClient, PLoTClientRunOpts } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';

import type { HandlerInvocation } from '../../registry.js';
import {
  createRunAnalysisHandler,
  type RunAnalysisScenarioSnapshot,
  type ScenarioReader,
} from '../run-analysis.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';

// Read the fixture via fs rather than a `with { type: 'json' }` import
// attribute: the full tsconfig (module=Node16, the typecheck-drift ratchet's
// config) rejects import attributes with TS2823, and this file must stay OUT
// of the frozen error baseline.
const happyFixture = JSON.parse(
  readFileSync(
    new URL('../../../../../tests/fixtures/plot/v2-run-golden-happy.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

const TEST_SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TEST_REQUEST_ID = 'req-r1225-derived-target';

/** The constraint the user ratified — named here so every assertion binds to it. */
const CONSTRAINT_ID = 'constraint_out_total_cost_max';
const CONSTRAINT_LABEL = 'Total three-year cost';
/** The DERIVED target: an outcome node, transcribed at the shape the deployed
 *  `draft_graph` payloads carry — id, kind, label, and no quantity field. */
const DERIVED_TARGET_NODE_ID = 'out_total_cost';
/** The MEASURED target for the control arm: same row, a node carrying a value. */
const VALUED_TARGET_NODE_ID = 'fac_total_cost';

function goalConstraint(nodeId: string) {
  return {
    constraint_id: CONSTRAINT_ID,
    node_id: nodeId,
    operator: '<=',
    value: 2500,
    label: CONSTRAINT_LABEL,
    unit: '£',
    provenance: 'explicit',
  };
}

/** Arm A — the constraint's target is a DERIVED outcome node (no stored value). */
const DERIVED_TARGET_GRAPH = {
  nodes: [
    { id: 'g', kind: 'goal', label: 'Goal' },
    { id: DERIVED_TARGET_NODE_ID, kind: 'outcome', label: 'Total Three-Year Cost' },
  ],
  edges: [],
  goal_constraints: [goalConstraint(DERIVED_TARGET_NODE_ID)],
};

/** Arm B (CONTROL) — the constraint's target carries a stored quantity. */
const VALUED_TARGET_GRAPH = {
  nodes: [
    { id: 'g', kind: 'goal', label: 'Goal' },
    {
      id: VALUED_TARGET_NODE_ID,
      kind: 'factor',
      label: 'Total Three-Year Cost',
      observed_state: 2100,
    },
  ],
  edges: [],
  goal_constraints: [goalConstraint(VALUED_TARGET_NODE_ID)],
};

function makeScenarioSnapshot(graph: Record<string, unknown>): RunAnalysisScenarioSnapshot {
  return {
    graph,
    options: [
      { id: 'opt_a', option_id: 'opt_a', label: 'A', interventions: { fac_price: 1.2 } },
      { id: 'opt_b', option_id: 'opt_b', label: 'B', interventions: { fac_price: 0.9 } },
    ],
    goal_node_id: 'g',
    rawPersistedGraph: graph,
  } as unknown as RunAnalysisScenarioSnapshot;
}

function makeScenarioReader(snapshot: RunAnalysisScenarioSnapshot): ScenarioReader {
  return vi.fn<ScenarioReader>(() => Promise.resolve(snapshot));
}

function makePlotClient(response: Record<string, unknown>): PLoTClient {
  const run = vi.fn<
    (
      payload: Record<string, unknown>,
      requestId: string,
      opts?: PLoTClientRunOpts,
    ) => Promise<V2RunResponseEnvelope>
  >(() => Promise.resolve(JSON.parse(JSON.stringify(response)) as V2RunResponseEnvelope));
  const validatePatch = vi.fn().mockResolvedValue({});
  return { run, validatePatch } as unknown as PLoTClient;
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
  } as unknown as HandlerInvocation;
}

/**
 * The producer's OWN disclosure that it did not reach decision grade on the
 * constraint block — both carriers, exactly as `constraint-feasibility.ts`
 * rule 1 reads them.
 */
function suppressedEnvelope(): Record<string, unknown> {
  return {
    ...(JSON.parse(JSON.stringify(happyFixture)) as Record<string, unknown>),
    constraints_status: 'unavailable',
    inference_warnings: [
      {
        code: 'CONSTRAINT_OUT_OF_DOMAIN',
        message: 'Constraint threshold 2500 is outside the target domain [0,1].',
        severity: 'warning',
      },
    ],
  };
}

async function runVerdict(graph: Record<string, unknown>): Promise<{
  may_name_leading_option: unknown;
  constraint_verdict_state: unknown;
  summary: string;
}> {
  const handler = createRunAnalysisHandler({
    plotClient: makePlotClient(suppressedEnvelope()),
    scenarioReader: makeScenarioReader(makeScenarioSnapshot(graph)),
  });
  const outcome = await handler(makeInvocation());
  const fact = outcome.handler_facts[0]!;
  if (fact.fact_type !== 'run_analysis') throw new Error('wrong fact_type');
  const verdict = fact.result.constraint_verdict as
    | { may_name_leading_option?: unknown; constraint_verdict_state?: unknown }
    | undefined;
  if (verdict === undefined) throw new Error('no constraint_verdict on the fact');
  return {
    may_name_leading_option: verdict.may_name_leading_option,
    constraint_verdict_state: verdict.constraint_verdict_state,
    summary: fact.result.summary,
  };
}

describe('r1225 — a constraint on a DERIVED target still consumes the producer refusal', () => {
  it("ARM A: an outcome-node target with CONSTRAINT_OUT_OF_DOMAIN reads 'unevaluated' and withholds the leader", async () => {
    const v = await runVerdict(DERIVED_TARGET_GRAPH);

    // BOUND BY IDENTITY to the persisted contract field's two keys, not to a
    // value predicate another surface could satisfy.
    expect(v.constraint_verdict_state).toBe('unevaluated');
    expect(v.may_name_leading_option).toBe(false);
  });

  it('ARM A: the user is told which condition was not checked, by its own label', async () => {
    const v = await runVerdict(DERIVED_TARGET_GRAPH);

    expect(v.summary).toContain('could not be checked');
    // The constraint is named by the LABEL the user ratified, not by an id.
    expect(v.summary).toContain(CONSTRAINT_LABEL);
    // And no leading-option language survives alongside it.
    expect(v.summary).not.toContain('came out ahead in');
  });

  it("ARM B (CONTROL): a target that DOES carry a quantity also reads 'unevaluated' — unchanged by this pin", async () => {
    // This arm is unaffected by the STEP 0b partition in either direction. It
    // must be GREEN both before and after the change, which is what makes Arm A
    // attributable to the partition rather than to this harness.
    const v = await runVerdict(VALUED_TARGET_GRAPH);

    expect(v.constraint_verdict_state).toBe('unevaluated');
    expect(v.may_name_leading_option).toBe(false);
  });

  it('POSITIVE CONTROL: with NO ratified constraint the same envelope names the leader', async () => {
    // Proves the two absence assertions in Arm A can observe a presence: the
    // engine's constraint warning alone must not change the message.
    const v = await runVerdict({
      nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }],
      edges: [],
    });

    expect(v.constraint_verdict_state).toBe('not_applicable');
    expect(v.may_name_leading_option).toBe(true);
    expect(v.summary).toContain('came out ahead in');
  });
});
