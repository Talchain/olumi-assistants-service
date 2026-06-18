/**
 * V5 edit_graph P0 — option-contract normalisation (wrapper unit tests).
 *
 * Proves: edit-added options whose interventions live at `data.interventions`
 * (object or plain-number form) or slash-keyed `data/interventions/<fac>` are
 * promoted to the canonical top-level `InterventionV3` contract at persist time;
 * draft/chip-click/proposal graphs that already carry top-level interventions are
 * returned UNCHANGED (reference identity + byte-equivalent); graph-absent and
 * malformed inputs fail open; redacted telemetry (IDs/counts only) fires only on
 * a real promotion; the result survives `GraphV3.safeParse` (the NodeV3 strip).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

import { normaliseOptionInterventionContract } from '../../../src/orchestrator-v5/normalise-option-interventions.js';
import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { log } from '../../../src/utils/telemetry.js';

type AnyNode = Record<string, unknown> & { id: string };
type AnyGraph = { nodes: AnyNode[]; edges: Array<Record<string, unknown>>; [k: string]: unknown };

const nodeById = (g: AnyGraph, id: string): Record<string, unknown> => {
  const n = g.nodes.find((x) => x.id === id);
  if (!n) throw new Error(`node ${id} missing`);
  return n;
};

/** Draft-created option as persisted on staging: canonical top-level InterventionV3. */
const draftOption = (id: string, isBaseline: boolean): AnyNode => ({
  id,
  kind: 'option',
  label: `draft ${id}`,
  is_baseline: isBaseline,
  interventions: {
    fac_annual_cost: {
      unit: '£',
      value: 0.933,
      source: 'brief_extraction',
      reasoning: 'Direct from V4 prompt data.interventions',
      target_match: { node_id: 'fac_annual_cost', confidence: 'high', match_type: 'exact_id' },
      value_confidence: 'high',
    },
  },
});

