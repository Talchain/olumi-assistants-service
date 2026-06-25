/**
 * EP2 readiness-core fixtures + unit tests (V5 Edit Safety Core, Phase 1).
 *
 * Fixtures are the golden contract from the EP2 brief §10: a complete, schema-
 * validated BASE (proven `analysis_ready` before any mutation) plus F1–F7 as
 * isolated single-condition mutations. Each test asserts the neutral-core result
 * AND the EP2 adapter state. BASE was validated against the real GraphV3 /
 * validateGraphStructure (brief §10 BASE-validation note).
 */
import { describe, it, expect } from 'vitest';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { validateGraphStructure } from '../../../../orchestrator/graph-structure-validator.js';
import {
  assessAnalysisReadiness,
  canonicaliseForAnalysis,
  ep2State,
} from '../analysis-ready-core.js';

type Dict = Record<string, unknown>;

/** Corrected, schema-valid BASE (EP2 brief §10) — also Fixture 5. */
function makeBase(): Dict {
  return {
    goal_node_id: 'goal_1', // sibling; GraphV3.safeParse strips it (#265). goal_node comes from the goal node.
    nodes: [
      { id: 'goal_1', kind: 'goal', label: 'Maximise outcome', goal_threshold: 0.5 },
      { id: 'dec_1', kind: 'decision', label: 'Choose approach' },
      { id: 'fac_annual_cost', kind: 'factor', label: 'Annual cost', observed_state: { value: 0.6, unit: '£', cap: 150000 } },
      { id: 'opt_hybrid', kind: 'option', label: 'Hybrid', interventions: { fac_annual_cost: { value: 0.8, source: 'user_specified' } } },
      { id: 'opt_status_quo', kind: 'option', label: 'Status quo', is_baseline: true, interventions: {} },
    ],
    edges: [
      { from: 'dec_1', to: 'opt_hybrid', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'dec_1', to: 'opt_status_quo', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'opt_hybrid', to: 'fac_annual_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'opt_status_quo', to: 'fac_annual_cost', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'fac_annual_cost', to: 'goal_1', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
    ],
  };
}

function nodeById(graph: unknown, id: string): Dict | undefined {
  const nodes = (graph as Dict)?.nodes as Dict[] | undefined;
  return Array.isArray(nodes) ? nodes.find((n) => n.id === id) : undefined;
}
function optionValue(graph: unknown, optId: string, fac: string): number | undefined {
  const iv = (nodeById(graph, optId)?.interventions as Dict | undefined)?.[fac] as Dict | undefined;
  const v = iv?.value;
  return typeof v === 'number' ? v : undefined;
}

describe('EP2 readiness core — BASE validity (brief §10 BASE-validation)', () => {
  it('BASE passes GraphV3.safeParse and validateGraphStructure with no violations', () => {
    const parsed = GraphV3.safeParse(makeBase());
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const struct = validateGraphStructure(parsed.data);
      expect(struct.violations).toEqual([]);
      expect(struct.valid).toBe(true);
    }
  });

  it('Fixture 5 / BASE → analysis_ready / ready (idempotent canonicalisation, no repair)', () => {
    const base = makeBase();
    const r = assessAnalysisReadiness(base);
    expect(r.status).toBe('analysis_ready');
    expect(ep2State(r)).toBe('ready');
    expect(r.safeToAnalyse).toBe(true);
    expect(r.userActionRequired).toBe(false);
    // canonical is the original reference (nothing to promote) → idempotent no-op.
    expect(canonicaliseForAnalysis(base)).toBe(base);
  });
});

describe('EP2 readiness core — repaired (value-preserving)', () => {
  it('F1 broken frontend shape (node.data.interventions) → repaired, value 0.8 = 120000/150000', () => {
    const g = makeBase();
    (nodeById(g, 'opt_hybrid') as Dict).interventions = undefined;
    delete (nodeById(g, 'opt_hybrid') as Dict).interventions;
    (nodeById(g, 'opt_hybrid') as Dict).data = { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } };
    const r = assessAnalysisReadiness(g);
    expect(r.status).toBe('repaired');
    expect(ep2State(r)).toBe('repaired_for_analysis');
    expect(r.safeToAnalyse).toBe(true);
    expect(optionValue(r.canonicalGraph, 'opt_hybrid', 'fac_annual_cost')).toBeCloseTo(0.8, 10);
  });

  it('F2 top-level raw-only → repaired, value 0.9 = 135000/150000', () => {
    const g = makeBase();
    (nodeById(g, 'opt_hybrid') as Dict).interventions = { fac_annual_cost: { unit: '£', raw_value: 135000 } };
    const r = assessAnalysisReadiness(g);
    expect(r.status).toBe('repaired');
    expect(ep2State(r)).toBe('repaired_for_analysis');
    expect(optionValue(r.canonicalGraph, 'opt_hybrid', 'fac_annual_cost')).toBeCloseTo(0.9, 10);
  });
});

