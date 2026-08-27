/**
 * format-graph-for-context — display-safe graph projection tests
 * (brief A2.1 → A3.1 Task 6 → A2.2).
 *
 * The formatter is the upstream boundary that prevents raw graph
 * `strength` floats and raw `exists` probabilities from reaching
 * Sonnet via the LLM-facing context pack. These tests pin:
 *   - band/sign mapping across boundaries (0.65 → moderate, 0.70 → strong)
 *   - near-zero suppression (|s| < 0.05 → "negligible link", sign dropped)
 *   - label resolution from node lookup (bare ID fallback when missing)
 *   - structural strip of strength / std / exists / plain_interpretation,
 *     while the compactor's closed coefficient-confidence band survives
 *   - A3.1 Task 6 strip of node-level `value` / `raw_value` / `cap`
 *     (compact-top-level AND canonical `observed_state.*`) — Sonnet
 *     never sees raw node numerics
 *   - A2.2 reintroduction of formatted `display_value` only:
 *     existing handler-stamped value preferred verbatim; otherwise
 *     synthesised via `synthesiseDisplayValue`; bare-number guard
 *     rejects unit-less results so the display channel cannot leak
 *     model-scale floats
 *   - relationship-phrase allowlist: unsafe upstream strings (e.g. legacy
 *     "strength of 0.55") MUST be dropped, not echoed verbatim
 *   - no-raw-floats invariant inside edge data (recursive walk)
 *   - idempotency (re-projecting the output produces equivalent shape)
 *   - Track 2A negative test: serialised display-safe graph yields
 *     `structural_matches === 0` from `sanitiseAssistantTextProse`
 */

import { describe, expect, it } from 'vitest';

import {
  CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
  NODE_DESCRIPTION_CONTEXT_MAX_CHARS,
} from '../../../orchestrator/context/graph-compact.js';
import type { ContextPackGraph } from '../../context/context-pack-assembler.js';
import {
  bidirectedRelationshipPhrase,
  formatGraphForContext,
  relationshipPhrase,
  type DisplaySafeGraph,
} from '../format-graph-for-context.js';
import { bandFromMagnitude, NEAR_ZERO_INFLUENCE_THRESHOLD } from '../influence-bands.js';
import { sanitiseAssistantTextProse } from '../numeric-prose-formatter.js';

function rawGraph(overrides: Partial<ContextPackGraph> = {}): ContextPackGraph {
  return {
    nodes: [
      { id: 'fac_marketing', kind: 'factor', label: 'Marketing Spend', value: 100, raw_value: 100, unit: 'k', cap: 500, source: 'user', _raw_provenance: 'brief_extracted', category: 'spend' },
      { id: 'fac_leads', kind: 'factor', label: 'New Leads', value: 50 },
      { id: 'opt_a', kind: 'option', label: 'Option A', intervention_summary: 'sets Marketing=200' },
      { id: 'goal_growth', kind: 'goal', label: 'Quarterly Growth' },
    ],
    edges: [
      { from: 'fac_marketing', to: 'fac_leads', strength: 0.65, exists: 0.9, plain_interpretation: 'Marketing has a strength of 0.65 on Leads', coefficient_confidence: 'moderate', provenance: 'ai_inferred', _raw_provenance: 'inferred' },
      { from: 'fac_leads', to: 'goal_growth', strength: -0.4, exists: 0.7 },
    ],
    options: [{ id: 'opt_a', label: 'Option A' }],
    goals: [{ id: 'goal_growth', kind: 'goal', label: 'Quarterly Growth' }],
    constraints: [],
    counts: { nodes: 4, edges: 2, options: 1, goals: 1, constraints: 0 },
    ...overrides,
  };
}

/**
 * Recursive walk asserting no `number` values anywhere on edge data.
 * Targets edges only — display-safe nodes have no numeric fields
 * post-A3.1 Task 6 (raw `value` / `raw_value` / `cap` stripped) and
 * post-A2.2 only carry the formatted `display_value` string. The
 * forbidden-floats check on serialised edges below pins the
 * no-raw-decimals invariant for the edge channel.
 */
function assertNoNumbersInEdges(edges: readonly unknown[]): void {
  function walk(value: unknown, path: string): void {
    if (value === null || value === undefined) return;
    if (typeof value === 'number') {
      throw new Error(`Found number on edge at ${path}: ${value}`);
    }
    if (typeof value === 'string' || typeof value === 'boolean') return;
    if (Array.isArray(value)) {
      value.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        walk(v, `${path}.${k}`);
      }
    }
  }
  edges.forEach((edge, i) => walk(edge, `edges[${i}]`));
}

