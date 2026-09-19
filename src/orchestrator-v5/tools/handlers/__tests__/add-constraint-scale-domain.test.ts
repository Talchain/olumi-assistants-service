/**
 * ⭐⭐ THE LIMIT THAT REPORTS AS SATISFIED — a confident FALSE PASS, not a gap.
 *
 * A money limit on a risk/outcome/goal node is forwarded to ISL by PLoT
 * (`constraint-filter.ts:147` — "warn, don't drop") and scored against a value
 * normalised to [0,1], so `P(score <= 200000)` is 1.0 on every option. The
 * existing measurability gate cannot see it, because the target DOES record a
 * level; it is simply not a level in the user's units.
 *
 * ⚠ THESE ARE REACHABILITY ASSERTIONS, not predicate assertions. The pure
 * predicate is covered by `d1-shared/__tests__/constraint-scale-domain.test.ts`;
 * what is proven here is that the verdict reaches the user's receipt — the
 * class of defect where a helper is correct, wired, and never fires.
 *
 * Assertions bind by the node's own LABEL, never by a value predicate another
 * node could satisfy (trap 19).
 */

import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

/**
 * Paul's 16 Sep shape, with the one change that makes the defect visible: the
 * risk RECORDS A LEVEL (`0.3`, a likelihood). Without it the measurability gate
 * speaks first and this class is never reached — which is why the fixture in
 * `add-constraint-corrects-target.test.ts` could not observe it.
 */
function graph(opts?: { riskRecordsLevel?: boolean; secondCurrencyFactor?: true }): GraphV3T {
  const g = buildD1Fixture();
  g.nodes.push({
    id: 'r-overrun',
    kind: 'risk',
    label: 'Budget Overrun',
    ...(opts?.riskRecordsLevel === false ? {} : { observed_state: { value: 0.3 } }),
  } as unknown as GraphV3T['nodes'][number]);
  // ⚠ NO SECOND CURRENCY FACTOR BY DEFAULT, AND THAT IS THE FIXTURE'S WHOLE
  // POINT. `buildD1Fixture` already ships exactly one — `f-budget`, unit '£' —
  // so the graph has ONE candidate and the shared finder can name it. An
  // earlier draft of this file added its own '£' factor and the finder
  // correctly returned null on 2 candidates; the fixture was wrong, not the
  // helper (CLAUDE.md: a fixture you wrote yourself is not evidence).
  if (opts?.secondCurrencyFactor) {
    g.nodes.push({
      id: 'f-hiring-cost',
      kind: 'factor',
      label: 'Hiring and Onboarding Cost',
      observed_state: { value: 0.6, raw_value: 150000, cap: 250000, unit: '£' },
    } as unknown as GraphV3T['nodes'][number]);
  }
  (g as { goal_constraints?: unknown }).goal_constraints = [];
  return g;
}

function run(opts: { targetId: string; value: number; unit?: string; graph?: GraphV3T }) {
  const parameters: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: 'at_most', source: 'user_explicit' },
    { name: 'value', value: opts.value, source: 'user_explicit' },
  ];
  if (opts.unit) parameters.push({ name: 'unit', value: opts.unit, source: 'user_explicit' });
  const proposal: ProposalAction = {
    handler_id: 'add_constraint',
    entity: { id: opts.targetId, kind: 'node', resolution_status: 'resolved', resolution_method: 'id_match' },
    parameters,
    cited_context_fields: [],
  };
  const invocation: HandlerInvocation = {
    context: {
      session_id: 'scn-1', stage: 'frame', request_id: 'req-1',
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message', scenario_id: 'scn-1', turn_id: 'turn-1', stage: 'frame',
      message: 'Our budget is £200,000.',
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: opts.graph ?? graph(),
  };
  return createAddConstraintHandler()(invocation);
}

describe('add_constraint — a limit the target’s domain cannot carry', () => {
  it('⭐ SAYS SO, naming the cause, when a money limit lands on a risk that records a level', async () => {
    const text = (await run({ targetId: 'r-overrun', value: 200000, unit: 'GBP' })).assistant_text ?? '';
    expect(text).toMatch(/Budget Overrun/);
    expect(text).toMatch(/0-1 likelihood/i);
    expect(text).toMatch(/met no matter what happens/i);
    // NOT the measurability sentence: that cause is false here — the node has a figure.
    expect(text).not.toMatch(/no (?:number|figure)/i);
  });

  it('⭐ offers the one factor recorded in the same unit, through the SHARED finder', async () => {
    const text = (await run({ targetId: 'r-overrun', value: 200000, unit: 'GBP' })).assistant_text ?? '';
    expect(text).toMatch(/Marketing budget may be the one you meant/i);
  });

  it('⭐ emits the correction channel so confirming MOVES the limit', async () => {
    const outcome = await run({ targetId: 'r-overrun', value: 200000, unit: 'GBP' });
    const channel = (outcome as unknown as Record<string, unknown>).__constraint_target_correction as
      | Record<string, unknown>
      | undefined;
    expect(channel).toBeDefined();
    expect(channel?.misplaced_node_id).toBe('r-overrun');
    expect(channel?.alternative_node_id).toBe('f-budget');
  });

  it('⭐ refuses WITHOUT naming one when TWO factors record that unit — it asks, it does not pick', async () => {
    const text = (await run({
      targetId: 'r-overrun', value: 200000, unit: 'GBP', graph: graph({ secondCurrencyFactor: true }),
    })).assistant_text ?? '';
    expect(text).toMatch(/0-1 likelihood/i);
    expect(text).not.toMatch(/may be the one you meant/i);
  });

  // ── THE OPPOSITE DIRECTION — every one of these must stay silent.

  it('is SILENT on a PERCENT limit above 1 — the estate’s commonest real constraint', async () => {
    const text = (await run({ targetId: 'r-overrun', value: 7, unit: '%' })).assistant_text ?? '';
    expect(text).not.toMatch(/0-1 likelihood/i);
    expect(text).toMatch(/^Added constraint/i);
  });

  it('is SILENT when the limit lands on a FACTOR', async () => {
    const text = (await run({ targetId: 'f-budget', value: 200000, unit: 'GBP' })).assistant_text ?? '';
    expect(text).not.toMatch(/0-1 likelihood/i);
  });

  it('⭐ leaves the MEASURABILITY sentence in charge when the risk records nothing', async () => {
    // Ordering is load-bearing: two repair asks in one receipt invite the user
    // to answer neither, and that branch already offers the same move.
    const text = (await run({
      targetId: 'r-overrun', value: 200000, unit: 'GBP', graph: graph({ riskRecordsLevel: false }),
    })).assistant_text ?? '';
    expect(text).toMatch(/has no figure for the analysis to test/i);
    expect(text).not.toMatch(/0-1 likelihood/i);
  });
});
