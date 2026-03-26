/**
 * Negative fixtures for prompt contract validation.
 *
 * Every test case here MUST be caught by the validation logic.
 * If any negative fixture passes validation, the validator has a gap.
 */

import { describe, it, expect } from 'vitest';
import {
  CANONICAL_NODE_FIELDS,
  CANONICAL_EDGE_FIELDS,
  FORBIDDEN_FIELDS,
  validateNodeFields,
  validateEdgeFields,
  validateEdgePath,
} from './canonical-fields.js';

// ---------------------------------------------------------------------------
// Edge field violations
// ---------------------------------------------------------------------------

describe('Negative fixtures: edge field violations', () => {
  it('rejects strength_mean (flat) on edge', () => {
    const edge = { from: 'a', to: 'b', strength_mean: 0.5, strength_std: 0.1, exists_probability: 0.8, effect_direction: 'positive' as const };
    const violations = validateEdgeFields(edge, 0, 'negative fixture');
    const fields = violations.map(v => v.field);
    expect(fields).toContain('strength_mean');
    expect(fields).toContain('strength_std');
  });

  it('rejects belief_exists on edge', () => {
    const edge = { from: 'a', to: 'b', belief_exists: 0.8, strength: { mean: 0.5, std: 0.1 } };
    const violations = validateEdgeFields(edge, 0, 'negative fixture');
    expect(violations.map(v => v.field)).toContain('belief_exists');
  });

  it('rejects belief on edge', () => {
    const edge = { from: 'a', to: 'b', belief: 0.8 };
    const violations = validateEdgeFields(edge, 0, 'negative fixture');
    expect(violations.map(v => v.field)).toContain('belief');
  });

  it('rejects confidence on edge', () => {
    const edge = { from: 'a', to: 'b', confidence: 0.9 };
    const violations = validateEdgeFields(edge, 0, 'negative fixture');
    expect(violations.map(v => v.field)).toContain('confidence');
  });

  it('rejects weight on edge', () => {
    const edge = { from: 'a', to: 'b', weight: 0.5 };
    const violations = validateEdgeFields(edge, 0, 'negative fixture');
    expect(violations.map(v => v.field)).toContain('weight');
  });

  it('rejects source/target (React Flow) on edge', () => {
    const edge = { source: 'a', target: 'b', from: 'a', to: 'b' };
    const violations = validateEdgeFields(edge, 0, 'negative fixture');
    const fields = violations.map(v => v.field);
    expect(fields).toContain('source');
    expect(fields).toContain('target');
  });
});

// ---------------------------------------------------------------------------
// Node field violations
// ---------------------------------------------------------------------------

describe('Negative fixtures: node field violations', () => {
  it('rejects data wrapper on option node (edit_graph context)', () => {
    const node = { id: 'opt_a', kind: 'option', label: 'Test', data: { interventions: {} } };
    const violations = validateNodeFields(node, 0, 'negative fixture', 'edit_graph');
    expect(violations.map(v => v.field)).toContain('data');
  });

  it('rejects data wrapper on controllable factor (edit_graph context)', () => {
    const node = {
      id: 'fac_a', kind: 'factor', label: 'Test', category: 'controllable',
      data: { value: 0.6, raw_value: 180000, unit: '£', cap: 300000 },
    };
    const violations = validateNodeFields(node, 0, 'negative fixture', 'edit_graph');
    expect(violations.map(v => v.field)).toContain('data');
  });

  it('accepts data wrapper on factor in draft_graph context (normaliser flattens)', () => {
    const node = {
      id: 'fac_a', kind: 'factor', label: 'Test', category: 'controllable',
      data: { value: 0.6 },
    };
    const violations = validateNodeFields(node, 0, 'negative fixture', 'draft_graph');
    expect(violations.map(v => v.field)).not.toContain('data');
  });

  it('rejects description on node (use body instead)', () => {
    const node = { id: 'fac_a', kind: 'factor', label: 'Test', description: 'A factor' };
    const violations = validateNodeFields(node, 0, 'negative fixture', 'edit_graph');
    expect(violations.map(v => v.field)).toContain('description');
  });
});