describe('relationshipPhrase', () => {
  it('classifies positive bands by magnitude', () => {
    expect(relationshipPhrase(0.65)).toBe('moderate positive link');
    expect(relationshipPhrase(0.70)).toBe('strong positive link');
    expect(relationshipPhrase(0.95)).toBe('very strong positive link');
    expect(relationshipPhrase(0.99)).toBe('very strong positive link');
    expect(relationshipPhrase(0.10)).toBe('weak positive link');
  });

  it('classifies negative bands and preserves sign', () => {
    expect(relationshipPhrase(-0.25)).toBe('weak negative link');
    expect(relationshipPhrase(-0.5)).toBe('moderate negative link');
    expect(relationshipPhrase(-0.85)).toBe('strong negative link');
    expect(relationshipPhrase(-1.0)).toBe('very strong negative link');
  });

  it('treats |strength| < 0.05 as negligible (sign suppressed)', () => {
    expect(relationshipPhrase(0.02)).toBe('negligible link');
    expect(relationshipPhrase(-0.02)).toBe('negligible link');
    expect(relationshipPhrase(0)).toBe('negligible link');
  });

  it('handles non-finite strengths defensively', () => {
    expect(relationshipPhrase(Number.NaN)).toBe('negligible link');
    expect(relationshipPhrase(Number.POSITIVE_INFINITY)).toBe('negligible link');
  });

  it('crosses band boundaries inclusively at lower bound', () => {
    expect(relationshipPhrase(0.30)).toBe('moderate positive link');
    expect(relationshipPhrase(0.299)).toBe('weak positive link');
  });
});

const COMMON_CAUSE = 'unmeasured common cause (not a causal route)';

/** Two factors joined by one bidirected edge — the ratified factor<->factor shape. */
function bidirectedGraph(strength: number): ContextPackGraph {
  return {
    nodes: [
      { id: 'fac_a', kind: 'factor', label: 'Factor A' },
      { id: 'fac_b', kind: 'factor', label: 'Factor B' },
    ],
    edges: [{ from: 'fac_a', to: 'fac_b', strength, exists: 0.9, edge_type: 'bidirected' }],
    options: [],
    goals: [],
    constraints: [],
    counts: { nodes: 2, edges: 1, options: 0, goals: 0, constraints: 0 },
  } as unknown as ContextPackGraph;
}

