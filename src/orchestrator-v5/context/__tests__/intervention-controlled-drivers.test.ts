import { describe, it, expect } from 'vitest';

import {
  collectInterventionControlledFactorIds,
  isInterventionControlledDriver,
  partitionInterventionControlledDrivers,
} from '../intervention-controlled-drivers.js';
import type { DriverSummary } from '../../../orchestrator/context/analysis-compact.js';

const driver = (
  factor_id: string,
  factor_label: string,
  sensitivity = 0.5,
): DriverSummary => ({
  factor_id,
  factor_label,
  sensitivity,
  direction: 'negative',
});

describe('collectInterventionControlledFactorIds', () => {
  it('collects factor ids from an option node top-level interventions bundle', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_a',
          kind: 'option',
          interventions: { fac_price: { value: 10 }, fac_capacity: { value: 5 } },
        },
        { id: 'fac_price', kind: 'factor' },
      ],
    };
    const set = collectInterventionControlledFactorIds(graph);
    expect(set.has('fac_price')).toBe(true);
    expect(set.has('fac_capacity')).toBe(true);
    expect(set.size).toBe(2);
  });

  it('reads the data.interventions location with precedence over top-level', () => {
    const graph = {
      nodes: [
        {
          id: 'opt_a',
          kind: 'option',
          data: { interventions: { fac_speed: { value: 3 } } },
          interventions: { fac_ignored: {} },
        },
      ],
    };
    const set = collectInterventionControlledFactorIds(graph);
    expect(set.has('fac_speed')).toBe(true);
    expect(set.has('fac_ignored')).toBe(false);
  });

  it('collects from the canonical options[] array', () => {
    const graph = {
      nodes: [],
      options: [{ id: 'opt_a', interventions: { fac_cost: { value: 1 } } }],
    };
    expect(collectInterventionControlledFactorIds(graph).has('fac_cost')).toBe(true);
  });

  it('unions controlled ids across multiple options', () => {
    const graph = {
      nodes: [
        { id: 'opt_a', kind: 'option', interventions: { fac_x: {} } },
        { id: 'opt_b', kind: 'option', interventions: { fac_y: {} } },
      ],
    };
    expect([...collectInterventionControlledFactorIds(graph)].sort()).toEqual([
      'fac_x',
      'fac_y',
    ]);
  });

  it('ignores non-option nodes even if they carry an interventions key', () => {
    const graph = {
      nodes: [{ id: 'fac_price', kind: 'factor', interventions: { fac_nope: {} } }],
    };
    expect(collectInterventionControlledFactorIds(graph).size).toBe(0);
  });

  it('returns empty for missing or empty intervention bundles without throwing', () => {
    expect(
      collectInterventionControlledFactorIds({ nodes: [{ id: 'opt_a', kind: 'option' }] }).size,
    ).toBe(0);
    expect(
      collectInterventionControlledFactorIds({
        nodes: [{ id: 'opt_a', kind: 'option', interventions: {} }],
      }).size,
    ).toBe(0);
  });

  it('is defensive against malformed intervention bundles (null/array/scalar)', () => {
    for (const bad of [null, ['x'], 42, 'nope']) {
      const graph = { nodes: [{ id: 'o', kind: 'option', interventions: bad }] };
      expect(collectInterventionControlledFactorIds(graph).size).toBe(0);
    }
  });

  it('returns empty for a non-object / null graph', () => {
    expect(collectInterventionControlledFactorIds(null).size).toBe(0);
    expect(collectInterventionControlledFactorIds(undefined).size).toBe(0);
    expect(collectInterventionControlledFactorIds([]).size).toBe(0);
    expect(collectInterventionControlledFactorIds('graph').size).toBe(0);
  });
});

describe('isInterventionControlledDriver', () => {
  const controlled = new Set(['fac_price']);

  it('is true when the driver factor_id is controlled', () => {
    expect(isInterventionControlledDriver(driver('fac_price', 'Price'), controlled)).toBe(true);
  });

  it('is false when the driver factor_id is not controlled', () => {
    expect(isInterventionControlledDriver(driver('fac_market', 'Market'), controlled)).toBe(false);
  });

  it('is false for an empty controlled set', () => {
    expect(isInterventionControlledDriver(driver('fac_price', 'Price'), new Set())).toBe(false);
  });

  it('is false for an empty / whitespace factor_id', () => {
    expect(isInterventionControlledDriver(driver('   ', 'Blank'), controlled)).toBe(false);
    expect(isInterventionControlledDriver({ factor_id: '' } as DriverSummary, controlled)).toBe(false);
  });

  it('does NOT match by label when the id differs (id is the only authority)', () => {
    // Same human label "Price" but a different structural id → not controlled.
    expect(isInterventionControlledDriver(driver('fac_price_external', 'Price'), controlled)).toBe(false);
  });
});

describe('partitionInterventionControlledDrivers', () => {
  const controlled = new Set(['fac_price']);

  it('removes controlled drivers and preserves the order of the kept', () => {
    const drivers = [
      driver('fac_market', 'Market'),
      driver('fac_price', 'Price'),
      driver('fac_team', 'Team'),
    ];
    const { kept, suppressed } = partitionInterventionControlledDrivers(drivers, controlled);
    expect(kept.map((d) => d.factor_id)).toEqual(['fac_market', 'fac_team']);
    expect(suppressed.map((d) => d.factor_id)).toEqual(['fac_price']);
  });

  it('returns an empty kept list when every driver is controlled', () => {
    const { kept, suppressed } = partitionInterventionControlledDrivers(
      [driver('fac_price', 'Price')],
      controlled,
    );
    expect(kept).toEqual([]);
    expect(suppressed).toHaveLength(1);
  });

  it('keeps every driver when the controlled set is empty', () => {
    const { kept, suppressed } = partitionInterventionControlledDrivers(
      [driver('fac_price', 'Price')],
      new Set(),
    );
    expect(kept).toHaveLength(1);
    expect(suppressed).toHaveLength(0);
  });

  it('does not suppress a label collision with a different id', () => {
    const { kept, suppressed } = partitionInterventionControlledDrivers(
      [driver('fac_price_external', 'Price')],
      controlled,
    );
    expect(kept).toHaveLength(1);
    expect(suppressed).toHaveLength(0);
  });

  it('does not mutate the input drivers array', () => {
    const drivers = [driver('fac_price', 'Price'), driver('fac_market', 'Market')];
    const snapshot = JSON.parse(JSON.stringify(drivers));
    partitionInterventionControlledDrivers(drivers, controlled);
    expect(drivers).toEqual(snapshot);
  });
});
