/**
 * format-graph-for-context — display-safe graph projection tests
 * (brief brief-display-safe-graph A2.1).
 *
 * The formatter is the upstream boundary that prevents raw graph
 * `strength` floats and raw `exists` probabilities from reaching
 * Sonnet via the LLM-facing context pack. These tests pin:
 *   - band/sign mapping across boundaries (0.65 → moderate, 0.70 → strong)
 *   - near-zero suppression (|s| < 0.05 → "negligible link", sign dropped)
 *   - label resolution from node lookup (bare ID fallback when missing)
 *   - structural strip of strength / exists / plain_interpretation /
 *     internal node fields
 *   - no-raw-floats invariant inside edge data (recursive walk)
 *   - idempotency (re-projecting the output produces equivalent shape)
 *   - Track 2A negative test: serialised display-safe graph yields
 *     `structural_matches === 0` from `sanitiseAssistantTextProse`
 */

import { describe, expect, it } from 'vitest';

import type { ContextPackGraph } from '../../context/context-pack-assembler.js';
import {
  formatGraphForContext,
  relationshipPhrase,
  type DisplaySafeGraph,
} from '../format-graph-for-context.js';
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
      { from: 'fac_marketing', to: 'fac_leads', strength: 0.65, exists: 0.9, plain_interpretation: 'Marketing has a strength of 0.65 on Leads', provenance: 'ai_inferred', _raw_provenance: 'inferred' },
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
 * Targets edges only — node `value`/`raw_value`/`cap` are intentionally
 * stripped from display-safe nodes too, but if they ever leak the
 * forbidden-floats check below catches them via JSON.stringify.
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

describe('formatGraphForContext — edge transformation', () => {
  it('replaces strength / exists / plain_interpretation with relationship phrase', () => {
    const out = formatGraphForContext(rawGraph());
    expect(out.edges[0]).toEqual({
      from: 'fac_marketing',
      to: 'fac_leads',
      from_label: 'Marketing Spend',
      to_label: 'New Leads',
      relationship: 'moderate positive link',
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
});

describe('formatGraphForContext — node transformation', () => {
  it('keeps id/label/kind plus optional category, unit, intervention_summary', () => {
    const out = formatGraphForContext(rawGraph());
    expect(out.nodes[0]).toEqual({
      id: 'fac_marketing',
      label: 'Marketing Spend',
      kind: 'factor',
      category: 'spend',
      unit: 'k',
    });
    const optionNode = out.nodes.find((n) => n.id === 'opt_a')!;
    expect(optionNode).toEqual({
      id: 'opt_a',
      label: 'Option A',
      kind: 'option',
      intervention_summary: 'sets Marketing=200',
    });
  });

  it('strips value, raw_value, cap, source, _raw_provenance from display nodes', () => {
    const out = formatGraphForContext(rawGraph());
    const json = JSON.stringify(out.nodes);
    expect(json).not.toMatch(/"value":/);
    expect(json).not.toMatch(/"raw_value":/);
    expect(json).not.toMatch(/"cap":/);
    expect(json).not.toMatch(/"source":/);
    expect(json).not.toMatch(/_raw_provenance/);
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
});

describe('formatGraphForContext — passthrough fields', () => {
  it('preserves options, goals, constraints, counts unchanged', () => {
    const raw = rawGraph();
    const out = formatGraphForContext(raw);
    expect(out.options).toBe(raw.options);
    expect(out.goals).toBe(raw.goals);
    expect(out.constraints).toBe(raw.constraints);
    expect(out.counts).toBe(raw.counts);
  });
});

describe('formatGraphForContext — idempotency', () => {
  it('produces an equivalent shape when re-projected through itself', () => {
    const out1 = formatGraphForContext(rawGraph());
    // Display-safe graph satisfies ContextPackGraph structurally — re-running
    // the formatter on it should not corrupt the output. Strength is absent,
    // so every edge falls into the negligible-link branch on the second pass.
    // We assert that nodes/options/goals/constraints/counts pass through and
    // edges keep their from/to/labels (relationship may shift to "negligible").
    const out2 = formatGraphForContext(out1 as unknown as ContextPackGraph);
    expect(out2.nodes).toEqual(out1.nodes);
    expect(out2.counts).toEqual(out1.counts);
    out2.edges.forEach((edge, i) => {
      expect(edge.from).toBe(out1.edges[i]!.from);
      expect(edge.to).toBe(out1.edges[i]!.to);
      expect(edge.from_label).toBe(out1.edges[i]!.from_label);
      expect(edge.to_label).toBe(out1.edges[i]!.to_label);
    });
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
