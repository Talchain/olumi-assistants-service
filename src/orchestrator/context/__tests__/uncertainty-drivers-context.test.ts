/**
 * Producer-stated uncertainty reaches the model's context bounded, never rewritten, and withheld on conflict.
 *
 * Deletion 11 (22 Oct 2026, Codex r1 on #3620): these rows guarded the shared authority
 * `projectUncertaintyDriversForContext` (graph-compact.ts) through the deleted `compactGraphForContextPack` wrapper and
 * `formatGraphForContext`. The authority is live (server.ts → decision-review-enricher → decision-review-graph-projection,
 * and `compactGraph` for factors), so the rows are re-pointed to `compactGraph`, inputs and assertions unchanged.
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS, compactGraph, projectUncertaintyDriversForContext } from '../graph-compact.js';

type Rec = Record<string, any>;

/** The deleted spec's strict graph: a goal, two options and one factor, each with a stated level. */
function strictGraph(): Rec {
  return {
    nodes: Array.from({ length: 4 }, (_, i) => ({
      id: `n-${i}`, kind: i === 0 ? 'goal' : i < 3 ? 'option' : 'factor', label: `Node ${i} label`,
      observed_state: { value: i * 0.1, std: 0.05, extractionType: 'explicit' }, category: 'observable',
    })),
    edges: [],
  };
}
const factorOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'factor');
const compactFactor = (g: Rec): Rec => compactGraph(GraphV3.parse(g)).nodes.find((n) => n.kind === 'factor') as Rec;

describe('uncertainty drivers in the compact context (the shared bounds authority)', () => {
  it('preserves producer uncertainty bytes and order from either permitted source location', () => {
    const observed = strictGraph();
    factorOf(observed).observed_state.uncertainty_drivers = ['First source fact', 'Second source fact'];
    expect(compactFactor(observed).uncertainty_drivers).toEqual(['First source fact', 'Second source fact']);
    expect(compactFactor(observed)).not.toHaveProperty('uncertainty_drivers_disclosure');

    const promoted = strictGraph();
    factorOf(promoted).uncertainty_drivers = ['Promoted source fact'];
    factorOf(promoted).observed_state.uncertainty_drivers = ['Promoted source fact'];
    expect(compactFactor(promoted).uncertainty_drivers).toEqual(['Promoted source fact']);
    expect(compactFactor(promoted)).not.toHaveProperty('uncertainty_drivers_disclosure');
  });

  it('fails closed instead of choosing between conflicting permitted source locations', () => {
    const g = strictGraph();
    factorOf(g).uncertainty_drivers = ['Promoted value'];
    factorOf(g).observed_state.uncertainty_drivers = ['Observed-state value'];
    expect(compactFactor(g)).not.toHaveProperty('uncertainty_drivers');
    expect(compactFactor(g).uncertainty_drivers_disclosure).toEqual({ status: 'conflicting_sources_withheld' });
  });

  it('bounds entries and characters without rewriting or silently dropping producer text', () => {
    const g = strictGraph();
    const overlong = 'x'.repeat(CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS + 1);
    factorOf(g).uncertainty_drivers = [overlong, 'Second exact entry', 'Count-bounded entry'];
    expect(compactFactor(g).uncertainty_drivers).toEqual([overlong.slice(0, CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS), 'Second exact entry']);
    expect(compactFactor(g).uncertainty_drivers_disclosure).toEqual({
      status: 'truncated', original_entries: 3, retained_entries: 2, entries_omitted_by_count: 1, entries_truncated_by_chars: 1,
      per_entry_char_limit: CONTEXT_UNCERTAINTY_DRIVER_MAX_CHARS,
    });
    // Reprojection keeps the prior truncation disclosure (Codex r2: format-graph-for-context.test.ts:557 asserted this
    // through the deleted formatter; the shared authority accepts its own output, graph-compact.ts:306).
    const once = compactFactor(g);
    expect(projectUncertaintyDriversForContext(once)).toEqual({
      uncertainty_drivers: once.uncertainty_drivers, uncertainty_drivers_disclosure: once.uncertainty_drivers_disclosure });
  });

  it('adds no uncertainty keys when the producer supplied none, and keeps the compact JSON byte-identical', () => {
    expect(JSON.stringify(compactGraph(GraphV3.parse(strictGraph())))).not.toContain('uncertainty_driver');
    // Codex r2: compact-graph-for-contextpack.test.ts:390 pinned these exact bytes through the deleted wrapper.
    const one = { nodes: [{ id: 'n-0', kind: 'goal', label: 'Node 0 label', body: 'x', category: 'observable',
      observed_state: { value: 0, std: 0.05, extractionType: 'explicit' } }], edges: [] };
    expect(JSON.stringify(compactGraph(GraphV3.parse(one)))).toBe(
      '{"nodes":[{"id":"n-0","kind":"goal","label":"Node 0 label","category":"observable","value":0,"source":"user","provenance":"from_brief"}],"edges":[],"_node_count":1,"_edge_count":0}',
    );
  });

  it('does not promote uncertainty-shaped metadata from non-factor nodes', () => {
    const g = strictGraph();
    const goal = g.nodes.find((n: Rec) => n.kind === 'goal');
    goal.uncertainty_drivers = ['Out-of-scope goal metadata'];
    goal.observed_state.uncertainty_drivers = ['Out-of-scope goal metadata'];
    const compactGoal = compactGraph(GraphV3.parse(g)).nodes.find((n) => n.kind === 'goal') as Rec;
    expect(compactGoal).not.toHaveProperty('uncertainty_drivers');
    expect(compactGoal).not.toHaveProperty('uncertainty_drivers_disclosure');
  });
});
