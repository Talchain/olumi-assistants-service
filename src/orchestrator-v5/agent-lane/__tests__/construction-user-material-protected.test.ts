/**
 * RED-FIRST CONTROLS for the two CHANGES_REQUIRED findings on this lane's head
 * `0bb6e7c9` / `98e1b18c` (Release Control, exact-head pre-review).
 *
 * The lane's strongest claim is "the cap never overrides the user". Neither of
 * these two cases proved it, and both were reachable:
 *
 *  1. ⛔ THE SCHEMA COULD DROP EXPLICIT MATERIAL BEFORE THE GATE EVER SAW IT.
 *     `buildCandidateSchema()` carried `options.maxItems = 6` (and caps on
 *     factors/risks/outcomes/links). A brief with more than six explicit options
 *     creates an impossible contract — preserve every explicit option AND emit at
 *     most six — and the model can satisfy the schema only by OMITTING user
 *     material. The post-admission gate cannot detect what never arrived. The old
 *     "14 user options are admitted" test proved nothing about this, because it
 *     mocked `callStructured` with a payload the real schema would have refused:
 *     a self-authored fixture standing in for the wire.
 *
 *  2. ⛔ THE EXEMPTION PROTECTED NODES ONLY, NOT USER-STATED RELATIONSHIPS.
 *     `user_material_exceeds_limit` read `brief_stated_nodes > maxNodes`. An
 *     explicit brief can sit inside 12 nodes and still state more than 20
 *     relationships; that fell into the retry/refusal path, and nothing proved
 *     the explicit relations survived a retry.
 */
import { describe, expect, it } from 'vitest';
import {
  COMPACT_LIMITS,
  assessConstructionSize,
} from '../construction-size-gate.js';
import { buildCandidateSchema } from '../runtime/build-model.js';
import type { AdmittedModel, InferenceClass } from '../admit-model.js';

type NodeSpec = { readonly id: string; readonly kind: string; readonly cls?: InferenceClass };

function model(
  nodeSpecs: readonly NodeSpec[],
  edgeSpecs: readonly { from: string; to: string; briefStated: boolean }[],
) {
  const nodes = nodeSpecs.map((s) => ({ id: s.id, kind: s.kind, label: s.id })) as never;
  const inference_classes: Record<string, InferenceClass> = {};
  for (const s of nodeSpecs) if (s.cls !== undefined) inference_classes[s.id] = s.cls;
  const edges = edgeSpecs.map((e) => ({
    from: e.from,
    to: e.to,
    strength: { mean: 0.5, std: 0.1 },
    exists_probability: 0.8,
    // `explicit` candidate provenance becomes `brief_extraction` at admission
    // (`admit-candidate.ts::provenanceSourceFor`) — that is what marks a
    // relationship as the USER'S, and it is the only honest marker available.
    provenance: { source: e.briefStated ? 'brief_extraction' : 'cee_hypothesis' },
  })) as never;
  return { nodes, edges, inference_classes } as Pick<
    AdmittedModel,
    'nodes' | 'edges' | 'inference_classes'
  >;
}

describe('⛔ FINDING 1 — the candidate schema must not cap arrays that can hold user material', () => {
  const schema = buildCandidateSchema() as {
    properties: Record<string, Record<string, unknown>>;
  };

  // Every one of these can contain something the user stated.
  it.each(['options', 'factors', 'risks', 'outcomes', 'links'])(
    '`%s` carries NO maxItems — a cap here can only be satisfied by omitting user material',
    (key) => {
      expect(schema.properties[key], `${key} missing from the schema`).toBeDefined();
      expect(
        schema.properties[key]!['maxItems'],
        `${key}.maxItems forces the model to choose between the schema and the user's own content, `
          + 'and the post-admission gate cannot see what never arrived',
      ).toBeUndefined();
    },
  );

  it('still declares every array, so removing the caps did not remove the fields', () => {
    for (const key of ['options', 'factors', 'risks', 'outcomes', 'links', 'unknowns']) {
      expect(schema.properties[key], key).toBeDefined();
    }
  });
});

describe('⛔ FINDING 2 — user-stated RELATIONSHIPS are protected, not just nodes', () => {
  // 6 nodes (inside the 12 limit) but 24 user-stated edges (over the 20 limit).
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const nodeSpecs: NodeSpec[] = ids.map((id, i) => ({
    id,
    kind: i === 0 ? 'goal' : 'factor',
    cls: 'brief_stated' as InferenceClass,
  }));
  const edgeSpecs = Array.from({ length: 24 }, (_, i) => ({
    from: ids[i % ids.length]!,
    to: ids[(i + 1) % ids.length]!,
    briefStated: true,
  }));
  const v = assessConstructionSize(model(nodeSpecs, edgeSpecs));

  it('counts the user-stated relationships', () => {
    expect(v.brief_stated_edges).toBe(24);
  });

  it('is over the edge limit', () => {
    expect(v.within).toBe(false);
    expect(v.over_by.edges).toBe(24 - COMPACT_LIMITS.maxEdges);
  });

  it('⭐ flags user_material_exceeds_limit on RELATIONSHIPS, not only nodes', () => {
    // 6 brief-stated nodes is well inside the node limit, so the node-only
    // predicate said `false` here and sent an all-explicit brief to the retry.
    expect(v.brief_stated_nodes).toBe(6);
    expect(v.brief_stated_nodes).toBeLessThanOrEqual(COMPACT_LIMITS.maxNodes);
    expect(v.user_material_exceeds_limit).toBe(true);
  });

  it('does not name any of it as sheddable', () => {
    expect(v.sheddable_nodes).toBe(0);
  });
});

describe('the node exemption still works, and widening is still sheddable', () => {
  it('flags a node-heavy explicit brief', () => {
    const v = assessConstructionSize(
      model(
        Array.from({ length: 15 }, (_, i) => ({ id: `o${i}`, kind: 'option', cls: 'brief_stated' as InferenceClass })),
        [],
      ),
    );
    expect(v.user_material_exceeds_limit).toBe(true);
  });

  it('does NOT flag when widening is what pushed it over', () => {
    const v = assessConstructionSize(
      model(
        [
          { id: 'g', kind: 'goal', cls: 'brief_stated' },
          ...Array.from({ length: 14 }, (_, i) => ({ id: `f${i}`, kind: 'factor', cls: 'model_proposed' as InferenceClass })),
        ],
        Array.from({ length: 25 }, (_, i) => ({ from: `f${i % 14}`, to: 'g', briefStated: false })),
      ),
    );
    expect(v.user_material_exceeds_limit).toBe(false);
    expect(v.sheddable_nodes).toBe(14);
    expect(v.brief_stated_edges).toBe(0);
  });
});