describe('bidirectedRelationshipPhrase', () => {
  it('keeps the band and the sign, and carries the negation in the predicate', () => {
    expect(bidirectedRelationshipPhrase(0.5)).toBe(`moderate positive co-movement, ${COMMON_CAUSE}`);
    expect(bidirectedRelationshipPhrase(0.85)).toBe(`strong positive co-movement, ${COMMON_CAUSE}`);
    expect(bidirectedRelationshipPhrase(-0.85)).toBe(`strong negative co-movement, ${COMMON_CAUSE}`);
    expect(bidirectedRelationshipPhrase(-0.25)).toBe(`weak negative co-movement, ${COMMON_CAUSE}`);
    expect(bidirectedRelationshipPhrase(0.99)).toBe(`very strong positive co-movement, ${COMMON_CAUSE}`);
  });

  it('never emits directed-route language at any band or sign', () => {
    for (const s of [-1, -0.85, -0.5, -0.25, -0.02, 0, 0.02, 0.25, 0.5, 0.85, 1]) {
      expect(bidirectedRelationshipPhrase(s)).not.toMatch(/\blink\b/);
      expect(bidirectedRelationshipPhrase(s)).toContain(COMMON_CAUSE);
    }
  });

  it('shares the directed path band boundaries exactly — one source of truth', () => {
    // Forking the band constants would let the two families disagree about
    // where "moderate" starts. Both read influence-bands.ts.
    expect(bidirectedRelationshipPhrase(0.30)).toContain('moderate');
    expect(bidirectedRelationshipPhrase(0.299)).toContain('weak');
    expect(bidirectedRelationshipPhrase(0.95)).toContain('very strong');
  });

  it('suppresses sign below the near-zero threshold, mirroring the directed path', () => {
    expect(bidirectedRelationshipPhrase(0.02)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
    expect(bidirectedRelationshipPhrase(-0.02)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
    expect(bidirectedRelationshipPhrase(0)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
  });

  it('handles non-finite strengths defensively', () => {
    expect(bidirectedRelationshipPhrase(Number.NaN)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
    expect(bidirectedRelationshipPhrase(Number.POSITIVE_INFINITY)).toBe(`negligible co-movement, ${COMMON_CAUSE}`);
  });
});

describe('bidirected phrase allowlist — derived corpus, not a hand-maintained mirror', () => {
  it('ALL_BIDIRECTED_BAND_PHRASES_SURVIVE_REPROJECTION', () => {
    // Deriving the allowlist check from the list proves the copies AGREE; only
    // a corpus notices the list is SHORT. Re-projection carries no numeric
    // strength, so a band+sign missing from BIDIRECTED_RELATIONSHIP_PHRASES is
    // silently rewritten to the negligible phrase on pass 2 — a false
    // smallness claim under a green suite. This sweeps the whole signed band
    // space and REDs if any member fails to round-trip.
    const magnitudes = [0, 0.02, 0.049, 0.05, 0.1, 0.299, 0.3, 0.5, 0.69, 0.7, 0.85, 0.949, 0.95, 1];
    const observed = new Set<string>();
    const expected = new Set<string>();
    for (const magnitude of magnitudes) {
      for (const signed of [magnitude, -magnitude]) {
        const abs = Math.abs(signed);
        expected.add(
          abs < NEAR_ZERO_INFLUENCE_THRESHOLD
            ? 'negligible'
            : `${bandFromMagnitude(abs)} ${signed < 0 ? 'negative' : 'positive'}`,
        );

        const once = formatGraphForContext(bidirectedGraph(signed));
        const first = once.edges[0]!;
        expect(first.relationship).toBe(bidirectedRelationshipPhrase(signed));

        const twice = formatGraphForContext({
          ...bidirectedGraph(signed),
          nodes: once.nodes as unknown as ContextPackGraph['nodes'],
          edges: once.edges as unknown as ContextPackGraph['edges'],
        });
        expect(
          twice.edges[0]!.relationship,
          `phrase for signed strength ${signed} is not allowlisted — re-projection rewrote it`,
        ).toBe(first.relationship);
        expect(twice.edges[0]!.edge_type).toBe('bidirected');
        observed.add(first.relationship.split(' co-movement')[0]!);
      }
    }
    // Positive control on the corpus itself: a sweep that exercised only one
    // band would round-trip perfectly and prove nothing about completeness.
    expect(expected.size).toBeGreaterThanOrEqual(9);
    expect(observed).toEqual(expected);
  });
});

describe('formatGraphForContext — edge transformation', () => {
  it('replaces strength / exists / plain_interpretation with relationship phrase', () => {
    const out = formatGraphForContext(rawGraph());
    expect(out.edges[0]).toEqual({
      from: 'fac_marketing',
      to: 'fac_leads',
      from_label: 'Marketing Spend',
      to_label: 'New Leads',
      relationship: 'moderate positive link',
      coefficient_confidence: 'moderate',
      provenance: 'ai_inferred',
    });
    expect(out.edges[1]).toEqual({
      from: 'fac_leads',
      to: 'goal_growth',
      from_label: 'New Leads',
      to_label: 'Quarterly Growth',
      relationship: 'moderate negative link',
    });
  });

  it('falls back to bare ID when a node label is missing', () => {
    const graph = rawGraph({
      edges: [{ from: 'fac_unknown', to: 'fac_leads', strength: 0.8 }],
    });
    const out = formatGraphForContext(graph);
    expect(out.edges[0]!.from_label).toBe('fac_unknown');
    expect(out.edges[0]!.to_label).toBe('New Leads');
  });

  it('from_label / to_label carry human labels when the node lookup resolves (no internal ID prefixes)', () => {
    const out = formatGraphForContext(rawGraph());
    const ID_PREFIX = /^(fac|opt|goal|risk|out|edge)_/;
    for (const edge of out.edges) {
      // When the lookup resolves (every fixture edge endpoint is present
      // in the node list), display labels MUST be human-readable strings,
      // not internal `fac_…`/`opt_…` IDs. The structured `from`/`to` ID
      // handles are kept separately for routing/traceability.
      expect(edge.from_label).not.toMatch(ID_PREFIX);
      expect(edge.to_label).not.toMatch(ID_PREFIX);
    }
  });

  it('drops _raw_provenance and never emits strength_mean/std/exists_probability', () => {
    const out = formatGraphForContext(rawGraph());
    const json = JSON.stringify(out);
    expect(json).not.toMatch(/strength_mean/);
    expect(json).not.toMatch(/strength_std/);
    expect(json).not.toMatch(/exists_probability/);
    expect(json).not.toMatch(/_raw_provenance/);
    expect(json).not.toMatch(/plain_interpretation/);
    // No `"strength":` or `"exists":` keys on edges
    expect(JSON.stringify(out.edges)).not.toMatch(/"strength":/);
    expect(JSON.stringify(out.edges)).not.toMatch(/"exists":/);
  });

  it('contains no raw decimal floats inside edge data', () => {
    const out = formatGraphForContext(rawGraph());
    assertNoNumbersInEdges(out.edges);
    // Belt-and-braces regex on serialised edges only (counts/nodes excluded).
    expect(JSON.stringify(out.edges)).not.toMatch(/\b-?0\.\d/);
  });

  it('carries only the compactor confidence vocabulary', () => {
    const out = formatGraphForContext(
      rawGraph({
        edges: [
          { from: 'fac_marketing', to: 'fac_leads', strength: 0.5, coefficient_confidence: 'high' },
          { from: 'fac_leads', to: 'goal_growth', strength: 0.5, coefficient_confidence: 'moderate' },
          { from: 'fac_marketing', to: 'goal_growth', strength: 0.5, coefficient_confidence: 'uncertain' },
          { from: 'goal_growth', to: 'fac_marketing', strength: 0.5, coefficient_confidence: 'very_high' },
        ],
      }),
    );
    expect(out.edges.map((edge) => edge.coefficient_confidence ?? null)).toEqual([
      'high',
      'moderate',
      'uncertain',
      null,
    ]);
  });
});

describe('formatGraphForContext — node transformation', () => {
  it('keeps id/label/kind plus optional category, unit, intervention_summary, display_value (A2.2)', () => {
    const out = formatGraphForContext(rawGraph());
    // V5 D1 golden-path closure (A3.1 Task 6): node-level `value`,
    // `raw_value`, and `cap` are stripped. A2.2 reintroduces a
    // formatted `display_value` string only — the underlying floats
    // remain stripped. The fixture's marketing node has raw_value=100
    // + unit='k' → "100 k" via `synthesiseDisplayValue` priority-4.
    expect(out.nodes[0]).toEqual({
      id: 'fac_marketing',
      label: 'Marketing Spend',
      kind: 'factor',
      category: 'spend',
      unit: 'k',
      display_value: '100 k',
    });
    const optionNode = out.nodes.find((n) => n.id === 'opt_a')!;
    expect(optionNode).toEqual({
      id: 'opt_a',
      label: 'Option A',
      kind: 'option',
      intervention_summary: 'sets Marketing=200',
    });
  });

  it('carries only literal baseline identity on option nodes', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'opt_current', kind: 'option', label: 'Current approach', is_baseline: true },
          { id: 'opt_change', kind: 'option', label: 'Change', is_baseline: false },
          { id: 'opt_named_status_quo', kind: 'option', label: 'Status quo' },
          { id: 'opt_malformed', kind: 'option', label: 'Malformed', is_baseline: 'true' },
          { id: 'fac_wrong_kind', kind: 'factor', label: 'Factor', is_baseline: true },
        ],
      }),
    );

    expect(out.nodes.find((node) => node.id === 'opt_current')?.is_baseline).toBe(true);
    for (const id of ['opt_change', 'opt_named_status_quo', 'opt_malformed', 'fac_wrong_kind']) {
      expect(out.nodes.find((node) => node.id === id)).not.toHaveProperty('is_baseline');
    }
  });

  it('A3.1: node-level value (compact + canonical observed_state) is stripped from display projection', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', value: 250 },
          { id: 'fac_b', kind: 'factor', label: 'B', value: 'high' },
          { id: 'fac_c', kind: 'factor', label: 'C', observed_state: { value: 99 } },
        ],
      }),
    );
    for (const node of out.nodes) {
      expect(node).not.toHaveProperty('value');
      expect(node).not.toHaveProperty('raw_value');
      expect(node).not.toHaveProperty('cap');
    }
  });

  it('strips raw_value, cap, source, _raw_provenance, AND value (A3.1) from the display projection', () => {
    const out = formatGraphForContext(rawGraph());
    const json = JSON.stringify(out.nodes);
    expect(json).not.toMatch(/"raw_value":/);
    expect(json).not.toMatch(/"cap":/);
    expect(json).not.toMatch(/"source":/);
    expect(json).not.toMatch(/_raw_provenance/);
    // V5 D1 golden-path closure (A3.1 Task 6): node-level `value`
    // also stripped. Brief A2.1 originally retained it; the post-A3
    // review reversed that decision because exposing any node
    // numeric encouraged Sonnet to echo it as structural fact.
    expect(json).not.toMatch(/"value":/);
  });

  it('drops nodes missing required id/label/kind defensively', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A' },
          { id: 'fac_b', kind: 'factor' }, // missing label — dropped
          { id: 'fac_c' }, // missing kind & label — dropped
        ],
      }),
    );
    expect(out.nodes).toHaveLength(1);
    expect(out.nodes[0]!.id).toBe('fac_a');
  });

  it('carries only bounded saved node descriptions on compact and raw graph paths', () => {
    const longDescription = 'D'.repeat(NODE_DESCRIPTION_CONTEXT_MAX_CHARS + 20);
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', description: 'Saved rationale' },
          { id: 'fac_b', kind: 'factor', label: 'B', description: longDescription },
          { id: 'fac_c', kind: 'factor', label: 'C', description: { text: 'not licensed' } },
        ],
      }),
    );

    expect(out.nodes[0]!.description).toBe('Saved rationale');
    expect(out.nodes[1]!.description).toBe(
      `${longDescription.slice(0, NODE_DESCRIPTION_CONTEXT_MAX_CHARS - 1)}…`,
    );
    expect(out.nodes[1]!.description).toHaveLength(NODE_DESCRIPTION_CONTEXT_MAX_CHARS);
    expect(out.nodes[2]).not.toHaveProperty('description');
  });

  it('A3.1: canonical observed_state.value is also stripped from the display projection', () => {
    // V5 D1 golden-path closure (A3.1 Task 6): both compact top-level
    // `value` and canonical `observed_state.value` are dropped from
    // the LLM-facing projection. The raw ContextPack.graph still
    // carries them for handler / freshness / edit_graph reads.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 250 } },
          { id: 'fac_b', kind: 'factor', label: 'B', observed_state: { value: 'high' } },
          { id: 'fac_c', kind: 'factor', label: 'C', value: 7, observed_state: { value: 99 } },
        ],
      }),
    );
    for (const node of out.nodes) {
      expect(node).not.toHaveProperty('value');
    }
  });

  it('reads canonical observed_state.unit when top-level unit is absent', () => {
    // Symmetric to value: canonical GraphV3T nests both under
    // observed_state. Without this fallback "100" vs "100k" change
    // meaning when the raw-graph path doesn't pre-compact.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', observed_state: { value: 100, unit: 'k' } },
          { id: 'fac_b', kind: 'factor', label: 'B', observed_state: { unit: '%' } },
          // Top-level unit wins when both are present.
          { id: 'fac_c', kind: 'factor', label: 'C', unit: 'GBP', observed_state: { unit: 'USD' } },
        ],
      }),
    );
    expect(out.nodes[0]!.unit).toBe('k');
    expect(out.nodes[1]!.unit).toBe('%');
    expect(out.nodes[2]!.unit).toBe('GBP');
  });
});

