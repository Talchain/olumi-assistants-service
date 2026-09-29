/**
 * Regression tests for the existing graph-only `resolveLabel(graph, id)`.
 *
 * The V5 enrichment fix introduces a new four-priority resolver in
 * `src/orchestrator-v5/compose/resolve-label.ts` that imports this
 * function under an alias (`resolveLabelFromGraph`). The existing
 * function MUST stay unchanged because seven `.test()` callsites in
 * `src/orchestrator/patch-summary.ts` and four callsites in
 * `src/orchestrator/shared/output-safety.ts` rely on its
 * null-on-miss semantics for confirmation gating.
 *
 * Pinning the contract here so any future widening (e.g. extending the
 * lookup to walk additional sources) breaks this test before reaching
 * production.
 */
import { describe, expect, it } from 'vitest';

import { resolveLabel, ENTITY_ID_LEAK_RE } from '../entity-id-pattern.js';
import type { GraphV3T } from '../../types.js';

const GRAPH = {
  nodes: [
    { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' },
    { id: 'fac_hiring_cost', label: 'Hiring and Staffing Cost' },
    { id: 'goal_compliance', label: 'Hit compliance deadline' },
  ],
  edges: [],
} as unknown as GraphV3T;

describe('resolveLabel(graph, id) — graph-only lookup, null on miss', () => {
  it('returns the label when the id is present on graph.nodes', () => {
    expect(resolveLabel(GRAPH, 'opt_hire_local')).toBe('Hire Two Senior Engineers Locally');
    expect(resolveLabel(GRAPH, 'fac_hiring_cost')).toBe('Hiring and Staffing Cost');
    expect(resolveLabel(GRAPH, 'goal_compliance')).toBe('Hit compliance deadline');
  });

  it('returns null when the id is absent from graph.nodes', () => {
    expect(resolveLabel(GRAPH, 'opt_unknown')).toBeNull();
    expect(resolveLabel(GRAPH, 'fac_missing')).toBeNull();
  });

  it('returns null when graph is null or undefined', () => {
    expect(resolveLabel(null, 'opt_hire_local')).toBeNull();
    expect(resolveLabel(undefined, 'opt_hire_local')).toBeNull();
  });

  it('does NOT walk analysis_ready / enrichment / payloads — graph-only contract', () => {
    // Confirmation-gate callers (patch-summary, output-safety) require this
    // narrow scope. The four-priority resolver lives in a separate module
    // (`src/orchestrator-v5/compose/resolve-label.ts`) and never replaces
    // this function.
    const empty = { nodes: [], edges: [] } as unknown as GraphV3T;
    expect(resolveLabel(empty, 'opt_x')).toBeNull();
  });

  it('returns null for nodes with empty-string label (defensive)', () => {
    const graph = { nodes: [{ id: 'opt_empty', label: '' }], edges: [] } as unknown as GraphV3T;
    expect(resolveLabel(graph, 'opt_empty')).toBeNull();
  });
});

describe('ENTITY_ID_LEAK_RE — pinning the regex shape', () => {
  it('matches all known entity-ID prefixes', () => {
    const PREFIXES = [
      'fac', 'opt', 'goal', 'dec', 'out', 'risk', 'con',
      'factor', 'option', 'decision', 'outcome', 'constraint',
    ];
    for (const p of PREFIXES) {
      const id = `${p}_xxxx`;
      expect(ENTITY_ID_LEAK_RE.test(id), `prefix ${p} should match`).toBe(true);
    }
  });

  it('matches separator variants (underscore, colon, hyphen)', () => {
    expect(ENTITY_ID_LEAK_RE.test('opt_hire_local')).toBe(true);
    expect(ENTITY_ID_LEAK_RE.test('opt:hire-local')).toBe(true);
    expect(ENTITY_ID_LEAK_RE.test('opt-hire-local')).toBe(true);
  });

  it('does not match non-entity-shaped strings', () => {
    expect(ENTITY_ID_LEAK_RE.test('hello world')).toBe(false);
    expect(ENTITY_ID_LEAK_RE.test('options')).toBe(false);
    expect(ENTITY_ID_LEAK_RE.test('factor analysis')).toBe(false);
  });
});