/** Edit-added option as persisted on staging (scenario 30aa36ad): interventions under data.interventions. */
const editAddedOption = (): AnyNode => ({
  id: 'opt_hybrid',
  kind: 'option',
  label: 'Hybrid: 2 In-House Agents + Partial BPO',
  is_baseline: false,
  data: {
    interventions: {
      fac_annual_cost: { cap: 200000, unit: '£', value: 0.55, raw_value: 110000 },
      fac_bpo_engagement: { cap: 1, unit: 'proportion', value: 0.5, raw_value: 0.5 },
      fac_inhouse_capacity: { cap: 4, unit: 'agents', value: 0.5, raw_value: 2 },
    },
  },
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('normaliseOptionInterventionContract (V5 edit_graph P0)', () => {
  it('promotes object-form data.interventions to the canonical top-level InterventionV3 contract', () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => log as never);
    const g: AnyGraph = { nodes: [editAddedOption()], edges: [] };
    const out = normaliseOptionInterventionContract(g) as AnyGraph;

    const opt = nodeById(out, 'opt_hybrid');
    expect(opt.interventions).toEqual({
      fac_annual_cost: {
        value: 0.55,
        source: 'user_specified',
        target_match: { node_id: 'fac_annual_cost', match_type: 'exact_id', confidence: 'high' },
        unit: '£',
        raw_value: 110000,
      },
      fac_bpo_engagement: {
        value: 0.5,
        source: 'user_specified',
        target_match: { node_id: 'fac_bpo_engagement', match_type: 'exact_id', confidence: 'high' },
        unit: 'proportion',
        raw_value: 0.5,
      },
      fac_inhouse_capacity: {
        value: 0.5,
        source: 'user_specified',
        target_match: { node_id: 'fac_inhouse_capacity', match_type: 'exact_id', confidence: 'high' },
        unit: 'agents',
        raw_value: 2,
      },
    });
    // non-canonical location cleared; `cap` dropped (not an InterventionV3 field)
    expect(opt.data).toBeUndefined();
    for (const iv of Object.values(opt.interventions as Record<string, Record<string, unknown>>)) {
      expect(iv).not.toHaveProperty('cap');
    }
    // input graph not mutated (clone)
    expect((nodeById(g, 'opt_hybrid').data as { interventions: unknown }).interventions).toBeDefined();
    expect(out).not.toBe(g);
    // redacted summary: option ids + counts only
    const calls = info.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((p) => p?.event === 'v5.graph_persist.option_contract_normalised');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ corrected_count: 1, node_ids: ['opt_hybrid'] });
    for (const k of ['interventions', 'value', 'before', 'after', 'graph', 'nodes', 'data', 'raw_value']) {
      expect(calls[0]).not.toHaveProperty(k);
    }
  });

  it('promotes plain-number data.interventions to top-level (value preserved, no unit/raw_value)', () => {
    const g: AnyGraph = {
      nodes: [{ id: 'opt_x', kind: 'option', label: 'X', data: { interventions: { fac_a: 0.4, fac_b: 0 } } }],
      edges: [],
    };
    const out = normaliseOptionInterventionContract(g) as AnyGraph;
    expect(nodeById(out, 'opt_x').interventions).toEqual({
      fac_a: { value: 0.4, source: 'user_specified', target_match: { node_id: 'fac_a', match_type: 'exact_id', confidence: 'high' } },
      fac_b: { value: 0, source: 'user_specified', target_match: { node_id: 'fac_b', match_type: 'exact_id', confidence: 'high' } },
    });
  });

  it('promotes slash-keyed entries to top-level; data.interventions (Source 1) wins over slash (Source 2)', () => {
    const g: AnyGraph = {
      nodes: [{
        id: 'opt_s',
        kind: 'option',
        label: 'S',
        data: { interventions: { fac_a: 0.7 } },
        'data/interventions/fac_a': 0.1, // loses to Source 1
        'data/interventions/fac_c': 0.3, // unique → promoted
      }],
      edges: [],
    };
    const out = normaliseOptionInterventionContract(g) as AnyGraph;
    const opt = nodeById(out, 'opt_s') as Record<string, unknown>;
    expect((opt.interventions as Record<string, { value: number }>).fac_a.value).toBe(0.7); // Source 1 wins
    expect((opt.interventions as Record<string, { value: number }>).fac_c.value).toBe(0.3);
    // slash keys removed after promotion
    expect(opt).not.toHaveProperty('data/interventions/fac_a');
    expect(opt).not.toHaveProperty('data/interventions/fac_c');
  });

  // --- MIXED top-level + data.interventions: data wins, metadata preserved ---
  // (Codex blocker: the read path documents data.interventions as Source 1 — it
  // wins over a possibly-stale top-level. The normaliser must overlay, not skip.)

  const ivOf = (opt: Record<string, unknown>, fac: string): Record<string, unknown> =>
    (opt.interventions as Record<string, Record<string, unknown>>)[fac];

  it('OVERLAY: mixed top-level + data.interventions(new factor) → both present; top-level metadata preserved; new factor fresh', () => {
    const g: AnyGraph = {
      nodes: [{
        id: 'opt_mix',
        kind: 'option',
        label: 'M',
        is_baseline: false,
        interventions: {
          fac_a: {
            value: 0.9, unit: '£', source: 'brief_extraction', reasoning: 'orig',
            target_match: { node_id: 'fac_a', confidence: 'high', match_type: 'exact_id' }, value_confidence: 'high',
          },
        },
        data: { interventions: { fac_b: 0.5 } },
      }],
      edges: [],
    };
    const opt = nodeById(normaliseOptionInterventionContract(g) as AnyGraph, 'opt_mix');
    // existing top-level entry preserved verbatim
    expect(ivOf(opt, 'fac_a')).toEqual({
      value: 0.9, unit: '£', source: 'brief_extraction', reasoning: 'orig',
      target_match: { node_id: 'fac_a', confidence: 'high', match_type: 'exact_id' }, value_confidence: 'high',
    });
    // new factor from data promoted as fresh InterventionV3
    expect(ivOf(opt, 'fac_b')).toEqual({
      value: 0.5, source: 'user_specified', target_match: { node_id: 'fac_b', match_type: 'exact_id', confidence: 'high' },
    });
    expect(opt.data).toBeUndefined();
  });

  it('OVERLAY: data.interventions OVERRIDES a stale top-level value (data wins) while preserving metadata', () => {
    const g: AnyGraph = {
      nodes: [{
        id: 'opt_o',
        kind: 'option',
        label: 'O',
        is_baseline: false,
        interventions: {
          fac_a: {
            value: 0.9, unit: '£', source: 'brief_extraction', reasoning: 'orig',
            target_match: { node_id: 'fac_a', confidence: 'high', match_type: 'exact_id' }, value_confidence: 'high',
          },
        },
        data: { interventions: { fac_a: { value: 0.55, unit: '£', raw_value: 110000 } } },
      }],
      edges: [],
    };
    const fac_a = ivOf(nodeById(normaliseOptionInterventionContract(g) as AnyGraph, 'opt_o'), 'fac_a');
    expect(fac_a.value).toBe(0.55);        // edited value WINS (not the stale 0.9)
    expect(fac_a.raw_value).toBe(110000);  // newer raw_value applied
    expect(fac_a.unit).toBe('£');          // unit from the edit
    // provenance is made truthful: an overridden value is a USER edit
    expect(fac_a.source).toBe('user_specified');
    // stale value-descriptive metadata is NOT carried over
    expect(fac_a.reasoning).toBeUndefined();
    expect(fac_a.value_confidence).toBeUndefined();
    // only the still-valid factor match is preserved
    expect(fac_a.target_match).toEqual({ node_id: 'fac_a', confidence: 'high', match_type: 'exact_id' });
  });

  it('OVERLAY: slash-keyed edit OVERRIDES a stale top-level value (data wins), metadata preserved, slash key removed', () => {
    const g: AnyGraph = {
      nodes: [{
        id: 'opt_sl',
        kind: 'option',
        label: 'SL',
        is_baseline: false,
        interventions: { fac_a: { value: 0.9, source: 'brief_extraction', target_match: { node_id: 'fac_a', confidence: 'high', match_type: 'exact_id' } } },
        'data/interventions/fac_a': 0.25,
      }],
      edges: [],
    };
    const opt = nodeById(normaliseOptionInterventionContract(g) as AnyGraph, 'opt_sl');
    expect(ivOf(opt, 'fac_a').value).toBe(0.25);              // slash edit wins
    expect(ivOf(opt, 'fac_a').source).toBe('user_specified'); // user edit, not stale provenance
    expect(ivOf(opt, 'fac_a').reasoning).toBeUndefined();
    expect(ivOf(opt, 'fac_a').target_match).toEqual({ node_id: 'fac_a', confidence: 'high', match_type: 'exact_id' });
    expect(opt).not.toHaveProperty('data/interventions/fac_a');
  });

  // --- Control #2 mandated no-op proofs -------------------------------------

  it('NO-OP: a real draft-shaped graph is returned UNCHANGED (reference identity)', () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => log as never);
    const g: AnyGraph = {
      nodes: [
        { id: 'goal_support', kind: 'goal', label: 'Maximise Resolved Tickets Per Week' },
        { id: 'fac_annual_cost', kind: 'factor', label: 'Annual Support Cost', observed_state: { value: 0.267 } },
        draftOption('opt_hire', true),
        draftOption('opt_outsource', false),
      ],
      edges: [{ from: 'opt_hire', to: 'fac_annual_cost' }],
    };
    expect(normaliseOptionInterventionContract(g)).toBe(g); // no clone churn
    expect(info.mock.calls.filter((c) => (c[0] as { event?: string })?.event === 'v5.graph_persist.option_contract_normalised')).toHaveLength(0);
  });

  it('NO-OP: a chip-click/proposal-shaped graph with valid top-level interventions is unchanged (reference identity)', () => {
    // chip-click / proposal-apply persist the same canonical option contract as draft.
    const g: AnyGraph = {
      nodes: [
        { id: 'goal_1', kind: 'goal', label: 'G' },
        { id: 'dec_1', kind: 'decision', label: 'D' },
        draftOption('opt_a', true),
        draftOption('opt_b', false),
      ],
      edges: [{ from: 'dec_1', to: 'opt_a' }],
    };
    expect(normaliseOptionInterventionContract(g)).toBe(g);
  });

  it('NO-OP: draft option data is byte-equivalent after a mixed-graph normalise (only the edit-added option changes)', () => {
    const draftA = draftOption('opt_hire', true);
    const draftB = draftOption('opt_outsource', false);
    const draftABefore = JSON.stringify(draftA);
    const draftBBefore = JSON.stringify(draftB);
    const g: AnyGraph = {
      nodes: [
        { id: 'goal_support', kind: 'goal', label: 'G' },
        draftA,
        draftB,
        editAddedOption(),
      ],
      edges: [],
    };
    const out = normaliseOptionInterventionContract(g) as AnyGraph;
    // the two draft options are byte-identical
    expect(JSON.stringify(nodeById(out, 'opt_hire'))).toBe(draftABefore);
    expect(JSON.stringify(nodeById(out, 'opt_outsource'))).toBe(draftBBefore);
    // only the edit-added option gained a top-level bundle
    expect(nodeById(out, 'opt_hybrid').interventions).toBeDefined();
  });

  it('NO-OP: an option with no interventions anywhere is left untouched', () => {
    const g: AnyGraph = { nodes: [{ id: 'opt_empty', kind: 'option', label: 'E' }], edges: [] };
    expect(normaliseOptionInterventionContract(g)).toBe(g);
  });

  it('graph-absent (undefined/null) returns the input, no emit', () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => log as never);
    expect(normaliseOptionInterventionContract(undefined)).toBeUndefined();
    expect(normaliseOptionInterventionContract(null)).toBeNull();
    expect(info).not.toHaveBeenCalled();
  });

  it('idempotent: a second pass over the promoted graph is a no-op (reference identity)', () => {
    const g: AnyGraph = { nodes: [editAddedOption()], edges: [] };
    const once = normaliseOptionInterventionContract(g);
    const twice = normaliseOptionInterventionContract(once);
    expect(twice).toBe(once);
  });

  // --- Control #2 mandated fail-open proof ----------------------------------

  it('FAIL-OPEN: malformed graphs never throw and are returned unchanged', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => log as never);
    for (const bad of [{}, { nodes: 'nope' }, { nodes: [null, 42, { kind: 'option' }] }]) {
      expect(() => normaliseOptionInterventionContract(bad)).not.toThrow();
      expect(normaliseOptionInterventionContract(bad)).toBe(bad);
    }
    expect(warn).not.toHaveBeenCalled(); // these are graceful no-ops, not error paths
  });

  it('FAIL-OPEN: a non-serialisable graph with a dirty option degrades to the original (clone failure, redacted warn)', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => log as never);
    const circular: AnyGraph = { nodes: [editAddedOption()], edges: [] };
    (circular as Record<string, unknown>).self = circular; // breaks JSON.stringify
    const out = normaliseOptionInterventionContract(circular, { scenarioId: 'sc', turnId: 't' });
    expect(out).toBe(circular); // no repaired artifact → persist the original, untouched
    const failed = warn.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((p) => p?.event === 'v5.graph_persist.option_contract_normalise_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ reason: 'clone_failed', error_name: 'TypeError', scenario_id: 'sc', turn_id: 't' });
    expect(failed[0]).not.toHaveProperty('message');
    expect(failed[0]).not.toHaveProperty('err');
  });

  // --- the promoted shape survives the NodeV3 read-time strip ----------------

  // --- P0-A add-option residual: interventions:null containment net ----------

  it('NULL→{}: an option persisted with interventions:null is coerced to an empty record', () => {
    const info = vi.spyOn(log, 'info').mockImplementation(() => log as never);
    const g: AnyGraph = { nodes: [{ id: 'opt_null', kind: 'option', label: 'N', interventions: null }], edges: [] };
    const out = normaliseOptionInterventionContract(g, { scenarioId: 'sc', turnId: 't' }) as AnyGraph;
    expect(nodeById(out, 'opt_null').interventions).toEqual({});
    expect(out).not.toBe(g); // clone produced
    expect((g.nodes[0] as AnyNode).interventions).toBeNull(); // input not mutated
    const calls = info.mock.calls.map((c) => c[0] as Record<string, unknown>)
      .filter((p) => p?.event === 'v5.graph_persist.option_contract_normalised');
    expect(calls[0]).toMatchObject({ corrected_count: 1, node_ids: ['opt_null'] });
  });

  it('NON-RECORD→{}: array / scalar interventions are coerced to an empty record (never persist invalid shape)', () => {
    for (const bad of [[], [1, 2], 'x', 5, true]) {
      const g: AnyGraph = { nodes: [{ id: 'opt_b', kind: 'option', label: 'B', interventions: bad as unknown }], edges: [] };
      const out = normaliseOptionInterventionContract(g) as AnyGraph;
      expect(nodeById(out, 'opt_b').interventions).toEqual({});
    }
  });

  it('NODE-LEVEL: the sweep covers NON-OPTION nodes too (interventions is a NodeV3 field, so the parse-bomb is node-level)', () => {
    // GraphV3.safeParse rejects interventions:null on a factor/decision/goal/risk
    // node just as it does on an option; the sweep must match the full surface.
    const g: AnyGraph = {
      nodes: [
        { id: 'fac_n', kind: 'factor', label: 'F', interventions: null },
        { id: 'dec_a', kind: 'decision', label: 'D', interventions: [1, 2] as unknown },
        { id: 'goal_s', kind: 'goal', label: 'G', interventions: 'x' as unknown },
        { id: 'risk_b', kind: 'risk', label: 'R', interventions: true as unknown },
      ],
      edges: [],
    };
    const out = normaliseOptionInterventionContract(g) as AnyGraph;
    expect(nodeById(out, 'fac_n').interventions).toEqual({});
    expect(nodeById(out, 'dec_a').interventions).toEqual({});
    expect(nodeById(out, 'goal_s').interventions).toEqual({});
    expect(nodeById(out, 'risk_b').interventions).toEqual({});
    // input not mutated
    expect((g.nodes[0] as AnyNode).interventions).toBeNull();
  });

  it('GraphV3.safeParse: interventions:null FAILS on a NON-OPTION (factor) node too; sweep makes it parse', () => {
    const bomb = { nodes: [{ id: 'goal_g', kind: 'goal', label: 'G' }, { id: 'fac_n', kind: 'factor', label: 'F', interventions: null }], edges: [] };
    expect(GraphV3.safeParse(bomb).success).toBe(false); // node-level parse-bomb confirmed
    const swept = normaliseOptionInterventionContract(bomb);
    const parsed = GraphV3.safeParse(swept);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      const fac = parsed.data.nodes.find((n) => n.id === 'fac_n') as Record<string, unknown>;
      expect(fac.interventions).toEqual({});
    }
  });

  it('NO-OP: a valid top-level interventions record is unchanged (reference identity)', () => {
    const g: AnyGraph = { nodes: [draftOption('opt_ok', false)], edges: [] };
    expect(normaliseOptionInterventionContract(g)).toBe(g);
  });

  it('NO-OP: an empty-record {} interventions is already analysis-safe and unchanged (reference identity)', () => {
    const g: AnyGraph = { nodes: [{ id: 'opt_e', kind: 'option', label: 'E', interventions: {} }], edges: [] };
    expect(normaliseOptionInterventionContract(g)).toBe(g);
  });

  it('NULL + recoverable data.interventions: promotes to a real record (not just {}), null replaced', () => {
    const g: AnyGraph = {
      nodes: [{ id: 'opt_nr', kind: 'option', label: 'NR', interventions: null, data: { interventions: { fac_a: 0.4 } } }],
      edges: [],
    };
    const out = normaliseOptionInterventionContract(g) as AnyGraph;
    expect(nodeById(out, 'opt_nr').interventions).toEqual({
      fac_a: { value: 0.4, source: 'user_specified', target_match: { node_id: 'fac_a', match_type: 'exact_id', confidence: 'high' } },
    });
  });

  it('EXCEPTION-SAFE: interventions:null is sanitised to {} EVEN WHEN the promotion pass throws (sweep not undone by fail-open)', async () => {
    // Force PASS 2 (recoverable promotion) to throw: extractNumericIntervention
    // is called ONLY inside the promotion detect/merge. The PASS 1 null sweep
    // must still hold — fail-open returns the SWEPT graph, never the raw null.
    vi.resetModules();
    vi.doMock('../../../src/orchestrator/tools/analysis-ready-helper.js', async (orig) => {
      const actual = await orig<typeof import('../../../src/orchestrator/tools/analysis-ready-helper.js')>();
      return { ...actual, extractNumericIntervention: () => { throw new Error('forced promotion failure'); } };
    });
    const { normaliseOptionInterventionContract: fn } =
      await import('../../../src/orchestrator-v5/normalise-option-interventions.js');

    const g: AnyGraph = {
      nodes: [
        { id: 'opt_null', kind: 'option', label: 'N', interventions: null },                   // PASS 1 must sweep → {}
        { id: 'opt_rec', kind: 'option', label: 'R', data: { interventions: { fac_a: 0.4 } } }, // triggers PASS 2 → forced throw
      ],
      edges: [],
    };
    const out = fn(g) as AnyGraph;

    // Promotion threw, but the null→{} invariant survived (NOT the original null):
    expect(nodeById(out, 'opt_null').interventions).toEqual({});
    expect(nodeById(out, 'opt_null').interventions).not.toBeNull();
    expect(out).not.toBe(g);                                   // returned the swept graph, not the raw original
    expect((g.nodes[0] as AnyNode).interventions).toBeNull();  // input not mutated

    vi.doUnmock('../../../src/orchestrator/tools/analysis-ready-helper.js');
    vi.resetModules();
  });

  it('GraphV3.safeParse: interventions:null FAILS but {} and absent PASS (the read-time parse-bomb)', () => {
    const mk = (opt: Record<string, unknown>) => ({
      nodes: [{ id: 'goal_g', kind: 'goal', label: 'G' }, { id: 'opt_x', kind: 'option', label: 'X', ...opt }],
      edges: [],
    });
    expect(GraphV3.safeParse(mk({ interventions: null })).success).toBe(false);
    expect(GraphV3.safeParse(mk({ interventions: {} })).success).toBe(true);
    expect(GraphV3.safeParse(mk({})).success).toBe(true);
  });

  it('NULL→{} survives GraphV3.safeParse (the persisted graph is readable; option is needs_encoding-shaped {})', () => {
    const g = {
      nodes: [
        { id: 'goal_g', kind: 'goal', label: 'G' },
        { id: 'fac_x', kind: 'factor', label: 'X', observed_state: { value: 0 } },
        { id: 'opt_null', kind: 'option', label: 'N', interventions: null },
      ],
      edges: [{ from: 'opt_null', to: 'fac_x', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }],
    };
    const normalised = normaliseOptionInterventionContract(g);
    const parsed = GraphV3.safeParse(normalised);
    expect(parsed.success).toBe(true); // was previously a parse failure on interventions:null
    if (!parsed.success) return;
    const opt = parsed.data.nodes.find((n) => n.id === 'opt_null') as Record<string, unknown>;
    expect(opt.interventions).toEqual({});
  });

  it('the promoted option survives GraphV3.safeParse (NodeV3 strips data; top-level interventions persist)', () => {
    const g = {
      nodes: [
        { id: 'goal_support', kind: 'goal', label: 'Maximise Resolved Tickets Per Week' },
        { id: 'fac_annual_cost', kind: 'factor', label: 'Annual Support Cost', observed_state: { value: 0.267 } },
        { id: 'fac_inhouse_capacity', kind: 'factor', label: 'In-House Agent Capacity', observed_state: { value: 0 } },
        { id: 'fac_bpo_engagement', kind: 'factor', label: 'BPO Vendor Engagement', observed_state: { value: 0 } },
        editAddedOption(),
      ],
      edges: [
        { from: 'opt_hybrid', to: 'fac_annual_cost', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_hybrid', to: 'fac_inhouse_capacity', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
        { from: 'opt_hybrid', to: 'fac_bpo_engagement', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
      ],
    };
    const normalised = normaliseOptionInterventionContract(g);
    const parsed = GraphV3.safeParse(normalised);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const opt = parsed.data.nodes.find((n) => n.id === 'opt_hybrid') as Record<string, unknown>;
    // data is stripped by NodeV3, but the promoted top-level interventions survive
    expect(opt.data).toBeUndefined();
    expect(Object.keys(opt.interventions as Record<string, unknown>)).toEqual(
      expect.arrayContaining(['fac_annual_cost', 'fac_inhouse_capacity', 'fac_bpo_engagement']),
    );
  });
});
