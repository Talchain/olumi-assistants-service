/**
 * ROADMAP 2.159 — the HANDLER's own enforcement of the normalised bound,
 * invoked directly (no validator in front of it).
 *
 * The handler runs the shared predicate TWICE, deliberately, and the two runs
 * are NOT interchangeable:
 *
 *   • `preEvaluation` — against the user's ORIGINAL operator + right-hand side,
 *     before the operator is applied. This is the AC.1 parity run: it is what
 *     makes a direct handler call enforce exactly what the validator and the
 *     executor precheck enforce. Its rejection carries
 *     `details: { handler_id, target_id, rejection_reason }`.
 *   • `normaliseFactorValue` — against the POST-operator computed value, at
 *     execute time. Its rejection carries
 *     `details: { rawInput, cap, unit, rejection_reason }`.
 *
 * ⚠ WHY THIS FILE EXISTS. The mutation check found that dropping the scale
 * fields from `preEvaluation` ALONE left every other test green — the
 * execute-time run caught the same value and nothing discriminated the two.
 * A guard whose removal changes nothing is not a guard, so the two paths are
 * separated here by their DETAILS SHAPE, which is the only observable
 * difference between them.
 *
 * `f-quality` in the shared D1 fixture is the normalised class verbatim:
 * `observed_state: { value: 0.7 }`, no cap, no unit — the fixture's own
 * comment already calls it "factor without cap, no unit (ratio in [0,1])".
 */

import { describe, expect, it } from 'vitest';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { ProposalAction } from '../../../routing/types.js';

function proposalFor(
  value: unknown,
  operator: 'set' | 'increase' | 'decrease' | 'multiply',
): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-quality', // { value: 0.7 } — no cap, no unit
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value, operator, source: 'user_explicit' }],
    cited_context_fields: [],
  };
}

async function invoke(proposal: ProposalAction) {
  const handler = createSetFactorValueHandler();
  return handler(buildHandlerInvocation({ proposal, graph: buildD1Fixture() }));
}

async function captureFailure(proposal: ProposalAction): Promise<HandlerInvocationFailedError> {
  try {
    await invoke(proposal);
  } catch (err) {
    if (err instanceof HandlerInvocationFailedError) return err;
    throw err;
  }
  throw new Error('expected the handler to refuse, but it returned an outcome');
}

describe('set_factor_value handler — normalised bound, invoked directly', () => {
  it('REFUSES 1.5 on the normalised factor and never mutates the graph', async () => {
    const err = await captureFailure(proposalFor(1.5, 'set'));
    expect(err.cause_kind).toBe('parameter_invalid_at_execute');
    const details = err.details as Record<string, unknown>;
    expect(details.rejection_reason).toBe('value_outside_normalised_range');
  });

  it('the PRE-OPERATOR run is the one that rejects a stated 1.5 (AC.1 parity)', async () => {
    // Discriminator: `preEvaluation`'s throw carries handler_id + target_id;
    // `normaliseFactorValue`'s carries rawInput + cap + unit. If the scale
    // fields are dropped from `preEvaluation`, this rejection arrives from the
    // execute-time run instead and these two keys are absent.
    const details = (await captureFailure(proposalFor(1.5, 'set'))).details as Record<
      string,
      unknown
    >;
    expect(details.handler_id).toBe('set_factor_value');
    expect(details.target_id).toBe('f-quality');
    expect(details.rawInput).toBeUndefined();
  });

  it('the PRE-OPERATOR run also bounds a DELTA product that overshoots 1', async () => {
    // 0.7 + 0.6 = 1.3. The proposal carries a unit so guard 3b
    // (`delta_no_cap_and_no_unit`) does not pre-empt guard 7; the factor itself
    // is unitless, which is what the scale derivation reads.
    const details = (
      await captureFailure(proposalFor({ value: 0.6, unit: 'x' }, 'increase'))
    ).details as Record<string, unknown>;
    expect(details.rejection_reason).toBe('value_outside_normalised_range');
    expect(details.handler_id).toBe('set_factor_value');
    expect(details.target_id).toBe('f-quality');
  });

  it('STILL APPLIES an in-range set — raw and model both move, no cap invented', async () => {
    const outcome = await invoke(proposalFor(0.9, 'set'));
    const nodes = (outcome.mutated_graph as { nodes: Array<Record<string, unknown>> }).nodes;
    const observed = nodes.find((n) => n.id === 'f-quality')?.observed_state as Record<
      string,
      unknown
    >;
    expect(observed.value).toBeCloseTo(0.9, 10);
    expect(observed.raw_value).toBeCloseTo(0.9, 10);
    // ⚠ The bound is DERIVED, never persisted. Nothing may synthesise a cap.
    expect(observed.cap).toBeUndefined();
    expect(observed.unit).toBeUndefined();
  });

  it('leaves the unitless COUNT factor (value 12, "people") unbounded', async () => {
    // `f-uncapped` is { value: 12, raw_value: 12, unit: 'people' } — outside
    // [0,1] and unit-bearing, so the derivation must not touch it.
    const proposal = proposalFor(20, 'set');
    const withCount: ProposalAction = {
      ...proposal,
      entity: { ...proposal.entity, id: 'f-uncapped' },
    };
    const outcome = await invoke(withCount);
    const nodes = (outcome.mutated_graph as { nodes: Array<Record<string, unknown>> }).nodes;
    const observed = nodes.find((n) => n.id === 'f-uncapped')?.observed_state as Record<
      string,
      unknown
    >;
    expect(observed.value).toBe(20);
  });
});