// ---------------------------------------------------------------------------
// Path format violations
// ---------------------------------------------------------------------------

describe('Negative fixtures: path format violations', () => {
  it('rejects :: separator in edge path', () => {
    const violations = validateEdgePath('fac_churn::out_revenue', 0, 'negative fixture');
    expect(violations).toHaveLength(1);
    expect(violations[0].field).toBe('::');
  });

  it('accepts -> separator in edge path', () => {
    const violations = validateEdgePath('fac_churn->out_revenue', 0, 'negative fixture');
    expect(violations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Intervention object violations
// ---------------------------------------------------------------------------

describe('Negative fixtures: intervention value as node update', () => {
  it('rejects intervention object fields as node-level fields', () => {
    // Simulates what PLoT sees after normaliseOperation processes
    // /nodes/opt_raise_price/data/interventions/fac_marketing_spend
    // with an object value (not scalar-wrapped)
    const interventionValue = { value: 0.25, raw_value: 25000, unit: '£', cap: 100000 };
    const violations = validateNodeFields(interventionValue, 0, 'intervention update', 'edit_graph');
    const fields = violations.map(v => v.field);
    expect(fields).toContain('value');
    expect(fields).toContain('raw_value');
    expect(fields).toContain('unit');
    expect(fields).toContain('cap');
  });
});

// ---------------------------------------------------------------------------
// M1: CEE normaliseEdgeValue breaks canonical format
// ---------------------------------------------------------------------------

describe('M1 [FIXED]: normaliseEdgeValue removed — canonical edges pass through unchanged', () => {
  it('canonical nested strength passes validation without flattening', () => {
    const canonicalEdge = {
      from: 'fac_a', to: 'out_b',
      strength: { mean: 0.5, std: 0.15 },
      exists_probability: 0.85,
      effect_direction: 'positive',
    };

    // After fix: canonical edges pass through without flattening
    const violations = validateEdgeFields(canonicalEdge, 0, 'M1 fix: canonical passthrough');
    expect(violations).toHaveLength(0);
  });

  it('the prompt teaches canonical format (nested strength) — prompt is correct', () => {
    const promptEdge = {
      from: 'fac_competitor_response', to: 'fac_churn',
      strength: { mean: 0.4, std: 0.20 },
      exists_probability: 0.70,
      effect_direction: 'positive',
    };
    const violations = validateEdgeFields(promptEdge, 0, 'edit_graph v6 Example 3');
    // No violations — the prompt teaches the RIGHT format
    expect(violations).toHaveLength(0);
  });

  it('flat strength_mean/strength_std still rejected by PLoT contract', () => {
    // Flat format should always be rejected
    const flatEdge = {
      from: 'a', to: 'b',
      strength_mean: 0.4, strength_std: 0.20,
      exists_probability: 0.70,
      effect_direction: 'positive',
    };
    const violations = validateEdgeFields(flatEdge, 0, 'M1 regression guard');
    expect(violations.some(v => v.field === 'strength_mean')).toBe(true);
    expect(violations.some(v => v.field === 'strength_std')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Forbidden fields inventory check
// ---------------------------------------------------------------------------

describe('FORBIDDEN_FIELDS inventory is consistent with canonical sets', () => {
  it('every forbidden node field is NOT in CANONICAL_NODE_FIELDS', () => {
    for (const [field, entry] of Object.entries(FORBIDDEN_FIELDS)) {
      if (entry.entity === 'node') {
        expect(
          CANONICAL_NODE_FIELDS.has(field),
          `FORBIDDEN_FIELDS lists "${field}" as forbidden node field, but it IS in CANONICAL_NODE_FIELDS`,
        ).toBe(false);
      }
    }
  });

  it('every forbidden edge field is NOT in CANONICAL_EDGE_FIELDS', () => {
    for (const [field, entry] of Object.entries(FORBIDDEN_FIELDS)) {
      if (entry.entity === 'edge') {
        expect(
          CANONICAL_EDGE_FIELDS.has(field),
          `FORBIDDEN_FIELDS lists "${field}" as forbidden edge field, but it IS in CANONICAL_EDGE_FIELDS`,
        ).toBe(false);
      }
    }
  });
});