describe('formatGraphForContext — producer uncertainty passthrough', () => {
  it('preserves producer strings and order without local interpretation', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          {
            id: 'fac_platform',
            kind: 'factor',
            label: 'Platform capability',
            observed_state: {
              uncertainty_drivers: [
                'Current platform capability not specified',
                'Workflow fit unconfirmed',
              ],
            },
          },
        ],
      }),
    );
    expect(out.nodes[0]!.uncertainty_drivers).toEqual([
      'Current platform capability not specified',
      'Workflow fit unconfirmed',
    ]);
    expect(out.nodes[0]).not.toHaveProperty('uncertainty_drivers_disclosure');
  });

  it('withholds conflicting top-level and observed-state values', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          {
            id: 'fac_platform',
            kind: 'factor',
            label: 'Platform capability',
            uncertainty_drivers: ['Promoted value'],
            observed_state: { uncertainty_drivers: ['Observed-state value'] },
          },
        ],
      }),
    );
    expect(out.nodes[0]).not.toHaveProperty('uncertainty_drivers');
    expect(out.nodes[0]!.uncertainty_drivers_disclosure).toEqual({
      status: 'conflicting_sources_withheld',
    });
  });

  it('preserves truthful bounds disclosure and is idempotent on its own output', () => {
    const overlong = 'x'.repeat(CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS + 1);
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          {
            id: 'fac_platform',
            kind: 'factor',
            label: 'Platform capability',
            uncertainty_drivers: [overlong, 'Second exact entry', 'Count-bounded entry'],
          },
        ],
        goals: [],
      }),
    );
    expect(out.nodes[0]!.uncertainty_drivers).toEqual([
      overlong.slice(0, CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS),
      'Second exact entry',
    ]);
    expect(out.nodes[0]!.uncertainty_drivers_disclosure).toEqual({
      status: 'truncated',
      original_entries: 3,
      retained_entries: 2,
      entries_omitted_by_count: 1,
      entries_truncated_by_chars: 1,
      per_entry_char_limit: CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
    });
    expect(formatGraphForContext(out as unknown as ContextPackGraph)).toEqual(out);
  });

  it('adds no uncertainty keys when the producer supplied none', () => {
    const out = formatGraphForContext(rawGraph());
    expect(JSON.stringify(out)).not.toContain('uncertainty_driver');
  });

  it('does not promote uncertainty-shaped metadata from non-factor nodes', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          {
            id: 'goal_growth',
            kind: 'goal',
            label: 'Growth',
            uncertainty_drivers: ['Out-of-scope goal metadata'],
            observed_state: { uncertainty_drivers: ['Out-of-scope goal metadata'] },
          },
        ],
      }),
    );
    expect(out.nodes[0]).not.toHaveProperty('uncertainty_drivers');
    expect(out.nodes[0]).not.toHaveProperty('uncertainty_drivers_disclosure');
  });
});

