/**
 * V5 edit_graph P0 (add-option encoding) — regression coverage for the live
 * malformed add-option shapes and the encode-or-defer contract.
 */
import { describe, it, expect } from 'vitest';

import {
  encodeOptionInterventionsForEdit,
  optionIdsTouchedByOperations,
  optionIdsAddedWithInterventionIntent,
} from '../encode-option-interventions.js';

type Dict = Record<string, unknown>;

const cappedFactor = () => ({ id: 'fac_annual_cost', kind: 'factor', label: 'Annual Support Cost', observed_state: { value: 0.267, unit: '£', cap: 150000 } });
const uncappedFactor = () => ({ id: 'fac_inhouse_capacity', kind: 'factor', label: 'In-House Agent Capacity', observed_state: { value: 0 } });
const goal = () => ({ id: 'goal_g', kind: 'goal', label: 'G' });
const edge = (from: string, to: string) => ({ from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' });

const optionOf = (g: { nodes: Dict[] }, id: string): Dict => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`option ${id} missing`);
  return n;
};
const iv = (opt: Dict, fac: string): Dict => (opt.interventions as Record<string, Dict>)[fac];

describe('encodeOptionInterventionsForEdit (add-option encoding)', () => {
  it('CASE 1 (encode): raw_value-only data.interventions on a CAPPED factor → derives value = raw/cap', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_x', kind: 'option', label: 'X', data: { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } } }],
      edges: [edge('opt_x', 'fac_annual_cost')],
    };
    const { graph, unresolvedOptionIds } = encodeOptionInterventionsForEdit(g);
    expect(unresolvedOptionIds).toEqual([]);
    const opt = optionOf(graph as { nodes: Dict[] }, 'opt_x');
    expect(iv(opt, 'fac_annual_cost')).toEqual({
      value: 120000 / 150000, // 0.8
      source: 'user_specified',
      target_match: { node_id: 'fac_annual_cost', match_type: 'exact_id', confidence: 'high' },
      unit: '£',
      raw_value: 120000,
    });
    expect(opt.data).toBeUndefined();
  });

  it('CASE 1 (defer): raw_value-only data.interventions on an UNCAPPED factor → unresolved (no scale invented)', () => {
    const g = {
      nodes: [goal(), uncappedFactor(), { id: 'opt_y', kind: 'option', label: 'Y', data: { interventions: { fac_inhouse_capacity: { unit: 'agents', raw_value: 2 } } } }],
      edges: [edge('opt_y', 'fac_inhouse_capacity')],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toEqual(['opt_y']);
    expect(out.graph).toBe(g); // no mutation when deferring
  });

  it('CASE 2 (encode): node-level unit/raw_value with a SINGLE factor edge → attributes + derives, strips node-level', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_z', kind: 'option', label: 'Lean Budget', unit: '£', raw_value: 120000 }],
      edges: [edge('dec', 'opt_z'), edge('opt_z', 'fac_annual_cost')],
    };
    const { graph, unresolvedOptionIds } = encodeOptionInterventionsForEdit(g);
    expect(unresolvedOptionIds).toEqual([]);
    const opt = optionOf(graph as { nodes: Dict[] }, 'opt_z');
    expect(iv(opt, 'fac_annual_cost').value).toBe(0.8);
    expect(opt).not.toHaveProperty('raw_value');
    expect(opt).not.toHaveProperty('unit');
  });

  it('CASE 2 (defer): node-level raw_value with AMBIGUOUS target (two factor edges) → unresolved', () => {
    const g = {
      nodes: [goal(), cappedFactor(), uncappedFactor(), { id: 'opt_m', kind: 'option', label: 'M', unit: '£', raw_value: 120000 }],
      edges: [edge('opt_m', 'fac_annual_cost'), edge('opt_m', 'fac_inhouse_capacity')],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toEqual(['opt_m']);
    expect(out.graph).toBe(g);
  });

  it('CASE 3 (preserve): valid encoded data.interventions (value present) → promoted as-is', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_v', kind: 'option', label: 'V', data: { interventions: { fac_annual_cost: { value: 0.55, unit: '£', raw_value: 110000 } } } }],
      edges: [edge('opt_v', 'fac_annual_cost')],
    };
    const { graph, unresolvedOptionIds } = encodeOptionInterventionsForEdit(g);
    expect(unresolvedOptionIds).toEqual([]);
    expect(iv(optionOf(graph as { nodes: Dict[] }, 'opt_v'), 'fac_annual_cost').value).toBe(0.55);
  });

  it('CASE 4 (PR #276 preserved): mixed top-level + data override → data value wins, user_specified, target_match preserved', () => {
    const g = {
      nodes: [goal(), cappedFactor(), {
        id: 'opt_mix', kind: 'option', label: 'Mix',
        interventions: { fac_annual_cost: { value: 0.9, unit: '£', source: 'brief_extraction', reasoning: 'orig', target_match: { node_id: 'fac_annual_cost', confidence: 'high', match_type: 'exact_id' }, value_confidence: 'high' } },
        data: { interventions: { fac_annual_cost: { value: 0.55, unit: '£', raw_value: 110000 } } },
      }],
      edges: [edge('opt_mix', 'fac_annual_cost')],
    };
    const fac = iv(optionOf(encodeOptionInterventionsForEdit(g).graph as { nodes: Dict[] }, 'opt_mix'), 'fac_annual_cost');
    expect(fac.value).toBe(0.55);                 // data wins
    expect(fac.source).toBe('user_specified');    // override → user edit
    expect(fac.reasoning).toBeUndefined();        // stale value-descriptive metadata dropped
    expect(fac.target_match).toEqual({ node_id: 'fac_annual_cost', confidence: 'high', match_type: 'exact_id' });
  });

  it('CASE 5 (invariant): a malformed add-option cannot be silently applied — defer leaves the graph unmutated', () => {
    const g = {
      nodes: [goal(), uncappedFactor(), { id: 'opt_bad', kind: 'option', label: 'Bad', data: { interventions: { fac_inhouse_capacity: { unit: 'agents', raw_value: 2 } } } }],
      edges: [edge('opt_bad', 'fac_inhouse_capacity')],
    };
    const before = JSON.stringify(g);
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toContain('opt_bad'); // caller defers → buildRejectionResult
    expect(out.graph).toBe(g);
    expect(JSON.stringify(g)).toBe(before); // input not mutated
  });

  it('touched filter: only options referenced by the operations can flag unresolved', () => {
    const g = {
      nodes: [goal(), uncappedFactor(), { id: 'opt_pre', kind: 'option', label: 'Pre-existing malformed', data: { interventions: { fac_inhouse_capacity: { unit: 'agents', raw_value: 2 } } } }],
      edges: [edge('opt_pre', 'fac_inhouse_capacity')],
    };
    // an edit that does NOT touch opt_pre
    const touched = optionIdsTouchedByOperations([{ path: 'opt_new', value: { id: 'opt_new', kind: 'option' } }], g);
    expect(touched.has('opt_pre')).toBe(false);
    const out = encodeOptionInterventionsForEdit(g, touched);
    expect(out.unresolvedOptionIds).toEqual([]); // pre-existing malformed option does NOT block this edit
  });

  it('BLOCKER 1 (encode): top-level raw-only interventions on a CAPPED factor → encoded (was silently unconfigured)', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_tl', kind: 'option', label: 'TL', interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } }],
      edges: [edge('opt_tl', 'fac_annual_cost')],
    };
    const { graph, unresolvedOptionIds } = encodeOptionInterventionsForEdit(g);
    expect(unresolvedOptionIds).toEqual([]);
    expect(iv(optionOf(graph as { nodes: Dict[] }, 'opt_tl'), 'fac_annual_cost').value).toBe(0.8);
  });

  it('BLOCKER 1 (defer): top-level raw-only interventions on an UNCAPPED factor → defer (no longer persists unconfigured)', () => {
    const g = {
      nodes: [goal(), uncappedFactor(), { id: 'opt_tlu', kind: 'option', label: 'TLU', interventions: { fac_inhouse_capacity: { unit: 'agents', raw_value: 2 } } }],
      edges: [edge('opt_tlu', 'fac_inhouse_capacity')],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toEqual(['opt_tlu']);
    expect(out.graph).toBe(g);
  });

  it('BLOCKER 2 (defer): data.interventions targeting a NON-EXISTENT factor → defer (no phantom target_match)', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_ph', kind: 'option', label: 'Ph', data: { interventions: { fac_typo: { unit: '£', raw_value: 120000, cap: 100000 } } } }],
      edges: [],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toEqual(['opt_ph']); // even though the intervention carries its own cap
    expect(out.graph).toBe(g);
  });

  it('BLOCKER 3 (defer): unit mismatch (agents vs a £ factor) → defer (canonical guard fires via factorUnit)', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_um', kind: 'option', label: 'UM', data: { interventions: { fac_annual_cost: { unit: 'agents', raw_value: 2 } } } }],
      edges: [edge('opt_um', 'fac_annual_cost')],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toEqual(['opt_um']);
    expect(out.graph).toBe(g);
  });

  it('fail-CLOSED: an internal error (non-serialisable graph) with a touched set defers the touched options', () => {
    const g: Record<string, unknown> = {
      nodes: [goal(), cappedFactor(), { id: 'opt_x', kind: 'option', label: 'X', data: { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } } }],
      edges: [edge('opt_x', 'fac_annual_cost')],
    };
    g.self = g; // circular → JSON.stringify throws in the clone step (after detection finds opt_x encodable)
    const out = encodeOptionInterventionsForEdit(g, new Set(['opt_x']));
    expect(out.unresolvedOptionIds).toEqual(['opt_x']);
    expect(out.graph).toBe(g);
  });

  it('does NOT over-defer: a touched option WIRED to factors but with no intervention DATA is a valid needs-encoding state (not deferred)', () => {
    // Mirrors patch-flags-off-parity: a label-only edit on a pre-existing
    // wired-but-unconfigured option must pass through, not reject. Only malformed
    // intervention DATA (un-derivable value) or ambiguous node-level intent defers.
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_w', kind: 'option', label: 'Wired' }],
      edges: [edge('opt_w', 'fac_annual_cost')],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toEqual([]);
    expect(out.graph).toBe(g);
  });

  it('does NOT over-defer: a no-effect option (no edges, no interventions) is allowed', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_none', kind: 'option', label: 'No effect' }],
      edges: [],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out.unresolvedOptionIds).toEqual([]);
    expect(out.graph).toBe(g);
  });

  it('no-op: a clean option (valid top-level only, no data) is returned by reference', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_clean', kind: 'option', label: 'Clean', interventions: { fac_annual_cost: { value: 0.5, source: 'brief_extraction', target_match: { node_id: 'fac_annual_cost', match_type: 'exact_id', confidence: 'high' } } } }],
      edges: [edge('opt_clean', 'fac_annual_cost')],
    };
    const out = encodeOptionInterventionsForEdit(g);
    expect(out).toEqual({ graph: g, unresolvedOptionIds: [] });
    expect(out.graph).toBe(g);
  });

  it('fail-open: malformed inputs never throw and are returned unchanged', () => {
    for (const bad of [undefined, null, {}, { nodes: 'x' }, { nodes: [null, 42] }]) {
      expect(() => encodeOptionInterventionsForEdit(bad)).not.toThrow();
      expect(encodeOptionInterventionsForEdit(bad).graph).toBe(bad);
    }
  });
});

