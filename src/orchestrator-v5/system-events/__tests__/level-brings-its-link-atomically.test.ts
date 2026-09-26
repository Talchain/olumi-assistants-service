/**
 * ⭐ ONE USER OPERATION → ONE APPROVAL → ONE ATOMIC COMMIT (DL #70 5847137399, row A / BF5).
 *
 * A level on a factor its option is not yet linked to used to be refused (`unresolved_effect_relationship`), so the
 * Agent wrote the link and then the level as TWO commits (#2004): a refusal or a concurrent edit between them left a
 * link with no level. The product's own level writer now adds the missing option → factor TOPOLOGY link inside the
 * SAME validate → apply → commit as the level: one candidate, one handler fact, one receipt, no partial state.
 *
 * Unchanged refusals: a pair already joined any other way (reversed, bidirected) is never re-linked — adding a
 * forward edge beside a reverse one would make a cycle.
 */
import { describe, expect, it } from 'vitest';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { linkedFactorsOf } from '../../routing/option-effect-write.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';
import { prepareOptionInterventionEdit, applyOptionInterventionEdit,
  optionInterventionPostimageIsScoped } from '../option-intervention-edit.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function graph() {
  return projectGraphForPersistence({ ...GraphV3.parse({
    nodes: [
      { id: 'goal', kind: 'goal', label: 'Revenue' },
      { id: 'decision', kind: 'decision', label: 'Pricing' },
      { id: 'option', kind: 'option', label: 'Cohort test' },
      { id: 'price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.25 } },
      { id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 0.1 } },
    ],
    edges: [['decision', 'option', 1], ['option', 'churn', 1], ['price', 'goal', 0.5], ['churn', 'goal', -0.5]].map(([from, to, mean]) => ({
      from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: (mean as number) < 0 ? 'negative' : 'positive',
    })),
  }), options: [] as unknown[] }) as ReturnType<typeof GraphV3.parse>;
}
const input = (g: unknown, over: Record<string, unknown> = {}) => ({ persistedGraph: g, optionId: 'option', factorId: 'price',
  modelValue: 0.27, expectedGraphHash: computeAnalysisAffectingGraphHash(g as never)!,
  scenarioId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', turnId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  requestId: 'internal-effect', freshness: 'none' as const, hasExistingAnalysis: false, ...over });
const target = { optionId: 'option', factorId: 'price', modelValue: 0.27 };

describe('a level brings its link — ONE atomic commit (DL #70 5847137399)', () => {
  it('RED: an unlinked pair prepares the level AND the option → factor topology link it needs', () => {
    const g = graph();
    expect(linkedFactorsOf(g, 'option').map((f) => f.id), 'premise: price is not linked').toEqual(['churn']);
    const p = prepareOptionInterventionEdit(input(g));
    expect(p.kind, JSON.stringify(p)).toBe('prepared');
    if (p.kind !== 'prepared') return;
    expect(p.linkOperation).toMatchObject({ op: 'add_edge', path: 'option::price' });
  });

  it('RED: ONE candidate carries both writes — the link (topology constants, the user\'s) and the level — and the scope guard admits exactly that', () => {
    const g = graph();
    const pristine = clone(g);
    const c = applyOptionInterventionEdit(input(g));
    expect(c.kind, JSON.stringify(c)).toBe('candidate');
    if (c.kind !== 'candidate') return;
    expect(c.operations.map((o) => o.op)).toEqual(['add_edge', 'update_node']);
    const e = c.graph.edges.filter((x) => x.from === 'option' && x.to === 'price');
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ strength: { mean: STRUCTURAL_EDGE_DEFAULTS.strength.mean }, exists_probability: STRUCTURAL_EDGE_DEFAULTS.exists_probability,
      provenance: { source: 'user_specified' } });
    expect((c.graph.nodes.find((n) => n.id === 'option')?.interventions as Record<string, { value: number; source: string }>).price)
      .toMatchObject({ value: 0.27, source: 'user_specified' });
    expect(linkedFactorsOf(c.graph, 'option').map((f) => f.id).sort()).toEqual(['churn', 'price']);
    expect(g).toEqual(pristine);
    expect(optionInterventionPostimageIsScoped(g, c.graph, target, { from: 'option', to: 'price' })).toBe(true);
  });

  it('an adopted Olumi level brings an Olumi link (#1992: the link follows its level\'s source)', () => {
    const c = applyOptionInterventionEdit(input(graph(), { source: 'cee_hypothesis' }));
    expect(c.kind, JSON.stringify(c)).toBe('candidate');
    if (c.kind !== 'candidate') return;
    expect(c.graph.edges.find((x) => x.from === 'option' && x.to === 'price')?.provenance).toMatchObject({ source: 'cee_hypothesis' });
  });

  it('the scope guard refuses a postimage with ANY other change beside the one link and the level', () => {
    const g = graph();
    const c = applyOptionInterventionEdit(input(g));
    if (c.kind !== 'candidate') throw new Error(JSON.stringify(c));
    const extra = clone(c.graph);
    extra.edges.push({ ...clone(extra.edges.find((x) => x.from === 'option' && x.to === 'price')!), to: 'goal' });
    expect(optionInterventionPostimageIsScoped(g, extra, target, { from: 'option', to: 'price' })).toBe(false);
    // Without the declared link, the same (correct) postimage is out of scope: nothing else may add it.
    expect(optionInterventionPostimageIsScoped(g, c.graph, target)).toBe(false);
  });

  it('CONTRAST: an already-linked pair is unchanged — ONE operation, no edge added', () => {
    const c = applyOptionInterventionEdit(input(graph(), { factorId: 'churn', modelValue: 0.05 }));
    expect(c.kind, JSON.stringify(c)).toBe('candidate');
    if (c.kind !== 'candidate') return;
    expect(c.operations.map((o) => o.op)).toEqual(['update_node']);
  });

  it('a pair already joined the REVERSE way (price → option) is never re-linked: still refused, since a forward edge would make a cycle', () => {
    const g = graph();
    g.edges.push({ from: 'price', to: 'option', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' } as never);
    expect(prepareOptionInterventionEdit(input(g))).toEqual({ kind: 'refused', reason: 'unresolved_effect_relationship' });
  });

  it('CONTRAST: a bidirected option ↔ price edge already links them (`linkedFactorsOf`): the level only, no link operation', () => {
    const g = graph();
    g.edges.push({ from: 'option', to: 'price', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive', edge_type: 'bidirected' } as never);
    const p = prepareOptionInterventionEdit(input(g));
    expect(p.kind).toBe('prepared');
    expect((p as { linkOperation?: unknown }).linkOperation).toBeUndefined();
  });
});