describe('formatGraphForContext — canonical & legacy edge shapes', () => {
  it('handles canonical GraphV3T edges with strength: { mean, std } + effect_direction', () => {
    const out = formatGraphForContext(
      rawGraph({
        edges: [
          {
            from: 'fac_marketing',
            to: 'fac_leads',
            strength: { mean: 0.55, std: 0.12 },
            exists_probability: 0.9,
            effect_direction: 'positive',
          },
          {
            from: 'fac_leads',
            to: 'goal_growth',
            strength: { mean: 0.4, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'negative',
          },
        ],
      }),
    );
    expect(out.edges[0]!.relationship).toBe('moderate positive link');
    expect(out.edges[1]!.relationship).toBe('moderate negative link');
    // Raw fields fully stripped from canonical-shape output.
    const json = JSON.stringify(out.edges);
    expect(json).not.toMatch(/"strength":/);
    expect(json).not.toMatch(/"strength_mean":/);
    expect(json).not.toMatch(/"strength_std":/);
    expect(json).not.toMatch(/"exists_probability":/);
    expect(json).not.toMatch(/"effect_direction":/);
    expect(json).not.toMatch(/\b-?0\.\d/);
  });

  it('handles legacy edges with top-level strength_mean + effect_direction', () => {
    const out = formatGraphForContext(
      rawGraph({
        edges: [
          {
            from: 'fac_marketing',
            to: 'fac_leads',
            strength_mean: 0.85,
            effect_direction: 'positive',
          },
          {
            from: 'fac_leads',
            to: 'goal_growth',
            strength_mean: 0.6,
            effect_direction: 'negative',
          },
        ],
      }),
    );
    expect(out.edges[0]!.relationship).toBe('strong positive link');
    expect(out.edges[1]!.relationship).toBe('moderate negative link');
  });

  it('treats signed numeric strength as the source of truth (no direction inversion)', () => {
    const out = formatGraphForContext(
      rawGraph({
        edges: [
          { from: 'fac_marketing', to: 'fac_leads', strength: -0.5, effect_direction: 'positive' },
        ],
      }),
    );
    // Numeric `strength` is already signed — `effect_direction` MUST NOT
    // overwrite a signed numeric. The brief defines compact edges as
    // sign-bearing; only canonical {mean} gets direction applied.
    expect(out.edges[0]!.relationship).toBe('moderate negative link');
  });
});

describe('formatGraphForContext — duplicate indexes and passthrough fields', () => {
  it('projects options to display identity only while preserving constraints and counts', () => {
    const raw = rawGraph();
    const out = formatGraphForContext(raw);
    expect(out.options).toEqual([{ id: 'opt_a', label: 'Option A' }]);
    expect(out.options).not.toBe(raw.options);
    expect(out.constraints).toBe(raw.constraints);
    expect(out.counts).toBe(raw.counts);
  });

  it('strips a conflicting baseline marker and ranking fields from raw/direct options', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'opt_current', kind: 'option', label: 'Current approach', is_baseline: true },
          { id: 'opt_change', kind: 'option', label: 'Alternative' },
        ],
        options: [
          {
            id: 'opt_current',
            label: 'Current approach',
            is_baseline: false,
            decision_score: 0.01,
            status: 'ready',
          },
          {
            id: 'opt_change',
            label: 'Alternative',
            is_baseline: true,
            decision_score: 0.99,
            interventions: { fac_cost: 1 },
          },
          { id: 'opt_missing_label', is_baseline: true },
          null,
          'opt_primitive',
        ],
      }),
    );

    expect(out.nodes.filter((node) => node.is_baseline === true)).toEqual([
      expect.objectContaining({ id: 'opt_current' }),
    ]);
    expect(out.options).toEqual([
      { id: 'opt_current', label: 'Current approach' },
      { id: 'opt_change', label: 'Alternative' },
    ]);
    expect(JSON.stringify(out.options)).not.toMatch(
      /is_baseline|decision_score|status|interventions/,
    );
  });

  /**
   * `goals` USED TO BE ASSERTED HERE as `expect(out.goals).toBe(raw.goals)` —
   * a referential-identity pin on a passthrough that was a raw-value LEAK.
   * `goals` is a by-kind index of `nodes`, so every goal reached Sonnet twice:
   * stripped via `nodes`, raw via `goals`, carrying `value`/`raw_value`/`cap`.
   *
   * ⚠ Worth recording WHY this suite could not see it. `rawGraph()`'s goal
   * (`goal_growth`) carries NO numeric fields, so its projection is visually
   * identical to its raw form — when the fix landed, this assertion failed with
   * *"Compared values have no visual difference"*. And `assertNoNumbersInEdges`,
   * the no-raw-floats guard in this file, is scoped to EDGES by name. A corpus
   * that omits the value class the contract admits cannot certify the code over
   * that class (trap 22). The valued-goal case below closes that gap.
   */
  it('projects goals through projectNode — stripping raw floats, keeping display_value', () => {
    const raw = rawGraph({
      nodes: [
        { id: 'opt_a', kind: 'option', label: 'Option A' },
        { id: 'goal_churn', kind: 'goal', label: 'Reduce Churn', value: 0.42, raw_value: 42, unit: '%', cap: 100, source: 'user', provenance: 'user' },
      ],
      goals: [
        { id: 'goal_churn', kind: 'goal', label: 'Reduce Churn', value: 0.42, raw_value: 42, unit: '%', cap: 100, source: 'user', provenance: 'user' },
      ],
    });
    const out = formatGraphForContext(raw);

    expect(out.goals).toHaveLength(1);
    const goal = out.goals[0]!;

    // PRESENCE — an absence assertion alone would pass on an empty projection.
    expect(goal.id).toBe('goal_churn');
    expect(goal.label).toBe('Reduce Churn');
    expect(goal.kind).toBe('goal');
    expect(goal.unit).toBe('%');
    expect(goal.display_value).toBe('42%');

    // ABSENCE — the raw-value cage, now covering the goals channel too.
    expect(goal).not.toHaveProperty('value');
    expect(goal).not.toHaveProperty('raw_value');
    expect(goal).not.toHaveProperty('cap');
    expect(goal).not.toHaveProperty('provenance');
    expect(goal).not.toHaveProperty('source');

    // The invariant the fix rests on: `goals` is an index of `nodes`, so the
    // two projections of one node must agree exactly.
    const asNode = out.nodes.find((n) => n.id === 'goal_churn');
    expect(asNode).toBeDefined();
    expect(goal).toEqual(asNode);
  });
});

