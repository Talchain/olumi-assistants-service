/**
 * The compact first-model gate.
 *
 * Paul's exact first turn produced 26 nodes / 57 edges. These specs pin the two
 * properties that make a size cap safe rather than destructive:
 *   1. the gate cannot truncate, structurally — its API returns counts, not a model;
 *   2. the cap targets WIDENING, and says so when the user's own material is the
 *      thing that exceeds it.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPACT_LIMITS,
  assessConstructionSize,
  retryInstruction,
} from '../construction-size-gate.js';
import type { AdmittedModel, InferenceClass } from '../admit-model.js';

type Spec = { readonly id: string; readonly kind: string; readonly cls?: InferenceClass };

function admitted(specs: readonly Spec[], edgeCount: number) {
  const nodes = specs.map((s) => ({ id: s.id, kind: s.kind, label: s.id })) as never;
  const inference_classes: Record<string, InferenceClass> = {};
  for (const s of specs) if (s.cls !== undefined) inference_classes[s.id] = s.cls;
  const edges = Array.from({ length: edgeCount }, (_, i) => ({
    from: `a${i}`, to: `b${i}`, strength: 0.5,
  })) as never;
  return { nodes, edges, inference_classes } as Pick<
    AdmittedModel,
    'nodes' | 'edges' | 'inference_classes'
  >;
}

const mk = (n: number, kind: string, cls?: InferenceClass, prefix = kind): Spec[] =>
  Array.from({ length: n }, (_, i) => ({ id: `${prefix}_${i}`, kind, ...(cls ? { cls } : {}) }));

describe('the stated limits are the product’s, not this module’s invention', () => {
  it('is 12 nodes and 20 edges', () => {
    expect(COMPACT_LIMITS).toEqual({ maxNodes: 12, maxEdges: 20 });
  });
});

describe('a compact model passes cleanly', () => {
  const v = assessConstructionSize(
    admitted([...mk(1, 'goal', 'brief_stated'), ...mk(2, 'option', 'brief_stated'), ...mk(5, 'factor', 'builder_inferred')], 12),
  );
  it('is within budget', () => {
    expect(v.within).toBe(true);
    expect(v.over_by).toEqual({ nodes: 0, edges: 0 });
  });
  it('says nothing when there is nothing to say', () => {
    expect(v.detail).toBe('');
  });
});

describe("Paul's measured first turn — 26 nodes / 57 edges", () => {
  // 3 AI-added options, 14 factors, 5 risks, plus goal/decision/outcomes.
  const v = assessConstructionSize(
    admitted(
      [
        ...mk(1, 'goal', 'brief_stated'),
        ...mk(1, 'decision', 'builder_inferred'),
        ...mk(2, 'option', 'brief_stated', 'user_opt'),
        ...mk(3, 'option', 'model_proposed', 'ai_opt'),
        ...mk(14, 'factor', 'model_proposed'),
        ...mk(5, 'risk', 'model_proposed'),
      ],
      57,
    ),
  );

  it('refuses the size on BOTH dimensions', () => {
    expect(v.within).toBe(false);
    expect(v.nodes).toBe(26);
    expect(v.edges).toBe(57);
    expect(v.over_by).toEqual({ nodes: 14, edges: 37 });
  });

  it('names the WIDENING as the oversize, not the user', () => {
    expect(v.sheddable_nodes).toBe(22); // 3 options + 14 factors + 5 risks
    expect(v.brief_stated_nodes).toBe(3); // goal + the user's two options
    expect(v.user_material_exceeds_limit).toBe(false);
  });

  it('reports what is oversized, by kind', () => {
    expect(v.by_kind['factor']).toBe(14);
    expect(v.by_kind['risk']).toBe(5);
    expect(v.by_kind['option']).toBe(5);
  });

  it('states it in one sentence a user could read', () => {
    expect(v.detail).toContain('26 nodes (limit 12)');
    expect(v.detail).toContain('57 links (limit 20)');
    expect(v.detail).toContain('added beyond the brief');
  });
});

describe('each dimension refuses on its own', () => {
  it('too many edges alone is oversize', () => {
    const v = assessConstructionSize(admitted(mk(8, 'factor', 'builder_inferred'), 21));
    expect(v.within).toBe(false);
    expect(v.over_by).toEqual({ nodes: 0, edges: 1 });
  });
  it('too many nodes alone is oversize', () => {
    const v = assessConstructionSize(admitted(mk(13, 'factor', 'builder_inferred'), 5));
    expect(v.within).toBe(false);
    expect(v.over_by).toEqual({ nodes: 1, edges: 0 });
  });
  it('exactly at the limit is WITHIN — the cap is inclusive', () => {
    const v = assessConstructionSize(admitted(mk(12, 'factor', 'builder_inferred'), 20));
    expect(v.within).toBe(true);
  });
});

describe('⭐ the cap must never be a reason to delete what the user said', () => {
  it('flags when the user’s OWN material alone exceeds the limit', () => {
    const v = assessConstructionSize(admitted(mk(15, 'option', 'brief_stated'), 10));
    expect(v.within).toBe(false);
    expect(v.user_material_exceeds_limit).toBe(true);
    // And it does not pretend any of it is sheddable.
    expect(v.sheddable_nodes).toBe(0);
  });

  it('does NOT flag when widening is what pushed it over', () => {
    const v = assessConstructionSize(
      admitted([...mk(4, 'option', 'brief_stated'), ...mk(11, 'factor', 'model_proposed')], 10),
    );
    expect(v.user_material_exceeds_limit).toBe(false);
    expect(v.sheddable_nodes).toBe(11);
  });
});

describe('⛔ an unclassified node is NOT counted as widening', () => {
  it('absence is unclassified, never model_proposed', () => {
    // NULL means "nobody recorded how this got here"; treating it as the model's
    // invention would invite a retry to shed something nobody established.
    const v = assessConstructionSize(admitted(mk(13, 'factor'), 5));
    expect(v.by_provenance.model_proposed).toBe(0);
    expect(v.by_provenance.brief_stated).toBe(0);
    expect(v.sheddable_nodes).toBe(0);
    // Still counted in the total, so the cap still bites.
    expect(v.nodes).toBe(13);
    expect(v.within).toBe(false);
  });
});

describe('⛔ the gate is STRUCTURALLY incapable of truncating', () => {
  it('returns only counts and classifications — never a model to persist', () => {
    const v = assessConstructionSize(
      admitted([...mk(2, 'option', 'brief_stated'), ...mk(20, 'factor', 'model_proposed')], 40),
    );
    // No caller can mistake this for a smaller graph: there is no nodes or edges
    // ARRAY on the verdict at all, so "use the gate's output" cannot silently
    // become "persist the truncated model".
    expect(Array.isArray((v as unknown as Record<string, unknown>)['nodes'])).toBe(false);
    expect((v as unknown as Record<string, unknown>)['admitted']).toBeUndefined();
    const arrayValued = Object.entries(v).filter(([, val]) => Array.isArray(val));
    expect(arrayValued).toEqual([]);
  });
});

describe('the retry instruction names a budget, never a list', () => {
  const v = assessConstructionSize(
    admitted([...mk(2, 'option', 'brief_stated'), ...mk(20, 'factor', 'model_proposed')], 40),
  );
  const text = retryInstruction(v);

  it('states both measured counts and both limits', () => {
    expect(text).toContain('22 nodes and 40 links');
    expect(text).toContain('12 nodes and 20 links');
  });

  it('protects the brief’s own material explicitly', () => {
    expect(text).toMatch(/not negotiable|must not be dropped/i);
  });

  it('sends the overflow to unknowns, not to the canvas', () => {
    expect(text).toContain('`unknowns`');
    expect(text).toMatch(/NOT as a node/i);
  });

  it('forbids inventing numbers to fit', () => {
    expect(text).toMatch(/Do not invent a number/i);
  });

  it('names no specific node to delete', () => {
    for (const id of ['factor_0', 'option_0', 'user_opt_0']) {
      expect(text, `retry must not name ${id}`).not.toContain(id);
    }
  });
});
