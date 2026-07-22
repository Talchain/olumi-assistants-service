/**
 * Context-audit #1 (CONTEXT-SYSTEM-AUDIT-2026-07-22) — conformance for
 * `summariseMutation`'s dispatch (keep-list inventory row #4).
 *
 * The silent-drop risk: a new handler emits a `fact_type` that
 * `summariseMutation` has no branch for, so the mutation never appears in
 * "what just changed" and no test notices.
 *
 * The fact_type set is DERIVED from the source of truth — the
 * `HandlerFactSchema` discriminated union in `@talchain/schemas/orchestrator`,
 * not a hand list. The test asserts receipt ∪ skip == that set EXACTLY, and
 * BINDS both sets to the real `projectRecentChanges` behaviour so the
 * declarative constants can never drift into a lie about the dispatch.
 */

import { describe, it, expect } from 'vitest';

import { HandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  MUTATION_RECEIPT_FACT_TYPES,
  MUTATION_DISPATCH_SKIP,
  projectRecentChanges,
} from '../recent-changes.js';

type FactType = HandlerFact['fact_type'];

const sorted = (values: Iterable<string>): string[] => [...values].sort();

/** Source of truth: the discriminated-union discriminator literals. */
const SCHEMA_FACT_TYPES: FactType[] = HandlerFactSchema.options.map(
  (member) => member.shape.fact_type.value,
);

/**
 * Test-only fact coercion. `projectRecentChanges` reads only `fact_type`,
 * `fact.noop` (via `isNoopFact`), and `fact.result`; full schema validity is
 * not required to exercise the dispatch branch.
 */
function makeFact(factType: FactType, result: Record<string, unknown>): HandlerFact {
  return {
    fact_type: factType,
    fact_version: 1,
    noop: false,
    result,
  } as unknown as HandlerFact;
}

/**
 * A `result` shape per receipt fact_type that makes its `summariseMutation`
 * branch produce a real receipt (the positive control for the receipt path).
 */
const RECEIPT_FIXTURES: Record<string, Record<string, unknown>> = {
  add_constraint: { after: { operator: '>=', value: 5, label: 'Total cost' } },
  set_factor_value: {
    before: { raw_value: 1, label: 'Customer churn' },
    after: { raw_value: 2, label: 'Customer churn' },
  },
  adjust_edge_strength: {},
  edit_graph: {
    status: 'applied',
    safe_summary: 'Renamed a factor in the decision model.',
    affected_entities: [{ label: 'Total cost' }],
  },
};

describe('summariseMutation dispatch — conformance (context-audit #1 row #4)', () => {
  it('the fact_type enumeration is non-empty and covers the known types', () => {
    // Guard against a vacuous pass: a broken enumeration returning [] would
    // make the completeness assertion below trivially true.
    expect(SCHEMA_FACT_TYPES.length).toBeGreaterThanOrEqual(10);
    expect(SCHEMA_FACT_TYPES).toContain('run_analysis');
    expect(SCHEMA_FACT_TYPES).toContain('edit_graph');
  });

  it('receipt ∪ skip == the schema fact_type set, EXACTLY', () => {
    const classified = new Set<string>([
      ...MUTATION_RECEIPT_FACT_TYPES,
      ...MUTATION_DISPATCH_SKIP.keys(),
    ]);
    expect(sorted(classified)).toEqual(sorted(SCHEMA_FACT_TYPES));
  });

  it('receipt and skip are disjoint (a type is surfaced xor skipped)', () => {
    const both = [...MUTATION_RECEIPT_FACT_TYPES].filter((t) => MUTATION_DISPATCH_SKIP.has(t));
    expect(both).toEqual([]);
  });

  it('every classified fact_type is a real schema discriminator (no phantom)', () => {
    const schema = new Set<string>(SCHEMA_FACT_TYPES);
    for (const t of MUTATION_RECEIPT_FACT_TYPES) {
      expect(schema.has(t), `${t} in receipt set but not in schema`).toBe(true);
    }
    for (const t of MUTATION_DISPATCH_SKIP.keys()) {
      expect(schema.has(t), `${t} in skip set but not in schema`).toBe(true);
    }
  });

  it('every skip entry carries a non-empty reason', () => {
    for (const [t, reason] of MUTATION_DISPATCH_SKIP) {
      expect(reason.trim().length, `${t} has an empty skip reason`).toBeGreaterThan(0);
    }
  });

  it('BINDING — every receipt fact_type actually produces a receipt entry', () => {
    for (const t of MUTATION_RECEIPT_FACT_TYPES) {
      const fixture = RECEIPT_FIXTURES[t];
      expect(fixture, `no receipt fixture for ${t}`).toBeDefined();
      const out = projectRecentChanges([makeFact(t, fixture)]);
      expect(out.length, `${t} should produce a recent-change receipt`).toBe(1);
    }
  });

  it('BINDING — every skip fact_type produces NO receipt entry', () => {
    for (const t of MUTATION_DISPATCH_SKIP.keys()) {
      const out = projectRecentChanges([makeFact(t, {})]);
      expect(out.length, `${t} should NOT produce a recent-change receipt`).toBe(0);
    }
  });

  it('POSITIVE CONTROL — completeness SEES a new, unclassified fact_type', () => {
    // Simulate a schema growing a mutation type nobody classified.
    const augmented = [...SCHEMA_FACT_TYPES, 'brand_new_mutation'];
    const classified = new Set<string>([
      ...MUTATION_RECEIPT_FACT_TYPES,
      ...MUTATION_DISPATCH_SKIP.keys(),
    ]);
    expect(sorted(augmented)).not.toEqual(sorted(classified));
    const unclassified = augmented.filter((t) => !classified.has(t));
    expect(unclassified).toContain('brand_new_mutation');
  });
});
