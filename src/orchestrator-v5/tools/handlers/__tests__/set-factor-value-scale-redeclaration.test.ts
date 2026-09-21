/**
 * ROADMAP 2.159 (re-scoped) — scale redeclaration at the HANDLER, invoked
 * directly (no validator in front of it), plus the WRITE-LEVEL proof that
 * nothing is persisted.
 *
 * The handler runs the shared predicate TWICE, deliberately, and the two runs
 * are NOT interchangeable:
 *
 *   • `preEvaluation` — against the user's ORIGINAL operator + right-hand
 *     side. This is the AC.1 parity run: it makes a direct handler call
 *     enforce exactly what the validator and the executor precheck enforce.
 *     Its rejection carries `details: { handler_id, target_id, rejection_reason }`.
 *   • `normaliseFactorValue` — against the POST-operator computed value, at
 *     execute time. Its rejection carries
 *     `details: { rawInput, cap, unit, rejection_reason }`.
 *
 * ⚠ WHY THE DETAILS SHAPE IS ASSERTED. The mutation check found that dropping
 * the threading from `preEvaluation` alone left every other test green — the
 * execute-time run caught the same input and nothing discriminated the two.
 * A guard whose removal changes nothing is not a guard.
 */

import { describe, expect, it } from 'vitest';

import { createSetFactorValueHandler } from '../set-factor-value.js';
import { buildD1Fixture, buildHandlerInvocation } from '../d1-shared/__tests__/fixtures.js';
import { HandlerInvocationFailedError } from '../../handler-errors.js';
import type { ProposalAction } from '../../../routing/types.js';

function proposalFor(
  value: unknown,
  operator: 'set' | 'increase' | 'decrease' | 'multiply',
  targetId = 'f-quality', // { value: 0.7 } — no cap, no unit
): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: targetId,
      kind: 'node',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [{ name: 'value', value, operator, source: 'user_explicit' }],
    cited_context_fields: [],
  };
}

async function invoke(proposal: ProposalAction) {
  return createSetFactorValueHandler()(
    buildHandlerInvocation({ proposal, graph: buildD1Fixture() }),
  );
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

function observedAfter(outcome: { mutated_graph?: unknown }, id: string) {
  const nodes = (outcome.mutated_graph as { nodes: Array<Record<string, unknown>> }).nodes;
  return nodes.find((n) => n.id === id)?.observed_state as Record<string, unknown>;
}

describe('set_factor_value handler — scale redeclaration is refused, never persisted', () => {
  it('REFUSES a unit onto a factor recorded without one, and writes nothing', async () => {
    const err = await captureFailure(proposalFor({ value: 0.9, unit: '%' }, 'set'));
    expect(err.cause_kind).toBe('parameter_invalid_at_execute');
    expect((err.details as Record<string, unknown>).rejection_reason).toBe('unit_redeclares_scale');
  });

  it('REFUSES a cap onto a factor recorded without one — the one-step cap dodge', async () => {
    const err = await captureFailure(proposalFor({ value: 1.5, cap: 2 }, 'set'));
    expect((err.details as Record<string, unknown>).rejection_reason).toBe('cap_redeclares_scale');
  });

  it('the PRE-OPERATOR run is the one that rejects (AC.1 parity discriminator)', async () => {
    // `preEvaluation`'s throw carries handler_id + target_id;
    // `normaliseFactorValue`'s carries rawInput + cap + unit.
    const details = (await captureFailure(proposalFor({ value: 0.9, unit: '%' }, 'set')))
      .details as Record<string, unknown>;
    expect(details.handler_id).toBe('set_factor_value');
    expect(details.target_id).toBe('f-quality');
    expect(details.rawInput).toBeUndefined();
  });

  it('the same holds for a DELTA carrying a redeclaring unit', async () => {
    const details = (await captureFailure(proposalFor({ value: 0.1, unit: 'x' }, 'increase')))
      .details as Record<string, unknown>;
    expect(details.rejection_reason).toBe('unit_redeclares_scale');
    expect(details.handler_id).toBe('set_factor_value');
    expect(details.target_id).toBe('f-quality');
  });
});

describe('set_factor_value handler — everything legitimate still lands', () => {
  it('applies a bare in-range set; no unit and no cap are invented', async () => {
    const observed = observedAfter(await invoke(proposalFor(0.9, 'set')), 'f-quality');
    expect(observed.value).toBeCloseTo(0.9, 10);
    expect(observed.raw_value).toBeCloseTo(0.9, 10);
    expect(observed.cap).toBeUndefined();
    expect(observed.unit).toBeUndefined();
  });

  it('⚠ ACCEPTS 1.5 on the uncapped unitless factor — the honest fail-open (2.193)', async () => {
    // Pinned so nobody reads this PR as having closed the normalised-bounds
    // defect. It did not; it closed the redeclaration class only.
    const observed = observedAfter(await invoke(proposalFor(1.5, 'set')), 'f-quality');
    expect(observed.value).toBe(1.5);
  });

  it('ACCEPTS a legitimate small-COUNT edit on a unit-bearing count factor', async () => {
    // `f-uncapped` is { value: 12, raw_value: 12, unit: 'people' } — the
    // proposal restates the SAME unit, so nothing is redeclared.
    const observed = observedAfter(
      await invoke(proposalFor({ value: 20, unit: 'people' }, 'set', 'f-uncapped')),
      'f-uncapped',
    );
    expect(observed.value).toBe(20);
    expect(observed.unit).toBe('people');
  });

  it('ACCEPTS the consented cap EXTENSION on a factor that already has a cap', async () => {
    // f-budget: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 }.
    const observed = observedAfter(
      await invoke(proposalFor({ value: 250000, unit: '£', cap: 312500 }, 'set', 'f-budget')),
      'f-budget',
    );
    expect(observed.cap).toBe(312500);
    expect(observed.raw_value).toBe(250000);
  });
});

describe('set_factor_value handler — an empty unit is never PERSISTED', () => {
  it('{ value: 5, unit: "" } on a unitless factor writes NO unit key', async () => {
    // Before: persisted { value: 5, unit: '', raw_value: 5 } — after which
    // guard 2c was permanently inert for that factor and every later bare
    // sub-1 edit rendered "not a value in . Tell me the amount in .".
    const observed = observedAfter(await invoke(proposalFor({ value: 5, unit: '' }, 'set')), 'f-quality');
    expect(observed.value).toBe(5);
    expect(observed.raw_value).toBe(5);
    expect('unit' in observed).toBe(false);
  });

  it('a whitespace-only unit likewise writes NO unit key', async () => {
    const observed = observedAfter(await invoke(proposalFor({ value: 5, unit: '  ' }, 'set')), 'f-quality');
    expect('unit' in observed).toBe(false);
  });

  it('a padded REAL unit is trimmed, not dropped — and still refused as a redeclaration', async () => {
    const err = await captureFailure(proposalFor({ value: 5, unit: ' £ ' }, 'set'));
    const details = err.details as Record<string, unknown>;
    expect(details.rejection_reason).toBe('unit_redeclares_scale');
  });

  it('a padded unit matching the factor is trimmed and LANDS (no false redeclaration)', async () => {
    // f-uncapped is { value: 12, raw_value: 12, unit: 'people' }.
    const observed = observedAfter(
      await invoke(proposalFor({ value: 20, unit: ' people ' }, 'set', 'f-uncapped')),
      'f-uncapped',
    );
    expect(observed.value).toBe(20);
    expect(observed.unit).toBe('people');
  });
});
