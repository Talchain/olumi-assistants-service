/**
 * 0.64.0 — WHICH OPTIONS ARE COMPARED ENTERS THE ANALYSIS REVISION (Canonical #72 5887528088; contract DL 5887534233;
 * marker MG 5887738387 / #2295; published vocabulary schemas #73).
 *
 * Construction marks an option Olumi added `proposed_by: 'olumi'`; the Run's post-gate filter keeps it out of the
 * ordinary comparison; an approved "add to comparison" now records `analysis_participation: 'included'` while preserving the mark. MEASURED at staging 0497e52e: an authorship-only
 * change to an option (provenance + origin) left this hash unchanged, so the Run that excluded the option would have
 * kept reading CURRENT after the user adopted it. The published node vocabulary now carries `proposed_by` (projection
 * v4), and `projectNode` iterates it, so the vendor pin alone makes the hash see the marker.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../graph-hash.js';
import { CANONICAL_GRAPH_HASH_NESTED_PROJECTION, CANONICAL_GRAPH_HASH_PROJECTION_VERSION } from '@talchain/schemas/boundary';

type Rec = Record<string, unknown>;
const hashOf = (g: unknown) => computeAnalysisAffectingGraphHash(g as GraphV3T);

/** Paul's pricing shape: two user options and £54, which Olumi added. */
const unmarked = (): Rec & { nodes: Rec[]; options: Rec[] } => ({
  goal_node_id: 'mrr',
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR' },
    { id: 'price', kind: 'factor', label: 'Pro price', observed_state: { value: 0.49, raw_value: 49, cap: 100, unit: '£', source: 'user_override' } },
    { id: 'raise_59', kind: 'option', label: 'Raise to £59', interventions: { price: { value: 0.59 } } },
    { id: 'keep_49', kind: 'option', label: 'Keep £49', interventions: { price: { value: 0.49 } } },
    { id: 'mod_54', kind: 'option', label: '£54 Pro release', interventions: { price: { value: 0.54 } } },
  ],
  edges: [{ from: 'price', to: 'mrr', strength: { mean: 0.4, std: 0.1 }, effect_direction: 'positive' }],
  options: [
    { id: 'raise_59', status: 'ready', interventions: { price: { value: 0.59 } } },
    { id: 'keep_49', status: 'ready', interventions: { price: { value: 0.49 } } },
    { id: 'mod_54', status: 'ready', interventions: { price: { value: 0.54 } } },
  ],
});
/** The same graph with `mod_54` marked as Olumi's proposal (the construction mark, on the option NODE). */
const marked = () => {
  const g = unmarked();
  g.nodes = g.nodes.map((n) => (n.id === 'mod_54' ? { ...n, proposed_by: 'olumi' } : n));
  return g;
};

/**
 * The hash of `unmarked()` computed by the 0.63.0 build (projection v3; CEE staging with `vendor/…-0.63.0.tgz`,
 * 29 Sep). Pinned so "no mass stale" is proven by identity, not argued: a graph with no marker hashes byte-identically
 * across the vocabulary move.
 */
const UNMARKED_HASH_UNDER_V3 = '362137a00c45afb4';

describe('0.64.0 — `proposed_by` enters the analysis revision (projection v4)', () => {
  it('PRECONDITION: the vendored vocabulary is v6 (0.82.0: v5 + node `event_risk` appended), whose node fields still carry `proposed_by` immediately before `event_risk`', () => {
    expect(CANONICAL_GRAPH_HASH_PROJECTION_VERSION).toBe(6);
    const fields: readonly string[] = CANONICAL_GRAPH_HASH_NESTED_PROJECTION.node.fields;
    expect(fields.slice(-2)).toEqual(['proposed_by', 'event_risk']);
  });

  it('CONTROL (no mass stale): a graph with NO marker hashes exactly as it did under v3', () => {
    expect(hashOf(unmarked())).toBe(UNMARKED_HASH_UNDER_V3);
  });

  it('H1: adopting Olumi\'s option (the marker removed, nothing else) MOVES the hash — the excluding Run reads stale', () => {
    expect(hashOf(marked())).not.toBe(hashOf(unmarked()));
  });

  it('H1b: adopting participation in place moves the hash while Olumi origin and levels remain', () => {
    const adopted = marked();
    adopted.nodes = adopted.nodes.map((n) => n.id === 'mod_54' ? { ...n, analysis_participation: 'included' } : n);
    expect(adopted.nodes.find((n) => n.id === 'mod_54')?.proposed_by).toBe('olumi');
    expect(hashOf(adopted)).not.toBe(hashOf(marked()));
  });

  it('H2: a label-only edit on the proposed option does NOT move the hash', () => {
    const relabelled = marked();
    relabelled.nodes = relabelled.nodes.map((n) => (n.id === 'mod_54' ? { ...n, label: 'A £54 Pro tier' } : n));
    expect(hashOf(relabelled)).toBe(hashOf(marked()));
  });

  it('CONTRAST: authorship DISPLAY fields (provenance, origin) still do not move it — only the typed marker does', () => {
    const display = marked();
    display.nodes = display.nodes.map((n) => (n.id === 'mod_54' ? { ...n, provenance: { source: 'ai_proposed' }, origin: 'ai' } : n));
    expect(hashOf(display)).toBe(hashOf(marked()));
  });
});

/**
 * 0.68.0 vendor (projection v5 = v4 + intervention `range`, TEMPORAL 0.66): landing it must not stale a saved Run. The
 * served c96fc4bb graph (no ranges) hashed `e47035a047b57bc1` under the 0.64.0 build (CEE staging `5113d8cd`, projection
 * v4) — measured 30 Sep with `computeAnalysisAffectingGraphHash` in both trees, as were 3 served cold reads (all equal).
 * CEE's `projectIntervention` hand-lists its fields; `range` joins it in TEMPORAL #2382, which carries its own row.
 */
const SERVED_C96_HASH_UNDER_V4 = 'e47035a047b57bc1';
const servedC96 = (): Rec => (JSON.parse(readFileSync(new URL('../../agent-lane/__tests__/fixtures/served-c96fc4bb-registered-graph-77afc7b.json', import.meta.url), 'utf8')) as { graph: Rec }).graph;

describe('0.68.0 vendor — a served graph hashes exactly as it did under 0.64.0 (no mass stale)', () => {
  it('CONTROL: the served c96fc4bb graph keeps its v4 hash', () => {
    expect(hashOf(servedC96())).toBe(SERVED_C96_HASH_UNDER_V4);
  });

  it('POSITIVE: the same graph with one option\'s stated £59 moved to £60 hashes differently (the probe sees a hashed intervention field)', () => {
    const g = servedC96() as { nodes: Rec[] };
    const option = g.nodes.find((n) => n.id === 'raise_price_to_59')!;
    const iv = (option.interventions as Rec).pro_plan_price as Rec;
    expect(iv.raw_value).toBe(59);
    (option.interventions as Rec).pro_plan_price = { ...iv, raw_value: 60 };
    expect(hashOf(g)).not.toBe(SERVED_C96_HASH_UNDER_V4);
  });
});