describe('formatGraphForContext — idempotency', () => {
  it('re-projection preserves relationship phrases (does not overwrite to "negligible")', () => {
    const out1 = formatGraphForContext(rawGraph());
    const out2 = formatGraphForContext(out1 as unknown as ContextPackGraph);
    // Strict deep equality — the second pass sees no `strength`, but
    // honours the existing `relationship` rather than degrading every
    // edge to "negligible link".
    expect(out2).toEqual(out1);
  });
});

describe('formatGraphForContext — relationship allowlist (negative test)', () => {
  it('drops unsafe upstream `relationship` strings rather than echoing them', () => {
    // Adversarial input: an edge with no numeric strength but an
    // upstream-supplied `relationship` string that contains raw decimal
    // prose ("strength of 0.55"). If the formatter passed this through
    // verbatim it would defeat the entire display-safe projection.
    // The allowlist guarantees only canonical band×sign phrases survive.
    const out = formatGraphForContext(
      rawGraph({
        edges: [
          {
            from: 'fac_marketing',
            to: 'fac_leads',
            relationship: 'strength of 0.55',
          },
          {
            from: 'fac_leads',
            to: 'goal_growth',
            relationship: 'edge weight 0.4',
          },
          {
            from: 'fac_marketing',
            to: 'goal_growth',
            relationship: 'mean=0.7 between Marketing and Growth',
          },
        ],
      }),
    );
    for (const edge of out.edges) {
      expect(edge.relationship).toBe('negligible link');
      // Belt-and-braces: no raw decimals slipped through anywhere.
      expect(edge.relationship).not.toMatch(/0\.\d/);
      expect(edge.relationship).not.toMatch(/strength|weight|mean=/i);
    }
  });

  it('preserves a canonical allowlisted `relationship` when no strength is present', () => {
    const out = formatGraphForContext(
      rawGraph({
        edges: [
          {
            from: 'fac_marketing',
            to: 'fac_leads',
            relationship: 'strong positive link',
          },
        ],
      }),
    );
    expect(out.edges[0]!.relationship).toBe('strong positive link');
  });
});

