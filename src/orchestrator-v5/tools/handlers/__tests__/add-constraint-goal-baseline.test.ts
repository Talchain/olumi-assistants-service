/**
 * ROADMAP 2.273 — the CHAT registration path stamps the goal baseline too.
 *
 * WHY THIS PATH NEEDS ITS OWN PIN. `add_constraint` holds a V3 graph, so it
 * writes `observed_state` DIRECTLY — there is no V1→V3 transform left to run,
 * and none of the draft-path coverage touches this code. The two paths have
 * diverged before on exactly this seam (ROADMAP 1.18: the same raw target
 * scored up to ~5x differently depending on how it was registered), which is
 * why both now delegate to one shared cap doctrine AND one shared extractor.
 *
 * THE SAFETY GATE PINNED HERE: the extractor guarantees its target and
 * baseline came from ONE match (same metric), but not that the metric is the
 * one being persisted. So the baseline lands only when the stated target
 * EQUALS the value actually being stamped. The last test is that gate.
 */
import { describe, expect, it } from 'vitest';

import type { HandlerInvocation } from '../../registry.js';
import type { ProposalAction } from '../../../routing/types.js';
import type { GraphV3T } from '../../../../schemas/cee-v3.js';
import { createAddConstraintHandler } from '../add-constraint.js';
import { buildD1Fixture } from '../d1-shared/__tests__/fixtures.js';

function buildInvocation(
  graph: GraphV3T,
  proposal: ProposalAction,
  message: string,
): HandlerInvocation {
  return {
    context: {
      session_id: 'scn-1',
      stage: 'frame',
      request_id: 'req-1',
      prior_turns: [],
      prior_facts: [],
      scenarioBriefText: null,
      persistedGraph: null,
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: 'scn-1',
      turn_id: 'turn-1',
      stage: 'frame',
      message,
    } as unknown as HandlerInvocation['payload'],
    requestId: 'req-1',
    signal: new AbortController().signal,
    orientationText: '',
    proposal,
    graphForTurn: graph,
  };
}

function makeGoalProposal(value: number, unit?: string): ProposalAction {
  const params: ProposalAction['parameters'] = [
    { name: 'constraint_type', value: 'at_least', source: 'user_explicit' },
    { name: 'value', value, source: 'user_explicit' },
  ];
  if (unit) params.push({ name: 'unit', value: unit, source: 'user_explicit' });
  return {
    handler_id: 'add_constraint',
    entity: {
      id: 'g-revenue',
      kind: 'goal',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: params,
    cited_context_fields: [],
  };
}

async function goalNodeAfter(message: string, value: number, unit?: string) {
  const handler = createAddConstraintHandler();
  const outcome = await handler(
    buildInvocation(buildD1Fixture(), makeGoalProposal(value, unit), message),
  );
  const mutated = outcome.mutated_graph as GraphV3T;
  return mutated.nodes.find((n) => n.id === 'g-revenue')!;
}

describe('add_constraint — goal baseline (ROADMAP 2.273, chat path)', () => {
  it('stamps observed_state.baseline against the SAME cap as the threshold', async () => {
    //   stated       target 6_000_000, currently 4_000_000
    //   cap doctrine no '%', no existing cap → rule 3: 6_000_000 * 1.25
    //                cap = 7_500_000
    //   threshold    6_000_000 / 7_500_000 = 0.8
    //   baseline     4_000_000 / 7_500_000 = 0.5333333333333333
    //   ISL (:3303)  delta = 0.8 - 0.53333… = 0.26666666666666666  ( = 4/15 )
    const goal = await goalNodeAfter(
      'Raise the revenue target to 6000000, currently at 4000000.',
      6_000_000,
    );

    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.goal_threshold_cap).toBe(7_500_000);
    expect(goal.observed_state?.baseline).toBe(0.5333333333333333);
    expect(goal.observed_state?.raw_value).toBe(4_000_000);
    expect(goal.observed_state?.cap).toBe(7_500_000);

    const delta = (goal.goal_threshold as number) - (goal.observed_state!.baseline as number);
    expect(delta).toBeCloseTo(4 / 15, 12);
  });

  it('MIS-NORMALISATION GUARD — baseline is the raw value over the threshold’s cap', async () => {
    // Bites if the baseline is ever stamped raw, or divided by a
    // separately-derived cap: either yields an operand ISL's |1.5| domain
    // guard (robustness_analyzer_v2.py:3273) would reject, or worse, silently
    // converts against the wrong scale.
    const goal = await goalNodeAfter(
      'Raise the revenue target to 6000000, currently at 4000000.',
      6_000_000,
    );
    const observed = goal.observed_state!;
    expect(observed.baseline).toBe((observed.raw_value as number) / (goal.goal_threshold_cap as number));
    expect(Math.abs(observed.baseline as number)).toBeLessThanOrEqual(1.5);
  });

  it('writes NO baseline when the message states no current level', async () => {
    const goal = await goalNodeAfter('Set the revenue target to 6000000.', 6_000_000);
    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.observed_state?.baseline).toBeUndefined();
  });

  it('writes NO baseline when the stated target is NOT the value being persisted', async () => {
    // THE CROSS-METRIC GATE. The message states a customer-count target with
    // its own current level, but the constraint being stamped is a revenue
    // figure. Pairing them would hand ISL two numbers from different scales —
    // a confident wrong probability. The mismatch must suppress the baseline.
    const goal = await goalNodeAfter(
      'Our customer target is 800, currently at 500. Anyway, revenue must clear 6000000.',
      6_000_000,
    );
    expect(goal.goal_threshold).toBe(0.8);
    expect(goal.observed_state?.baseline).toBeUndefined();
  });
});