describe('EP2 readiness core — unrecoverable (no guessed values)', () => {
  it('F3 missing cap → unrecoverable / blocked, NO_CAP_UNRECOVERABLE, no canonical graph', () => {
    const g = makeBase();
    (nodeById(g, 'fac_annual_cost') as Dict).observed_state = { value: 0.6, unit: '£' }; // cap removed
    delete (nodeById(g, 'opt_hybrid') as Dict).interventions;
    (nodeById(g, 'opt_hybrid') as Dict).data = { interventions: { fac_annual_cost: { raw_value: 120000 } } };
    const r = assessAnalysisReadiness(g);
    expect(r.status).toBe('unrecoverable');
    expect(ep2State(r)).toBe('blocked');
    expect(r.reasonCodes).toContain('NO_CAP_UNRECOVERABLE');
    expect(r.reasonCategory).toBe('option_values');
    expect(r.canonicalGraph).toBeNull();
    expect(r.userActionRequired).toBe(true);
    expect(typeof r.nextStep).toBe('string');
  });

  it('F4 unit mismatch → unrecoverable / blocked, UNIT_MISMATCH', () => {
    const g = makeBase();
    (nodeById(g, 'opt_hybrid') as Dict).interventions = { fac_annual_cost: { unit: 'agents', raw_value: 5 } };
    const r = assessAnalysisReadiness(g);
    expect(r.status).toBe('unrecoverable');
    expect(ep2State(r)).toBe('blocked');
    expect(r.reasonCodes).toContain('UNIT_MISMATCH');
    expect(r.canonicalGraph).toBeNull();
  });
});

describe('EP2 readiness core — blocked structure (F7) + isolation', () => {
  it('F7a cycle → unrecoverable / blocked, CYCLE_DETECTED', () => {
    const g = makeBase();
    (g.nodes as Dict[]).push({ id: 'fac_b', kind: 'factor', label: 'B', observed_state: { value: 0.4 } });
    (g.edges as Dict[]).push(
      { from: 'fac_annual_cost', to: 'fac_b', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1.0, effect_direction: 'positive' },
      { from: 'fac_b', to: 'fac_annual_cost', strength: { mean: 0.3, std: 0.1 }, exists_probability: 1.0, effect_direction: 'positive' },
    );
    const r = assessAnalysisReadiness(g);
    expect(r.status).toBe('unrecoverable');
    expect(ep2State(r)).toBe('blocked');
    expect(r.reasonCodes).toContain('CYCLE_DETECTED');
    expect(r.reasonCategory).toBe('graph_structure');
  });

  it('isolation: BASE-minus-each-mutation is analysis_ready (the mutation is the sole cause)', () => {
    // BASE before F1's mutation is just BASE → ready. (Proves F1 reasonCode is caused only by the mutation.)
    expect(assessAnalysisReadiness(makeBase()).status).toBe('analysis_ready');
  });
});

describe('EP2 readiness core — F6 freshness/canonical idempotency', () => {
  it('canonicaliseForAnalysis is idempotent on a repaired (F1) graph; value-change shifts the projection', () => {
    const g = makeBase();
    delete (nodeById(g, 'opt_hybrid') as Dict).interventions;
    (nodeById(g, 'opt_hybrid') as Dict).data = { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } };
    const once = canonicaliseForAnalysis(g);
    const twice = canonicaliseForAnalysis(once);
    expect(optionValue(once, 'opt_hybrid', 'fac_annual_cost')).toBeCloseTo(0.8, 10);
    // idempotent: re-canonicalising an already-canonical graph yields the same projection (and no further change).
    expect(JSON.stringify(twice)).toBe(JSON.stringify(once));
    expect(optionValue(twice, 'opt_hybrid', 'fac_annual_cost')).toBeCloseTo(0.8, 10);

    // value-change perturbation shifts the projected value (→ a different analysis-affecting hash).
    const g2 = makeBase();
    delete (nodeById(g2, 'opt_hybrid') as Dict).interventions;
    (nodeById(g2, 'opt_hybrid') as Dict).data = { interventions: { fac_annual_cost: { unit: '£', raw_value: 130000 } } };
    const c2 = canonicaliseForAnalysis(g2);
    expect(optionValue(c2, 'opt_hybrid', 'fac_annual_cost')).not.toBeCloseTo(0.8, 6);
  });
});

