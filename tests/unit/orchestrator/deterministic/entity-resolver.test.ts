/**
 * Entity Resolver Tests
 */

import { describe, it, expect } from "vitest";
import { resolveEntity, levenshteinDistance } from "../../../../src/orchestrator/deterministic/entity-resolver.js";
import type { EntityRegistry, EntityEntry } from "../../../../src/orchestrator/deterministic/types.js";

function makeRegistry(): EntityRegistry {
  const nodes = new Map<string, EntityEntry>([
    ['factor_revenue', {
      id: 'factor_revenue', label: 'Revenue Growth', kind: 'factor',
      aliases: ['revenue', 'growth', 'rev'], category: 'observable',
      is_action_target: false, value: 100000, unit: 'GBP',
    }],
    ['factor_cost', {
      id: 'factor_cost', label: 'Customer Acquisition Cost', kind: 'factor',
      aliases: ['customer', 'acquisition', 'cost', 'cust'],
      is_action_target: false, value: 50000,
    }],
    ['factor_retention', {
      id: 'factor_retention', label: 'Retention Rate', kind: 'factor',
      aliases: ['retention', 'rate'],
      is_action_target: false, value: 0.85,
    }],
    ['option_a', {
      id: 'option_a', label: 'Expand Marketing', kind: 'option',
      aliases: ['expand', 'marketing'], is_action_target: true,
    }],
  ]);

  return {
    nodes,
    edges: [],
    option_ids: ['option_a'],
    goal_id: null,
  };
}

describe('resolveEntity', () => {
  const registry = makeRegistry();

  it('resolves exact ID match (confidence 1.0)', () => {
    const result = resolveEntity('factor_revenue', registry, 'none');
    expect(result.status).toBe('resolved');
    expect(result.entity!.id).toBe('factor_revenue');
    expect(result.confidence).toBe(1.0);
  });

  it('resolves exact label match (case-insensitive)', () => {
    const result = resolveEntity('revenue growth', registry, 'none');
    expect(result.status).toBe('resolved');
    expect(result.entity!.id).toBe('factor_revenue');
    expect(result.confidence).toBe(1.0);
  });

  it('resolves alias match (confidence 0.9)', () => {
    const result = resolveEntity('rev', registry, 'none');
    expect(result.status).toBe('resolved');
    expect(result.entity!.id).toBe('factor_revenue');
    expect(result.confidence).toBe(0.9);
  });

  it('resolves fuzzy match (confidence 0.7-0.8)', () => {
    const result = resolveEntity('retenton rate', registry, 'none');
    expect(result.status).toBe('resolved');
    expect(result.confidence).toBeGreaterThanOrEqual(0.7);
    expect(result.confidence).toBeLessThanOrEqual(0.8);
  });

  it('returns not_found for unknown reference', () => {
    const result = resolveEntity('completely unknown thing', registry, 'none');
    expect(result.status).toBe('not_found');
    expect(result.confidence).toBe(0);
  });

  it('enforces threshold for high risk', () => {
    // Alias match gives 0.9 confidence — not enough for 'high' (threshold 1.0)
    const result = resolveEntity('rev', registry, 'high');
    expect(result.status).toBe('ambiguous');
    expect(result.candidates!.length).toBeGreaterThan(0);
  });

  it('allows alias match for low risk (threshold 0.9)', () => {
    const result = resolveEntity('rev', registry, 'low');
    expect(result.status).toBe('resolved');
    expect(result.entity!.id).toBe('factor_revenue');
  });

  it('returns ambiguous for empty reference', () => {
    const result = resolveEntity('', registry, 'none');
    expect(result.status).toBe('not_found');
  });
});

describe('levenshteinDistance', () => {
  it('returns 0 for identical strings', () => {
    expect(levenshteinDistance('hello', 'hello')).toBe(0);
  });

  it('returns correct distance for single edit', () => {
    expect(levenshteinDistance('kitten', 'sitten')).toBe(1);
  });

  it('returns correct distance for multiple edits', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
  });

  it('handles empty strings', () => {
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});