describe('Track 2A — display-safe graph yields zero structural matches', () => {
  it('serialised display-safe graph contains no raw-edge prose patterns', () => {
    const displaySafe: DisplaySafeGraph = formatGraphForContext(rawGraph());
    const serialised = JSON.stringify(displaySafe, null, 2);
    const result = sanitiseAssistantTextProse(serialised);
    expect(result.structural_matches).toBe(0);
  });
});

describe('formatGraphForContext — display_value (A2.2)', () => {
  it('passes through an existing display_value verbatim (handler-set)', () => {
    // Source priority #1: when the raw input already carries a non-empty
    // string `display_value` (e.g. set by `set_factor_value` post-mutation
    // via A3.1 Task 3), the projector uses it verbatim — including over
    // any value/raw_value/unit data that might otherwise drive a different
    // synthesised result.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          {
            id: 'fac_churn',
            kind: 'factor',
            label: 'Churn Rate',
            unit: '%',
            value: 0.99,
            raw_value: 99,
            display_value: '5%',
          },
        ],
      }),
    );
    expect(out.nodes[0]!.display_value).toBe('5%');
  });

  it('synthesises display_value from raw_value + percentage unit when none is supplied', () => {
    // Source priority #2: no existing display_value, so the projector
    // calls `synthesiseDisplayValue` against value/raw_value/unit/cap/
    // factor_type. raw_value=5 + unit='%' → "5%".
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_churn', kind: 'factor', label: 'Churn Rate', raw_value: 5, unit: '%' },
        ],
      }),
    );
    expect(out.nodes[0]!.display_value).toBe('5%');
  });

  it('synthesises currency display_value from raw_value + currency unit', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_spend', kind: 'factor', label: 'Marketing Spend', raw_value: 50000, unit: '£' },
        ],
      }),
    );
    expect(out.nodes[0]!.display_value).toBe('£50k');
  });

  it('synthesises time-unit display_value (e.g. "18 months")', () => {
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_runway', kind: 'factor', label: 'Runway', raw_value: 18, unit: 'months' },
        ],
      }),
    );
    expect(out.nodes[0]!.display_value).toBe('18 months');
  });

  it('reads canonical observed_state.{value,raw_value,unit,cap,factor_type} when compact-top-level is absent', () => {
    // Mirror of the existing `extractNodeUnit` two-tier pattern: the
    // projector falls back to canonical GraphV3T nesting under
    // observed_state when the compact top-level is absent.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          {
            id: 'fac_churn',
            kind: 'factor',
            label: 'Churn Rate',
            observed_state: { raw_value: 5, unit: '%', cap: 100 },
          },
        ],
      }),
    );
    expect(out.nodes[0]!.display_value).toBe('5%');
  });

  it('omits display_value when neither display_value nor synthesisable inputs are present', () => {
    // Source priority neither #1 nor #2 satisfied → field omitted (not
    // `undefined`/`null`). Belt-and-braces: the in-memory shape lacks the
    // key AND the serialised JSON has no `"display_value":` token.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A' },
          { id: 'opt_x', kind: 'option', label: 'Option X' },
        ],
      }),
    );
    for (const node of out.nodes) {
      expect(node).not.toHaveProperty('display_value');
    }
    expect(JSON.stringify(out.nodes)).not.toMatch(/"display_value":/);
  });

  it('raw-decimal guard: bare-decimal synthesise output is rejected (no unit/factor_type fallback)', () => {
    // `synthesiseDisplayValue` falls through to a bare normalised decimal
    // ("0.75") when only `value` is supplied and there is no unit / cap /
    // factor_type. That string IS the model-scale float — exactly what
    // A3.1 Task 6 stripped at the raw-numeric layer. The guard must
    // discard it so the display channel cannot become a back-door for
    // raw model floats.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', value: 0.75 },
          { id: 'fac_b', kind: 'factor', label: 'B', value: 0.05 },
          { id: 'fac_c', kind: 'factor', label: 'C', value: -0.5 },
        ],
      }),
    );
    for (const node of out.nodes) {
      expect(node).not.toHaveProperty('display_value');
    }
  });

  it('bare-number guard also rejects unit-less integer-valued synthesise output', () => {
    // `synthesiseDisplayValue` priority-7 emits `String(parseFloat(value
    // .toFixed(2)))` for unit-less normalised values. Whole numbers
    // round through to bare integers like "1" / "0" / "5" / "7" — every
    // bit as much a model-scale leak as "0.75". The /^-?0\.\d+$/
    // pattern alone wouldn't catch them; the broadened guard does.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_one', kind: 'factor', label: 'One', value: 1 },
          { id: 'fac_zero', kind: 'factor', label: 'Zero', value: 0 },
          { id: 'fac_seven', kind: 'factor', label: 'Seven', value: 7 },
          { id: 'fac_neg', kind: 'factor', label: 'Neg', value: -3 },
        ],
      }),
    );
    for (const node of out.nodes) {
      expect(node).not.toHaveProperty('display_value');
    }
  });

  it('bare-number guard rejects thousands-separated unit-less raw_value output', () => {
    // `formatPlainNumber` priority-4 with no unit emits comma-separated
    // thousands ("1,000" / "50,000"). Without a unit those are bare
    // model-scale numbers — guard must catch them too, otherwise a
    // raw_value of 50000 with no unit would leak as "50,000".
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', raw_value: 1000 },
          { id: 'fac_b', kind: 'factor', label: 'B', raw_value: 50000 },
        ],
      }),
    );
    for (const node of out.nodes) {
      expect(node).not.toHaveProperty('display_value');
    }
  });

  it('raw-decimal guard rejects unit-less raw_value with bare-decimal output', () => {
    // `raw_value: 0.75` with no unit goes through priority-4 of
    // `synthesiseDisplayValue` and emits the bare decimal "0.75" via
    // `formatPlainNumber`. The guard catches it just like priority-7
    // bare-`value` output above.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          { id: 'fac_a', kind: 'factor', label: 'A', raw_value: 0.75 },
          { id: 'fac_b', kind: 'factor', label: 'B', raw_value: 0.05 },
        ],
      }),
    );
    for (const node of out.nodes) {
      expect(node).not.toHaveProperty('display_value');
    }
  });

  it('raw-decimal guard does not over-trigger on legitimate formatted strings', () => {
    // The guard targets ONLY bare decimals like "0.05" / "1.0" / "-0.5".
    // Anything with a unit / currency / suffix word / qualitative band /
    // ratio MUST pass through untouched — those carry the user-visible
    // semantics A2.2 was introduced to preserve.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          // Pre-formatted handler outputs that should survive verbatim.
          { id: 'n_pct', kind: 'factor', label: 'Pct', display_value: '5%' },
          { id: 'n_cur', kind: 'factor', label: 'Cur', display_value: '£50,000' },
          { id: 'n_time', kind: 'factor', label: 'Time', display_value: '18 months' },
          { id: 'n_rat', kind: 'factor', label: 'Rat', display_value: '4.2/5' },
          { id: 'n_band', kind: 'factor', label: 'Band', display_value: 'Low (0.15)' },
          // Synthesised qualitative band — value + factor_type yields
          // "Low (0.15)" via priority 6 of synthesiseDisplayValue.
          { id: 'n_qual', kind: 'factor', label: 'Qual', value: 0.15, factor_type: 'controllable_action' },
        ],
      }),
    );
    expect(out.nodes.find((n) => n.id === 'n_pct')!.display_value).toBe('5%');
    expect(out.nodes.find((n) => n.id === 'n_cur')!.display_value).toBe('£50,000');
    expect(out.nodes.find((n) => n.id === 'n_time')!.display_value).toBe('18 months');
    expect(out.nodes.find((n) => n.id === 'n_rat')!.display_value).toBe('4.2/5');
    expect(out.nodes.find((n) => n.id === 'n_band')!.display_value).toBe('Low (0.15)');
    expect(out.nodes.find((n) => n.id === 'n_qual')!.display_value).toBe('Low (0.15)');
  });

  it('display_value reintroduction does not regress A3.1 strip — value/raw_value/cap stay absent', () => {
    // A2.2 reintroduces a SINGLE field (display_value, formatted string).
    // The underlying floats remain stripped per A3.1 Task 6 — Sonnet
    // sees the formatted prose only, never the model-scale numeric.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          {
            id: 'fac_churn',
            kind: 'factor',
            label: 'Churn Rate',
            value: 0.05,
            raw_value: 5,
            unit: '%',
            cap: 100,
          },
        ],
      }),
    );
    expect(out.nodes[0]!.display_value).toBe('5%');
    const json = JSON.stringify(out.nodes);
    expect(json).not.toMatch(/"value":/);
    expect(json).not.toMatch(/"raw_value":/);
    expect(json).not.toMatch(/"cap":/);
  });

  it('treats empty-string display_value as absent and falls back to synthesis', () => {
    // Edge case: a handler that cleared `display_value` to "" should not
    // pin an empty string on the projection. The empty-string guard
    // (`existing.length > 0`) routes to the synthesise fallback.
    const out = formatGraphForContext(
      rawGraph({
        nodes: [
          {
            id: 'fac_churn',
            kind: 'factor',
            label: 'Churn Rate',
            display_value: '',
            raw_value: 5,
            unit: '%',
          },
        ],
      }),
    );
    expect(out.nodes[0]!.display_value).toBe('5%');
  });
});