describe('EP2 readiness core — defer-reason coverage vs the (post-#281) encoder', () => {
  // Every unresolved/defer reason the encoder (encodeOptionInterventionsForEdit) can emit
  // must map to a typed EP2 reason code AND user-safe recovery copy — never unmapped/empty.
  // Encoder defer paths: (1) no value/raw_value, (2) factor doesn't resolve, (3) no cap,
  // (4) normaliseFactorValue throws (unit-mismatch / range / ambiguous), (5) SHAPE-2 ambiguous.
  const KNOWN_OPTION_CODES = ['NO_CAP_UNRECOVERABLE', 'UNIT_MISMATCH', 'OPTION_INTERVENTION_UNRESOLVABLE'];

  function withBrokenOptHybrid(mutate: (opt: Dict) => void, mutateGraph?: (g: Dict) => void): Dict {
    const g = makeBase();
    const opt = nodeById(g, 'opt_hybrid')!;
    delete opt.interventions;
    mutate(opt);
    mutateGraph?.(g);
    return g;
  }

  const cases: Array<[string, Dict, string]> = [
    // (3) no cap
    ['no cap', withBrokenOptHybrid(
      (o) => { o.data = { interventions: { fac_annual_cost: { raw_value: 120000 } } }; },
      (g) => { (nodeById(g, 'fac_annual_cost') as Dict).observed_state = { value: 0.6, unit: '£' }; },
    ), 'NO_CAP_UNRECOVERABLE'],
    // (4) unit mismatch
    ['unit mismatch', withBrokenOptHybrid(
      (o) => { o.interventions = { fac_annual_cost: { unit: 'agents', raw_value: 5 } }; },
    ), 'UNIT_MISMATCH'],
    // (2) factor doesn't resolve → generic
    ['factor not resolved', withBrokenOptHybrid(
      (o) => { o.interventions = { fac_does_not_exist: { unit: '£', raw_value: 5 } }; },
    ), 'OPTION_INTERVENTION_UNRESOLVABLE'],
    // (1) recovered entry with neither value nor raw_value → generic
    ['empty intervention entry', withBrokenOptHybrid(
      (o) => { o.interventions = { fac_annual_cost: {} }; },
    ), 'OPTION_INTERVENTION_UNRESOLVABLE'],
    // (5) SHAPE-2 ambiguous: node-level raw_value with >1 factor edge → generic
    ['SHAPE-2 ambiguous target', withBrokenOptHybrid(
      (o) => { o.raw_value = 5; },
      (g) => {
        (g.nodes as Dict[]).push({ id: 'fac_b', kind: 'factor', label: 'B', observed_state: { value: 0.4, unit: '£', cap: 10 } });
        (g.edges as Dict[]).push(
          { from: 'opt_hybrid', to: 'fac_b', strength: { mean: 1.0, std: 0.01 }, exists_probability: 1.0, effect_direction: 'positive' },
        );
      },
    ), 'OPTION_INTERVENTION_UNRESOLVABLE'],
    // Codex review 4524991061: empty/malformed entry + factor has NO cap + NO raw-value intent
    // → must stay GENERIC, not NO_CAP_UNRECOVERABLE (the cap is not the blocker; there is no
    // value to bound, so "needs a bound" copy would be misleading).
    ['empty intervention + factor has no cap', withBrokenOptHybrid(
      (o) => { o.interventions = { fac_annual_cost: {} }; },
      (g) => { (nodeById(g, 'fac_annual_cost') as Dict).observed_state = { value: 0.6, unit: '£' }; },
    ), 'OPTION_INTERVENTION_UNRESOLVABLE'],
  ];

  it.each(cases)('encoder defer "%s" → unrecoverable + typed reason %s + non-empty next step', (_label, graph, expectedCode) => {
    const r = assessAnalysisReadiness(graph);
    expect(r.status).toBe('unrecoverable');
    expect(ep2State(r)).toBe('blocked');
    expect(KNOWN_OPTION_CODES).toContain(r.reasonCodes[0]); // every reason maps to a typed code
    expect(r.reasonCodes[0]).toBe(expectedCode);
    expect(typeof r.nextStep).toBe('string');
    expect((r.nextStep ?? '').length).toBeGreaterThan(0); // every reason has user-safe copy
  });

  // Codex review 4524991061 — the misclassification regression + its honest-copy guarantee,
  // and the kept missing-cap-WITH-raw-value mapping (must still be NO_CAP_UNRECOVERABLE).
  it('empty intervention + missing cap (no raw-value intent) → generic, NOT NO_CAP, with honest copy', () => {
    const g = makeBase();
    const opt = nodeById(g, 'opt_hybrid')!;
    delete opt.interventions;
    opt.interventions = { fac_annual_cost: {} };                                  // empty/malformed: no value, no raw_value
    (nodeById(g, 'fac_annual_cost') as Dict).observed_state = { value: 0.6, unit: '£' }; // factor has NO cap
    const r = assessAnalysisReadiness(g);
    expect(r.status).toBe('unrecoverable');
    expect(r.reasonCodes[0]).toBe('OPTION_INTERVENTION_UNRESOLVABLE');
    expect(r.reasonCodes).not.toContain('NO_CAP_UNRECOVERABLE');
    const copy = (r.nextStep ?? '').toLowerCase();
    expect(copy.length).toBeGreaterThan(0);
    expect(copy).not.toMatch(/\bcap\b|\bbound\b/); // copy must NOT imply a missing cap
  });

  it('regression kept: raw-value intent + missing cap → NO_CAP_UNRECOVERABLE (the cap IS the blocker)', () => {
    const g = makeBase();
    const opt = nodeById(g, 'opt_hybrid')!;
    delete opt.interventions;
    opt.data = { interventions: { fac_annual_cost: { raw_value: 120000 } } };     // real raw-value intent
    (nodeById(g, 'fac_annual_cost') as Dict).observed_state = { value: 0.6, unit: '£' }; // factor has NO cap
    const r = assessAnalysisReadiness(g);
    expect(r.status).toBe('unrecoverable');
    expect(r.reasonCodes[0]).toBe('NO_CAP_UNRECOVERABLE');
  });
});