describe('optionIdsAddedWithInterventionIntent (intent-scoped add detection)', () => {
  it('flags an add whose payload carried data.interventions intent', () => {
    const ops = [{ op: 'add_node', value: { id: 'opt_a', kind: 'option', data: { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } } } }];
    expect([...optionIdsAddedWithInterventionIntent(ops)]).toEqual(['opt_a']);
  });
  it('flags an add whose payload carried top-level interventions intent', () => {
    const ops = [{ op: 'add_node', value: { id: 'opt_b', kind: 'option', interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } } }];
    expect([...optionIdsAddedWithInterventionIntent(ops)]).toEqual(['opt_b']);
  });
  it('flags an add whose payload carried node-level scalar intent (SHAPE 2)', () => {
    const ops = [{ op: 'add_node', value: { id: 'opt_c', kind: 'option', unit: '£', raw_value: 120000 } }];
    expect([...optionIdsAddedWithInterventionIntent(ops)]).toEqual(['opt_c']);
  });
  it('does NOT flag a bare needs_encoding add (empty interventions, no request)', () => {
    const ops = [
      { op: 'add_node', value: { id: 'opt_bare', kind: 'option', data: { interventions: {} } } },
      { op: 'add_node', value: { id: 'opt_none', kind: 'option', label: 'No effect' } },
    ];
    expect([...optionIdsAddedWithInterventionIntent(ops)]).toEqual([]);
  });
  it('flags an add whose payload carried an EXPLICIT null interventions (collapsed config attempt), top-level and data', () => {
    const ops = [
      { op: 'add_node', value: { id: 'opt_null_top', kind: 'option', interventions: null } },
      { op: 'add_node', value: { id: 'opt_null_data', kind: 'option', data: { interventions: null } } },
    ];
    expect([...optionIdsAddedWithInterventionIntent(ops)].sort()).toEqual(['opt_null_data', 'opt_null_top']);
  });
  it('ignores non-option adds and non-add ops', () => {
    const ops = [
      { op: 'add_node', value: { id: 'fac_x', kind: 'factor', unit: '£', raw_value: 5 } },
      { op: 'update_node', value: { id: 'opt_x', kind: 'option', interventions: { f: { raw_value: 1 } } } },
    ];
    expect([...optionIdsAddedWithInterventionIntent(ops)]).toEqual([]);
  });
});

