/**
 * COLLAB — THE MODEL'S OWN NUMBER MUST REACH THE REVEAL.
 *
 * ── WHAT WAS DARK, AND WHY EVERY SUITE WAS GREEN ──────────────────────────
 * `getModelValuesAtVersion` read `node.value`. Nothing writes a top-level
 * `node.value`: `NodeV3` (`schemas/cee-v3.ts:156-285`) does not declare one and
 * strips undeclared keys, and the canonical carrier is `observed_state.value`.
 * So the function returned null for every target on every real graph, and the
 * three surfaces written to say "The model held X for this when the round
 * opened" — the participant reveal, the disagreement view, and CEE's own digest
 * line — are all gated on that null and had therefore NEVER rendered.
 *
 * The existing collab suites could not see it because **both of them mock this
 * method**: `apply-verification.test.ts:165` forbids it outright and
 * `disagreement-and-evidence.test.ts:206` substitutes `{ [TARGET_ID]: 0.5 }`.
 * A stub that returns the value the real function cannot produce is a green
 * suite testifying about a function it never calls (CLAUDE.md trap 16 — the
 * grep finds the symbol, the live chain never reaches it). These tests drive
 * the REAL `SupabaseCollabStore` against a REAL-SHAPED stored graph.
 *
 * ── THE BINDING ───────────────────────────────────────────────────────────
 * Values are distinct per node and asserted per node id, so a reader that
 * returned the first node's number for everything, or scored the right count
 * with the wrong attribution, goes red. The absent case is asserted as `null`
 * BY IDENTITY — never as falsy — because `0` is a legitimate model value and a
 * truthiness check would conflate "the model held zero" with "the model held
 * nothing", which is the exact claim this field must never make.
 */

import { describe, it, expect } from 'vitest';

import { SupabaseCollabStore, readNodeValue } from '../store.js';

const VERSION = 'mv-11111111-1111-4111-8111-111111111111';

/** A `model_versions` row stub: `.from().select().eq().maybeSingle()`. */
function dbWithGraph(graph: unknown, error: { message: string } | null = null): never {
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({ data: error === null ? { graph } : null, error }),
  };
  return { from: () => chain } as never;
}

function store(graph: unknown): SupabaseCollabStore {
  return new SupabaseCollabStore(dbWithGraph(graph));
}

/**
 * A node as the canonical writer actually emits one: the number lives in
 * `observed_state.value`, and `display_value` is a formatted STRING beside it.
 */
function canonicalNode(id: string, value: number, display?: string) {
  return {
    id,
    kind: 'factor',
    label: `Label for ${id}`,
    observed_state: { value, unit: 'probability', source: 'cee_inference' },
    ...(display === undefined ? {} : { display_value: display }),
  };
}

describe('getModelValuesAtVersion reads the value where the writer actually puts it', () => {
  it('⭐ THE DEFECT: reads observed_state.value for every requested target', async () => {
    const graph = {
      nodes: [
        canonicalNode('fac_churn_risk', 0.35),
        canonicalNode('fac_price_sensitivity', 0.72),
        canonicalNode('fac_not_asked_about', 0.99),
      ],
    };

    const out = await store(graph).getModelValuesAtVersion(VERSION, [
      'fac_churn_risk',
      'fac_price_sensitivity',
    ]);

    // Per-id, and the two numbers differ — a reader that returned the first
    // node's value for both would pass a "not null" assertion and fail this.
    expect(out).toEqual({ fac_churn_risk: 0.35, fac_price_sensitivity: 0.72 });
    // A node nobody asked about is not smuggled into the answer.
    expect(Object.keys(out).sort()).toEqual(['fac_churn_risk', 'fac_price_sensitivity']);
  });

  it('a target the graph has no node for stays null — never 0, never absent', async () => {
    const out = await store({ nodes: [canonicalNode('fac_churn_risk', 0.35)] }).getModelValuesAtVersion(
      VERSION,
      ['fac_churn_risk', 'fac_missing'],
    );

    expect(out.fac_missing).toBeNull();
    // BY IDENTITY, not falsiness: `0` is a real value and must not read as absent.
    expect(Object.prototype.hasOwnProperty.call(out, 'fac_missing')).toBe(true);
  });

  it('a genuine zero survives as 0, not as null', async () => {
    const out = await store({ nodes: [canonicalNode('fac_churn_risk', 0)] }).getModelValuesAtVersion(
      VERSION,
      ['fac_churn_risk'],
    );

    expect(out.fac_churn_risk).toBe(0);
    expect(out.fac_churn_risk).not.toBeNull();
  });

  it('a node with no observed_state at all stays null', async () => {
    const out = await store({
      nodes: [{ id: 'fac_churn_risk', kind: 'factor', label: 'Churn risk' }],
    }).getModelValuesAtVersion(VERSION, ['fac_churn_risk']);

    expect(out.fac_churn_risk).toBeNull();
  });

  it('a historic graph carrying a top-level node.value is still read', async () => {
    const out = await store({
      nodes: [{ id: 'fac_churn_risk', kind: 'factor', label: 'Churn risk', value: 0.41 }],
    }).getModelValuesAtVersion(VERSION, ['fac_churn_risk']);

    expect(out.fac_churn_risk).toBe(0.41);
  });

  it('observed_state.value wins over a stale top-level value on the same node', async () => {
    const out = await store({
      nodes: [{ ...canonicalNode('fac_churn_risk', 0.35), value: 0.99 }],
    }).getModelValuesAtVersion(VERSION, ['fac_churn_risk']);

    expect(out.fac_churn_risk).toBe(0.35);
  });

  it('a missing version row yields nulls, not a throw', async () => {
    const out = await new SupabaseCollabStore(
      dbWithGraph(null, { message: 'no such row' }),
    ).getModelValuesAtVersion(VERSION, ['fac_churn_risk']);

    expect(out).toEqual({ fac_churn_risk: null });
  });
});

describe('display_value is a formatted string and must never become the number', () => {
  /**
   * ⚠ THE FABRICATION THIS REFUSES. `NodeV3.display_value` is
   * `z.string().optional()` — "£40,000", "18 months". Reading it into a
   * `number | null` slot would put a number on screen that no producer
   * asserted. It is excluded on purpose, and the exclusion is pinned so a
   * later "helpful" fallback goes red rather than shipping quietly.
   */
  it('a node whose ONLY value-ish field is display_value reads as null', () => {
    expect(
      readNodeValue({ id: 'fac_x', kind: 'factor', label: 'X', display_value: '£40,000' }),
    ).toBeNull();
  });

  it('display_value does not override the real number beside it', () => {
    expect(readNodeValue(canonicalNode('fac_x', 0.35, '35%'))).toBe(0.35);
  });
});

describe('readNodeValue refuses everything that is not a finite number', () => {
  it.each([
    ['a string in observed_state.value', { observed_state: { value: '0.35' } }],
    ['null in observed_state.value', { observed_state: { value: null } }],
    ['NaN', { observed_state: { value: Number.NaN } }],
    ['Infinity', { observed_state: { value: Number.POSITIVE_INFINITY } }],
    ['observed_state is null', { observed_state: null }],
    ['observed_state is a string', { observed_state: 'nope' }],
    ['the node is null', null],
    ['the node is a string', 'nope'],
  ])('%s → null', (_label, node) => {
    expect(readNodeValue(node)).toBeNull();
  });
});