describe('EP2 readiness core — totality (never throws)', () => {
  it.each([
    null,
    undefined,
    42,
    'not-a-graph',
    {},
    { nodes: 'not-an-array' },
    { nodes: [{ id: 'x' }], edges: 'nope' },
    { nodes: [null, 123, { kind: 'option' }], edges: [{}] },
  ])('garbage input %# resolves to a verdict, never throws', (input) => {
    let r: ReturnType<typeof assessAnalysisReadiness> | undefined;
    expect(() => { r = assessAnalysisReadiness(input as unknown); }).not.toThrow();
    expect(r).toBeDefined();
    expect(['analysis_ready', 'repaired', 'unrecoverable']).toContain(r!.status);
    // a non-analysable garbage input must be unrecoverable, not falsely ready.
    if (input === null || input === undefined || typeof input !== 'object') {
      expect(r!.status).toBe('unrecoverable');
    }
  });
});

describe('EP2 readiness core — NO_GRAPH (no persisted model at all)', () => {
  it.each([null, undefined])('a %s graph → unrecoverable NO_GRAPH with a draft-a-model next step', (input) => {
    const r = assessAnalysisReadiness(input as unknown);
    expect(r.status).toBe('unrecoverable');
    expect(r.reasonCodes).toEqual(['NO_GRAPH']);
    expect(r.reasonCategory).toBe('graph_structure');
    expect(r.canonicalGraph).toBeNull();
    expect(r.nextStep).toBe('Draft or save a model first, then run analysis.');
  });

  it('NO_GRAPH (absent) is distinct from SCHEMA_INVALID (present-but-malformed)', () => {
    const malformed = assessAnalysisReadiness({ nodes: 'not-an-array' });
    expect(malformed.status).toBe('unrecoverable');
    expect(malformed.reasonCodes).not.toContain('NO_GRAPH'); // a broken graph is not an absent one
  });
});