describe('encodeOptionInterventionsForEdit (P0-A configure-or-don\'t-persist for added options)', () => {
  // The COMBINED-BUILD live failure: edit_graph ADDED an option that REQUESTED a
  // £ intervention on a drafted cost factor with no cap; the value could not be
  // derived and the option committed with interventions:null, so a later
  // run_analysis returned options_not_configured. The fix defers (graph
  // unchanged) an added option that REQUESTED a configuration it cannot produce
  // — INTENT-scoped, so an intentional bare needs_encoding add still passes.

  it('ADD-with-intent (defer): requested intervention collapsed to interventions:null → unresolved, graph unchanged', () => {
    // The requested value did not survive to the node (collapsed away upstream),
    // but the add was a configuration attempt, so it must not persist unconfigured.
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_null', kind: 'option', label: 'Null IV', interventions: null }],
      edges: [edge('opt_null', 'fac_annual_cost')],
    };
    const before = JSON.stringify(g);
    const out = encodeOptionInterventionsForEdit(g, new Set(['opt_null']), new Set(['opt_null']));
    expect(out.unresolvedOptionIds).toEqual(['opt_null']);
    expect(out.graph).toBe(g);
    expect(JSON.stringify(g)).toBe(before);
  });

  it('ADD-with-intent (defer): requested intervention cannot be encoded (uncappable factor) → unresolved', () => {
    const g = {
      nodes: [goal(), uncappedFactor(), { id: 'opt_unc', kind: 'option', label: 'Unc', data: { interventions: { fac_inhouse_capacity: { unit: 'agents', raw_value: 2 } } } }],
      edges: [edge('opt_unc', 'fac_inhouse_capacity')],
    };
    const out = encodeOptionInterventionsForEdit(g, new Set(['opt_unc']), new Set(['opt_unc']));
    expect(out.unresolvedOptionIds).toEqual(['opt_unc']);
    expect(out.graph).toBe(g);
  });

  it('ADD-with-intent (encode): a requested intervention that IS encodable (capped factor) → encodes, NOT deferred (Gate-1 PASS preserved)', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_ok', kind: 'option', label: 'OK', data: { interventions: { fac_annual_cost: { unit: '£', raw_value: 120000 } } } }],
      edges: [edge('opt_ok', 'fac_annual_cost')],
    };
    const { graph, unresolvedOptionIds } = encodeOptionInterventionsForEdit(g, new Set(['opt_ok']), new Set(['opt_ok']));
    expect(unresolvedOptionIds).toEqual([]);
    expect(iv(optionOf(graph as { nodes: Dict[] }, 'opt_ok'), 'fac_annual_cost').value).toBe(0.8);
  });

  it('ADD-without-intent (allow): a bare needs_encoding add (not in must-configure) is NOT deferred — preserves the two-phase add flow', () => {
    // Mirrors the orphan-option contract: an option added wired-but-unconfigured,
    // with no requested intervention, is a valid intermediate state.
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_needs', kind: 'option', label: 'Configure later' }],
      edges: [edge('opt_needs', 'fac_annual_cost')],
    };
    const out = encodeOptionInterventionsForEdit(g, new Set(['opt_needs']), new Set() /* no requested config */);
    expect(out.unresolvedOptionIds).toEqual([]);
    expect(out.graph).toBe(g);
  });

  it('RENAME (allow): a PRE-EXISTING wired-but-unconfigured option, touched by a rename, is NOT deferred', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_rename', kind: 'option', label: 'Renamed' }],
      edges: [edge('opt_rename', 'fac_annual_cost')],
    };
    const out = encodeOptionInterventionsForEdit(g, new Set(['opt_rename']), new Set() /* not an add */);
    expect(out.unresolvedOptionIds).toEqual([]);
    expect(out.graph).toBe(g);
  });

  it('opt-in: omitting the must-configure set preserves the legacy lenient behaviour', () => {
    const g = {
      nodes: [goal(), cappedFactor(), { id: 'opt_legacy', kind: 'option', label: 'Legacy' }],
      edges: [edge('opt_legacy', 'fac_annual_cost')],
    };
    const out = encodeOptionInterventionsForEdit(g, new Set(['opt_legacy']));
    expect(out.unresolvedOptionIds).toEqual([]);
  });
});
