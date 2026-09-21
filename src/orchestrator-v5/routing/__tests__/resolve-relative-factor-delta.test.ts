/**
 * Lane CEE-D (edit-loop reliability) — unit tests for the relative-delta
 * resolver. The executor-level fixtures live in
 * `__tests__/turn-executor-relative-delta.test.ts`; this file pins the
 * resolver's own accept/decline matrix, in particular every NEVER-GUESS
 * decline branch.
 */
import { describe, it, expect } from 'vitest';

import { resolveRelativeFactorDelta } from '../resolve-relative-factor-delta.js';
import type { ProposalAction } from '../types.js';
import type { FactorObservedStateSnapshot, GraphLookup } from '../validator.js';

function makeGraphLookup(
  obs: FactorObservedStateSnapshot | null,
): GraphLookup {
  return {
    findEntityById: (id: string) =>
      id === 'f-budget' ? { id, kind: 'node' as const, label: 'Budget' } : null,
    listEntitiesByKind: () => [],
    findFactorObservedState: (id: string) => (id === 'f-budget' ? obs : null),
  };
}

function makeAction(
  value: unknown,
  operator?: 'set' | 'increase' | 'decrease' | 'multiply',
  paramUnit?: string,
): ProposalAction {
  return {
    handler_id: 'set_factor_value',
    entity: {
      id: 'f-budget',
      kind: 'node',
      label: 'Budget',
      resolution_status: 'resolved',
      resolution_method: 'context_inference',
    },
    parameters: [
      {
        name: 'value',
        value,
        ...(operator ? { operator } : {}),
        ...(paramUnit ? { unit: paramUnit } : {}),
        source: 'user_explicit',
      },
    ],
    cited_context_fields: [],
  } as ProposalAction;
}

const POUND_FACTOR: FactorObservedStateSnapshot = {
  value: 0.4,
  raw_value: 40000,
  unit: '£',
  cap: 100000,
};

describe('resolveRelativeFactorDelta — accepts', () => {
  it('structured percent increase on a £ factor → absolute set in £', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5, unit: '%' }, 'increase'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved) return;
    const param = outcome.action.parameters[0]!;
    expect(param.operator).toBe('set');
    expect(param.value).toEqual({ value: 42000, unit: '£' });
    expect(outcome.telemetry).toEqual({
      target_id: 'f-budget',
      direction: 'increase',
      source_shape: 'structured_percent',
    });
  });

  it('bare number with parameter-level "%" unit and decrease operator', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction(10, 'decrease', '%'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved) return;
    expect(outcome.action.parameters[0]!.value).toEqual({ value: 36000, unit: '£' });
  });

  it('string "+5%" resolves without an operator (sign gives direction)', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction('+5%'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved) return;
    expect(outcome.action.parameters[0]!.value).toEqual({ value: 42000, unit: '£' });
    expect(outcome.telemetry.source_shape).toBe('string_percent');
  });

  it('signless string "5%" with an increase operator resolves', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction('5%', 'increase'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(true);
  });

  it('legacy capped factor without raw_value de-normalises the LHS (value*cap)', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5, unit: '%' }, 'increase'),
      makeGraphLookup({ value: 0.4, unit: '£', cap: 100000 }),
    );
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved) return;
    // 0.4 * 100000 = £40,000 → +5% → £42,000 (NOT 0.4 * 1.05 = 0.42).
    expect(outcome.action.parameters[0]!.value).toEqual({ value: 42000, unit: '£' });
  });

  it('unitless factor resolves to a bare absolute number', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5, unit: '%' }, 'increase'),
      makeGraphLookup({ raw_value: 200, value: 200 }),
    );
    expect(outcome.resolved).toBe(true);
    if (!outcome.resolved) return;
    expect(outcome.action.parameters[0]!.value).toBe(210);
    expect(outcome.action.parameters[0]!.unit).toBeUndefined();
  });
});

describe('resolveRelativeFactorDelta — NEVER-GUESS declines', () => {
  it('declines when the factor itself is a % factor (pp semantics preserved)', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5, unit: '%' }, 'increase'),
      makeGraphLookup({ value: 0.04, raw_value: 4, unit: '%', cap: 100 }),
    );
    expect(outcome.resolved).toBe(false);
  });

  it('declines when the factor has no recorded value', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5, unit: '%' }, 'increase'),
      makeGraphLookup(null),
    );
    expect(outcome.resolved).toBe(false);
  });

  it('declines when the existing value is ambiguous (raw-value-less % with odd cap)', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5, unit: '%' }, 'increase'),
      makeGraphLookup({ value: 5, unit: '%', cap: 50 }),
    );
    expect(outcome.resolved).toBe(false);
  });

  it('declines a signless string "5%" without a delta operator (set-to-5% is absolute)', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction('5%', 'set'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(false);
  });

  it('declines a structured percent with operator set (absolute unit mismatch, not relative)', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5, unit: '%' }, 'set'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(false);
  });

  it('declines multiply (RHS is already a scalar)', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5, unit: '%' }, 'multiply'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(false);
  });

  it('declines a decrease of more than 100%', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 150, unit: '%' }, 'decrease'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(false);
  });

  it('declines zero / negative / non-finite percent magnitudes', () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const outcome = resolveRelativeFactorDelta(
        makeAction({ value: bad, unit: '%' }, 'increase'),
        makeGraphLookup(POUND_FACTOR),
      );
      expect(outcome.resolved).toBe(false);
    }
  });

  it('declines a non-percent structured delta ("increase by £5,000" stays on the existing operator path)', () => {
    const outcome = resolveRelativeFactorDelta(
      makeAction({ value: 5000, unit: '£' }, 'increase'),
      makeGraphLookup(POUND_FACTOR),
    );
    expect(outcome.resolved).toBe(false);
  });

  it('declines non-set_factor_value handlers and non-node entities', () => {
    const other = {
      ...makeAction({ value: 5, unit: '%' }, 'increase'),
      handler_id: 'adjust_edge_strength',
    };
    expect(
      resolveRelativeFactorDelta(other as ProposalAction, makeGraphLookup(POUND_FACTOR)).resolved,
    ).toBe(false);
  });

  it('declines when the graph lookup has no findFactorObservedState', () => {
    const lookup: GraphLookup = {
      findEntityById: () => null,
      listEntitiesByKind: () => [],
    };
    expect(
      resolveRelativeFactorDelta(
        makeAction({ value: 5, unit: '%' }, 'increase'),
        lookup,
      ).resolved,
    ).toBe(false);
  });
});
